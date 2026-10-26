import type { Issue } from '../../work/issues.ts';

/** Turn an unworklet/WebAssembly/evaluation failure into node-attributed issues. */
export function attributeError(
  message: string,
  nodes: readonly string[],
  options: {
    node?: string;
    line?: number;
    codeboxes?: ReadonlyArray<{ node: string; line: number; lines: number }>;
  } = {},
): Issue[] {
  if (options.line !== undefined && options.codeboxes) {
    for (const box of options.codeboxes) {
      if (options.line >= box.line && options.line < box.line + box.lines)
        return [
          {
            severity: 'error',
            code: 'codebox-syntax',
            node: box.node,
            line: options.line - box.line + 1,
            message,
          },
        ];
    }
  }
  if (options.node)
    return [{ severity: 'error', code: 'construct-failed', node: options.node, message }];
  if (/maximum function size|function size/i.test(message))
    return [
      {
        severity: 'error',
        code: 'too-large',
        message:
          'The patch is too large to compile (WebAssembly function size limit). Use fewer voices or fewer per-voice blocks.',
      },
    ];
  const ids = new Set(nodes);
  const found = new Set<string>();
  // Ids may carry a voice suffix (`osc1_v2`), a port (`osc1_freq`), or come from inside a part (`rain1_drop1_osc1`).
  for (const match of message.matchAll(/\b[a-z][a-zA-Z0-9_]*\b/g)) {
    let word = match[0].replace(/_v\d+$/, '');
    while (!ids.has(word) && word.includes('_')) word = word.slice(0, word.lastIndexOf('_'));
    if (ids.has(word)) found.add(word);
  }
  const codes = [...message.matchAll(/\[([a-z][a-z0-9-]+)\]/g)].map(m => m[1]!);
  const code = codes[0] ?? 'compile-failed';
  if (found.size)
    return [...found].map(node => ({ severity: 'error' as const, code, node, message }));
  return [{ severity: 'error', code, message }];
}
