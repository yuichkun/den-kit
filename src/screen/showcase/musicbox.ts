// Evaluation prompt 3 — Metallic bells like a music box, with a wooden box and brass look.
// A two-operator FM bell per note: an inharmonic ratio (3.5 : 1) gives the
// metal, a fast-decaying index gives the bright "tink" at the start, then the
// tone rings down like a comb tine (as long whether the key is held or let go,
// since a tine rings on by itself); a small wooden-box reverb around it. The
// screen is the box: wood, an engraved brass plate with brass knobs, and the
// comb (fifteen tines, two octaves of a major scale from C5) to play.
import type { Catalog } from '../../work/catalog.ts';
import { add, asset, control, el, r, wire, work } from './build.ts';

export function musicbox(catalog: Catalog) {
  const knob = {
    skin: {
      name: 'image',
      params: { cap: 'sc-brass-knob', size: 0.86, label: 'bottom', value: 'none' },
    },
    textStyle: {
      font: 'cinzel',
      size: 12,
      weight: 700,
      color: '#4a300c',
      case: 'upper' as const,
      spacing: 0.16,
      shadows: [{ x: 0, y: 1, blur: 0, color: '#fff1c066' }],
    },
  };
  const engraved = (color: string) => [
    { x: 0, y: 1, blur: 0, color: '#fff3c4aa' },
    { x: 0, y: -1, blur: 0, color: color },
  ];
  return work(
    'musicbox',
    'Lullaby Box',
    catalog,
    [720, 440],
    [
      // ---- sound ----
      add('voice1', 'kit.voiceIn', { config: { mode: 'poly', capacity: 6, heldCapacity: 16 } }),
      add('ratio1', 'kit.mul', { label: 'Ratio', values: { b: 3.5 } }),
      add('index1', 'kit.mul', { label: 'Index', values: { b: 5 } }),
      add('ienv1', 'den.envelope', {
        label: 'Tink',
        values: { attack: 0, decay: 0.45, sustain: 0.1, release: 0.4 },
      }),
      add('dev1', 'kit.mul', { label: 'Deviation' }),
      add('fm1', 'den.frequencyModulation', { label: 'Bell' }),
      add('aenv1', 'den.curvedAdsr', {
        label: 'Ring',
        values: {
          attack: 0.001,
          decay: 1.8,
          sustain: 0,
          release: 1.8,
          decayBend: 0.85,
          releaseBend: 0.85,
        },
      }),
      add('vca1', 'kit.mul', { label: 'VCA' }),
      add('vel1', 'kit.mul', { label: 'Velocity' }),
      add('vmix1', 'kit.voiceMix'),
      add('gain1', 'kit.gain', { values: { gain: 0.3 } }),
      add('box1', 'den.algorithmicReverb', {
        label: 'Wooden box',
        config: { roomScale: 0.6, decaySeconds: 1.4, dampingHz: 6500 },
        values: { mix: 0.25 },
      }),
      add('out1', 'kit.out'),
      wire('voice1.pitch', 'fm1.carrierHz'),
      wire('voice1.pitch', 'ratio1.a'),
      wire('ratio1.out', 'fm1.modulatorHz'),
      wire('voice1.pitch', 'index1.a'),
      wire('index1.out', 'dev1.a'),
      wire('ienv1.level', 'dev1.b'),
      wire('dev1.out', 'fm1.deviationHz'),
      wire('fm1.out', 'vca1.a'),
      wire('aenv1.level', 'vca1.b'),
      wire('vca1.out', 'vel1.a'),
      wire('voice1.velocity', 'vel1.b'),
      wire('vel1.out', 'vmix1.in'),
      wire('aenv1.done', 'vmix1.done'),
      wire('vmix1.out', 'gain1.in'),
      wire('gain1.out', 'box1.left'),
      wire('gain1.out', 'box1.right'),
      wire('box1.left', 'out1.left'),
      wire('box1.right', 'out1.right'),
      // ---- the plugin: a wooden box with a brass plate ----
      asset('sc-wood'),
      asset('sc-brass'),
      asset('sc-brass-knob'),
      asset('sc-screw'),
      {
        op: 'setLook',
        look: {
          tokens: {
            bg: '#3b2414',
            fg: '#f3e2bf',
            accent: '#d4a73a',
            track: '#2a160c',
            knob: '#d4a73a',
            pointer: '#3a2408',
            muted: '#cfae7f',
            glow: '#ffd77a',
            font: 'cinzel',
            labelFont: 'cinzel',
            valueFont: 'cinzel',
          },
          background: [
            { kind: 'image', asset: 'sc-wood', fit: 'cover' },
            {
              kind: 'radial',
              x: 0.5,
              y: 0.4,
              stops: [
                { color: '#00000000', at: 0.55 },
                { color: '#00000066', at: 1 },
              ],
            },
          ],
          skins: { knob: { name: 'image', params: { cap: 'sc-brass-knob' } } },
        },
      },
      el({
        kind: 'shape',
        shape: 'rect',
        name: 'Rim',
        rect: r(14, 14, 692, 412),
        locked: true,
        style: {
          radius: 14,
          stroke: { color: '#2a1408', width: 3, style: 'solid' },
          shadows: [
            { x: 0, y: 0, blur: 16, spread: 2, color: '#00000088', inset: true },
            { x: 0, y: 1, blur: 0, spread: 0, color: '#ffffff22', inset: false },
          ],
        },
      }),
      el({
        kind: 'shape',
        shape: 'rect',
        name: 'Brass plate',
        rect: r(40, 32, 640, 232),
        locked: true,
        style: {
          radius: 10,
          fill: [
            { kind: 'image', asset: 'sc-brass', fit: 'cover' },
            {
              kind: 'linear',
              angle: 100,
              stops: [
                { color: '#fff6d000', at: 0.2 },
                { color: '#fff6d055', at: 0.45 },
                { color: '#fff6d000', at: 0.7 },
              ],
            },
            { kind: 'color', color: '#c8952a', blend: 'multiply', opacity: 0.55 },
          ],
          shadows: [
            { x: 0, y: 8, blur: 18, spread: 0, color: '#000000aa', inset: false },
            { x: 0, y: 1, blur: 0, spread: 0, color: '#fff3c4aa', inset: true },
            { x: 0, y: -2, blur: 4, spread: 0, color: '#5a3a1288', inset: true },
          ],
        },
      }),
      ...[
        [52, 44],
        [650, 44],
        [52, 234],
        [650, 234],
      ].map(([x, y], i) =>
        el({
          kind: 'image',
          name: `Screw ${i + 1}`,
          asset: 'sc-screw',
          fit: 'contain',
          rect: r(x!, y!, 18, 18),
          style: { rotate: 20 + i * 41 },
        }),
      ),
      el({
        kind: 'text',
        name: 'Title',
        text: 'Lullaby',
        rect: r(40, 42, 640, 52),
        textStyle: {
          font: 'cinzel',
          size: 38,
          weight: 700,
          color: '#4a2e08',
          spacing: 0.12,
          shadows: engraved('#2a180466'),
        },
      }),
      el({
        kind: 'text',
        name: 'Subtitle',
        text: 'Music Box · No. 3',
        rect: r(40, 94, 640, 18),
        textStyle: {
          font: 'cinzel',
          size: 12,
          weight: 700,
          color: '#3e2608',
          spacing: 0.32,
          case: 'upper',
          shadows: engraved('#2a180444'),
        },
      }),
      ...control('kmetal', 'ui.knob', 'Metal', 'ratio1.b', r(92, 124, 104, 124), {
        min: 1,
        max: 7,
        value: 3.5,
        style: knob,
      }),
      ...control('kshine', 'ui.knob', 'Shine', 'index1.b', r(236, 124, 104, 124), {
        min: 0,
        max: 10,
        value: 5,
        style: knob,
      }),
      ...control(
        'kring',
        'ui.knob',
        'Ring',
        ['aenv1.decay', 'aenv1.release'],
        r(380, 124, 104, 124),
        { min: 0.2, max: 6, scale: 'log', unit: 's', value: 1.8, style: knob },
      ),
      ...control('kbox', 'ui.knob', 'Box', 'box1.mix', r(524, 124, 104, 124), {
        min: 0,
        max: 1,
        value: 0.25,
        style: knob,
      }),
      el({
        kind: 'shape',
        shape: 'rect',
        name: 'Felt',
        rect: r(40, 286, 640, 122),
        locked: true,
        style: {
          radius: 8,
          fill: [{ kind: 'color', color: '#24130a' }],
          shadows: [{ x: 0, y: 3, blur: 10, spread: 0, color: '#000000cc', inset: true }],
        },
      }),
      ...control('comb1', 'ui.keyboard', 'Comb', null, r(54, 296, 612, 102), {
        style: {
          skin: {
            name: 'pads',
            params: {
              count: 15,
              columns: 15,
              start: 72,
              scale: 'major',
              colors: 'accent',
              radius: 3,
              gap: 5,
            },
          },
          textStyle: { font: 'cinzel', size: 11, weight: 700 },
        },
      }),
    ],
  );
}
