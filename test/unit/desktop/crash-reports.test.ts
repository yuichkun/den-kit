// The desktop app's crash reports (desktop/crash-reports.ts), what can be checked
// without Electron: only a release's Sentry project, reports without what they do not
// need and without the person's home folder or the app's keys, nothing sent while the
// person does not allow them, Sentry started once and only with their yes, and what an
// earlier launch left removed at a launch without it; and a build's source maps
// uploaded for the release its reports name (scripts/sentry-sourcemaps.ts).
// test/desktop/crash-reports.test.ts checks the same in Electron.
import { describe, expect, it } from 'vite-plus/test';
import {
  CrashReports,
  DATA_COLLECTION,
  MAIN_INTEGRATIONS,
  crashDsn,
  crashRelease,
  gate,
  mainOptions,
  scrub,
  type CrashReportsOptions,
  type SentryMain,
} from '../../../desktop/crash-reports.ts';
import { PAGE_INTEGRATIONS } from '../../../desktop/page/crash-reports.ts';
import { sourceMapUpload } from '../../../scripts/sentry-sourcemaps.ts';

const DSN = 'https://0123456789abcdef@o1.ingest.us.sentry.io/4507';
const RELEASE = 'den-kit@1.2.3';
const HOME = '/Users/somebody';
const KEY = 'bp_live_0123456789abcdef';

type Transport = ReturnType<SentryMain['makeElectronTransport']>;
type Envelope = Parameters<Transport['send']>[0];

/** Sentry's main-process SDK as far as den-kit uses it, keeping what den-kit gives it. */
function fakeSentry() {
  const sent: Envelope[] = [];
  const inits: Array<ReturnType<typeof mainOptions>> = [];
  const base = () =>
    ({
      send: async (envelope: Envelope) => {
        sent.push(envelope);
        return { statusCode: 200 };
      },
      flush: async () => true,
    }) as Transport;
  const sentry = {
    init: (options: ReturnType<typeof mainOptions>) => {
      inits.push(options);
    },
    IPCMode: { Classic: 1, Protocol: 2, Both: 3 },
    makeElectronTransport: base,
    // The offline transport hands each envelope to the transport it wraps, as Sentry's does when it can send.
    makeElectronOfflineTransport: (make: typeof base) => make,
  } as unknown as SentryMain;
  return { sentry, sent, inits };
}

function setup(options: Partial<CrashReportsOptions> = {}) {
  const state = { allowed: false, cleared: 0, loads: 0 };
  const fake = fakeSentry();
  const reports = new CrashReports({
    dsn: DSN,
    release: RELEASE,
    allowed: () => state.allowed,
    redactions: () => [
      [HOME, '~'],
      [KEY, '[key]'],
    ],
    sentry: async () => {
      state.loads++;
      return fake.sentry;
    },
    clear: () => {
      state.cleared++;
    },
    ...options,
  });
  return { reports, state, ...fake };
}

const report = () =>
  ({
    event_id: 'e',
    server_name: 'Somebodys-MacBook-Pro',
    user: { ip_address: '{{auto}}', id: 'someone' },
    request: { url: 'http://127.0.0.1:5247/?work=Song', headers: { 'User-Agent': 'x' } },
    breadcrumbs: [{ message: 'Clicked Export' }],
    extra: { arguments: ['Song'] },
    contexts: {
      culture: { locale: 'ja-JP', timezone: 'Asia/Tokyo' },
      device: { boot_time: '2026-11-01T00:00:00.000Z', memory_size: 17179869184, arch: 'arm64' },
      os: { name: 'macOS', version: '26.2' },
    },
    exception: {
      values: [
        {
          type: 'Error',
          value: `Could not read ${HOME}/Music/Song.wav with ${KEY}`,
          stacktrace: { frames: [{ filename: `${HOME}/den-kit/main.cjs`, function: 'read' }] },
        },
      ],
    },
    tags: { 'event.process': 'browser' },
  }) as Parameters<typeof scrub>[0];

