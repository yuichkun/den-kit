// Panel widgets as framework-free Web Components. They talk only through
// properties/attributes in and DOM events out (`input` while dragging, `change`
// on release, `note` for the keyboard), so a future custom widget or an
// iframe-isolated UI can replace them. Styling comes from CSS variables
// (--dk-bg, --dk-fg, --dk-accent, --dk-track, --dk-font) set by the panel theme.

const BASE_CSS = `:host{display:block;box-sizing:border-box;width:100%;height:100%;font:var(--dk-font, 11px/1.2 system-ui, sans-serif);color:var(--dk-fg,#e6e8ec);user-select:none;touch-action:none}
.label{text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.85}
.value{text-align:center;font-variant-numeric:tabular-nums;opacity:.7;font-size:.9em}`;

function formatValue(value: number, unit: string) {
  const abs = Math.abs(value);
  const text = abs >= 1000 ? `${(value / 1000).toFixed(abs >= 10000 ? 1 : 2)}k` : abs >= 100 ? value.toFixed(0) : abs >= 10 ? value.toFixed(1) : value.toFixed(abs >= 1 ? 2 : 3);
  return unit ? `${text} ${unit}` : text;
}

/** 0..1 position of `value`; out-of-range values sit at the ends (Vue sets `value` after min/max/scale, so a log knob briefly sees 0). */
function toUnit(value: number, min: number, max: number, log: boolean) {
  if (!(max > min) || !Number.isFinite(value)) return 0;
  const v = Math.min(max, Math.max(min, value));
  if (log && min > 0) return Math.log(v / min) / Math.log(max / min);
  return (v - min) / (max - min);
}
function fromUnit(u: number, min: number, max: number, log: boolean) {
  const t = Math.min(1, Math.max(0, u));
  if (log && min > 0) return min * (max / min) ** t;
  return min + (max - min) * t;
}
/** SVG arc on the knob's 15-unit circle from angle a0 to a1 (degrees, 0 = up). */
function arc(a0: number, a1: number) {
  const r = 15, cx = 20, cy = 20;
  const p = (a: number) => [cx + r * Math.sin(a * Math.PI / 180), cy - r * Math.cos(a * Math.PI / 180)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

/**
 * Each widget builds its DOM once (and again only when its shape changes: range,
 * label, keys) and repaints in place when its value changes. A rebuild during a
 * drag would drop the element holding the pointer capture, and the release —
 * the end of the gesture (one undo step), or a note-off — would be lost,
 * so shape changes wait until the gesture ends.
 */
abstract class DkElement extends HTMLElement {
  protected root: ShadowRoot;
  /** Attributes that only change what is painted (the rest rebuild). */
  protected static readonly painted: readonly string[] = [];
  /** A pointer gesture is in progress. */
  protected holding = false;
  private stale = false;
  constructor() { super(); this.root = this.attachShadow({ mode: 'open' }); }
  connectedCallback() { this.build(); }
  attributeChangedCallback(name: string) {
    if (!this.root.firstChild) return; // built when connected
    if ((this.constructor as typeof DkElement).painted.includes(name)) { if (!this.holding) this.paint(); return; }
    if (this.holding) { this.stale = true; return; }
    this.build();
  }
  /** The gesture ended: catch up on a shape change that arrived meanwhile. */
  protected ended() { this.holding = false; if (this.stale) { this.stale = false; this.build(); } else this.paint(); }
  protected abstract build(): void;
  protected abstract paint(): void;
  protected num(name: string, fallback: number) { const v = Number(this.getAttribute(name)); return this.hasAttribute(name) && Number.isFinite(v) ? v : fallback; }
  protected emit(type: string, detail: unknown) { this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true })); }
  protected $<T extends Element>(selector: string) { return this.root.querySelector(selector) as T; }
}

