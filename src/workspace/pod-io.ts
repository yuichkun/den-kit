// What den-kit uses of the pod's text: cleaned command output, the exit marker
// commands end with, and project paths as people and the AI give them. Both the
// pods the hosts provide and the workspace module use these. No DOM and no pod
// here, so the text rules are unit-tested in Node.

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
// eslint-disable-next-line no-control-regex -- terminal control codes are what these take out
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
// eslint-disable-next-line no-control-regex -- terminal control codes are what these take out
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
