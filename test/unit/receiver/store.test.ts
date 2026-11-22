// The usage receiver's daily run and its data requests (receiver/store.ts), with a stand-in for D1:
// the counts with no ID, made again for each day it still keeps events of; events and installs
// deleted 45 days after their day, also when counting fails; and one install's events shown or
// deleted for a valid ID only.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vite-plus/test';
import type { UsageRecord } from '../../../desktop/analytics.ts';
import type { UsageEvent } from '../../../src/host/analytics.ts';
import { count, dataRequest, keep, MOST_VALUES } from '../../../receiver/store.ts';
import { testD1, type TestD1 } from '../../helpers/d1.ts';

// The run on 2026-12-10 counts 2026-10-26 to 2026-12-09, the 45 days it still keeps.
const TODAY = '2026-12-10';

function event(
  installId: string,
  name: UsageEvent,
  day: string,
  fields: Partial<UsageRecord> = {},
): UsageRecord {
  return {
    event: name,
    id: randomUUID(),
    install_id: installId,
    version: '1.0.0',
    os: 'macOS 26.2',
    arch: 'arm64',
    at: `${day}T10:00:00Z`,
    ...fields,
  };
}

async function send(db: TestD1, records: UsageRecord[], receivedAt = '2026-12-09T12:00:00Z') {
  await keep(db, { records, skipped: 0 }, new Date(receivedAt));
}

const metrics = (db: TestD1, day: string) =>
  Object.fromEntries(
    db
      .rows('SELECT metric, installs FROM cohorts WHERE day = ?', day)
      .map(row => [row.metric, row.installs]),
  );

