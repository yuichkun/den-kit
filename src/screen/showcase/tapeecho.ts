// Echo Line — a tape echo run as one line, from what goes in to what comes back.
// The input is driven onto tape (a soft clip), trimmed, and played back by
// two heads: the first at the repeat time, the second 1.5× later on the right.
// Intensity feeds the first head back; Tone darkens each pass; Wow wobbles the
// tape; Hiss adds its noise at the output. The dry signal passes untouched
// beside the echoes.
// The design follows the thinking of SIG CRUISER (iF DESIGN AWARD 2022), the
// interface that lets one operator run a whole filling line: the line drawn in
// order on one screen, each station with its state where it sits, quick to
// read and to act on. The plugin is the echo drawn as a plant's flow diagram:
// the IN pump, a gauge glass showing the level going onto tape, the tape on
// its rollers with the record head and the two playback heads under it, the
// return through a valve (Intensity) and a tone filter, the tank that mixes
// the echoes and sends them OUT, the hiss source and its breaker, and the dry
// pipe over it all; the drawing's name is in its title block. Pipes carry
// moving dashes while sound passes. Each setting is the part that does it,
// dragged where it is, with its value on a tag by the hand; head A sits on the
// time scale over the tape.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, patchControl, r, wire, work } from './build.ts';

/** The line: the pump, the tape and its heads, the return through the valve and the tone filter, the output tank; it takes the mouse. */
export const ECHO_LINE = `// The line as a plant's flow diagram, read left to right like a filling line:
// the IN pump drives the sound onto the tape at the RECORD head (the gauge glass
// on the pipe, a meter laid over the canvas, shows the level); the tape runs
// past head A at the repeat time (ktime) and head B 1.5 times later; their
// echoes are collected into the tank, which sends them OUT, and go back onto the tape through
// the TONE filter (ktone) and the valve (Intensity, kfb). The dry pipe runs over
// it all, straight into the tank. The tape holds 1.3 s from RECORD to its end
// and moves at the speed that brings a point from RECORD to head A in the
// repeat time; what was heard is printed on it as it passes RECORD (the output
// level, as strokes) and rides it past the heads. A sound coming in (a jump in
// the output level) lights each head as its echo is heard.
// Pipes show the flow (moving dashes) while sound passes. Every setting is a
// part of the drawing, and its value shows on a tag by the hand: the pump's
// impeller for Drive (kin, up and down; bigger vanes, harder drive), a head along the tape against the time
// scale over it, the tape's waves for Wow (kwow, up and down), the valve's stem
// (up and down), the filter's knee (across), the tank's level for Echoes
// (kecho, up and down). Click the breaker for the hiss (thiss), which joins
// the tank from its own source. Names of parts are cream, names of lines
// sage, all in capitals. Wheel: finer steps; double click: first value.
const SPAN = 1.3, DRY = 56, BELT = 136, PIPE = 200, WET = 232, RET = 300;
const REC = 250, TAPE_END = 612, ROLL = [216, 636];
const PUMP = { x: 84, y: PIPE, r: 26 };
const TANK = { x: 686, y: 112, w: 56, h: 140 };
const VALVE = { x: 380, y: RET }, TONE = { x: 524, y: RET, w: 64, h: 36 };
const BREAKER = { x: 714, y: 304 }, NOISE = { x: 755, y: 310 };
const GLASS = { x: 170, y: 148, w: 12, h: 42 }; // the gauge glass on the pipe from IN to RECORD (the meter lies over it)
const OUTLET = { y: TANK.y + TANK.h - 18, x1: 772 }; // the tank's way OUT, to the right
const BLOCK = { x: 556, y: 344, w: 210, h: 44 }; // the drawing's title block
const K = 664;
const FIRST = { kin: 1.4, ktime: 0.32, kwow: 0.0012, kfb: 0.55, ktone: 2600, kecho: 0.7 };
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace', SANS = 'system-ui, sans-serif';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const xAt = sec => REC + (sec / SPAN) * (TAPE_END - REC);
const secAt = x => ((x - REC) / (TAPE_END - REC)) * SPAN;
const toneX = hz => TONE.x - TONE.w / 2 + 8 + (Math.log(hz / 900) / Math.log(7000 / 900)) * (TONE.w - 22);
const levelY = v => TANK.y + TANK.h - 8 - (v / 1.2) * (TANK.h - 22);
function where(x, y, f) {
  const time = f.value('ktime');
  if (Math.hypot(x - BREAKER.x, y - BREAKER.y) < 20) return { id: 'thiss', kind: 'breaker' };
  if (Math.hypot(x - PUMP.x, y - PUMP.y) < PUMP.r + 12) return { id: 'kin', kind: 'pump' };
  if (y > BELT + 6 && y < BELT + 40) {
    if (Math.abs(x - xAt(time)) < 15) return { id: 'ktime', kind: 'head', k: 1 };
    if (Math.abs(x - xAt(time * 1.5)) < 15) return { id: 'ktime', kind: 'head', k: 1.5 };
  }
  if (y > BELT - 34 && y < BELT + 12 && x > ROLL[0] - 24 && x < ROLL[1] + 24) return { id: 'kwow', kind: 'tape' };
  if (Math.abs(x - VALVE.x) < 30 && Math.abs(y - VALVE.y) < 34) return { id: 'kfb', kind: 'valve' };
  if (Math.abs(x - TONE.x) < TONE.w / 2 + 10 && Math.abs(y - TONE.y) < 32) return { id: 'ktone', kind: 'tone' };
  if (x > TANK.x - 70 && x < TANK.x + TANK.w + 10 && y > TANK.y - 4 && y < TANK.y + TANK.h + 4) return { id: 'kecho', kind: 'tank' };
  return null;
}
function pipe(ctx, pts, ink, flow, t, speed, width) {
  ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
  ctx.strokeStyle = ink; ctx.lineWidth = width;
  ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
  if (!flow) return;
  ctx.strokeStyle = flow; ctx.lineWidth = Math.max(1.5, width - 2.5);
  ctx.setLineDash([6, 10]); ctx.lineDashOffset = -(t * speed) % 16;
  ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
}
function name(ctx, text, x, y, align, ink) {
  ctx.font = '700 11px ' + MONO; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillStyle = ink; ctx.fillText(text, x, y);
}
// The tag by the hand, as on a flow diagram: a box ruled in cream, what the part sets and its value.
function plate(ctx, text, x, y, align, ink, paper) {
  ctx.font = '700 12px ' + MONO; ctx.textBaseline = 'middle';
  const m = ctx.measureText(text), tw = (typeof m.width === 'number' ? m.width : text.length * 7.2) + 16;
  const x0 = Math.round(align === 'right' ? x - tw : align === 'center' ? x - tw / 2 : x), y0 = Math.round(y - 11);
  ctx.fillStyle = paper; ctx.fillRect(x0, y0, Math.round(tw), 22);
  ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.strokeRect(x0 + 0.75, y0 + 0.75, Math.round(tw) - 1.5, 20.5);
  ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.fillText(text, x0 + 8, y0 + 11.5);
}
export default {
  setup(ctx, f) {
    Object.assign(f.state, { prev: 0, last: -1, pulses: [], hist: [], drag: null });
  },
  draw(ctx, f) {
    const s = f.state, w = f.w, h = f.h;
    const cream = f.color('fg'), lit = f.color('accent'), sage = f.color('muted'), deep = f.color('track'), field = f.color('knob');
    const time = f.value('ktime'), fb = f.value('kfb'), wow = f.norm('kwow'), drive = f.norm('kin'), tone = f.value('ktone'), echo = f.value('kecho'), hiss = f.on('thiss');
    const xa = xAt(time), xb = xAt(time * 1.5);
    const live = f.level > 0.01;
    const p = f.pointer, hot = s.drag ? s.drag : p && p.over ? where(p.x, p.y, f) : null;
    const is = kind => hot && hot.kind === kind;
    // A sound coming in starts a block at RECORD; each pass under head A sends a smaller one back.
    if (f.level > s.prev * 1.5 + 0.01 && f.t - s.last > 0.08) { s.last = f.t; s.pulses.push({ born: f.t, gain: 1, fed: false }); }
    s.prev = s.prev * 0.85 + f.level * 0.15;
    for (const q of s.pulses) {
      if (!q.fed && f.t - q.born >= time) { q.fed = true; if (q.gain * fb > 0.06) s.pulses.push({ born: q.born + time, gain: q.gain * fb, fed: false }); }
    }
    s.pulses = s.pulses.filter(q => f.t - q.born < SPAN).slice(-24);
    const heard = at => s.pulses.some(q => Math.abs(f.t - q.born - at) < 0.07);
    const speed = (xa - REC) / Math.max(0.02, time);
    ctx.clearRect(0, 0, w, h);
    const flow = live ? cream : null;
    // The pipes: dry over everything, IN to RECORD, the heads' echoes to the tank, the return under the line.
    pipe(ctx, [[PUMP.x, PUMP.y - PUMP.r], [PUMP.x, DRY], [TANK.x + TANK.w / 2, DRY], [TANK.x + TANK.w / 2, TANK.y]], sage, flow, f.t, 40, 4);
    pipe(ctx, [[PUMP.x + PUMP.r, PIPE], [REC, PIPE], [REC, BELT + 34]], sage, flow, f.t, 40, 4);
    pipe(ctx, [[xa, BELT + 32], [xa, WET], [TANK.x, WET]], sage, flow, f.t, 40, 4);
    pipe(ctx, [[xb, BELT + 32], [xb, WET]], sage, flow, f.t, 40, 4);
    pipe(ctx, [[K, WET], [K, RET], [REC, RET], [REC, PIPE]], sage, live && fb > 0.02 ? cream : null, f.t, 24 + fb * 30, 2 + fb * 6);
    // Junctions: where the return joins the input, and where the echoes split to the tank and back.
    for (const [x, y] of [[REC, PIPE], [K, WET]]) { ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fillStyle = cream; ctx.fill(); }
    name(ctx, 'DRY', (PUMP.x + TANK.x) / 2, DRY - 12, 'center', sage);
    // The IN pump: a casing round an impeller that turns while sound comes in; more Drive, longer vanes.
    ctx.fillStyle = field; ctx.beginPath(); ctx.arc(PUMP.x, PUMP.y, PUMP.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = cream; ctx.lineWidth = is('pump') ? 3.5 : 2.5; ctx.stroke();
    s.spin = (s.spin || 0) + (live ? f.dt * (2 + drive * 6) : 0);
    const vane = PUMP.r * (0.42 + drive * 0.42);
    ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    for (let k = 0; k < 4; k++) {
      const a = s.spin + (k * Math.PI) / 2;
      ctx.beginPath(); ctx.moveTo(PUMP.x, PUMP.y);
      ctx.quadraticCurveTo(PUMP.x + Math.cos(a) * vane * 0.7, PUMP.y + Math.sin(a) * vane * 0.7, PUMP.x + Math.cos(a + 0.6) * vane, PUMP.y + Math.sin(a + 0.6) * vane);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.fillStyle = cream; ctx.beginPath(); ctx.arc(PUMP.x, PUMP.y, 4, 0, Math.PI * 2); ctx.fill();
    name(ctx, 'IN', PUMP.x, PUMP.y + PUMP.r + 16, 'center', cream);
    // The gauge glass on the pipe: flanges top and bottom, a stub down into the pipe (the meter is the glass).
    ctx.fillStyle = sage; ctx.fillRect(GLASS.x + GLASS.w / 2 - 2, GLASS.y + GLASS.h, 4, PIPE - GLASS.y - GLASS.h);
    ctx.fillStyle = cream;
    ctx.fillRect(GLASS.x - 4, GLASS.y - 5, GLASS.w + 8, 4);
    ctx.fillRect(GLASS.x - 4, GLASS.y + GLASS.h + 1, GLASS.w + 8, 4);
    // The tape: a belt over two rollers, wavy by Wow; blocks ride on it.
    const amp = 0.6 + wow * 6, belt = x => BELT + amp * Math.sin((x - f.t * speed) / 24) * Math.sin(f.t * 1.7);
    for (const rx of ROLL) {
      ctx.beginPath(); ctx.arc(rx, BELT, 20, 0, Math.PI * 2); ctx.fillStyle = field; ctx.fill();
      ctx.strokeStyle = cream; ctx.lineWidth = 2.5; ctx.stroke();
      const a = (f.t * speed) / 20;
      ctx.beginPath(); ctx.moveTo(rx + Math.cos(a) * 14, BELT + Math.sin(a) * 14); ctx.lineTo(rx - Math.cos(a) * 14, BELT - Math.sin(a) * 14); ctx.stroke();
    }
    ctx.strokeStyle = cream; ctx.lineWidth = is('tape') ? 3.5 : 2.5; ctx.lineCap = 'butt';
    for (const off of [-20, 20]) {
      ctx.beginPath();
      for (let x = ROLL[0]; x <= ROLL[1]; x += 4) { const y = (off < 0 ? belt(x) : BELT) + off; if (x === ROLL[0]) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.fillStyle = sage;
    for (let x = ROLL[0] + 8 - ((f.t * speed) % 16); x < ROLL[1] - 4; x += 16) if (x > ROLL[0] + 4) ctx.fillRect(Math.round(x), Math.round(belt(x) - 20 - 4), 2, 2);
    // What was heard, printed on the tape at RECORD and riding it past the heads.
    s.hist.push({ t: f.t, v: Math.min(1, f.level * 5) });
    s.hist = s.hist.filter(q => (f.t - q.t) * speed < TAPE_END - REC + 8);
    ctx.fillStyle = cream;
    for (const q of s.hist) {
      const x = REC + (f.t - q.t) * speed, hh = Math.round(2 + q.v * 26);
      ctx.fillRect(Math.round(x), BELT - Math.round(hh / 2), 2, hh);
    }
    // The time scale over the tape, from RECORD: every 0.1 s, named every 0.5 s.
    ctx.fillStyle = sage;
    for (let i = 0; i <= SPAN * 10 + 0.01; i++) {
      const x = Math.round(xAt(i / 10)), big = i % 5 === 0;
      ctx.fillRect(x, BELT - 44 - (big ? 6 : 3), 1.5, big ? 6 : 3);
      if (big && i) name(ctx, (i / 10).toFixed(1) + ' s', x, BELT - 58, 'center', sage);
    }
    ctx.fillRect(REC, BELT - 44, TAPE_END - REC, 1);
    // The heads under the tape: RECORD, then A and B at their times; a head lights as its echo is heard.
    ctx.fillStyle = cream; ctx.beginPath(); ctx.roundRect(REC - 14, BELT + 22, 28, 12, 3); ctx.fill();
    name(ctx, 'REC', REC - 10, BELT + 48, 'right', cream);
    for (const [x, at, label] of [[xa, time, 'A'], [xb, time * 1.5, 'B']]) {
      const on = heard(at);
      ctx.fillStyle = on ? lit : field; ctx.beginPath(); ctx.roundRect(x - 12, BELT + 22, 24, 12, 3); ctx.fill();
      ctx.strokeStyle = cream; ctx.lineWidth = is('head') ? 3 : 2; ctx.stroke();
      ctx.fillStyle = cream; ctx.fillRect(Math.round(x) - 1, BELT - 44, 2, 22);
      name(ctx, label, x + 9, BELT + 48, 'left', cream);
    }
    // The valve on the return: its stem lifts as it opens (Intensity), the flow thickens.
    const vx = VALVE.x, vy = VALVE.y;
    ctx.fillStyle = field; ctx.strokeStyle = cream; ctx.lineWidth = is('valve') ? 3 : 2;
    ctx.beginPath(); ctx.moveTo(vx - 20, vy - 13); ctx.lineTo(vx + 20, vy + 13); ctx.lineTo(vx + 20, vy - 13); ctx.lineTo(vx - 20, vy + 13); ctx.closePath(); ctx.fill(); ctx.stroke();
    const stem = 10 + fb * 26;
    ctx.fillStyle = cream; ctx.fillRect(vx - 1.5, vy - stem, 3, stem); ctx.fillRect(vx - 11, vy - stem - 3, 22, 4);
    name(ctx, 'RETURN', REC + 40, RET - 14, 'left', sage);
    // The tone filter on the return: a lowpass that rolls off at Tone.
    ctx.fillStyle = field; ctx.beginPath(); ctx.roundRect(TONE.x - TONE.w / 2, TONE.y - TONE.h / 2, TONE.w, TONE.h, 4); ctx.fill();
    ctx.strokeStyle = cream; ctx.lineWidth = is('tone') ? 3 : 2; ctx.stroke();
    const kx = toneX(tone), ty = TONE.y - 6;
    ctx.beginPath(); ctx.moveTo(TONE.x - TONE.w / 2 + 8, ty); ctx.lineTo(kx, ty); ctx.quadraticCurveTo(kx + 8, ty, kx + 12, TONE.y + 12); ctx.lineWidth = 2; ctx.stroke();

    // The OUT tank: filled to the echoes' level; its surface is the sound going out.
    const ly = levelY(echo);
    ctx.fillStyle = field; ctx.beginPath(); ctx.roundRect(TANK.x, TANK.y, TANK.w, TANK.h, 8); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.roundRect(TANK.x, TANK.y, TANK.w, TANK.h, 8); ctx.clip();
    ctx.fillStyle = deep; ctx.beginPath(); ctx.moveTo(TANK.x, TANK.y + TANK.h);
    for (let i = 0; i <= 28; i++) { const x = TANK.x + (i / 28) * TANK.w, k = Math.floor((i / 28) * (f.wave.length - 1)); ctx.lineTo(x, ly + (f.wave[k] || 0) * 10); }
    ctx.lineTo(TANK.x + TANK.w, TANK.y + TANK.h); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = cream; ctx.lineWidth = is('tank') ? 3.5 : 2.5; ctx.beginPath(); ctx.roundRect(TANK.x, TANK.y, TANK.w, TANK.h, 8); ctx.stroke();
    ctx.fillStyle = cream; ctx.beginPath(); ctx.moveTo(TANK.x - 4, ly); ctx.lineTo(TANK.x - 13, ly - 6); ctx.lineTo(TANK.x - 13, ly + 6); ctx.closePath(); ctx.fill();
    // The way OUT: a pipe from the tank to the right edge.
    pipe(ctx, [[TANK.x + TANK.w, OUTLET.y], [OUTLET.x1, OUTLET.y]], sage, flow, f.t, 40, 4);
    ctx.fillStyle = cream; ctx.beginPath(); ctx.moveTo(OUTLET.x1 + 6, OUTLET.y); ctx.lineTo(OUTLET.x1 - 4, OUTLET.y - 7); ctx.lineTo(OUTLET.x1 - 4, OUTLET.y + 7); ctx.closePath(); ctx.fill();
    name(ctx, 'OUT', TANK.x + TANK.w + 6, OUTLET.y - 16, 'left', cream);
    // The hiss: its source, wired through the breaker and up into the tank when it is on.
    pipe(ctx, [[NOISE.x - 11, NOISE.y], [BREAKER.x + 12, NOISE.y]], sage, null, f.t, 20, 3);
    pipe(ctx, [[BREAKER.x - 12, BREAKER.y + 6], [BREAKER.x - 12, TANK.y + TANK.h]], sage, hiss && live ? cream : null, f.t, 20, 3);
    ctx.fillStyle = field; ctx.beginPath(); ctx.arc(NOISE.x, NOISE.y, 11, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = hiss ? cream : sage; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath();
    for (let k = 0; k <= 12; k++) { const x = NOISE.x - 6 + k, y = NOISE.y + ((k * 7) % 5) - 2; if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = cream;
    ctx.beginPath(); ctx.arc(BREAKER.x - 12, BREAKER.y + 6, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(BREAKER.x + 12, BREAKER.y + 6, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = cream; ctx.lineWidth = is('breaker') ? 3.5 : 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(BREAKER.x - 12, BREAKER.y + 6);
    if (hiss) ctx.lineTo(BREAKER.x + 12, BREAKER.y + 4); else ctx.lineTo(BREAKER.x + 8, BREAKER.y - 10);
    ctx.stroke(); ctx.lineCap = 'butt';
    name(ctx, 'HISS', BREAKER.x, BREAKER.y + 26, 'center', hiss ? cream : sage);
    name(ctx, 'ONTO TAPE', GLASS.x + GLASS.w / 2, PIPE + 18, 'center', sage);
    // The drawing's title block: its name (text on the plugin) and what it is.
    ctx.strokeStyle = sage; ctx.lineWidth = 1.5;
    ctx.strokeRect(BLOCK.x + 0.75, BLOCK.y + 0.75, BLOCK.w - 1.5, BLOCK.h - 1.5);
    ctx.fillStyle = sage; ctx.fillRect(BLOCK.x + 136, BLOCK.y, 1.5, BLOCK.h);
    name(ctx, 'TAPE ECHO', BLOCK.x + 146, BLOCK.y + 15, 'left', sage);
    name(ctx, '2 HEADS', BLOCK.x + 146, BLOCK.y + 30, 'left', sage);
    // The plate by the hand: the part under it, what it sets and the value.
    if (hot) {
      const v = f.value(hot.id);
      const text = {
        pump: 'DRIVE ' + v.toFixed(2) + '×',
        head: 'REPEAT ' + Math.round(time * 1000) + ' MS · B ' + Math.round(time * 1500) + ' MS',
        tape: 'WOW ' + (v * 1000).toFixed(2) + ' MS',
        valve: 'INTENSITY ' + Math.round(v * 100) + '%',
        tone: 'TONE ' + (v / 1000).toFixed(2) + ' KHZ',
        tank: 'ECHOES ' + Math.round((v / 1.2) * 100) + '%',
        breaker: hiss ? 'HISS ON' : 'HISS OFF',
      }[hot.kind];
      const at = {
        pump: [PUMP.x - PUMP.r, PUMP.y - PUMP.r - 22, 'left'],
        head: [hot.k === 1 ? xa : xb, BELT + 72, 'center'],
        tape: [ROLL[0] - 16, BELT - 82, 'left'],
        valve: [VALVE.x, VALVE.y + 32, 'center'],
        tone: [TONE.x, TONE.y + 30, 'center'],
        tank: [TANK.x - 18, ly, 'right'],
        breaker: [BREAKER.x - 22, BREAKER.y + 26, 'right'],
      }[hot.kind];
      plate(ctx, text, at[0], at[1], at[2], cream, field);
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
        f.setNorm(d.id, clamp(d.norm + (along / (d.kind === 'tank' ? 120 : 200)) * fine, 0, 1));
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
            bg: '#12281f',
            fg: '#ece5cf',
            accent: '#d9eab4',
            track: '#2a4a3e',
            knob: '#0b1d16',
            pointer: '#ece5cf',
            muted: '#93ad99',
            glow: '#ece5cf',
            font: 'saira-stencil-one',
            labelFont: 'share-tech-mono',
            valueFont: 'share-tech-mono',
          },
          background: [{ kind: 'color', color: '#12281f' }],
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
        text: 'ECHO LINE',
        rect: r(564, 350, 124, 32),
        textStyle: { font: 'saira-stencil-one', size: 24, color: 'fg', align: 'left' },
      }),
      // The level going onto tape: the gauge glass standing on the pipe from IN to RECORD (the canvas draws its flanges).
      ...control('vu1', 'ui.meter', 'Onto tape', null, r(170, 148, 12, 42), {
        style: { tokens: { track: '#2a4a3e', accent: '#ece5cf' } },
      }),
      wire('trim1.out', 'vu1.in'),
    ],
  );
}
