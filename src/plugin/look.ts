// Looking at the plugin the way a person would: draw it off-screen at its design
// size, see where the browser put each text and label, ask canvases whether
// they work, take a picture without text to see what is behind each text, and
// run the screen checks (checks.ts) on all of it. The AI gets the problems (and
// the picture, when its model accepts images); the plugin view shows the same
// problems to the person.
import { createApp, h, nextTick, type App } from 'vue';
import type { Catalog } from '../core/catalog.ts';
import type { Generated } from '../core/codegen.ts';
import type { PatchDocument } from '../core/schema.ts';
import { assetFontFamily, isFontAsset } from '../core/ui.ts';
import { pluginSpec } from './build.ts';
import { capture, pngBytes } from './capture.ts';
import { checkPlugin, contrastIssues, textOverlaps, type PluginIssue, type TextBox } from './checks.ts';
import type { Rect } from './spec.ts';
import PluginWindow from './PluginWindow.vue';

export interface LookOptions {
  generated: Pick<Generated, 'probes'>;
  assetUrls: Readonly<Record<string, string>>;
  analyser?: (probe: number) => AnalyserNode | null;
  /** Also return a picture of the plugin (PNG). */
  picture?: boolean;
  /** The longest side of the picture, in pixels (the design size is scaled down to fit). */
  maxSide?: number;
}
export interface LookResult { issues: PluginIssue[]; png: Uint8Array | null; width: number; height: number; ms: number }

const frames = (n: number) => new Promise<void>(resolve => { const step = (k: number) => k <= 0 ? resolve() : requestAnimationFrame(() => step(k - 1)); step(n); });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** The plugin drawn off-screen at scale 1 (its design size), playing nothing. */
async function mount(doc: PatchDocument, catalog: Catalog, options: LookOptions): Promise<{ panel: HTMLElement; app: App; host: HTMLElement }> {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.dataset.lookHost = '';
  host.style.cssText = `position:fixed;left:-30000px;top:0;width:${doc.panel.width}px;height:${doc.panel.height}px;pointer-events:none;overflow:hidden`;
  document.body.appendChild(host);
  const spec = pluginSpec(doc, catalog, options.generated);
  const app = createApp({ render: () => h(PluginWindow, { spec, preview: true, analyser: options.analyser, assetUrls: options.assetUrls }) });
  app.mount(host);
  await nextTick();
  await document.fonts.ready;
  const panel = host.querySelector<HTMLElement>('[data-testid=panel]');
  if (!panel) { app.unmount(); host.remove(); throw new Error('The plugin did not draw.'); }
  // Pictures load, controls lay out and canvases draw their first frames.
  await Promise.all([...host.querySelectorAll('img')].map(img => img.complete ? null : img.decode().catch(() => null)));
  await frames(3);
  if (host.querySelector('[data-element] canvas')) await wait(350);
  await frames(2);
  return { panel, app, host };
}

