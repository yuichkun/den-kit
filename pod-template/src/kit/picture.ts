// A picture of the part as the browser shows it now, made in the page (den-kit
// asks for it when it looks at the plugin, and the AI sees it): every element is
// copied with the styles the browser computed for it, canvases become pictures,
// pictures and fonts are inlined, and the copy is drawn through an SVG image onto
// a canvas. (The same method den-kit uses for its own screen.)
const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const INHERITED = new Set([
  'color',
  'font-family',
  'font-size',
  'font-style',
  'font-variant',
  'font-weight',
  'font-stretch',
  'font-feature-settings',
  'font-variation-settings',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-align',
  'text-indent',
  'text-transform',
  'text-shadow',
  'white-space',
  'visibility',
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'text-anchor',
  'dominant-baseline',
  '-webkit-text-stroke-width',
  '-webkit-text-stroke-color',
  '-webkit-text-fill-color',
]);
const SKIP_TAGS = new Set(['STYLE', 'SCRIPT', 'TEMPLATE', 'LINK', 'META', 'NOSCRIPT']);

class Defaults {
  private frame = document.createElement('iframe');
  private cache = new Map<string, Map<string, string>>();
  constructor() {
    this.frame.style.cssText =
      'position:fixed;left:-99999px;top:0;width:20px;height:20px;visibility:hidden;border:0';
    document.body.appendChild(this.frame);
  }
  of(el: Element): Map<string, string> {
    const svg = el.namespaceURI === SVG_NS;
    const key = `${svg ? 'svg:' : ''}${el.localName}`;
    let out = this.cache.get(key);
    if (out) return out;
    const doc = this.frame.contentDocument!;
    const probe = svg
      ? doc.createElementNS(SVG_NS, el.localName)
      : doc.createElement(el.localName.includes('-') ? 'div' : el.localName);
    const holder = svg ? doc.createElementNS(SVG_NS, 'svg') : null;
    if (holder) {
      holder.appendChild(probe);
      doc.body.appendChild(holder);
    } else doc.body.appendChild(probe);
    const cs = this.frame.contentWindow!.getComputedStyle(probe);
    out = new Map();
    for (let i = 0; i < cs.length; i++) {
      const p = cs[i]!;
      out.set(p, cs.getPropertyValue(p));
    }
    (holder ?? probe).remove();
    this.cache.set(key, out);
    return out;
  }
  dispose() {
    this.frame.remove();
  }
}

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
const inlined = new Map<string, Promise<string | null>>();
function data(url: string): Promise<string | null> {
  if (url.startsWith('data:')) return Promise.resolve(url);
  let p = inlined.get(url);
  if (!p) {
    p = fetch(url)
      .then(r => (r.ok ? r.blob() : null))
      .then(b => (b ? toDataUrl(b) : null))
      .catch(() => null);
    inlined.set(url, p);
  }
  return p;
}

interface Ctx {
  defaults: Defaults;
  work: Promise<unknown>[];
  families: Set<string>;
}

