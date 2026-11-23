// Septet — a supersaw whose seven saws are all on the screen at once.
// One saw is a part (Saw): it reads its copy number, so copy k of 7 plays a
// little off the note — spread evenly from flat to sharp by Detune, plus a
// small fixed drift of its own. Used ×7 in every voice, its thick cable goes
// through Splay (Width: from one centre saw to a wall from left to right), a
// lowpass per side that opens with each note, and a hall. Detune and Drift are
// the Saw's own parameters, set for every copy at once; turning them never
// recompiles.
// The design follows the thinking of the Tektronix 5 Series MSO (Red Dot 2018,
// Product Design): an instrument made for touch, where every incoming signal is
// on one large display at once and gestures on the display replace most
// physical controls. The whole plugin is that display: the seven copies run as
// seven stacked lanes, each at its own pitch, so Detune shows as lanes that
// drift against each other; dragging across the lanes spreads them (Detune),
// dragging the dots of the stereo column spreads them from left to right
// (Width), and the other settings are readout tags along the bottom edge,
// dragged up and down like a scope's badges.
import type { Catalog } from '../../work/catalog.ts';
import type { PartFace } from '../../work/schema.ts';
import { add, control, el, onlyParams, patchControl, r, wire, workInSteps } from './build.ts';

/** The display: the seven saws as lanes you spread, the stereo column, the readout tags; it takes the mouse. */
export const SAW_LANES = `// The whole plugin is one display. Seven lanes, one per copy of the Saw (top:
// the flattest). Copy k plays Detune × (its place from -1 to +1) semitones off
// the note plus a small drift of its own (kdetune, kdrift), so each lane is drawn
// at its own pitch (the difference shown 8× larger) and slides against the
// middle lane as fast as it beats, slowed down for the eye; a lower Cutoff
// (kcut, opened by Env, kenv) rounds the teeth. Drag across the lanes: Detune.
// The column on the right is where Width (kwidth) puts each copy from left to
// right: drag a dot. The tags along the bottom are dragged up and down (200 px
// is the whole range, Shift is finer), scrolled, or double-clicked for their
// first value.
const DRIFT = [0.42, -0.77, 0.15, -0.31, 0.88, -0.56, 0.69];
const N = 7, ZOOM = 8, TEETH = 18;
const LANES = { x0: 64, x1: 548, top: 84, lane: 48 };
const COLUMN = { x0: 596, x1: 736 };
const TAGS = [
  { id: 'kdetune', label: 'Detune', unit: 'st', x: 120, w: 100, first: 0.35 },
  { id: 'kdrift', label: 'Drift', unit: 'st', x: 228, w: 100, first: 0.08 },
  { id: 'kcut', label: 'Cutoff', unit: 'Hz', x: 352, w: 92, first: 900 },
  { id: 'kenv', label: 'Env', unit: 'oct', x: 452, w: 92, first: 2.5 },
  { id: 'krel', label: 'Release', unit: 's', x: 552, w: 92, first: 0.5 },
  { id: 'kspace', label: 'Space', unit: '', x: 652, w: 84, first: 0.22 },
];
const TAG_Y = 450, TAG_H = 50;
const SANS = 'system-ui, sans-serif', MONO = 'ui-monospace, monospace';
const bottom = () => LANES.top + N * LANES.lane;
const placeOf = k => (k / (N - 1)) * 2 - 1;
function show(v, unit) {
  if (unit === 'Hz') return v >= 1000 ? (v / 1000).toFixed(2) + ' kHz' : Math.round(v) + ' Hz';
  if (unit === 's') return v < 1 ? Math.round(v * 1000) + ' ms' : v.toFixed(2) + ' s';
  if (unit === 'st') return v.toFixed(2) + ' st';
  if (unit === 'oct') return v.toFixed(1) + ' oct';
  return Math.round(v * 100) + ' %';
}
function where(x, y) {
  for (const t of TAGS) if (x >= t.x && x <= t.x + t.w && y >= TAG_Y && y <= TAG_Y + TAG_H) return t;
  if (y >= LANES.top && y <= bottom()) {
    if (x >= LANES.x0 - 10 && x <= LANES.x1 + 30) return { id: 'kdetune', lanes: true };
    if (x >= COLUMN.x0 - 12 && x <= COLUMN.x1 + 6) return { id: 'kwidth', column: true, lane: Math.min(N - 1, Math.floor((y - LANES.top) / LANES.lane)) };
  }
  return null;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}
export default {
  setup(ctx, f) {
    f.state.drag = null;
  },
  draw(ctx, f) {
    const w = f.w, h = f.h, s = f.state;
    const ink = f.color('fg'), paper = f.color('bg'), white = f.color('accent'), line = f.color('track');
    const detune = f.value('kdetune'), drift = f.value('kdrift'), width = f.value('kwidth');
    const cut = f.value('kcut') * Math.pow(2, f.value('kenv') * 0.4);
    const round = Math.max(0, Math.min(0.85, Math.log2(5000 / cut) / 5));
    const loud = Math.min(1, f.level * 6);
    const p = f.pointer, hot = s.drag ? s.drag : p && p.over ? where(p.x, p.y) : null;
    ctx.clearRect(0, 0, w, h);
    // The lanes: one copy each, a tab with its number on the left edge, like a scope's channels.
    const T = (LANES.x1 - LANES.x0) / TEETH;
    const knot = TEETH / 2 + (TEETH / 2 - 2) * Math.sin(f.t * 0.45);
    for (let k = 0; k < N; k++) {
      const y0 = LANES.top + k * LANES.lane, mid = y0 + LANES.lane / 2;
      const st = detune * placeOf(k) + drift * DRIFT[k];
      const ratio = 1 + ZOOM * (Math.pow(2, st / 12) - 1);
      const amp = LANES.lane * 0.3 * (0.5 + 0.5 * loud);
      ctx.fillStyle = ink;
      roundRect(ctx, 24, mid - 11, 28, 22, 5); ctx.fill();
      ctx.fillStyle = white;
      ctx.font = '700 13px ' + SANS; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(k + 1), 38, mid + 0.5);
      ctx.strokeStyle = line; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(LANES.x0, mid + 0.5); ctx.lineTo(LANES.x1, mid + 0.5); ctx.stroke();
      // Teeth where this copy's phase is whole: all lanes meet at the knot and part away from it.
      ctx.save();
      ctx.beginPath(); ctx.rect(LANES.x0, y0, LANES.x1 - LANES.x0, LANES.lane); ctx.clip();
      ctx.strokeStyle = ink; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
      ctx.beginPath();
      const at = n => LANES.x0 + ((n + (ratio - 1) * knot) / ratio) * T;
      const first = Math.floor(-(ratio - 1) * knot) - 1;
      const fall = (round * 0.6 * T) / ratio;
      for (let n = first; at(n) < LANES.x1 + T; n++) {
        const xa = at(n), xb = at(n + 1);
        if (n === first) ctx.moveTo(xa, mid + amp);
        ctx.lineTo(xb - fall, mid - amp);
        ctx.lineTo(xb, mid + amp);
      }
      ctx.stroke();
      ctx.restore();
      // This copy's offset, in semitones.
      ctx.fillStyle = ink;
      ctx.font = '600 11px ' + MONO; ctx.textAlign = 'right';
      ctx.fillText((st >= 0 ? '+' : '−') + Math.abs(st).toFixed(2), LANES.x1 + 40, mid + 0.5);
      // Where Width puts it, left to right.
      const cx = (COLUMN.x0 + COLUMN.x1) / 2, half = (COLUMN.x1 - COLUMN.x0) / 2;
      ctx.strokeStyle = ink; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(COLUMN.x0, mid + 0.5); ctx.lineTo(COLUMN.x1, mid + 0.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, mid - 6); ctx.lineTo(cx, mid + 7); ctx.stroke();
      const dot = cx + placeOf(k) * width * half;
      ctx.beginPath(); ctx.arc(dot, mid + 0.5, hot && hot.column ? 8 : 7, 0, Math.PI * 2);
      ctx.fillStyle = white; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = ink; ctx.stroke();
    }
    // The column's head: L, R and Width.
    ctx.fillStyle = ink; ctx.textBaseline = 'middle';
    ctx.font = '700 12px ' + SANS;
    ctx.textAlign = 'left'; ctx.fillText('L', COLUMN.x0, LANES.top - 14);
    ctx.textAlign = 'right'; ctx.fillText('R', COLUMN.x1, LANES.top - 14);
    ctx.textAlign = 'center';
    ctx.fillText('Width ' + show(width, ''), (COLUMN.x0 + COLUMN.x1) / 2, LANES.top - 14);
    // The output level's name, by its meter (the meter is a control over the display).
    ctx.textAlign = 'right'; ctx.font = '700 12px ' + SANS;
    ctx.fillText('Out', COLUMN.x0 - 10, 33);
    ctx.textAlign = 'center';
    // Over the lanes: the handle that says what dragging does.
    const grip = { x: LANES.x1 - 104, y: LANES.top - 26, w: 104, h: 22 };
    ctx.fillStyle = hot && hot.lanes ? ink : white;
    roundRect(ctx, grip.x, grip.y, grip.w, grip.h, 11); ctx.fill();
    ctx.fillStyle = hot && hot.lanes ? white : ink;
    ctx.font = '700 12px ' + SANS;
    ctx.fillText('◂  Detune  ▸', grip.x + grip.w / 2, grip.y + grip.h / 2 + 0.5);
    if (hot && hot.lanes && p && p.over) {
      ctx.strokeStyle = white; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(Math.round(p.x) + 0.5, LANES.top); ctx.lineTo(Math.round(p.x) + 0.5, bottom()); ctx.stroke();
    }
    // The Saw: one part, its seven copies are the lanes; its tags set every copy at once.
    ctx.strokeStyle = ink; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(38, bottom() - LANES.lane / 2 + 11); ctx.lineTo(38, TAG_Y); ctx.stroke();
    roundRect(ctx, 24, TAG_Y, 88, TAG_H, 8);
    ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = ink; ctx.textAlign = 'left';
    ctx.font = '800 15px ' + SANS; ctx.fillText('Saw ×7', 34, TAG_Y + 18);
    ctx.font = '600 11px ' + SANS; ctx.fillText('every copy', 34, TAG_Y + 36);
    for (const t of TAGS) {
      const on = hot && hot.id === t.id && !hot.lanes && !hot.column;
      ctx.fillStyle = ink;
      roundRect(ctx, t.x, TAG_Y, t.w, TAG_H, 8); ctx.fill();
      if (on) { ctx.lineWidth = 2.5; ctx.strokeStyle = white; ctx.stroke(); }
      ctx.textAlign = 'left';
      ctx.fillStyle = paper; ctx.font = '700 11px ' + SANS;
      ctx.fillText(t.label, t.x + 10, TAG_Y + 15);
      ctx.fillStyle = white; ctx.font = '600 14px ' + MONO;
      ctx.fillText(show(f.value(t.id), t.unit), t.x + 10, TAG_Y + 34);
      // Up and down: a tag is dragged like a scope's readout.
      ctx.fillStyle = paper;
      const ax = t.x + t.w - 12;
      ctx.beginPath(); ctx.moveTo(ax - 4, TAG_Y + 21); ctx.lineTo(ax, TAG_Y + 15); ctx.lineTo(ax + 4, TAG_Y + 21); ctx.fill();
      ctx.beginPath(); ctx.moveTo(ax - 4, TAG_Y + 29); ctx.lineTo(ax, TAG_Y + 35); ctx.lineTo(ax + 4, TAG_Y + 29); ctx.fill();
    }
  },
  pointer(e, f) {
    const s = f.state;
    const fine = e.shift ? 0.1 : 1;
    if (e.type === 'down') {
      const t = where(e.x, e.y);
      s.drag = t ? { ...t, x: e.x, y: e.y, from: f.value(t.id), norm: f.norm(t.id) } : null;
    }
    if (e.type === 'up' || e.type === 'leave') s.drag = null;
    const d = s.drag;
    if (d && (e.type === 'down' || e.type === 'move')) {
      if (d.lanes) f.set('kdetune', Math.max(0, Math.min(1, d.from + ((e.x - d.x) / 400) * fine)));
      else if (d.column) {
        const place = placeOf(d.lane), cx = (COLUMN.x0 + COLUMN.x1) / 2, half = (COLUMN.x1 - COLUMN.x0) / 2;
        const v = Math.abs(place) > 0.1 ? (e.x - cx) / (half * place) : d.from + (e.x - d.x) / half;
        f.set('kwidth', Math.max(0, Math.min(1, v)));
      } else if (e.type === 'move') f.setNorm(d.id, Math.max(0, Math.min(1, d.norm + ((d.y - e.y) / 200) * fine)));
    }
    if (e.type === 'wheel' || e.type === 'double') {
      const t = where(e.x, e.y);
      if (t && e.type === 'wheel') f.setNorm(t.id, Math.max(0, Math.min(1, f.norm(t.id) - (e.dy / 100) * 0.01 * fine)));
      if (t && e.type === 'double') f.set(t.id, t.first ?? (t.lanes ? 0.35 : 0.8));
    }
    const at = s.drag ?? where(e.x, e.y);
    f.cursor(!at ? 'default' : at.lanes || at.column ? 'ew-resize' : 'ns-resize');
  },
};
`;

