// The desktop app's crash reports (docs/usage.md, Help improve den-kit), sent to
// Sentry only while the person allows them. A release names its Sentry project with
// a DSN (resources/operator.json); a build without one offers no crash reports.
//
// When the person allowed crash reports, Sentry starts in the main process before the
// app is ready, so the crash reporter watches every process the app starts; when they
// allow them in Settings, it starts then, and native crashes of the processes already
// running are reported from the next launch. Sentry takes errors nobody caught in the
// main process and in den-kit's page (which hands them over through the preload), and
// native crashes of the app's processes with their crash dumps. Breadcrumbs,
// screenshots, local variables, source lines, sessions, the computer's name and its
// boot time stay out. Every text loses the person's home folder and the app's keys;
// crash dumps go as they are. Turning crash reports off stops all sending at once,
// reports waiting to be sent included. A launch without them starts no Sentry and
// removes what an earlier launch left: crash dumps and reports waiting to be sent.
//
// This file holds what can be checked without Electron; desktop/main.ts gives it
// Sentry, and desktop/page/crash-reports.ts starts Sentry in the page.
import type { ElectronMainOptions, Event } from '@sentry/electron/main';

/** The main process's integrations that are kept: errors and crashes, and what it takes to read them. */
export const MAIN_INTEGRATIONS: ReadonlySet<string> = new Set([
  'SentryMinidump', // native crashes of the app's processes, with their crash dumps
  'ChildProcess', // a GPU or utility process that crashed
  'OnUncaughtException',
  'OnUnhandledRejection',
  'ElectronContext', // den-kit's version, Electron's and the CPU type
  'GpuContext',
  'Context', // the OS, the CPU and the memory size
  'EventFilters',
  'FunctionToString',
  'LinkedErrors',
  'NormalizePaths', // paths inside the app instead of where it is installed
]);

/** What Sentry collects beyond the error itself, in the main process and the page: nothing. */
export const DATA_COLLECTION = {
  userInfo: false, // no user, and no IP address taken from where a report came from
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  frameContextLines: 0,
} satisfies NonNullable<ElectronMainOptions['dataCollection']>;

/** The release a report names, and the one a build uploads its source maps for (scripts/sentry-sourcemaps.ts). */
export function crashRelease(version: string) {
  return `den-kit@${version}`;
}

/** A Sentry DSN, https://<public key>@<host>/<project>, or null. */
export function crashDsn(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.username &&
      !url.password &&
      /^\/\d+$/.test(url.pathname)
      ? value
      : null;
  } catch {
    return null;
  }
}

/** A text to take out of every report, and what stands in its place. */
export type Redaction = readonly [text: string, replacement: string];

function redact(value: unknown, redactions: readonly Redaction[]): unknown {
  if (typeof value === 'string')
    return redactions.reduce((text, [from, to]) => text.split(from).join(to), value);
  if (Array.isArray(value)) return value.map(item => redact(item, redactions));
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    for (const key of Object.keys(object)) object[key] = redact(object[key], redactions);
  }
  return value;
}

/** A report without what it does not need, and with each redaction made in every text. */
export function scrub<E extends Event>(event: E, redactions: readonly Redaction[]): E {
  delete event.server_name;
  delete event.user;
  delete event.request;
  delete event.breadcrumbs;
  delete event.extra;
  delete event.contexts?.culture;
  delete event.contexts?.device?.boot_time;
  // A text of a few characters, such as the root folder, is neither a key nor a person's folder, and
  // taking it out would garble the report.
  return redact(
    event,
    redactions.filter(([from]) => from.length >= 4),
  ) as E;
}

/** What den-kit uses of Sentry's main-process SDK, loaded only once crash reports are allowed. */
export type SentryMain = Pick<
  typeof import('@sentry/electron/main'),
  'init' | 'IPCMode' | 'makeElectronTransport' | 'makeElectronOfflineTransport'
>;
type Transport = ReturnType<SentryMain['makeElectronTransport']>;

/** A transport that sends only while `allowed()`; what it does not send is dropped, not kept. */
export function gate<O>(
  make: (options: O) => Transport,
  allowed: () => boolean,
): (options: O) => Transport {
  return options => {
    const transport = make(options);
    return {
      send: envelope => (allowed() ? transport.send(envelope) : Promise.resolve({})),
      flush: timeout => transport.flush(timeout),
    };
  };
}

export interface CrashReportsOptions {
  dsn: string;
  /** crashRelease() of den-kit's version. */
  release: string;
  /** Whether the person allows crash reports now. */
  allowed: () => boolean;
  /** The texts to take out of every report, read when a report is made. */
  redactions: () => readonly Redaction[];
  /** Loads Sentry's main-process SDK. */
  sentry: () => Promise<SentryMain>;
  /** Removes the crash dumps and the reports waiting to be sent that a launch left. */
  clear(): void;
}

/** The options Sentry starts with in the main process. */
export function mainOptions(
  sentry: SentryMain,
  o: Omit<CrashReportsOptions, 'sentry' | 'clear'>,
): ElectronMainOptions {
  return {
    dsn: o.dsn,
    release: o.release,
    // The page hands its reports over through den-kit's preload: no protocol and no preload of Sentry's own.
    ipcMode: sentry.IPCMode.Classic,
    getSessions: () => [],
    integrations: defaults => defaults.filter(i => MAIN_INTEGRATIONS.has(i.name)),
    // No tracing, so no span streaming either.
    traceLifecycle: 'static',
    // Reports waiting to be sent go through the gate too, so turning crash reports off drops them.
    transport: sentry.makeElectronOfflineTransport(gate(sentry.makeElectronTransport, o.allowed)),
    dataCollection: DATA_COLLECTION,
    // Sentry does not take the computer's name.
    includeServerName: false,
    sendClientReports: false,
    beforeBreadcrumb: () => null,
    beforeSend: event => (o.allowed() ? scrub(event, o.redactions()) : null),
  };
}

/** Crash reports for one launch of the app, following the person's answer. */
export class CrashReports {
  private readonly options: CrashReportsOptions;
  private started: Promise<void> | null = null;

  constructor(options: CrashReportsOptions) {
    this.options = options;
  }

  /** At launch: Sentry starts when the person allows crash reports; otherwise what an earlier launch left goes. */
  async launch() {
    if (this.options.allowed()) return this.follow();
    try {
      this.options.clear();
    } catch {
      /* what could not be removed stays until a later launch; nothing sends it */
    }
  }

  /** After the person answers: Sentry starts the first time crash reports are allowed. Turning them off needs nothing more, since gate() and beforeSend send nothing then. */
  async follow() {
    if (!this.options.allowed()) return;
    // Crash reports never stop den-kit: Sentry that cannot start sends nothing.
    this.started ??= this.options
      .sentry()
      .then(sentry => sentry.init(mainOptions(sentry, this.options)))
      .then(
        () => undefined,
        () => undefined,
      );
    await this.started;
  }
}
