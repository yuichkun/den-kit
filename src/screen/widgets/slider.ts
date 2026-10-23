// Linear slider, vertical when taller than wide. Press anywhere on the travel to jump there.
// Skins: bar (a filled bar), fader (a slot with a desk fader cap and scale marks),
// image (your track picture with your thumb picture sliding along it).
import { BASE_CSS, DkElement, col, formatValue, fromUnit, safeUrl, toUnit } from './base.ts';

export class DkSlider extends DkElement {
  static observedAttributes = ['value', 'min', 'max', 'scale', 'label', 'unit', 'skin', 'params'];
  protected static override readonly painted = ['value'];
  private observer: ResizeObserver | null = null;
  private capSize = 0.18;
  get value() {
    return this.num('value', 0);
  }
  // Vue sets `value` as a property (the element has one), so it must land in the attribute.
  set value(v: number) {
    this.setAttribute('value', String(v));
  }
  override connectedCallback() {
    super.connectedCallback();
    this.observer ??= new ResizeObserver(() => this.paint());
    this.observer.observe(this);
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    this.observer?.disconnect();
  }
  private vertical() {
    return this.clientHeight > this.clientWidth * 1.4;
  }
  private get kind() {
    return ['bar', 'fader', 'image'].includes(this.skinName) ? this.skinName : 'bar';
  }

  protected build() {
    const params = this.readParams(),
      kind = this.kind;
    this.capSize =
      kind === 'fader'
        ? this.p(params, 'capSize', 0.18)
        : kind === 'image'
          ? this.p(params, 'thumbSize', 0.2)
          : 0;
    const ticks = kind === 'fader' ? this.p(params, 'ticks', 9) : 0;
    const track =
      kind === 'image'
        ? `<div class="track" part="track">${safeUrl(params.track) ? `<img class="trackimg" src="${safeUrl(params.track)}" alt="" draggable="false">` : ''}<div class="thumb">${safeUrl(params.thumb) ? `<img src="${safeUrl(params.thumb)}" alt="" draggable="false">` : ''}</div></div>`
        : kind === 'fader'
          ? `<div class="track fader" part="track"><div class="ticks">${Array.from({ length: ticks }, () => '<i></i>').join('')}</div><div class="slot"></div><div class="thumb cap"><b></b></div></div>`
          : '<div class="track bar" part="track"><div class="fill"></div></div>';
    this.root.innerHTML = `<style>${BASE_CSS}
      .wrap{display:flex;flex-direction:column;height:100%;gap:3px;align-items:stretch}
      .track{position:relative;flex:1;min-height:8px;cursor:pointer}
      .bar{background:${col(params.track, 'var(--dk-track,#3a3f48)')};border-radius:${this.p(params, 'radius', 4)}px;overflow:hidden}
      .fill{position:absolute;background:${col(params.fill, 'var(--dk-accent,#5ec4ff)')}}
      .slot{position:absolute;background:${col(params.slot, 'var(--dk-track)')};border-radius:3px;box-shadow:inset 0 1px 2px #000a}
      .ticks{position:absolute;display:flex;justify-content:space-between;pointer-events:none}
      .ticks i{display:block;background:var(--dk-muted,var(--dk-fg));opacity:.7}
      .cap{position:absolute;border-radius:3px;background:linear-gradient(180deg, color-mix(in srgb, ${col(params.cap, 'var(--dk-knob)')} 85%, #fff), ${col(params.cap, 'var(--dk-knob)')} 45%, color-mix(in srgb, ${col(params.cap, 'var(--dk-knob)')} 70%, #000));box-shadow:0 2px 4px #000a}
      .cap b{position:absolute;background:${col(params.line, 'var(--dk-pointer)')}}
      .trackimg{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none}
      .thumb:not(.cap){position:absolute}
      .thumb img{width:100%;height:100%;object-fit:contain;pointer-events:none;display:block}
      </style><div class="wrap">${this.layout(track, params)}</div>`;
    const el = this.$<HTMLElement>('.track');
    el.addEventListener('pointerdown', e => {
      el.setPointerCapture(e.pointerId);
      this.holding = true;
      const min = this.num('min', 0),
        max = this.num('max', 1),
        log = this.getAttribute('scale') === 'log',
        vertical = this.vertical();
      const set = (m: PointerEvent) => {
        const r = el.getBoundingClientRect();
        const travel = 1 - this.capSize;
        const raw = vertical ? 1 - (m.clientY - r.top) / r.height : (m.clientX - r.left) / r.width;
        const value = fromUnit(
          this.capSize ? (raw - this.capSize / 2) / travel : raw,
          min,
          max,
          log,
        );
        this.setAttribute('value', String(value));
        this.paint();
        this.emit('input', value);
      };
      set(e);
      const up = () => {
        el.removeEventListener('pointermove', set as EventListener);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        this.ended();
        this.emit('change', this.value);
      };
      el.addEventListener('pointermove', set as EventListener);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    this.paint();
  }

  protected paint() {
    const track = this.$<HTMLElement>('.track');
    if (!track) return;
    const u = toUnit(
      this.value,
      this.num('min', 0),
      this.num('max', 1),
      this.getAttribute('scale') === 'log',
    );
    const v = this.vertical();
    const fill = this.$<HTMLElement>('.fill');
    if (fill) {
      fill.removeAttribute('style');
      Object.assign(
        fill.style,
        v
          ? { left: '0', right: '0', bottom: '0', height: `${u * 100}%` }
          : { left: '0', top: '0', bottom: '0', width: `${u * 100}%` },
      );
    }
    const slot = this.$<HTMLElement>('.slot');
    if (slot) {
      slot.removeAttribute('style');
      Object.assign(
        slot.style,
        v
          ? { left: 'calc(50% - 3px)', width: '6px', top: '4%', bottom: '4%' }
          : { top: 'calc(50% - 3px)', height: '6px', left: '4%', right: '4%' },
      );
    }
    const ticks = this.$<HTMLElement>('.ticks');
    if (ticks) {
      ticks.removeAttribute('style');
      Object.assign(
        ticks.style,
        v
          ? {
              left: 'calc(50% + 9px)',
              width: '6px',
              top: '6%',
              bottom: '6%',
              flexDirection: 'column',
            }
          : {
              top: 'calc(50% + 9px)',
              height: '6px',
              left: '6%',
              right: '6%',
              flexDirection: 'row',
            },
      );
      for (const i of ticks.querySelectorAll('i'))
        Object.assign(
          (i as HTMLElement).style,
          v ? { width: '6px', height: '1px' } : { width: '1px', height: '6px' },
        );
    }
    const thumb = this.$<HTMLElement>('.thumb');
    if (thumb) {
      const size = this.capSize * 100,
        at = u * (100 - size);
      thumb.removeAttribute('style');
      Object.assign(
        thumb.style,
        v
          ? { left: '8%', right: '8%', height: `${size}%`, bottom: `${at}%` }
          : { top: '8%', bottom: '8%', width: `${size}%`, left: `${at}%` },
      );
      const line = thumb.querySelector('b') as HTMLElement | null;
      if (line)
        Object.assign(
          line.style,
          v
            ? { left: '10%', right: '10%', top: 'calc(50% - 1px)', height: '2px' }
            : { top: '10%', bottom: '10%', left: 'calc(50% - 1px)', width: '2px' },
        );
    }
    const value = this.$<HTMLElement>('.value');
    if (value) {
      const text = formatValue(this.value, this.getAttribute('unit') ?? '');
      if (value.textContent?.length !== text.length) {
        value.textContent = text;
        this.fit(value);
      } else value.textContent = text;
    }
  }
}
