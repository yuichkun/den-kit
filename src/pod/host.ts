// The free environment the AI (and the person) works in: a Linux-like pod
// inside the browser tab (BrowserPod) with bash, git, Node and npm, where the
// work's screen is a real web project (src/pod/template). This file is the one
// way den-kit talks to a pod, whatever runs it: the real BrowserPod
// (browserpod.ts) or the fake the tests use (fake-host.ts, never used outside
// tests). No DOM and no pod here, so the text rules are unit-tested in Node.

/** How one command runs. The command is a bash script, run with `bash` in `cwd`. */
export interface PodRunOptions {
  /** Working directory (default: the project). */
  cwd?: string;
  env?: Record<string, string>;
  /** Stop waiting after this long (the command is interrupted with ^C); null exit code then. */
  timeoutMs?: number;
  /** Each piece of output as it comes (cleaned text). */
  onOutput?(text: string): void;
}
export interface PodRunResult {
  /** The script's exit status; null when it was cut off or the pod could not say. */
  exitCode: number | null;
  /** What it printed (stdout and stderr together, cleaned, the end kept when long). */
  output: string;
  timedOut: boolean;
  ms: number;
}
/** A command left running (the dev server). */
export interface PodProcess {
  readonly name: string;
  /** Settles when it ends. */
  readonly done: Promise<void>;
  readonly running: boolean;
  /** The end of what it printed. */
  output(): string;
}
export interface Portal {
  url: string;
  port: number;
}

export interface PodHost {
  readonly kind: 'browserpod' | 'fake';
  /** The user's home inside the pod (absolute). */
  readonly home: string;
  run(script: string, options?: PodRunOptions): Promise<PodRunResult>;
  /** Start a long-running command; it keeps running after this returns. */
  start(name: string, script: string, options?: Omit<PodRunOptions, 'timeoutMs'>): PodProcess;
  /** Write a text file (absolute path; directories are made). */
  writeFile(path: string, content: string): Promise<void>;
  /** A text file's contents, or null when there is none. */
  readFile(path: string): Promise<string | null>;
  /** A server inside the pod opened a port and can be reached at `url` (also called for ports already open). */
  onPortal(listener: (portal: Portal) => void): () => void;
  dispose?(): void;
}

/** The pod cannot be used, and what the person can do about it. */
export class PodUnavailable extends Error {
  readonly fix?: string;
  constructor(message: string, fix?: string) {
    super(message);
    this.name = 'PodUnavailable';
    this.fix = fix;
  }
}

// ---- output ------------------------------------------------------------------------------------
/** Kept of a command's output (the end, where the errors are). */
export const MAX_OUTPUT = 200_000;

// CSI (colours, cursor moves), OSC (titles, links) and two-byte escapes; then stray control characters.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/**
 * Terminal output as plain text: no colours or cursor codes, Unix line ends, and a
 * line rewritten in place (progress bars: text, \r, text) keeps only what was last
 * written on it.
 */
export function cleanOutput(raw: string): string {
  const text = raw.replace(ANSI, '').replace(/\r\n/g, '\n');
  return text
    .split('\n')
    .map(line => {
      if (!line.includes('\r')) return line.replace(CONTROL, '');
      const parts = line.split('\r').filter(p => p.length);
      return (parts.at(-1) ?? '').replace(CONTROL, '');
    })
    .join('\n');
}

/** Keep the end of a long text, saying how much was cut. */
export function keepEnd(text: string, max = MAX_OUTPUT): string {
  if (text.length <= max) return text;
  const cut = text.length - max;
  return `[… ${cut} characters cut]\n${text.slice(cut)}`;
}

/**
 * Commands run as a script file with a closing line that prints a marker with the
 * script's exit status (the pod's API does not report it). The marker carries a
 * per-command nonce so output that happens to look like one is not taken for it.
 */
export function exitMarker(nonce: string): string {
  return `<<den-kit-exit:${nonce}:`;
}
/** The bash line that runs `scriptPath` in `cwd` and then prints the marker. */
export function runnerLine(nonce: string): string {
  // $1: cwd, $2: the script. Its own shell, so `exit` or `cd` in it end there.
  return `cd "$1" 2>/dev/null || cd ~; bash "$2"; __s=$?; printf '\\n${exitMarker(nonce)}%d>>\\n' "$__s"`;
}
/** Find the marker in the (cleaned) output: the output before it and the exit status. */
export function readExit(
  output: string,
  nonce: string,
): { output: string; exitCode: number } | null {
  const mark = exitMarker(nonce);
  const at = output.lastIndexOf(mark);
  if (at < 0) return null;
  const m = /^(\d+)>>/.exec(output.slice(at + mark.length));
  if (!m) return null;
  return { output: output.slice(0, at).replace(/\n+$/, ''), exitCode: Number(m[1]) };
}

let nonces = 0;
export function newNonce(): string {
  const random =
    globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
  return `${random}${(nonces++).toString(36)}`;
}

// ---- paths -----------------------------------------------------------------------------------
/**
 * A project path as the AI or the person gives it: relative to the project, or
 * absolute inside it. Returns the relative path, or an error. Nothing outside the
 * project, and nothing in what the pod makes itself (node_modules, .git, dist).
 */
export function projectPath(
  path: unknown,
  projectDir: string,
): { ok: true; path: string } | { ok: false; message: string } {
  if (typeof path !== 'string' || !path.trim())
    return {
      ok: false,
      message: 'Give a file path, relative to the project (e.g. src/parts/reels.ts).',
    };
  let p = path.trim().replace(/\\/g, '/');
  const dir = projectDir.replace(/\/+$/, '');
  if (p === dir || p.startsWith(`${dir}/`)) p = p.slice(dir.length + 1);
  else if (p.startsWith('~/') || p.startsWith('/'))
    return {
      ok: false,
      message: `${path} is outside the project (${dir}). Paths are relative to it.`,
    };
  p = p.replace(/^\.\//, '');
  const parts = p.split('/');
  if (!p || parts.some(s => s === '..' || s === '' || s === '.'))
    return { ok: false, message: `${path} is not a plain path inside the project.` };
  if (['node_modules', '.git', 'dist'].includes(parts[0]!))
    return {
      ok: false,
      message: `${parts[0]}/ is made by the tools, not kept in the work; change the sources instead.`,
    };
  if (p.length > 200) return { ok: false, message: 'That path is too long.' };
  return { ok: true, path: p };
}
