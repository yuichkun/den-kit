// Tonic — a tanpura-style drone to sing or practise over.
// One string is a part (String): a slow square wave, offset by the copy's
// number, plucks it once per cycle; a saw rings through a warm lowpass and a
// narrow band that slides down from high overtones to the note as the pluck
// dies (the buzz of the bridge, "jawari"). The part runs ×4 and its Interval
// gives each copy its own string by an `each` spread: the lower fifth (Pa), two
// at the tonic (Sa) and one an octave below, plucked in turn. Splay spreads
// the four strings and a hall holds them.
// The design follows the thinking of NaadSadhana (Apple Design Awards 2021,
// Innovation), a practice companion for singers whose backing is made to match
// the singer: here the drone is tuned to the singer's tonic by touching it on
// the ring, Sa stands at the centre, and every other note is named by its
// distance from Sa. The plugin is the tanpura seen from the front: the gourd is
// the ring, its four strings shake in time with the plucks heard, the bridge
// lights with what is heard (it is the plugin's meter), and Jawari, the pace
// and the hall are set on the drawing itself (the thread on the bridge, the
// strings, the room round the gourd), each with a plate by the hand.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, onlyParams, patchControl, r, wire, workInSteps } from './build.ts';

/** The tanpura seen from the front: the gourd is the ring of notes, the four strings on it; it takes the mouse. */
export const TONIC_CIRCLE = `// The tanpura from the front. The gourd is a ring of the twelve notes (their
// letter names are text on the plugin, outside the ring); Sa sits on the tonic
// (ksa, a MIDI note) and every other note is named from it, Pa joined to it by a
// bow along the ring. On the gourd stand the four strings, plucked in turn (Pa
// below, Sa, Sa, Sa below; the low ones thicker): a pluck is heard as a jump in
// the output level, and the string shakes and dies away; between the bridge
// (the plugin's meter, laid over it) and the thread (Jawari, kjaw) it buzzes.
// Press a note to make it Sa; drag the thread up or down for Jawari, the strings
// up or down for the pace (kbpm, plucks a minute), the room round the gourd up
// or down for the hall (kspace), whose rings it draws; each pluck spreads a ring
// into the room, as far as the hall reaches. The part under the hand shows its
// setting on a plate by it.
const CX = 380, CY = 262, R = 172, DISC = R + 18, SW = R - 30, RD = R - 50;
const XS = [-100, -46, 46, 100]; // the strings, left to right, in the order they are plucked
const LOW = [true, false, false, true]; // Pa and the last Sa are an octave down
const BRIDGE = CY + 92, THREAD = 60;
const SWARA = ['Sa', 're', 'Re', 'ga', 'Ga', 'ma', "Ma'", 'Pa', 'dha', 'Dha', 'ni', 'Ni'];
const TAU = Math.PI * 2;
const at = (pc, r) => {
  const a = (pc / 12) * TAU - Math.PI / 2;
  return [CX + Math.cos(a) * r, CY + Math.sin(a) * r];
};
const threadY = jaw => BRIDGE - 10 - (Math.max(0, Math.min(6, jaw)) / 6) * THREAD;
// The parts you take hold of: the ring of notes, the thread (and the bridge under it), the strings, the room round the gourd.
function zone(x, y, jaw) {
  const d = Math.hypot(x - CX, y - CY);
  if (d >= R + 56) return 'hall';
  if (d > R - 20) return 'ring';
  if (Math.abs(x - CX) < 118 && y > threadY(jaw) - 16 && y < BRIDGE + 14) return 'jaw';
  if (Math.abs(x - CX) < 118 && d < RD) return 'pace';
  return null;
}
const CURSOR = { pace: 'ns-resize', hall: 'ns-resize', ring: 'pointer', jaw: 'ns-resize' };
// A plate centred on x (or starting at x, from the left), kept on the plugin.
function plate(ctx, text, x, y, w, h, ink, paper, fromLeft) {
  ctx.font = '700 13px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const m = ctx.measureText(text), tw = ((m && m.width) || text.length * 7.4) + 20;
  const x0 = Math.max(6, Math.min(w - tw - 6, fromLeft ? x : x - tw / 2));
  y = Math.max(19, Math.min(h - 19, y));
  ctx.fillStyle = ink; ctx.beginPath(); ctx.roundRect(Math.round(x0), Math.round(y - 13), Math.round(tw), 26, 13); ctx.fill();
  ctx.fillStyle = paper; ctx.fillText(text, Math.round(x0 + 10), Math.round(y) + 0.5);
}
export default {
  setup(ctx, f) {
    Object.assign(f.state, { prev: 0, last: -10, string: 3, amp: [0, 0, 0, 0], rings: [], drag: null });
  },
  draw(ctx, f) {
    const s = f.state, w = f.w, h = f.h;
    const ink = f.color('fg'), field = f.color('bg'), wine = f.color('accent'), ivory = '#fff1d6';
    const sa = ((Math.round(f.value('ksa')) % 12) + 12) % 12, pa = (sa + 7) % 12;
    const jaw = f.value('kjaw'), hall = f.value('kspace'), bpm = f.value('kbpm');
    ctx.clearRect(0, 0, w, h);
    // A pluck: the output jumps up; the next string in turn shakes.
    const gap = (60 / Math.max(20, bpm)) * 0.55;
    if (f.level > s.prev * 1.12 + 0.002 && f.t - s.last > gap) {
      s.last = f.t;
      s.string = (s.string + 1) % 4;
      s.amp[s.string] = 1;
      s.rings.push(f.t);
    }
    s.prev = s.prev * 0.9 + f.level * 0.1;
    for (let i = 0; i < 4; i++) s.amp[i] *= Math.exp(-f.dt / 1.4);
    s.rings = s.rings.filter(t0 => f.t - t0 < 3);
    // The room: as far as the hall reaches, rings go out with each pluck.
    const reach = 40 * hall;
    ctx.strokeStyle = wine;
    ctx.lineWidth = 1.5;
    const p = f.pointer, under = s.drag || (p && p.over ? zone(p.x, p.y, jaw) : null);
    // Its rings, thin and apart, fading outward: more of them the more the hall holds.
    ctx.lineWidth = under === 'hall' ? 2 : 1.25;
    for (let i = 1; i <= Math.round(hall * 6); i++) {
      ctx.globalAlpha = 0.75 * (1 - i / 8);
      ctx.beginPath(); ctx.arc(CX, CY, DISC + 46 + i * 9, 0, TAU); ctx.stroke();
    }
    for (const t0 of s.rings) {
      const age = (f.t - t0) / 3;
      ctx.globalAlpha = (1 - age) * (0.25 + 0.6 * hall);
      ctx.lineWidth = 2.5 * (1 - age) + 0.5;
      ctx.beginPath(); ctx.arc(CX, CY, DISC + 46 + age * reach, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // The gourd, and the ring of notes on it.
    ctx.fillStyle = wine;
    ctx.beginPath(); ctx.arc(CX, CY, DISC, 0, TAU); ctx.fill();
    ctx.strokeStyle = field;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(CX, CY, R, 0, TAU); ctx.stroke();
    // Sa to Pa, the drone's fifth: a bow along the ring, seven notes round.
    const a0 = (sa / 12) * TAU - Math.PI / 2;
    ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(CX, CY, R, a0, a0 + (7 / 12) * TAU); ctx.stroke();
    ctx.lineCap = 'butt';
    // Every note named from Sa.
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const hover = p && p.over && !s.drag && under === 'ring'
      ? ((Math.round(((Math.atan2(p.y - CY, p.x - CX) + Math.PI / 2) / TAU) * 12) % 12) + 12) % 12 : -1;
    for (let pc = 0; pc < 12; pc++) {
      const step = (pc - sa + 12) % 12;
      const [x, y] = at(pc, R);
      if (pc === sa) {
        ctx.fillStyle = field;
        ctx.beginPath(); ctx.arc(x, y, 19, 0, TAU); ctx.fill();
        ctx.fillStyle = wine;
        ctx.fillText('Sa', x, y + 1);
        continue;
      }
      if (pc === pa) {
        ctx.fillStyle = wine;
        ctx.beginPath(); ctx.arc(x, y, 16, 0, TAU); ctx.fill();
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = field;
        ctx.fillText('Pa', x, y + 1);
        continue;
      }
      ctx.fillStyle = field;
      ctx.beginPath(); ctx.arc(x, y, pc === hover ? 7 : 4, 0, TAU); ctx.fill();
      const [lx, ly] = at(pc, SW);
      ctx.globalAlpha = pc === hover ? 1 : 0.85;
      ctx.fillText(SWARA[step], lx, ly + 1);
      ctx.globalAlpha = 1;
    }
    // The four strings shaking, down to the bridge (the plugin's meter lies over it), and the thread.
    const ty = threadY(jaw);
    for (let i = 0; i < 4; i++) {
      const x0 = CX + XS[i], top = CY - Math.sqrt(RD * RD - XS[i] * XS[i]);
      const a = s.amp[i], lit = i === s.string ? Math.max(0, 1 - (f.t - s.last) / 1.2) : 0;
      ctx.strokeStyle = ivory;
      ctx.lineWidth = LOW[i] ? 3 : 2;
      ctx.globalAlpha = 0.7 + 0.3 * lit;
      ctx.beginPath();
      for (let y = top; y <= BRIDGE; y += 3) {
        const u = (y - top) / (BRIDGE - top);
        let dx = a * 7 * Math.sin(Math.PI * u) * Math.sin(f.t * 47 + i * 1.7);
        if (y > ty) dx += a * (0.4 + jaw * 0.45) * (((y / 3) | 0) % 2 ? 1 : -1);
        if (y === top) ctx.moveTo(x0 + dx, y);
        else ctx.lineTo(x0 + dx, y);
      }
      ctx.lineTo(x0, BRIDGE);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // The thread: drag it up for more buzz.
    const hot = under === 'jaw';
    ctx.strokeStyle = field;
    ctx.lineWidth = hot ? 3 : 2;
    ctx.beginPath(); ctx.moveTo(CX - 110, ty); ctx.lineTo(CX + 110, ty); ctx.stroke();
    ctx.fillStyle = field;
    for (const ex of [CX - 110, CX + 110]) { ctx.beginPath(); ctx.arc(ex, ty, hot ? 6 : 5, 0, TAU); ctx.fill(); }
    // The setting of the part under the hand, on a plate by it, clear of the text laid over the
    // canvas (the big Sa, the letter names) and of the bridge: the thread's at its end, the
    // strings' above the hand but above the big Sa, the hall's above the hand, a note's inward.
    if (under === 'jaw') plate(ctx, 'jawari ' + jaw.toFixed(1) + ' ↕', CX + 122, ty, w, h, ink, field, true);
    else if (under === 'pace' && p) plate(ctx, 'plucks ' + Math.round(bpm) + ' a minute ↕', p.x, Math.min(p.y - 30, 210), w, h, ink, field);
    else if (under === 'hall' && p) plate(ctx, 'hall ' + Math.round(hall * 100) + '% ↕', p.x, p.y - 30, w, h, ink, field);
    else if (hover >= 0 && hover !== sa) {
      const [hx, hy] = at(hover, R - 42);
      plate(ctx, 'make this Sa', hx, hy, w, h, ink, field);
    }
  },
  pointer(e, f) {
    const s = f.state, z = zone(e.x, e.y, f.value('kjaw'));
    if (e.type === 'down') {
      s.drag = z;
      s.y0 = e.y;
      s.v0 = z === 'pace' ? f.value('kbpm') : z === 'hall' ? f.value('kspace') : 0;
    }
    if (e.type === 'up' || e.type === 'leave') s.drag = null;
    if (e.type === 'wheel' && (z === 'pace' || z === 'hall' || z === 'jaw')) {
      const id = z === 'pace' ? 'kbpm' : z === 'hall' ? 'kspace' : 'kjaw', span = z === 'pace' ? 60 : z === 'hall' ? 1 : 6;
      const lo = z === 'pace' ? 30 : 0;
      f.set(id, Math.max(lo, Math.min(lo + span, f.value(id) - Math.sign(e.dy) * span * 0.01)));
    }
    if ((e.type === 'down' || e.type === 'move') && s.drag) {
      if (s.drag === 'ring') {
        const a = Math.atan2(e.y - CY, e.x - CX) + Math.PI / 2;
        f.set('ksa', 48 + (((Math.round((a / TAU) * 12) % 12) + 12) % 12));
      } else if (s.drag === 'jaw') {
        f.set('kjaw', Math.max(0, Math.min(6, ((BRIDGE - 10 - e.y) / THREAD) * 6)));
      } else if (s.drag === 'pace') {
        f.set('kbpm', Math.max(30, Math.min(90, s.v0 + (s.y0 - e.y) * 0.25)));
      } else if (s.drag === 'hall') {
        f.set('kspace', Math.max(0, Math.min(1, s.v0 + (s.y0 - e.y) / 200)));
      }
    }
    f.cursor(s.drag ? CURSOR[s.drag] : z ? CURSOR[z] : 'default');
  },
};
`;

