// The desktop app's Analytics (src/host/analytics.ts), in the main process. The
// person's answers, the install's random ID and the usage events waiting to be
// sent are kept in the app's data folder (analytics.json, written whole to a
// temporary file and renamed). Usage data is offered only when the build names
// where events go and where a person asks about their data (resources/operator.json,
// set for releases); a build from source offers nothing.
//
// An event goes out a few seconds after it happens, together with any others
// waiting, as one POST of {"records": [...]} with no cookies and no redirects.
// Events that could not be sent wait, at most MAX_WAITING of them (past that, the
// oldest are dropped), and are tried again with growing delays and at the next
// launch. A batch the receiver refuses (4xx other than 408 and 429) is dropped,
// since it never becomes valid. Turning usage data off drops every waiting event.
// Each event has its own id, so the receiver can drop one that a lost response
// made den-kit send twice.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DATA_KINDS,
  USAGE_EVENTS,
  type DataChoice,
  type DataKind,
  type UsageEvent,
} from '../src/host/analytics.ts';

/** One usage event as sent: nothing else is (docs/usage.md, Help improve den-kit). */
export interface UsageRecord {
  event: UsageEvent;
  id: string;
  install_id: string;
  version: string;
  os: string;
  arch: string;
  at: string;
}
interface Kept {
  choice: DataChoice;
  installId: string | null;
  waiting: UsageRecord[];
}
type Timer = ReturnType<typeof setTimeout>;
interface Timers {
  after(ms: number, run: () => void): Timer;
  clear(timer: Timer): void;
}
const SYSTEM_TIMERS: Timers = {
  after: (ms, run) => setTimeout(run, ms),
  clear: timer => clearTimeout(timer),
};

export const MAX_WAITING = 1000;
export const BATCH = 100;
/** How long an event waits for others to go with it. */
const SEND_AFTER_MS = 5_000;
/** The waits before each try again after a failure; the last repeats. */
const RETRY_MS = [60_000, 5 * 60_000, 30 * 60_000, 60 * 60_000];
const SEND_TIMEOUT_MS = 30_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface DesktopAnalyticsOptions {
  /** The app's data folder. */
  directory: string;
  /** Where usage events go (https); null when this build sends no usage data. */
  usageUrl: string | null;
  /** The email address where a person asks to see or delete their usage data; usage data needs one. */
  contact: string | null;
  /** The app's version, the OS (macOS 26.2) and the CPU type (arm64), sent with each event. */
  version: string;
  os: string;
  arch: string;
  /** Sends one batch and resolves with the response's status; rejects when no response came. */
  post?: (url: string, body: string, signal: AbortSignal) => Promise<number>;
  now?: () => Date;
  timers?: Timers;
}

/** The OS as sent with each event, such as macOS 26.2 or Windows 10.0.26100. */
export function osName(platform: string, version: string): string {
  const name =
    { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[platform as 'darwin'] ?? platform;
  return `${name} ${version.replace(/\.0$/, '')}`;
}

/** Usage events go to an https address, and a person must have somewhere to ask about their data. */
export function usageConfig(
  usageUrl: unknown,
  contact: unknown,
): { usageUrl: string; contact: string } | null {
  if (typeof usageUrl !== 'string' || typeof contact !== 'string') return null;
  try {
    if (new URL(usageUrl).protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ? { usageUrl, contact } : null;
}

/** POST with Node's fetch: no cookies, no redirects followed, and only these headers of den-kit's. */
export async function postJson(url: string, body: string, signal: AbortSignal): Promise<number> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'den-kit' },
    body,
    redirect: 'error',
    signal,
  });
  await response.body?.cancel();
  return response.status;
}

function isRecord(value: unknown): value is UsageRecord {
  const r = value as UsageRecord;
  return (
    !!r &&
    typeof r === 'object' &&
    (USAGE_EVENTS as readonly string[]).includes(r.event) &&
    ['id', 'install_id', 'version', 'os', 'arch', 'at'].every(
      key => typeof r[key as keyof UsageRecord] === 'string',
    )
  );
}

function read(file: string): Kept {
  try {
    const kept = JSON.parse(readFileSync(file, 'utf8')) as Partial<Kept>;
    const choice: DataChoice = {};
    for (const kind of DATA_KINDS)
      if (typeof kept.choice?.[kind] === 'boolean') choice[kind] = kept.choice[kind];
    return {
      choice,
      installId:
        typeof kept.installId === 'string' && UUID.test(kept.installId) ? kept.installId : null,
      waiting: Array.isArray(kept.waiting) ? kept.waiting.filter(isRecord).slice(-MAX_WAITING) : [],
    };
  } catch {
    return { choice: {}, installId: null, waiting: [] };
  }
}

export class DesktopAnalytics {
  /** The kinds this build can send, in the order den-kit asks about them. */
  readonly kinds: DataKind[];
  readonly contact: string | null;
  private readonly options: DesktopAnalyticsOptions;
  private readonly usageUrl: string | null;
  private readonly file: string;
  private readonly post: NonNullable<DesktopAnalyticsOptions['post']>;
  private readonly now: () => Date;
  private readonly timers: Timers;
  private kept: Kept;
  private timer: Timer | null = null;
  private sending: Promise<void> | null = null;
  private failures = 0;
  private disposed = false;

