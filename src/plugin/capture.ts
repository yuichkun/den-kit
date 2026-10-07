// A picture of a canvas of the page as the browser draws it, made in the page:
// the elements (the controls' shadow DOM included) are copied with the styles
// the browser computed for them, canvases become pictures (canvases hand
// over theirs from their workers), pictures and fonts are inlined, and the copy
// is drawn through an SVG image onto a canvas. Nothing leaves the page. Used to
// let the AI look at the plugin (look.ts); `hideText` draws it without any text,
// to measure what is behind each text.
import { canvasSnapshot } from './canvas-runtime.ts';
import { CODE_FRAMES } from './code-frames.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

// Inherited properties are always written out (the copy's parents differ from the
// originals'); the rest only where they differ from a plain element's.
const INHERITED = new Set(['color', 'font-family', 'font-size', 'font-style', 'font-variant', 'font-weight', 'font-stretch', 'font-feature-settings', 'font-variation-settings', 'font-kerning', 'font-optical-sizing', 'font-synthesis', 'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-align-last', 'text-indent', 'text-transform', 'text-shadow', 'text-rendering', 'white-space', 'white-space-collapse', 'text-wrap', 'word-break', 'overflow-wrap', 'line-break', 'hyphens', 'tab-size', 'direction', 'writing-mode', 'text-orientation', 'visibility', 'cursor', 'list-style-type', 'list-style-position', 'list-style-image', 'quotes', '-webkit-text-stroke-width', '-webkit-text-stroke-color', '-webkit-text-fill-color', 'paint-order', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'text-anchor', 'dominant-baseline', 'shape-rendering', 'image-rendering', 'color-interpolation', 'color-interpolation-filters', 'font-variant-numeric', 'font-variant-ligatures', 'font-variant-caps', '-webkit-font-smoothing', 'border-collapse', 'caption-side', 'empty-cells']);
const SKIP_TAGS = new Set(['STYLE', 'SCRIPT', 'TEMPLATE', 'LINK', 'META', 'NOSCRIPT', 'TEXTAREA']);
const URL_PROPS = ['background-image', 'mask-image', '-webkit-mask-image', 'border-image-source', 'list-style-image', 'content'];

export interface CaptureOptions {
  /** Size of the picture in CSS pixels of `root` (it is drawn from its top-left corner). */
  width: number;
  height: number;
  /** Device pixels per CSS pixel in the picture. */
  scale?: number;
  /** Leave out the letters of every text (to see what is behind them): 'letters' keeps their shadows, glows and outlines; 'all' leaves those out too. */
  hideText?: false | 'letters' | 'all';
  /** Fonts registered with the FontFace API (not in a style sheet): family → URL. */
  fontUrls?: Record<string, string>;
  /** Style of the copied root on top of its own (e.g. undo a transform). */
  rootStyle?: Record<string, string>;
}

export interface Captured { canvas: HTMLCanvasElement; width: number; height: number }

class Sandbox {
  private frame: HTMLIFrameElement;
  private cache = new Map<string, Map<string, string>>();
  constructor() {
    this.frame = document.createElement('iframe');
    this.frame.style.cssText = 'position:fixed;left:-99999px;top:0;width:20px;height:20px;visibility:hidden;border:0';
    this.frame.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.frame);
  }
  /** The computed style of a plain element of this kind (the browser's defaults). */
  defaults(el: Element): Map<string, string> {
    const svg = el.namespaceURI === SVG_NS;
    const key = `${svg ? 'svg:' : ''}${el.localName}`;
    let out = this.cache.get(key);
    if (out) return out;
    const doc = this.frame.contentDocument!;
    const probe = svg ? doc.createElementNS(SVG_NS, el.localName) : doc.createElement(svg ? 'div' : (el.localName.includes('-') ? 'div' : el.localName));
    const holder = svg ? doc.createElementNS(SVG_NS, 'svg') : null;
    if (holder) { holder.appendChild(probe); doc.body.appendChild(holder); } else doc.body.appendChild(probe);
    const cs = this.frame.contentWindow!.getComputedStyle(probe);
    out = new Map();
    for (let i = 0; i < cs.length; i++) { const p = cs[i]!; out.set(p, cs.getPropertyValue(p)); }
    (holder ?? probe).remove();
    this.cache.set(key, out);
    return out;
  }
  dispose() { this.frame.remove(); }
}

async function toDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(blob); });
}

class Inliner {
  private urls = new Map<string, Promise<string | null>>();
  /** A data: URL for a picture or font (null when it cannot be read). */
  data(url: string, base = document.baseURI): Promise<string | null> {
    if (url.startsWith('data:')) return Promise.resolve(url);
    let abs: string;
    try { abs = new URL(url, base).href; } catch { return Promise.resolve(null); }
    let p = this.urls.get(abs);
    if (!p) {
      p = fetch(abs).then(r => r.ok ? r.blob() : null).then(b => b ? toDataUrl(b) : null).catch(() => null);
      this.urls.set(abs, p);
    }
    return p;
  }
}