/** Where `el` is, in design pixels of the panel (scale 1, at the panel's corner). */
function rectIn(el: Element | DOMRect, panel: DOMRect): Rect {
  const r = el instanceof DOMRect ? el : el.getBoundingClientRect();
  return { x: r.left - panel.left, y: r.top - panel.top, w: r.width, h: r.height };
}
/** How see-through an element is, all the way up (through shadow roots) to the panel. */
function opacityUp(el: Element, stop: Element): number {
  let o = 1;
  for (let e: Element | null = el; e && e !== stop; e = e.parentElement ?? ((e.getRootNode() as ShadowRoot).host ?? null)) o *= Number(getComputedStyle(e).opacity) || 0;
  return o;
}
function rgba(css: string): [number, number, number, number] {
  const m = /rgba?\(([^)]+)\)/.exec(css);
  if (!m) return [0, 0, 0, 1];
  const parts = m[1]!.split(/[,\s/]+/).filter(Boolean).map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
}
function textBox(id: string, what: string, kind: TextBox['kind'], el: Element, rect: Rect, panel: Element): TextBox {
  const cs = getComputedStyle(el);
  const color = rgba(cs.color);
  color[3] *= opacityUp(el, panel);
  return { id, what, kind, rect, color, size: parseFloat(cs.fontSize) || 12, bold: Number(cs.fontWeight) >= 600 };
}
/** The canvas of a line box where the letters are (a line box has room above and below them). */
const inked = (r: Rect): Rect => ({ x: r.x, y: r.y + r.h * 0.18, w: r.w, h: r.h * 0.64 });
const union = (rects: Rect[]): Rect => {
  const x0 = Math.min(...rects.map(r => r.x)), y0 = Math.min(...rects.map(r => r.y));
  return { x: x0, y: y0, w: Math.max(...rects.map(r => r.x + r.w)) - x0, h: Math.max(...rects.map(r => r.y + r.h)) - y0 };
};
const label = (doc: PatchDocument, id: string) => { const n = doc.nodes[id]; const el = doc.ui.elements[id]; return n ? `${id} ("${n.label ?? id}")` : el?.name ? `${id} ("${el.name}")` : id; };

interface Measured { boxes: TextBox[]; lines: Array<{ id: string; what: string; rects: Rect[] }>; controls: Array<{ id: string; what: string; rect: Rect }>; issues: PluginIssue[] }

/** What the browser drew: where the words are, what does not fit, what failed. */
function measure(doc: PatchDocument, panel: HTMLElement): Measured {
  const box = panel.getBoundingClientRect();
  const out: Measured = { boxes: [], lines: [], controls: [], issues: [] };
  for (const cell of panel.querySelectorAll<HTMLElement>('[data-element]')) {
    const id = cell.dataset.element!;
    const el = doc.ui.elements[id];
    const text = cell.querySelector<HTMLElement>('.text');
    if (el?.kind === 'text' && text && text.textContent?.trim()) {
      const range = document.createRange();
      range.selectNodeContents(text);
      const rects = [...range.getClientRects()].filter(r => r.width > 0.5 && r.height > 0.5).map(r => rectIn(r, box));
      if (!rects.length) continue;
      const what = `The text ${label(doc, id)}`;
      // A turned text is drawn on purpose where it is; its boxes on screen are bigger than its letters.
      if (!el.style?.rotate) out.lines.push({ id, what, rects: rects.map(inked) });
      const all = union(rects);
      out.boxes.push(textBox(id, what, 'text', text, all, panel));
      if (!el.style?.rotate) {
        const r = el.rect;
        const wide = all.x < r.x - 2 || all.x + all.w > r.x + r.w + 2, tall = all.y + all.h > r.y + r.h + Math.max(4, (el.textStyle?.size ?? 14) * 0.35);
        if (wide || tall) out.issues.push({ code: 'text-overflow', ids: [id], message: `${what} does not fit its box (${Math.round(r.w)}×${Math.round(r.h)}; the words need about ${Math.ceil(all.w)}×${Math.ceil(all.h)}): make the box ${wide ? 'wider' : 'taller'}, the text smaller, or the words fewer.`, severity: 'warn' });
      }
    }
    const error = cell.querySelector('[data-canvas-error]')?.getAttribute('data-canvas-error');
    if (error) out.issues.push({ code: 'canvas-error', ids: [id], message: `The canvas ${label(doc, id)} fails: ${error}`, severity: 'error' });
    for (const img of cell.querySelectorAll('img')) if (img.complete && !img.naturalWidth && img.getAttribute('src')) out.issues.push({ code: 'missing-asset', ids: [id], message: `The picture in ${label(doc, id)} could not be loaded.`, severity: 'error' });
    if (cell.querySelector('.missing')) out.issues.push({ code: 'missing-asset', ids: [id], message: `The picture of ${label(doc, id)} is missing (its file is not in this browser).`, severity: 'error' });
  }
  for (const cell of panel.querySelectorAll<HTMLElement>('[data-widget]')) {
    const id = cell.dataset.widget!;
    const host = [...cell.children].find(c => c.tagName.startsWith('DK-'));
    out.controls.push({ id, what: `the control ${label(doc, id)}`, rect: rectIn(cell, box) });
    const root = host?.shadowRoot;
    if (!root) continue;
    for (const row of root.querySelectorAll<HTMLElement>('.label, .value')) {
      if (!row.textContent?.trim() || row.getClientRects().length === 0) continue;
      const kind = row.classList.contains('label') ? 'label' : 'value';
      const r = rectIn(row, box);
      // The text inside the row (a centred row is wider than its words).
      const range = document.createRange();
      range.selectNodeContents(row);
      const words = [...range.getClientRects()].filter(x => x.width > 0.5).map(x => rectIn(x, box));
      out.boxes.push(textBox(id, `The ${kind} of ${label(doc, id)}`, kind, row, words.length ? union(words) : r, panel));
      // Shrunk to fit: the control is too narrow for its words.
      if (row.style.fontSize) {
        const shrunk = parseFloat(row.style.fontSize);
        row.style.fontSize = '';
        const natural = parseFloat(getComputedStyle(row).fontSize);
        row.style.fontSize = `${shrunk}px`;
        if (shrunk < natural * 0.75) out.issues.push({ code: 'squeezed', ids: [id], message: `The ${kind} of ${label(doc, id)}${kind === 'value' ? ` ("${row.textContent.trim()}")` : ''} is squeezed to ${shrunk.toFixed(1)} px to fit; make the control wider or the words shorter.`, severity: 'warn' });
      }
    }
  }
  return out;
}