/** The letter names round the ring, C at the top, outside the gourd. */
const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
/** Where the canvas draws the ring (its CX, CY), and how far out the names stand. */
const CENTRE = { x: 380, y: 262 };
const NAME_R = 212;

export function tonic(catalog: Catalog) {
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
        ...patchControl('kbpm', 'Plucks a minute', 'lfo1.rate', [30, 90, 'linear', ''], 54),
        ...patchControl('kjaw', 'Jawari', 'jawamt1.b', [0, 6, 'linear', 'oct'], 4),
        ...patchControl('kspace', 'Hall', 'hall1.mix', [0, 1, 'linear', ''], 0.3),
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
        // ---- the plugin: the tanpura from the front, Sa at the centre ----
        {
          op: 'setLook',
          look: {
            tokens: {
              bg: '#f2b01e',
              fg: '#1c0b05',
              accent: '#6e1023',
              track: '#c98a0c',
              knob: '#6e1023',
              pointer: '#1c0b05',
              muted: '#5c0f1c',
              glow: '#6e1023',
              font: 'kalam',
              labelFont: 'kalam',
              valueFont: 'kalam',
            },
            background: [{ kind: 'color', color: '#f2b01e' }],
          },
        },
        el({
          kind: 'canvas',
          name: 'The tanpura',
          code: TONIC_CIRCLE,
          rect: r(0, 0, 760, 520),
        }),
        // The bridge, over the canvas: how loud the drone is, lit along it (the canvas draws the strings down to it).
        ...control('mlevel', 'ui.meter', 'Bridge', null, r(264, 354, 232, 7), {
          style: {
            skin: { name: 'bar', params: { fill: '#fff1d6', surface: '#a8505f', scale: false } },
          },
        }),
        wire('gl1.out', 'mlevel.in'),
        el({
          kind: 'text',
          name: 'Title',
          text: 'Tonic',
          rect: r(22, 10, 150, 66),
          textStyle: { font: 'kalam', size: 54, weight: 700, color: 'fg', align: 'left' },
        }),
        ...NOTE_NAMES.map((name, pc) => {
          const a = (pc / 12) * Math.PI * 2 - Math.PI / 2;
          const x = CENTRE.x + Math.cos(a) * NAME_R,
            y = CENTRE.y + Math.sin(a) * NAME_R;
          return el({
            kind: 'text',
            name: `${name} name`,
            text: name,
            rect: r(Math.round(x - 18), Math.round(y - 11), 36, 22),
            textStyle: { font: 'system', size: 17, weight: 700, color: 'fg', align: 'center' },
          });
        }),
        el({
          kind: 'text',
          name: 'Sa',
          text: 'Sa',
          rect: r(CENTRE.x - 40, CENTRE.y - 36, 80, 68),
          textStyle: { font: 'kalam', size: 56, weight: 700, color: 'bg', align: 'center' },
        }),
      ],
    ],
  );
}
