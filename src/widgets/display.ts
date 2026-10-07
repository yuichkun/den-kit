// Scope and meter: the host sets `.analyser` (an AnalyserNode) and the element
// draws itself every frame. `mode` is scope or meter. Scope skins: line,
// phosphor (glowing trace on a graticule, with persistence). Meter skins: bar,
// needle (a VU meter: printed scale, 0 VU = −18 dBFS, VU ballistics), led (a ladder of segments).
import { BASE_CSS, DkElement, safeUrl } from './base.ts';

const VU_MARKS = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3];
const vuPos = (vu: number) => { const p = (v: number) => 10 ** (v / 20); return (p(Math.min(3, Math.max(-20, vu))) - p(-20)) / (p(3) - p(-20)); };

export class DkScope extends DkElement {
  static observedAttributes = ['label', 'mode', 'skin', 'params'];
  analyser: AnalyserNode | null = null;
  private frame = 0;
  private needle = 0;
  private last = 0;
  private image: HTMLImageElement | null = null;
  private data = new Float32Array(1024);
  private settings: Record<string, string | number | boolean> = {};
  protected build() {
    this.settings = this.readParams();
    const url = safeUrl(this.settings.image);
    this.image = url ? Object.assign(new Image(), { src: url }) : null;
  }
  protected paint() {}
  override connectedCallback() {
    this.root.innerHTML = `<style>${BASE_CSS}canvas{width:100%;height:100%;display:block;border-radius:6px}</style><canvas part="canvas"></canvas>`;
    this.build();
    const draw = (t: number) => { this.frame = requestAnimationFrame(draw); this.draw(t); };
    this.frame = requestAnimationFrame(draw);
  }
  override disconnectedCallback() { super.disconnectedCallback(); cancelAnimationFrame(this.frame); }
  override attributeChangedCallback() { if (this.root.firstChild) this.build(); }

