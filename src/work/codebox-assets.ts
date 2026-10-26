// The assets a codebox's code reads through `@den-kit/assets`, named by their
// paths written out (audio('assets/kick.wav')): found, so that an asset that is
// read cannot be removed, and moved with the asset when it is renamed.

/** Named imports from the asset API (type-only imports name nothing that runs). */
const ASSETS_IMPORT = /^[ \t]*import\s+(?!type\s)\{([^}]*)\}\s*from\s+(['"])@den-kit\/assets\2/gm;
const API = new Set(['audio', 'bytes']);

/** The local names the code gives the asset API's functions (import { bytes as raw } …). */
export function assetApiNames(code: string): Map<string, 'audio' | 'bytes'> {
  const names = new Map<string, 'audio' | 'bytes'>();
  for (const m of code.matchAll(ASSETS_IMPORT))
    for (const part of m[1]!.split(',').map(s => s.trim())) {
      const alias = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(part);
      if (alias && API.has(alias[1]!))
        names.set(alias[2] ?? alias[1]!, alias[1] as 'audio' | 'bytes');
    }
  return names;
}

/** A call of `local` with a path written out: what comes before the path's quote, the quote, the path. */
const call = (local: string) =>
  new RegExp(
    `((?<![\\w$.])${local.replace(/\$/g, '\\$')}\\s*\\(\\s*)(['"])([^'"\\n]+)\\2(?=\\s*\\))`,
    'g',
  );

/** The paths of the assets the code reads. */
export function assetReads(code: string): Set<string> {
  const paths = new Set<string>();
  for (const local of assetApiNames(code).keys())
    for (const m of code.matchAll(call(local))) paths.add(m[3]!);
  return paths;
}

/** The code with each read of the asset at `from` reading the one at `to`. */
export function moveAssetReads(code: string, from: string, to: string): string {
  let out = code;
  for (const local of assetApiNames(code).keys())
    out = out.replace(call(local), (match, head: string, quote: string, path: string) =>
      path === from ? `${head}${quote}${to}${quote}` : match,
    );
  return out;
}
