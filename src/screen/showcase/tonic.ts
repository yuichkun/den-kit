// Tonic — a tanpura-style drone to sing or practise over.
// One string is a part (String): a slow square wave, offset by the copy's
// number, plucks it once per cycle; a saw rings through a warm lowpass and a
// narrow band that slides down from high overtones to the note as the pluck
// dies (the buzz of the bridge, "jawari"). The part runs ×4 and its Interval
// gives each copy its own string by an `each` spread: the lower fifth (Pa), two
// at the tonic (Sa) and one an octave below, plucked in turn. Splay spreads
// the four strings and a hall holds them.
// The design follows the thinking of NaadSadhana (Apple Design Awards 2021,
// Innovation), an app for practising Indian classical singing: the singer's
// tonic is the centre and every note is shown by its distance from it. Here
// the twelve notes stand round a circle; touching one makes it Sa, the fifth
// is drawn across to it, and each pluck rings out from its string's note, in
// time with what is heard.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, onlyParams, patchControl, r, wire, workInSteps } from './build.ts';

/** The circle of the twelve notes: Sa where the tonic is, the fifth across, plucks ringing out; it takes the mouse. */
export const TONIC_CIRCLE = `// The twelve notes round a circle, C at the top (their names are text on the
// plugin, outside the ring). Sa sits on the tonic (ksa, a MIDI note), Pa a fifth
// above it, joined by a line. A pluck is heard as a jump in the output level;
// each one rings out from its string's note, in turn: Pa, Sa, Sa, low Sa.
// Press a note to make it the tonic.
const ORDER = [7, 0, 0, 0]; // the strings' notes above Sa (the low Sa sits on Sa too)
export default {
  setup(ctx, f) {
    Object.assign(f.state, { prev: 0, last: -10, string: 3, rings: [] });
  },
  draw(ctx, f) {
    const s = f.state, w = f.w, h = f.h, cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 46;
    const fg = f.color('fg'), accent = f.color('accent'), muted = f.color('muted'), track = f.color('track');
    const sa = ((Math.round(f.value('ksa')) % 12) + 12) % 12;
    const at = pc => {
      const a = (pc / 12) * Math.PI * 2 - Math.PI / 2;
      return [cx + Math.cos(a) * R, cy + Math.sin(a) * R];
    };
    ctx.clearRect(0, 0, w, h);
    // A pluck: the output jumps up. Each starts a ring at the next string's note.
    const gap = 60 / Math.max(20, f.value('kbpm')) * 0.55;
    if (f.level > s.prev * 1.12 + 0.002 && f.t - s.last > gap) {
      s.last = f.t;
      s.string = (s.string + 1) % 4;
      s.rings.push({ born: f.t, pc: (sa + ORDER[s.string]) % 12, low: s.string === 3 });
    }
    s.prev = s.prev * 0.9 + f.level * 0.1;
    s.rings = s.rings.filter(q => f.t - q.born < 2.4);
    // The ring of notes, and the breath of the sound in the middle.
    ctx.strokeStyle = track;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    const loud = Math.min(1, f.level * 6);
    for (let i = 1; i <= 3; i++) {
      ctx.globalAlpha = 0.12 + 0.18 * loud;
      ctx.beginPath(); ctx.arc(cx, cy, R * (0.18 + i * 0.12) * (1 + 0.03 * loud), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Sa to Pa: the fifth, across the circle.
    const [sx, sy] = at(sa), [px, py] = at((sa + 7) % 12);
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(px, py); ctx.stroke();
    ctx.globalAlpha = 1;
    // Plucks ringing out, inside the ring of names (so the names stay readable).
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R + 8, 0, Math.PI * 2); ctx.clip();
    for (const q of s.rings) {
      const age = (f.t - q.born) / 2.4, [qx, qy] = at(q.pc);
      ctx.strokeStyle = q.low ? fg : accent;
      ctx.globalAlpha = (1 - age) * 0.8;
      ctx.lineWidth = 2 * (1 - age) + 0.5;
      ctx.beginPath(); ctx.arc(qx, qy, 10 + age * (q.low ? 70 : 46), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    // The twelve places; Sa filled, Pa ringed.
    for (let pc = 0; pc < 12; pc++) {
      const [x, y] = at(pc);
      const hover = f.pointer && f.pointer.over && Math.hypot(f.pointer.x - x, f.pointer.y - y) < 22;
      if (pc === sa) {
        ctx.fillStyle = accent;
        ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill();
      } else if (pc === (sa + 7) % 12) {
        ctx.strokeStyle = accent; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.fillStyle = hover ? fg : muted;
        ctx.beginPath(); ctx.arc(x, y, hover ? 5 : 3, 0, Math.PI * 2); ctx.fill();
      }
    }
  },
  pointer(e, f) {
    const cx = f.w / 2, cy = f.h / 2, R = Math.min(f.w, f.h) / 2 - 46;
    const d = Math.hypot(e.x - cx, e.y - cy);
    const near = d > R - 34 && d < R + 34;
    if (e.type === 'down' && near) {
      const a = Math.atan2(e.y - cy, e.x - cx) + Math.PI / 2;
      const pc = ((Math.round((a / (Math.PI * 2)) * 12) % 12) + 12) % 12;
      f.set('ksa', 48 + pc);
    }
    f.cursor(near ? 'pointer' : 'default');
  },
};
`;