/** How the knobs read on this plugin (the Saw's face and the others alike). */
const KNOB = {
  textStyle: { size: 10, weight: 700, color: 'muted', case: 'upper' as const, spacing: 0.14 },
};
const CARD = {
  radius: 10,
  fill: [{ kind: 'color' as const, color: '#ffffff' }],
  stroke: { color: '#d9dde2', width: 1, style: 'solid' as const },
};

/** The Saw's own screen, for a plugin that puts it on: Detune and Drift under its name. */
export const SAW_FACE: PartFace = {
  width: 208,
  height: 140,
  controls: [
    {
      param: 'detune',
      type: 'ui.knob',
      rect: { x: 8, y: 26, w: 96, h: 108 },
      label: 'Detune',
      style: KNOB,
    },
    {
      param: 'drift',
      type: 'ui.knob',
      rect: { x: 104, y: 26, w: 96, h: 108 },
      label: 'Drift',
      style: KNOB,
    },
  ],
  elements: [
    {
      id: 'frame',
      kind: 'shape',
      shape: 'rect',
      rect: { x: 0, y: 0, w: 208, h: 140 },
      style: CARD,
    },
    {
      id: 'title',
      kind: 'text',
      text: 'Saw ×7',
      rect: { x: 14, y: 9, w: 90, h: 18 },
      textStyle: { size: 13, weight: 700, color: 'fg', align: 'left' },
    },
    {
      id: 'what',
      kind: 'text',
      text: 'every copy at once',
      rect: { x: 94, y: 11, w: 104, h: 14 },
      textStyle: { size: 10, color: 'muted', align: 'right' },
    },
  ],
};