/** Look the plugin over: every problem found, and a picture of it when asked. */
export async function lookAt(doc: PatchDocument, catalog: Catalog, options: LookOptions): Promise<LookResult> {
  const started = performance.now();
  const structural = checkPlugin(doc, catalog);
  if (structural.length === 1 && structural[0]!.code === 'empty') return { issues: structural, png: null, width: 0, height: 0, ms: Math.round(performance.now() - started) };
  const { panel, app, host } = await mount(doc, catalog, options);
  try {
    const measured = measure(doc, panel);
    const W = doc.panel.width, H = doc.panel.height;
    const fontUrls = Object.fromEntries(Object.values(doc.assets).filter(isFontAsset).flatMap(a => options.assetUrls[a.id] ? [[assetFontFamily(a.id), options.assetUrls[a.id]!]] : []));
    const base = { width: W, height: H, fontUrls, rootStyle: { transform: 'none' } };
    // With and without the letters (keeping their shadows, and not): the difference finds the letters, the rest is what is behind them.
    const full = await capture(panel, base);
    const bare = await capture(panel, { ...base, hideText: 'letters' });
    const plain = await capture(panel, { ...base, hideText: 'all' });
    const pixels = (c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    const shown = pixels(full.canvas);
    const contrast = contrastIssues(measured.boxes, [{ bare: pixels(bare.canvas), full: shown }, { bare: pixels(plain.canvas), full: shown }]);
    const issues = [...structural, ...measured.issues, ...textOverlaps(measured.lines, measured.controls), ...contrast];
    let png: Uint8Array | null = null, width = 0, height = 0;
    if (options.picture) {
      const scale = Math.min(1, (options.maxSide ?? 1200) / Math.max(W, H));
      const shot = scale === 1 ? full : await capture(panel, { ...base, scale });
      png = await pngBytes(shot.canvas);
      width = shot.width; height = shot.height;
    }
    return { issues: dedupe(issues), png, width, height, ms: Math.round(performance.now() - started) };
  } finally {
    app.unmount();
    host.remove();
  }
}

/** One problem per kind and thing (the same overlap found twice says it once). */
function dedupe(issues: PluginIssue[]): PluginIssue[] {
  const seen = new Set<string>();
  return issues.filter(i => { const key = `${i.code}|${[...i.ids].sort().join(',')}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