describe("the usage receiver's daily run", () => {
  it('counts the installs active each day and each week, in all and by version, OS and CPU type', async () => {
    const db = testD1();
    const [a, b] = [randomUUID(), randomUUID()];
    // 2026-12-07 is a Monday.
    await send(db, [
      event(a, 'app_used', '2026-12-07'),
      event(a, 'sound_played', '2026-12-07'),
      event(a, 'app_used', '2026-12-08', { version: '1.1.0' }),
      event(b, 'app_used', '2026-12-08', { os: 'Windows 10.0.26100', arch: 'x64' }),
      event(b, 'app_used', '2026-12-10'),
    ]);
    await count(db, TODAY);
    expect(
      db.rows("SELECT start, dimension, value, installs FROM active WHERE period = 'day'"),
    ).toEqual(
      expect.arrayContaining([
        { start: '2026-12-07', dimension: 'all', value: '', installs: 1 },
        { start: '2026-12-08', dimension: 'all', value: '', installs: 2 },
        { start: '2026-12-08', dimension: 'version', value: '1.0.0', installs: 1 },
        { start: '2026-12-08', dimension: 'version', value: '1.1.0', installs: 1 },
        { start: '2026-12-08', dimension: 'os', value: 'Windows 10.0.26100', installs: 1 },
        { start: '2026-12-08', dimension: 'arch', value: 'x64', installs: 1 },
      ]),
    );
    // Today is counted tomorrow.
    expect(db.rows("SELECT * FROM active WHERE start = '2026-12-10'")).toEqual([]);
    expect(
      db.rows("SELECT dimension, value, installs FROM active WHERE period = 'week' ORDER BY 1, 2"),
    ).toEqual([
      { dimension: 'all', value: '', installs: 2 },
      { dimension: 'arch', value: 'arm64', installs: 1 },
      { dimension: 'arch', value: 'x64', installs: 1 },
      { dimension: 'os', value: 'Windows 10.0.26100', installs: 1 },
      { dimension: 'os', value: 'macOS 26.2', installs: 1 },
      { dimension: 'version', value: '1.0.0', installs: 2 },
      { dimension: 'version', value: '1.1.0', installs: 1 },
    ]);
    expect(db.rows("SELECT DISTINCT start FROM active WHERE period = 'week'")).toEqual([
      { start: '2026-12-07' },
    ]);
  });

  it('counts the versions, OSes and CPU types with the most installs, up to a limit', async () => {
    const db = testD1();
    const common = [randomUUID(), randomUUID()];
    const records = common.map(id => event(id, 'app_used', '2026-12-08', { version: '1.0.0' }));
    for (let i = 0; i < MOST_VALUES; i++)
      records.push(
        event(randomUUID(), 'app_used', '2026-12-08', {
          version: `9.9.${i}`,
          os: `macOS 99.${i}`,
          arch: `arch${i}`,
        }),
      );
    await send(db, records);
    await count(db, TODAY);
    const counted = (dimension: string) =>
      db.rows(
        "SELECT value, installs FROM active WHERE period = 'day' AND dimension = ? ORDER BY installs DESC, value",
        dimension,
      );
    expect(counted('version')).toHaveLength(MOST_VALUES);
    expect(counted('version')[0]).toEqual({ value: '1.0.0', installs: 2 });
    expect(counted('os')).toHaveLength(MOST_VALUES);
    expect(counted('arch')).toHaveLength(MOST_VALUES);
    expect(counted('all')).toEqual([{ value: '', installs: MOST_VALUES + 2 }]);
  });

  it('counts each event and the installs that sent it, each day', async () => {
    const db = testD1();
    const [a, b] = [randomUUID(), randomUUID()];
    await send(db, [
      event(a, 'ai_requested', '2026-12-08'),
      event(a, 'ai_requested', '2026-12-08'),
      event(b, 'ai_requested', '2026-12-08'),
      event(b, 'work_exported', '2026-12-09'),
    ]);
    await count(db, TODAY);
    expect(db.rows('SELECT * FROM event_counts ORDER BY day, event')).toEqual([
      { day: '2026-12-08', event: 'ai_requested', events: 3, installs: 2 },
      { day: '2026-12-09', event: 'work_exported', events: 1, installs: 1 },
    ]);
  });

  it('follows the installs that started each day: days 1, 7 and 30, and their first week', async () => {
    const db = testD1();
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    // a and b start on 2026-11-09; day 30 is 2026-12-09, the last day counted. c starts on 2026-12-08.
    await send(db, [
      event(a, 'app_used', '2026-11-09'),
      event(a, 'sound_played', '2026-11-09'),
      event(a, 'app_used', '2026-11-10'),
      event(a, 'work_exported', '2026-11-15'),
      event(a, 'work_edited', '2026-11-16'),
      event(a, 'app_used', '2026-12-09'),
      event(b, 'app_used', '2026-11-09'),
      event(b, 'app_used', '2026-11-16'),
      event(c, 'app_used', '2026-12-08'),
    ]);
    await count(db, TODAY);
    expect(metrics(db, '2026-11-09')).toEqual({
      installs: 2,
      day_1: 1,
      day_7: 2,
      day_30: 1,
      // Days 0 to 6: work_edited on day 7 is not in the first week.
      app_used: 2,
      sound_played: 1,
      work_edited: 0,
      ai_requested: 0,
      code_part_added: 0,
      work_exported: 1,
    });
    // Day 1 has passed for c; day 7 and its first week have not.
    expect(metrics(db, '2026-12-08')).toEqual({ installs: 1, day_1: 0 });
  });

  it('counts each day again while it keeps its events, so that an event sent late counts', async () => {
    const db = testD1();
    const [a, b] = [randomUUID(), randomUUID()];
    await send(db, [event(a, 'app_used', '2026-11-30')]);
    await count(db, TODAY);
    await send(db, [event(b, 'app_used', '2026-11-30')], '2026-12-10T08:00:00Z');
    await count(db, '2026-12-11');
    expect(
      db.rows(
        "SELECT installs FROM active WHERE period = 'day' AND start = '2026-11-30' AND dimension = 'all'",
      ),
    ).toEqual([{ installs: 2 }]);
    expect(metrics(db, '2026-11-30').installs).toBe(2);
  });

  it('keeps the counts, and deletes events and installs 45 days after their day', async () => {
    const db = testD1();
    const [a, b] = [randomUUID(), randomUUID()];
    await send(
      db,
      [event(a, 'app_used', '2026-10-25'), event(b, 'app_used', '2026-10-26')],
      '2026-10-27T00:00:00Z',
    );
    await count(db, '2026-10-27');
    await count(db, TODAY);
    expect(db.rows('SELECT install_id, day FROM events')).toEqual([
      { install_id: b, day: '2026-10-26' },
    ]);
    expect(db.rows('SELECT install_id FROM installs')).toEqual([{ install_id: b }]);
    // The days no longer kept keep their counts.
    expect(
      db.rows(
        "SELECT start, installs FROM active WHERE period = 'day' AND dimension = 'all' ORDER BY start",
      ),
    ).toEqual([
      { start: '2026-10-25', installs: 1 },
      { start: '2026-10-26', installs: 1 },
    ]);
    await count(db, '2026-12-11');
    expect(db.rows('SELECT * FROM events')).toEqual([]);
    expect(db.rows('SELECT * FROM installs')).toEqual([]);
    expect(metrics(db, '2026-10-26')).toEqual({
      installs: 1,
      day_1: 0,
      day_7: 0,
      day_30: 0,
      app_used: 1,
      sound_played: 0,
      work_edited: 0,
      ai_requested: 0,
      code_part_added: 0,
      work_exported: 0,
    });
  });

  it('does not count a week again once it has days it no longer keeps', async () => {
    const db = testD1();
    // 2026-10-26, the first day still kept, is a Monday: the week before it stays as counted.
    db.exec(
      "INSERT INTO active VALUES ('week', '2026-10-19', 'all', '', 5), ('week', '2026-10-26', 'all', '', 5)",
    );
    await count(db, TODAY);
    expect(db.rows("SELECT start, installs FROM active WHERE period = 'week'")).toEqual([
      { start: '2026-10-19', installs: 5 },
    ]);
  });

  it('deletes what is past its time even when counting fails', async () => {
    const db = testD1();
    await send(db, [event(randomUUID(), 'app_used', '2026-10-01')], '2026-10-02T00:00:00Z');
    db.fail = /INSERT INTO cohorts/;
    await expect(count(db, TODAY)).rejects.toThrow('D1_ERROR');
    expect(db.rows('SELECT * FROM events')).toEqual([]);
    expect(db.rows('SELECT * FROM installs')).toEqual([]);
  });
});

