// Echo Line — a tape echo shown as one line, from what goes in to what comes back.
// The input is driven onto tape (a soft clip), trimmed, and played back by
// two heads: the first at the repeat time, the second 1.5× later on the right.
// Intensity feeds the first head back; Tone darkens each pass; Wow wobbles the
// tape; Hiss adds its noise. The dry signal passes untouched beside the echoes.
// The design follows the thinking of SIG CRUISER (iF DESIGN AWARD 2022), the
// interface that lets one person run a whole filling line: the process laid out
// in order on one screen, each step with its own values and state where it
// happens. Here the steps are numbered columns; the line above them is the
// echo itself — the heads sit on the tape where the repeat time puts them, and
// a sound going in travels along the tape and lights each head as its echo is
// heard, then rides the return line back, smaller by the Intensity.
import type { Catalog } from '../../work/catalog.ts';
import { add, control, el, r, wire, work } from './build.ts';

/** The echo as a line: the stations, the tape loop with its heads, pulses travelling in time with the echoes. */
export const ECHO_LINE = `// The echo, left to right: IN, RECORD, the tape loop past head A and head B,
// OUT (props give the stations' x). The tape holds 1.3 s from RECORD to its
// end; head A sits at the repeat time (ktime), head B 1.5 times later. The tape
// moves at the speed that brings a point from RECORD to head A in that time.
// A sound coming in (a jump in the output level) is sent along the tape as a
// pulse; a head lights as it passes (when its echo is heard), and the return
// line carries the pulse back to RECORD, smaller by Intensity (kfb).
const SPAN = 1.3;
export default {
  setup(ctx, f) {
    Object.assign(f.state, { prev: 0, last: -1, pulses: [], back: -10 });
  },
  draw(ctx, f) {
    const s = f.state, w = f.w, h = f.h, P = f.props;
    const fg = f.color('fg'), accent = f.color('accent'), muted = f.color('muted'), track = f.color('track'), bg = f.color('bg');
    const time = f.value('ktime'), fb = f.value('kfb');
    const y = 92, bus = 34, below = 146;
    const x0 = P.x0, x1 = P.x1;
    const xAt = sec => x0 + (sec / SPAN) * (x1 - x0);
    const xa = xAt(time), xb = xAt(time * 1.5);
    // A sound coming in starts a pulse at RECORD.
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
    ctx.lineCap = 'round';
    // The dry path along the top, and the taps from the heads up to it.
    ctx.strokeStyle = track;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(P.xin, y); ctx.lineTo(P.xin, bus); ctx.lineTo(P.xout, bus); ctx.lineTo(P.xout, y); ctx.stroke();
    // In to the tape.
    ctx.strokeStyle = fg;
    ctx.beginPath(); ctx.moveTo(P.xin, y); ctx.lineTo(x0 - 18, y); ctx.stroke();
    // The return: from head A under the tape back to RECORD, as strong as Intensity.
    const hot = Math.max(0, 1 - (f.t - s.back) / 0.4);
    ctx.strokeStyle = hot > 0 ? accent : muted;
    ctx.globalAlpha = 0.35 + 0.65 * Math.max(hot, fb);
    ctx.lineWidth = 1 + fb * 3;
    ctx.setLineDash(fb < 0.05 ? [3, 5] : []);
    ctx.beginPath(); ctx.moveTo(xa, y + 24); ctx.lineTo(xa, below); ctx.lineTo(P.xrec, below); ctx.lineTo(P.xrec, y + 10); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    // The tape loop, moving: dashes along its top run.
    ctx.strokeStyle = track;
    ctx.lineWidth = 26;
    ctx.beginPath(); ctx.moveTo(x0, y + 12); ctx.lineTo(x1, y + 12); ctx.stroke();
    const speed = (xa - x0) / Math.max(0.02, time), off = (f.t * speed) % 14;
    ctx.strokeStyle = muted;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.lineDashOffset = -off;
    ctx.beginPath(); ctx.moveTo(x0 - 6, y); ctx.lineTo(x1 + 6, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    // Pulses on the tape.
    for (const q of s.pulses) {
      const x = xAt(f.t - q.born);
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.25 + 0.75 * q.gain;
      ctx.beginPath(); ctx.arc(x, y, 3 + 4 * q.gain, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // The heads, with their taps up to the out line; lit as their echo plays.
    [[xa, time, true], [xb, time * 1.5, false]].forEach(([x, at, filled]) => {
      const on = lit(at);
      ctx.strokeStyle = on ? accent : fg;
      ctx.lineWidth = 2;
      ctx.setLineDash(on ? [] : [2, 4]);
      ctx.beginPath(); ctx.moveTo(x, y - 12); ctx.lineTo(x, bus); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = on ? accent : filled ? fg : bg;
      ctx.beginPath(); ctx.roundRect(x - 8, y - 12, 16, 16, 3); ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = on ? accent : fg;
      ctx.stroke();
    });
    // Stations: IN, RECORD, OUT.
    for (const [x, on] of [[P.xin, f.level > 0.02], [P.xrec, f.level > 0.02], [P.xout, f.level > 0.02]]) {
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = fg; ctx.stroke();
      if (on) { ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); }
    }
  },
};
`;

/** The steps, left to right: their columns on the plugin (x, width) and names. */
const STEPS = [
  { x: 24, w: 100, name: 'Input' },
  { x: 132, w: 108, name: 'Record' },
  { x: 248, w: 236, name: 'Tape' },
  { x: 492, w: 160, name: 'Return' },
  { x: 660, w: 96, name: 'Out' },
] as const;

