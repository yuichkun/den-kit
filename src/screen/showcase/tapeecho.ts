// Echo Line — a tape echo run as one line, from what goes in to what comes back.
// The input is driven onto tape (a soft clip), trimmed, and played back by
// two heads: the first at the repeat time, the second 1.5× later on the right.
// Intensity feeds the first head back; Tone darkens each pass; Wow wobbles the
// tape; Hiss adds its noise at the output. The dry signal passes untouched
// beside the echoes.
// The design follows the thinking of SIG CRUISER (iF DESIGN AWARD 2022), the
// interface that lets one operator run a whole filling line: the line drawn in
// order on one screen, each station with its state where it sits, quick to
// read and to act on, in the manner of today's phone apps, with shadows for
// depth and the parts you can press picked out. The plugin is the echo drawn
// as a plant's flow diagram: the In pump, a sight glass showing the level going
// onto tape, the tape on its reels with the record head and the two playback
// heads under it, the return through a valve (Intensity) and a strainer (Tone),
// the vessel that mixes the echoes and sends them Out, the hiss source and its
// breaker, and the dry pipe over it all. Pipes carry moving dashes while sound
// passes. Each setting is the part that does it, standing up off the drawing
// and dragged where it is, with its value on an instrument bubble by the hand;
// head A sits on the time scale over the tape.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, patchControl, r, wire, work } from './build.ts';