  private draw(t: number) {
    const canvas = this.root.querySelector('canvas'); if (!canvas) return;
    const w = Math.round(canvas.clientWidth * devicePixelRatio), h = Math.round(canvas.clientHeight * devicePixelRatio);
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const g = canvas.getContext('2d'); if (!g) return;
    const n = this.analyser?.fftSize ?? 1024;
    if (this.data.length !== n) this.data = new Float32Array(n);
    if (this.analyser) this.analyser.getFloatTimeDomainData(this.data); else this.data.fill(0);
    const dt = this.last ? Math.min(0.1, (t - this.last) / 1000) : 0.016;
    this.last = t;
    const s = this.settings, C = (k: string, d: string) => this.canvasColor(s[k] ?? d, d.startsWith('#') ? d : '#888');
    if (this.getAttribute('mode') === 'meter') {
      let peak = 0, sum = 0; for (const x of this.data) { peak = Math.max(peak, Math.abs(x)); sum += x * x; }
      const rms = Math.sqrt(sum / this.data.length);
      if (this.skinName === 'needle') return this.vu(g, w, h, rms, dt, C);
      if (this.skinName === 'led') return this.ladder(g, w, h, peak, C);
      g.clearRect(0, 0, w, h);
      g.fillStyle = C('surface', 'track'); g.fillRect(0, 0, w, h);
      const db = 20 * Math.log10(peak + 1e-9), k = Math.max(0, Math.min(1, (db + 60) / 60));
      g.fillStyle = C('fill', 'accent');
      if (w > h) g.fillRect(0, 0, w * k, h); else g.fillRect(0, h * (1 - k), w, h * k);
      if (s.scale === true) {
        g.fillStyle = C('fill', 'fg'); g.globalAlpha = 0.5;
        for (const mark of [-48, -36, -24, -12, -6, 0]) { const m = (mark + 60) / 60; if (w > h) g.fillRect(w * m, 0, devicePixelRatio, h * 0.3); else g.fillRect(0, h * (1 - m), w * 0.3, devicePixelRatio); }
        g.globalAlpha = 1;
      }
      return;
    }
    const phosphor = this.skinName === 'phosphor';
    const line = C('line', phosphor ? '#7dff9a' : 'accent'), surface = C('surface', phosphor ? '#05140b' : 'track');
    if (phosphor) {
      g.globalAlpha = 1 - Math.min(0.95, Math.max(0, Number(s.persistence ?? 0.6)));
      g.fillStyle = surface; g.fillRect(0, 0, w, h); g.globalAlpha = 1;
      if (s.grid !== false) {
        g.strokeStyle = line; g.globalAlpha = 0.14; g.lineWidth = devicePixelRatio;
        g.beginPath();
        for (let i = 1; i < 10; i++) { g.moveTo(w * i / 10, 0); g.lineTo(w * i / 10, h); }
        for (let i = 1; i < 8; i++) { g.moveTo(0, h * i / 8); g.lineTo(w, h * i / 8); }
        g.stroke(); g.globalAlpha = 1;
      }
      g.shadowColor = line; g.shadowBlur = Number(s.glow ?? 10) * devicePixelRatio;
    } else { g.clearRect(0, 0, w, h); g.fillStyle = surface; g.fillRect(0, 0, w, h); }
    g.strokeStyle = line; g.lineWidth = Number(s.width ?? 1.5) * devicePixelRatio; g.lineJoin = 'round';
    g.beginPath();
    for (let i = 0; i < this.data.length; i++) { const x = i / (this.data.length - 1) * w, y = h / 2 - this.data[i]! * h / 2 * 0.9; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke(); g.shadowBlur = 0;
  }

  /** VU meter: the needle follows the RMS level with about 300 ms to settle. */
  private vu(g: CanvasRenderingContext2D, w: number, h: number, rms: number, dt: number, C: (k: string, d: string) => string) {
    const vu = 20 * Math.log10(rms + 1e-9) + 18;
    const target = vuPos(vu);
    this.needle += (target - this.needle) * (1 - Math.exp(-dt / 0.065));
    const face = C('face', '#f3e6c4'), ink = C('ink', '#2a2116'), red = C('red', '#c0392b');
    g.clearRect(0, 0, w, h);
    g.fillStyle = face; g.fillRect(0, 0, w, h);
    if (this.image?.complete && this.image.naturalWidth) {
      const k = Math.max(w / this.image.naturalWidth, h / this.image.naturalHeight);
      g.drawImage(this.image, (w - this.image.naturalWidth * k) / 2, (h - this.image.naturalHeight * k) / 2, this.image.naturalWidth * k, this.image.naturalHeight * k);
    }
    if (this.settings.lamp === true) { const lamp = g.createRadialGradient(w / 2, h * 0.9, 0, w / 2, h * 0.9, h); lamp.addColorStop(0, '#ffcf7a66'); lamp.addColorStop(1, '#ffcf7a00'); g.fillStyle = lamp; g.fillRect(0, 0, w, h); }
    // The scale fits the face both ways: a wide face gets the full arc, a narrow one a smaller radius (labels stay inside).
    const fontPx = Math.round(h * 0.085), a0 = -48, a1 = 48;
    const r = Math.min(h * 0.98, (w / 2 - fontPx * 1.4) / (0.97 * Math.sin(a1 * Math.PI / 180))), cx = w / 2, cy = h * 0.23 + r * 0.97;
    const ang = (p: number) => (a0 + (a1 - a0) * p) * Math.PI / 180;
    const at = (p: number, rr: number) => [cx + rr * Math.sin(ang(p)), cy - rr * Math.cos(ang(p))] as const;
    g.lineWidth = 1.2 * devicePixelRatio; g.strokeStyle = ink;
    g.beginPath(); g.arc(cx, cy, r * 0.84, ang(0) - Math.PI / 2, ang(vuPos(0)) - Math.PI / 2); g.stroke();
    g.strokeStyle = red; g.lineWidth = 4 * devicePixelRatio;
    g.beginPath(); g.arc(cx, cy, r * 0.85, ang(vuPos(0)) - Math.PI / 2, ang(1) - Math.PI / 2); g.stroke();
    const font = getComputedStyle(this).getPropertyValue('--dk-value-font').trim() || 'system-ui';
    g.font = `${fontPx}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const mark of VU_MARKS) {
      const p = vuPos(mark), [x0, y0] = at(p, r * 0.8), [x1, y1] = at(p, r * (mark === 0 || mark === -20 || mark === 3 ? 0.9 : 0.87)), [tx, ty] = at(p, r * 0.97);
      g.strokeStyle = mark >= 0 ? red : ink; g.lineWidth = 1.4 * devicePixelRatio;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      g.fillStyle = mark >= 0 ? red : ink;
      g.fillText(mark > 0 ? `+${mark}` : String(Math.abs(mark)), tx, ty);
    }
    g.fillStyle = ink; g.font = `${Math.round(h * 0.13)}px ${font}`;
    g.fillText(String(this.settings.caption ?? 'VU'), cx, h * 0.62);
    const [nx, ny] = at(this.needle, r * 1.02);
    g.strokeStyle = C('needle', '#1b1b1b'); g.lineWidth = 1.6 * devicePixelRatio; g.lineCap = 'round';
    g.shadowColor = '#0006'; g.shadowBlur = 3 * devicePixelRatio; g.shadowOffsetX = 1.5 * devicePixelRatio;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(nx, ny); g.stroke();
    g.shadowBlur = 0; g.shadowOffsetX = 0;
    const shade = g.createLinearGradient(0, 0, 0, h); shade.addColorStop(0, '#0000'); shade.addColorStop(0.75, '#0000'); shade.addColorStop(1, '#0003');
    g.fillStyle = shade; g.fillRect(0, 0, w, h);
  }

  private ladder(g: CanvasRenderingContext2D, w: number, h: number, peak: number, C: (k: string, d: string) => string) {
    const n = Math.max(4, Math.min(40, Number(this.settings.segments ?? 12)));
    const db = 20 * Math.log10(peak + 1e-9), lit = Math.round(n * Math.max(0, Math.min(1, (db + 48) / 51)));
    const vertical = h >= w, gap = 2 * devicePixelRatio;
    const size = ((vertical ? h : w) - gap * (n - 1)) / n;
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
      const color = i >= n * 0.9 ? C('high', '#ff3b30') : i >= n * 0.7 ? C('mid', '#ffd60a') : C('low', '#3ddc84');
      g.fillStyle = i < lit ? color : C('off', 'track');
      g.shadowColor = color; g.shadowBlur = i < lit ? 6 * devicePixelRatio : 0;
      if (vertical) g.fillRect(0, h - (i + 1) * size - i * gap, w, size); else g.fillRect(i * (size + gap), 0, size, h);
    }
    g.shadowBlur = 0;
  }
}