/** Rotary knob. Drag vertically (shift = fine), double-click resets, wheel nudges. */
export class DkKnob extends DkElement {
  static observedAttributes = ['value', 'min', 'max', 'scale', 'label', 'unit', 'default'];
  protected static override readonly painted = ['value'];
  get value() { return this.num('value', 0); }
  set value(v: number) { this.setAttribute('value', String(v)); }
  private range() { return { min: this.num('min', 0), max: this.num('max', 1), log: this.getAttribute('scale') === 'log' }; }
  protected build() {
    // Bitwig-style knob: white disc, black pointer, dark track and an accent value arc.
    this.root.innerHTML = `<style>${BASE_CSS}.wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:3px}svg{width:min(100%,64px);flex:1 1 auto;min-height:24px;cursor:ns-resize;overflow:visible}</style>
      <div class="wrap" part="wrap">
      <svg viewBox="0 0 40 40" part="dial"><path d="${arc(-135, 135)}" stroke="var(--dk-track,#444)" stroke-width="3.5" fill="none"/>
      <path class="arc" stroke="var(--dk-accent,#ff9c1a)" stroke-width="3.5" fill="none"/>
      <circle cx="20" cy="20" r="11.5" fill="var(--dk-knob,#ececec)" style="filter:drop-shadow(0 1px 1px #0009)"/>
      <line class="ptr" stroke="var(--dk-pointer,#111)" stroke-width="2.6" stroke-linecap="round"/></svg>
      <div class="label" part="label">${escapeHtml(this.getAttribute('label') ?? '')}</div>
      <div class="value" part="value"></div></div>`;
    const svg = this.$<SVGSVGElement>('svg');
    svg.addEventListener('pointerdown', e => this.drag(e));
    svg.addEventListener('dblclick', () => { if (this.hasAttribute('default')) this.commit(this.num('default', this.range().min)); });
    svg.addEventListener('wheel', e => { e.preventDefault(); const { min, max, log } = this.range(); this.commit(fromUnit(toUnit(this.value, min, max, log) - Math.sign(e.deltaY) * 0.02, min, max, log)); }, { passive: false });
    this.paint();
  }
  protected paint() {
    const { min, max, log } = this.range();
    const u = toUnit(this.value, min, max, log), angle = -135 + 270 * u;
    const value = this.$<SVGPathElement>('.arc'), ptr = this.$<SVGLineElement>('.ptr');
    value.setAttribute('d', u > 0.001 ? arc(-135, angle) : 'M0 0');
    value.style.display = u > 0.001 ? '' : 'none';
    const sin = Math.sin(angle * Math.PI / 180), cos = Math.cos(angle * Math.PI / 180);
    ptr.setAttribute('x1', String(20 + 1.5 * sin)); ptr.setAttribute('y1', String(20 - 1.5 * cos));
    ptr.setAttribute('x2', String(20 + 8.5 * sin)); ptr.setAttribute('y2', String(20 - 8.5 * cos));
    this.$<HTMLElement>('.value').textContent = formatValue(this.value, this.getAttribute('unit') ?? '');
  }
  private drag(e: PointerEvent) {
    e.preventDefault();
    const target = e.currentTarget as Element;
    target.setPointerCapture(e.pointerId);
    this.holding = true;
    const { min, max, log } = this.range();
    const startY = e.clientY, startU = toUnit(this.value, min, max, log);
    const move = (m: PointerEvent) => {
      const next = fromUnit(startU + (startY - m.clientY) / (m.shiftKey ? 800 : 160), min, max, log);
      this.setAttribute('value', String(next)); this.paint();
      this.emit('input', next);
    };
    const up = () => { target.removeEventListener('pointermove', move as EventListener); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up); this.ended(); this.emit('change', this.value); };
    target.addEventListener('pointermove', move as EventListener);
    target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up);
  }
  private commit(value: number) { this.value = value; this.emit('input', value); this.emit('change', value); }
}

