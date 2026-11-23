// Tide Bells — a sound installation for a shore: six bells stand at different
// heights, and the waves ring the ones the water reaches.
// Nothing is played: a slow swell rises and falls by itself. A codebox (Tide
// table) turns the hour (khour, 0 to 24) into the height of the tide; the sea
// comes in from nothing when the sound starts. The water is the tide plus the
// swell. One bell is a part (Bell), struck each time the water rises past its
// height (an FM pair, bright as it is struck, mellowing as it rings). The part
// runs ×6 and two `each` spreads give each copy its height and its note, higher
// up the shore and higher in pitch, so low tide rings the low bells and high
// tide the high ones; bells under water stay quiet. The sea is noise that swells
// with the same wave, louder and brighter at high tide.
// The design follows the thinking of Tide Guide (Apple Design Awards 2026,
// Visuals and Graphics): one chart that fills the screen and reads at a glance,
// large plain figures for now, and colours that follow the sky at the hour.
// Here the chart is the day's tide; drag along it to set the hour.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, onlyParams, patchControl, r, wire, workInSteps } from './build.ts';

/** The tide at an hour of the day, in metres. The chart canvas uses the same formula. */
export const TIDE_TABLE = `import { defineSubgraph, type Node } from '@unworklet/core';

// The tide at an hour of the day (0 to 24): two highs and two lows a day, one
// high a little lower than the other. Out: the height in metres (0.3 to 2.1).
export default defineSubgraph(() => ({
  tick(i: { hour: Node<'f32'> }) {
    const twice = i.hour.sub(3.2).mul((2 * Math.PI) / 12.42).cos();
    const once = i.hour.sub(5).mul((2 * Math.PI) / 24.84).cos();
    return { height: twice.mul(0.82).add(once.mul(0.1)).add(1.2) };
  },
}));
`;

/** The bells, low to high: their heights on the shore (metres) and their notes. */
const BELLS = [
  { height: 0.6, note: 69 },
  { height: 0.9, note: 71 },
  { height: 1.2, note: 74 },
  { height: 1.5, note: 76 },
  { height: 1.8, note: 78 },
  { height: 2.1, note: 81 },
];
/** How far a wave reaches above and below the tide, in metres. */
const REACH = 0.45;

