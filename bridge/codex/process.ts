// Finding and running the pinned Codex CLI (`@openai/codex` 0.160.1 in
// node_modules). The native binary is started directly (not through the npm
// launcher) so there is one child process to stop, and it is isolated from the
// user's own Codex setup and from the den repository:
//   CODEX_HOME  .codex-home (KIT_CODEX_HOME=~/.codex opts into the user's own)
//   cwd         <os tmpdir>/den-kit-codex/<hash>, outside any git repository, so
//               Codex finds no AGENTS.md
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { CODEX_VERSION } from './protocol.ts';

export interface CodexCommand { command: string; args: string[]; source: 'kit' | 'KIT_CODEX_BIN'; version: string | null }
export interface CodexProblem { error: string; fix: string }

const TRIPLES: Record<string, string> = {
  'darwin-arm64': 'aarch64-apple-darwin', 'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-musl', 'linux-arm64': 'aarch64-unknown-linux-musl',
  'win32-x64': 'x86_64-pc-windows-msvc', 'win32-arm64': 'aarch64-pc-windows-msvc',
};

/** The codex binary to run: KIT_CODEX_BIN (tests: a script run with Node), else the pinned package in node_modules. */
export function resolveCodex(kitRoot: string, env: NodeJS.ProcessEnv = process.env): CodexCommand | CodexProblem {
  const override = env.KIT_CODEX_BIN;
  if (override) {
    if (!existsSync(override)) return { error: `KIT_CODEX_BIN points to ${override}, which does not exist.`, fix: 'Unset KIT_CODEX_BIN to use the pinned codex in node_modules.' };
    return /\.(ts|mjs|js)$/.test(override) ? { command: process.execPath, args: [override], source: 'KIT_CODEX_BIN', version: null } : { command: override, args: [], source: 'KIT_CODEX_BIN', version: null };
  }
  const pkg = join(kitRoot, 'node_modules/@openai/codex/package.json');
  if (!existsSync(pkg)) return { error: 'Codex is not installed in node_modules.', fix: 'Run `npm ci` from the repo root (it installs the pinned @openai/codex).' };
  const version = String(JSON.parse(readFileSync(pkg, 'utf8')).version);
  const key = `${process.platform}-${process.arch}`;
  const triple = TRIPLES[key];
  if (!triple) return { error: `Codex has no build for ${key}.`, fix: 'Use a Mac (Apple silicon or Intel), Linux or Windows machine.' };
  let vendor: string;
  try { vendor = join(dirname(createRequire(pkg).resolve(`@openai/codex-${key}/package.json`)), 'vendor'); }
  catch { vendor = join(dirname(pkg), 'vendor'); }
  const binary = join(vendor, triple, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex');
  if (!existsSync(binary)) return { error: `The Codex binary for ${key} is missing (optional dependency @openai/codex-${key}).`, fix: 'Run `npm ci` again (npm must install optional dependencies; do not use --omit=optional).' };
  return { command: binary, args: [], source: 'kit', version };
}

export const isProblem = (value: CodexCommand | CodexProblem): value is CodexProblem => 'error' in value;

/** Where Codex keeps its login and state for den-kit. */
export function codexHome(kitRoot: string, env: NodeJS.ProcessEnv = process.env): { path: string; isolated: boolean } {
  const chosen = env.KIT_CODEX_HOME?.trim();
  if (!chosen) return { path: join(kitRoot, '.codex-home'), isolated: true };
  const path = resolve(chosen.replace(/^~(?=$|\/)/, homedir()));
  return { path, isolated: false };
}

/** An empty working directory outside every repository (Codex reads AGENTS.md up to the git root). */
export function codexWorkdir(kitRoot: string): string {
  const dir = join(tmpdir(), 'den-kit-codex', createHash('sha256').update(kitRoot).digest('hex').slice(0, 12));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** How the user signs Codex in for den-kit (scripts/codex-login.ts creates CODEX_HOME first; Codex refuses a missing one). */
export const LOGIN_COMMAND = 'npm run codex:login';

/** The environment Codex runs with: the user's (network, proxies, HOME) minus den-kit's own secrets. */
export function codexEnv(home: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env, CODEX_HOME: home };
  for (const key of Object.keys(out)) if (/^(TYPESAFE_API_KEY|BROWSERPOD_API_KEY|KIT_BRIDGE_TOKEN)$/.test(key)) delete out[key];
  return out;
}

export interface AppServerProcess {
  readonly child: ChildProcessWithoutNullStreams;
  /** The last lines Codex wrote to stderr (its log), for error messages. */
  stderrTail(): string;
  stop(graceMs?: number): Promise<void>;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

/** Start `codex app-server` on stdio. */
export function spawnAppServer(command: CodexCommand, options: { home: string; cwd: string; env?: NodeJS.ProcessEnv }): AppServerProcess {
  mkdirSync(options.home, { recursive: true });
  const child = spawn(command.command, [...command.args, 'app-server'], { cwd: options.cwd, env: codexEnv(options.home, options.env), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const tail: string[] = [];
  let partial = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    const lines = (partial + chunk).split('\n');
    partial = lines.pop() ?? '';
    for (const line of lines) {
      // Codex logs with ANSI colours; keep the text.
      const clean = line.replace(/\u001b\[[0-9;]*m/g, '').trim();
      if (clean) { tail.push(clean); if (tail.length > 40) tail.shift(); }
    }
  });
  child.stdin.on('error', () => { /* EPIPE after exit: reported through the exit and the RPC peer */ });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', () => resolve({ code: null, signal: null }));
  });
  let stopping: Promise<void> | null = null;
  return {
    child, exited,
    stderrTail: () => tail.slice(-8).join('\n'),
    stop(graceMs = 2000) {
      stopping ??= (async () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        // Closing stdin is a clean shutdown for the app-server; then escalate.
        try { child.stdin.end(); } catch { /* already closed */ }
        const done = await Promise.race([exited.then(() => true), new Promise<boolean>(r => setTimeout(() => r(false), graceMs))]);
        if (done) return;
        child.kill('SIGTERM');
        const termed = await Promise.race([exited.then(() => true), new Promise<boolean>(r => setTimeout(() => r(false), graceMs))]);
        if (!termed) { child.kill('SIGKILL'); await exited; }
      })();
      return stopping;
    },
  };
}

export const PINNED_CODEX = CODEX_VERSION;
