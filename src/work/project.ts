// The work's screen project: the sources of a real web project (Vite +
// TypeScript) that the AI — and the person, when they want — write in the pod
// (src/workspace). The document keeps the sources (so they are saved, exported, and
// undone with everything else); the pod holds a working copy plus what the tools
// make (node_modules, .git, dist). Code parts on the plugin (ui.ts, kind 'code')
// show parts of this project: `src/parts/<name>.ts` exports one.
import type { Issue } from './issues.ts';

export interface ScreenProject {
  /** Path (relative, e.g. "src/parts/reels.ts") → text. */
  files: Record<string, string>;
}

export const PROJECT_LIMITS = {
  files: 300,
  fileBytes: 512 * 1024,
  totalBytes: 4 * 1024 * 1024,
} as const;
/** A code part's name: the file src/parts/<name>.ts (or .tsx). */
export const PART_NAME = /^[a-z][a-z0-9-]{0,39}$/;
/** Made by den-kit from the patch on every change; never kept in the work. */
export const GENERATED_FILES: ReadonlySet<string> = new Set(['src/kit/controls.ts']);

// Plain names (dotfiles too: .gitignore, .prettierrc) joined with "/"; "." and ".." are refused below.
const PATH = /^[A-Za-z0-9_@.][A-Za-z0-9_.@+-]*(?:\/[A-Za-z0-9_@.][A-Za-z0-9_.@+-]*)*$/;
/** A path that may be kept in the work, or why not. */
export function checkProjectPath(path: unknown): string | null {
  if (typeof path !== 'string' || !path)
    return 'A file path is text, relative to the project (e.g. src/parts/reels.ts).';
  if (path.length > 200) return `${path.slice(0, 40)}…: the path is too long.`;
  if (!PATH.test(path) || path.split('/').some(s => s === '..' || s === '.'))
    return `${path}: a path is plain names joined with "/", relative to the project.`;
  const top = path.split('/')[0]!;
  if (['node_modules', '.git', 'dist'].includes(top))
    return `${path}: ${top}/ is made by the tools and is not kept in the work.`;
  if (GENERATED_FILES.has(path))
    return `${path} is made by den-kit from the patch; it is not kept in the work.`;
  return null;
}

export const byteLength = (text: string) => new TextEncoder().encode(text).length;
export function projectBytes(files: Readonly<Record<string, string>>): number {
  let n = 0;
  for (const text of Object.values(files)) n += byteLength(text);
  return n;
}

/** The parts the project offers (src/parts/<name>.ts or .tsx), by name. */
export function partNames(project: ScreenProject | undefined): string[] {
  if (!project) return [];
  const names = new Set<string>();
  for (const path of Object.keys(project.files)) {
    const m = /^src\/parts\/([a-z][a-z0-9-]{0,39})\.tsx?$/.exec(path);
    if (m) names.add(m[1]!);
  }
  return [...names].sort();
}
export const partPath = (name: string) => `src/parts/${name}.ts`;

/** Read a project from a file: bad paths, oversized files and the excess are dropped with a reason. */
export function readProject(raw: unknown, report: Issue[]): ScreenProject | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const files = (raw as { files?: unknown }).files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) return undefined;
  const out: Record<string, string> = {};
  let total = 0,
    count = 0;
  for (const [path, text] of Object.entries(files as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const bad = checkProjectPath(path);
    if (bad || typeof text !== 'string') {
      report.push({
        severity: 'warning',
        code: 'dropped-file',
        message: `Screen project: ${bad ?? `${path} is not text`}; left out.`,
      });
      continue;
    }
    const bytes = byteLength(text);
    if (
      bytes > PROJECT_LIMITS.fileBytes ||
      total + bytes > PROJECT_LIMITS.totalBytes ||
      count >= PROJECT_LIMITS.files
    ) {
      report.push({
        severity: 'warning',
        code: 'dropped-file',
        message: `Screen project: ${path} is over the size limits (${PROJECT_LIMITS.fileBytes / 1024} KB a file, ${PROJECT_LIMITS.totalBytes / 1024 / 1024} MB in all, ${PROJECT_LIMITS.files} files); left out.`,
      });
      continue;
    }
    out[path] = text;
    total += bytes;
    count++;
  }
  return Object.keys(out).length ? { files: out } : undefined;
}