export function tapeecho(catalog: Catalog) {
  const knob = {
    textStyle: { size: 10, weight: 700, color: 'muted', case: 'upper' as const, spacing: 0.14 },
  };
  const line = { x: 24, y: 76, w: 732, h: 176 };
  const centre = (i: number) => STEPS[i]!.x + STEPS[i]!.w / 2 - line.x;
  return work(
    'tapeecho',
    'Echo Line',
    catalog,
    [780, 470],
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
      // ---- the plugin: the line above, the steps below ----
      {
        op: 'setLook',
        look: {
          tokens: {
            bg: '#eef0f1',
            fg: '#1b1f23',
            accent: '#00897b',
            track: '#d3d8dc',
            knob: '#ffffff',
            pointer: '#1b1f23',
            muted: '#58616a',
            glow: '#00897b',
            font: 'lato',
            labelFont: 'lato',
            valueFont: 'jetbrains-mono',
          },
          background: [{ kind: 'color', color: '#eef0f1' }],
          skins: {
            knob: { name: 'ring', params: { thickness: 4, ticks: 0, round: false } },
            meter: { name: 'bar', params: { scale: true } },
          },
        },
      },
      el({
        kind: 'text',
        name: 'Title',
        text: 'Echo Line',
        rect: r(24, 18, 240, 30),
        textStyle: { size: 24, weight: 700, color: 'fg', align: 'left' },
      }),
      el({
        kind: 'text',
        name: 'Subtitle',
        text: 'Tape echo. The whole line on one screen: each sound rides the tape past both heads.',
        rect: r(24, 50, 560, 16),
        textStyle: { size: 12, color: 'muted', align: 'left' },
      }),
      el({
        kind: 'shape',
        shape: 'rect',
        name: 'Line panel',
        rect: r(line.x, line.y, line.w, line.h),
        locked: true,
        style: {
          radius: 8,
          fill: [{ kind: 'color', color: '#f8f9f9' }],
          stroke: { color: '#d3d8dc', width: 1, style: 'solid' },
        },
      }),
      el({
        kind: 'canvas',
        name: 'The line',
        code: ECHO_LINE,
        rect: r(line.x, line.y, line.w, line.h),
        props: {
          xin: centre(0),
          xrec: centre(1),
          x0: STEPS[2].x - line.x,
          x1: STEPS[3].x + STEPS[3].w - line.x,
          xout: centre(4),
        },
      }),
      el({
        kind: 'text',
        name: 'Heads key',
        text: 'Head A at the repeat time · head B 1.5× later, on the right',
        rect: r(STEPS[2].x, line.y + line.h - 22, 404, 14),
        textStyle: { size: 10, color: 'muted', align: 'left' },
      }),
      el({
        kind: 'text',
        name: 'Dry key',
        text: 'dry',
        rect: r(STEPS[4].x, line.y + 8, 96, 14),
        textStyle: { size: 10, color: 'muted', align: 'center' },
      }),
      ...STEPS.flatMap((step, i) => [
        el({
          kind: 'shape',
          shape: 'rect',
          name: `${step.name} rule`,
          rect: r(step.x, 268, step.w, 2),
          locked: true,
          style: { fill: [{ kind: 'color', color: i === 2 || i === 3 ? '#00897b' : '#1b1f23' }] },
        }),
        el({
          kind: 'text',
          name: `${step.name} step`,
          text: `0${i + 1}  ${step.name}`,
          rect: r(step.x, 276, step.w, 16),
          textStyle: {
            size: 11,
            weight: 700,
            color: 'fg',
            align: 'left',
            spacing: 0.12,
            case: 'upper',
          },
        }),
      ]),
      ...control('kin', 'ui.knob', 'Drive', 'rec1.drive', r(24, 300, 96, 112), {
        min: 0.5,
        max: 6,
        scale: 'log',
        value: 1.4,
        style: knob,
      }),
      ...control('vu1', 'ui.meter', 'Onto tape', null, r(132, 308, 108, 26)),
      wire('trim1.out', 'vu1.in'),
      el({
        kind: 'text',
        name: 'Onto tape',
        text: 'level onto tape',
        rect: r(132, 340, 108, 14),
        textStyle: { size: 10, color: 'muted', align: 'left' },
      }),
      ...control(
        'ktime',
        'ui.knob',
        'Repeat',
        ['tape1.timeLeftSeconds', 'head2.in'],
        r(248, 300, 96, 112),
        { min: 0.06, max: 0.8, scale: 'log', unit: 's', value: 0.32, style: knob },
      ),
      ...control('kwow', 'ui.knob', 'Wow', 'tape1.depthSeconds', r(348, 300, 96, 112), {
        min: 0,
        max: 0.004,
        unit: 's',
        value: 0.0012,
        style: knob,
      }),
      ...control('thiss', 'ui.toggle', 'Hiss', 'hisson1.b', r(448, 330, 40, 30), {
        value: true,
        style: {
          skin: { name: 'button', params: { radius: 4 } },
          textStyle: { size: 11, weight: 700 },
        },
      }),
      ...control('kfb', 'ui.knob', 'Intensity', 'tape1.feedback', r(492, 300, 80, 112), {
        min: 0,
        max: 0.92,
        value: 0.55,
        style: knob,
      }),
      ...control('ktone', 'ui.knob', 'Tone', 'tape1.cutoffHz', r(572, 300, 80, 112), {
        min: 900,
        max: 7000,
        scale: 'log',
        unit: 'Hz',
        value: 2600,
        style: knob,
      }),
      ...control(
        'kecho',
        'ui.knob',
        'Echoes',
        ['mixl1.level2', 'mixr1.level2'],
        r(660, 300, 96, 112),
        {
          min: 0,
          max: 1.2,
          value: 0.7,
          style: knob,
        },
      ),
    ],
  );
}