export function supersaw(catalog: Catalog) {
  const inside = ['copy1', 'spread1', 'driftdir1', 'drift1', 'offset1', 'note1', 'mtof1', 'osc1'];
  return workInSteps(
    'supersaw',
    'Septet',
    catalog,
    [760, 520],
    [
      [
        // ---- one saw of seven: the note, moved by where this copy sits and a little drift of its own ----
        add('voice1', 'kit.voiceIn', { config: { mode: 'poly', capacity: 4, heldCapacity: 16 } }),
        add('copy1', 'kit.copy', { label: 'Which saw' }),
        add('spread1', 'kit.mul', { label: 'Spread', values: { b: 0.35 } }),
        add('driftdir1', 'kit.scale', { label: 'Drift way', values: { scale: 2, offset: -1 } }),
        add('drift1', 'kit.mul', { label: 'Drift', values: { b: 0.08 } }),
        add('offset1', 'kit.add', { label: 'Off by' }),
        add('note1', 'kit.add', { label: 'Note' }),
        add('mtof1', 'kit.mtof'),
        add('osc1', 'den.oscillator', { label: 'Saw', config: { waveform: 'saw' } }),
        wire('copy1.position', 'spread1.a'),
        wire('copy1.random', 'driftdir1.in'),
        wire('driftdir1.out', 'drift1.a'),
        wire('spread1.out', 'offset1.a'),
        wire('drift1.out', 'offset1.b'),
        wire('voice1.note', 'note1.a'),
        wire('offset1.out', 'note1.b'),
        wire('note1.out', 'mtof1.note'),
        wire('mtof1.out', 'osc1.frequency'),
        // ---- the voice: Splay, a lowpass per side that opens with each note, the amp ----
        add('splay1', 'kit.splay', { label: 'Width', values: { width: 0.8 } }),
        add('fenv1', 'den.envelope', {
          label: 'Filter Env',
          values: { attack: 0.005, decay: 0.6, sustain: 0.4, release: 0.4 },
        }),
        add('envamt1', 'kit.mul', { label: 'Env Amount', values: { b: 2.5 } }),
        add('cut1', 'kit.cutoffMod', { values: { hz: 900 } }),
        add('lpl1', 'den.filter', { label: 'Lowpass L', values: { resonance: 0.9 } }),
        add('lpr1', 'den.filter', { label: 'Lowpass R', values: { resonance: 0.9 } }),
        add('aenv1', 'den.envelope', {
          label: 'Amp Env',
          values: { attack: 0.01, decay: 0.3, sustain: 0.85, release: 0.5 },
        }),
        add('vel1', 'kit.mul', { label: 'Velocity' }),
        add('vcal1', 'kit.mul', { label: 'VCA L' }),
        add('vcar1', 'kit.mul', { label: 'VCA R' }),
        add('mixl1', 'kit.voiceMix', { label: 'Voices L' }),
        add('mixr1', 'kit.voiceMix', { label: 'Voices R' }),
        add('hall1', 'den.algorithmicReverb', {
          label: 'Hall',
          config: { roomScale: 1.2, decaySeconds: 2.8, dampingHz: 7000 },
          values: { mix: 0.22 },
        }),
        add('gl1', 'kit.gain', { label: 'Level L', values: { gain: 0.25 } }),
        add('gr1', 'kit.gain', { label: 'Level R', values: { gain: 0.25 } }),
        add('out1', 'kit.out'),
        wire('osc1.out', 'splay1.in'),
        wire('splay1.left', 'lpl1.input'),
        wire('splay1.right', 'lpr1.input'),
        wire('fenv1.level', 'envamt1.a'),
        wire('envamt1.out', 'cut1.octaves'),
        wire('cut1.out', 'lpl1.cutoff'),
        wire('cut1.out', 'lpr1.cutoff'),
        wire('aenv1.level', 'vel1.a'),
        wire('voice1.velocity', 'vel1.b'),
        wire('lpl1.out', 'vcal1.a'),
        wire('vel1.out', 'vcal1.b'),
        wire('lpr1.out', 'vcar1.a'),
        wire('vel1.out', 'vcar1.b'),
        wire('vcal1.out', 'mixl1.in'),
        wire('vcar1.out', 'mixr1.in'),
        wire('aenv1.done', 'mixl1.done'),
        wire('aenv1.done', 'mixr1.done'),
        wire('mixl1.out', 'hall1.left'),
        wire('mixr1.out', 'hall1.right'),
        wire('hall1.left', 'gl1.in'),
        wire('hall1.right', 'gr1.in'),
        wire('gl1.out', 'out1.left'),
        wire('gr1.out', 'out1.right'),
        // The saw becomes a part (the note comes in, the saw goes out).
        { op: 'makePart', ids: inside, name: 'Saw', id: 'saw', node: 'saw1' },
      ],
      // Its knobs, in semitones: how far apart the seven are, and how far each drifts on its own.
      doc =>
        onlyParams(doc, 'saw', [
          {
            node: 'spread1',
            port: 'b',
            id: 'detune',
            label: 'Detune',
            range: { min: 0, max: 1, unit: 'st' },
          },
          {
            node: 'drift1',
            port: 'b',
            id: 'drift',
            label: 'Drift',
            range: { min: 0, max: 0.5, unit: 'st' },
          },
        ]),
      [
        {
          op: 'updatePart',
          part: 'saw',
          doc: 'One saw of a supersaw: copy k of N plays the note off by its place (from −Detune to +Detune) and a small drift of its own. Use it ×7 into Splay.',
          labels: { a: 'Note' },
          face: SAW_FACE,
        },
        { op: 'setCount', node: 'saw1', count: 7 },
        // ---- the plugin: one display, operated on the display ----
        {
          op: 'setLook',
          look: {
            tokens: {
              bg: '#e5432a',
              fg: '#0a0a0a',
              accent: '#ffffff',
              track: '#b8301b',
              knob: '#0a0a0a',
              pointer: '#ffffff',
              muted: '#ffffff',
              glow: '#ffffff',
              font: 'michroma',
              labelFont: 'michroma',
              valueFont: 'jetbrains-mono',
            },
            background: [{ kind: 'color', color: '#e5432a' }],
            skins: { meter: { name: 'bar', params: { scale: false } } },
          },
        },
      ],
      // The Saw's parameters, for every copy at once, and the voice's: in the patch, moved on the display.
      () => [
        ...patchControl('kdetune', 'Detune', 'saw1.detune', [0, 1, 'linear', 'st'], 0.35),
        ...patchControl('kdrift', 'Drift', 'saw1.drift', [0, 0.5, 'linear', 'st'], 0.08),
        ...patchControl('kwidth', 'Width', 'splay1.width', [0, 1, 'linear', ''], 0.8),
        ...patchControl('kcut', 'Cutoff', 'cut1.hz', [60, 8000, 'log', 'Hz'], 900),
        ...patchControl('kenv', 'Env', 'envamt1.b', [0, 6, 'linear', 'oct'], 2.5),
        ...patchControl('krel', 'Release', 'aenv1.release', [0.02, 4, 'log', 's'], 0.5),
        ...patchControl('kspace', 'Space', 'hall1.mix', [0, 1, 'linear', ''], 0.22),
        el({
          kind: 'canvas',
          name: 'Seven saws',
          code: SAW_LANES,
          rect: r(0, 0, 760, 520),
        }),
        el({
          kind: 'text',
          name: 'Title',
          text: 'SEPTET',
          rect: r(24, 22, 300, 34),
          textStyle: { font: 'michroma', size: 26, weight: 400, color: 'fg', align: 'left' },
        }),
        ...control('vu1', 'ui.meter', 'Out', null, r(596, 28, 140, 10), {
          style: { tokens: { track: '#b8301b', accent: '#0a0a0a' } },
        }),
        wire('gl1.out', 'vu1.in'),
      ],
    ],
  );
}
