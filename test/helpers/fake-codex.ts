// A CodexClient wired to the fake app-server (test/fakes/codex), with its own
// CODEX_HOME, working directory and message log.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexClient, type CodexClientOptions } from '../../bridge/codex/client.ts';

export const FAKE_CODEX = fileURLToPath(new URL('../fakes/codex/fake-codex.ts', import.meta.url));
export const FAKE_SCENARIOS = fileURLToPath(
  new URL('../fakes/codex/scenarios.ts', import.meta.url),
);
export const KIT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export interface FakeCodex {
  client: CodexClient;
  home: string;
  logFile: string;
  /** Everything the fake received or flagged, in order. */
  records(): Array<Record<string, unknown>>;
  violations(): Array<Record<string, unknown>>;
  /** Requests den-kit sent with this method. */
  sent(method: string): Array<Record<string, unknown>>;
  /** Replies den-kit gave to the fake's requests (tool calls, approvals, …). */
  replies(): Array<Record<string, unknown>>;
  signIn(): void;
  cleanup(): Promise<void>;
}

/** Environment for the fake (also used by the e2e harness, which runs it through KIT_CODEX_BIN). */
export function fakeCodexEnv(
  logFile: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    FAKE_CODEX_SCENARIOS: FAKE_SCENARIOS,
    FAKE_CODEX_LOG: logFile,
    FAKE_CODEX_LATE_INTERRUPT_MS: '300',
    ...extra,
  };
}

export function readRecords(logFile: string): Array<Record<string, unknown>> {
  return existsSync(logFile)
    ? readFileSync(logFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l) as Record<string, unknown>)
    : [];
}

export function fakeCodex(
  options: {
    signedIn?: boolean;
    env?: Record<string, string>;
    client?: Partial<CodexClientOptions>;
  } = {},
): FakeCodex {
  const dir = mkdtempSync(join(tmpdir(), 'kit-fake-codex-'));
  const home = join(dir, 'home');
  const workdir = join(dir, 'work');
  const logFile = join(dir, 'fake.jsonl');
  mkdirSync(home);
  mkdirSync(workdir); // CODEX_HOME must exist, like the real CLI requires
  if (options.signedIn !== false) writeFileSync(join(home, 'auth.json'), '{"fake":true}');
  const client = new CodexClient({
    kitRoot: KIT_ROOT,
    command: {
      command: process.execPath,
      args: [FAKE_CODEX],
      source: 'KIT_CODEX_BIN',
      version: null,
    },
    home: { path: home, isolated: true },
    workdir,
    env: { ...process.env, ...fakeCodexEnv(logFile, options.env) },
    restart: { baseMs: 50, maxMs: 200, maxFailures: 3 },
    authPollMs: 50,
    ...options.client,
  });
  const records = () => readRecords(logFile);
  const inbound = () =>
    records()
      .map(r => r.in as Record<string, unknown> | undefined)
      .filter((m): m is Record<string, unknown> => !!m);
  return {
    client,
    home,
    logFile,
    records,
    violations: () => records().filter(r => 'violation' in r),
    sent: method => inbound().filter(m => m.method === method),
    replies: () => inbound().filter(m => !('method' in m)),
    signIn: () => writeFileSync(join(home, 'auth.json'), '{"fake":true}'),
    async cleanup() {
      await client.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
