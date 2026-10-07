// What every plugin control shares. Controls are framework-free Web Components:
// properties/attributes in, DOM events out (`input` while dragging, `change` on
// release, `note` for keys), so a custom control or an isolated plugin page can
// replace them. They are drawn from the plugin's tokens, published as CSS custom
// properties (--dk-bg, --dk-fg, --dk-accent, --dk-track, --dk-knob, --dk-pointer,
// --dk-muted, --dk-glow, --dk-font, --dk-label-font, --dk-value-font) that inherit
// into each control's shadow root. A `skin` attribute picks how it looks and
// `params` (JSON) tunes it; picture parameters arrive as URLs.

export { formatValue, toUnit, fromUnit } from '../plugin/format.ts';

export const BASE_CSS = `:host{display:block;box-sizing:border-box;width:100%;height:100%;color:var(--dk-fg,#e6e8ec);font-family:var(--dk-label-font,var(--dk-font,system-ui,sans-serif));font-size:var(--dk-label-size,11px);user-select:none;-webkit-user-select:none;touch-action:none}
*{box-sizing:border-box}
.label{text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dk-label-color,var(--dk-fg,#e6e8ec));font-weight:var(--dk-label-weight,400);letter-spacing:var(--dk-label-spacing,0);text-transform:var(--dk-label-case,none);font-style:var(--dk-label-style,normal);text-shadow:var(--dk-label-shadow,none);-webkit-text-stroke:var(--dk-label-stroke,0);line-height:1.2;opacity:.9;flex:none}
.value{text-align:center;white-space:nowrap;font-family:var(--dk-value-font,var(--dk-font,system-ui));font-variant-numeric:tabular-nums;color:var(--dk-value-color,var(--dk-fg,#e6e8ec));text-shadow:var(--dk-label-shadow,none);opacity:.75;font-size:.92em;line-height:1.2;flex:none}`;

const TOKENS = ['bg', 'fg', 'accent', 'track', 'knob', 'pointer', 'muted', 'glow'];
/** A colour parameter as CSS: tokens become their custom property. */
export const col = (c: unknown, fallback = 'currentColor') => typeof c === 'string' && c ? TOKENS.includes(c) ? `var(--dk-${c})` : c : fallback;