/** The four strings, the one just plucked lit: a list beside the circle. */
export const STRING_ROWS = `// The four strings as rows (their names are text on the plugin). The row of
// the string just plucked lights up and fades as it rings; a pluck is a jump in
// the output level, and the strings take turns.
export default {
  setup(ctx, f) {
    Object.assign(f.state, { prev: 0, last: -10, string: 3 });
  },
  draw(ctx, f) {
    const s = f.state, w = f.w, h = f.h, row = h / 4;
    const gap = 60 / Math.max(20, f.value('kbpm')) * 0.55;
    if (f.level > s.prev * 1.12 + 0.002 && f.t - s.last > gap) {
      s.last = f.t;
      s.string = (s.string + 1) % 4;
    }
    s.prev = s.prev * 0.9 + f.level * 0.1;
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      const y = i * row;
      const lit = i === s.string ? Math.max(0, 1 - (f.t - s.last) / 2.2) : 0;
      ctx.fillStyle = f.color('track');
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.roundRect(0, y + 3, w, row - 6, 8); ctx.fill();
      if (lit > 0) {
        ctx.fillStyle = f.color('accent');
        ctx.globalAlpha = 0.16 * lit;
        ctx.beginPath(); ctx.roundRect(0, y + 3, w, row - 6, 8); ctx.fill();
        ctx.globalAlpha = lit;
        ctx.fillRect(0, y + 3, 3, row - 6);
      }
      ctx.globalAlpha = 1;
    }
  },
};
`;

/** The note names round the circle, C at the top. */
const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
/** The strings in the order they are plucked, and what each is. */
const STRINGS = [
  ['Pa', 'the fifth, below'],
  ['Sa', 'the tonic'],
  ['Sa', 'the tonic'],
  ['Sa', 'an octave below'],
] as const;

