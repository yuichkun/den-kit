// How the usage receiver answers requests (receiver/receive.ts), with a stand-in for D1: what the
// desktop app sends (desktop/analytics.ts) is kept, each event once, with nothing of the request
// but the records; anything else is refused with the answer that makes the app drop it or send
// it again.
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { DesktopAnalytics, postJson, type UsageRecord } from '../../../desktop/analytics.ts';
import { MAX_BODY, receive } from '../../../receiver/receive.ts';
import { DAILY_RECORDS } from '../../../receiver/store.ts';
import { testD1 } from '../../helpers/d1.ts';

const NOW = new Date('2026-12-10T10:23:50.123Z');
const URL = 'https://usage.example.com/events';

function record(fields: Partial<Record<keyof UsageRecord, string>> = {}): UsageRecord {
  return {
    event: 'app_used',
    id: randomUUID(),
    install_id: randomUUID(),
    version: '1.0.0',
    os: 'macOS 26.2',
    arch: 'arm64',
    at: '2026-12-10T10:23:45Z',
    ...fields,
  } as UsageRecord;
}

function post(body: BodyInit, headers: Record<string, string> = {}) {
  return new Request(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
    duplex: 'half',
  } as RequestInit);
}

describe('the usage receiver', () => {
  it("keeps what den-kit's desktop app sends, each event once", async () => {
    const db = testD1();
    // The app's own sending (postJson), to a server that hands each request to the receiver.
    const server = createServer(async (incoming, outgoing) => {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(chunk as Buffer);
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers))
        if (typeof value === 'string') headers.set(name, value);
      const request = new Request(`http://127.0.0.1${incoming.url}`, {
        method: incoming.method,
        headers,
        body: Buffer.concat(chunks),
      });
      const response = await receive(request, { DB: db }, NOW);
      outgoing.writeHead(response.status).end();
    });
    await new Promise<void>(listening => server.listen(0, '127.0.0.1', listening));
    const { port } = server.address() as { port: number };
    try {
      const analytics = new DesktopAnalytics({
        directory: mkdtempSync(join(tmpdir(), 'den-kit-receiver-')),
        usageUrl: URL,
        contact: 'privacy@example.com',
        version: '1.2.0',
        os: 'macOS 26.2',
        arch: 'arm64',
        now: () => new Date('2026-12-10T10:23:45.678Z'),
        post: (_url, body, signal) => postJson(`http://127.0.0.1:${port}/events`, body, signal),
      });
      analytics.choose({ usage: true });
      analytics.record('app_used');
      analytics.record('sound_played');
      await analytics.flush(5_000);
      analytics.dispose();
      const installId = analytics.installId();
      expect(db.rows('SELECT * FROM events ORDER BY event')).toEqual(
        ['app_used', 'sound_played'].map(event => ({
          id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          install_id: installId,
          event,
          version: '1.2.0',
          os: 'macOS 26.2',
          arch: 'arm64',
          at: '2026-12-10T10:23:45Z',
          day: '2026-12-10',
          received_at: '2026-12-10T10:23:50Z',
        })),
      );
      expect(db.rows('SELECT * FROM installs')).toEqual([
        { install_id: installId, first_day: '2026-12-10', last_day: '2026-12-10' },
      ]);
    } finally {
      server.close();
    }
  });

  it('keeps an event sent again only once, and each install’s first and last day', async () => {
    const db = testD1();
    const installId = randomUUID();
    const first = [
      record({ install_id: installId, at: '2026-12-08T09:00:00Z' }),
      record({ install_id: installId, at: '2026-12-09T09:00:00Z' }),
    ];
    const late = record({ install_id: installId, at: '2026-12-01T09:00:00Z' });
    for (const records of [first, first, [late, first[0]]])
      expect((await receive(post(JSON.stringify({ records })), { DB: db }, NOW)).status).toBe(204);
    expect(db.rows('SELECT count(*) AS events FROM events')).toEqual([{ events: 3 }]);
    expect(db.rows('SELECT * FROM installs')).toEqual([
      { install_id: installId, first_day: '2026-12-01', last_day: '2026-12-09' },
    ]);
    expect(db.rows('SELECT * FROM intake')).toEqual([
      { day: '2026-12-10', records: 6, skipped: 0 },
    ]);
  });

  it('counts the records it skips', async () => {
    const db = testD1();
    const records = [
      record(),
      record({ event: 'opened_settings' }),
      record({ at: '2025-01-01T00:00:00Z' }),
    ];
    expect((await receive(post(JSON.stringify({ records })), { DB: db }, NOW)).status).toBe(204);
    expect(db.rows('SELECT count(*) AS events FROM events')).toEqual([{ events: 1 }]);
    expect(db.rows('SELECT * FROM intake')).toEqual([
      { day: '2026-12-10', records: 1, skipped: 2 },
    ]);
    // A batch of skipped records only is counted too.
    const skipped = JSON.stringify({ records: [record({ os: '' })] });
    expect((await receive(post(skipped), { DB: db }, NOW)).status).toBe(204);
    expect(db.rows('SELECT * FROM intake')).toEqual([
      { day: '2026-12-10', records: 1, skipped: 3 },
    ]);
  });

  it('keeps nothing of a request but its records', async () => {
    const db = testD1();
    const body = JSON.stringify({ records: [record()] });
    const response = await receive(
      post(body, {
        'cf-connecting-ip': '203.0.113.7',
        'x-forwarded-for': '203.0.113.7',
        'user-agent': 'den-kit',
        cookie: 'session=1',
      }),
      { DB: db },
      NOW,
    );
    expect(response.status).toBe(204);
    const kept = JSON.stringify(
      ['events', 'installs', 'intake'].map(table => db.rows(`SELECT * FROM ${table}`)),
    );
    for (const header of ['203.0.113.7', 'den-kit', 'session']) expect(kept).not.toContain(header);
  });

  it('answers only POST /events with JSON, and drops what it refuses', async () => {
    const db = testD1();
    const body = JSON.stringify({ records: [record()] });
    const answer = async (request: Request) => (await receive(request, { DB: db }, NOW)).status;
    expect(await answer(new Request('https://usage.example.com/'))).toBe(404);
    const get = await receive(new Request(URL), { DB: db }, NOW);
    expect([get.status, get.headers.get('allow')]).toEqual([405, 'POST']);
    expect(await answer(post(body, { 'content-type': 'text/plain' }))).toBe(415);
    expect(await answer(post(body, { 'content-type': 'application/json; charset=utf-8' }))).toBe(
      204,
    );
    expect(await answer(post('{"records": []}'))).toBe(400);
    expect(db.rows('SELECT count(*) AS events FROM events')).toEqual([{ events: 1 }]);
  });

  it('refuses a body longer than it takes, also when the body does not say its length', async () => {
    const db = testD1();
    const long = JSON.stringify({ records: [record()], pad: 'x'.repeat(MAX_BODY) });
    expect((await receive(post(long), { DB: db }, NOW)).status).toBe(413);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 80; i++) controller.enqueue(new Uint8Array(1024).fill(32));
        controller.close();
      },
    });
    expect((await receive(post(stream), { DB: db }, NOW)).status).toBe(413);
    expect(db.rows('SELECT * FROM intake')).toEqual([]);
  });

  it('takes no more than a day of records, and the app sends the rest again later', async () => {
    const db = testD1();
    db.exec(
      `INSERT INTO intake (day, records, skipped) VALUES ('2026-12-10', ${DAILY_RECORDS}, 0)`,
    );
    const body = JSON.stringify({ records: [record()] });
    expect((await receive(post(body), { DB: db }, NOW)).status).toBe(429);
    expect(db.rows('SELECT count(*) AS events FROM events')).toEqual([{ events: 0 }]);
    const tomorrow = new Date('2026-12-11T00:00:01Z');
    expect((await receive(post(body), { DB: db }, tomorrow)).status).toBe(204);
  });

  it('answers 503 when the database fails, and keeps none of the batch', async () => {
    const db = testD1();
    db.fail = /INSERT INTO installs/;
    const body = JSON.stringify({ records: [record()] });
    expect((await receive(post(body), { DB: db }, NOW)).status).toBe(503);
    expect(db.rows('SELECT count(*) AS events FROM events')).toEqual([{ events: 0 }]);
    expect(db.rows('SELECT * FROM intake')).toEqual([]);
  });
});
