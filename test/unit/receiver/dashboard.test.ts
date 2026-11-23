// The page of counts (receiver/dashboard.ts), with a stand-in for D1 and tokens signed like Cloudflare
// Access's: only for the people Access lets in, and only once Access is set up; the counts the
// daily run made from what the app sent, shown as they are; text from the records escaped; and a
// page with no counts yet.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vite-plus/test';
import type { UsageRecord } from '../../../desktop/analytics.ts';
import type { UsageEvent } from '../../../src/host/analytics.ts';
import { dashboard, type DashboardEnv } from '../../../receiver/dashboard.ts';
import worker from '../../../receiver/worker.ts';
import { count, keep } from '../../../receiver/store.ts';
import { testD1, type TestD1 } from '../../helpers/d1.ts';
import { ACCESS, testAccess, withToken, type TestAccess } from '../../helpers/access.ts';

// The page on 2026-12-10 shows the counts up to 2026-12-09; 2026-11-30 starts the last full week.
const NOW = new Date('2026-12-10T08:00:00Z');

const env = (db: TestD1): DashboardEnv => ({
  DB: db,
  TEAM_DOMAIN: ACCESS.team,
  POLICY_AUD: ACCESS.aud,
});

async function open(db: TestD1, access: TestAccess) {
  const response = await dashboard(withToken(await access.token()), env(db), NOW, access.keys);
  return { response, html: await response.text() };
}

const text = (html: string) =>
  html.replace(/<[^>]+>/g, '').replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

/** The figure with this caption. */
function figure(html: string, caption: string): string {
  const start = html.indexOf(`<figcaption>${caption}</figcaption>`);
  if (start < 0) throw new Error(`No figure “${caption}”`);
  return html.slice(start, html.indexOf('</figure>', start));
}

/** The text of each cell of each row of the tables in some HTML. */
const rows = (html: string) =>
  [...html.matchAll(/<tr>(.*?)<\/tr>/g)].map(([, row]) =>
    [...row.matchAll(/<t[hd]>(.*?)<\/t[hd]>/g)].map(([, cell]) => text(cell)),
  );

/** A table's row for one day or week: its cells after the first. */
const row = (html: string, day: string) =>
  rows(html)
    .find(r => r[0] === day)
    ?.slice(1);

const tiles = (html: string) =>
  [
    ...html.matchAll(
      /<div class="tile"><div class="label">(.*?)<\/div><div class="value">(.*?)<\/div><div class="note">(.*?)<\/div><\/div>/g,
    ),
  ].map(([, label, value, note]) => [label, value, note].map(text).join(' | '));

/** The name and figure of each bar or meter in some HTML. */
const items = (html: string) =>
  [
    ...html.matchAll(/<li><span class="label">(.*?)<\/span>.*?<span class="figure">(.*?)<\/span>/g),
  ].map(([, name, value]) => `${text(name)}: ${text(value)}`);

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