/** The day's tide as a chart in the colours of the sky at the hour; it takes the mouse. */
export const TIDE_CHART = `// The day's tide as a chart, the sky behind it in the colours of the hour.
// The hour is khour (0 to 24); the tide comes from the same table as the
// codebox's, so the curve and the dot are what the sound plays. The bells
// (props.heights in metres and props.notes, low to high, as lists) stand on the
// now line at their heights; the waves reach props.reach metres above and below
// the tide.
// A bell lights when its note jumps in the spectrum (a strike is heard). The
// water at the now line rises and falls with the waves, read from how loud the
// sea is (the low end of the spectrum, below the bells). Figures are drawn in
// the system font, like the plugin's text. Drag along the chart to set the hour.
const TAU = Math.PI * 2;
const tide = h => 1.2 + 0.82 * Math.cos((h - 3.2) * TAU / 12.42) + 0.1 * Math.cos((h - 5) * TAU / 24.84);
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
// The sky by the hour: [hour, top, horizon].
const SKY = [
  [0, '#0b1424', '#1b2b47'],
  [4.8, '#111c37', '#3b3f68'],
  [6.3, '#4a6ca4', '#f2b78d'],
  [8.5, '#6aa6dc', '#d3e8f6'],
  [12.5, '#4b97d6', '#cde5f5'],
  [16.5, '#6799cf', '#f0d7b0'],
  [18.7, '#394883', '#ee8b5f'],
  [20.2, '#17203d', '#4a3b65'],
  [24, '#0b1424', '#1b2b47'],
];
const rgb = c => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const css = c => 'rgb(' + c.join(',') + ')';
const light = c => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
function skyAt(h) {
  for (let i = 0; i < SKY.length - 1; i++) {
    const [h0, t0, b0] = SKY[i], [h1, t1, b1] = SKY[i + 1];
    if (h >= h0 && h <= h1) {
      const t = (h - h0) / (h1 - h0);
      return [mix(rgb(t0), rgb(t1), t), mix(rgb(b0), rgb(b1), t)];
    }
  }
  return [rgb(SKY[0][1]), rgb(SKY[0][2])];
}
// How much daylight there is (0 night, 1 day).
const daylight = h => Math.max(0, Math.min(1, Math.min((h - 5.2) / 2.2, (20 - h) / 2.2)));
const two = n => String(n).padStart(2, '0');
const clock = h => { const m = Math.round((((h % 24) + 24) % 24) * 60) % 1440; return two(Math.floor(m / 60)) + ':' + two(m % 60); };
// The highs and lows between two hours (where the slope turns).
function turns(from, to) {
  const out = [];
  let prev = tide(from) - tide(from - 0.02);
  for (let h = from + 0.02; h <= to; h += 0.02) {
    const d = tide(h) - tide(h - 0.02);
    if (d > 0 !== prev > 0) out.push({ h: h - 0.01, high: prev > 0, m: tide(h - 0.01) });
    prev = d;
  }
  return out;
}
const list = v => String(v ?? '').split(/[ ,]+/).filter(Boolean).map(Number);
const bellsOf = props => { const notes = list(props.notes); return list(props.heights).map((height, k) => ({ height, note: notes[k] ?? 69 })); };
const band = note => (64 * Math.log((440 * Math.pow(2, (note - 69) / 12)) / 96)) / Math.log(250);
function at(spectrum, b) {
  const i = Math.max(0, Math.min(62, Math.floor(b))), t = b - i;
  return spectrum[i] * (1 - t) + spectrum[i + 1] * t;
}
export default {
  setup(ctx, f) {
    const n = bellsOf(f.props).length;
    Object.assign(f.state, { drag: false, hi: 0, lo: 1, sw: 0, avg: new Array(n).fill(0), last: new Array(n).fill(-10), rings: [], day: turns(0, 24) });
  },
  draw(ctx, f) {
    const s = f.state, w = f.w, h = f.h, bells = bellsOf(f.props), reach = f.props.reach || 0.45;
    const hour = Math.max(0, Math.min(24, f.value('khour')));
    const [top, low] = skyAt(hour);
    const ink = light(top) > 0.5 ? '#0f1b2b' : '#f4f7fb';
    const ink2 = light(low) > 0.55 ? '#0f1b2b' : '#f4f7fb';
    const water = mix([22, 56, 96], [44, 128, 196], daylight(hour));
    const L = 20, R = w - 20, TOP = 128, BOT = h - 36;
    const X = hr => L + (hr / 24) * (R - L);
    const Y = m => BOT - (m / 2.7) * (BOT - TOP);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath(); ctx.roundRect(0, 0, w, h, 18); ctx.clip();
    // The sky.
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, css(top)); g.addColorStop(1, css(low));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // Night on the chart, before sunrise and after sunset: a shade that fades in an hour.
    const night = ctx.createLinearGradient(X(0), 0, X(24), 0);
    const shade = 'rgba(6, 12, 30, 0.14)', clear = 'rgba(6, 12, 30, 0)';
    night.addColorStop(0, shade); night.addColorStop(5.8 / 24, shade); night.addColorStop(6.8 / 24, clear);
    night.addColorStop(18.2 / 24, clear); night.addColorStop(19.2 / 24, shade); night.addColorStop(1, shade);
    ctx.fillStyle = night; ctx.fillRect(0, 0, w, h);
    // The bells' heights, across the day (their notes at the right).
    ctx.strokeStyle = ink2; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
    for (const b of bells) {
      ctx.globalAlpha = 0.28;
      ctx.beginPath(); ctx.moveTo(L, Math.round(Y(b.height)) + 0.5); ctx.lineTo(R, Math.round(Y(b.height)) + 0.5); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    // The tide over the day, the water under it.
    ctx.beginPath();
    for (let hr = 0; hr <= 24.001; hr += 0.1) ctx.lineTo(X(hr), Y(tide(hr)));
    ctx.lineTo(X(24), h); ctx.lineTo(X(0), h); ctx.closePath();
    ctx.fillStyle = css(water); ctx.globalAlpha = 0.5; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath();
    for (let hr = 0; hr <= 24.001; hr += 0.1) ctx.lineTo(X(hr), Y(tide(hr)));
    ctx.strokeStyle = ink2; ctx.lineWidth = 2; ctx.globalAlpha = 0.9; ctx.stroke(); ctx.globalAlpha = 1;
    const now = tide(hour), x = X(hour);
    // Highs and lows, with their times (not where the now line would cross them).
    ctx.font = '600 11px ' + FONT;
    ctx.textAlign = 'center';
    ctx.fillStyle = ink2;
    for (const q of s.day) {
      const qx = X(q.h), qy = Y(q.m);
      ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.arc(qx, qy, 2.5, 0, TAU); ctx.fill();
      if (Math.abs(qx - x) > 44) ctx.fillText(clock(q.h) + '  ' + q.m.toFixed(1) + ' m', qx, q.high ? qy - 10 : qy + 18);
    }
    // The hours along the bottom.
    ctx.font = '500 10px ' + FONT;
    for (const hr of [0, 6, 12, 18, 24]) {
      ctx.globalAlpha = 0.75;
      ctx.textAlign = hr === 0 ? 'left' : hr === 24 ? 'right' : 'center';
      ctx.fillText(two(hr) + ':00', X(hr), h - 14);
    }
    ctx.globalAlpha = 1;
    // The waves, read from how loud the sea is (below the bells' notes).
    let v = 0;
    for (let i = 1; i <= 6; i++) v += f.spectrum[i] / 6;
    s.hi = v > s.hi ? v : s.hi - (s.hi - v) * f.dt * 0.08;
    s.lo = v < s.lo ? v : s.lo + (v - s.lo) * f.dt * 0.08;
    const sw = s.hi - s.lo > 0.03 ? ((v - s.lo) / (s.hi - s.lo)) * 2 - 1 : 0;
    s.sw += (sw - s.sw) * Math.min(1, f.dt * 4);
    const live = now + reach * s.sw;
    // The now line, and the reach of the waves on it.
    ctx.strokeStyle = ink2; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, TOP - 16); ctx.lineTo(Math.round(x) + 0.5, BOT); ctx.stroke();
    ctx.fillStyle = ink2; ctx.globalAlpha = 0.14;
    ctx.beginPath(); ctx.roundRect(x - 7, Y(now + reach), 14, Y(now - reach) - Y(now + reach), 7); ctx.fill();
    ctx.globalAlpha = 1;
    // A strike: the bell's note jumps in the spectrum (the loudest of its neighbours).
    const jumps = bells.map((b, k) => { const val = at(f.spectrum, band(b.note)); const j = val - s.avg[k]; s.avg[k] += (val - s.avg[k]) * Math.min(1, f.dt * 2); return j; });
    bells.forEach((b, k) => {
      const j = jumps[k];
      if (j > 0.09 && j >= (jumps[k - 1] ?? 0) && j >= (jumps[k + 1] ?? 0) && f.t - s.last[k] > 0.5) {
        s.last[k] = f.t;
        s.rings.push({ k, born: f.t });
      }
    });
    s.rings = s.rings.filter(q => f.t - q.born < 1.6);
    for (const q of s.rings) {
      const age = (f.t - q.born) / 1.6, y = Y(bells[q.k].height);
      ctx.strokeStyle = ink2; ctx.globalAlpha = (1 - age) * 0.75; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 7 + age * 26, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // The bells the waves can reach, on the now line; lit as they ring.
    bells.forEach((b, k) => {
      if (Math.abs(b.height - now) > reach) return;
      const y = Y(b.height), lit = Math.max(0, 1 - (f.t - s.last[k]) / 1.2);
      ctx.fillStyle = lit > 0 ? ink2 : css(water);
      ctx.strokeStyle = ink2; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 4.5 + lit * 2.5, 0, TAU); ctx.fill(); ctx.stroke();
    });
    // The water now: the surface, riding the waves.
    ctx.strokeStyle = ink2; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let dx = -22; dx <= 22; dx += 2) ctx.lineTo(x + dx, Y(live) + Math.sin(dx * 0.28 - f.t * 4) * 2);
    ctx.stroke();
    // Now, in large plain figures; the next high and low beside it.
    const rising = tide(hour + 0.02) > now;
    const reached = bells.filter(b => Math.abs(b.height - now) <= reach).length;
    ctx.textAlign = 'left';
    ctx.fillStyle = ink;
    ctx.font = '600 46px ' + FONT;
    ctx.fillText(clock(hour), 22, 60);
    ctx.font = '500 15px ' + FONT;
    ctx.globalAlpha = 0.92;
    ctx.fillText((rising ? 'Rising' : 'Falling') + ',  ' + now.toFixed(2) + ' m', 24, 86);
    ctx.font = '500 12px ' + FONT;
    ctx.globalAlpha = 0.82;
    ctx.fillText(reached + ' of ' + bells.length + ' bells in reach of the waves', 24, 106);
    ctx.globalAlpha = 1;
    const ahead = turns(hour, hour + 24);
    const nextHigh = ahead.find(q => q.high), nextLow = ahead.find(q => !q.high);
    ctx.textAlign = 'right';
    ctx.font = '600 13px ' + FONT;
    if (nextHigh) ctx.fillText('High  ' + clock(nextHigh.h) + '   ' + nextHigh.m.toFixed(2) + ' m', w - 22, 38);
    if (nextLow) ctx.fillText('Low  ' + clock(nextLow.h) + '   ' + nextLow.m.toFixed(2) + ' m', w - 22, 58);
    ctx.restore();
  },
  pointer(e, f) {
    const L = 20, R = f.w - 20, inside = e.y > 96;
    if (e.type === 'down' && inside) f.state.drag = true;
    if (e.type === 'up' || e.type === 'leave') f.state.drag = false;
    if (f.state.drag && (e.type === 'down' || e.type === 'move')) {
      const hr = Math.max(0, Math.min(24, ((e.x - L) / (R - L)) * 24));
      f.set('khour', Math.round(hr * 12) / 12);
    }
    if (e.type === 'wheel') f.set('khour', Math.max(0, Math.min(24, f.value('khour') + Math.sign(e.dy) * 0.25)));
    f.cursor(f.state.drag ? 'grabbing' : inside ? 'ew-resize' : 'default');
  },
};
`;

