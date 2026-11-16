// The desktop app's Analytics in the main process (desktop/analytics.ts): usage data
// only with the build's receiver and contact and the person's yes, the answers and the
// install's ID kept in the app's data folder, and the waiting events sent in batches,
// tried again after a failure and dropped when the person turns usage data off.
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import {
  DesktopAnalytics,
  MAX_WAITING,
  osName,
  usageConfig,
  type DesktopAnalyticsOptions,
  type UsageRecord,
} from '../../../desktop/analytics.ts';

const URL = 'https://usage.example.com/v1/usage';
const CONTACT = 'privacy@example.com';

function setup(
  options: Partial<DesktopAnalyticsOptions> = {},
  directory = mkdtempSync(join(tmpdir(), 'den-kit-analytics-')),
) {
  const scheduled: Array<{ ms: number; run: () => void; cleared: boolean }> = [];
  const posts: Array<{ url: string; records: UsageRecord[] }> = [];
  const replies: Array<number | Error> = [];
  const analytics = new DesktopAnalytics({
    directory,
    usageUrl: URL,
    contact: CONTACT,
    version: '1.0.0',
    os: 'macOS 26.2',
    arch: 'arm64',
    now: () => new Date('2026-12-01T10:23:45.678Z'),
    post: async (url, body) => {
      posts.push({ url, records: JSON.parse(body).records });
      const reply = replies.shift() ?? 202;
      if (reply instanceof Error) throw reply;
      return reply;
    },
    timers: {
      after: (ms, run) => {
        const timer = { ms, run, cleared: false };
        scheduled.push(timer);
        return timer as never;
      },
      clear: timer => {
        (timer as unknown as { cleared: boolean }).cleared = true;
      },
    },
    ...options,
  });
  /** Runs the next timer that is still set; its wait. */
  const tick = async () => {
    const timer = scheduled.find(t => !t.cleared);
    if (!timer) return null;
    timer.cleared = true;
    timer.run();
    await new Promise(r => setTimeout(r, 0));
    return timer.ms;
  };
  const kept = () => JSON.parse(readFileSync(join(directory, 'analytics.json'), 'utf8'));
  return { analytics, directory, scheduled, posts, replies, tick, kept };
}