/** The line: the pump, the tape and its heads, the return through the valve and the strainer, the vessel that sends the echoes out; it takes the mouse. */
export const ECHO_LINE = `// The line as a plant's flow diagram, read left to right like a filling line:
// the In pump drives the sound up onto the tape at the Rec head (the sight glass
// on its pipe, a meter laid over the canvas, shows the level going onto tape);
// the tape runs past head A at the repeat time (ktime) and head B 1.5 times
// later; their echoes are collected into the vessel, which sends them Out, and
// go back onto the tape through the valve (Intensity, kfb) and the strainer
// (Tone, ktone). The dry pipe runs over it all, straight into the vessel. The
// tape holds 1.3 s from Rec to its end and moves at the speed that brings a
// point from Rec to head A in the repeat time; what was heard is printed on it
// as it passes Rec (the output level, as strokes) and rides it past the heads.
// A sound coming in (a jump in the output level) lights each head as its echo
// is heard. Pipes show the flow (moving dashes) while sound passes.
// Every part you can take hold of stands up off the drawing in white, with a
// shadow, and turns yellow under the hand; its setting and value show on an
// instrument bubble beside it, as on a flow diagram: the pump (kin, Drive, up
// and down; longer vanes, harder drive), a head along the tape against the time
// scale over it, the tape itself for Wow (kwow, up and down), the valve (up and
// down; its stem lifts as it opens), the strainer (across; the finer its mesh,
// the darker each pass), the vessel's level for Echoes (kecho, up and down).
// Click the breaker for the hiss (thiss), which joins the vessel from its own
// source. Wheel: finer steps; double click: first value.
const SPAN = 1.3, DRY = 52, BELT = 140, LINE_IN = 300, WET = 252, RET = 336;
const REC = 256, TAPE_END = 600, ROLL = [222, 624];
const PUMP = { x: 84, y: LINE_IN, r: 34 };
const VESSEL = { x: 628, y: WET - 30, w: 92, h: 60 };
const VALVE = { x: 380, y: RET }, STRAINER = { x: 500, y: RET, r: 24 };
const BREAKER = { x: 698, y: 352 }, NOISE = { x: 750, y: 352, r: 18 };
const GLASS = { x0: 140, x1: 212 }; // the sight glass on the pipe from In to Rec (the meter lies in it)
const OUTLET = { y: WET, x1: 752 }; // the vessel's way Out, to the right
const K = 604; // where the echoes split: on to the vessel, and back down the return
const FIRST = { kin: 1.4, ktime: 0.32, kwow: 0.0012, kfb: 0.55, ktone: 2600, kecho: 0.7 };
const SANS = 'system-ui, sans-serif', TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const xAt = sec => REC + (sec / SPAN) * (TAPE_END - REC);
const secAt = x => ((x - REC) / (TAPE_END - REC)) * SPAN;
export const levelY = v => VESSEL.y + VESSEL.h - 7 - (v / 1.2) * (VESSEL.h - 18);
export function where(x, y, f) {
  const time = f.value('ktime');
  if (Math.hypot(x - BREAKER.x, y - BREAKER.y) < 22) return { id: 'thiss', kind: 'breaker' };
  if (Math.hypot(x - PUMP.x, y - PUMP.y) < PUMP.r + 10) return { id: 'kin', kind: 'pump' };
  if (y > BELT + 22 && y < BELT + 50) {
    if (Math.abs(x - xAt(time)) < 15) return { id: 'ktime', kind: 'head', k: 1 };
    if (Math.abs(x - xAt(time * 1.5)) < 15) return { id: 'ktime', kind: 'head', k: 1.5 };
  }
  if (y > BELT - 32 && y < BELT + 22 && x > ROLL[0] - 28 && x < ROLL[1] + 28) return { id: 'kwow', kind: 'tape' };
  if (Math.abs(x - VALVE.x) < 28 && y > VALVE.y - 50 && y < VALVE.y + 20) return { id: 'kfb', kind: 'valve' };
  if (Math.abs(x - STRAINER.x) + Math.abs(y - STRAINER.y) < STRAINER.r + 10) return { id: 'ktone', kind: 'tone' };
  if (x > VESSEL.x - 8 && x < VESSEL.x + VESSEL.w + 8 && y > VESSEL.y - 8 && y < VESSEL.y + VESSEL.h + 8) return { id: 'kecho', kind: 'vessel' };
  return null;
}
// A part that stands up off the drawing: its shadow falls under it.
function lift(ctx, on) {
  ctx.shadowColor = on ? 'rgba(3, 40, 30, 0.32)' : 'rgba(0, 0, 0, 0)';
  ctx.shadowBlur = on ? 10 : 0;
  ctx.shadowOffsetY = on ? 4 : 0;
}
function pipe(ctx, pts, tube, flow, t, speed, width) {
  ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
  ctx.strokeStyle = tube; ctx.lineWidth = width;
  ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
  if (!flow) return;
  ctx.strokeStyle = flow; ctx.lineWidth = Math.max(1.5, width / 3);
  ctx.setLineDash([7, 11]); ctx.lineDashOffset = -(t * speed) % 18;
  ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
}
function label(ctx, text, x, y, align, ink, weight) {
  ctx.font = (weight || 600) + ' 12px ' + SANS; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillStyle = ink; ctx.fillText(text, x, y);
}
// The value by the hand, as an instrument bubble on a flow diagram: a ring split by a line, the setting over
// it and its value under it, with a lead to the part.
function bubble(ctx, name, value, x, y, tx, ty, ink, paper) {
  const r = 28, a = Math.atan2(ty - y, tx - x);
  ctx.strokeStyle = ink; ctx.lineWidth = 1.25;
  ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.lineTo(tx, ty); ctx.stroke();
  lift(ctx, true);
  ctx.fillStyle = paper; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  lift(ctx, false);
  ctx.lineWidth = 1.5; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.lineWidth = 1.25; ctx.stroke();
  ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '600 10px ' + SANS; ctx.fillText(name, x, y - 11);
  ctx.font = '700 11px ' + SANS; ctx.fillText(value, x, y + 12);
}
export default {
  setup(ctx, f) {
    Object.assign(f.state, { prev: 0, last: -1, pulses: [], hist: [], drag: null });
  },
  draw(ctx, f) {
    const s = f.state, w = f.w, h = f.h;
    const ink = f.color('fg'), hot1 = f.color('accent'), tube = f.color('track'), white = f.color('knob'), line = f.color('muted');
    const time = f.value('ktime'), fb = f.value('kfb'), wow = f.norm('kwow'), drive = f.norm('kin'), tone = f.value('ktone'), tn = f.norm('ktone'), echo = f.value('kecho'), hiss = f.on('thiss');
    const xa = xAt(time), xb = xAt(time * 1.5);
    const live = f.level > 0.01;
    const p = f.pointer, hot = s.drag ? s.drag : p && p.over ? where(p.x, p.y, f) : null;
    const is = kind => hot && hot.kind === kind;
    const face = kind => (is(kind) ? hot1 : white);
    // A sound coming in starts a block at Rec; each pass under head A sends a smaller one back.
    if (f.level > s.prev * 1.5 + 0.01 && f.t - s.last > 0.08) { s.last = f.t; s.pulses.push({ born: f.t, gain: 1, fed: false }); }
    s.prev = s.prev * 0.85 + f.level * 0.15;
    for (const q of s.pulses) {
      if (!q.fed && f.t - q.born >= time) { q.fed = true; if (q.gain * fb > 0.06) s.pulses.push({ born: q.born + time, gain: q.gain * fb, fed: false }); }
    }
    s.pulses = s.pulses.filter(q => f.t - q.born < SPAN).slice(-24);
    const heard = at => s.pulses.some(q => Math.abs(f.t - q.born - at) < 0.07);
    const speed = (xa - REC) / Math.max(0.02, time);
    ctx.clearRect(0, 0, w, h);
    const flow = live ? white : null;
    // The pipes: dry over everything, In up to Rec, the heads' echoes to the vessel, the return under the line.
    const VX = VESSEL.x + VESSEL.w / 2;
    pipe(ctx, [[PUMP.x, PUMP.y - PUMP.r], [PUMP.x, DRY], [VX, DRY], [VX, VESSEL.y]], tube, flow, f.t, 40, 9);
    pipe(ctx, [[PUMP.x + PUMP.r, LINE_IN], [REC, LINE_IN], [REC, BELT + 40]], tube, flow, f.t, 40, 9);
    pipe(ctx, [[xa, BELT + 40], [xa, WET], [VESSEL.x, WET]], tube, flow, f.t, 40, 9);
    pipe(ctx, [[xb, BELT + 40], [xb, WET]], tube, flow, f.t, 40, 9);
    pipe(ctx, [[K, WET], [K, RET], [REC, RET], [REC, LINE_IN]], tube, live && fb > 0.02 ? white : null, f.t, 24 + fb * 30, 4 + fb * 7);
    // Junctions: where the return joins the input, and where the echoes split to the vessel and back.
    for (const [x, y] of [[REC, LINE_IN], [K, WET]]) {
      ctx.fillStyle = tube; ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.fill();
      ctx.fillStyle = white; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, TAU); ctx.fill();
    }
    label(ctx, 'Dry', (PUMP.x + VX) / 2, DRY - 16, 'center', line, 600);
    label(ctx, 'Return', REC + 44, RET - 18, 'left', line, 600);
    // The sight glass on the pipe up to Rec: a flange at each end (the meter is the glass).
    ctx.fillStyle = ink;
    for (const x of [GLASS.x0, GLASS.x1]) { ctx.beginPath(); ctx.roundRect(x - 3, LINE_IN - 12, 6, 24, 2); ctx.fill(); }
    label(ctx, 'Onto tape', (GLASS.x0 + GLASS.x1) / 2, LINE_IN + 24, 'center', line, 600);
    // The In pump: a casing round an impeller that turns while sound comes in; more Drive, longer vanes.
    lift(ctx, true); ctx.fillStyle = face('pump'); ctx.beginPath(); ctx.arc(PUMP.x, PUMP.y, PUMP.r, 0, TAU); ctx.fill(); lift(ctx, false);
    ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.stroke();
    s.spin = (s.spin || 0) + (live ? f.dt * (2 + drive * 6) : 0);
    const vane = PUMP.r * (0.42 + drive * 0.42);
    ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let k = 0; k < 4; k++) {
      const a = s.spin + (k * Math.PI) / 2;
      ctx.beginPath(); ctx.moveTo(PUMP.x, PUMP.y);
      ctx.quadraticCurveTo(PUMP.x + Math.cos(a) * vane * 0.7, PUMP.y + Math.sin(a) * vane * 0.7, PUMP.x + Math.cos(a + 0.6) * vane, PUMP.y + Math.sin(a + 0.6) * vane);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(PUMP.x, PUMP.y, 4.5, 0, TAU); ctx.fill();
    label(ctx, 'In', PUMP.x, PUMP.y + PUMP.r + 18, 'center', ink, 700);
    // The time scale over the tape, from Rec: every 0.1 s, named every 0.5 s from 0.
    ctx.fillStyle = line;
    for (let i = 0; i <= SPAN * 10 + 0.01; i++) {
      const x = Math.round(xAt(i / 10)), big = i % 5 === 0;
      ctx.fillRect(x, BELT - 46 - (big ? 7 : 4), 1.5, big ? 7 : 4);
      if (big) label(ctx, i ? (i / 10).toFixed(1) + ' s' : '0', x, BELT - 62, 'center', line, 600);
    }
    ctx.fillRect(REC, BELT - 46, TAPE_END - REC, 1.5);
    // The tape: a white belt over two reels; what was heard is printed along it, and wavers by Wow.
    const amp = 0.6 + wow * 7, waver = x => amp * Math.sin((x - f.t * speed) / 24) * Math.sin(f.t * 1.7);
    const belt = () => { ctx.beginPath(); ctx.roundRect(ROLL[0] - 26, BELT - 26, ROLL[1] - ROLL[0] + 52, 52, 26); };
    lift(ctx, true); ctx.fillStyle = face('tape'); belt(); ctx.fill(); lift(ctx, false);
    ctx.strokeStyle = ink; ctx.lineWidth = 2; belt(); ctx.stroke();
    // The reels: a hub and three holes, turning with the tape.
    for (const rx of ROLL) {
      ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(rx, BELT, 19, 0, TAU); ctx.stroke();
      ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(rx, BELT, 4, 0, TAU); ctx.fill();
      const a = (f.t * speed) / 19;
      ctx.fillStyle = tube;
      for (let k = 0; k < 3; k++) { const b = a + (k * TAU) / 3; ctx.beginPath(); ctx.arc(rx + Math.cos(b) * 11, BELT + Math.sin(b) * 11, 4.5, 0, TAU); ctx.fill(); }
    }
    s.hist.push({ t: f.t, v: Math.min(1, f.level * 5) });
    s.hist = s.hist.filter(q => (f.t - q.t) * speed < TAPE_END - REC + 8);
    ctx.fillStyle = ink;
    for (const q of s.hist) {
      const x = REC + (f.t - q.t) * speed, hh = Math.round(2 + q.v * 26);
      if (x < ROLL[1] - 28) ctx.fillRect(Math.round(x), Math.round(BELT + waver(x) - hh / 2), 2, hh);
    }
    // The heads under the tape: Rec, then A and B at their times, marked on the scale; a head lights as its echo is heard.
    ctx.fillStyle = ink; ctx.beginPath(); ctx.roundRect(REC - 15, BELT + 28, 30, 14, 4); ctx.fill();
    label(ctx, 'Rec', REC - 20, BELT + 35, 'right', ink, 700);
    for (const [x, at, name] of [[xa, time, 'A'], [xb, time * 1.5, 'B']]) {
      ctx.fillStyle = ink; ctx.fillRect(Math.round(x) - 1, BELT - 46, 2, 18);
      lift(ctx, true);
      ctx.fillStyle = is('head') && (hot.k === 1) === (name === 'A') ? hot1 : heard(at) ? hot1 : white;
      ctx.beginPath(); ctx.roundRect(x - 13, BELT + 28, 26, 14, 4); ctx.fill();
      lift(ctx, false);
      ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.stroke();
      label(ctx, name, x + 12, BELT + 54, 'left', ink, 700);
    }
    // The valve on the return: its stem lifts as it opens (Intensity), the flow thickens.
    const vx = VALVE.x, vy = VALVE.y, stem = 12 + fb * 26;
    ctx.fillStyle = ink; ctx.fillRect(vx - 1.5, vy - stem, 3, stem); ctx.beginPath(); ctx.roundRect(vx - 13, vy - stem - 4, 26, 5, 2); ctx.fill();
    lift(ctx, true);
    ctx.fillStyle = face('valve');
    ctx.beginPath(); ctx.moveTo(vx - 22, vy - 14); ctx.lineTo(vx + 22, vy + 14); ctx.lineTo(vx + 22, vy - 14); ctx.lineTo(vx - 22, vy + 14); ctx.closePath(); ctx.fill();
    lift(ctx, false);
    ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    label(ctx, 'Intensity', vx, RET + 38, 'center', ink, 700);
    // The strainer on the return: the finer its mesh, the darker each pass (Tone).
    const sx = STRAINER.x, sy = STRAINER.y, sr = STRAINER.r;
    const diamond = () => { ctx.beginPath(); ctx.moveTo(sx, sy - sr); ctx.lineTo(sx + sr, sy); ctx.lineTo(sx, sy + sr); ctx.lineTo(sx - sr, sy); ctx.closePath(); };
    lift(ctx, true); ctx.fillStyle = face('tone'); diamond(); ctx.fill(); lift(ctx, false);
    ctx.save(); diamond(); ctx.clip();
    const mesh = Math.round(9 - tn * 7);
    ctx.strokeStyle = ink; ctx.lineWidth = 1.25;
    for (let i = 1; i <= mesh; i++) { const x = sx - sr + (i * 2 * sr) / (mesh + 1); ctx.beginPath(); ctx.moveTo(x, sy - sr); ctx.lineTo(x, sy + sr); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = ink; ctx.lineWidth = 2; diamond(); ctx.stroke();
    label(ctx, 'Tone', sx, RET + 38, 'center', ink, 700);
    // The vessel: filled to the echoes' level; its surface is the sound going out.
    const ly = levelY(echo), V = VESSEL;
    const capsule = () => { ctx.beginPath(); ctx.roundRect(V.x, V.y, V.w, V.h, V.h / 2); };
    lift(ctx, true); ctx.fillStyle = face('vessel'); capsule(); ctx.fill(); lift(ctx, false);
    ctx.save(); capsule(); ctx.clip();
    ctx.fillStyle = tube; ctx.beginPath(); ctx.moveTo(V.x, V.y + V.h);
    for (let i = 0; i <= 30; i++) { const x = V.x + (i / 30) * V.w, k = Math.floor((i / 30) * (f.wave.length - 1)); ctx.lineTo(x, ly + (f.wave[k] || 0) * 8); }
    ctx.lineTo(V.x + V.w, V.y + V.h); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = ink; ctx.lineWidth = 2; capsule(); ctx.stroke();
    // The way Out, to the right.
    pipe(ctx, [[V.x + V.w, OUTLET.y], [OUTLET.x1, OUTLET.y]], tube, flow, f.t, 40, 9);
    ctx.fillStyle = ink; ctx.beginPath(); ctx.moveTo(OUTLET.x1 + 10, OUTLET.y); ctx.lineTo(OUTLET.x1 - 2, OUTLET.y - 9); ctx.lineTo(OUTLET.x1 - 2, OUTLET.y + 9); ctx.closePath(); ctx.fill();
    label(ctx, 'Out', OUTLET.x1, OUTLET.y - 20, 'center', ink, 700);
    // The hiss: its source, wired through the breaker and up into the vessel when it is on.
    const c0 = BREAKER.x - 15, c1 = BREAKER.x + 15, cy = BREAKER.y + 6;
    pipe(ctx, [[NOISE.x - NOISE.r, cy], [c1, cy]], tube, null, f.t, 20, 5);
    pipe(ctx, [[c0, cy], [c0, V.y + V.h]], tube, hiss && live ? white : null, f.t, 20, 5);
    lift(ctx, true); ctx.fillStyle = white; ctx.beginPath(); ctx.arc(NOISE.x, cy, NOISE.r, 0, TAU); ctx.fill(); lift(ctx, false);
    ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath();
    for (let k = 0; k <= 9; k++) { const x = NOISE.x - 9 + k * 2, y = cy + ((k * 7) % 5) * 1.5 - 3; if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.lineWidth = 1.5; ctx.stroke();
    if (is('breaker')) { ctx.fillStyle = hot1; ctx.beginPath(); ctx.arc(BREAKER.x, BREAKER.y, 20, 0, TAU); ctx.fill(); }
    ctx.fillStyle = ink;
    for (const x of [c0, c1]) { ctx.beginPath(); ctx.arc(x, cy, 4.5, 0, TAU); ctx.fill(); }
    ctx.strokeStyle = ink; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(c0, cy);
    if (hiss) ctx.lineTo(c1, cy - 2); else ctx.lineTo(c1 - 5, cy - 18);
    ctx.stroke(); ctx.lineCap = 'butt';
    label(ctx, 'Hiss', BREAKER.x, BREAKER.y + 30, 'center', ink, 700);
    // The bubble by the hand: what the part under it sets, and the value.
    if (hot) {
      const v = f.value(hot.id);
      const say = {
        pump: ['Drive', v.toFixed(2) + '×', PUMP.x + 66, PUMP.y - 56, PUMP.x + 24, PUMP.y - 24],
        head: hot.k === 1 ? ['Repeat', Math.round(time * 1000) + ' ms', xa + 44, BELT + 78, xa + 13, BELT + 40] : ['Head B', Math.round(time * 1500) + ' ms', xb + 44, BELT + 78, xb + 13, BELT + 40],
        tape: ['Wow', (v * 1000).toFixed(2) + ' ms', ROLL[0] - 70, BELT, ROLL[0] - 26, BELT],
        valve: ['Intensity', Math.round(v * 100) + '%', VALVE.x + 58, VALVE.y - 50, VALVE.x + 12, VALVE.y - 12 - fb * 26],
        tone: ['Tone', (v / 1000).toFixed(2) + ' kHz', STRAINER.x + 62, STRAINER.y - 46, STRAINER.x + 14, STRAINER.y - 10],
        vessel: ['Echoes', Math.round((v / 1.2) * 100) + '%', VESSEL.x - 36, VESSEL.y - 18, VESSEL.x + 4, VESSEL.y + 12],
        breaker: ['Hiss', hiss ? 'on' : 'off', BREAKER.x + 46, BREAKER.y - 48, BREAKER.x + 14, BREAKER.y - 8],
      }[hot.kind];
      bubble(ctx, say[0], say[1], say[2], say[3], say[4], say[5], ink, white);
    }
  },
  pointer(e, f) {
    const s = f.state, fine = e.shift ? 0.1 : 1;
    if (e.type === 'down') {
      const t = where(e.x, e.y, f);
      s.drag = t && t.kind !== 'breaker' ? { ...t, x: e.x, y: e.y, norm: f.norm(t.id) } : null;
      if (t && t.kind === 'breaker') f.set('thiss', !f.on('thiss'));
    }
    if (e.type === 'up' || e.type === 'leave') s.drag = null;
    const d = s.drag;
    if (d && (e.type === 'down' || e.type === 'move')) {
      if (d.kind === 'head') f.set('ktime', clamp(secAt(e.x) / d.k, 0.06, 0.8));
      else if (e.type === 'move') {
        const along = d.kind === 'tone' ? e.x - d.x : d.y - e.y;
        f.setNorm(d.id, clamp(d.norm + (along / (d.kind === 'vessel' ? 120 : 200)) * fine, 0, 1));
      }
    }
    if (e.type === 'wheel' || e.type === 'double') {
      const t = where(e.x, e.y, f);
      if (t && t.kind !== 'breaker' && e.type === 'wheel') f.setNorm(t.id, clamp(f.norm(t.id) - (e.dy / 100) * 0.01 * fine, 0, 1));
      if (t && t.kind !== 'breaker' && e.type === 'double') f.set(t.id, FIRST[t.id]);
    }
    const at = s.drag ?? where(e.x, e.y, f);
    f.cursor(!at ? 'default' : s.drag ? 'grabbing' : at.kind === 'breaker' ? 'pointer' : at.kind === 'head' || at.kind === 'tone' ? 'ew-resize' : 'ns-resize');
  },
};
`;

