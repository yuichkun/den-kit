// Syntax colours for the code den-kit shows and edits (colours only: no language
// server). highlight.js with the languages a work has: TypeScript and JavaScript
// (code parts, canvases, codeboxes, the generated processor), JSON, CSS, HTML and
// SVG, Markdown (AGENTS.md) and shell. Its output is escaped text in spans, so it
// is safe to put in the page as HTML.
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import './highlight.css';

for (const [name, language] of Object.entries({ bash, css, javascript, json, markdown, typescript, xml })) hljs.registerLanguage(name, language);

export type CodeLanguage = 'typescript' | 'javascript' | 'json' | 'css' | 'xml' | 'markdown' | 'bash' | 'plaintext';
/** Longer text is shown without colours (colouring it on every key would lag). */
export const HIGHLIGHT_LIMIT = 200_000;

const escapeHtml = (text: string) => text.replace(/[&<>]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));

/** The code as HTML with coloured spans (plain, escaped text for 'plaintext' and very long code). */
export function highlight(code: string, language: CodeLanguage): string {
  if (language === 'plaintext' || code.length > HIGHLIGHT_LIMIT) return escapeHtml(code);
  try { return hljs.highlight(code, { language, ignoreIllegals: true }).value; } catch { return escapeHtml(code); }
}

/** The coloured code line by line: spans open at a line's end are closed there and opened again on the next line. */
export function highlightLines(code: string, language: CodeLanguage): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let line = '';
  for (const piece of highlight(code, language).split(/(<span[^>]*>|<\/span>|\n)/)) {
    if (!piece) continue;
    if (piece === '\n') { lines.push(line + '</span>'.repeat(open.length)); line = open.join(''); }
    else if (piece.startsWith('<span')) { open.push(piece); line += piece; }
    else if (piece === '</span>') { open.pop(); line += piece; }
    else line += piece;
  }
  lines.push(line + '</span>'.repeat(open.length));
  return lines;
}

const BY_EXTENSION: Record<string, CodeLanguage> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', css: 'css', html: 'xml', htm: 'xml', svg: 'xml', xml: 'xml', md: 'markdown', sh: 'bash',
};
/** The language of a file, from its name. */
export function languageFor(path: string): CodeLanguage {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? 'plaintext' : 'plaintext';
}
