// Septet — a supersaw whose seven saws are all on the screen at once.
// One saw is a part (Saw): it reads its copy number, so copy k of 7 plays a
// little off the note — spread evenly from flat to sharp by Detune, plus a
// small fixed drift of its own. Used ×7 in every voice, its thick cable goes
// through Splay (Width: from one centre saw to a wall from left to right), a
// lowpass per side that opens with each note, and a hall. Detune and Drift
// are on the Saw's face on the plugin; turning them never recompiles.
// The design follows the thinking of the Tektronix 5 Series MSO (Red Dot 2018,
// Product Design): every incoming signal shown at once on one large display,
// colour-coded channels, and controls big enough for a finger. The display
// draws the seven saws as seven lanes — how far apart they run is Detune, how
// they drift against each other is the beating you hear, and the marker at
// each lane's end is where Width puts it between left and right.
import type { Catalog } from '../../work/catalog.ts';
import type { PartFace, PatchDocument } from '../../work/schema.ts';
import { faceIntents } from '../faces.ts';
import { add, control, el, onlyParams, r, wire, workInSteps } from './build.ts';

/** The seven lanes' colours (copy 1 is the flattest saw, copy 7 the sharpest). */
const LANES = ['#c2410c', '#a16207', '#2f7d32', '#0e7490', '#1d4ed8', '#6d28d9', '#be185d'];

