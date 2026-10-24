// Codebox source → an IIFE that can be inlined into the generated processor.
// The source is a normal core-API module; we only rewrite its imports into a
// destructure of the core namespace (and of the asset API) and its default
// export into a return, and keep line numbers stable so diagnostics map back
// onto the codebox. Assets are named by their path written out, so the
// processor knows which ones to hold before it runs.
import { assetApiNames } from '../work/codebox-assets.ts';
import type { Issue } from '../work/issues.ts';

export interface InlinedCodebox {
  lines: string[];
  issues: Issue[];
  /** The asset paths it reads through `@den-kit/assets`. */
  assets: { audio: string[]; bytes: string[] };
}

const IMPORT = /^[ \t]*import\s+(type\s+)?([\s\S]*?)\s+from\s+(['"])([^'"]+)\3\s*;?/gm;
const SIDE_EFFECT_IMPORT = /^[ \t]*import\s+(['"])[^'"]+\1\s*;?/m;
const MODULES = '@unworklet/core and @den-kit/assets';
const ASSET_API = new Set(['audio', 'bytes']);

export function inlineCodebox(node: string, code: string): InlinedCodebox {
  const issues: Issue[] = [];
  const lineOf = (index: number) => code.slice(0, index).split('\n').length;
  const names: string[] = [];
  /** Local names of the asset API's functions. */
  const assetNames = assetApiNames(code);
  if (SIDE_EFFECT_IMPORT.test(code))
    issues.push({
      severity: 'error',
      code: 'codebox-import',
      node,
      message: `Codebox may only import from ${MODULES}.`,
    });
  let body = code.replace(
    IMPORT,
    (
      match,
      typeOnly: string | undefined,
      clause: string,
      _q: string,
      from: string,
      index: number,
    ) => {
      const blank = '\n'.repeat(match.split('\n').length - 1);
      if (from !== '@unworklet/core' && from !== '@den-kit/assets') {
        issues.push({
          severity: 'error',
          code: 'codebox-import',
          node,
          line: lineOf(index),
          message: `Codebox may only import from ${MODULES} (found "${from}").`,
        });
        return blank;
      }
      if (typeOnly) return blank;
      const clauseText = clause.trim();
      const namespace = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(clauseText);
      if (namespace && from === '@unworklet/core') {
        names.push(`__ns:${namespace[1]}`);
        return blank;
      }
      const braces = /^\{([\s\S]*)\}$/.exec(clauseText);
      if (!braces) {
        issues.push({
          severity: 'error',
          code: 'codebox-import',
          node,
          line: lineOf(index),
          message:
            from === '@den-kit/assets'
              ? "Use named imports: import { audio } from '@den-kit/assets'."
              : "Use named imports: import { f32, state } from '@unworklet/core'.",
        });
        return blank;
      }
      for (const part of braces[1]!
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)) {
        if (/^type\s/.test(part)) continue;
        const alias = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(part);
        if (!alias) {
          issues.push({
            severity: 'error',
            code: 'codebox-import',
            node,
            line: lineOf(index),
            message: `Cannot read import "${part}".`,
          });
          continue;
        }
        if (from === '@den-kit/assets') {
          if (!ASSET_API.has(alias[1]!)) {
            if (/^[A-Z]/.test(alias[1]!)) continue; // a type, such as AssetAudio
            issues.push({
              severity: 'error',
              code: 'codebox-import',
              node,
              line: lineOf(index),
              message: `@den-kit/assets has audio and bytes (found "${alias[1]}").`,
            });
            continue;
          }
          continue;
        }
        names.push(alias[2] ? `${alias[1]}: ${alias[2]}` : alias[1]!);
      }
      return blank;
    },
  );
  const defaults = [...body.matchAll(/^([ \t]*)export\s+default\s+/gm)];
  if (defaults.length !== 1)
    issues.push({
      severity: 'error',
      code: 'codebox-export',
      node,
      message: 'Codebox must have exactly one `export default defineSubgraph(...)`.',
    });
  body = body
    .replace(/^([ \t]*)export\s+default\s+/m, '$1const __default = ')
    .replace(/^([ \t]*)export\s+(?=(const|let|function|class|interface|type)\b)/gm, '$1');
  if (/^\s*export\b/m.test(body))
    issues.push({
      severity: 'error',
      code: 'codebox-export',
      node,
      message: 'Only one default export is allowed in a codebox.',
    });
  // Each use of the asset API names its asset by a path written out.
  const assets = { audio: new Set<string>(), bytes: new Set<string>() };
  for (const [local, api] of assetNames)
    for (const call of body.matchAll(
      new RegExp(`(?<![\\w$.])${local.replace('$', '\\$')}\\s*\\(`, 'g'),
    )) {
      const literal = /^\s*(['"])([^'"\n]+)\1\s*\)/.exec(body.slice(call.index + call[0].length));
      if (literal) assets[api].add(literal[2]!);
      else
        issues.push({
          severity: 'error',
          code: 'codebox-asset',
          node,
          line: body.slice(0, call.index).split('\n').length,
          message: `${api}() takes the asset's path written out in quotes, such as ${api}('assets/${api === 'audio' ? 'kick.wav' : 'table.bin'}').`,
        });
    }
  const destructure = names.filter(n => !n.startsWith('__ns:'));
  const namespaces = names.filter(n => n.startsWith('__ns:')).map(n => n.slice(5));
  const head = [
    destructure.length ? `const { ${destructure.join(', ')} } = core;` : '',
    ...namespaces.map(n => `const ${n} = core;`),
    assetNames.size
      ? `const { ${[...assetNames].map(([local, api]) => (local === api ? api : `${api}: ${local}`)).join(', ')} } = assets;`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  const lines = body.replace(/\s+$/, '').split('\n');
  lines[0] = `${head} ${lines[0]}`.trim();
  lines.push('return __default;');
  return { lines, issues, assets: { audio: [...assets.audio], bytes: [...assets.bytes] } };
}
