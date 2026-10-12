// Evaluation prompt 10 — An XY filter performance effect, with a neon look and a glowing finger trail.
// A resonant multimode filter played with one finger: across sweeps the cutoff
// over seven octaves, up raises the resonance. A canvas paints the
// finger's glowing trail and a neon floor that pulses with the sound.
import type { Catalog } from '../core/catalog.ts';
import { add, asset, control, el, r, wire, work } from './build.ts';

export const NEON_TRAIL = `// A light-painting trail of the XY pad, over a neon floor that breathes with the sound.
export default function draw(ctx, f) {
  const s = f.state;
  s.trail = s.trail || [];
  const p = f.xy('pad1');
  const last = s.trail[s.trail.length - 1];
  if (!last || Math.abs(last.x - p.x) + Math.abs(last.y - p.y) > 0.002) s.trail.push({ x: p.x, y: p.y, t: f.t });
  s.trail = s.trail.filter(q => f.t - q.t < 1.6).slice(-160);
  ctx.clearRect(0, 0, f.w, f.h);
  // floor grid
  const glow = 0.25 + Math.min(0.75, f.level * 5);
  ctx.save();
  ctx.strokeStyle = f.color('glow');
  ctx.globalAlpha = 0.18 + 0.3 * glow;
  ctx.lineWidth = 1;
  const horizon = f.h * 0.58;
  for (let i = -12; i <= 12; i++) { ctx.beginPath(); ctx.moveTo(f.w / 2 + i * 14, horizon); ctx.lineTo(f.w / 2 + i * 90, f.h); ctx.stroke(); }
  const scroll = (f.t * 0.6) % 1;
  for (let k = 0; k < 9; k++) { const z = (k + scroll) / 9, y = horizon + (f.h - horizon) * z * z; ctx.globalAlpha = (0.08 + 0.4 * glow) * z; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(f.w, y); ctx.stroke(); }
  ctx.restore();
  // the trail
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let i = 1; i < s.trail.length; i++) {
    const a = s.trail[i - 1], b = s.trail[i], age = (f.t - b.t) / 1.6;
    const hue = 300 - 120 * (1 - age);
    ctx.strokeStyle = 'hsl(' + hue + ' 100% 65%)';
    ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 18;
    ctx.globalAlpha = Math.max(0, 1 - age);
    ctx.lineWidth = 2 + 7 * (1 - age);
    ctx.beginPath(); ctx.moveTo(a.x * f.w, (1 - a.y) * f.h); ctx.lineTo(b.x * f.w, (1 - b.y) * f.h); ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
}
`;

export function neon(catalog: Catalog) {
  return work('neon', 'Neon Sweep', catalog, [640, 520], [
    // ---- sound ----
    add('in1', 'kit.audioIn'),
    add('oct1', 'kit.scale', { label: 'X → octaves', values: { scale: 7.5, offset: 0 } }),
    add('cut1', 'kit.cutoffMod', { values: { hz: 90 } }),
    add('q1', 'kit.map', { label: 'Y → resonance', values: { inMin: 0, inMax: 1, outMin: 0.7, outMax: 9 } }),
    add('svfl1', 'den.stateVariableFilter', { label: 'Filter L' }),
    add('svfr1', 'den.stateVariableFilter', { label: 'Filter R' }),
    add('satl1', 'kit.tanh', { values: { drive: 1.2 } }),
    add('satr1', 'kit.tanh', { values: { drive: 1.2 } }),
    add('levl1', 'kit.gain', { label: 'Level L', values: { gain: 0.6 } }),
    add('levr1', 'kit.gain', { label: 'Level R', values: { gain: 0.6 } }),
    add('out1', 'kit.out'),
    wire('oct1.out', 'cut1.octaves'), wire('cut1.out', 'svfl1.cutoffHz'), wire('cut1.out', 'svfr1.cutoffHz'), wire('q1.out', 'svfl1.q'), wire('q1.out', 'svfr1.q'),
    wire('in1.left', 'svfl1.input'), wire('in1.right', 'svfr1.input'), wire('svfl1.lowpass', 'satl1.in'), wire('svfr1.lowpass', 'satr1.in'),
    wire('satl1.out', 'levl1.in'), wire('satr1.out', 'levr1.in'), wire('levl1.out', 'out1.left'), wire('levr1.out', 'out1.right'),
    // ---- the plugin: neon (the sign photo it was drawn from is kept as the reference picture) ----
    asset('sc-neon'),
    { op: 'setUnderlay', underlay: { asset: 'sc-neon', opacity: 0.4, visible: false } },
    { op: 'setLook', look: {
      tokens: { bg: '#07020f', fg: '#f6e9ff', accent: '#ff2bd6', track: '#1b0b2e', knob: '#1b0b2e', pointer: '#ff2bd6', muted: '#7ff7ff', glow: '#00e5ff', font: 'orbitron', labelFont: 'orbitron', valueFont: 'orbitron' },
      background: [{ kind: 'linear', angle: 180, stops: [{ color: '#120424', at: 0 }, { color: '#07020f', at: 0.6 }, { color: '#16022a', at: 1 }] }],
    } },
    el({ kind: 'text', name: 'Title', text: 'FILTER', rect: r(30, 18, 580, 78), textStyle: { font: 'monoton', size: 62, color: 'accent', spacing: 0.08, shadows: [{ x: 0, y: 0, blur: 6, color: 'accent' }, { x: 0, y: 0, blur: 24, color: 'accent' }, { x: 0, y: 0, blur: 48, color: '#7a0aff' }] } }),
    el({ kind: 'shape', shape: 'rect', name: 'Tube', rect: r(36, 106, 568, 372), locked: true, style: { radius: 18, stroke: { color: 'glow', width: 2, style: 'solid' }, shadows: [{ x: 0, y: 0, blur: 14, spread: 1, color: 'glow', inset: false }, { x: 0, y: 0, blur: 10, spread: 0, color: 'glow', inset: true }] } }),
    el({ kind: 'canvas', name: 'Trail', code: NEON_TRAIL, rect: r(40, 110, 560, 364) }),
    ...control('pad1', 'ui.xy', 'Sweep', null, r(40, 110, 560, 364), { style: { skin: { name: 'glow', params: { dot: 'accent', size: 22, trail: 0, glow: 34, crosshair: true, label: 'none' } } } }),
    wire('pad1.x', 'oct1.in'), wire('pad1.y', 'q1.in'),
    el({ kind: 'text', name: 'X label', text: 'CUTOFF →', rect: r(440, 484, 160, 22), textStyle: { size: 12, color: 'muted', align: 'right', spacing: 0.24, shadows: [{ x: 0, y: 0, blur: 8, color: 'glow' }] } }),
    el({ kind: 'text', name: 'Y label', text: 'RESONANCE →', rect: r(-60, 270, 180, 22), textStyle: { size: 12, color: 'muted', spacing: 0.24, shadows: [{ x: 0, y: 0, blur: 8, color: 'glow' }] }, style: { rotate: -90 } }),
  ]);
}