describe('desktop analytics', () => {
  it('offers usage data only with an https receiver and a contact address', () => {
    expect(usageConfig(URL, CONTACT)).toEqual({ usageUrl: URL, contact: CONTACT });
    for (const [url, contact] of [
      ['http://usage.example.com/', CONTACT],
      ['not a url', CONTACT],
      [URL, null],
      [URL, 'not an address'],
      [undefined, undefined],
    ])
      expect(usageConfig(url, contact), `${url} ${contact}`).toBeNull();
    const none = setup({ usageUrl: null }).analytics;
    expect(none.kinds).toEqual([]);
    expect(none.runtime()).toBeNull();
    expect(setup().analytics.runtime()).toEqual({ kinds: ['usage'], contact: CONTACT });
  });

  it('keeps the answers and makes the install ID on the first yes, and keeps both across launches', () => {
    const { analytics, directory, kept } = setup();
    expect(analytics.choice()).toEqual({});
    expect(analytics.installId()).toBeNull();
    analytics.choose({ usage: false });
    expect(analytics.installId()).toBeNull();
    analytics.choose({ usage: true });
    const id = analytics.installId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    analytics.choose({ usage: false });
    expect(analytics.installId()).toBe(id);
    expect(kept()).toEqual({ choice: { usage: false }, installId: id, waiting: [] });
    expect(statSync(join(directory, 'analytics.json')).mode & 0o777).toBe(0o600);
    const again = setup({}, directory).analytics;
    expect(again.choice()).toEqual({ usage: false });
    expect(again.installId()).toBe(id);
  });

  it('refuses answers for kinds this build does not offer, and events it does not know', () => {
    const { analytics } = setup();
    for (const choice of [null, [], 'yes', { usage: 'yes' }, { crashes: true }, { other: true }])
      expect(() => analytics.choose(choice), JSON.stringify(choice)).toThrow('Invalid choice.');
    expect(() => analytics.record('opened_settings')).toThrow('Invalid event.');
    expect(analytics.choice()).toEqual({});
  });

  it('sends nothing before the person allows usage data', async () => {
    const { analytics, posts, scheduled } = setup();
    analytics.record('app_used');
    analytics.choose({ usage: false });
    analytics.record('app_used');
    expect(scheduled).toEqual([]);
    expect(posts).toEqual([]);
  });

  it('sends the waiting events together, with only the agreed fields', async () => {
    const { analytics, posts, tick, kept } = setup();
    analytics.choose({ usage: true });
    analytics.record('app_used');
    analytics.record('work_exported');
    expect(kept().waiting).toHaveLength(2);
    expect(await tick()).toBe(5000);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe(URL);
    const [first, second] = posts[0]!.records;
    expect(Object.keys(first!).sort()).toEqual(
      ['arch', 'at', 'event', 'id', 'install_id', 'os', 'version'].sort(),
    );
    expect(first).toMatchObject({
      event: 'app_used',
      install_id: analytics.installId(),
      version: '1.0.0',
      os: 'macOS 26.2',
      arch: 'arm64',
      at: '2026-12-01T10:23:45Z',
    });
    expect(second!.event).toBe('work_exported');
    expect(first!.id).not.toBe(second!.id);
    expect(kept().waiting).toEqual([]);
  });

  it('tries again later after a failure, with growing waits, and sends the same events', async () => {
    const { analytics, posts, replies, tick } = setup();
    analytics.choose({ usage: true });
    analytics.record('ai_requested');
    replies.push(new Error('offline'), 503, 429);
    expect(await tick()).toBe(5000);
    expect(await tick()).toBe(60_000);
    expect(await tick()).toBe(300_000);
    expect(await tick()).toBe(1_800_000);
    expect(posts.map(p => p.records[0]!.id)).toEqual(Array(4).fill(posts[0]!.records[0]!.id));
    expect(await tick()).toBeNull();
  });

  it('drops a batch the receiver refuses, since it never becomes valid', async () => {
    const { analytics, replies, tick, kept } = setup();
    analytics.choose({ usage: true });
    analytics.record('ai_requested');
    replies.push(400);
    await tick();
    expect(kept().waiting).toEqual([]);
    expect(await tick()).toBeNull();
  });

  it('sends what waited since the last launch, and drops it all when usage data is turned off', async () => {
    const first = setup();
    first.analytics.choose({ usage: true });
    first.analytics.record('app_used');
    first.analytics.dispose();
    const next = setup({}, first.directory);
    next.analytics.start();
    expect(await next.tick()).toBe(5000);
    expect(next.posts[0]!.records.map(r => r.event)).toEqual(['app_used']);

    next.analytics.record('code_part_added');
    next.analytics.choose({ usage: false });
    expect(next.kept().waiting).toEqual([]);
    expect(await next.tick()).toBeNull();
    expect(next.posts).toHaveLength(1);
  });

  it('does not try again when usage data is turned off while a batch is on its way', async () => {
    let reply!: (status: number) => void;
    const { analytics, tick } = setup({ post: () => new Promise<number>(r => (reply = r)) });
    analytics.choose({ usage: true });
    analytics.record('ai_requested');
    await tick();
    analytics.choose({ usage: false });
    reply(503);
    await new Promise(r => setTimeout(r, 0));
    expect(await tick()).toBeNull();
  });

  it('keeps at most MAX_WAITING events, dropping the oldest', () => {
    const { analytics, kept } = setup();
    analytics.choose({ usage: true });
    for (let i = 0; i < MAX_WAITING + 5; i++) analytics.record('ai_requested');
    expect(kept().waiting).toHaveLength(MAX_WAITING);
  });

  it('reads past a damaged file: nothing answered, nothing sent', () => {
    const directory = mkdtempSync(join(tmpdir(), 'den-kit-analytics-'));
    writeFileSync(join(directory, 'analytics.json'), '{"choice":');
    const { analytics } = setup({}, directory);
    expect(analytics.choice()).toEqual({});
    expect(analytics.installId()).toBeNull();
  });

  it('gives up on the last try before quitting after its time', async () => {
    const { analytics } = setup({ post: () => new Promise<number>(() => {}) });
    analytics.choose({ usage: true });
    analytics.record('work_exported');
    const started = Date.now();
    await analytics.flush(50);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('names the OS as people know it', () => {
    expect(osName('darwin', '26.2.0')).toBe('macOS 26.2');
    expect(osName('win32', '10.0.26100')).toBe('Windows 10.0.26100');
    expect(osName('linux', '6.8.0')).toBe('Linux 6.8');
  });
});
