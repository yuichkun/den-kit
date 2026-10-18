// Two-axis pad, x and y in [0,1]. Skins: pad (a flat pad with a dot), glow (a
// clear pad: a glowing dot with a fading trail over whatever is behind it).
import { BASE_CSS, DkElement, col, escapeHtml } from './base.ts';

export class DkXy extends DkElement {
  static observedAttributes = ['x', 'y', 'label', 'skin', 'params'];
  protected static override readonly painted = ['x', 'y'];
  private trail: Array<{ x: number; y: number; t: number }> = [];
  private frame = 0;
  private trailFrames = 0;
  private get kind() {
    return this.skinName === 'glow' ? 'glow' : 'pad';
  }

  protected build() {
    cancelAnimationFrame(this.frame);
    const params = this.readParams(),
      glow = this.kind === 'glow';
    const dot = col(params.dot, 'var(--dk-accent,#5ec4ff)');
    this.trailFrames = glow ? this.p(params, 'trail', 24) : 0;
    const size = glow ? this.p(params, 'size', 18) : 14;
    const grid = this.p(params, 'grid', false);
    this.root.innerHTML = `<style>${BASE_CSS}
      .pad{position:relative;width:100%;height:100%;cursor:crosshair;overflow:hidden;border-radius:${glow ? 0 : this.p(params, 'radius', 6)}px;background:${glow ? 'transparent' : col(params.surface, 'var(--dk-track,#3a3f48)')}}
      .grid{position:absolute;inset:0;pointer-events:none;opacity:.18;background-image:linear-gradient(to right, var(--dk-fg) 1px, transparent 1px),linear-gradient(to bottom, var(--dk-fg) 1px, transparent 1px);background-size:12.5% 12.5%}
      .dot{position:absolute;width:${size}px;height:${size}px;margin:-${size / 2}px;border-radius:50%;background:${dot};${glow ? `box-shadow:0 0 ${this.p(params, 'glow', 18)}px ${this.p(params, 'glow', 18) / 3}px ${dot}, 0 0 4px #fff inset` : ''};pointer-events:none}
      .cross{position:absolute;inset:0;pointer-events:none}
      .cross i{position:absolute;background:${dot};opacity:.45}
      canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
      .label{position:absolute;left:6px;top:4px}
      </style>
      <div class="pad" part="pad">${grid ? '<div class="grid"></div>' : ''}${this.trailFrames ? '<canvas></canvas>' : ''}${glow && this.p(params, 'crosshair', false) ? '<div class="cross"><i class="h"></i><i class="v"></i></div>' : ''}${this.p(params, 'label', 'corner') === 'none' ? '' : `<div class="label" part="label">${escapeHtml(this.getAttribute('label') ?? '')}</div>`}<div class="dot"></div></div>`;
    const pad = this.$<HTMLElement>('.pad');
    pad.addEventListener('pointerdown', e => {
      pad.setPointerCapture(e.pointerId);
      this.holding = true;
      const set = (m: PointerEvent) => {
        const r = pad.getBoundingClientRect();
        const nx = Math.min(1, Math.max(0, (m.clientX - r.left) / r.width)),
          ny = Math.min(1, Math.max(0, 1 - (m.clientY - r.top) / r.height));
        this.setAttribute('x', String(nx));
        this.setAttribute('y', String(ny));
        this.paint();
        this.emit('input', { x: nx, y: ny });
      };
      set(e);
      const up = () => {
        pad.removeEventListener('pointermove', set as EventListener);
        pad.removeEventListener('pointerup', up);
        pad.removeEventListener('pointercancel', up);
        this.ended();
        this.emit('change', { x: this.num('x', 0.5), y: this.num('y', 0.5) });
      };
      pad.addEventListener('pointermove', set as EventListener);
      pad.addEventListener('pointerup', up);
      pad.addEventListener('pointercancel', up);
    });
    this.paint();
    if (this.trailFrames) this.frame = requestAnimationFrame(this.drawTrail);
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    cancelAnimationFrame(this.frame);
  }

  protected paint() {
    const x = this.num('x', 0.5),
      y = this.num('y', 0.5);
    const dot = this.$<HTMLElement>('.dot');
    if (!dot) return;
    dot.style.left = `${x * 100}%`;
    dot.style.top = `${(1 - y) * 100}%`;
    const h = this.$<HTMLElement>('.cross .h'),
      v = this.$<HTMLElement>('.cross .v');
    if (h && v) {
      Object.assign(h.style, { left: '0', right: '0', height: '1px', top: `${(1 - y) * 100}%` });
      Object.assign(v.style, { top: '0', bottom: '0', width: '1px', left: `${x * 100}%` });
    }
    if (this.trailFrames) this.trail.push({ x, y, t: performance.now() });
  }

  /** The trail fades over `trail` frames (about 1/60 s each), also after the finger lifts. */
  private drawTrail = () => {
    this.frame = requestAnimationFrame(this.drawTrail);
    const canvas = this.$<HTMLCanvasElement>('canvas');
    if (!canvas) return;
    const w = canvas.clientWidth * devicePixelRatio,
      h = canvas.clientHeight * devicePixelRatio;
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const g = canvas.getContext('2d');
    if (!g) return;
    const now = performance.now(),
      life = this.trailFrames * 16.7;
    this.trail = this.trail.filter(p => now - p.t < life).slice(-400);
    g.clearRect(0, 0, w, h);
    if (this.trail.length < 2) return;
    const color = this.canvasColor(this.readParams().dot ?? 'accent', '#5ec4ff');
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 12 * devicePixelRatio;
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1]!,
        b = this.trail[i]!,
        k = 1 - (now - b.t) / life;
      g.globalAlpha = Math.max(0, k) * 0.9;
      g.lineWidth = (2 + 6 * k) * devicePixelRatio;
      g.beginPath();
      g.moveTo(a.x * w, (1 - a.y) * h);
      g.lineTo(b.x * w, (1 - b.y) * h);
      g.stroke();
    }
    g.globalAlpha = 1;
  };
}