export function tide(catalog: Catalog) {
  const row = { skin: { name: 'bar', params: { radius: 2, label: 'top' } } };
  const inside = ['wet1', 'env1', 'mtof1', 'modhz1', 'devamt1', 'dev1', 'fm1', 'sq1', 'vca1'];
  return workInSteps(
    'tide',
    'Tide Bells',
    catalog,
    [760, 548],
    [
      [
        // ---- the hour, the tide, the waves ----
        add('table1', 'kit.codebox', {
          label: 'Tide table',
          code: TIDE_TABLE,
          ports: {
            inputs: [{ id: 'hour', type: 'signal' }],
            outputs: [{ id: 'height', type: 'signal' }],
          },
        }),
        ...patchControl('khour', 'Hour', 'table1.hour', [0, 24, 'linear', ''], 14.5),
        // The sea comes in from nothing when the sound starts (the bells ring in turn as it passes them).
        add('always1', 'kit.compare', { label: 'Always', values: { b: -1 } }),
        add('comein1', 'den.envelope', {
          label: 'Coming in',
          values: { attack: 8, decay: 0.1, sustain: 1, release: 1 },
        }),
        add('tide1', 'kit.mul', { label: 'Tide' }),
        wire('always1.out', 'comein1.gate'),
        wire('table1.height', 'tide1.a'),
        wire('comein1.level', 'tide1.b'),
        add('rate1', 'kit.mul', { label: 'Waves (Hz)', values: { b: 1 / 60 } }),
        // One wave for the whole shore: the bells and the sea.
        add('swell1', 'den.lfo', { label: 'Swell' }),
        add('reach1', 'kit.mul', { label: 'Reach', values: { b: REACH } }),
        add('water1', 'kit.add', { label: 'Water' }),
        wire('rate1.out', 'swell1.rate'),
        wire('swell1.out', 'reach1.a'),
        wire('tide1.out', 'water1.a'),
        wire('reach1.out', 'water1.b'),
        // ---- one bell: struck each time the water rises past its height ----
        add('wet1', 'kit.compare', { label: 'Reached' }),
        add('env1', 'den.envelope', {
          label: 'Ring',
          values: { attack: 0.002, decay: 6, sustain: 0, release: 6 },
        }),
        add('mtof1', 'kit.mtof'),
        add('modhz1', 'kit.mul', { label: 'Bell ratio', values: { b: 1.4 } }),
        add('devamt1', 'kit.mul', { label: 'Brightness' }),
        add('dev1', 'kit.mul', { label: 'Strike', values: { b: 2.4 } }),
        add('fm1', 'den.frequencyModulation', { label: 'Bell' }),
        add('sq1', 'kit.mul', { label: 'Fade' }),
        add('vca1', 'kit.mul', { label: 'Bell out' }),
        wire('water1.out', 'wet1.a'),
        wire('wet1.out', 'env1.gate'),
        wire('mtof1.out', 'fm1.carrierHz'),
        wire('mtof1.out', 'modhz1.a'),
        wire('modhz1.out', 'fm1.modulatorHz'),
        wire('mtof1.out', 'devamt1.a'),
        wire('env1.level', 'devamt1.b'),
        wire('devamt1.out', 'dev1.a'),
        wire('dev1.out', 'fm1.deviationHz'),
        wire('env1.level', 'sq1.a'),
        wire('env1.level', 'sq1.b'),
        wire('fm1.out', 'vca1.a'),
        wire('sq1.out', 'vca1.b'),
        // ---- the sea: noise that swells with the wave, louder and brighter at high tide ----
        add('sea01', 'kit.scale', { label: 'Swell 0..1', values: { scale: 0.5, offset: 0.5 } }),
        add('crest1', 'kit.mul', { label: 'Crest' }),
        add('wash1', 'kit.scale', { label: 'Wash', values: { scale: 0.85, offset: 0.15 } }),
        add('near1', 'kit.scale', {
          label: 'Nearer at high tide',
          values: { scale: 0.6, offset: 1.2 },
        }),
        add('seaamp1', 'kit.mul', { label: 'Sea level' }),
        add('bright1', 'kit.mul', { label: 'Brighter at the crest', values: { b: 2.4 } }),
        add('seahz1', 'kit.cutoffMod', { label: 'Sea tone', values: { hz: 380 } }),
        add('noisel1', 'den.seededNoise', { label: 'Sea L', config: { seed: 21 } }),
        add('noiser1', 'den.seededNoise', { label: 'Sea R', config: { seed: 77 } }),
        add('seal1', 'den.filter', { label: 'Sea tone L', values: { resonance: 0.5 } }),
        add('sear1', 'den.filter', { label: 'Sea tone R', values: { resonance: 0.5 } }),
        add('seavl1', 'kit.mul', { label: 'Sea L out' }),
        add('seavr1', 'kit.mul', { label: 'Sea R out' }),
        add('sealvl1', 'kit.gain', { label: 'Sea', values: { gain: 0.6 } }),
        add('sealvr1', 'kit.gain', { label: 'Sea R level', values: { gain: 0.6 } }),
        wire('swell1.out', 'sea01.in'),
        wire('sea01.out', 'crest1.a'),
        wire('sea01.out', 'crest1.b'),
        wire('crest1.out', 'wash1.in'),
        wire('table1.height', 'near1.in'),
        wire('wash1.out', 'seaamp1.a'),
        wire('near1.out', 'seaamp1.b'),
        wire('crest1.out', 'bright1.a'),
        wire('bright1.out', 'seahz1.octaves'),
        wire('noisel1.out', 'seal1.input'),
        wire('noiser1.out', 'sear1.input'),
        wire('seahz1.out', 'seal1.cutoff'),
        wire('seahz1.out', 'sear1.cutoff'),
        wire('seal1.out', 'seavl1.a'),
        wire('seaamp1.out', 'seavl1.b'),
        wire('sear1.out', 'seavr1.a'),
        wire('seaamp1.out', 'seavr1.b'),
        wire('seavl1.out', 'sealvl1.in'),
        wire('seavr1.out', 'sealvr1.in'),
        // ---- the shore: bells across, the sea under them, a wide bay ----
        add('belllvl1', 'kit.gain', { label: 'Bells', values: { gain: 0.5 } }),
        add('splay1', 'kit.splay', { label: 'Across the shore', values: { width: 0.8 } }),
        add('suml1', 'kit.add', { label: 'Left' }),
        add('sumr1', 'kit.add', { label: 'Right' }),
        add('bay1', 'den.algorithmicReverb', {
          label: 'Bay',
          config: { roomScale: 1, decaySeconds: 6, dampingHz: 5000 },
          values: { mix: 0.35 },
        }),
        add('gl1', 'kit.gain', { label: 'Level L', values: { gain: 0.45 } }),
        add('gr1', 'kit.gain', { label: 'Level R', values: { gain: 0.45 } }),
        add('out1', 'kit.out'),
        wire('vca1.out', 'belllvl1.in'),
        wire('belllvl1.out', 'splay1.in'),
        wire('splay1.left', 'suml1.a'),
        wire('sealvl1.out', 'suml1.b'),
        wire('splay1.right', 'sumr1.a'),
        wire('sealvr1.out', 'sumr1.b'),
        wire('suml1.out', 'bay1.left'),
        wire('sumr1.out', 'bay1.right'),
        wire('bay1.left', 'gl1.in'),
        wire('bay1.right', 'gr1.in'),
        wire('gl1.out', 'out1.left'),
        wire('gr1.out', 'out1.right'),
        // The bell becomes a part (the water comes in; the ring goes out).
        { op: 'makePart', ids: inside, name: 'Bell', id: 'bell', node: 'bell1' },
      ],
      // Its knobs: where the bell stands, and its note.
      doc =>
        onlyParams(doc, 'bell', [
          {
            node: 'wet1',
            port: 'b',
            id: 'height',
            label: 'Height',
            range: { min: 0, max: 2.6 },
          },
          {
            node: 'mtof1',
            port: 'note',
            id: 'note',
            label: 'Note',
            range: { min: 48, max: 96, unit: 'note' },
          },
        ]),
      doc => {
        const bell = doc.parts.bell!;
        return [
          {
            op: 'updatePart',
            part: 'bell',
            doc: 'One bell on the shore, struck each time the water rises past its height. Height is where it stands (metres), Note is its pitch.',
            labels: { [bell.inputs[0]!.id]: 'Water', [bell.outputs[0]!.id]: 'Ring' },
          },
        ];
      },
      [
        { op: 'setCount', node: 'bell1', count: BELLS.length },
        {
          op: 'setSpread',
          node: 'bell1',
          port: 'height',
          spread: { kind: 'each', values: BELLS.map(b => b.height) },
        },
        {
          op: 'setSpread',
          node: 'bell1',
          port: 'note',
          spread: { kind: 'each', values: BELLS.map(b => b.note) },
        },
        // ---- the plugin: the day's tide, in the colours of the hour ----
        {
          op: 'setLook',
          look: {
            tokens: {
              bg: '#f3f5f7',
              fg: '#0f1b2b',
              accent: '#1f6fd1',
              track: '#dce3ea',
              knob: '#ffffff',
              pointer: '#0f1b2b',
              muted: '#4b5868',
              glow: '#1f6fd1',
              font: 'system',
              labelFont: 'system',
              valueFont: 'system',
            },
            background: [{ kind: 'color', color: '#f3f5f7' }],
            skins: { slider: { name: 'bar', params: { radius: 2, label: 'top' } } },
            css: [
              '/* A lit lamp is a plain dot: no halo. */',
              ':scope { --led-glow: 0px; }',
              'dk-slider { position: relative; }',
              'dk-slider::part(label) { text-align: left; font-size: 11px; font-weight: 600; color: var(--dk-muted); }',
              'dk-slider::part(value) { position: absolute; top: 0; right: 0; font-size: 12px; font-weight: 600; color: var(--dk-fg); font-variant-numeric: tabular-nums; }',
              'dk-slider::part(track) { max-height: 4px; margin-top: 8px; }',
            ].join('\n'),
          },
        },
        el({
          kind: 'text',
          name: 'Title',
          text: 'Tide Bells',
          rect: r(24, 18, 300, 30),
          textStyle: { size: 26, weight: 700, color: 'fg', align: 'left' },
        }),
        el({
          kind: 'text',
          name: 'Subtitle',
          text: 'Six bells on a shore. The waves ring the ones the water reaches.',
          rect: r(24, 50, 480, 16),
          textStyle: { size: 12, color: 'muted', align: 'left' },
        }),
        el({
          kind: 'text',
          name: 'Plays itself',
          text: 'Plays by itself',
          rect: r(540, 26, 178, 14),
          textStyle: { size: 11, weight: 600, color: 'accent', align: 'right' },
        }),
        el({
          kind: 'led',
          name: 'Sounding',
          bind: '@level',
          color: 'accent',
          threshold: 0.004,
          rect: r(726, 28, 10, 10),
        }),
        el({
          kind: 'canvas',
          name: 'The day’s tide',
          code: TIDE_CHART,
          rect: r(24, 80, 712, 340),
          props: {
            heights: BELLS.map(b => b.height).join(' '),
            notes: BELLS.map(b => b.note).join(' '),
            reach: REACH,
          },
        }),
        ...control('kwaves', 'ui.slider', 'Waves a minute', 'rate1.a', r(24, 446, 158, 38), {
          min: 3,
          max: 12,
          value: 6.5,
          style: row,
        }),
        ...control(
          'ksea',
          'ui.slider',
          'Sea',
          ['sealvl1.gain', 'sealvr1.gain'],
          r(208, 446, 158, 38),
          {
            min: 0,
            max: 1,
            value: 0.6,
            style: row,
          },
        ),
        ...control('kbells', 'ui.slider', 'Bells', 'belllvl1.gain', r(392, 446, 158, 38), {
          min: 0,
          max: 1,
          value: 0.5,
          style: row,
        }),
        ...control('kbay', 'ui.slider', 'Bay', 'bay1.mix', r(576, 446, 158, 38), {
          min: 0,
          max: 1,
          value: 0.35,
          style: row,
        }),
        el({
          kind: 'text',
          name: 'How to',
          text: 'Drag along the chart to set the hour. Low tide rings the low bells, high tide the high ones; bells under water stay quiet.',
          rect: r(24, 502, 712, 16),
          textStyle: { size: 11, color: 'muted', align: 'left' },
        }),
      ],
    ],
  );
}
