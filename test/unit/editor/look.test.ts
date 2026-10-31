// den-kit's own screens take every color from the themes' tokens (src/editor/tokens.css,
// docs/design-system.md): no other style of the editor names a color, every theme sets the
// same tokens, and only the tokens and theme.ts know which theme is on.
import { describe, expect, it } from 'vite-plus/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES } from '../../../src/editor/theme.ts';

const editor = fileURLToPath(new URL('../../../src/editor', import.meta.url));
const COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** The editor's styles: each .css file whole, each .vue file's style blocks; the tokens aside. */
function styles(): Array<{ file: string; css: string }> {
  return files(editor).flatMap(path => {
    const text = readFileSync(path, 'utf8');
    const file = relative(editor, path);
    if (path.endsWith('.css')) return file === 'tokens.css' ? [] : [{ file, css: text }];
    if (!path.endsWith('.vue')) return [];
    return [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m => ({
      file,
      css: m[1]!,
    }));
  });
}

/** Each theme's block in tokens.css: its id and the tokens it sets, with their values. */
function themeBlocks(): Map<string, Map<string, string>> {
  const css = readFileSync(join(editor, 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = new Map<string, Map<string, string>>();
  for (const m of css.matchAll(/\[data-theme='([a-z-]+)'\]\s*\{([^}]*)\}/g))
    blocks.set(
      m[1]!,
      new Map([...m[2]!.matchAll(/^\s*--([a-z0-9-]+):\s*([^;]+);/gm)].map(t => [t[1]!, t[2]!])),
    );
  return blocks;
}

/** A token's color in a theme, following var() to the hex value. */
function hex(tokens: Map<string, string>, name: string): string {
  const value = tokens.get(name) ?? '';
  const ref = /^var\(--([a-z0-9-]+)\)$/.exec(value);
  return ref ? hex(tokens, ref[1]!) : value;
}

/** WCAG contrast ratio of two #rrggbb colors. */
function contrast(a: string, b: string): number {
  const lum = (c: string) => {
    const [r, g, bl] = [1, 3, 5]
      .map(i => parseInt(c.slice(i, i + 2), 16) / 255)
      .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("den-kit's own look", () => {
  it('every color of the editor comes from the tokens', () => {
    const named = styles().flatMap(({ file, css }) =>
      [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(COLOR)].map(m => `${file}: ${m[0]}`),
    );
    expect(named).toEqual([]);
  });

  it("every rounded corner is one of the theme's radii", () => {
    const fixed = styles().flatMap(({ file, css }) =>
      [...css.matchAll(/border(?:-[a-z]+)*-radius:\s*([^;]*\d+(?:\.\d+)?(?:px|r?em)[^;]*);/g)].map(
        m => `${file}: ${m[1]}`,
      ),
    );
    expect(fixed).toEqual([]);
  });

  it('the tokens hold the themes theme.ts names, and no others', () => {
    expect([...themeBlocks().keys()]).toEqual(THEMES.map(t => t.id));
  });

  it('every theme sets the same tokens', () => {
    const [first, ...rest] = [...themeBlocks()].map(([id, t]) => ({
      id,
      tokens: [...t.keys()].sort(),
    }));
    expect(first!.tokens.length).toBeGreaterThan(0);
    for (const { id, tokens } of rest)
      expect({ id, tokens }).toEqual({ id, tokens: first!.tokens });
  });

  it('text is readable on every surface in every theme (4.5:1)', () => {
    const text = [
      'text-primary',
      'text-muted',
      'accent-text',
      'state-ok',
      'state-warn',
      'state-danger',
    ];
    const surfaces = ['app-canvas', 'app-chrome', 'app-card', 'app-field'];
    const pairs: Array<[string, string]> = [
      ...text.flatMap(t => surfaces.map(s => [t, s] as [string, string])),
      ['text-on-ink', 'ink'],
      ['text-on-accent', 'accent'],
    ];
    const low = [...themeBlocks()].flatMap(([id, tokens]) =>
      pairs
        .map(([fg, bg]) => ({ fg, bg, ratio: contrast(hex(tokens, fg), hex(tokens, bg)) }))
        .filter(p => !(p.ratio >= 4.5))
        .map(p => `${id}: ${p.fg} on ${p.bg} ${p.ratio.toFixed(2)}`),
    );
    expect(low).toEqual([]);
  });

  it('nothing else in the editor asks which theme is on', () => {
    const ids = new RegExp(`data-theme|'(?:${THEMES.map(t => t.id).join('|')})'`);
    const asking = files(editor)
      .map(path => relative(editor, path))
      .filter(file => file !== 'tokens.css' && file !== 'theme.ts')
      .filter(file => ids.test(readFileSync(join(editor, file), 'utf8')));
    expect(asking).toEqual([]);
  });
});