/** Linear slider (vertical when taller than wide). */
export class DkSlider extends DkElement {
  static observedAttributes = ['value', 'min', 'max', 'scale', 'label', 'unit'];
  protected static override readonly painted = ['value'];
  private observer: ResizeObserver | null = null;
  get value() { return this.num('value', 0); }
  override connectedCallback() { super.connectedCallback(); this.observer ??= new ResizeObserver(() => this.paint()); this.observer.observe(this); }
  disconnectedCallback() { this.observer?.disconnect(); }
  private vertical() { return this.clientHeight > this.clientWidth * 1.4; }
  protected build() {
    this.root.innerHTML = `<style>${BASE_CSS}.wrap{display:flex;flex-direction:column;height:100%;gap:2px}.track{position:relative;flex:1;background:var(--dk-track,#3a3f48);border-radius:4px;cursor:pointer;min-height:8px}.fill{position:absolute;background:var(--dk-accent,#5ec4ff);border-radius:4px}</style>
      <div class="wrap"><div class="label">${escapeHtml(this.getAttribute('label') ?? '')}</div><div class="track" part="track"><div class="fill"></div></div><div class="value"></div></div>`;
    const track = this.$<HTMLElement>('.track');
    track.addEventListener('pointerdown', e => {
      track.setPointerCapture(e.pointerId);
      this.holding = true;
      const min = this.num('min', 0), max = this.num('max', 1), log = this.getAttribute('scale') === 'log', vertical = this.vertical();
      const set = (m: PointerEvent) => {
        const r = track.getBoundingClientRect();
        const value = fromUnit(vertical ? 1 - (m.clientY - r.top) / r.height : (m.clientX - r.left) / r.width, min, max, log);
        this.setAttribute('value', String(value)); this.paint(); this.emit('input', value);
      };
      set(e);
      const up = () => { track.removeEventListener('pointermove', set as EventListener); track.removeEventListener('pointerup', up); track.removeEventListener('pointercancel', up); this.ended(); this.emit('change', this.value); };
      track.addEventListener('pointermove', set as EventListener); track.addEventListener('pointerup', up); track.addEventListener('pointercancel', up);
    });
    this.paint();
  }
  protected paint() {
    const fill = this.$<HTMLElement>('.fill'); if (!fill) return;
    const u = toUnit(this.value, this.num('min', 0), this.num('max', 1), this.getAttribute('scale') === 'log');
    fill.removeAttribute('style');
    Object.assign(fill.style, this.vertical() ? { left: '0', right: '0', bottom: '0', height: `${u * 100}%` } : { left: '0', top: '0', bottom: '0', width: `${u * 100}%` });
    this.$<HTMLElement>('.value').textContent = formatValue(this.value, this.getAttribute('unit') ?? '');
  }
}

/** On/off switch (toggle) or momentary button. */
export class DkToggle extends DkElement {
  static observedAttributes = ['value', 'label', 'momentary'];
  protected static override readonly painted = ['value'];
  get value() { return this.getAttribute('value') === 'true' || this.getAttribute('value') === '1'; }
  protected build() {
    const momentary = this.hasAttribute('momentary');
    this.root.innerHTML = `<style>${BASE_CSS}button{width:100%;height:100%;border-radius:6px;border:1px solid var(--dk-track,#3a3f48);background:transparent;color:var(--dk-fg,#e6e8ec);font:inherit;cursor:pointer}button.on{background:var(--dk-accent,#5ec4ff);color:var(--dk-bg,#14161a)}</style><button part="button">${escapeHtml(this.getAttribute('label') ?? (momentary ? 'Push' : 'On/Off'))}</button>`;
    const button = this.$<HTMLButtonElement>('button');
    const set = (on: boolean) => { this.setAttribute('value', String(on)); this.paint(); this.emit('input', on); this.emit('change', on); };
    if (momentary) {
      button.addEventListener('pointerdown', e => { button.setPointerCapture(e.pointerId); this.holding = true; set(true); });
      const release = () => { if (!this.holding) return; set(false); this.ended(); };
      button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
    } else button.addEventListener('click', () => set(!this.value));
    this.paint();
  }
  protected paint() {
    const button = this.$<HTMLButtonElement>('button'), on = this.value;
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', String(on));
  }
}

/** Two-axis pad, x and y in [0,1]. */
export class DkXy extends DkElement {
  static observedAttributes = ['x', 'y', 'label'];
  protected static override readonly painted = ['x', 'y'];
  protected build() {
    this.root.innerHTML = `<style>${BASE_CSS}.pad{position:relative;width:100%;height:100%;background:var(--dk-track,#3a3f48);border-radius:6px;cursor:crosshair;overflow:hidden}.dot{position:absolute;width:14px;height:14px;margin:-7px;border-radius:50%;background:var(--dk-accent,#5ec4ff)}.label{position:absolute;left:6px;top:4px}</style>
      <div class="pad" part="pad"><div class="label">${escapeHtml(this.getAttribute('label') ?? '')}</div><div class="dot"></div></div>`;
    const pad = this.$<HTMLElement>('.pad');
    pad.addEventListener('pointerdown', e => {
      pad.setPointerCapture(e.pointerId);
      this.holding = true;
      const set = (m: PointerEvent) => {
        const r = pad.getBoundingClientRect();
        const nx = Math.min(1, Math.max(0, (m.clientX - r.left) / r.width)), ny = Math.min(1, Math.max(0, 1 - (m.clientY - r.top) / r.height));
        this.setAttribute('x', String(nx)); this.setAttribute('y', String(ny)); this.paint(); this.emit('input', { x: nx, y: ny });
      };
      set(e);
      const up = () => { pad.removeEventListener('pointermove', set as EventListener); pad.removeEventListener('pointerup', up); pad.removeEventListener('pointercancel', up); this.ended(); this.emit('change', { x: this.num('x', 0.5), y: this.num('y', 0.5) }); };
      pad.addEventListener('pointermove', set as EventListener); pad.addEventListener('pointerup', up); pad.addEventListener('pointercancel', up);
    });
    this.paint();
  }
  protected paint() {
    const dot = this.$<HTMLElement>('.dot');
    dot.style.left = `${this.num('x', 0.5) * 100}%`; dot.style.top = `${(1 - this.num('y', 0.5)) * 100}%`;
  }
}

