// Codebox source → an IIFE that can be inlined into the generated processor.
// The source is a normal core-API module; we only rewrite its imports into a
// destructure of the core namespace and its default export into a return, and
// keep line numbers stable so diagnostics map back onto the codebox.
import type { Issue } from '../work/issues.ts';

export interface InlinedCodebox {
  lines: string[];
  issues: Issue[];
}

const IMPORT = /^[ \t]*import\s+(type\s+)?([\s\S]*?)\s+from\s+(['"])([^'"]+)\3\s*;?/gm;
const SIDE_EFFECT_IMPORT = /^[ \t]*import\s+(['"])[^'"]+\1\s*;?/m;

export function inlineCodebox(node: string, code: string): InlinedCodebox {
  const issues: Issue[] = [];
  const lineOf = (index: number) => code.slice(0, index).split('\n').length;
  const names: string[] = [];
  if (SIDE_EFFECT_IMPORT.test(code))
    issues.push({
      severity: 'error',
      code: 'codebox-import',
      node,
      message: 'Codebox may only import from @unworklet/core.',
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
      if (from !== '@unworklet/core') {
        issues.push({
          severity: 'error',
          code: 'codebox-import',
          node,
          line: lineOf(index),
          message: `Codebox may only import from @unworklet/core (found "${from}").`,
        });
        return blank;
      }
      if (typeOnly) return blank;
      const clauseText = clause.trim();
      const namespace = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(clauseText);
      if (namespace) {
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
          message: "Use named imports: import { f32, state } from '@unworklet/core'.",
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
  const destructure = names.filter(n => !n.startsWith('__ns:'));
  const namespaces = names.filter(n => n.startsWith('__ns:')).map(n => n.slice(5));
  const head = [
    destructure.length ? `const { ${destructure.join(', ')} } = core;` : '',
    ...namespaces.map(n => `const ${n} = core;`),
  ]
    .filter(Boolean)
    .join(' ');
  const lines = body.replace(/\s+$/, '').split('\n');
  lines[0] = `${head} ${lines[0]}`.trim();
  lines.push('return __default;');
  return { lines, issues };
}