describe('desktop crash reports', () => {
  it('takes only a Sentry DSN: https, with a public key and a project number', () => {
    expect(crashDsn(DSN)).toBe(DSN);
    for (const value of [
      'http://0123456789abcdef@o1.ingest.us.sentry.io/4507',
      'https://o1.ingest.us.sentry.io/4507',
      'https://key:secret@o1.ingest.us.sentry.io/4507',
      'https://key@o1.ingest.us.sentry.io/project',
      'https://key@o1.ingest.us.sentry.io/4507/extra',
      'not a url',
      '',
      null,
      undefined,
      4507,
    ])
      expect(crashDsn(value), String(value)).toBeNull();
  });

  it('uploads a build’s source maps for the release its reports name, only with all of den-kit’s Sentry settings', () => {
    expect(crashRelease('1.2.3')).toBe(RELEASE);
    expect(sourceMapUpload({}, '1.2.3')).toBeNull();
    // Sentry settings someone keeps for other work are not den-kit's.
    expect(
      sourceMapUpload({ SENTRY_AUTH_TOKEN: 't', SENTRY_ORG: 'o', SENTRY_PROJECT: 'p' }, '1.2.3'),
    ).toBeNull();
    expect(() => sourceMapUpload({ DEN_KIT_SENTRY_ORG: 'o' }, '1.2.3')).toThrow(
      /DEN_KIT_SENTRY_AUTH_TOKEN, DEN_KIT_SENTRY_ORG and DEN_KIT_SENTRY_PROJECT/,
    );
    const upload = sourceMapUpload(
      { DEN_KIT_SENTRY_AUTH_TOKEN: 't', DEN_KIT_SENTRY_ORG: 'o', DEN_KIT_SENTRY_PROJECT: 'p' },
      '1.2.3',
    );
    expect(upload).toEqual({
      org: 'o',
      project: 'p',
      authToken: 't',
      release: { name: RELEASE, inject: false, setCommits: false, deploy: false },
      telemetry: false,
      errorHandler: expect.any(Function),
    });
    // A build that cannot upload stops, and Sentry's CLI sends nothing about itself.
    expect(() => upload!.errorHandler(new Error('no Sentry'))).toThrow('no Sentry');
    expect(process.env.SENTRY_CLI_NO_TELEMETRY).toBe('1');
  });

  it('keeps of a report only what it takes to read it, without the home folder or the keys', () => {
    const scrubbed = scrub(report(), [
      [HOME, '~'],
      [KEY, '[key]'],
    ]);
    for (const field of ['server_name', 'user', 'request', 'breadcrumbs', 'extra'] as const)
      expect(scrubbed[field], field).toBeUndefined();
    expect(scrubbed.contexts).toEqual({
      device: { memory_size: 17179869184, arch: 'arm64' },
      os: { name: 'macOS', version: '26.2' },
    });
    expect(scrubbed.exception!.values![0]).toEqual({
      type: 'Error',
      value: 'Could not read ~/Music/Song.wav with [key]',
      stacktrace: { frames: [{ filename: '~/den-kit/main.cjs', function: 'read' }] },
    });
    expect(scrubbed.tags).toEqual({ 'event.process': 'browser' });
  });

  it('leaves a text of a few characters, such as the root folder, as it is', () => {
    const scrubbed = scrub(report(), [
      ['/', '~'],
      ['', '[key]'],
      ['abc', '[key]'],
    ]);
    expect(scrubbed.exception!.values![0]!.value).toBe(
      `Could not read ${HOME}/Music/Song.wav with ${KEY}`,
    );
  });

  it('sends through the gate only while the person allows crash reports, and drops what it does not send', async () => {
    let allowed = true;
    const { sentry, sent } = fakeSentry();
    const transport = gate(
      sentry.makeElectronTransport,
      () => allowed,
    )({} as Parameters<SentryMain['makeElectronTransport']>[0]);
    const envelope = [{}, []] as unknown as Envelope;
    expect(await transport.send(envelope)).toEqual({ statusCode: 200 });
    allowed = false;
    expect(await transport.send(envelope)).toEqual({});
    expect(sent).toEqual([envelope]);
    expect(await transport.flush(10)).toBe(true);
  });

  it('starts Sentry with only the kept integrations, nothing collected beyond the error, and every report scrubbed', () => {
    let allowed = true;
    const { sentry } = fakeSentry();
    const options = mainOptions(sentry, {
      dsn: DSN,
      release: RELEASE,
      allowed: () => allowed,
      redactions: () => [[HOME, '~']],
    });
    expect(options.dsn).toBe(DSN);
    expect(options.release).toBe(RELEASE);
    expect(options.ipcMode).toBe(sentry.IPCMode.Classic);
    const defaults = [...MAIN_INTEGRATIONS, 'ElectronBreadcrumbs', 'Screenshots', 'ContextLines']
      .concat('LocalVariablesAsync', 'MainProcessSession', 'Console', 'NodeFetch')
      .map(name => ({ name }));
    const integrations = options.integrations as (d: typeof defaults) => typeof defaults;
    expect(new Set(integrations(defaults).map(i => i.name))).toEqual(MAIN_INTEGRATIONS);
    expect(options.dataCollection).toBe(DATA_COLLECTION);
    expect(DATA_COLLECTION).toMatchObject({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      stackFrameVariables: false,
      frameContextLines: 0,
    });
    expect(options).toMatchObject({
      includeServerName: false,
      sendClientReports: false,
      traceLifecycle: 'static',
    });
    expect(options.beforeBreadcrumb!({ message: 'Clicked Export' })).toBeNull();
    const beforeSend = options.beforeSend as (event: ReturnType<typeof report>) => unknown;
    expect(beforeSend(report())).toMatchObject({
      exception: { values: [{ value: `Could not read ~/Music/Song.wav with ${KEY}` }] },
    });
    allowed = false;
    expect(beforeSend(report())).toBeNull();
  });

  it('keeps of the page’s integrations only those that take errors nobody caught', () => {
    expect(PAGE_INTEGRATIONS).toEqual(
      new Set([
        'EventFilters',
        'FunctionToString',
        'BrowserApiErrors',
        'GlobalHandlers',
        'LinkedErrors',
        'Dedupe',
      ]),
    );
  });

  it('at a launch without a yes, loads no Sentry and removes what an earlier launch left', async () => {
    const { reports, state, inits } = setup();
    await reports.launch();
    expect(state).toMatchObject({ cleared: 1, loads: 0 });
    expect(inits).toEqual([]);
  });

  it('at a launch with a yes, starts Sentry once and removes nothing', async () => {
    const { reports, state, inits } = setup();
    state.allowed = true;
    await reports.launch();
    await reports.follow();
    expect(state).toMatchObject({ cleared: 0, loads: 1 });
    expect(inits).toHaveLength(1);
    expect(inits[0]!.dsn).toBe(DSN);
  });

  it('starts Sentry when the person allows crash reports later, and only then', async () => {
    const { reports, state, inits } = setup();
    await reports.launch();
    await reports.follow();
    expect(inits).toEqual([]);
    state.allowed = true;
    await reports.follow();
    state.allowed = false;
    await reports.follow();
    state.allowed = true;
    await reports.follow();
    expect(inits).toHaveLength(1);
  });

  it('never stops den-kit: Sentry that cannot load or start, or a folder that cannot be removed, changes nothing', async () => {
    const failing = setup({
      sentry: () => Promise.reject(new Error('no Sentry')),
      clear: () => {
        throw new Error('busy');
      },
    });
    await expect(failing.reports.launch()).resolves.toBeUndefined();
    failing.state.allowed = true;
    await expect(failing.reports.follow()).resolves.toBeUndefined();
    const throwing = setup();
    throwing.sentry.init = () => {
      throw new Error('cannot start');
    };
    throwing.state.allowed = true;
    await expect(throwing.reports.launch()).resolves.toBeUndefined();
  });
});