export function tapeecho(catalog: Catalog) {
  return work(
    'tapeecho',
    'Echo Line',
    catalog,
    [780, 400],
    [
      // ---- sound ----
      add('in1', 'kit.audioIn'),
      add('rec1', 'kit.tanh', { label: 'Record (drive)', values: { drive: 1.4 } }),
      add('trim1', 'kit.gain', { label: 'Trim', values: { gain: 0.7 } }),
      add('tape1', 'den.delayFx', {
        label: 'Tape',
        config: { maxDelaySeconds: 2, tone: 'lowpass', stereoPhaseCycles: 0.15 },
        values: {
          timeLeftSeconds: 0.32,
          timeRightSeconds: 0.48,
          feedback: 0.55,
          cutoffHz: 2600,
          mix: 1,
          rateHz: 0.55,
          depthSeconds: 0.0012,
        },
      }),
      add('head2', 'kit.scale', { label: 'Second head', values: { scale: 1.5, offset: 0 } }),
      add('noise1', 'den.seededNoise', { label: 'Hiss' }),
      add('hissbp1', 'den.stateVariableFilter', {
        label: 'Hiss tone',
        values: { cutoffHz: 5500, q: 0.8 },
      }),
      add('hiss1', 'kit.gain', { label: 'Hiss level', values: { gain: 0.006 } }),
      add('hisson1', 'kit.mul', { label: 'Hiss on' }),
      add('mixl1', 'kit.mix', {
        label: 'Mix L',
        config: { channels: 3 },
        values: { level1: 1, level2: 0.7, level3: 1 },
      }),
      add('mixr1', 'kit.mix', {
        label: 'Mix R',
        config: { channels: 3 },
        values: { level1: 1, level2: 0.7, level3: 1 },
      }),
      add('outl1', 'kit.tanh', { label: 'Out L', values: { drive: 1 } }),
      add('outr1', 'kit.tanh', { label: 'Out R', values: { drive: 1 } }),
      add('out1', 'kit.out'),
      wire('in1.left', 'rec1.in'),
      wire('rec1.out', 'trim1.in'),
      wire('trim1.out', 'tape1.left'),
      wire('head2.out', 'tape1.timeRightSeconds'),
      wire('noise1.out', 'hissbp1.input'),
      wire('hissbp1.bandpass', 'hiss1.in'),
      wire('hiss1.out', 'hisson1.a'),
      wire('in1.left', 'mixl1.in1'),
      wire('tape1.left', 'mixl1.in2'),
      wire('hisson1.out', 'mixl1.in3'),
      wire('in1.right', 'mixr1.in1'),
      wire('tape1.right', 'mixr1.in2'),
      wire('hisson1.out', 'mixr1.in3'),
      wire('mixl1.out', 'outl1.in'),
      wire('mixr1.out', 'outr1.in'),
      wire('outl1.out', 'out1.left'),
      wire('outr1.out', 'out1.right'),
      // ---- the plugin: the line is the screen and the controls ----
      {
        op: 'setLook',
        look: {
          tokens: {
            bg: '#2cb592',
            fg: '#06261d',
            accent: '#ffd84a',
            track: '#137a5f',
            knob: '#ffffff',
            pointer: '#06261d',
            muted: '#0b4d3b',
            glow: '#ffd84a',
            font: 'system',
            labelFont: 'system',
            valueFont: 'system',
          },
          background: [{ kind: 'color', color: '#2cb592' }],
          skins: { meter: { name: 'bar', params: { scale: false } } },
        },
      },
      // The settings live in the patch; the line moves them.
      ...patchControl('kin', 'Drive', 'rec1.drive', [0.5, 6, 'log', ''], 1.4),
      ...patchControl(
        'ktime',
        'Repeat',
        ['tape1.timeLeftSeconds', 'head2.in'],
        [0.06, 0.8, 'log', 's'],
        0.32,
      ),
      ...patchControl('kwow', 'Wow', 'tape1.depthSeconds', [0, 0.004, 'linear', 's'], 0.0012),
      ...patchControl('kfb', 'Intensity', 'tape1.feedback', [0, 0.92, 'linear', ''], 0.55),
      ...patchControl('ktone', 'Tone', 'tape1.cutoffHz', [900, 7000, 'log', 'Hz'], 2600),
      ...patchControl(
        'kecho',
        'Echoes',
        ['mixl1.level2', 'mixr1.level2'],
        [0, 1.2, 'linear', ''],
        0.7,
      ),
      add('thiss', 'ui.toggle', { label: 'Hiss', values: { value: true } }),
      wire('thiss.out', 'hisson1.b'),
      el({
        kind: 'canvas',
        name: 'The line',
        code: ECHO_LINE,
        rect: r(0, 0, 780, 400),
      }),
      el({
        kind: 'text',
        name: 'Title',
        text: 'Echo Line',
        rect: r(20, 12, 140, 24),
        textStyle: { font: 'system', size: 15, weight: 700, color: 'fg', align: 'left' },
      }),
      // The level going onto tape: the sight glass in the pipe from In to Rec (the canvas draws its flanges).
      ...control('vu1', 'ui.meter', 'Onto tape', null, r(146, 294, 60, 12), {
        style: { tokens: { track: '#137a5f', accent: '#ffffff' } },
      }),
      wire('trim1.out', 'vu1.in'),
    ],
  );
}
