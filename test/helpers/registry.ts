import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Same registry the browser worker gets from virtual:kit-modules, built from den's package exports. */
export async function loadRegistry(): Promise<Record<string, unknown>> {
  const entry = import.meta.resolve('@denaudio/den');
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', entry)), 'utf8'),
  ) as { exports: Record<string, unknown> };
  const names = [
    '@unworklet/core',
    ...Object.keys(pkg.exports).map(k =>
      k === '.' ? '@denaudio/den' : `@denaudio/den/${k.slice(2)}`,
    ),
  ];
  const entries = await Promise.all(
    names.map(async name => [name, await import(/* @vite-ignore */ name)] as const),
  );
  return Object.fromEntries(entries);
}
