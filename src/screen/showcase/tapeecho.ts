// Echo Line — a tape echo run as one line, from what goes in to what comes back.
// The input is driven onto tape (a soft clip), trimmed, and played back by
// two heads: the first at the repeat time, the second 1.5× later on the right.
// Intensity feeds the first head back; Tone darkens each pass; Wow wobbles the
// tape; Hiss adds its noise at the output. The dry signal passes untouched
// beside the echoes.
// The design follows the thinking of SIG CRUISER (iF DESIGN AWARD 2022), the
// interface that lets one operator run a whole filling line: the line drawn in
// order on one screen, each station with its value and its state where it
// sits, quick to read and to act on. The plugin is that line and its controls:
// drag a head along the tape for the repeat time, pull the tape for wow, pull
// the return loop down for intensity, scrub a station's value field, flip the
// hiss switch; every lamp is lit by the signal passing that station.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, patchControl, r, wire, work } from './build.ts';

/** The line: stations, the tape with its heads, the return loop, the value fields; it takes the mouse. */
export const ECHO_LINE = `// The line, left to right: IN, RECORD, the tape past head A and head B, OUT, with
// the dry path over it and the return loop under it. The tape holds 1.3 s from
// RECORD to its end; head A sits at the repeat time (ktime), head B 1.5 times
// later, and the tape moves at the speed that brings a point from RECORD to
// head A in that time. A sound coming in (a jump in the output level) rides the
// tape as a pulse; a head lights as its echo is heard, and the loop carries the
// pulse back to RECORD, smaller by Intensity (kfb), as thick as Intensity.
// Drag a head along the tape: the repeat time. Drag the tape up and down: Wow
// (kwow), drawn as its waviness. Drag the loop: Intensity. The value fields are
// dragged up and down (200 px is the whole range, Shift is finer), scrolled, or
// double-clicked for their first value; the switch turns the hiss (thiss) on.
const SPAN = 1.3, Y = 196, BUS = 104, WET = 146, LOOP = 300;
const TAPE = { x0: 262, x1: 622 };
const ST = { in: 72, rec: 188, out: 708 };
// IN and OUT are stations and value fields at once; the others sit by their part of the line.
const FIELDS = [
  { id: 'kin', station: 'IN', label: 'Drive', x: 30, y: Y - 32, w: 84, h: 64, first: 1.4 },
  { id: 'kecho', station: 'OUT', label: 'Echoes', x: 666, y: Y - 32, w: 84, h: 64, first: 0.7 },
  { id: 'kwow', label: 'Wow', x: 538, y: 246, w: 84, h: 44, first: 0.0012 },
  { id: 'kfb', label: 'Intensity', x: 196, y: 318, w: 104, h: 44, first: 0.55 },
  { id: 'ktone', label: 'Tone', x: 308, y: 318, w: 104, h: 44, first: 2600 },
];
const HISS = { x: 666, y: 246, w: 84, h: 30 };
const SANS = 'system-ui, sans-serif', MONO = 'ui-monospace, monospace';
const xAt = sec => TAPE.x0 + (sec / SPAN) * (TAPE.x1 - TAPE.x0);
const secAt = x => ((x - TAPE.x0) / (TAPE.x1 - TAPE.x0)) * SPAN;
function show(id, v) {
  if (id === 'ktone') return (v / 1000).toFixed(2) + ' kHz';
  if (id === 'kwow') return (v * 1000).toFixed(2) + ' ms';
  if (id === 'kin') return v.toFixed(2) + '×';
  return Math.round(v * 100) + ' %';
}
function where(x, y, f) {
  for (const t of FIELDS) if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) return t;
  if (x >= HISS.x && x <= HISS.x + HISS.w && y >= HISS.y && y <= HISS.y + HISS.h) return { id: 'thiss', hiss: true };
  const time = f.value('ktime');
  if (Math.abs(y - (Y - 4)) < 18) {
    if (Math.abs(x - xAt(time)) < 14) return { id: 'ktime', head: 1 };
    if (Math.abs(x - xAt(time * 1.5)) < 14) return { id: 'ktime', head: 1.5 };
  }
  if (x >= TAPE.x0 && x <= TAPE.x1 && Math.abs(y - (Y + 8)) < 16) return { id: 'kwow', tape: true };
  if (x >= ST.rec - 6 && x <= xAt(time) + 6 && Math.abs(y - LOOP) < 12) return { id: 'kfb', loop: true };
  return null;
}
function lamp(ctx, x, y, on, warm, idle) {
  ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = on ? warm : idle; ctx.fill();
}
function tapePath(ctx, amp, t, speed) {
  ctx.beginPath();
  for (let x = TAPE.x0; x <= TAPE.x1; x += 4) {
    const y = Y + 8 + amp * Math.sin((x - t * speed) / 26) * Math.sin(t * 1.7);
    if (x === TAPE.x0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
}
export default {
  setup(ctx, f) {
    Object.assign(f.state, { prev: 0, last: -1, pulses: [], back: -10, drag: null });
  },
  draw(ctx, f) {
    const s = f.state, w = f.w, h = f.h;
    const cream = f.color('fg'), warm = f.color('accent'), muted = f.color('muted'), track = f.color('track'), field = f.color('knob');
    const time = f.value('ktime'), fb = f.value('kfb'), wow = f.norm('kwow'), hiss = f.on('thiss');
    const xa = xAt(time), xb = xAt(time * 1.5);
    const live = f.level > 0.01;
    const p = f.pointer, hot = s.drag ? s.drag : p && p.over ? where(p.x, p.y, f) : null;
    // A sound coming in starts a pulse at RECORD; each pass at head A feeds one back, smaller.
    if (f.level > s.prev * 1.5 + 0.01 && f.t - s.last > 0.08) {
      s.last = f.t;
      s.pulses.push({ born: f.t, gain: 1, fed: false });
    }
    s.prev = s.prev * 0.85 + f.level * 0.15;
    for (const q of s.pulses) {
      if (!q.fed && f.t - q.born >= time) {
        q.fed = true;
        if (q.gain * fb > 0.06) { s.pulses.push({ born: q.born + time, gain: q.gain * fb, fed: false }); s.back = f.t; }
      }
    }
    s.pulses = s.pulses.filter(q => f.t - q.born < SPAN).slice(-24);
    const lit = at => s.pulses.some(q => Math.abs(f.t - q.born - at) < 0.06);
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.textBaseline = 'middle';
    // The dry path over the line, and the wet path from the heads to OUT.
    ctx.strokeStyle = muted; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(ST.in, Y - 32); ctx.lineTo(ST.in, BUS); ctx.lineTo(ST.out, BUS); ctx.lineTo(ST.out, Y - 32); ctx.stroke();
    ctx.fillStyle = muted; ctx.font = '700 11px ' + SANS; ctx.textAlign = 'center';
    ctx.fillText('dry', (ST.in + ST.out) / 2, BUS - 12);
    ctx.strokeStyle = cream;
    ctx.beginPath(); ctx.moveTo(xa, Y - 16); ctx.lineTo(xa, WET); ctx.lineTo(ST.out - 20, WET); ctx.lineTo(ST.out - 20, Y - 32); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(xb, Y - 16); ctx.lineTo(xb, WET); ctx.stroke();
    // IN to RECORD.
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(ST.in + 42, Y); ctx.lineTo(ST.rec - 42, Y); ctx.stroke();
    // RECORD to the tape, and the tape's end to OUT's wet path.
    ctx.beginPath(); ctx.moveTo(ST.rec + 42, Y + 8); ctx.lineTo(TAPE.x0, Y + 8); ctx.stroke();
    // The return loop: from head A under the line back to RECORD, as thick as Intensity.
    const flash = Math.max(0, 1 - (f.t - s.back) / 0.4);
    ctx.strokeStyle = flash > 0 ? warm : cream;
    ctx.lineWidth = 1.5 + fb * 9;
    ctx.beginPath(); ctx.moveTo(xa, Y + 18); ctx.lineTo(xa, LOOP); ctx.lineTo(ST.rec, LOOP); ctx.lineTo(ST.rec, Y + 32); ctx.stroke();
    if (hot && hot.loop) {
      ctx.fillStyle = cream; ctx.font = '700 12px ' + SANS; ctx.textAlign = 'left';
      ctx.fillText('▾ pull', xa + 12, LOOP);
    }
    // The tape, wavy by Wow, its marks moving at the tape's speed.
    const speed = (xa - TAPE.x0) / Math.max(0.02, time), amp = 1 + wow * 7;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = cream; ctx.lineWidth = hot && hot.tape ? 16 : 14;
    tapePath(ctx, amp, f.t, speed); ctx.stroke();
    ctx.strokeStyle = field; ctx.lineWidth = 2; ctx.setLineDash([3, 9]); ctx.lineDashOffset = -(f.t * speed) % 12;
    tapePath(ctx, amp, f.t, speed); ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset = 0; ctx.lineCap = 'round';
    // Pulses riding the tape.
    for (const q of s.pulses) {
      const x = xAt(f.t - q.born);
      ctx.fillStyle = warm; ctx.globalAlpha = 0.35 + 0.65 * q.gain;
      ctx.beginPath(); ctx.arc(x, Y + 8, 3 + 4 * q.gain, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // The heads, named with their times; lit as their echo is heard.
    for (const [x, at, name] of [[xa, time, 'A'], [xb, time * 1.5, 'B']]) {
      const on = lit(at);
      ctx.fillStyle = on ? warm : cream;
      ctx.beginPath(); ctx.roundRect(x - 9, Y - 16, 18, 22, 3); ctx.fill();
      if (hot && hot.head) { ctx.strokeStyle = cream; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(x - 13, Y - 20, 26, 30, 5); ctx.stroke(); }
      ctx.fillStyle = field; ctx.font = '800 12px ' + SANS; ctx.textAlign = 'center';
      ctx.fillText(name, x, Y - 5);
      ctx.fillStyle = cream; ctx.font = '600 12px ' + MONO; ctx.textAlign = name === 'A' ? 'right' : 'left';
      ctx.fillText(name === 'A' ? Math.round(at * 1000) + ' ms ◂▸' : '◂▸ ' + Math.round(at * 1000) + ' ms', x + (name === 'A' ? -14 : 14), Y - 26);
    }
    // RECORD: its block, the level going onto tape (the meter over it), its lamp.
    ctx.fillStyle = field;
    ctx.beginPath(); ctx.roundRect(ST.rec - 42, Y - 32, 84, 64, 6); ctx.fill();
    ctx.strokeStyle = cream; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = cream; ctx.font = '800 12px ' + SANS; ctx.textAlign = 'left';
    ctx.fillText('RECORD', ST.rec - 32, Y - 17);
    lamp(ctx, ST.rec + 30, Y - 17, live, warm, track);
    ctx.fillStyle = muted; ctx.font = '700 11px ' + SANS;
    ctx.fillText('onto tape', ST.rec - 32, Y + 21);
    // The value fields; IN and OUT are stations too, with a lamp lit while the signal passes.
    for (const t of FIELDS) {
      const on = hot && hot.id === t.id && !hot.tape && !hot.loop;
      const top = t.station ? 17 : 0;
      ctx.fillStyle = field;
      ctx.beginPath(); ctx.roundRect(t.x, t.y, t.w, t.h, t.station ? 6 : 4); ctx.fill();
      ctx.strokeStyle = on ? warm : t.station ? cream : muted; ctx.lineWidth = on || t.station ? 2 : 1.5; ctx.stroke();
      if (t.station) {
        ctx.fillStyle = cream; ctx.font = '800 12px ' + SANS; ctx.textAlign = 'left';
        ctx.fillText(t.station, t.x + 10, t.y + 15);
        lamp(ctx, t.x + t.w - 12, t.y + 15, live, warm, track);
      }
      ctx.fillStyle = muted; ctx.font = '700 11px ' + SANS; ctx.textAlign = 'left';
      ctx.fillText(t.label, t.x + 9, t.y + top + 13);
      ctx.fillStyle = cream; ctx.font = '600 14px ' + MONO;
      ctx.fillText(show(t.id, f.value(t.id)), t.x + 9, t.y + top + 31);
      ctx.fillStyle = muted;
      for (let i = 0; i < 3; i++) ctx.fillRect(t.x + t.w - 14, t.y + top + 15 + i * 6, 7, 2);
    }
    // The hiss switch, its state in words and lamp.
    ctx.fillStyle = hiss ? cream : field;
    ctx.beginPath(); ctx.roundRect(HISS.x, HISS.y, HISS.w, HISS.h, 15); ctx.fill();
    ctx.strokeStyle = cream; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = hiss ? field : cream; ctx.font = '800 12px ' + SANS; ctx.textAlign = 'left';
    ctx.fillText(hiss ? 'HISS ON' : 'HISS OFF', HISS.x + 12, HISS.y + HISS.h / 2 + 0.5);
    lamp(ctx, HISS.x + HISS.w - 15, HISS.y + HISS.h / 2, hiss, warm, track);
    // The line's state, top right.
    ctx.fillStyle = live ? warm : muted; ctx.font = '800 12px ' + SANS; ctx.textAlign = 'right';
    ctx.fillText(live ? 'RUNNING' : 'STANDBY', w - 40, 38);
    lamp(ctx, w - 28, 38, live, warm, track);
  },
  pointer(e, f) {
    const s = f.state, fine = e.shift ? 0.1 : 1;
    if (e.type === 'down') {
      const t = where(e.x, e.y, f);
      s.drag = t && !t.hiss ? { ...t, x: e.x, y: e.y, norm: f.norm(t.id) } : null;
      if (t && t.hiss) f.set('thiss', !f.on('thiss'));
    }
    if (e.type === 'up' || e.type === 'leave') s.drag = null;
    const d = s.drag;
    if (d && (e.type === 'down' || e.type === 'move')) {
      if (d.head) f.set('ktime', Math.max(0.06, Math.min(0.8, secAt(e.x) / d.head)));
      else if (e.type === 'move') {
        const dy = d.loop ? e.y - d.y : d.y - e.y;
        f.setNorm(d.id, Math.max(0, Math.min(1, d.norm + (dy / 200) * fine)));
      }
    }
    if (e.type === 'wheel' || e.type === 'double') {
      const t = where(e.x, e.y, f);
      if (t && !t.hiss && e.type === 'wheel') f.setNorm(t.id, Math.max(0, Math.min(1, f.norm(t.id) - (e.dy / 100) * 0.01 * fine)));
      if (t && !t.hiss && e.type === 'double') f.set(t.id, t.first ?? (t.head ? 0.32 : t.tape ? 0.0012 : 0.55));
    }
    const at = s.drag ?? where(e.x, e.y, f);
    f.cursor(!at ? 'default' : at.hiss ? 'pointer' : at.head ? 'ew-resize' : 'ns-resize');
  },
};
`;

export function tapeecho(catalog: Catalog) {
  return work(
    'tapeecho',
    'Echo Line',
    catalog,
    [780, 380],
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
            bg: '#0f2a24',
            fg: '#efe6cf',
            accent: '#ff8a3d',
            track: '#2b4a42',
            knob: '#0a1f1a',
            pointer: '#efe6cf',
            muted: '#8fa89a',
            glow: '#ff8a3d',
            font: 'saira-stencil-one',
            labelFont: 'share-tech-mono',
            valueFont: 'share-tech-mono',
          },
          background: [{ kind: 'color', color: '#0f2a24' }],
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
        rect: r(0, 0, 780, 380),
      }),
      el({
        kind: 'text',
        name: 'Title',
        text: 'ECHO LINE',
        rect: r(24, 22, 300, 32),
        textStyle: { font: 'saira-stencil-one', size: 26, color: 'fg', align: 'left' },
      }),
      // The level going onto tape, in the RECORD station.
      ...control('vu1', 'ui.meter', 'Onto tape', null, r(156, 200, 64, 10), {
        style: { tokens: { track: '#2b4a42', accent: '#ff8a3d' } },
      }),
      wire('trim1.out', 'vu1.in'),
    ],
  );
}