describe("the usage receiver's data requests", () => {
  it("shows and deletes one install's events", async () => {
    const db = testD1();
    const [a, b] = [randomUUID(), randomUUID()];
    await send(db, [
      event(a, 'app_used', '2026-12-08'),
      event(a, 'sound_played', '2026-12-09'),
      event(b, 'app_used', '2026-12-09'),
    ]);
    const [install, events] = dataRequest('show', a)
      .split(';')
      .filter(sql => sql.trim())
      .map(sql => db.rows(sql));
    expect(install).toEqual([{ install_id: a, first_day: '2026-12-08', last_day: '2026-12-09' }]);
    expect(events.map(row => row.event)).toEqual(['app_used', 'sound_played']);
    expect(Object.keys(events[0])).toEqual([
      'id',
      'event',
      'version',
      'os',
      'arch',
      'at',
      'received_at',
    ]);
    db.exec(dataRequest('delete', a));
    expect(db.rows('SELECT DISTINCT install_id FROM events')).toEqual([{ install_id: b }]);
    expect(db.rows('SELECT install_id FROM installs')).toEqual([{ install_id: b }]);
  });

  it('takes only an install ID and show or delete', () => {
    for (const id of ["x' OR '1'='1", '', randomUUID().toUpperCase()])
      expect(() => dataRequest('delete', id)).toThrow('Not an install ID');
    expect(() => dataRequest('drop', randomUUID())).toThrow('Unknown action');
  });
});
