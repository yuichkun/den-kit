// お題 8 — 宇宙っぽい空間系エフェクト。星空の見た目で、音に合わせて粒が動く。
// A slow, deep chorus (the drift) into echoes that bounce left and right, into
// a very long, dark reverb. A canvas fills the sky with dust that drifts
// out from the middle: louder sound sends it faster, and each grain glows with
// its own band of the spectrum. The dust takes its colours from the look.
import type { Catalog } from '../core/catalog.ts';
import { add, asset, control, el, r, wire, work } from './build.ts';

export const STARDUST = `// Dust drifting out from the middle of the sky. The louder the sound, the
// faster it flies; each grain listens to one band of the spectrum and glows
// with it. Colours come from the look (accent, glow, fg).
function grain(fresh) {
  return { a: Math.random() * Math.PI * 2, r: fresh ? Math.random() : 0.02 + Math.random() * 0.05, v: 0.3 + Math.random(), spin: (Math.random() - 0.5) * 0.25, band: Math.floor(Math.random() * 40), size: 0.5 + Math.random() * 1.4, tone: Math.floor(Math.random() * 3) };
}
export default {
  setup(ctx, f) {
    if (!f.state.grains) f.state.grains = Array.from({ length: 260 }, () => grain(true));
  },
  draw(ctx, f) {
    const s = f.state;
    const cx = f.w / 2, cy = f.h * 0.42, R = Math.hypot(f.w / 2, f.h / 2);
    const push = 0.03 + Math.min(1.5, f.level * 6);
    const tones = [f.color('accent'), f.color('glow'), f.color('fg')];
    ctx.clearRect(0, 0, f.w, f.h);
    // a soft core that swells with the level
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.45);
    core.addColorStop(0, tones[1]); core.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.08 + Math.min(0.35, f.level * 2);
    ctx.fillStyle = core; ctx.fillRect(0, 0, f.w, f.h);
    ctx.globalCompositeOperation = 'lighter';
    for (const q of s.grains) {
      const band = f.spectrum[q.band] || 0;
      q.r += f.dt * q.v * push * (0.15 + q.r);
      q.a += f.dt * q.spin;
      if (q.r > 1.05) Object.assign(q, grain(false));
      const x = cx + Math.cos(q.a) * q.r * R, y = cy + Math.sin(q.a) * q.r * R * 0.7;
      ctx.globalAlpha = Math.min(1, (0.12 + band * 1.1) * Math.min(1, q.r * 8));
      ctx.fillStyle = tones[q.tone];
      ctx.beginPath(); ctx.arc(x, y, q.size * (1 + band * 2.2), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  },
};
`;

export function space(catalog: Catalog) {
  const knob = { skin: { name: 'ring', params: { thickness: 3, ticks: 0, round: true, value: 'inside' } }, textStyle: { font: 'orbitron', size: 11, color: 'fg', case: 'upper' as const, spacing: 0.2 } };
  const glow = [{ x: 0, y: 0, blur: 8, color: 'accent' }, { x: 0, y: 0, blur: 26, color: 'accent' }];
  return work('space', 'Nebula', catalog, [720, 440], [
    // ---- sound ----
    add('in1', 'kit.audioIn'),
    add('drift1', 'den.delayFx', { label: 'Drift', config: { maxDelaySeconds: 0.08, tone: 'flat', stereoPhaseCycles: 0.5 }, values: { timeLeftSeconds: 0.023, timeRightSeconds: 0.031, feedback: 0.25, mix: 0.5, rateHz: 0.11, depthSeconds: 0.003 } }),
    add('echo1', 'den.pingPongDelay', { label: 'Echoes', config: { maxDelaySeconds: 1.5 }, values: { timeSeconds: 0.42, feedback: 0.55, mix: 0.35 } }),
    add('sky1', 'den.algorithmicReverb', { label: 'Sky', config: { roomScale: 2, decaySeconds: 9, dampingHz: 4200 }, values: { mix: 0.5 } }),
    add('lvl1', 'kit.gain', { label: 'Level L', values: { gain: 0.8 } }),
    add('lvr1', 'kit.gain', { label: 'Level R', values: { gain: 0.8 } }),
    add('out1', 'kit.out'),
    wire('in1.left', 'drift1.left'), wire('in1.right', 'drift1.right'),
    wire('drift1.left', 'echo1.left'), wire('drift1.right', 'echo1.right'),
    wire('echo1.left', 'sky1.left'), wire('echo1.right', 'sky1.right'),
    wire('sky1.left', 'lvl1.in'), wire('sky1.right', 'lvr1.in'), wire('lvl1.out', 'out1.left'), wire('lvr1.out', 'out1.right'),
    // ---- the plugin: the night sky ----
    asset('sc-starfield'),
    { op: 'setLook', look: {
      tokens: { bg: '#05040d', fg: '#e9e6ff', accent: '#8f7bff', track: '#ffffff22', knob: '#0b0920', pointer: '#8f7bff', muted: '#a49fd0', glow: '#5ad1ff', font: 'orbitron', labelFont: 'orbitron', valueFont: 'orbitron' },
      background: [
        { kind: 'image', asset: 'sc-starfield', fit: 'cover' },
        { kind: 'radial', x: 0.5, y: 0.42, stops: [{ color: '#3a1f7a40', at: 0 }, { color: '#05040d00', at: 0.6 }] },
        { kind: 'linear', angle: 180, stops: [{ color: '#05040d00', at: 0.55 }, { color: '#05040dee', at: 1 }] },
      ],
      skins: { knob: { name: 'ring', params: { thickness: 3, round: true } } },
    } },
    el({ kind: 'canvas', name: 'Stardust', code: STARDUST, rect: r(0, 0, 720, 440) }),
    el({ kind: 'text', name: 'Title', text: 'NEBULA', rect: r(0, 26, 720, 60), textStyle: { font: 'orbitron', size: 46, weight: 700, color: 'fg', spacing: 0.5, shadows: glow } }),
    el({ kind: 'text', name: 'Subtitle', text: 'DRIFT · ECHOES · A VERY LONG SKY', rect: r(0, 88, 720, 18), textStyle: { font: 'orbitron', size: 11, color: 'muted', spacing: 0.34 } }),
    el({ kind: 'shape', shape: 'rect', name: 'Console', rect: r(48, 300, 624, 120), locked: true, style: { radius: 18, fill: [{ kind: 'color', color: '#0a0820a8' }], stroke: { color: '#8f7bff55', width: 1, style: 'solid' }, shadows: [{ x: 0, y: 0, blur: 24, spread: 0, color: '#6a4bff33', inset: false }] } }),
    ...control('ktime', 'ui.knob', 'Time', 'echo1.timeSeconds', r(78, 308, 96, 104), { min: 0.08, max: 1.4, scale: 'log', unit: 's', value: 0.42, style: knob }),
    ...control('kfb', 'ui.knob', 'Repeats', 'echo1.feedback', r(196, 308, 96, 104), { min: 0, max: 0.9, value: 0.55, style: knob }),
    ...control('kecho', 'ui.knob', 'Echoes', 'echo1.mix', r(314, 308, 96, 104), { min: 0, max: 1, value: 0.35, style: knob }),
    ...control('kdrift', 'ui.knob', 'Drift', 'drift1.depthSeconds', r(432, 308, 96, 104), { min: 0, max: 0.008, unit: 's', value: 0.003, style: knob }),
    ...control('ksky', 'ui.knob', 'Sky', 'sky1.mix', r(550, 308, 96, 104), { min: 0, max: 1, value: 0.5, style: knob }),
  ]);
}