  constructor(options: DesktopAnalyticsOptions) {
    this.options = options;
    const usage = usageConfig(options.usageUrl, options.contact);
    this.usageUrl = usage?.usageUrl ?? null;
    this.contact = usage?.contact ?? null;
    this.kinds = DATA_KINDS.filter(kind => kind === 'usage' && !!usage);
    this.file = join(options.directory, 'analytics.json');
    this.post = options.post ?? postJson;
    this.now = options.now ?? (() => new Date());
    this.timers = options.timers ?? SYSTEM_TIMERS;
    this.kept = read(this.file);
  }

  private get sendsUsage() {
    return !!this.usageUrl && this.kept.choice.usage === true && !!this.kept.installId;
  }

  /** What the page reads at start: the kinds and the contact; null when this build sends nothing. */
  runtime(): { kinds: DataKind[]; contact: string | null } | null {
    return this.kinds.length ? { kinds: [...this.kinds], contact: this.contact } : null;
  }

  choice(): DataChoice {
    return { ...this.kept.choice };
  }

  installId(): string | null {
    return this.kept.installId;
  }

  /** Keeps the person's answers for the kinds this build offers (others stay as they were). */
  choose(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid choice.');
    const answers = Object.entries(value);
    if (
      !answers.every(
        ([kind, on]) => this.kinds.includes(kind as DataKind) && typeof on === 'boolean',
      )
    )
      throw new Error('Invalid choice.');
    const choice = { ...this.kept.choice, ...(value as DataChoice) };
    const next: Kept = {
      choice,
      installId: this.kept.installId ?? (choice.usage ? randomUUID() : null),
      waiting: choice.usage ? this.kept.waiting : [],
    };
    this.write(next);
    this.kept = next;
    if (!choice.usage) this.cancel();
  }

  /** One usage event, kept to be sent while the person allows usage data; otherwise dropped. */
  record(value: unknown) {
    if (!(USAGE_EVENTS as readonly unknown[]).includes(value)) throw new Error('Invalid event.');
    if (!this.sendsUsage) return;
    const record: UsageRecord = {
      event: value as UsageEvent,
      id: randomUUID(),
      install_id: this.kept.installId!,
      version: this.options.version,
      os: this.options.os,
      arch: this.options.arch,
      at: this.now()
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z'),
    };
    this.keep({ ...this.kept, waiting: [...this.kept.waiting, record].slice(-MAX_WAITING) });
    this.schedule(SEND_AFTER_MS);
  }

  /** At launch: what waited since the last time goes out shortly. */
  start() {
    if (this.sendsUsage && this.kept.waiting.length) this.schedule(SEND_AFTER_MS);
  }

  /** Before quitting: one try to send what waits, given up after `timeoutMs` (what is left waits for the next launch). */
  async flush(timeoutMs: number) {
    this.cancel();
    const signal = AbortSignal.timeout(timeoutMs);
    await Promise.race([
      this.send(signal),
      new Promise(given => signal.addEventListener('abort', given, { once: true })),
    ]);
  }

  dispose() {
    this.disposed = true;
    this.cancel();
  }

  private schedule(ms: number) {
    if (this.timer || this.disposed) return;
    this.timer = this.timers.after(ms, () => {
      this.timer = null;
      void this.send(AbortSignal.timeout(SEND_TIMEOUT_MS));
    });
  }

  private cancel() {
    if (this.timer) this.timers.clear(this.timer);
    this.timer = null;
  }

  private send(signal: AbortSignal): Promise<void> {
    this.sending ??= this.sendBatch(signal).finally(() => {
      this.sending = null;
    });
    return this.sending;
  }

  private async sendBatch(signal: AbortSignal) {
    if (!this.sendsUsage || !this.kept.waiting.length) return;
    const batch = this.kept.waiting.slice(0, BATCH);
    let status = 0;
    try {
      status = await this.post(this.usageUrl!, JSON.stringify({ records: batch }), signal);
    } catch {
      /* no response: the batch waits */
    }
    const refused = status >= 400 && status < 500 && status !== 408 && status !== 429;
    const done = (status >= 200 && status < 300) || refused;
    if (done) {
      const sent = new Set(batch.map(r => r.id));
      this.keep({ ...this.kept, waiting: this.kept.waiting.filter(r => !sent.has(r.id)) });
      this.failures = 0;
    } else this.failures++;
    // Usage data may have been turned off while the batch was on its way. An event that came
    // meanwhile set a short wait, which this one replaces.
    this.cancel();
    if (this.sendsUsage && this.kept.waiting.length)
      this.schedule(done ? 0 : RETRY_MS[Math.min(this.failures, RETRY_MS.length) - 1]!);
  }

  /** The events waiting change: kept on disk when it can be, and in memory while den-kit runs anyway. */
  private keep(kept: Kept) {
    try {
      this.write(kept);
    } catch {
      /* the app's data folder refused the write: the events go while den-kit runs */
    }
    this.kept = kept;
  }

  private write(kept: Kept) {
    mkdirSync(this.options.directory, { recursive: true, mode: 0o700 });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(kept), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
  }
}
