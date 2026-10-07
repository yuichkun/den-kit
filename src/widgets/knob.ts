// Rotary knob. Drag vertically (Shift: fine), double-click resets, the wheel nudges.
// Skins: classic (disc over a value arc), ring (thick ring, value inside),
// cap (hardware cap with a printed scale; line, dot or chicken-head pointer),
// dot (soft round button with a travelling dot), image (your picture, turned).
import { BASE_CSS, DkElement, arc, col, formatValue, fromUnit, safeUrl, toUnit } from './base.ts';

const FROM = -135, TO = 135;

export class DkKnob extends DkElement {
  static observedAttributes = ['value', 'min', 'max', 'scale', 'label', 'unit', 'default', 'skin', 'params'];
  protected static override readonly painted = ['value'];
  private angles = { from: FROM, to: TO };
  private valueInside = false;
  /** Room inside the dial for the value (radius, in the 40-unit dial). */
  private innerRadius = 11;
  get value() { return this.num('value', 0); }
  set value(v: number) { this.setAttribute('value', String(v)); }
  private range() { return { min: this.num('min', 0), max: this.num('max', 1), log: this.getAttribute('scale') === 'log' }; }

  protected build() {
    const params = this.readParams();
    const skin = ['classic', 'ring', 'cap', 'dot', 'image'].includes(this.skinName) ? this.skinName : 'classic';
    this.angles = skin === 'image' ? { from: this.p(params, 'from', FROM), to: this.p(params, 'to', TO) } : { from: FROM, to: TO };
    const valueDefault = skin === 'ring' ? 'inside' : 'bottom';
    this.valueInside = this.p(params, 'value', valueDefault) === 'inside';
    const dial = skin === 'image' ? this.imageDial(params) : `<svg viewBox="-5 -5 50 50" part="dial" class="dial-svg">${this.svg(skin, params)}</svg>`;
    this.root.innerHTML = `<style>${BASE_CSS}
      .wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:2px;overflow:hidden}
      .dial{position:relative;flex:1 1 auto;min-height:20px;width:100%;display:flex;align-items:center;justify-content:center;cursor:ns-resize}
      .dial-svg{width:100%;height:100%;overflow:visible}
      .inside{font-family:var(--dk-value-font,var(--dk-font,system-ui));font-variant-numeric:tabular-nums}
      .imgs{position:relative;height:100%;aspect-ratio:1;max-width:100%}
      .imgs img{position:absolute;inset:0;margin:auto;width:calc(var(--size,1)*100%);height:calc(var(--size,1)*100%);object-fit:contain;pointer-events:none;-webkit-user-drag:none}
      </style>
      <div class="wrap" part="wrap">${this.layout(`<div class="dial">${dial}</div>`, params, { valueDefault })}</div>`;
    const dialEl = this.$<HTMLElement>('.dial');
    dialEl.addEventListener('pointerdown', e => this.drag(e));
    dialEl.addEventListener('dblclick', () => { if (this.hasAttribute('default')) this.commit(this.num('default', this.range().min)); });
    dialEl.addEventListener('wheel', e => { e.preventDefault(); const { min, max, log } = this.range(); this.commit(fromUnit(toUnit(this.value, min, max, log) - Math.sign(e.deltaY) * 0.02, min, max, log)); }, { passive: false });
    this.paint();
  }