/** The display: seven saws, one lane each, moving as they beat; Width's place at each lane's end. */
export const SAW_LANES = `// Seven saws, one lane each (props.colors, top: the flattest). A saw's lane is drawn
// at its own pitch: copy k plays Detune × (its place from -1 to +1) semitones off
// the note, plus a small drift of its own (props.detune and props.drift name the
// Saw's face knobs). The lanes slide against each other as fast as they beat at
// A3, slowed down to be followed by eye; the louder the sound, the taller the
// saws. The marker at the right is where Width (kwidth) puts the copy.
const DRIFT = [0.42, -0.77, 0.15, -0.31, 0.88, -0.56, 0.69];
export default {
  draw(ctx, f) {
    const w = f.w, h = f.h, n = 7, lane = h / n;
    const colors = String(f.props.colors || '').split(',');
    const detune = f.value(String(f.props.detune)), drift = f.value(String(f.props.drift));
    const width = f.value('kwidth');
    const loud = Math.min(1, f.level * 7);
    const track = f.color('track'), muted = f.color('muted');
    const left = 34, right = w - 92, period = 78;
    ctx.clearRect(0, 0, w, h);
    for (let k = 0; k < n; k++) {
      const y0 = k * lane, mid = y0 + lane / 2;
      const place = n > 1 ? (k / (n - 1)) * 2 - 1 : 0;
      const st = detune * place + drift * DRIFT[k];
      const ratio = Math.pow(2, st / 12);
      const p = period / ratio;
      const phase = (f.t * 220 * (ratio - 1) * 0.12) % 1;
      const amp = (lane * 0.36) * (0.35 + 0.65 * loud);
      const c = colors[k] || f.color('accent');
      ctx.strokeStyle = track;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(left, Math.round(y0 + lane) - 0.5); ctx.lineTo(w, Math.round(y0 + lane) - 0.5); ctx.stroke();
      ctx.save();
      ctx.beginPath(); ctx.rect(left, y0, right - left, lane); ctx.clip();
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const shift = phase * p;
      for (let x = left - p + shift; x < right + p; x += p) {
        ctx.moveTo(x, mid + amp);
        ctx.lineTo(x + p, mid - amp);
        ctx.lineTo(x + p, mid + amp);
      }
      ctx.stroke();
      ctx.restore();
      // Where Width puts this copy, left to right.
      const sx = right + 14, sw = w - sx - 6;
      ctx.strokeStyle = track;
      ctx.beginPath(); ctx.moveTo(sx, mid + 0.5); ctx.lineTo(sx + sw, mid + 0.5); ctx.stroke();
      ctx.fillStyle = muted;
      ctx.fillRect(sx + sw / 2 - 0.5, mid - 4, 1, 9);
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(sx + sw / 2 + (place * width * sw) / 2, mid + 0.5, 4.5, 0, Math.PI * 2); ctx.fill();
    }
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

/** The Saw's own screen: Detune and Drift under its name. */
export const SAW_FACE: PartFace = {
  width: 208,
  height: 140,
  controls: [
    { param: 'detune', type: 'ui.knob', rect: { x: 8, y: 26, w: 96, h: 108 }, label: 'Detune', style: KNOB },
    { param: 'drift', type: 'ui.knob', rect: { x: 104, y: 26, w: 96, h: 108 }, label: 'Drift', style: KNOB },
  ],
  elements: [
    { id: 'frame', kind: 'shape', shape: 'rect', rect: { x: 0, y: 0, w: 208, h: 140 }, style: CARD },
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

/** The control on the plugin wired to a parameter of the Saw's use (its face). */
const faceKnob = (doc: PatchDocument, param: string) =>
  Object.values(doc.edges).find(e => e.to.node === 'saw1' && e.to.port === param)?.from.node ?? '';

export function supersaw(catalog: Catalog) {
  const inside = ['copy1', 'spread1', 'driftdir1', 'drift1', 'offset1', 'note1', 'mtof1', 'osc1'];
  return workInSteps(
    'supersaw',
    'Septet',
    catalog,
    [760, 556],
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
        // ---- the plugin: one display with all seven saws, finger-sized controls below ----
        {
          op: 'setLook',
          look: {
            tokens: {
              bg: '#f3f4f1',
              fg: '#17191c',
              accent: '#1c64d8',
              track: '#dde1e5',
              knob: '#ffffff',
              pointer: '#17191c',
              muted: '#5d646d',
              glow: '#1c64d8',
              font: 'lato',
              labelFont: 'lato',
              valueFont: 'jetbrains-mono',
            },
            background: [{ kind: 'color', color: '#f3f4f1' }],
            skins: {
              knob: { name: 'ring', params: { thickness: 5, ticks: 0, round: true } },
              keyboard: { name: 'piano', params: { octaves: 3, start: 48, lit: '#1c64d8' } },
            },
            css: '[data-widget=keys1] { --dk-key-line: #c9ced4; --dk-key-black: #2a2e33; }',
          },
        },
        el({
          kind: 'text',
          name: 'Title',
          text: 'Septet',
          rect: r(24, 18, 200, 30),
          textStyle: { size: 24, weight: 700, color: 'fg', align: 'left' },
        }),
        el({
          kind: 'text',
          name: 'Subtitle',
          text: 'Supersaw. Seven saws for every note, all on one screen.',
          rect: r(24, 50, 420, 16),
          textStyle: { size: 12, color: 'muted', align: 'left' },
        }),
        el({
          kind: 'shape',
          shape: 'rect',
          name: 'Display',
          rect: r(24, 80, 712, 228),
          locked: true,
          style: CARD,
        }),
        ...LANES.flatMap((color, k) => [
          el({
            kind: 'shape',
            shape: 'rect',
            name: `Lane ${k + 1} chip`,
            rect: r(32, Math.round(84 + (k + 0.5) * (220 / 7) - 9), 22, 18),
            locked: true,
            style: { radius: 4, fill: [{ kind: 'color', color }] },
          }),
          el({
            kind: 'text',
            name: `Lane ${k + 1}`,
            text: String(k + 1),
            rect: r(32, Math.round(84 + (k + 0.5) * (220 / 7) - 8), 22, 16),
            textStyle: { font: 'jetbrains-mono', size: 11, weight: 700, color: '#ffffff', align: 'center' },
          }),
        ]),
        ...control('kwidth', 'ui.knob', 'Width', 'splay1.width', r(240, 350, 96, 108), {
          min: 0,
          max: 1,
          value: 0.8,
          style: KNOB,
        }),
        ...control('kcut', 'ui.knob', 'Cutoff', 'cut1.hz', r(340, 350, 96, 108), {
          min: 60,
          max: 8000,
          scale: 'log',
          unit: 'Hz',
          value: 900,
          style: KNOB,
        }),
        ...control('kenv', 'ui.knob', 'Env', 'envamt1.b', r(440, 350, 96, 108), {
          min: 0,
          max: 6,
          unit: 'oct',
          value: 2.5,
          style: KNOB,
        }),
        ...control('krel', 'ui.knob', 'Release', 'aenv1.release', r(540, 350, 96, 108), {
          min: 0.02,
          max: 4,
          scale: 'log',
          unit: 's',
          value: 0.5,
          style: KNOB,
        }),
        ...control('kspace', 'ui.knob', 'Space', 'hall1.mix', r(640, 350, 96, 108), {
          min: 0,
          max: 1,
          value: 0.22,
          style: KNOB,
        }),
        ...control('keys1', 'ui.keyboard', 'Keys', null, r(24, 476, 712, 60)),
      ],
      // The Saw's face on the plugin: Detune and Drift for all seven saws of every voice.
      doc => faceIntents(doc, catalog, 'saw1', { at: { x: 24, y: 324 } }).intents,
      // The display reads the face's knobs (their ids come with the face).
      doc => [
        el({
          kind: 'canvas',
          name: 'Seven saws',
          code: SAW_LANES,
          rect: r(28, 84, 704, 220),
          props: { detune: faceKnob(doc, 'detune'), drift: faceKnob(doc, 'drift'), colors: LANES.join(',') },
        }),
      ],
    ],
  );
}
