// What the usage receiver accepts (receiver/records.ts): the body den-kit's desktop app sends, with
// the records of another shape, or from outside the days it still counts, skipped, and any other
// body refused.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vite-plus/test';
import { BATCH, type UsageRecord } from '../../../desktop/analytics.ts';
import { MAX_RECORDS, parse } from '../../../receiver/records.ts';

const TODAY = '2026-12-10';

function record(fields: Partial<Record<keyof UsageRecord, unknown>> = {}): UsageRecord {
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
const body = (records: unknown[]) => JSON.stringify({ records });

describe('the usage receiver', () => {
  it('takes a full batch of what the app sends', () => {
    expect(MAX_RECORDS).toBe(BATCH);
    const records = Array.from({ length: MAX_RECORDS }, (_, i) =>
      record({
        event: ['sound_played', 'work_edited', 'ai_requested'][i % 3],
        version: '1.2.0-beta.1',
        os: i % 2 ? 'Windows 10.0.26100' : 'Linux 6.8.0-49-generic',
        arch: i % 2 ? 'x64' : 'arm64',
      }),
    );
    expect(parse(body(records), TODAY)).toEqual({ records, skipped: 0 });
  });

  it('refuses a body the app does not send', () => {
    for (const refused of [
      '{records',
      '[]',
      'null',
      '{"records": {}}',
      body([]),
      JSON.stringify({ records: [record()], more: true }),
      body(Array.from({ length: MAX_RECORDS + 1 }, () => record())),
    ])
      expect(parse(refused, TODAY), refused.slice(0, 40)).toBeNull();
  });

  it('skips the records of another shape, and takes the rest', () => {
    const kept = record();
    const { install_id: _, ...missing } = record();
    const skipped = [
      record({ event: 'opened_settings' }),
      record({ id: randomUUID().toUpperCase() }),
      record({ install_id: 'not-an-id' }),
      record({ version: 1 }),
      record({ version: 'latest' }),
      record({ os: 'macOS' }),
      record({ os: `macOS ${'1'.repeat(48)}` }),
      record({ arch: 'ARM64' }),
      record({ at: '2026-12-10T10:23:45.678Z' }),
      record({ at: '2026-12-10 10:23:45' }),
      record({ at: '2026-02-30T10:23:45Z' }),
      { ...record(), extra: 'x' },
      missing,
      'app_used',
      null,
    ];
    expect(parse(body([...skipped, kept]), TODAY)).toEqual({
      records: [kept],
      skipped: skipped.length,
    });
  });

  it('counts events from the last day the daily run counts to tomorrow', () => {
    const counted = [
      record({ at: '2026-10-27T00:00:00Z' }),
      record({ at: '2026-12-11T23:59:59Z' }),
    ];
    const outside = [
      record({ at: '2026-10-26T23:59:59Z' }),
      record({ at: '2026-12-12T00:00:00Z' }),
    ];
    expect(parse(body([...outside, ...counted]), TODAY)).toEqual({ records: counted, skipped: 2 });
  });
});