  private svg(skin: string, params: Record<string, unknown>): string {
    const P = ((k: string, d: string | number | boolean) => this.p(params, k, d as never)) as { (k: string, d: string): string; (k: string, d: number): number; (k: string, d: boolean): boolean };
    const inside = this.valueInside ? `<text class="inside" x="20" y="20.5" text-anchor="middle" dominant-baseline="middle" style="fill:var(--dk-value-color,var(--dk-fg))"></text>` : '';
    this.innerRadius = skin === 'ring' ? 15 - P('thickness', 6) / 2 - 0.6 : skin === 'cap' ? 11 : 11;
    if (skin === 'ring') {
      const w = P('thickness', 6), round = P('round', true) ? 'round' : 'butt', ticks = P('ticks', 0);
      const marks = Array.from({ length: ticks }, (_, i) => { const a = (FROM + (TO - FROM) * i / Math.max(1, ticks - 1)) * Math.PI / 180; return `<line x1="${20 + 19 * Math.sin(a)}" y1="${20 - 19 * Math.cos(a)}" x2="${20 + 21.5 * Math.sin(a)}" y2="${20 - 21.5 * Math.cos(a)}" style="stroke:${col(P('track', 'track'))};stroke-width:1"/>`; }).join('');
      return `${marks}<path d="${arc(FROM, TO)}" style="stroke:${col(P('track', 'track'))};stroke-width:${w};stroke-linecap:${round};fill:none"/><path class="arc" style="stroke:${col(P('arc', 'accent'))};stroke-width:${w};stroke-linecap:${round};fill:none"/>${inside}`;
    }
    if (skin === 'cap') {
      const ticks = P('ticks', 11), numbers = P('numbers', false), shape = P('shape', 'line');
      const scale = col(P('scale', 'fg')), cap = col(P('cap', 'knob')), pointer = col(P('pointer', 'pointer'));
      const marks = Array.from({ length: ticks }, (_, i) => { const a = (FROM + (TO - FROM) * i / Math.max(1, ticks - 1)) * Math.PI / 180; return `<line x1="${20 + 18 * Math.sin(a)}" y1="${20 - 18 * Math.cos(a)}" x2="${20 + 20.5 * Math.sin(a)}" y2="${20 - 20.5 * Math.cos(a)}" style="stroke:${scale};stroke-width:${i % 5 === 0 ? 1.1 : 0.7}"/>`; }).join('');
      const nums = numbers ? Array.from({ length: 11 }, (_, i) => { const a = (FROM + (TO - FROM) * i / 10) * Math.PI / 180; return `<text x="${20 + 23.4 * Math.sin(a)}" y="${20 - 23.4 * Math.cos(a)}" text-anchor="middle" dominant-baseline="middle" style="font-size:3.6px;fill:${scale};font-family:var(--dk-label-font,var(--dk-font))">${i}</text>`; }).join('') : '';
      const body = shape === 'chicken'
        ? `<circle cx="20" cy="20" r="9.5" style="fill:${cap}"/><path d="M17.2 20 L19 3.2 Q20 2.2 21 3.2 L22.8 20 Z" style="fill:${cap}"/><line x1="20" y1="5" x2="20" y2="14" style="stroke:${pointer};stroke-width:1.4;stroke-linecap:round"/>`
        : shape === 'dot' ? `<circle cx="20" cy="10.2" r="1.7" style="fill:${pointer}"/>`
          : `<line x1="20" y1="15.5" x2="20" y2="8.2" style="stroke:${pointer};stroke-width:1.8;stroke-linecap:round"/>`;
      const skirt = shape === 'chicken' ? '' : `<circle cx="20" cy="20" r="16" style="fill:color-mix(in srgb, ${cap} 55%, #000)"/><circle cx="20" cy="20" r="12.6" style="fill:url(#capfill);filter:drop-shadow(0 .6px .8px #0008)"/>`;
      return `<defs><radialGradient id="capfill" cx="38%" cy="32%" r="75%"><stop offset="0" style="stop-color:color-mix(in srgb, ${cap} 70%, #fff)"/><stop offset=".6" style="stop-color:${cap}"/><stop offset="1" style="stop-color:color-mix(in srgb, ${cap} 75%, #000)"/></radialGradient></defs>
        ${marks}${nums}${skirt}<g class="rot" style="filter:drop-shadow(0 .5px .6px #0009)">${body}</g>${inside}`;
    }
    if (skin === 'dot') {
      const soft = Math.min(1, Math.max(0, P('soft', 0.6))), cap = col(P('cap', 'knob'));
      const ring = P('ring', false) ? `<path d="${arc(FROM, TO, 17.5)}" style="stroke:var(--dk-track);stroke-width:1.2;fill:none;opacity:.6"/><path class="arc" style="stroke:${col(P('dot', 'accent'))};stroke-width:1.2;fill:none"/>` : '';
      return `<defs><radialGradient id="soft" cx="35%" cy="30%" r="80%"><stop offset="0" style="stop-color:color-mix(in srgb, ${cap} ${100 - 40 * soft}%, #fff)"/><stop offset="1" style="stop-color:color-mix(in srgb, ${cap} ${100 - 35 * soft}%, #000)"/></radialGradient></defs>
        ${ring}<circle cx="20" cy="20" r="14" style="fill:url(#soft);filter:drop-shadow(0 ${1 + 2 * soft}px ${1 + 3 * soft}px #0007)"/><g class="rot"><circle cx="20" cy="9.6" r="1.9" style="fill:${col(P('dot', 'accent'))};filter:drop-shadow(0 0 1.2px ${col(P('dot', 'accent'))})"/></g>${inside}`;
    }
    // classic
    const w = P('arcWidth', 3.5);
    return `<path d="${arc(FROM, TO)}" style="stroke:${col(P('track', 'track'))};stroke-width:${w};fill:none"/><path class="arc" style="stroke:${col(P('arc', 'accent'))};stroke-width:${w};fill:none"/>
      <circle cx="20" cy="20" r="11.5" style="fill:${col(P('cap', 'knob'))};filter:drop-shadow(0 1px 1px #0009)"/>
      <g class="rot"><line x1="20" y1="18.5" x2="20" y2="11.5" style="stroke:${col(P('pointer', 'pointer'))};stroke-width:2.6;stroke-linecap:round"/></g>${inside}`;
  }