/** Every url(...) in a CSS value replaced by its data: URL (or none). */
async function inlineUrls(value: string, inliner: Inliner): Promise<string> {
  const found = [...value.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)];
  if (!found.length) return value;
  let out = value;
  for (const m of found) {
    if (m[2]!.startsWith('#')) continue; // an SVG reference, kept
    const data = await inliner.data(m[2]!);
    out = out.replace(m[0], data ? `url("${data}")` : 'none');
  }
  return out;
}

interface Ctx { sandbox: Sandbox; inliner: Inliner; hideText: false | 'letters' | 'all'; families: Set<string>; work: Promise<unknown>[]; scope: number }

function styleOf(el: Element, cs: CSSStyleDeclaration, ctx: Ctx, pseudo = false): Map<string, string> {
  const base = ctx.sandbox.defaults(pseudo ? document.createElement('span') : el);
  const out = new Map<string, string>();
  for (let i = 0; i < cs.length; i++) {
    const p = cs[i]!;
    if (p.startsWith('--')) continue;
    const v = cs.getPropertyValue(p);
    if (INHERITED.has(p) || base.get(p) !== v) out.set(p, v);
  }
  for (const f of (cs.getPropertyValue('font-family') || '').split(',')) ctx.families.add(f.trim().replace(/^["']|["']$/g, ''));
  if (ctx.hideText) {
    // The letters go; with 'letters', their shadows and outlines (drawn in their own colours) stay.
    const stroke = cs.getPropertyValue('-webkit-text-stroke-color');
    out.set('color', 'transparent'); out.set('-webkit-text-fill-color', 'transparent'); out.set('caret-color', 'transparent');
    if (ctx.hideText === 'all') { out.set('text-shadow', 'none'); out.set('-webkit-text-stroke-width', '0px'); }
    else if (stroke) out.set('-webkit-text-stroke-color', stroke);
    if (el.namespaceURI === SVG_NS && (el.localName === 'text' || el.localName === 'tspan')) { out.set('fill', 'transparent'); if (ctx.hideText === 'all') out.set('stroke', 'transparent'); }
  }
  return out;
}

function writeStyle(target: Element, style: Map<string, string>, ctx: Ctx) {
  const apply = () => target.setAttribute('style', [...style].map(([k, v]) => `${k}:${v}`).join(';'));
  const urls = URL_PROPS.filter(p => style.get(p)?.includes('url('));
  if (!urls.length) { apply(); return; }
  ctx.work.push(Promise.all(urls.map(async p => { style.set(p, await inlineUrls(style.get(p)!, ctx.inliner)); })).then(apply));
  apply();
}

/** Copy one node (and what is under it) with its computed style. */
function copy(node: Node, ctx: Ctx, ids: Map<string, string> | null): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent ?? '');
  if (!(node instanceof Element) || SKIP_TAGS.has(node.tagName)) return null;
  const cs = getComputedStyle(node);
  if (cs.display === 'none') return null;
  const svg = node.namespaceURI === SVG_NS;
  let out: Element;
  if (node instanceof HTMLCanvasElement) {
    const img = document.createElementNS(XHTML_NS, 'img') as HTMLImageElement;
    const shot = canvasSnapshot(node);
    if (shot) ctx.work.push(shot.then(b => b ? toDataUrl(b) : '').then(src => { if (src) img.setAttribute('src', src); }));
    else { try { img.setAttribute('src', node.toDataURL('image/png')); } catch { /* a canvas we cannot read stays empty */ } }
    out = img;
  } else if (node instanceof HTMLIFrameElement) {
    // A code part's frame: its page draws a picture of itself (code-frames.ts); nothing else of a frame can be read.
    const img = document.createElementNS(XHTML_NS, 'img');
    const shot = CODE_FRAMES.get(node);
    if (shot) ctx.work.push(shot().then(src => { if (src) img.setAttribute('src', src); }));
    out = img;
  } else if (node instanceof HTMLImageElement) {
    const img = document.createElementNS(XHTML_NS, 'img');
    const src = node.currentSrc || node.src;
    if (src) ctx.work.push(ctx.inliner.data(src).then(d => { if (d) img.setAttribute('src', d); }));
    out = img;
  } else if (svg) {
    out = document.createElementNS(SVG_NS, node.localName);
    for (const a of node.attributes) if (a.name !== 'style' && !a.name.startsWith('on')) out.setAttributeNS(a.namespaceURI, a.name, a.value);
  } else {
    out = document.createElementNS(XHTML_NS, node.localName.includes('-') || node.shadowRoot ? 'div' : node.localName);
    for (const a of node.attributes) if (!['style', 'src', 'srcset', 'id'].includes(a.name) && !a.name.startsWith('on') && !a.name.includes(':')) out.setAttribute(a.name, a.value);
  }
  // Ids inside one control's shadow DOM (gradients, clip paths) get a prefix so two controls' ids do not clash.
  if (ids && node.id) { const fresh = ids.get(node.id) ?? `cap${ctx.scope}-${node.id}`; ids.set(node.id, fresh); out.setAttribute('id', fresh); }
  writeStyle(out, styleOf(node, cs, ctx), ctx);
  const before = pseudoCopy(node, '::before', ctx), after = pseudoCopy(node, '::after', ctx);
  if (before) out.appendChild(before);
  let inner = ids;
  if (node.shadowRoot) { ctx.scope++; inner = new Map(); }
  for (const child of (node.shadowRoot ?? node).childNodes) { const c = copy(child, ctx, inner); if (c) out.appendChild(c); }
  if (after) out.appendChild(after);
  if (node.shadowRoot && inner?.size) renameRefs(out, inner);
  return out;
}

function pseudoCopy(el: Element, which: '::before' | '::after', ctx: Ctx): Element | null {
  const cs = getComputedStyle(el, which);
  const content = cs.getPropertyValue('content');
  if (!content || content === 'none' || content === 'normal') return null;
  const span = document.createElementNS(XHTML_NS, 'span');
  const text = /^["'](.*)["']$/.exec(content)?.[1];
  if (text) span.textContent = text.replace(/\\([0-9a-f]{1,6})\s?/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)));
  const style = styleOf(el, cs, ctx, true);
  style.delete('content');
  writeStyle(span, style, ctx);
  return span;
}

