// The usage receiver's database (D1, tables in migrations/). Events are kept by the day they
// happened, for KEEP_DAYS days after it (days.ts), with each install's first and last day. The
// daily run counts each of those days again into the tables of counts, which hold no ID and are
// kept, and then deletes the events and installs past their time. What each count means is in
// docs/usage-receiver.md.
import { USAGE_EVENTS } from '../src/host/analytics.ts';
import { KEEP_DAYS, addDays, dayOf } from './days.ts';
import { UUID, type Batch } from './records.ts';

/** The parts of D1's Worker API the receiver uses. */
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  /** Runs the statements in one transaction. */
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

/**
 * The most records the receiver takes in a day: a limit on what a day of it can cost, also when
 * someone sends it records that are not den-kit's (docs/principles.md, Assume the worst intent).
 */
export const DAILY_RECORDS = 100_000;

/** Records taken on `day` so far. */
export async function taken(db: D1Database, day: string): Promise<number> {
  const row = await db
    .prepare('SELECT records FROM intake WHERE day = ?1')
    .bind(day)
    .first<{ records: number }>();
  return row?.records ?? 0;
}

/** Keeps a batch received at `now`, in one transaction. An event already kept (by its id) stays as it was. */
export async function keep(db: D1Database, batch: Batch, now: Date) {
  const records = JSON.stringify(batch.records);
  const receivedAt = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const intake = db
    .prepare(
      `INSERT INTO intake (day, records, skipped) VALUES (?1, ?2, ?3)
       ON CONFLICT (day) DO UPDATE SET records = records + excluded.records, skipped = skipped + excluded.skipped`,
    )
    .bind(dayOf(now), batch.records.length, batch.skipped);
  if (!batch.records.length) {
    await db.batch([intake]);
    return;
  }
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO events (id, install_id, event, version, os, arch, at, day, received_at)
         SELECT json_extract(value, '$.id'), json_extract(value, '$.install_id'),
           json_extract(value, '$.event'), json_extract(value, '$.version'),
           json_extract(value, '$.os'), json_extract(value, '$.arch'), json_extract(value, '$.at'),
           substr(json_extract(value, '$.at'), 1, 10), ?2
         FROM json_each(?1)`,
      )
      .bind(records, receivedAt),
    // WHERE true: SQLite would read ON CONFLICT as part of the SELECT otherwise.
    db
      .prepare(
        `INSERT INTO installs (install_id, first_day, last_day)
         SELECT json_extract(value, '$.install_id'), min(substr(json_extract(value, '$.at'), 1, 10)),
           max(substr(json_extract(value, '$.at'), 1, 10))
         FROM json_each(?1) WHERE true GROUP BY 1
         ON CONFLICT (install_id) DO UPDATE SET first_day = min(first_day, excluded.first_day),
           last_day = max(last_day, excluded.last_day)`,
      )
      .bind(records),
    intake,
  ]);
}

/**
 * The most values of a dimension counted for one day or week: those with the most installs. Records
 * that are not den-kit's can name any version, OS or CPU type, so this keeps what they add to the
 * counts, which are kept for good, small.
 */
export const MOST_VALUES = 100;

/**
 * The daily run on `today`: counts again each day the receiver still keeps events of, up to
 * yesterday, then deletes the events and installs past KEEP_DAYS. Each table of counts changes in
 * one transaction, and the deleting happens even when counting fails, so that nothing is kept
 * longer than docs/usage.md says.
 */
export async function count(db: D1Database, today: string) {
  const from = addDays(today, -KEEP_DAYS);
  const to = addDays(today, -1);
  try {
    // A week counts again only while the receiver keeps all its days: from its first Monday.
    const weeks = addDays(from, (8 - new Date(`${from}T00:00:00Z`).getUTCDay()) % 7);
    for (const [period, start, first] of [
      ['day', 'day', from],
      ['week', "date(day, '-6 days', 'weekday 1')", weeks],
    ]) {
      const selects = [
        `SELECT ?1, ${start}, 'all', '', count(DISTINCT install_id) FROM events
         WHERE day BETWEEN ?2 AND ?3 GROUP BY 2`,
        ...['version', 'os', 'arch'].map(
          dimension =>
            `SELECT ?1, start, '${dimension}', value, installs FROM (
               SELECT start, value, installs,
                 row_number() OVER (PARTITION BY start ORDER BY installs DESC, value) AS rank
               FROM (SELECT ${start} AS start, ${dimension} AS value,
                   count(DISTINCT install_id) AS installs
                 FROM events WHERE day BETWEEN ?2 AND ?3 GROUP BY 1, 2))
             WHERE rank <= ${MOST_VALUES}`,
        ),
      ];
      await db.batch([
        db
          .prepare('DELETE FROM active WHERE period = ?1 AND start BETWEEN ?2 AND ?3')
          .bind(period, first, to),
        db
          .prepare(
            `INSERT INTO active (period, start, dimension, value, installs) ${selects.join(' UNION ALL ')}`,
          )
          .bind(period, first, to),
      ]);
    }
    await db.batch([
      db.prepare('DELETE FROM event_counts WHERE day BETWEEN ?1 AND ?2').bind(from, to),
      db
        .prepare(
          `INSERT INTO event_counts (day, event, events, installs)
           SELECT day, event, count(*), count(DISTINCT install_id) FROM events
           WHERE day BETWEEN ?1 AND ?2 GROUP BY day, event`,
        )
        .bind(from, to),
    ]);
    await db.batch([
      db.prepare('DELETE FROM cohorts WHERE day BETWEEN ?1 AND ?2').bind(from, to),
      db
        .prepare(
          `INSERT INTO cohorts (day, metric, installs)
           SELECT first_day, 'installs', count(*) FROM installs
           WHERE first_day BETWEEN ?1 AND ?2 GROUP BY first_day`,
        )
        .bind(from, to),
      db
        .prepare(
          `INSERT INTO cohorts (day, metric, installs)
           SELECT i.first_day, 'day_' || n.value, count(DISTINCT e.install_id)
           FROM installs AS i JOIN json_each('[1, 7, 30]') AS n
           LEFT JOIN events AS e ON e.install_id = i.install_id
             AND e.day = date(i.first_day, '+' || n.value || ' days')
           WHERE i.first_day BETWEEN ?1 AND ?2 AND date(i.first_day, '+' || n.value || ' days') <= ?2
           GROUP BY i.first_day, n.value`,
        )
        .bind(from, to),
      db
        .prepare(
          `INSERT INTO cohorts (day, metric, installs)
           SELECT i.first_day, s.value, count(DISTINCT e.install_id)
           FROM installs AS i JOIN json_each(?3) AS s
           LEFT JOIN events AS e ON e.install_id = i.install_id AND e.event = s.value
             AND e.day BETWEEN i.first_day AND date(i.first_day, '+6 days')
           WHERE i.first_day BETWEEN ?1 AND ?2 AND date(i.first_day, '+6 days') <= ?2
           GROUP BY i.first_day, s.value`,
        )
        .bind(from, to, JSON.stringify(USAGE_EVENTS)),
    ]);
  } finally {
    await db.batch([
      db.prepare('DELETE FROM events WHERE day < ?1').bind(from),
      db.prepare('DELETE FROM installs WHERE last_day < ?1').bind(from),
    ]);
  }
}

/**
 * The SQL that shows or deletes what the receiver keeps for one install ID (data-request.ts). The
 * counts hold no ID, so they stay.
 */
export function dataRequest(action: string, installId: string): string {
  if (!UUID.test(installId)) throw new Error(`Not an install ID: ${installId}`);
  const where = `install_id = '${installId}'`;
  if (action === 'show')
    return `SELECT * FROM installs WHERE ${where}; SELECT id, event, version, os, arch, at, received_at FROM events WHERE ${where} ORDER BY at, id;`;
  if (action === 'delete')
    return `DELETE FROM events WHERE ${where}; DELETE FROM installs WHERE ${where};`;
  throw new Error(`Unknown action: ${action}. Use show or delete.`);
}
