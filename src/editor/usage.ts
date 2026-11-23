// den-kit's count of its own use (src/host/analytics.ts, USAGE_EVENTS), handed to
// the host's Analytics only while the person allows usage data. app_used,
// sound_played and work_edited count once a day, the first time that day (UTC):
// the day each was last counted is one of the editor's records, so starting
// again the same day does not count it again. countUsage watches a session for
// the moments that count.
import type { Analytics, UsageEvent } from '../host/analytics.ts';
import { RECORD_PREFIX, type KitSession, type StorageLike } from './session.ts';

const DAILY: ReadonlySet<UsageEvent> = new Set(['app_used', 'sound_played', 'work_edited']);
/** The day (UTC, 2026-12-01) each daily event was last counted. */
export const USAGE_DAYS_KEY = `${RECORD_PREFIX}usage-days`;
/** The peak level from which the output counts as sound (-60 dBFS). */
const SOUND_PEAK = 0.001;

const utcDay = (at: Date) => at.toISOString().slice(0, 10);

function readDays(raw: string | null | undefined): Partial<Record<UsageEvent, string>> {
  try {
    const value: unknown = JSON.parse(raw ?? '{}');
    if (!value || typeof value !== 'object') return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([event, day]) => DAILY.has(event as UsageEvent) && typeof day === 'string',
      ),
    );
  } catch {
    return {};
  }
}

export class Usage {
  private readonly analytics: Pick<Analytics, 'record'>;
  private readonly records: StorageLike | null;
  private readonly now: () => Date;
  private allowed = false;
  private days: Partial<Record<UsageEvent, string>>;

  constructor(
    analytics: Pick<Analytics, 'record'>,
    records: StorageLike | null,
    now: () => Date = () => new Date(),
  ) {
    this.analytics = analytics;
    this.records = records;
    this.now = now;
    this.days = readDays(records?.getItem(USAGE_DAYS_KEY));
  }

  /** The person's answer about usage data: counting starts, with today's use, or stops. */
  allow(allowed: boolean) {
    this.allowed = allowed;
    this.count('app_used');
  }

  /** Nothing more to count for a daily event today (or nothing is counted at all). */
  counted(event: UsageEvent): boolean {
    return !this.allowed || this.days[event] === utcDay(this.now());
  }

  count(event: UsageEvent) {
    if (!this.allowed) return;
    if (DAILY.has(event)) {
      const today = utcDay(this.now());
      if (this.days[event] === today) return;
      this.days = { ...this.days, [event]: today };
      this.records?.setItem(USAGE_DAYS_KEY, JSON.stringify(this.days));
    }
    this.analytics.record(event);
  }
}

/**
 * Count what happens in the session: the person's own changes to the work (not the AI's), with
 * undo and redo, which only the person does, code parts added to the plugin (by anyone), requests
 * the AI took, and the first sound each day, which is checked on the output every `everyMs` while
 * audio runs. Returns a function that stops counting.
 */
export function countUsage(session: KitSession, usage: Usage, everyMs = 250): () => void {
  const stops: Array<() => unknown> = [
    session.onTransaction(tx => {
      if (tx.author.kind === 'human') usage.count('work_edited');
      for (const op of tx.ops)
        if (op.op === 'addElement' && op.element.kind === 'code') usage.count('code_part_added');
    }),
    session.onHistory(() => usage.count('work_edited')),
  ];
  if (session.requests) stops.push(session.requests.onRun(() => usage.count('ai_requested')));
  let samples = new Float32Array(0);
  const listen = setInterval(() => {
    const output = session.engine.outAnalyser;
    if (usage.counted('sound_played') || session.engineState.value !== 'running' || !output) return;
    if (samples.length !== output.fftSize) samples = new Float32Array(output.fftSize);
    output.getFloatTimeDomainData(samples);
    if (samples.some(x => Math.abs(x) >= SOUND_PEAK)) usage.count('sound_played');
  }, everyMs);
  stops.push(() => clearInterval(listen));
  return () => {
    for (const stop of stops) stop();
  };
}
