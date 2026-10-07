// On/off switch (toggle) or momentary button (`momentary`).
// Skins: button (a labelled button that lights), footswitch (a round metal stomp
// switch, optional LED), switch (a lever or slide with ON/OFF), image (off/on pictures).
import { BASE_CSS, DkElement, col, escapeHtml, safeUrl } from './base.ts';

export class DkToggle extends DkElement {
  static observedAttributes = ['value', 'label', 'momentary', 'skin', 'params'];
  protected static override readonly painted = ['value'];
  get value() { return this.getAttribute('value') === 'true' || this.getAttribute('value') === '1'; }
  // Vue sets `value` as a property (the element has one), so it must land in the attribute.
  set value(v: boolean) { const x: unknown = v; this.setAttribute('value', String(x === true || x === 'true' || x === '1')); }
  private get kind() { return ['button', 'footswitch', 'switch', 'image'].includes(this.skinName) ? this.skinName : 'button'; }

  protected build() {
    const momentary = this.hasAttribute('momentary'), params = this.readParams(), kind = this.kind;
    const label = this.getAttribute('label') ?? (momentary ? 'Push' : 'On/Off');
    let body: string;
    if (kind === 'footswitch') {
      const metal = col(params.metal, '#c9ccd1');
      body = `<div class="fs">${this.p(params, 'led', !momentary) ? '<span class="led"></span>' : ''}<button part="button" class="press" aria-label="${escapeHtml(label)}"><svg viewBox="0 0 40 40"><defs><radialGradient id="dome" cx="40%" cy="35%" r="70%"><stop offset="0" style="stop-color:color-mix(in srgb, ${metal} 55%, #fff)"/><stop offset=".55" style="stop-color:${metal}"/><stop offset="1" style="stop-color:color-mix(in srgb, ${metal} 55%, #000)"/></radialGradient></defs>
        <polygon points="20,1.5 36,10.75 36,29.25 20,38.5 4,29.25 4,10.75" style="fill:color-mix(in srgb, ${metal} 70%, #000)"/><circle cx="20" cy="20" r="13.5" style="fill:color-mix(in srgb, ${metal} 40%, #000)"/><circle class="dome" cx="20" cy="20" r="11.5" style="fill:url(#dome)"/></svg></button>${this.p(params, 'label', 'bottom') !== 'none' ? `<div class="label" part="label">${escapeHtml(label)}</div>` : ''}</div>`;
    } else if (kind === 'switch') {
      const slide = this.p(params, 'style', 'lever') === 'slide';
      body = `<div class="sw">${this.p(params, 'label', 'bottom') === 'top' ? `<div class="label" part="label">${escapeHtml(label)}</div>` : ''}<div class="row"><span class="txt on-t">${escapeHtml(this.p(params, 'onText', 'ON'))}</span><button part="button" class="${slide ? 'slide' : 'lever'}" aria-label="${escapeHtml(label)}"><i></i></button><span class="txt off-t">${escapeHtml(this.p(params, 'offText', 'OFF'))}</span></div>${this.p(params, 'label', 'bottom') === 'bottom' ? `<div class="label" part="label">${escapeHtml(label)}</div>` : ''}</div>`;
    } else if (kind === 'image') {
      const off = safeUrl(params.off), on = safeUrl(params.on);
      body = `<button part="button" class="imgbtn" aria-label="${escapeHtml(label)}">${off ? `<img class="off" src="${off}" alt="" draggable="false">` : ''}${on ? `<img class="on" src="${on}" alt="" draggable="false">` : ''}${!off && !on ? escapeHtml(label) : ''}</button>`;
    } else body = `<button part="button" class="plain">${escapeHtml(label)}</button>`;
    const on = col(params.on, 'var(--dk-accent,#5ec4ff)');
    this.root.innerHTML = `<style>${BASE_CSS}
      button{font:inherit;color:inherit;cursor:pointer;padding:0;border:0;background:none}
      .plain{width:100%;height:100%;border-radius:${this.p(params, 'radius', 6)}px;border:1px solid var(--dk-track,#3a3f48);color:var(--dk-label-color,var(--dk-fg));font-family:var(--dk-label-font,var(--dk-font));letter-spacing:var(--dk-label-spacing,0);text-transform:var(--dk-label-case,none)}
      .plain.on{background:${on};border-color:${on};color:var(--dk-bg,#14161a)}
      .fs{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:4px}
      .fs .press{flex:1 1 auto;min-height:20px;aspect-ratio:1;max-width:100%}
      .fs svg{width:100%;height:100%;display:block;filter:drop-shadow(0 2px 3px #000a)}
      .fs .dome{transition:transform .06s}
      .fs.on .dome, .fs.held .dome{transform:scale(.93);transform-origin:20px 20px;filter:brightness(.92)}
      .led{width:12px;height:12px;border-radius:50%;flex:none;background:color-mix(in srgb, ${col(params.ledColor, '#ff3b30')} 22%, #111);box-shadow:inset 0 1px 2px #0009}
      .fs.on .led{background:${col(params.ledColor, '#ff3b30')};box-shadow:0 0 6px 2px ${col(params.ledColor, '#ff3b30')}, inset 0 -1px 2px #0006}
      .sw{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:4px}
      .row{display:flex;align-items:center;gap:6px}
      .txt{font-size:.85em;opacity:.45;font-family:var(--dk-label-font,var(--dk-font));letter-spacing:.05em}
      .sw.on .on-t, .sw:not(.on) .off-t{opacity:1;color:${on}}
      .lever{width:22px;height:30px;border-radius:5px;background:linear-gradient(#555,#222);position:relative;box-shadow:inset 0 1px 1px #fff3, 0 2px 3px #000a}
      .lever i{position:absolute;left:8px;width:6px;height:16px;border-radius:3px;background:linear-gradient(90deg,#999,#eee,#999);top:-6px;transition:top .08s}
      .sw:not(.on) .lever i{top:20px}
      .slide{width:38px;height:18px;border-radius:9px;background:var(--dk-track,#333);position:relative;box-shadow:inset 0 1px 3px #000a}
      .slide i{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dk-knob,#eee);transition:left .08s}
      .sw.on .slide{background:${on}}
      .sw.on .slide i{left:22px}
      .imgbtn{width:100%;height:100%;position:relative}
      .imgbtn img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none}
      .imgbtn .on{display:none}
      .imgbtn.on .on{display:block}
      .imgbtn.on .off{display:none}
      </style>${body}`;
    const button = this.$<HTMLButtonElement>('button');
    const set = (v: boolean) => { this.setAttribute('value', String(v)); this.paint(); this.emit('input', v); this.emit('change', v); };
    if (momentary) {
      button.addEventListener('pointerdown', e => { button.setPointerCapture(e.pointerId); this.holding = true; set(true); });
      const release = () => { if (!this.holding) return; set(false); this.ended(); };
      button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
    } else button.addEventListener('click', () => set(!this.value));
    this.paint();
  }

  protected paint() {
    const on = this.value;
    const button = this.$<HTMLButtonElement>('button');
    button?.setAttribute('aria-pressed', String(on));
    for (const el of [button, this.$<HTMLElement>('.fs'), this.$<HTMLElement>('.sw')]) el?.classList.toggle('on', on);
  }
}
