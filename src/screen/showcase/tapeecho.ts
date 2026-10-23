// Evaluation prompt 5 — A 1970s tape echo, with a needle VU meter and spinning reels.
// The input is driven onto the "tape" (soft saturation), echoed by two
// playback heads (the right one 1.5× the left, like a multi-head machine)
// through a darkening feedback loop with wow, plus a little tape hiss. The VU
// needle shows the level going onto the tape; the reels turn at the tape speed
// (a shorter repeat is faster tape) and waver with the wow.
import type { Catalog } from '../../work/catalog.ts';
import { add, asset, control, el, r, wire, work } from './build.ts';

export const TAPE_REELS = `// Two tape reels that turn at the tape speed: a shorter repeat means faster
// tape, and the fuller reel turns slower. The wow knob makes the speed waver.
function reel(ctx, cx, cy, R, pack, angle) {
  ctx.save();
  ctx.translate(cx, cy);
  // the tape wound on the hub
  ctx.fillStyle = '#3b2616';
  ctx.beginPath(); ctx.arc(0, 0, R * pack, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#5a3b22'; ctx.lineWidth = 1;
  for (let k = 1; k < 5; k++) { ctx.beginPath(); ctx.arc(0, 0, R * (0.18 + (pack - 0.18) * k / 5), 0, Math.PI * 2); ctx.stroke(); }
  // the flange: a disc with three windows (even-odd leaves them open)
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  for (let k = 0; k < 3; k++) {
    const a = k * Math.PI * 2 / 3;
    ctx.moveTo(Math.cos(a - 0.6) * R * 0.3, Math.sin(a - 0.6) * R * 0.3);
    ctx.arc(0, 0, R * 0.86, a - 0.6, a + 0.6);
    ctx.arc(0, 0, R * 0.3, a + 0.6, a - 0.6, true);
    ctx.closePath();
  }
  ctx.rotate(-angle); // the light stays put while the reel turns
  const g = ctx.createLinearGradient(-R, -R, R, R);
  g.addColorStop(0, '#9aa0a8'); g.addColorStop(0.45, '#f2f3f5'); g.addColorStop(1, '#6f747b');
  ctx.fillStyle = g; ctx.globalAlpha = 0.92; ctx.fill('evenodd'); ctx.globalAlpha = 1;
  ctx.strokeStyle = '#00000080'; ctx.lineWidth = 1; ctx.stroke();
  // the hub with its three drive notches
  ctx.fillStyle = '#cfd2d6';
  ctx.beginPath(); ctx.arc(0, 0, R * 0.15, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(angle);
  ctx.fillStyle = '#2a2a2a';
  for (let k = 0; k < 3; k++) { ctx.rotate(Math.PI * 2 / 3); ctx.fillRect(-R * 0.025, R * 0.05, R * 0.05, R * 0.08); }
  ctx.restore();
}

export default function draw(ctx, f) {
  const s = f.state;
  const time = Math.max(0.04, f.value('ktime') || 0.3);
  const wow = f.norm('kwow');
  const speed = 1.1 / time; // tape speed, in reel radii per second
  const waver = 1 + 0.22 * wow * Math.sin(f.t * 3.4) + 0.06 * wow * Math.sin(f.t * 17);
  const R = Math.min(f.h * 0.4, f.w * 0.21);
  const cy = f.h * 0.44, x1 = f.w * 0.27, x2 = f.w * 0.73;
  const pack1 = 0.78, pack2 = 0.5;
  s.a1 = ((s.a1 || 0) + f.dt * speed * waver / pack1) % (Math.PI * 2);
  s.a2 = ((s.a2 || 0) + f.dt * speed * waver / pack2) % (Math.PI * 2);
  ctx.clearRect(0, 0, f.w, f.h);
  // the tape path past the guides and the heads
  const headY = f.h * 0.9;
  ctx.strokeStyle = '#4a3220'; ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x1 - R * pack1, cy); ctx.lineTo(x1 - R * pack1, headY - 6);
  ctx.lineTo(f.w * 0.36, headY); ctx.lineTo(f.w * 0.64, headY);
  ctx.lineTo(x2 + R * pack2, headY - 6); ctx.lineTo(x2 + R * pack2, cy);
  ctx.stroke();
  // the heads: erase, record, three playback
  for (let k = 0; k < 5; k++) {
    const hx = f.w * (0.38 + k * 0.06);
    ctx.fillStyle = k === 1 ? '#c9a24a' : '#9aa0a8';
    ctx.fillRect(hx - 7, headY + 2, 14, 12);
    ctx.fillStyle = '#1b1b1b'; ctx.fillRect(hx - 1, headY + 2, 2, 4);
  }
  // the record head glows with the level going onto the tape
  ctx.fillStyle = f.color('glow'); ctx.globalAlpha = Math.min(0.9, f.level * 4);
  ctx.beginPath(); ctx.arc(f.w * 0.44, headY + 2, 9, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  reel(ctx, x1, cy, R, pack1, s.a1);
  reel(ctx, x2, cy, R, pack2, s.a2);
}
`;