/**
 * Keyboard; emits `note` {note, on}. `start` (MIDI note, default from `octave`),
 * `octaves` (default 2), `held` (comma list), and `pc` = the MIDI note where the
 * computer-keyboard letters (A W S E D F T G Y H U J K) are printed on the keys.
 */
export class DkKeyboard extends DkElement {
  static observedAttributes = ['octave', 'start', 'octaves', 'held', 'pc'];
  protected static override readonly painted = ['held'];
  private down = new Map<number, number>();
  override attributeChangedCallback(name: string) {
    // Lit keys follow `held` even while a key is pressed (another key, the computer keyboard, MIDI).
    if (name === 'held' && this.root.firstChild) { this.paint(); return; }
    super.attributeChangedCallback(name);
  }
  protected build() {
    const start = this.hasAttribute('start') ? this.num('start', 48) : 12 * (this.num('octave', 4) + 1);
    const octaves = Math.max(1, Math.min(8, this.num('octaves', 2)));
    const pc = this.hasAttribute('pc') ? this.num('pc', start) : null;
    const letter = (n: number) => pc !== null && n >= pc && n <= pc + 12 ? 'AWSEDFTGYHUJK'[n - pc] : '';
    const whites: number[] = [], blacks: Array<{ note: number; at: number }> = [];
    for (let n = start, w = 0; n <= start + 12 * octaves; n++) { if ([1, 3, 6, 8, 10].includes(n % 12)) blacks.push({ note: n, at: w }); else { whites.push(n); w++; } }
    const ww = 100 / whites.length;
    const label = (n: number) => `${letter(n) ? `<span class="k">${letter(n)}</span>` : ''}${n % 12 === 0 ? `<span class="c">C${Math.floor(n / 12) - 1}</span>` : ''}`;
    this.root.innerHTML = `<style>${BASE_CSS}.kb{position:relative;width:100%;height:100%;user-select:none}.w,.b{position:absolute;top:0;border:1px solid #222;border-radius:0 0 4px 4px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;padding-bottom:4px;gap:1px;font:600 10px/1 Lato,system-ui,sans-serif}.w{height:100%;background:#f3f3f3;color:#555}.b{height:60%;background:#222;z-index:1;color:#bbb}.on{background:var(--dk-accent,#5ec4ff)!important;color:#111!important}.k{font-size:11px}.c{font-weight:400;font-size:9px;color:#999}</style>
      <div class="kb" part="keyboard">${whites.map((n, i) => `<div class="w" data-note="${n}" style="left:${i * ww}%;width:${ww}%">${label(n)}</div>`).join('')}${blacks.map(b => `<div class="b" data-note="${b.note}" style="left:${b.at * ww - ww * 0.3}%;width:${ww * 0.6}%">${label(b.note)}</div>`).join('')}</div>`;
    const kb = this.$<HTMLElement>('.kb');
    const noteAt = (e: PointerEvent) => { const el = (this.root.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest?.('[data-note]') as HTMLElement | null; return el?.dataset.note ? Number(el.dataset.note) : null; };
    kb.addEventListener('pointerdown', e => { kb.setPointerCapture(e.pointerId); const n = noteAt(e); if (n === null) return; this.holding = true; this.down.set(e.pointerId, n); this.emit('note', { note: n, on: true }); });
    kb.addEventListener('pointermove', e => { if (!this.down.has(e.pointerId)) return; const n = noteAt(e); const old = this.down.get(e.pointerId)!; if (n !== null && n !== old) { this.emit('note', { note: old, on: false }); this.down.set(e.pointerId, n); this.emit('note', { note: n, on: true }); } });
    const up = (e: PointerEvent) => { const n = this.down.get(e.pointerId); if (n === undefined) return; this.down.delete(e.pointerId); this.emit('note', { note: n, on: false }); if (!this.down.size) this.ended(); };
    kb.addEventListener('pointerup', up); kb.addEventListener('pointercancel', up);
    this.paint();
  }
  protected paint() {
    const held = new Set((this.getAttribute('held') ?? '').split(',').filter(Boolean).map(Number));
    for (const key of this.root.querySelectorAll<HTMLElement>('[data-note]')) key.classList.toggle('on', held.has(Number(key.dataset.note)));
  }
}

/** Scope/meter: the host sets `.analyser` (an AnalyserNode) and the element draws itself. */
export class DkScope extends DkElement {
  static observedAttributes = ['label', 'mode'];
  analyser: AnalyserNode | null = null;
  private frame = 0;
  /** The canvas is made once; `mode` and `label` are read as it draws. */
  protected build() {}
  protected paint() {}
  override connectedCallback() {
    this.root.innerHTML = `<style>${BASE_CSS}canvas{width:100%;height:100%;display:block;background:var(--dk-track,#1d2026);border-radius:6px}</style><canvas part="canvas"></canvas>`;
    const draw = () => { this.frame = requestAnimationFrame(draw); this.draw(); };
    this.frame = requestAnimationFrame(draw);
  }
  disconnectedCallback() { cancelAnimationFrame(this.frame); }
  private draw() {
    const canvas = this.root.querySelector('canvas'); if (!canvas) return;
    const w = canvas.width = canvas.clientWidth * devicePixelRatio, h = canvas.height = canvas.clientHeight * devicePixelRatio;
    const g = canvas.getContext('2d'); if (!g || !w || !h) return;
    const styles = getComputedStyle(this);
    g.clearRect(0, 0, w, h);
    g.fillStyle = g.strokeStyle = styles.getPropertyValue('--dk-accent').trim() || '#5ec4ff';
    const data = new Float32Array(this.analyser?.fftSize ?? 512);
    this.analyser?.getFloatTimeDomainData(data);
    if (this.getAttribute('mode') === 'meter') {
      let peak = 0; for (const s of data) peak = Math.max(peak, Math.abs(s));
      const db = 20 * Math.log10(peak + 1e-9), t = Math.max(0, Math.min(1, (db + 60) / 60));
      if (w > h) g.fillRect(0, 0, w * t, h); else g.fillRect(0, h * (1 - t), w, h * t);
      return;
    }
    g.lineWidth = 1.5 * devicePixelRatio; g.beginPath();
    for (let i = 0; i < data.length; i++) { const x = i / (data.length - 1) * w, y = h / 2 - data[i]! * h / 2 * 0.9; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke();
  }
}

function escapeHtml(text: string) { return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }

export function defineWidgets() {
  const define = (name: string, ctor: CustomElementConstructor) => { if (!customElements.get(name)) customElements.define(name, ctor); };
  define('dk-knob', DkKnob); define('dk-slider', DkSlider); define('dk-toggle', DkToggle); define('dk-xy', DkXy); define('dk-keyboard', DkKeyboard); define('dk-scope', DkScope);
}

export const PANEL_THEMES: Record<string, Record<string, string>> = {
  graphite: { '--dk-bg': '#2c2c2c', '--dk-fg': '#d6d6d6', '--dk-accent': '#ff9c1a', '--dk-track': '#454545', '--dk-font': '12px/1.2 Lato, system-ui, sans-serif' },
  paper: { '--dk-bg': '#f4f1ea', '--dk-fg': '#2b2a27', '--dk-accent': '#d2552e', '--dk-track': '#d8d2c4', '--dk-font': '11px/1.2 Georgia, serif' },
  neon: { '--dk-bg': '#0b0717', '--dk-fg': '#f5e9ff', '--dk-accent': '#ff3cac', '--dk-track': '#2b1e47', '--dk-font': '11px/1.2 "Courier New", monospace' },
  studio: { '--dk-bg': '#26282b', '--dk-fg': '#f0e6d2', '--dk-accent': '#f2a541', '--dk-track': '#44474c', '--dk-font': '600 11px/1.2 system-ui, sans-serif' },
};
