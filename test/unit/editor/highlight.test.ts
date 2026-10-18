import { describe, expect, it } from 'vite-plus/test';
import { HIGHLIGHT_LIMIT, highlight, highlightLines, languageFor } from '../../../src/editor/highlight.ts';

const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
const balanced = (html: string) => (html.match(/<span[^>]*>/g) ?? []).length === (html.match(/<\/span>/g) ?? []).length;

describe('syntax colours', () => {
  it('colours TypeScript and keeps the text exactly (escaped)', () => {
    const code = "import { part } from '../kit';\n// a <b>bar</b> & more\nexport default part({ mount(root) { root.textContent = `x ${1 + 2}`; } });\n";
    const html = highlight(code, 'typescript');
    expect(html).toMatch(/<span class="hljs-keyword">import<\/span>/);
    expect(html).toMatch(/<span class="hljs-string">&#x27;..\/kit&#x27;<\/span>/);
    expect(html).toMatch(/<span class="hljs-comment">\/\/ a &lt;b&gt;bar&lt;\/b&gt; &amp; more<\/span>/);
    expect(html).not.toMatch(/<b>/);
    expect(text(html)).toBe(code);
  });
  it('splits into lines with every line\'s spans closed (a comment over three lines stays coloured on each)', () => {
    const code = 'const a = 1;\n/* one\n   two\n   three */\nconst b = `x\ny`;';
    const lines = highlightLines(code, 'typescript');
    expect(lines).toHaveLength(code.split('\n').length);
    expect(lines.map(text)).toEqual(code.split('\n'));
    for (const line of lines) expect(balanced(line), line).toBe(true);
    expect(lines[2]).toMatch(/^<span class="hljs-comment">   two<\/span>$/);
    expect(lines[5]).toMatch(/^<span class="hljs-string">y`<\/span>;$/);
  });
  it('plain text, unknown files and very long code are escaped, not coloured', () => {
    expect(highlight('<a> & b', 'plaintext')).toBe('&lt;a&gt; &amp; b');
    const long = `const x = 1;\n${'a'.repeat(HIGHLIGHT_LIMIT)}`;
    expect(highlight(long, 'typescript')).not.toContain('<span');
  });
  it('knows a file\'s language from its name', () => {
    expect(['src/parts/meter.ts', 'eslint.config.js', 'package.json', 'index.html', 'src/a.css', 'AGENTS.md', 'logo.svg', 'run.sh', '.gitignore', 'Makefile', 'x.TSX'].map(languageFor))
      .toEqual(['typescript', 'javascript', 'json', 'xml', 'css', 'markdown', 'xml', 'bash', 'plaintext', 'plaintext', 'typescript']);
  });
});