export function tapeecho(catalog: Catalog) {
  const knob = {
    skin: {
      name: 'cap',
      params: {
        cap: 'knob',
        pointer: 'pointer',
        scale: 'fg',
        ticks: 11,
        shape: 'chicken',
        numbers: true,
        label: 'bottom',
        value: 'none',
      },
    },
    textStyle: { font: 'michroma', size: 9, color: 'fg', case: 'upper' as const, spacing: 0.08 },
  };
  return work(
    'tapeecho',
    'Reel Echo',
    catalog,
    [760, 430],
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
      // ---- the plugin: brushed metal (the look's background) between wooden cheeks ----
      asset('sc-brushed-metal'),
      asset('sc-wood'),
      asset('sc-screw'),
      asset('sc-tape-machine'),
      {
        op: 'setLook',
        look: {
          tokens: {
            bg: '#a9adb2',
            fg: '#1a1a1a',
            accent: '#d8442b',
            track: '#2a2420',
            knob: '#1e1b18',
            pointer: '#f4efe4',
            muted: '#3f4246',
            glow: '#ffb347',
            font: 'michroma',
            labelFont: 'michroma',
            valueFont: 'michroma',
          },
          background: [
            { kind: 'image', asset: 'sc-brushed-metal', fit: 'cover' },
            {
              kind: 'linear',
              angle: 180,
              stops: [
                { color: '#ffffff30', at: 0 },
                { color: '#ffffff00', at: 0.4 },
                { color: '#00000026', at: 1 },
              ],
            },
          ],
          skins: {
            knob: { name: 'cap', params: { shape: 'chicken', numbers: true } },
            meter: { name: 'needle', params: { lamp: true } },
          },
        },
      },
      { op: 'setUnderlay', underlay: { asset: 'sc-tape-machine', opacity: 0.35, visible: false } },
      el({
        kind: 'shape',
        shape: 'rect',
        name: 'Cheek L',
        rect: r(0, 0, 40, 430),
        locked: true,
        style: {
          fill: [
            { kind: 'image', asset: 'sc-wood', fit: 'cover' },
            {
              kind: 'linear',
              angle: 90,
              stops: [
                { color: '#00000055', at: 0 },
                { color: '#00000000', at: 0.5 },
                { color: '#00000077', at: 1 },
              ],
            },
          ],
        },
      }),
      el({
        kind: 'shape',
        shape: 'rect',
        name: 'Cheek R',
        rect: r(720, 0, 40, 430),
        locked: true,
        style: {
          fill: [
            { kind: 'image', asset: 'sc-wood', fit: 'cover' },
            {
              kind: 'linear',
              angle: 90,
              stops: [
                { color: '#00000077', at: 0 },
                { color: '#00000000', at: 0.5 },
                { color: '#00000055', at: 1 },
              ],
            },
          ],
        },
      }),
      ...[
        [50, 10],
        [692, 10],
        [50, 402],
        [692, 402],
      ].map(([x, y], i) =>
        el({
          kind: 'image',
          name: `Screw ${i + 1}`,
          asset: 'sc-screw',
          fit: 'contain',
          rect: r(x!, y!, 16, 16),
          style: { rotate: 15 + i * 50 },
        }),
      ),
      el({
        kind: 'text',
        name: 'Title',
        text: 'REEL ECHO',
        rect: r(70, 20, 360, 34),
        textStyle: {
          font: 'michroma',
          size: 24,
          color: 'fg',
          align: 'left',
          spacing: 0.22,
          shadows: [{ x: 0, y: 1, blur: 0, color: '#ffffff88' }],
        },
      }),
      el({
        kind: 'text',
        name: 'Model',
        text: 'TAPE ECHO · MODEL 70',
        rect: r(72, 54, 360, 16),
        textStyle: { font: 'michroma', size: 10, color: 'muted', align: 'left', spacing: 0.3 },
      }),
      el({
        kind: 'shape',
        shape: 'rect',
        name: 'Stripe',
        rect: r(444, 28, 236, 6),
        locked: true,
        style: {
          fill: [
            {
              kind: 'linear',
              angle: 90,
              stops: [
                { color: '#d8442b', at: 0 },
                { color: '#d8442b', at: 0.33 },
                { color: '#f0a020', at: 0.33 },
                { color: '#f0a020', at: 0.66 },
                { color: '#2e6e8e', at: 0.66 },
                { color: '#2e6e8e', at: 1 },
              ],
            },
          ],
        },
      }),
      el({
        kind: 'led',
        name: 'Lamp',
        bind: '@level',
        color: '#ff3b1f',
        threshold: 0,
        rect: r(690, 24, 14, 14),
      }),
      el({
        kind: 'shape',
        shape: 'rect',
        name: 'Window',
        rect: r(70, 82, 380, 196),
        locked: true,
        style: {
          radius: 8,
          fill: [
            {
              kind: 'linear',
              angle: 180,
              stops: [
                { color: '#1d1611', at: 0 },
                { color: '#0e0a08', at: 1 },
              ],
            },
          ],
          stroke: { color: '#0a0a0a', width: 2, style: 'solid' },
          shadows: [
            { x: 0, y: 2, blur: 10, spread: 0, color: '#000000cc', inset: true },
            { x: 0, y: 1, blur: 0, spread: 0, color: '#ffffff66', inset: false },
          ],
        },
      }),
      el({ kind: 'canvas', name: 'Reels', code: TAPE_REELS, rect: r(74, 86, 372, 188) }),
      el({
        kind: 'shape',
        shape: 'rect',
        name: 'Glass',
        rect: r(70, 82, 380, 196),
        locked: true,
        style: {
          radius: 8,
          fill: [
            {
              kind: 'linear',
              angle: 160,
              stops: [
                { color: '#ffffff1c', at: 0 },
                { color: '#ffffff00', at: 0.35 },
                { color: '#ffffff00', at: 1 },
              ],
            },
          ],
        },
      }),
      el({
        kind: 'shape',
        shape: 'rect',
        name: 'Meter bezel',
        rect: r(470, 82, 228, 160),
        locked: true,
        style: {
          radius: 6,
          fill: [{ kind: 'color', color: '#141414' }],
          shadows: [
            { x: 0, y: 2, blur: 6, spread: 0, color: '#000000aa', inset: false },
            { x: 0, y: 1, blur: 0, spread: 0, color: '#ffffff40', inset: true },
          ],
        },
      }),
      ...control('vu1', 'ui.meter', 'VU', null, r(478, 90, 212, 144), {
        style: { skin: { name: 'needle', params: { lamp: true, caption: 'VU' } } },
      }),
      wire('trim1.out', 'vu1.in'),
      ...control('thiss', 'ui.toggle', 'Hiss', 'hisson1.b', r(472, 248, 110, 30), {
        value: true,
        style: {
          skin: {
            name: 'switch',
            params: { style: 'lever', onText: 'HISS', offText: 'OFF', label: 'none', on: 'accent' },
          },
          textStyle: { font: 'michroma', size: 9, color: 'fg' },
        },
      }),
      ...control('kin', 'ui.knob', 'Input', 'rec1.drive', r(62, 296, 100, 124), {
        min: 0.5,
        max: 6,
        scale: 'log',
        value: 1.4,
        style: knob,
      }),
      ...control(
        'ktime',
        'ui.knob',
        'Repeat rate',
        ['tape1.timeLeftSeconds', 'head2.in'],
        r(170, 296, 100, 124),
        { min: 0.06, max: 0.8, scale: 'log', unit: 's', value: 0.32, style: knob },
      ),
      ...control('kfb', 'ui.knob', 'Intensity', 'tape1.feedback', r(278, 296, 100, 124), {
        min: 0,
        max: 0.92,
        value: 0.55,
        style: knob,
      }),
      ...control('ktone', 'ui.knob', 'Tone', 'tape1.cutoffHz', r(386, 296, 100, 124), {
        min: 900,
        max: 7000,
        scale: 'log',
        unit: 'Hz',
        value: 2600,
        style: knob,
      }),
      ...control('kwow', 'ui.knob', 'Wow', 'tape1.depthSeconds', r(494, 296, 100, 124), {
        min: 0,
        max: 0.004,
        unit: 's',
        value: 0.0012,
        style: knob,
      }),
      ...control(
        'kecho',
        'ui.knob',
        'Echo vol',
        ['mixl1.level2', 'mixr1.level2'],
        r(602, 296, 100, 124),
        { min: 0, max: 1.2, value: 0.7, style: knob },
      ),
    ],
  );
}
