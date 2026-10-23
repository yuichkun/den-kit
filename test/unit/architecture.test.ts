// The module structure of docs/architecture.md, checked on the source: which
// module may import which, and that den-kit's page code never names a host.
import { describe, expect, it } from 'vite-plus/test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../..', import.meta.url));

/** docs/architecture.md, "Modules": an arrow means "imports". */
const ALLOWED: Record<string, readonly string[]> = {
  editor: ['ai', 'screen', 'sound', 'workspace', 'work', 'host'],
  player: ['screen', 'sound', 'work'],
  ai: ['screen', 'sound', 'workspace', 'work', 'host'],
  screen: ['behaviors', 'work'],
  sound: ['work'],
  workspace: ['work', 'host'],
  behaviors: [],
  work: [],
  host: [],
};
const MODULES = Object.keys(ALLOWED);
/** Packages only a host may use: the desktop app's runtime, and the dev host's configuration. */
const HOST_ONLY = [/^electron(\/|$)/, /^node:/, /^virtual:kit-(bridge|pod)$/];

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** The code of a file: a .vue file's script blocks, a .ts file whole. */
function code(path: string): string {
  const text = readFileSync(path, 'utf8');
  if (!path.endsWith('.vue')) return text;
  return [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
}

/** Every module specifier a file imports: static, type-only, dynamic and side-effect imports, re-exports and import.meta.glob patterns. */
function importsOf(path: string): string[] {
  const text = code(path);
  const specifiers = ts.preProcessFile(text, true, true).importedFiles.map(f => f.fileName);
  for (const m of text.matchAll(/import\.meta\.glob\(\s*['"]([^'"]+)['"]/g)) specifiers.push(m[1]!);
  return specifiers;
}

/** Where a specifier leads: a module of src, another place in the repository, or a package. */
function targetOf(
  from: string,
  specifier: string,
): { module?: string; path?: string; pkg?: string } {
  const bare = specifier.split('?')[0]!;
  if (!bare.startsWith('.') && !bare.startsWith('/')) return { pkg: bare };
  const path = bare.startsWith('/') ? join(root, bare) : resolve(dirname(from), bare);
  const rel = relative(join(root, 'src'), path);
  if (!rel.startsWith('..')) return { module: rel.split(sep)[0], path };
  return { path };
}

function violations(): string[] {
  const found: string[] = [];
  for (const file of files(join(root, 'src'))) {
    const rel = relative(root, file);
    const module = relative(join(root, 'src'), file).split(sep)[0]!;
    if (!MODULES.includes(module)) {
      found.push(`${rel} is not inside a module`);
      continue;
    }
    if (!/\.(ts|vue)$/.test(file)) continue;
    for (const specifier of importsOf(file)) {
      const target = targetOf(file, specifier);
      if (target.pkg) {
        if (HOST_ONLY.some(p => p.test(target.pkg!)))
          found.push(`${rel} imports ${specifier}, which only a host may use`);
      } else if (target.module) {
        if (target.module !== module && !ALLOWED[module]!.includes(target.module))
          found.push(`${rel} (${module}) imports ${specifier} (${target.module})`);
      } else {
        const outside = relative(root, target.path!);
        // The files a work starts with are data the workspace writes into a new work.
        if (!(module === 'workspace' && outside.startsWith(`pod-template${sep}`)))
          found.push(`${rel} imports ${specifier}, outside den-kit's modules`);
      }
    }
  }
  // Code in a work imports the kit and npm packages, never den-kit's modules.
  for (const file of files(join(root, 'pod-template/src'))) {
    for (const specifier of importsOf(file)) {
      const target = targetOf(file, specifier);
      if (target.path && !relative(root, target.path).startsWith(`pod-template${sep}`))
        found.push(`${relative(root, file)} imports ${specifier}, outside the work's files`);
    }
  }
  return found;
}

/** Ways page code has told hosts apart: the desktop app's preload API, and checks for it. */
const HOST_CHECKS = [
  /\bdenKitShell\b/,
  /\bisDesktop\b/,
  /\bdesktop\(\)/,
  /process\.versions\.electron/,
];

function hostChecks(): string[] {
  const found: string[] = [];
  for (const file of files(join(root, 'src'))) {
    if (!/\.(ts|vue)$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const pattern of HOST_CHECKS)
      if (pattern.test(text)) found.push(`${relative(root, file)} matches ${pattern}`);
  }
  return found;
}

describe('module structure (docs/architecture.md)', () => {
  it('every module exists', () => {
    for (const module of MODULES) expect(existsSync(join(root, 'src', module)), module).toBe(true);
  });
  it('modules import only what the architecture allows', () => {
    expect(violations()).toEqual([]);
  });
  it('page code does not tell hosts apart', () => {
    expect(hostChecks()).toEqual([]);
  });
});