/** Point url(#id) and href="#id" inside a copied control at the prefixed ids. */
function renameRefs(root: Element, ids: Map<string, string>) {
  const swap = (v: string) => v.replace(/url\(\s*(['"]?)#([^'")]+)\1\s*\)/g, (m, _q, id: string) => ids.has(id) ? `url("#${ids.get(id)}")` : m);
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const a of [...el.attributes]) {
      if ((a.localName === 'href') && a.value.startsWith('#') && ids.has(a.value.slice(1))) el.setAttributeNS(a.namespaceURI, a.name, `#${ids.get(a.value.slice(1))}`);
      else if (a.value.includes('url(#') || a.value.includes('url("#') || a.value.includes("url('#")) el.setAttribute(a.name, swap(a.value));
    }
  }
}

/** The @font-face rules (with their files inlined) for the families the copy uses. */
async function fontCss(families: Set<string>, inliner: Inliner, extra: Record<string, string>): Promise<string> {
  const rules: string[] = [];
  const wanted = (family: string) => families.has(family.replace(/^["']|["']$/g, ''));
  for (const sheet of [...document.styleSheets]) {
    let list: CSSRuleList;
    try { list = sheet.cssRules; } catch { continue; }
    for (const rule of [...list]) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      if (!wanted(rule.style.getPropertyValue('font-family'))) continue;
      const base = sheet.href ?? document.baseURI;
      let text = rule.cssText;
      for (const m of [...text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)]) {
        const data = await inliner.data(m[2]!, base);
        text = text.replace(m[0], data ? `url("${data}")` : 'local("none")');
      }
      rules.push(text);
    }
  }
  for (const [family, url] of Object.entries(extra)) {
    if (!families.has(family)) continue;
    const data = await inliner.data(url);
    if (data) rules.push(`@font-face{font-family:"${family}";src:url("${data}")}`);
  }
  return rules.join('\n');
}

/** Draw `root` (as the browser shows it now) into a canvas. */
export async function capture(root: HTMLElement, options: CaptureOptions): Promise<Captured> {
  const sandbox = new Sandbox();
  try {
    const ctx: Ctx = { sandbox, inliner: new Inliner(), hideText: options.hideText ?? false, families: new Set(), work: [], scope: 0 };
    const copied = copy(root, ctx, null) as Element | null;
    if (!copied) throw new Error('Nothing to draw (the plugin is hidden).');
    const style = copied.getAttribute('style') ?? '';
    copied.setAttribute('style', `${style};${Object.entries({ position: 'absolute', left: '0px', top: '0px', margin: '0px', ...options.rootStyle }).map(([k, v]) => `${k}:${v}`).join(';')}`);
    await Promise.all(ctx.work);
    const fonts = await fontCss(ctx.families, ctx.inliner, options.fontUrls ?? {});
    const { width, height } = options;
    const holder = document.createElementNS(XHTML_NS, 'div');
    holder.setAttribute('style', `position:relative;width:${width}px;height:${height}px;overflow:hidden`);
    if (fonts) { const st = document.createElementNS(XHTML_NS, 'style'); st.textContent = fonts; holder.appendChild(st); }
    holder.appendChild(copied);
    const markup = new XMLSerializer().serializeToString(holder);
    const svg = `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="${width}" height="${height}">${markup}</foreignObject></svg>`;
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    const scale = options.scale ?? 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    const g = canvas.getContext('2d')!;
    g.scale(scale, scale);
    g.drawImage(img, 0, 0, width, height);
    return { canvas, width: canvas.width, height: canvas.height };
  } finally { sandbox.dispose(); }
}

export async function pngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not make a PNG of the plugin.');
  return new Uint8Array(await blob.arrayBuffer());
}