describe('the page of counts', () => {
  it('is there only once Access is set up, and only for a token Access signed for it', async () => {
    const db = testD1();
    db.fail = /./;
    const access = await testAccess(NOW);
    const token = await access.token();
    for (const unset of [{}, { TEAM_DOMAIN: ACCESS.team }, { POLICY_AUD: ACCESS.aud }])
      expect(
        (await dashboard(withToken(token), { DB: db, ...unset }, NOW, access.keys)).status,
      ).toBe(404);
    const empty = { DB: db, TEAM_DOMAIN: '', POLICY_AUD: '' };
    expect((await dashboard(withToken(token), empty, NOW, access.keys)).status).toBe(404);
    expect(access.asked).toEqual([]);

    const posted = await dashboard(withToken(token, { method: 'POST' }), env(db), NOW, access.keys);
    expect(posted.status).toBe(405);
    expect(posted.headers.get('allow')).toBe('GET');
    expect((await dashboard(withToken(null), env(db), NOW, access.keys)).status).toBe(403);
    const another = await access.token({ aud: ['another-application'] });
    expect((await dashboard(withToken(another), env(db), NOW, access.keys)).status).toBe(403);
    const expired = await access.token({ exp: NOW.getTime() / 1000 - 1 });
    expect((await dashboard(withToken(expired), env(db), NOW, access.keys)).status).toBe(403);
  });

  it('answers 503 when the keys or the counts cannot be read', async () => {
    const db = testD1();
    const access = await testAccess(NOW);
    const failing = async () => {
      throw new Error('Cloudflare Access keys: 500');
    };
    const token = await access.token();
    expect((await dashboard(withToken(token), env(db), NOW, failing)).status).toBe(503);
    db.fail = /FROM cohorts/;
    expect((await dashboard(withToken(token), env(db), NOW, access.keys)).status).toBe(503);
  });

  it('is answered at / of the Worker, and the app’s events at /events', async () => {
    const db = testD1();
    const page = await worker.fetch(new Request('https://stats.den-kit.com/'), env(db));
    expect(page.status).toBe(403);
    const events = await worker.fetch(new Request('https://stats.den-kit.com/events'), env(db));
    expect(events.status).toBe(405);
    expect(events.headers.get('allow')).toBe('POST');
  });

  it('shows the counts the daily run made from what the app sent', async () => {
    const db = testD1();
    const [a, b, c, d] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    // 2026-11-02, 2026-11-23 and 2026-11-30 are Mondays.
    const records = [
      // A: new on 2026-11-02, back on day 1, 7 and 30, and on 2026-12-09.
      event(a, 'app_used', '2026-11-02'),
      event(a, 'sound_played', '2026-11-02'),
      event(a, 'app_used', '2026-11-03'),
      event(a, 'work_edited', '2026-11-03'),
      event(a, 'app_used', '2026-11-09'),
      event(a, 'app_used', '2026-12-02'),
      event(a, 'app_used', '2026-12-09'),
      // B: new on 2026-11-04, back on day 1 only.
      event(b, 'app_used', '2026-11-04', { os: 'macOS 15.7.2' }),
      event(b, 'app_used', '2026-11-05', { os: 'macOS 15.7.2' }),
      event(b, 'ai_requested', '2026-11-05', { os: 'macOS 15.7.2' }),
      // C: new on 2026-12-01 on 1.1.0, back on day 1, and exports on 2026-12-09.
      event(c, 'app_used', '2026-12-01', { version: '1.1.0' }),
      event(c, 'app_used', '2026-12-02', { version: '1.1.0' }),
      event(c, 'app_used', '2026-12-09', { version: '1.1.0' }),
      event(c, 'work_exported', '2026-12-09', { version: '1.1.0' }),
      // D: new on 2026-11-25, back on day 7.
      event(d, 'app_used', '2026-11-25'),
      event(d, 'app_used', '2026-12-02'),
    ];
    expect(await keep(db, { records, skipped: 2 }, new Date('2026-12-10T07:00:00Z'))).toBe(true);
    await count(db, '2026-12-10');
    const access = await testAccess(NOW);
    const { response, html } = await open(db, access);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(html).not.toMatch(/<script/i);
    expect(text(html)).toContain('up to Dec 9.');

    expect(tiles(html)).toEqual([
      'Active installs | 2 | on Dec 9',
      'Active installs | 3 | week of Nov 30',
      'New installs | 1 | week of Nov 30',
      'Back on day 7 | 100% | of new installs in the week of Nov 23',
    ]);

    const daily = figure(html, 'Active installs each day');
    expect(rows(daily)[1]).toEqual(['2026-12-09', '2']);
    expect(row(daily, '2026-12-02')).toEqual(['3']);
    expect(row(daily, '2026-11-10')).toEqual(['0']);
    expect(rows(daily).at(-1)).toEqual(['2026-11-02', '1']);
    const weekly = figure(html, 'Active installs each week');
    expect(rows(weekly).slice(0, 3)).toEqual([
      ['Week of', 'Active installs'],
      ['2026-11-30', '3'],
      ['2026-11-23', '1'],
    ]);
    expect(rows(weekly).at(-1)).toEqual(['2026-11-02', '2']);

    // Lines for the values with the most installs on the last day, newest first, and the rest.
    const versions = figure(html, 'Share of active installs on each version, each day');
    expect(rows(versions)[0]).toEqual(['Day', '1.1.0', '1.0.0']);
    expect(row(versions, '2026-12-09')).toEqual(['50%', '50%']);
    expect(row(versions, '2026-12-02')).toEqual(['33%', '67%']);
    expect(row(versions, '2026-11-10')).toEqual(['', '']);
    const systems = figure(html, 'Active installs on each operating system, each week');
    expect(rows(systems)[0]).toEqual(['Week of', 'macOS 26.2', 'Other']);
    expect(row(systems, '2026-11-30')).toEqual(['3', '0']);
    expect(row(systems, '2026-11-02')).toEqual(['1', '1']);

    const retention = figure(
      html,
      'New installs each week, and the share that sent an event on day 1, 7 and 30 after their first',
    );
    expect(rows(retention).slice(0, 6)).toEqual([
      ['Week of', 'New installs', 'Day 1', 'Day 7', 'Day 30'],
      ['2026-11-30', '1', '100% (1)', '—', '—'],
      ['2026-11-23', '1', '0% (0)', '100% (1)', '—'],
      ['2026-11-16', '0', '—', '—', '—'],
      ['2026-11-09', '0', '—', '—', '—'],
      ['2026-11-02', '2', '100% (2)', '50% (1)', '50% (1)'],
    ]);
    expect(rows(retention)).toHaveLength(13);

    const firstWeek = figure(
      html,
      'Of 3 installs new from Nov 2 to Nov 29, the share that did each in their first 7 days',
    );
    expect(items(firstWeek)).toEqual([
      'Opened den-kit: 100% · 3',
      'Played a sound: 33% · 1',
      'Changed a work: 33% · 1',
      'Asked the AI: 33% · 1',
      'Exported a work: 0% · 0',
    ]);

    expect(row(figure(html, 'AI requests each day'), '2026-11-05')).toEqual(['1']);
    expect(row(figure(html, 'Exports each day'), '2026-12-09')).toEqual(['1']);
    expect(row(figure(html, 'Code parts added each day'), '2026-12-09')).toEqual(['0']);

    const received = items(
      figure(html, 'Records received each day, of the 100,000 a day the receiver takes'),
    );
    expect(received).toHaveLength(7);
    expect(received[0]).toBe('2026-12-10 (today): 18 (0%) · 2 skipped');
    expect(received[1]).toBe('2026-12-09: 0 (0%) · 0 skipped');
  });

  it('counts in Other the installs on the values it does not draw, also when an install updates', async () => {
    const db = testD1();
    const [x, y, z, w] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const records = [
      // On 2026-12-08, X updates from 1.0 to 2.0, Y is on 2.0 and Z on 0.9.
      event(x, 'app_used', '2026-12-08', { version: '1.0' }),
      event(x, 'sound_played', '2026-12-08', { version: '2.0' }),
      event(y, 'app_used', '2026-12-08', { version: '2.0' }),
      event(z, 'app_used', '2026-12-08', { version: '0.9' }),
      // On the last day, only 2.0 and 1.0.
      event(x, 'app_used', '2026-12-09', { version: '2.0' }),
      event(w, 'app_used', '2026-12-09', { version: '1.0' }),
    ];
    await keep(db, { records, skipped: 0 }, new Date('2026-12-10T07:00:00Z'));
    await count(db, '2026-12-10');
    const { html } = await open(db, await testAccess(NOW));
    const versions = figure(html, 'Share of active installs on each version, each day');
    expect(rows(versions)[0]).toEqual(['Day', '2.0', '1.0', 'Other']);
    expect(row(versions, '2026-12-08')).toEqual(['67%', '33%', '33%']);
    expect(row(versions, '2026-12-09')).toEqual(['50%', '50%', '0%']);
  });

  it('escapes the text the records bring', async () => {
    const db = testD1();
    const hostile = '<img src=x onerror=alert(1)>';
    db.exec(`
      INSERT INTO active VALUES ('day', '2026-12-09', 'all', '', 2);
      INSERT INTO active VALUES ('day', '2026-12-09', 'version', '${hostile}', 1);
      INSERT INTO active VALUES ('day', '2026-12-09', 'version', '"1.0" & ''2.0''', 1);
    `);
    const { html } = await open(db, await testAccess(NOW));
    expect(html).not.toContain('<img');
    expect(html).not.toContain('"1.0"');
    const versions = figure(html, 'Share of active installs on each version, each day');
    expect(rows(versions)[0].slice(1).sort()).toEqual([hostile, '"1.0" & \'2.0\''].sort());
    expect(text(versions)).toContain(`${hostile} 50%`);
  });

  it('says where there are no counts yet', async () => {
    const { response, html } = await open(testD1(), await testAccess(NOW));
    expect(response.status).toBe(200);
    expect(tiles(html).map(t => t.split(' | ')[1])).toEqual(['—', '—', '—', '—']);
    for (const caption of [
      'Active installs each day',
      'Active installs each week',
      'Share of active installs on each version, each day',
      'Active installs on each operating system, each week',
      'AI requests each day',
      'Of 0 installs new from Nov 2 to Nov 29, the share that did each in their first 7 days',
    ])
      expect(text(figure(html, caption))).toContain('No counts yet.');
    expect(
      items(figure(html, 'Records received each day, of the 100,000 a day the receiver takes'))[0],
    ).toBe('2026-12-10 (today): 0 (0%) · 0 skipped');
  });
});
