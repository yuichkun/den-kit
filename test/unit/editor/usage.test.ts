// den-kit's count of its own use (src/editor/usage.ts): nothing until the person
// allows usage data, the daily events once a UTC day (also across a restart), and
// the moments a session counts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { countUsage, Usage, USAGE_DAYS_KEY } from '../../../src/editor/usage.ts';
import { KitSession, type StorageLike } from '../../../src/editor/session.ts';
import { AiRequests, type Outcome } from '../../../src/ai/requests.ts';
import type { UsageEvent } from '../../../src/host/analytics.ts';

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: key => void data.delete(key),
  };
}
function recorder() {
  const events: UsageEvent[] = [];
  return { events, record: (event: UsageEvent) => void events.push(event) };
}

describe('counting use', () => {
  it('counts nothing until the person allows usage data, and stops when they turn it off', () => {
    const analytics = recorder();
    const usage = new Usage(analytics, memoryStorage(), () => new Date('2026-12-01T10:00:00Z'));
    usage.count('work_exported');
    usage.allow(false);
    usage.count('ai_requested');
    expect(analytics.events).toEqual([]);
    usage.allow(true);
    usage.count('ai_requested');
    usage.allow(false);
    usage.count('ai_requested');
    expect(analytics.events).toEqual(['app_used', 'ai_requested']);
  });

  it('counts the daily events once a UTC day, also when den-kit starts again that day', () => {
    const analytics = recorder();
    const records = memoryStorage();
    let now = new Date('2026-12-01T23:59:00Z');
    const usage = new Usage(analytics, records, () => now);
    usage.allow(true);
    usage.count('work_edited');
    usage.count('work_edited');
    usage.count('work_exported');
    usage.count('work_exported');
    expect(analytics.events).toEqual(['app_used', 'work_edited', 'work_exported', 'work_exported']);
    expect(JSON.parse(records.data.get(USAGE_DAYS_KEY)!)).toEqual({
      app_used: '2026-12-01',
      work_edited: '2026-12-01',
    });

    const again = recorder();
    const restarted = new Usage(again, records, () => now);
    restarted.allow(true);
    restarted.count('work_edited');
    expect(again.events).toEqual([]);
    expect(restarted.counted('sound_played')).toBe(false);

    now = new Date('2026-12-02T00:00:01Z');
    restarted.count('app_used');
    restarted.count('work_edited');
    expect(again.events).toEqual(['app_used', 'work_edited']);
  });

  it('reads past an unreadable record of the days', () => {
    const analytics = recorder();
    const records = memoryStorage();
    records.setItem(USAGE_DAYS_KEY, '{not json');
    new Usage(analytics, records, () => new Date('2026-12-01T10:00:00Z')).allow(true);
    expect(analytics.events).toEqual(['app_used']);
  });
});

describe('what a session counts', () => {
  let analyser: { fftSize: number; level: number; getFloatTimeDomainData(a: Float32Array): void };
  const session = () => {
    analyser = {
      fftSize: 8,
      level: 0,
      getFloatTimeDomainData(a) {
        a.fill(this.level);
      },
    };
    return new KitSession({
      storage: null,
      createWorker: () =>
        ({
          postMessage() {},
          terminate() {},
          onmessage: null,
          onerror: null,
          onmessageerror: null,
        }) as never,
      engine: {
        setParam() {},
        setAssets() {},
        unload() {},
        running: false,
        outAnalyser: analyser,
      } as never,
    });
  };
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-12-01T10:00:00Z') }));
  afterEach(() => vi.useRealTimers());

  it("counts the person's own changes, not the AI's, and code parts added by anyone", () => {
    const k = session();
    k.restore('bass');
    const analytics = recorder();
    const usage = new Usage(analytics, null);
    usage.allow(true);
    const stop = countUsage(k, usage);
    k.commit([{ op: 'setName', name: 'By the AI' }], { author: { kind: 'ai-llm', take: 'rq1' } });
    expect(analytics.events).toEqual(['app_used']);
    const codePart = {
      op: 'addElement' as const,
      element: { kind: 'code' as const, part: 'reels', rect: { x: 0, y: 0, w: 100, h: 80 } },
    };
    k.commit([codePart], { author: { kind: 'ai-llm', take: 'rq1' } });
    k.commit([{ op: 'setName', name: 'Mine' }]);
    k.commit([codePart]);
    expect(analytics.events).toEqual([
      'app_used',
      'code_part_added',
      'work_edited',
      'code_part_added',
    ]);
    // Each code part counts, also when one change adds several, as an AI request can.
    k.commit([codePart, { op: 'setName', name: 'Two more' }, codePart], {
      author: { kind: 'ai-llm', take: 'rq2' },
    });
    expect(analytics.events.slice(4)).toEqual(['code_part_added', 'code_part_added']);
    stop();
    k.commit([codePart]);
    expect(analytics.events).toHaveLength(6);
  });

  it("counts the person's undo and redo, also of the AI's changes, as their own changes", () => {
    const k = session();
    k.restore('bass');
    const analytics = recorder();
    const usage = new Usage(analytics, null);
    usage.allow(true);
    const stop = countUsage(k, usage);
    expect(k.undo()).toBeNull(); // nothing to undo
    k.commit([{ op: 'setName', name: 'By the AI' }], { author: { kind: 'ai-llm', take: 'rq1' } });
    expect(analytics.events).toEqual(['app_used']);
    expect(k.undo()).not.toBeNull();
    expect(analytics.events).toEqual(['app_used', 'work_edited']);
    vi.setSystemTime(new Date('2026-12-02T10:00:00Z'));
    expect(k.redo()).not.toBeNull();
    expect(analytics.events).toEqual(['app_used', 'work_edited', 'work_edited']);
    stop();
    vi.setSystemTime(new Date('2026-12-03T10:00:00Z'));
    expect(k.undo()).not.toBeNull();
    expect(analytics.events).toHaveLength(3);
  });

  it('counts each request the AI takes, not one it could not take', () => {
    const k = session();
    k.restore('bass');
    let status: Outcome['status'] = 'thinking';
    k.llm = {
      run: (text: string): Outcome => ({ id: 'rq', text, status, route: 'llm', ms: 0 }),
    } as never;
    k.requests = new AiRequests(k);
    const analytics = recorder();
    const usage = new Usage(analytics, null);
    usage.allow(true);
    countUsage(k, usage);
    k.requests.run('add reverb');
    k.requests.run('   ');
    status = 'failed';
    k.requests.run('add delay');
    status = 'thinking';
    k.requests.run('louder');
    expect(analytics.events).toEqual(['app_used', 'ai_requested', 'ai_requested']);
  });

  it('counts the first sound of the day while audio runs, and only sound that comes out', () => {
    const k = session();
    const analytics = recorder();
    const usage = new Usage(analytics, null);
    usage.allow(true);
    countUsage(k, usage, 250);
    analyser.level = 0.5;
    vi.advanceTimersByTime(1000); // audio is off
    k.engineState.value = 'running';
    analyser.level = 0.0001; // below -60 dBFS
    vi.advanceTimersByTime(1000);
    expect(analytics.events).toEqual(['app_used']);
    analyser.level = -0.01;
    vi.advanceTimersByTime(250);
    vi.advanceTimersByTime(5000);
    expect(analytics.events).toEqual(['app_used', 'sound_played']);
    vi.setSystemTime(new Date('2026-12-02T00:00:00Z'));
    vi.advanceTimersByTime(250);
    expect(analytics.events).toEqual(['app_used', 'sound_played', 'sound_played']);
  });
});