export function tonic(catalog: Catalog) {
  const circle = { x: 24, y: 76, w: 420, h: 420 };
  const R = circle.w / 2 - 46;
  const row = { skin: { name: 'bar', params: { radius: 2, label: 'top' } } };
  const inside = [
    'idx1',
    'when1',
    'lfo1',
    'gate1',
    'env1',
    'note1',
    'wob1',
    'note2',
    'mtof1',
    'osc1',
    'bodyhz1',
    'body1',
    'jbase1',
    'jawamt1',
    'jawhz1',
    'buzz1',
    'mix1',
    'vca1',
  ];
  return workInSteps(
    'tonic',
    'Tonic',
    catalog,
    [760, 520],
    [
      [
        // ---- one string: plucked once a cycle, at its own beat ----
        add('idx1', 'kit.copy', { label: 'Which string' }),
        add('when1', 'kit.mul', { label: 'Its beat', values: { b: 0.25 } }),
        add('lfo1', 'den.musicalLfo', {
          label: 'Cycle',
          config: { mode: 'tempo', waveform: 'square', beatsPerCycle: '4' },
        }),
        add('gate1', 'kit.compare', { label: 'Pluck', values: { b: 0 } }),
        add('env1', 'den.envelope', {
          label: 'Ring',
          values: { attack: 0.003, decay: 3.5, sustain: 0, release: 3 },
        }),
        add('note1', 'kit.add', { label: 'Interval' }),
        add('wob1', 'kit.scale', { label: 'A little off', values: { scale: 0.08, offset: -0.04 } }),
        add('note2', 'kit.add', { label: 'Note' }),
        add('mtof1', 'kit.mtof'),
        add('osc1', 'den.oscillator', { label: 'String', config: { waveform: 'saw' } }),
        add('bodyhz1', 'kit.mul', { label: 'Body tone', values: { b: 5 } }),
        add('body1', 'den.stateVariableFilter', { label: 'Body', values: { q: 0.7 } }),
        add('jbase1', 'kit.mul', { label: 'Buzz base', values: { b: 2 } }),
        add('jawamt1', 'kit.mul', { label: 'Buzz sweep' }),
        add('jawhz1', 'kit.cutoffMod', { label: 'Buzz' }),
        add('buzz1', 'den.stateVariableFilter', { label: 'Bridge', values: { q: 6 } }),
        add('mix1', 'kit.mix', {
          label: 'Body + buzz',
          config: { channels: 2 },
          values: { level1: 0.7, level2: 1.6 },
        }),
        add('vca1', 'kit.mul', { label: 'String out' }),
        wire('idx1.index', 'when1.a'),
        wire('when1.out', 'lfo1.phaseOffset'),
        wire('lfo1.value', 'gate1.a'),
        wire('gate1.out', 'env1.gate'),
        wire('note1.out', 'note2.a'),
        wire('idx1.random', 'wob1.in'),
        wire('wob1.out', 'note2.b'),
        wire('note2.out', 'mtof1.note'),
        wire('mtof1.out', 'osc1.frequency'),
        wire('mtof1.out', 'bodyhz1.a'),
        wire('bodyhz1.out', 'body1.cutoffHz'),
        wire('osc1.out', 'body1.input'),
        wire('mtof1.out', 'jbase1.a'),
        wire('jbase1.out', 'jawhz1.hz'),
        wire('env1.level', 'jawamt1.a'),
        wire('jawamt1.out', 'jawhz1.octaves'),
        wire('jawhz1.out', 'buzz1.cutoffHz'),
        wire('osc1.out', 'buzz1.input'),
        wire('body1.lowpass', 'mix1.in1'),
        wire('buzz1.bandpass', 'mix1.in2'),
        wire('mix1.out', 'vca1.a'),
        wire('env1.level', 'vca1.b'),
        // ---- the drone: the tonic, the pace and the buzz come in; four strings across, a hall ----
        ...patchControl('ksa', 'Sa', 'note1.a', [45, 60, 'linear', 'note'], 48),
        add('splay1', 'kit.splay', { label: 'Across', values: { width: 0.7 } }),
        add('hall1', 'den.algorithmicReverb', {
          label: 'Hall',
          config: { roomScale: 1, decaySeconds: 3.4, dampingHz: 5500 },
          values: { mix: 0.3 },
        }),
        add('gl1', 'kit.gain', { label: 'Level L', values: { gain: 0.2 } }),
        add('gr1', 'kit.gain', { label: 'Level R', values: { gain: 0.2 } }),
        add('out1', 'kit.out'),
        wire('vca1.out', 'splay1.in'),
        wire('splay1.left', 'hall1.left'),
        wire('splay1.right', 'hall1.right'),
        wire('hall1.left', 'gl1.in'),
        wire('hall1.right', 'gr1.in'),
        wire('gl1.out', 'out1.left'),
        wire('gr1.out', 'out1.right'),
        ...control('kbpm', 'ui.slider', 'Plucks a minute', 'lfo1.rate', r(476, 312, 260, 36), {
          min: 30,
          max: 90,
          value: 54,
          style: row,
        }),
        ...control('kjaw', 'ui.slider', 'Jawari', 'jawamt1.b', r(476, 360, 260, 36), {
          min: 0,
          max: 6,
          unit: 'oct',
          value: 4,
          style: row,
        }),
        ...control('kspace', 'ui.slider', 'Hall', 'hall1.mix', r(476, 408, 260, 36), {
          min: 0,
          max: 1,
          value: 0.3,
          style: row,
        }),
        { op: 'makePart', ids: inside, name: 'String', id: 'string', node: 'string1' },
      ],
      // Its one knob: which string this copy is, in semitones from the tonic.
      doc =>
        onlyParams(doc, 'string', [
          {
            node: 'note1',
            port: 'b',
            id: 'interval',
            label: 'Interval',
            range: { min: -12, max: 12, unit: 'st' },
          },
        ]),
      [
        {
          op: 'updatePart',
          part: 'string',
          doc: 'One tanpura string: plucked once a cycle at its own beat (copy k of 4 on beat k), ringing through a warm body and a buzz that slides down as it dies. Interval is its note above the tonic.',
        },
        { op: 'setCount', node: 'string1', count: 4 },
        {
          op: 'setSpread',
          node: 'string1',
          port: 'interval',
          spread: { kind: 'each', values: [-5, 0, 0, -12] },
        },
        // ---- the plugin: the tonic is the centre ----
        {
          op: 'setLook',
          look: {
            tokens: {
              bg: '#14142a',
              fg: '#f1ede4',
              accent: '#e8b65a',
              track: '#2c2c48',
              knob: '#1d1d38',
              pointer: '#f1ede4',
              muted: '#b1afc9',
              glow: '#e8b65a',
              font: 'lato',
              labelFont: 'lato',
              valueFont: 'jetbrains-mono',
            },
            background: [
              { kind: 'color', color: '#14142a' },
              {
                kind: 'radial',
                x: 0.3,
                y: 0.55,
                stops: [
                  { color: '#232347', at: 0 },
                  { color: '#14142a00', at: 0.6 },
                ],
              },
            ],
            skins: { slider: { name: 'bar', params: { radius: 2, label: 'top' } } },
            css: [
              'dk-slider { position: relative; }',
              'dk-slider::part(label) { text-align: left; font-size: 10px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: var(--dk-muted); }',
              'dk-slider::part(value) { position: absolute; top: 0; right: 0; font-size: 12px; color: var(--dk-fg); }',
              'dk-slider::part(track) { max-height: 4px; margin-top: 8px; }',
            ].join('\n'),
          },
        },
        el({
          kind: 'text',
          name: 'Title',
          text: 'Tonic',
          rect: r(24, 18, 200, 30),
          textStyle: {
            font: 'playfair-display',
            size: 28,
            weight: 700,
            color: 'fg',
            align: 'left',
          },
        }),
        el({
          kind: 'text',
          name: 'Subtitle',
          text: 'A tanpura drone to sing over. Touch a note to make it Sa.',
          rect: r(24, 52, 420, 16),
          textStyle: { size: 12, color: 'muted', align: 'left' },
        }),
        el({
          kind: 'canvas',
          name: 'The twelve notes',
          code: TONIC_CIRCLE,
          rect: r(circle.x, circle.y, circle.w, circle.h),
        }),
        ...NAMES.map((name, pc) => {
          const a = (pc / 12) * Math.PI * 2 - Math.PI / 2;
          const x = circle.x + circle.w / 2 + Math.cos(a) * (R + 26),
            y = circle.y + circle.h / 2 + Math.sin(a) * (R + 26);
          return el({
            kind: 'text',
            name: `${name} name`,
            text: name,
            rect: r(Math.round(x - 18), Math.round(y - 9), 36, 18),
            textStyle: { size: 14, weight: 700, color: 'muted', align: 'center' },
          });
        }),
        el({
          kind: 'text',
          name: 'Sa',
          text: 'Sa',
          rect: r(circle.x + circle.w / 2 - 60, circle.y + circle.h / 2 - 30, 120, 44),
          textStyle: { font: 'playfair-display', size: 38, color: 'fg', align: 'center' },
        }),
        el({
          kind: 'text',
          name: 'Sa caption',
          text: 'the note you sing from',
          rect: r(circle.x + circle.w / 2 - 80, circle.y + circle.h / 2 + 14, 160, 16),
          textStyle: { size: 11, color: 'muted', align: 'center' },
        }),
        el({
          kind: 'text',
          name: 'Strings caption',
          text: 'Strings, in the order they are plucked',
          rect: r(476, 84, 260, 14),
          textStyle: {
            size: 10,
            weight: 700,
            color: 'muted',
            align: 'left',
            spacing: 0.12,
            case: 'upper',
          },
        }),
        el({
          kind: 'canvas',
          name: 'The four strings',
          code: STRING_ROWS,
          rect: r(476, 104, 260, 184),
        }),
        ...STRINGS.flatMap(([name, what], i) => [
          el({
            kind: 'text',
            name: `String ${i + 1}`,
            text: name,
            rect: r(492, 104 + i * 46 + 12, 60, 22),
            textStyle: { font: 'playfair-display', size: 20, color: 'fg', align: 'left' },
          }),
          el({
            kind: 'text',
            name: `String ${i + 1} note`,
            text: what,
            rect: r(560, 104 + i * 46 + 16, 160, 16),
            textStyle: { size: 12, color: 'muted', align: 'right' },
          }),
        ]),
      ],
    ],
  );
}