export function escapeHtml(text: string) { return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }
/** A URL for a CSS url() or an <img src>: only blob:, data: and den-kit's own paths. */
export function safeUrl(u: unknown): string {
  if (typeof u !== 'string' || !u) return '';
  return /^(blob:|data:image\/|\/|https?:\/\/(localhost|127\.0\.0\.1)[:/])/.test(u) ? u.replace(/["\\\n]/g, '') : '';
}

/** SVG arc on a circle of radius r around (cx, cy) from angle a0 to a1 (degrees, 0 = up). */
export function arc(a0: number, a1: number, r = 15, cx = 20, cy = 20) {
  const p = (a: number) => [cx + r * Math.sin(a * Math.PI / 180), cy - r * Math.cos(a * Math.PI / 180)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M${x0!.toFixed(3)} ${y0!.toFixed(3)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1!.toFixed(3)} ${y1!.toFixed(3)}`;
}

// Labels and value rows shrink to fit their control: a wider font (another look's) must not clip them.
const live = new Set<DkElement>();
if (typeof document !== 'undefined') document.fonts?.addEventListener?.('loadingdone', () => { for (const el of live) el.fitText(); });

/**
 * Each control builds its DOM once (and again only when its shape changes:
 * range, label, skin) and repaints in place when its value changes. A rebuild
 * during a drag would drop the element holding the pointer capture, and the
 * release — the end of the gesture (one undo step), or a note-off — would be
 * lost, so shape changes wait until the gesture ends.
 */
export abstract class DkElement extends HTMLElement {
  protected root: ShadowRoot;
  /** Attributes that only change what is painted (the rest rebuild). */
  protected static readonly painted: readonly string[] = [];
  /** A pointer gesture is in progress. */
  protected holding = false;
  private stale = false;
  constructor() { super(); this.root = this.attachShadow({ mode: 'open' }); }
  private fitter: ResizeObserver | null = null;
  connectedCallback() {
    this.render();
    live.add(this);
    this.fitter ??= new ResizeObserver(() => this.fitText());
    this.fitter.observe(this);
  }
  disconnectedCallback() { live.delete(this); this.fitter?.disconnect(); }
  attributeChangedCallback(name: string) {
    if (!this.root.firstChild) return; // built when connected
    if ((this.constructor as typeof DkElement).painted.includes(name)) { if (!this.holding) this.paint(); return; }
    if (this.holding) { this.stale = true; return; }
    this.render();
  }
  /** The gesture ended: catch up on a shape change that arrived meanwhile. */
  protected ended() { this.holding = false; if (this.stale) { this.stale = false; this.render(); } else this.paint(); }
  private render() { this.build(); this.fitText(); }
  /** Shrink each label and value row that does not fit across (never below 7 px). */
  fitText() { for (const el of this.root.querySelectorAll<HTMLElement>('.label, .value')) this.fit(el); }
  protected fit(el: HTMLElement) {
    el.style.fontSize = '';
    // A centred row is as wide as its text, so measure it against the room it has (its box, or the control).
    const room = Math.min(el.clientWidth || Infinity, el.parentElement?.clientWidth || Infinity, this.clientWidth || Infinity);
    if (!Number.isFinite(room) || room <= 0 || !el.isConnected) return;
    const over = el.scrollWidth / room;
    if (over > 1.01) el.style.fontSize = `${Math.max(7, parseFloat(getComputedStyle(el).fontSize) / over * 0.97)}px`;
  }
  protected abstract build(): void;
  protected abstract paint(): void;
  protected num(name: string, fallback: number) { const v = Number(this.getAttribute(name)); return this.hasAttribute(name) && Number.isFinite(v) ? v : fallback; }
  protected emit(type: string, detail: unknown) { this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true })); }
  protected $<T extends Element>(selector: string) { return this.root.querySelector(selector) as T; }
  // Not `skin`/`params`: Vue sets a custom element's attributes as properties when it has a property of that name.
  protected get skinName() { return this.getAttribute('skin') ?? ''; }
  /** Skin parameters (JSON in `params`); missing or broken → {}. */
  protected readParams(): Record<string, string | number | boolean> {
    try { const p = JSON.parse(this.getAttribute('params') ?? '{}'); return p && typeof p === 'object' && !Array.isArray(p) ? p : {}; } catch { return {}; }
  }
  /** A parameter of the fallback's type, or the fallback. */
  protected p(params: Record<string, unknown>, key: string, fallback: string): string;
  protected p(params: Record<string, unknown>, key: string, fallback: number): number;
  protected p(params: Record<string, unknown>, key: string, fallback: boolean): boolean;
  protected p(params: Record<string, unknown>, key: string, fallback: string | number | boolean): string | number | boolean {
    const v = params[key];
    return typeof v === typeof fallback ? v as string | number | boolean : fallback;
  }
  /** A colour parameter resolved for a canvas (tokens read from the element's styles). */
  protected canvasColor(c: unknown, fallback: string): string {
    if (typeof c !== 'string' || !c) return fallback;
    if (TOKENS.includes(c)) return getComputedStyle(this).getPropertyValue(`--dk-${c}`).trim() || fallback;
    return c;
  }
  /** The label and value rows around the main part, as the skin's params place them. */
  protected layout(main: string, params: Record<string, unknown>, options: { label?: string; value?: boolean; valueDefault?: string } = {}) {
    const label = options.label ?? this.getAttribute('label') ?? '';
    const labelAt = this.p(params, 'label', 'bottom'), valueAt = options.value === false ? 'none' : this.p(params, 'value', options.valueDefault ?? 'bottom');
    const top = labelAt === 'top' && label ? `<div class="label" part="label">${escapeHtml(label)}</div>` : '';
    const bottom = labelAt === 'bottom' && label ? `<div class="label" part="label">${escapeHtml(label)}</div>` : '';
    const value = valueAt === 'bottom' ? '<div class="value" part="value"></div>' : '';
    return `${top}${main}${bottom}${value}`;
  }
}