  private imageDial(params: Record<string, unknown>): string {
    const cap = safeUrl(params.cap), base = safeUrl(params.base), size = this.p(params, 'size', 1);
    return `<div class="imgs" style="--size:${size}">${base ? `<img class="base" src="${base}" alt="" draggable="false">` : ''}${cap ? `<img class="rot" src="${cap}" alt="" draggable="false">` : '<svg viewBox="0 0 40 40" class="rot" style="position:absolute;inset:0"><circle cx="20" cy="20" r="15" style="fill:var(--dk-knob)"/><line x1="20" y1="18" x2="20" y2="7" style="stroke:var(--dk-pointer);stroke-width:2.4"/></svg>'}</div>`;
  }

  protected paint() {
    const { min, max, log } = this.range();
    const u = toUnit(this.value, min, max, log);
    const angle = this.angles.from + (this.angles.to - this.angles.from) * u;
    const valueArc = this.$<SVGPathElement>('.arc');
    if (valueArc) {
      const r = valueArc.closest('svg') && this.skinName === 'dot' ? 17.5 : 15;
      valueArc.setAttribute('d', u > 0.001 ? arc(FROM, angle, r) : 'M0 0');
      valueArc.style.display = u > 0.001 ? '' : 'none';
    }
    const rot = this.$<SVGGElement | HTMLElement>('.rot');
    if (rot instanceof SVGGElement) rot.setAttribute('transform', `rotate(${angle.toFixed(2)} 20 20)`);
    else if (rot) rot.style.transform = `rotate(${angle.toFixed(2)}deg)`;
    const text = formatValue(this.value, this.getAttribute('unit') ?? '');
    const inside = this.$<SVGTextElement>('.inside');
    if (inside) {
      inside.textContent = text;
      // Fit the readout inside the ring: about 0.6 em per character across the inner diameter.
      const inner = this.innerRadius * 2 * 0.86;
      inside.style.fontSize = `${Math.max(3, Math.min(this.skinName === 'ring' ? 7.4 : 5.5, inner / (Math.max(3, text.length) * 0.6))).toFixed(2)}px`;
    }
    const below = this.$<HTMLElement>('.value'); if (below) { const grew = below.textContent?.length !== text.length; below.textContent = text; if (grew) this.fit(below); }
    this.setAttribute('aria-valuenow', String(this.value));
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
