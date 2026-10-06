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

function toUnit(value: number, min: number, max: number, log: boolean) {
  if (max <= min) return 0;
  if (log && min > 0) return Math.log(value / min) / Math.log(max / min);
  return (value - min) / (max - min);
}
function fromUnit(u: number, min: number, max: number, log: boolean) {
  const t = Math.min(1, Math.max(0, u));
  if (log && min > 0) return min * (max / min) ** t;
  return min + (max - min) * t;
}

abstract class DkElement extends HTMLElement {
  protected root: ShadowRoot;
  constructor() { super(); this.root = this.attachShadow({ mode: 'open' }); }
  protected num(name: string, fallback: number) { const v = Number(this.getAttribute(name)); return this.hasAttribute(name) && Number.isFinite(v) ? v : fallback; }
  protected emit(type: string, detail: unknown) { this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true })); }
}

/** Rotary knob. Drag vertically (shift = fine), double-click resets, wheel nudges. */
export class DkKnob extends DkElement {
  static observedAttributes = ['value', 'min', 'max', 'scale', 'label', 'unit', 'default'];
  private dragging = false;
  connectedCallback() { this.render(); }
  attributeChangedCallback() { if (!this.dragging) this.render(); }
  get value() { return this.num('value', 0); }
  set value(v: number) { this.setAttribute('value', String(v)); }
  protected kind() { return 'knob'; }
  private render() {
    const min = this.num('min', 0), max = this.num('max', 1), log = this.getAttribute('scale') === 'log';
    const u = toUnit(this.value, min, max, log);
    const unit = this.getAttribute('unit') ?? '';
    const angle = -135 + 270 * u;
    const r = 15, cx = 20, cy = 20;
    const arc = (a0: number, a1: number) => { const p = (a: number) => [cx + r * Math.sin(a * Math.PI / 180), cy - r * Math.cos(a * Math.PI / 180)]; const [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`; };
    // Bitwig-style knob: white disc, black pointer, dark track and an accent value arc.
    this.root.innerHTML = `<style>${BASE_CSS}.wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:3px}svg{width:min(100%,64px);flex:1 1 auto;min-height:24px;cursor:ns-resize;overflow:visible}</style>
      <div class="wrap" part="wrap">
      <svg viewBox="0 0 40 40" part="dial"><path d="${arc(-135, 135)}" stroke="var(--dk-track,#444)" stroke-width="3.5" fill="none"/>
      ${u > 0.001 ? `<path d="${arc(-135, angle)}" stroke="var(--dk-accent,#ff9c1a)" stroke-width="3.5" fill="none"/>` : ''}
      <circle cx="20" cy="20" r="11.5" fill="var(--dk-knob,#ececec)" style="filter:drop-shadow(0 1px 1px #0009)"/>
      <line x1="${20 + 1.5 * Math.sin(angle * Math.PI / 180)}" y1="${20 - 1.5 * Math.cos(angle * Math.PI / 180)}" x2="${20 + 8.5 * Math.sin(angle * Math.PI / 180)}" y2="${20 - 8.5 * Math.cos(angle * Math.PI / 180)}" stroke="var(--dk-pointer,#111)" stroke-width="2.6" stroke-linecap="round"/></svg>
      <div class="label" part="label">${escapeHtml(this.getAttribute('label') ?? '')}</div>
      <div class="value" part="value">${formatValue(this.value, unit)}</div></div>`;
    const svg = this.root.querySelector('svg')!;
    svg.addEventListener('pointerdown', e => this.drag(e, min, max, log));
    svg.addEventListener('dblclick', () => { if (this.hasAttribute('default')) this.commit(this.num('default', min), true); });
    svg.addEventListener('wheel', e => { e.preventDefault(); const next = fromUnit(toUnit(this.value, min, max, log) - Math.sign(e.deltaY) * 0.02, min, max, log); this.commit(next, true); }, { passive: false });
  }
  private drag(e: PointerEvent, min: number, max: number, log: boolean) {
    e.preventDefault();
    const target = e.currentTarget as Element;
    target.setPointerCapture(e.pointerId);
    this.dragging = true;
    const startY = e.clientY, startU = toUnit(this.value, min, max, log);
    const move = (m: PointerEvent) => {
      const next = fromUnit(startU + (startY - m.clientY) / (m.shiftKey ? 800 : 160), min, max, log);
      this.setAttribute('value', String(next)); this.dragging = false; this.render(); this.dragging = true;
      this.emit('input', next);
    };
    const up = () => { target.removeEventListener('pointermove', move as EventListener); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up); this.dragging = false; this.emit('change', this.value); };
    target.addEventListener('pointermove', move as EventListener);
    target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up);
  }
  private commit(value: number, end: boolean) { this.value = value; this.emit('input', value); if (end) this.emit('change', value); }
}

/** Linear slider (vertical when taller than wide). */
export class DkSlider extends DkElement {
  static observedAttributes = ['value', 'min', 'max', 'scale', 'label', 'unit'];
  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }
  get value() { return this.num('value', 0); }
  private render() {
    const min = this.num('min', 0), max = this.num('max', 1), log = this.getAttribute('scale') === 'log';
    const u = toUnit(this.value, min, max, log);
    this.root.innerHTML = `<style>${BASE_CSS}.wrap{display:flex;flex-direction:column;height:100%;gap:2px}.track{position:relative;flex:1;background:var(--dk-track,#3a3f48);border-radius:4px;cursor:pointer;min-height:8px}.fill{position:absolute;background:var(--dk-accent,#5ec4ff);border-radius:4px}</style>
      <div class="wrap"><div class="label">${escapeHtml(this.getAttribute('label') ?? '')}</div><div class="track" part="track"><div class="fill"></div></div><div class="value">${formatValue(this.value, this.getAttribute('unit') ?? '')}</div></div>`;
    const track = this.root.querySelector('.track') as HTMLElement, fill = this.root.querySelector('.fill') as HTMLElement;
    const vertical = this.clientHeight > this.clientWidth * 1.4;
    Object.assign(fill.style, vertical ? { left: '0', right: '0', bottom: '0', height: `${u * 100}%` } : { left: '0', top: '0', bottom: '0', width: `${u * 100}%` });
    track.addEventListener('pointerdown', e => {
      track.setPointerCapture(e.pointerId);
      const set = (m: PointerEvent) => {
        const r = track.getBoundingClientRect();
        const t = vertical ? 1 - (m.clientY - r.top) / r.height : (m.clientX - r.left) / r.width;
        const value = fromUnit(t, min, max, log);
        this.setAttribute('value', String(value)); this.emit('input', value);
      };
      set(e);
      const up = () => { track.removeEventListener('pointermove', set as EventListener); track.removeEventListener('pointerup', up); this.emit('change', this.value); };
      track.addEventListener('pointermove', set as EventListener); track.addEventListener('pointerup', up);
    });
  }
}

/** On/off switch (toggle) or momentary button. */
export class DkToggle extends DkElement {
  static observedAttributes = ['value', 'label', 'momentary'];
  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }
  get value() { return this.getAttribute('value') === 'true' || this.getAttribute('value') === '1'; }
  private render() {
    const on = this.value, momentary = this.hasAttribute('momentary');
    this.root.innerHTML = `<style>${BASE_CSS}button{width:100%;height:100%;border-radius:6px;border:1px solid var(--dk-track,#3a3f48);background:${on ? 'var(--dk-accent,#5ec4ff)' : 'transparent'};color:${on ? 'var(--dk-bg,#14161a)' : 'var(--dk-fg,#e6e8ec)'};font:inherit;cursor:pointer}</style><button part="button" aria-pressed="${on}">${escapeHtml(this.getAttribute('label') ?? (momentary ? 'Push' : 'On/Off'))}</button>`;
    const button = this.root.querySelector('button')!;
    if (momentary) {
      button.addEventListener('pointerdown', () => { this.setAttribute('value', 'true'); this.emit('input', true); this.emit('change', true); });
      const release = () => { if (!this.value) return; this.setAttribute('value', 'false'); this.emit('input', false); this.emit('change', false); };
      button.addEventListener('pointerup', release); button.addEventListener('pointerleave', release);
    } else button.addEventListener('click', () => { const next = !this.value; this.setAttribute('value', String(next)); this.emit('input', next); this.emit('change', next); });
  }
}

/** Two-axis pad, x and y in [0,1]. */
export class DkXy extends DkElement {
  static observedAttributes = ['x', 'y', 'label'];
  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }
  private render() {
    const x = this.num('x', 0.5), y = this.num('y', 0.5);
    this.root.innerHTML = `<style>${BASE_CSS}.pad{position:relative;width:100%;height:100%;background:var(--dk-track,#3a3f48);border-radius:6px;cursor:crosshair;overflow:hidden}.dot{position:absolute;width:14px;height:14px;margin:-7px;border-radius:50%;background:var(--dk-accent,#5ec4ff)}.label{position:absolute;left:6px;top:4px}</style>
      <div class="pad" part="pad"><div class="label">${escapeHtml(this.getAttribute('label') ?? '')}</div><div class="dot" style="left:${x * 100}%;top:${(1 - y) * 100}%"></div></div>`;
    const pad = this.root.querySelector('.pad') as HTMLElement;
    pad.addEventListener('pointerdown', e => {
      pad.setPointerCapture(e.pointerId);
      const set = (m: PointerEvent) => {
        const r = pad.getBoundingClientRect();
        const nx = Math.min(1, Math.max(0, (m.clientX - r.left) / r.width)), ny = Math.min(1, Math.max(0, 1 - (m.clientY - r.top) / r.height));
        this.setAttribute('x', String(nx)); this.setAttribute('y', String(ny)); this.emit('input', { x: nx, y: ny });
      };
      set(e);
      const up = () => { pad.removeEventListener('pointermove', set as EventListener); pad.removeEventListener('pointerup', up); this.emit('change', { x: this.num('x', 0.5), y: this.num('y', 0.5) }); };
      pad.addEventListener('pointermove', set as EventListener); pad.addEventListener('pointerup', up);
    });
  }
}

/**
 * Keyboard; emits `note` {note, on}. `start` (MIDI note, default from `octave`),
 * `octaves` (default 2), `held` (comma list), and `pc` = the MIDI note where the
 * computer-keyboard letters (A W S E D F T G Y H U J K) are printed on the keys.
 */
export class DkKeyboard extends DkElement {
  static observedAttributes = ['octave', 'start', 'octaves', 'held', 'pc'];
  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }
  private render() {
    const start = this.hasAttribute('start') ? this.num('start', 48) : 12 * (this.num('octave', 4) + 1);
    const octaves = Math.max(1, Math.min(8, this.num('octaves', 2)));
    const held = new Set((this.getAttribute('held') ?? '').split(',').filter(Boolean).map(Number));
    const pc = this.hasAttribute('pc') ? this.num('pc', start) : null;
    const letter = (n: number) => pc !== null && n >= pc && n <= pc + 12 ? 'AWSEDFTGYHUJK'[n - pc] : '';
    const whites: number[] = [], blacks: Array<{ note: number; at: number }> = [];
    for (let n = start, w = 0; n <= start + 12 * octaves; n++) { if ([1, 3, 6, 8, 10].includes(n % 12)) blacks.push({ note: n, at: w }); else { whites.push(n); w++; } }
    const ww = 100 / whites.length;
    const label = (n: number) => `${letter(n) ? `<span class="k">${letter(n)}</span>` : ''}${n % 12 === 0 ? `<span class="c">C${Math.floor(n / 12) - 1}</span>` : ''}`;
    this.root.innerHTML = `<style>${BASE_CSS}.kb{position:relative;width:100%;height:100%;user-select:none}.w,.b{position:absolute;top:0;border:1px solid #222;border-radius:0 0 4px 4px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;padding-bottom:4px;gap:1px;font:600 10px/1 Lato,system-ui,sans-serif}.w{height:100%;background:#f3f3f3;color:#555}.b{height:60%;background:#222;z-index:1;color:#bbb}.on{background:var(--dk-accent,#5ec4ff)!important;color:#111!important}.k{font-size:11px}.c{font-weight:400;font-size:9px;color:#999}</style>
      <div class="kb" part="keyboard">${whites.map((n, i) => `<div class="w${held.has(n) ? ' on' : ''}" data-note="${n}" style="left:${i * ww}%;width:${ww}%">${label(n)}</div>`).join('')}${blacks.map(b => `<div class="b${held.has(b.note) ? ' on' : ''}" data-note="${b.note}" style="left:${b.at * ww - ww * 0.3}%;width:${ww * 0.6}%">${label(b.note)}</div>`).join('')}</div>`;
    const down = new Map<number, number>();
    const kb = this.root.querySelector('.kb') as HTMLElement;
    const noteAt = (e: PointerEvent) => { const el = (this.root.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest?.('[data-note]') as HTMLElement | null; return el?.dataset.note ? Number(el.dataset.note) : null; };
    kb.addEventListener('pointerdown', e => { kb.setPointerCapture(e.pointerId); const n = noteAt(e); if (n === null) return; down.set(e.pointerId, n); this.emit('note', { note: n, on: true }); });
    kb.addEventListener('pointermove', e => { if (!down.has(e.pointerId)) return; const n = noteAt(e); const old = down.get(e.pointerId)!; if (n !== null && n !== old) { this.emit('note', { note: old, on: false }); down.set(e.pointerId, n); this.emit('note', { note: n, on: true }); } });
    const up = (e: PointerEvent) => { const n = down.get(e.pointerId); if (n === undefined) return; down.delete(e.pointerId); this.emit('note', { note: n, on: false }); };
    kb.addEventListener('pointerup', up); kb.addEventListener('pointercancel', up);
  }
}

/** Scope/meter: the host sets `.analyser` (an AnalyserNode) and the element draws itself. */
export class DkScope extends DkElement {
  static observedAttributes = ['label', 'mode'];
  analyser: AnalyserNode | null = null;
  private frame = 0;
  connectedCallback() {
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