function styleOf(el: Element, cs: CSSStyleDeclaration, ctx: Ctx): string {
  const base = ctx.defaults.of(el);
  const out: string[] = [];
  for (let i = 0; i < cs.length; i++) {
    const p = cs[i]!;
    if (p.startsWith('--')) continue;
    const v = cs.getPropertyValue(p);
    if (INHERITED.has(p) || base.get(p) !== v) out.push(`${p}:${v}`);
  }
  for (const f of (cs.getPropertyValue('font-family') || '').split(','))
    ctx.families.add(f.trim().replace(/^["']|["']$/g, ''));
  return out.join(';');
}

function copy(node: Node, ctx: Ctx): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent ?? '');
  if (!(node instanceof Element) || SKIP_TAGS.has(node.tagName)) return null;
  const cs = getComputedStyle(node);
  if (cs.display === 'none') return null;
  let out: Element;
  if (node instanceof HTMLCanvasElement) {
    out = document.createElementNS(XHTML_NS, 'img');
    try {
      out.setAttribute('src', node.toDataURL('image/png'));
    } catch {
      /* a canvas we cannot read stays empty */
    }
  } else if (node instanceof HTMLImageElement) {
    const img = document.createElementNS(XHTML_NS, 'img');
    const src = node.currentSrc || node.src;
    if (src)
      ctx.work.push(
        data(src).then(d => {
          if (d) img.setAttribute('src', d);
        }),
      );
    out = img;
  } else if (node.namespaceURI === SVG_NS) {
    out = document.createElementNS(SVG_NS, node.localName);
    for (const a of node.attributes)
      if (a.name !== 'style' && !a.name.startsWith('on'))
        out.setAttributeNS(a.namespaceURI, a.name, a.value);
  } else {
    out = document.createElementNS(
      XHTML_NS,
      node.localName.includes('-') || node.shadowRoot ? 'div' : node.localName,
    );
    for (const a of node.attributes)
      if (
        !['style', 'src', 'srcset'].includes(a.name) &&
        !a.name.startsWith('on') &&
        !a.name.includes(':')
      )
        out.setAttribute(a.name, a.value);
  }
  let style = styleOf(node, cs, ctx);
  const bg = cs.getPropertyValue('background-image');
  if (bg.includes('url(')) {
    const target = out;
    ctx.work.push(
      (async () => {
        let value = bg;
        for (const m of bg.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
          const d = await data(m[2]!);
          value = value.replace(m[0], d ? `url("${d}")` : 'none');
        }
        style = style.replace(bg, value);
        target.setAttribute('style', style);
      })(),
    );
  }
  out.setAttribute('style', style);
  for (const child of (node.shadowRoot ?? node).childNodes) {
    const c = copy(child, ctx);
    if (c) out.appendChild(c);
  }
  return out;
}

async function fontCss(families: Set<string>): Promise<string> {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(list)) {
      if (
        !(rule instanceof CSSFontFaceRule) ||
        !families.has(rule.style.getPropertyValue('font-family').replace(/^["']|["']$/g, ''))
      )
        continue;
      let text = rule.cssText;
      for (const m of text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
        const d = await data(new URL(m[2]!, sheet.href ?? document.baseURI).href);
        text = text.replace(m[0], d ? `url("${d}")` : 'local("none")');
      }
      rules.push(text);
    }
  }
  return rules.join('\n');
}

/** A PNG (data: URL) of `root` at `size` (the part's box). */
export async function picture(
  root: HTMLElement,
  size: { width: number; height: number },
): Promise<string> {
  const defaults = new Defaults();
  try {
    const ctx: Ctx = { defaults, work: [], families: new Set() };
    const copied = copy(root, ctx) as Element | null;
    if (!copied) throw new Error('The part shows nothing.');
    copied.setAttribute(
      'style',
      `${copied.getAttribute('style') ?? ''};position:absolute;left:0;top:0;margin:0`,
    );
    await Promise.all(ctx.work);
    const fonts = await fontCss(ctx.families);
    const width = Math.max(1, Math.round(size.width)),
      height = Math.max(1, Math.round(size.height));
    const holder = document.createElementNS(XHTML_NS, 'div');
    holder.setAttribute(
      'style',
      `position:relative;width:${width}px;height:${height}px;overflow:hidden`,
    );
    if (fonts) {
      const st = document.createElementNS(XHTML_NS, 'style');
      st.textContent = fonts;
      holder.appendChild(st);
    }
    holder.appendChild(copied);
    const svg = `<svg xmlns="${SVG_NS}" width="${width}" height="${height}"><foreignObject x="0" y="0" width="${width}" height="${height}">${new XMLSerializer().serializeToString(holder)}</foreignObject></svg>`;
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/png');
  } finally {
    defaults.dispose();
  }
}
