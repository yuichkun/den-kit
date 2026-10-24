// den-kit's own screens take every color from the provisional tokens
// (src/editor/tokens.css), so the design system replaces one file: no other style
// of the editor names a color.
import { describe, expect, it } from 'vite-plus/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const editor = fileURLToPath(new URL('../../../src/editor', import.meta.url));
const COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi;

/** The editor's styles: each .css file whole, each .vue file's style blocks; the tokens aside. */
function styles(dir: string): Array<{ file: string; css: string }> {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return styles(path);
    const text = readFileSync(path, 'utf8');
    const file = relative(editor, path);
    if (name.endsWith('.css')) return name === 'tokens.css' ? [] : [{ file, css: text }];
    if (!name.endsWith('.vue')) return [];
    return [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m => ({
      file,
      css: m[1]!,
    }));
  });
}

describe("den-kit's own look", () => {
  it('every color of the editor comes from the tokens', () => {
    const named = styles(editor).flatMap(({ file, css }) =>
      [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(COLOR)].map(m => `${file}: ${m[0]}`),
    );
    expect(named).toEqual([]);
  });
});
