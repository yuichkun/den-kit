// The showcase works are ordinary patches: each one builds from den-kit edits,
// validates, compiles and renders finite, audible, unclipped audio; its
// canvases load and draw a frame; its look can be put on another work. And each
// does what its controls say (measured on the rendered sound, not assumed).
import { assetsOf } from '../../src/work/ui.ts';
import { appendFileSync, readFileSync, statSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vite-plus/test';
import { renderOffline } from '@unworklet/offline';
import { compile } from '@unworklet/core';
import { catalog } from '../../src/sound/blocks/index.ts';
import { analyse, testSignal } from '../../src/sound/analysis.ts';
import { generate } from '../../src/sound/codegen.ts';
import { applyIntents, type Intent } from '../../src/work/ops.ts';
import { documentHash, parseDocument, serializeDocument } from '../../src/work/persistence.ts';
import { emptyDocument, type PatchDocument } from '../../src/work/schema.ts';
import { validate } from '../../src/work/validate.ts';
import { flatten } from '../../src/work/parts.ts';
import { evaluate } from '../../src/sound/compile/evaluate.ts';
import { WORKS, lookIntents } from '../../src/screen/showcase/index.ts';
import { SHOWCASE_ASSETS } from '../../src/screen/showcase/assets.ts';
import { FILTER_HILL } from '../../src/screen/showcase/acid.ts';
import { CRUSHER, CRUSH_GRID } from '../../src/screen/showcase/lofi.ts';
import { FIELD } from '../../src/screen/showcase/rain.ts';
import { SAW_LANES } from '../../src/screen/showcase/supersaw.ts';
import { TIDE_SHORE } from '../../src/screen/showcase/tide.ts';
import { loadRegistry } from '../helpers/registry.ts';

let registry: Record<string, unknown>;
beforeAll(async () => {
  registry = await loadRegistry();
});
const params = (values: Record<string, number>) =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, [v]]));
const SR = 48000;
/** Levels and compile sizes go to this file when set (to tune the works). */
const note = (line: string) => {
  if (process.env.SHOWCASE_LEVELS) appendFileSync(process.env.SHOWCASE_LEVELS, `${line}\n`);
};
type MidiEvent = { name: string; atSample: number; payload: unknown };
/** Notes as [note, start s, length s]. */
function notes(list: Array<[number, number, number]>): MidiEvent[] {
  return list.flatMap(([n, at, len]) => [
    {
      name: 'midi',
      atSample: Math.round(at * SR),
      payload: { type: 'noteOn', note: n, velocity: 100, channel: 0 },
    },
    {
      name: 'midi',
      atSample: Math.round((at + len) * SR),
      payload: { type: 'noteOff', note: n, velocity: 0, channel: 0 },
    },
  ]);
}
/** A phrase that suits the work: a bass line, hits on the pads, or chord notes. */
function phrase(id: string): MidiEvent[] {
  const list =
    id === 'toy'
      ? [48, 50, 52, 55, 57, 60]
      : id === 'acid'
        ? [36, 36, 48, 39, 36, 43]
        : [48, 55, 60, 64];
  return notes(list.map((n, i) => [n, i * 0.25, 0.18]));
}
/** What an effect is heard on: drums for the tape echo, chords otherwise. */
const inputFor = (id: string) => (id === 'tapeecho' ? 'drums' : 'chords');

async function render(
  doc: PatchDocument,
  o: { seconds: number; input?: Float32Array[]; events?: MidiEvent[] },
) {
  const g = generate(doc, catalog);
  expect(g.issues.filter(i => i.severity === 'error')).toEqual([]);
  const { processor } = evaluate(g.source, registry);
  const result = await renderOffline(processor, {
    sampleRate: SR,
    duration: o.seconds,
    inputs: o.input ? { main: o.input } : undefined,
    params: params(g.values),
    events: o.events ?? [],
  });
  expect(result.diagnostics.scrubbedSamples).toBe(0);
  return result.outputs.main!;
}
/** The work with some controls turned (node, port, value). */
const turned = (doc: PatchDocument, values: Array<[string, string, number | boolean]>) =>
  applyIntents(
    doc,
    values.map(([node, port, value]): Intent => ({ op: 'setValue', node, port, value })),
    catalog,
  ).doc;
/** RMS of one channel between two times (s). */
function rms(ch: Float32Array, from: number, to: number) {
  let s = 0;
  const a = Math.round(from * SR),
    b = Math.min(ch.length, Math.round(to * SR));
  for (let i = a; i < b; i++) s += ch[i]! * ch[i]!;
  return Math.sqrt(s / Math.max(1, b - a));
}
const slice = (chs: Float32Array[], from: number, to: number) =>
  chs.map(c => c.slice(Math.round(from * SR), Math.round(to * SR)));
/** A short burst at `at` seconds (a click to hear echoes of), stereo. */
function click(seconds: number, at: number) {
  const l = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < 240; i++)
    l[Math.round(at * SR) + i] = Math.sin(i * 0.35) * (1 - i / 240) * 0.8;
  return [l, l.slice()];
}
/** A stand-in canvas: every method exists and returns another stand-in (gradients, measureText…). */
function fakeCanvas(): unknown {
  const store: Record<string | symbol, unknown> = {};
  return new Proxy(store, {
    get: (t, k) => (k in t ? t[k] : () => fakeCanvas()),
    set: (t, k, v) => {
      t[k] = v;
      return true;
    },
  });
}

describe('showcase works', () => {
  for (const w of WORKS) {
    it(`${w.id}: builds, validates, compiles and renders audible, unclipped audio`, async () => {
      const doc = w.build(catalog);
      const { issues } = validate(doc, catalog);
      expect(issues.filter(i => i.severity === 'error')).toEqual([]);
      const g = generate(doc, catalog);
      const seconds = 2;
      const out = await render(doc, {
        seconds,
        input: g.audioIn ? testSignal(inputFor(w.id), seconds, SR) : undefined,
        events: g.voices ? phrase(w.id) : [],
      });
      let peak = 0,
        sum = 0,
        n = 0;
      for (const ch of out)
        for (const s of ch) {
          expect(Number.isFinite(s)).toBe(true);
          peak = Math.max(peak, Math.abs(s));
          sum += s * s;
          n++;
        }
      const level = Math.sqrt(sum / n);
      note(`${w.id}: peak ${peak.toFixed(3)} rms ${level.toFixed(4)}`);
      expect(peak).toBeGreaterThan(0.02);
      expect(peak).toBeLessThan(1);
      const t0 = performance.now();
      const compiled = await compile(evaluate(g.source, registry).processor, { sampleRate: SR });
      note(
        `${w.id}: compile ${(performance.now() - t0).toFixed(0)} ms, wasm ${(compiled.wasm.byteLength / 1024).toFixed(0)} KB`,
      );
      expect(compiled.wasm.byteLength).toBeLessThan(1_500_000);
    }, 60000);

    it(`${w.id}: saves and loads back unchanged; canvases load and draw`, async () => {
      const doc = w.build(catalog);
      const parsed = parseDocument(serializeDocument(doc), catalog);
      if (!parsed.ok) throw new Error(parsed.error);
      expect(parsed.report).toEqual([]);
      expect(documentHash(parsed.doc)).toBe(documentHash(doc));
      for (const el of Object.values(doc.ui.elements)) {
        if (el.kind !== 'canvas') continue;
        const mod = await import(
          `data:text/javascript;base64,${Buffer.from(el.code).toString('base64')}`
        );
        const part = typeof mod.default === 'function' ? { draw: mod.default } : mod.default;
        const ctx = fakeCanvas();
        const f = {
          t: 1,
          dt: 1 / 60,
          w: el.rect.w,
          h: el.rect.h,
          level: 0.2,
          peak: 0.4,
          wave: new Float32Array(256),
          spectrum: new Float32Array(64).fill(0.5),
          props: el.props,
          state: {},
          value: () => 0.5,
          norm: () => 0.5,
          xy: () => ({ x: 0.3, y: 0.6 }),
          on: () => true,
          color: () => '#ff00ff',
        };
        part.setup?.(ctx, f);
        for (let i = 0; i < 3; i++) {
          f.t += 1 / 60;
          part.draw(ctx, f);
        }
      }
    });

    it(`${w.id}: canvases draw and follow the hand anywhere on them, with the work's own values`, async () => {
      const doc = w.build(catalog);
      const values: Record<string, unknown> = {};
      for (const n of Object.values(doc.nodes))
        if (n.values && 'value' in n.values) values[n.id] = n.values.value;
      for (const el of Object.values(doc.ui.elements)) {
        if (el.kind !== 'canvas') continue;
        const mod = await import(
          `data:text/javascript;base64,${Buffer.from(el.code).toString('base64')}`
        );
        const part = typeof mod.default === 'function' ? { draw: mod.default } : mod.default;
        const ctx = fakeCanvas();
        const pointer = {
          x: 0,
          y: 0,
          over: true,
          down: false,
          shift: false,
          alt: false,
          meta: false,
        };
        // The controls read the way the canvas worker gives them: f.value is a number (a switch 1 or 0).
        const f = {
          t: 1,
          dt: 1 / 60,
          w: el.rect.w,
          h: el.rect.h,
          level: 0.2,
          peak: 0.4,
          wave: new Float32Array(256).map((_, i) => 0.5 * Math.sin(i / 10)),
          spectrum: new Float32Array(64).fill(0.5),
          props: el.props,
          state: {},
          pointer,
          value: (id: string) => {
            const v = values[id];
            return typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : 0;
          },
          norm: () => 0.5,
          xy: () => ({ x: 0.3, y: 0.6 }),
          on: (id: string) => values[id] === true || (values[id] as number) >= 0.5,
          color: () => '#ff00ff',
          range: () => ({ min: 0, max: 1, log: false, unit: '' }),
          set: () => {},
          setNorm: () => {},
          cursor: () => {},
        };
        part.setup?.(ctx, f);
        for (let y = 0; y < el.rect.h; y += 12)
          for (let x = 0; x < el.rect.w; x += 12) {
            Object.assign(pointer, { x, y });
            part.pointer?.(
              { type: 'move', x, y, dx: 0, dy: 0, shift: false, alt: false, meta: false },
              f,
            );
            part.draw(ctx, f);
          }
      }
    });
  }

  it('the look of one work goes onto another (what to make × how it looks)', () => {
    const acid = WORKS.find(w => w.id === 'acid')!.build(catalog);
    const toy = WORKS.find(w => w.id === 'toy')!.build(catalog);
    const r = applyIntents(acid, lookIntents(acid, toy), catalog);
    expect(r.doc.ui.look).toEqual(toy.ui.look);
    expect(r.doc.panel.theme).toBe(toy.panel.theme);
    expect(Object.keys(r.doc.ui.elements)).toEqual(Object.keys(acid.ui.elements)); // the layout and decorations stay
    expect(Object.keys(r.doc.nodes)).toEqual(Object.keys(acid.nodes)); // and the sound
  });

  it('a look that uses pictures brings them along', () => {
    const acid = WORKS.find(w => w.id === 'acid')!.build(catalog);
    const pictured = applyIntents(
      WORKS.find(w => w.id === 'breath')!.build(catalog),
      [
        { op: 'addAsset', asset: SHOWCASE_ASSETS['assets/den-kit/paper.jpg']! },
        {
          op: 'setLook',
          look: {
            background: [{ kind: 'image', asset: 'assets/den-kit/paper.jpg', fit: 'cover' }],
          },
        },
      ],
      catalog,
    ).doc;
    const r = applyIntents(acid, lookIntents(acid, pictured), catalog);
    expect(Object.keys(assetsOf(r.doc.files))).toContain('assets/den-kit/paper.jpg');
  });
});

/** Width and height of a JPEG (its first frame header) or an SVG (its width/height attributes). */
function pictureSize(bytes: Uint8Array, mime: string): { width: number; height: number } | null {
  if (mime === 'image/svg+xml') {
    const head = new TextDecoder().decode(bytes.slice(0, 300));
    const w = /\bwidth="(\d+)"/.exec(head),
      h = /\bheight="(\d+)"/.exec(head);
    return w && h ? { width: Number(w[1]), height: Number(h[1]) } : null;
  }
  for (let i = 2; i + 9 < bytes.length;) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1]!,
      length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (marker >= 0xc0 && marker <= 0xc3)
      return {
        height: (bytes[i + 5]! << 8) | bytes[i + 6]!,
        width: (bytes[i + 7]! << 8) | bytes[i + 8]!,
      };
    i += 2 + length;
  }
  return null;
}

/** WCAG contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5]
      .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('every work is a finished first version', () => {
  for (const w of WORKS) {
    it(`${w.id}: every control on the screen reaches the sound, and the look is its own`, () => {
      const doc = w.build(catalog);
      const placed = Object.values(doc.nodes).filter(n => n.panel && n.type.startsWith('ui.'));
      // A control kept in the patch is on the screen too when a canvas names it (f.value, f.set): it must reach the sound as well.
      const codes = Object.values(doc.ui.elements).flatMap(e =>
        e.kind === 'canvas' ? [e.code] : [],
      );
      const drawn = Object.values(doc.nodes).filter(
        n => !n.panel && n.type.startsWith('ui.') && codes.some(c => c.includes(`'${n.id}'`)),
      );
      expect(placed.length + drawn.length, 'something on the screen to play').toBeGreaterThan(0);
      for (const n of drawn)
        expect(
          Object.values(doc.edges).some(e => e.from.node === n.id),
          `${n.id} (${n.label}), on a canvas, is wired to something`,
        ).toBe(true);
      for (const n of placed) {
        if (n.type === 'ui.keyboard') {
          expect(
            Object.values(doc.nodes).some(m => m.type === 'kit.voiceIn'),
            `${n.id} plays a voice`,
          ).toBe(true);
          continue;
        }
        if (n.type === 'ui.scope' || n.type === 'ui.meter') {
          expect(
            Object.values(doc.edges).some(e => e.to.node === n.id),
            `${n.id} shows a signal`,
          ).toBe(true);
          continue;
        }
        expect(
          Object.values(doc.edges).some(e => e.from.node === n.id),
          `${n.id} (${n.label}) is wired to something`,
        ).toBe(true);
      }
      expect(Object.keys(doc.ui.look.tokens).length, 'not the default theme').toBeGreaterThan(4);
      // The look's text colours read on its background, so the look can be put on another work's layout.
      const { bg, fg, muted } = doc.ui.look.tokens;
      expect(contrast(fg!, bg!), `fg ${fg} on bg ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(muted!, bg!), `muted ${muted} on bg ${bg}`).toBeGreaterThanOrEqual(3);
    });

    it(`${w.id}: its pictures exist as described, with a licence den can ship`, () => {
      const doc = w.build(catalog);
      for (const a of Object.values(assetsOf(doc.files))) {
        expect(a.url, a.id).toMatch(/^\/showcase\/[a-z-]+\.(jpg|svg)$/);
        const file = `public${a.url}`;
        expect(statSync(file).size, `${a.id} bytes`).toBe(a.bytes);
        expect(pictureSize(new Uint8Array(readFileSync(file)), a.mime), `${a.id} size`).toEqual({
          width: a.width,
          height: a.height,
        });
        expect(a.source?.license, `${a.id} licence`).toMatch(/^(CC0|Public domain|Own work)/);
        expect(a.source?.author, `${a.id} author`).toBeTruthy();
        if (!a.source?.license?.startsWith('Own work'))
          expect(a.source?.url, `${a.id} source page`).toMatch(
            /^https:\/\/(commons\.wikimedia\.org|ambientcg\.com)\//,
          );
        // SOURCES.md lists the same credit for the repository: its row names the same
        // author and, for a picture from elsewhere, the same source page.
        const row = readFileSync('public/showcase/SOURCES.md', 'utf8')
          .split('\n')
          .find(line => line.includes(`\`${a.url!.slice('/showcase/'.length)}\``));
        expect(row, `${a.id} listed in SOURCES.md`).toBeTruthy();
        expect(row, `${a.id} author in SOURCES.md`).toContain(a.source!.author);
        if (!a.source?.license?.startsWith('Own work'))
          expect(row, `${a.id} source page in SOURCES.md`).toContain(a.source!.url);
      }
    });
  }
});

describe('each work does what its controls say', () => {
  const build = (id: string) => WORKS.find(w => w.id === id)!.build(catalog);

  it('Echo Line: echoes come back at the repeat rate, the second head 1.5× later', async () => {
    const doc = turned(build('tapeecho'), [
      ['thiss', 'value', false],
      ['ktime', 'value', 0.25],
    ]);
    const [l, r] = await render(doc, { seconds: 1, input: click(1, 0.05) });
    const quiet = rms(l!, 0.12, 0.27);
    note(
      `tapeecho: L first echo ${rms(l!, 0.29, 0.33).toExponential(2)} vs before ${quiet.toExponential(2)}; R ${rms(r!, 0.415, 0.455).toExponential(2)}`,
    );
    expect(rms(l!, 0.29, 0.33)).toBeGreaterThan(10 * quiet); // 0.05 + 0.25 s
    expect(rms(r!, 0.415, 0.455)).toBeGreaterThan(10 * rms(r!, 0.12, 0.27)); // 0.05 + 1.5 × 0.25 s
    expect(rms(r!, 0.415, 0.455)).toBeGreaterThan(5 * rms(r!, 0.29, 0.33)); // not at the left head's time
  }, 60000);

  it('Low Res: the crusher codebox holds a sample at the rate and rounds it to the bits', async () => {
    const box = {
      id: 'crush1',
      type: 'kit.codebox',
      pos: { x: 0, y: 0 },
      code: CRUSHER,
      values: { bits: 3, rate: 6000 },
      ports: {
        inputs: [
          { id: 'left', type: 'signal' as const },
          { id: 'right', type: 'signal' as const },
          { id: 'bits', type: 'signal' as const },
          { id: 'rate', type: 'signal' as const },
        ],
        outputs: [
          { id: 'left', type: 'signal' as const },
          { id: 'right', type: 'signal' as const },
        ],
      },
    };
    const wire = (from: string, to: string): Intent => {
      const [fn, fp] = from.split('.'),
        [tn, tp] = to.split('.');
      return { op: 'connect', from: { node: fn!, port: fp! }, to: { node: tn!, port: tp! } };
    };
    const doc = applyIntents(
      emptyDocument(),
      [
        { op: 'addNode', node: { id: 'in1', type: 'kit.audioIn', pos: { x: 0, y: 0 } } },
        { op: 'addNode', node: box },
        { op: 'addNode', node: { id: 'out1', type: 'kit.out', pos: { x: 0, y: 0 } } },
        wire('in1.left', 'crush1.left'),
        wire('in1.right', 'crush1.right'),
        wire('crush1.left', 'out1.left'),
        wire('crush1.right', 'out1.right'),
      ],
      catalog,
    ).doc;
    const [l] = await render(doc, { seconds: 0.25, input: testSignal('chords', 0.25, SR) });
    let off = 0,
      changes = 0,
      loud = 0;
    for (let i = 0; i < l!.length; i++) {
      const v = l![i]!;
      off = Math.max(off, Math.abs(v * 4 - Math.round(v * 4))); // 3 bits: steps of 1/4
      if (i && v !== l![i - 1]) changes++;
      if (v !== 0) loud++;
    }
    expect(off).toBeLessThan(1e-6);
    expect(loud).toBeGreaterThan(l!.length / 4);
    expect(changes).toBeLessThanOrEqual(Math.ceil(l!.length / 8) + 1); // 6000 Hz: a new sample every 8
  }, 60000);

  it('Low Res: the landscape has more columns the higher Rate is and more levels the more Bits, a block for each', async () => {
    const scene = await import(
      `data:text/javascript;base64,${Buffer.from(CRUSH_GRID).toString('base64')}`
    );
    expect(scene.grid(1500, 8).columns).toBe(6);
    expect(scene.grid(11025, 8).columns).toBeGreaterThan(6);
    expect(scene.grid(11025, 8).columns).toBeLessThan(40);
    expect(scene.grid(48000, 8).columns).toBe(40);
    // Levels a side: 2^(bits-1), at most 16 drawn.
    expect(scene.grid(11025, 2).levels).toBe(2);
    expect(scene.grid(11025, 4).levels).toBe(8);
    expect(scene.grid(11025, 8).levels).toBe(16);
    /** The shapes filled in the first frame: the first row of blocks and the four towers in front, three faces each. */
    const fills = (rate: number) => {
      let n = 0;
      const ctx = new Proxy(
        {},
        {
          get: (_t, k) =>
            k === 'fill' ? () => n++ : k === 'measureText' ? () => ({ width: 40 }) : () => {},
          set: () => true,
        },
      );
      const values: Record<string, number> = {
        frate: rate,
        fbits: 8,
        fwob: 0.0015,
        fhiss: 0.012,
        ftone: 5200,
      };
      const f = {
        t: 0,
        dt: 1 / 60,
        w: 720,
        h: 452,
        wave: new Float32Array(256).map((_, i) => 0.5 * Math.sin(i / 10)),
        state: {},
        pointer: { x: 0, y: 0, over: false },
        color: () => '#808080',
        value: (id: string) => values[id],
      };
      scene.default.setup(ctx, f);
      scene.default.draw(ctx, f);
      return n;
    };
    expect(fills(1500)).toBe(3 * 6 + 4 * 3);
    expect(fills(48000)).toBe(3 * 40 + 4 * 3);
  });

  /** Correlation of the two sides (1: the same on both). */
  const correlation = ([l, r]: Float32Array[]) => {
    let lr = 0,
      ll = 0,
      rr = 0;
    for (let i = 0; i < l!.length; i++) {
      lr += l![i]! * r![i]!;
      ll += l![i]! ** 2;
      rr += r![i]! ** 2;
    }
    return lr / Math.sqrt(ll * rr);
  };
  /** The control on the plugin wired to a parameter of a part's use (its face). */
  const faceKnob = (doc: PatchDocument, use: string, param: string) =>
    Object.values(doc.edges).find(e => e.to.node === use && e.to.port === param)!.from.node;

  /** Rain Field with only the drops (and, where asked, the wind): thunder and drips quiet. */
  const onlyDrops: Array<[string, string, number]> = [
    ['kthunder', 'value', 0],
    ['kdrips', 'value', 0],
  ];
  it('Rain Field: one Drop part ×16 — Rain makes more drops, Pitch moves them, Width spreads them, Wind brings the far rain', async () => {
    const doc = build('rain');
    expect(doc.nodes.drop1).toMatchObject({ type: 'kit.part', part: 'drop', count: 16 });
    expect(doc.parts.drop!.params.map(p => p.id)).toEqual(['rain', 'pitch', 'splash']);
    expect(
      validate(doc, catalog).issues.filter(i => i.code === 'heavy'),
      'not heavy',
    ).toEqual([]);
    const dry: Array<[string, string, number]> = [
      ...onlyDrops,
      ['kwind', 'value', 0],
      ['kroom', 'value', 0],
    ];
    const play = (values: Array<[string, string, number]>) =>
      render(turned(doc, values), { seconds: 2 });
    const both = (out: Float32Array[]) => Math.hypot(rms(out[0]!, 0.2, 2), rms(out[1]!, 0.2, 2));
    const sparse = both(await play([...dry, [faceKnob(doc, 'drop1', 'rain'), 'value', 1.5]])),
      heavy = both(await play([...dry, [faceKnob(doc, 'drop1', 'rain'), 'value', 14]]));
    note(`rain: level rain1.5 ${sparse.toFixed(4)}, rain14 ${heavy.toFixed(4)}`);
    expect(heavy).toBeGreaterThan(2 * sparse);
    const low = analyse(await play([...dry, [faceKnob(doc, 'drop1', 'pitch'), 'value', 600]]), SR)
      .centroidHz.mean;
    const high = analyse(await play([...dry, [faceKnob(doc, 'drop1', 'pitch'), 'value', 6000]]), SR)
      .centroidHz.mean;
    note(`rain: centroid pitch600 ${low} Hz, pitch6000 ${high} Hz`);
    expect(high).toBeGreaterThan(2 * low);
    const narrow = correlation(await play([...dry, ['kwidth', 'value', 0]])),
      wide = correlation(await play([...dry, ['kwidth', 'value', 1]]));
    note(`rain: L/R correlation width0 ${narrow.toFixed(3)}, width1 ${wide.toFixed(3)}`);
    expect(narrow).toBeGreaterThan(0.98);
    expect(wide).toBeLessThan(0.8);
    const calm = await play(dry),
      windy = await play([...onlyDrops, ['kroom', 'value', 0], ['kwind', 'value', 1]]);
    note(
      `rain: wind0 ${both(calm).toFixed(4)} (centroid ${analyse(calm, SR).centroidHz.mean}), wind1 ${both(windy).toFixed(4)} (centroid ${analyse(windy, SR).centroidHz.mean})`,
    );
    expect(both(windy)).toBeGreaterThan(1.4 * both(calm));
    expect(analyse(windy, SR).centroidHz.mean).toBeLessThan(
      0.7 * analyse(calm, SR).centroidHz.mean,
    ); // the far rain is low
  }, 120000);

  it('Rain Field: every copy falls on its own (its own random numbers): sixteen copies are smoother than one, and their two sides differ', async () => {
    const doc = turned(build('rain'), [...onlyDrops, ['kwind', 'value', 0], ['kroom', 'value', 0]]);
    const crest = (out: Float32Array[]) => {
      let peak = 0;
      for (const s of out[0]!) peak = Math.max(peak, Math.abs(s));
      return peak / rms(out[0]!, 0, 2);
    };
    const many = await render(doc, { seconds: 2 }),
      one = await render(
        applyIntents(doc, [{ op: 'setCount', node: 'drop1', count: 1 }], catalog).doc,
        { seconds: 2 },
      );
    note(
      `rain: crest ×16 ${crest(many).toFixed(1)}, ×1 ${crest(one).toFixed(1)}; correlation ×16 ${correlation(many).toFixed(3)}`,
    );
    expect(crest(one)).toBeGreaterThan(1.3 * crest(many));
    expect(correlation(many)).toBeLessThan(0.9);
  }, 120000);

  it('Septet: one Saw part ×7 per voice — Detune makes the saws beat, Width spreads them, Cutoff darkens', async () => {
    const doc = build('supersaw');
    expect(doc.nodes.saw1).toMatchObject({ type: 'kit.part', part: 'saw', count: 7 });
    expect(doc.parts.saw!.params.map(p => [p.id, p.range])).toEqual([
      ['detune', { min: 0, max: 1, unit: 'st' }],
      ['drift', { min: 0, max: 0.5, unit: 'st' }],
    ]);
    expect(
      validate(doc, catalog).issues.filter(i => i.code === 'heavy'),
      'not heavy',
    ).toEqual([]);
    const held = notes([[57, 0, 1.6]]);
    const play = (values: Array<[string, string, number]>) =>
      render(turned(doc, values), { seconds: 1.6, events: held });
    /** How much the level moves while the note holds (beating), relative to the level. */
    const wobble = (out: Float32Array[]) => {
      const ch = out[0]!,
        w = 960,
        levels: number[] = [];
      for (let i = Math.round(0.4 * SR); i + w < Math.round(1.4 * SR); i += w) {
        let e = 0;
        for (let j = 0; j < w; j++) e += ch[i + j]! ** 2;
        levels.push(Math.sqrt(e / w));
      }
      const mean = levels.reduce((a, b) => a + b, 0) / levels.length;
      return Math.sqrt(levels.reduce((a, b) => a + (b - mean) ** 2, 0) / levels.length) / mean;
    };
    const together = await play([
      [faceKnob(doc, 'saw1', 'detune'), 'value', 0],
      [faceKnob(doc, 'saw1', 'drift'), 'value', 0],
    ]);
    const apart = await play([[faceKnob(doc, 'saw1', 'detune'), 'value', 0.6]]);
    note(
      `supersaw: wobble detune0 ${wobble(together).toFixed(3)}, detune0.6 ${wobble(apart).toFixed(3)}`,
    );
    expect(wobble(apart)).toBeGreaterThan(3 * wobble(together));
    const narrow = correlation(
        await play([
          ['kwidth', 'value', 0],
          ['kspace', 'value', 0],
        ]),
      ),
      wide = correlation(
        await play([
          ['kwidth', 'value', 1],
          ['kspace', 'value', 0],
        ]),
      );
    note(`supersaw: L/R correlation width0 ${narrow.toFixed(3)}, width1 ${wide.toFixed(3)}`);
    expect(narrow).toBeGreaterThan(0.98);
    expect(wide).toBeLessThan(0.7);
    const dark = analyse(
        await play([
          ['kcut', 'value', 200],
          ['kenv', 'value', 0],
        ]),
        SR,
      ).centroidHz.mean,
      bright = analyse(
        await play([
          ['kcut', 'value', 6000],
          ['kenv', 'value', 0],
        ]),
        SR,
      ).centroidHz.mean;
    note(`supersaw: centroid cutoff200 ${dark} Hz, cutoff6000 ${bright} Hz`);
    expect(bright).toBeGreaterThan(3 * dark);
  }, 120000);

  it('Septet: each lane drifts by the number its copy plays with', () => {
    const doc = build('supersaw');
    const lanes = Object.values(doc.ui.elements).find(e => e.kind === 'canvas')!;
    const shown = String(lanes.props?.drift).split(' ').map(Number);
    // What the sound uses: each copy's own Which saw number, through Drift way.
    const flat = flatten(doc, catalog).doc;
    const way = doc.nodes.driftdir1!.values as { scale: number; offset: number };
    const played = Array.from(
      { length: 7 },
      (_, k) => Number(flat.nodes[`saw1_${k}_copy1`]!.config.random) * way.scale + way.offset,
    );
    expect(shown).toHaveLength(7);
    shown.forEach((v, k) => expect(v, `copy ${k + 1}`).toBeCloseTo(played[k]!, 2));
  });

  it("Septet: with Env at 0 its cursor still takes a drag, from the right of Cutoff's line", async () => {
    const lanes = await import(
      `data:text/javascript;base64,${Buffer.from(SAW_LANES).toString('base64')}`
    );
    const values: Record<string, number> = { kcut: 900, kenv: 0, krel: 0.5, kspace: 0.22 };
    const f = {
      state: {},
      value: (id: string) => values[id]!,
      norm: () => 0.5,
      set: (id: string, v: number) => {
        values[id] = v;
      },
      cursor: () => {},
    };
    lanes.default.setup(fakeCanvas(), f);
    /** A drag across the filter band from x. */
    const drag = (x: number, dx: number) => {
      for (const [type, at] of [
        ['down', x],
        ['move', x + dx],
        ['up', x + dx],
      ] as const)
        lanes.default.pointer(
          { type, x: at, y: 480, dx: 0, dy: 0, shift: false, alt: false, meta: false },
          f,
        );
    };
    const a = lanes.fx(900) as number;
    drag(a + 2, 40);
    expect(values.kenv).toBeGreaterThan(0.25);
    expect(values.kcut).toBe(900);
    drag(a - 2, 40); // left of the line: Cutoff
    expect(values.kcut).toBeGreaterThan(900);
  });

  it("Septet: Env's cursor moves as far as the hand does, so pressing it where it is held at the band's end keeps Env", async () => {
    const lanes = await import(
      `data:text/javascript;base64,${Buffer.from(SAW_LANES).toString('base64')}`
    );
    // Cutoff 8 kHz opened 2.5 octaves is past the band's 20 kHz end, so the cursor stands at the end.
    const values: Record<string, number> = { kcut: 8000, kenv: 2.5, krel: 0.5, kspace: 0.22 };
    const f = {
      state: {},
      value: (id: string) => values[id]!,
      norm: () => 0.5,
      set: (id: string, v: number) => {
        values[id] = v;
      },
      cursor: () => {},
    };
    lanes.default.setup(fakeCanvas(), f);
    const end = lanes.fx(20000) as number;
    expect(lanes.fx(8000 * 2 ** 2.5)).toBe(end);
    const at = (type: string, x: number) =>
      lanes.default.pointer(
        { type, x, y: 480, dx: 0, dy: 0, shift: false, alt: false, meta: false },
        f,
      );
    at('down', end - 1);
    at('up', end - 1);
    expect(values.kenv).toBe(2.5);
    // Dragged left, it comes down from 2.5 by as many octaves as the hand moves across the band.
    at('down', end - 1);
    at('move', end - 41);
    at('up', end - 41);
    expect(values.kenv).toBeCloseTo(
      2.5 - (40 / (end - (lanes.fx(60) as number))) * Math.log2(20000 / 60),
      6,
    );
    expect(values.kcut).toBe(8000);
  });

  it('Contour: a handle moves as far as the hand does (a press keeps it, even held at the edge), the dot is taken from the right where it meets the summit, and a press elsewhere brings the summit to the hand', async () => {
    const doc = build('acid');
    const el = Object.values(doc.ui.elements).find(e => e.name === 'The filter’s hill')!;
    const hill = await import(
      `data:text/javascript;base64,${Buffer.from(FILTER_HILL).toString('base64')}`
    );
    const values: Record<string, number> = {};
    const f = {
      w: el.rect.w,
      h: el.rect.h,
      state: {},
      value: (id: string) => values[id]!,
      set: (id: string, v: number) => {
        values[id] = v;
      },
      cursor: () => {},
    };
    hill.default.setup(fakeCanvas(), f);
    const marks = () => hill.marks(f) as { px: number; ox: number; y: number };
    const drag = (x: number, y: number, dx: number, dy: number) => {
      for (const [type, mx, my] of [
        ['down', x, y],
        ['move', x + dx, y + dy],
        ['up', x + dx, y + dy],
      ] as const)
        hill.default.pointer(
          { type, x: mx, y: my, dx: 0, dy: 0, shift: false, alt: false, meta: false },
          f,
        );
    };
    // Cutoff 4 kHz opened 5 or 6 octaves: either way the dot is held at the graph's right end.
    Object.assign(values, { kcut: 4000, kres: 0.72, kenv: 5 });
    const held = marks().ox;
    Object.assign(values, { kcut: 4000, kres: 0.72, kenv: 6 });
    let m = marks();
    expect(m.ox).toBe(held);
    expect(m.ox).toBeGreaterThan(el.rect.w - 20);
    drag(m.ox, m.y, 0, 0);
    expect(values).toEqual({ kcut: 4000, kres: 0.72, kenv: 6 });
    drag(m.ox, m.y, -20, 0);
    expect(values.kenv).toBeCloseTo(6 - (Math.log2(hill.HI / hill.LO) * 20) / el.rect.w, 6);
    expect([values.kcut, values.kres]).toEqual([4000, 0.72]);
    // Resonance 0.98 peaks above the graph's top: pressing the summit keeps it.
    Object.assign(values, { kcut: 900, kres: 0.98, kenv: 2 });
    m = marks();
    drag(m.px, m.y, 0, 0);
    expect(values).toEqual({ kcut: 900, kres: 0.98, kenv: 2 });
    // With Sweep at 0 the dot sits on the summit: just right of it takes the dot, just left the summit.
    Object.assign(values, { kcut: 900, kres: 0.7, kenv: 0 });
    m = marks();
    expect(m.ox).toBe(m.px);
    drag(m.px + 3, m.y, 30, 0);
    expect(values.kenv).toBeCloseTo((Math.log2(hill.HI / hill.LO) * 30) / el.rect.w, 6);
    expect(values.kcut).toBe(900);
    values.kenv = 0;
    drag(m.px - 3, m.y, 30, 0);
    expect(values.kcut).toBeGreaterThan(1000);
    expect(values.kenv).toBe(0);
    // A press away from both handles brings the summit to the hand.
    drag(200, 123, 0, 0);
    m = marks();
    expect(m.px).toBeCloseTo(200, 0);
    expect(m.y).toBeCloseTo(123, 0);
  });

  it("Septet: Attack, Filter decay and Resonance are in the patch as before and dragged on the display: the rise, the dashed knee, Cutoff's cursor up and down", async () => {
    const doc = build('supersaw');
    const wired = (id: string) =>
      Object.values(doc.edges)
        .filter(e => e.from.node === id)
        .map(e => `${e.to.node}.${e.to.port}`)
        .sort();
    expect(wired('katt')).toEqual(['aenv1.attack']);
    expect(wired('kdec')).toEqual(['fenv1.decay']);
    expect(wired('kres')).toEqual(['lpl1.resonance', 'lpr1.resonance']);
    const lanes = await import(
      `data:text/javascript;base64,${Buffer.from(SAW_LANES).toString('base64')}`
    );
    const values: Record<string, number> = {};
    for (const n of Object.values(doc.nodes))
      if (typeof n.values?.value === 'number') values[n.id] = n.values.value;
    const ranges: Record<string, [number, number]> = { kres: [0.5, 6] };
    const f = {
      state: {},
      value: (id: string) => values[id]!,
      norm: (id: string) => {
        const [lo, hi] = ranges[id] ?? [0, 1];
        return (values[id]! - lo) / (hi - lo);
      },
      set: (id: string, v: number) => {
        values[id] = v;
      },
      setNorm: (id: string, n: number) => {
        const [lo, hi] = ranges[id] ?? [0, 1];
        values[id] = lo + n * (hi - lo);
      },
      cursor: () => {},
    };
    lanes.default.setup(fakeCanvas(), f);
    const drag = (x: number, y: number, dx: number, dy: number) => {
      for (const [type, mx, my] of [
        ['down', x, y],
        ['move', x + dx, y + dy],
        ['up', x + dx, y + dy],
      ] as const)
        lanes.default.pointer(
          { type, x: mx, y: my, dx: 0, dy: 0, shift: false, alt: false, meta: false },
          f,
        );
    };
    const was = { ...values };
    drag(lanes.attX(was.katt!) - 4, 410, 30, 0); // the rise, across
    expect(values.katt!).toBeGreaterThan(was.katt!);
    drag(lanes.decX(was.kdec!), lanes.fy(0.4), -30, 0); // the dashed knee, across
    expect(values.kdec!).toBeLessThan(was.kdec!);
    drag(lanes.fx(was.kcut!) - 2, 480, 0, -40); // Cutoff's cursor, up
    expect(values.kres!).toBeGreaterThan(was.kres!);
    expect([values.kcut, values.krel, values.kspace]).toEqual([was.kcut, was.krel, was.kspace]);
  });

  it('Rain Field: each sound sits where it is placed: to one side it is louder on that side, and nearer is louder', async () => {
    const doc = turned(build('rain'), [
      ['kdrops', 'value', 0],
      ...onlyDrops,
      ['kroom', 'value', 0],
      ['kwind', 'value', 1],
    ]);
    expect(
      Object.values(doc.nodes).filter(n => n.type === 'kit.part' && n.part === 'place'),
    ).toHaveLength(4);
    const sides = async (pan: number) => {
      const [l, r] = await render(turned(doc, [['kwindpan', 'value', pan]]), { seconds: 1.5 });
      return rms(l!, 0.2, 1.5) / rms(r!, 0.2, 1.5);
    };
    const left = await sides(-0.8),
      middle = await sides(0),
      right = await sides(0.8);
    note(
      `rain: wind L/R pan-0.8 ${left.toFixed(2)}, pan0 ${middle.toFixed(2)}, pan0.8 ${right.toFixed(2)}`,
    );
    expect(left).toBeGreaterThan(3);
    expect(middle).toBeCloseTo(1, 1);
    expect(right).toBeLessThan(1 / 3);
    const level = async (near: number) => {
      const out = await render(turned(doc, [['kwind', 'value', near]]), { seconds: 1.5 });
      return Math.hypot(rms(out[0]!, 0.2, 1.5), rms(out[1]!, 0.2, 1.5));
    };
    const far = await level(0.25),
      close = await level(0.9);
    note(`rain: wind level near0.25 ${far.toFixed(4)}, near0.9 ${close.toFixed(4)}`);
    expect(close).toBeGreaterThan(3 * far);
  }, 120000);

  it('Rain Field: a sound behind you is duller, most when straight behind, and the same at the sides', async () => {
    const doc = turned(build('rain'), [
      ['kdrops', 'value', 0.9],
      ['kwind', 'value', 0],
      ...onlyDrops,
      ['kroom', 'value', 0],
    ]);
    expect(doc.parts.place!.params.map(p => p.id)).toEqual(['level', 'pan', 'behind']);
    const centroid = async (pan: number, behind: boolean) =>
      analyse(
        await render(
          turned(doc, [
            ['kdropspan', 'value', pan],
            ['kdropsback', 'value', behind],
          ]),
          { seconds: 2 },
        ),
        SR,
      ).centroidHz.mean;
    const ahead = await centroid(0, false),
      behind = await centroid(0, true),
      sideAhead = await centroid(1, false),
      sideBehind = await centroid(1, true);
    note(
      `rain: drops centroid ahead ${ahead} Hz, behind ${behind} Hz; at the side ${sideAhead} / ${sideBehind} Hz`,
    );
    expect(behind).toBeLessThan(0.75 * ahead);
    expect(sideBehind).toBeCloseTo(sideAhead, 0);
  }, 120000);

  it('Rain Field: where a sound sits is all in the work: dragged behind you its Behind switch turns on, and a field started over finds it there', async () => {
    const doc = build('rain');
    const values: Record<string, number | boolean> = {};
    for (const n of Object.values(doc.nodes))
      if (n.type === 'ui.knob' || n.type === 'ui.toggle')
        values[n.id] = n.values.value as number | boolean;
    const mod = await import(
      `data:text/javascript;base64,${Buffer.from(FIELD).toString('base64')}`
    );
    const field = mod.default;
    const el = Object.values(doc.ui.elements).find(e => e.kind === 'canvas')!;
    /** Where a point on the ground (x right, z ahead, the edge of hearing at 1) is on the field. */
    const ground = (x: number, z: number) =>
      mod.ground(x, z, el.rect.w, el.rect.h) as { x: number; y: number };
    let cursor = '';
    const start = () => {
      const f = {
        w: el.rect.w,
        h: el.rect.h,
        state: {},
        value: (id: string) => values[id] as number,
        on: (id: string) => values[id] === true,
        set: (id: string, v: number | boolean) => {
          values[id] = v;
        },
        cursor: (c: string) => {
          cursor = c;
        },
      };
      field.setup(fakeCanvas(), f);
      return f;
    };
    const at = (f: unknown, type: string, x: number, y: number) =>
      field.pointer({ type, x, y, dx: 0, dy: 0, shift: false, alt: false, meta: false }, f);
    // The drops start ahead of you, a little to the left; drag their cloud to half way behind you.
    expect(values.kdropsback).toBe(false);
    const r0 = 1 - (values.kdrops as number),
      pan0 = values.kdropspan as number;
    const from = ground(r0 * pan0, r0 * Math.sqrt(1 - pan0 * pan0)),
      behind = ground(0, -0.5),
      ahead = ground(0, 0.5);
    const f = start();
    at(f, 'down', from.x, from.y);
    at(f, 'move', behind.x, behind.y);
    at(f, 'up', behind.x, behind.y);
    expect(values.kdropsback).toBe(true);
    expect(values.kdrops).toBeCloseTo(0.5, 5);
    expect(values.kdropspan).toBeCloseTo(0, 5);
    // A field started over (the work opened again) knows only the work: the cloud is behind you.
    const again = start();
    at(again, 'move', behind.x, behind.y);
    expect(cursor).toBe('grab');
    // Undoing the switch puts it in front again; behind you there is only ground (it sets each drop).
    values.kdropsback = false;
    at(again, 'move', behind.x, behind.y);
    expect(cursor).toBe('move');
    at(again, 'move', ahead.x, ahead.y);
    expect(cursor).toBe('grab');
    // The rest is set by dragging the puddle, the open ground and the trees, each up and down or across
    // (a drag keeps to the way it starts).
    const drag = (p: { x: number; y: number }, dx: number, dy: number) => {
      at(again, 'down', p.x, p.y);
      at(again, 'move', p.x + dx, p.y + dy);
      at(again, 'up', p.x + dx, p.y + dy);
    };
    const was = { ...values };
    drag(ground(0.12, 0.5), 0, -40); // the drops' puddle, up: more rain
    drag(ground(0.12, 0.5), -40, 0); // and across: narrower
    expect([values.knob1! > was.knob1!, values.kwidth! < was.kwidth!]).toEqual([true, true]);
    drag(ground(-0.5, -0.3), 40, 0); // the open ground, across: each drop higher
    drag(ground(-0.5, -0.3), 0, -40); // and up: a longer splash
    expect([values.knob2! > was.knob2!, values.knob3! > was.knob3!]).toEqual([true, true]);
    drag(ground(1.1, 0), 0, -40); // a tree at the edge, up: more room
    expect(values.kroom! > was.kroom!).toBe(true);
    // Each drag moved only its own setting.
    expect(values.kdrops).toBeCloseTo(0.5, 5);
  });

  it('Rain Field: at its narrowest the drops’ puddle still reaches past its cloud and takes a drag, and its cloud the rest', async () => {
    const doc = build('rain');
    const values: Record<string, number | boolean> = {};
    for (const n of Object.values(doc.nodes))
      if (n.type === 'ui.knob' || n.type === 'ui.toggle')
        values[n.id] = n.values.value as number | boolean;
    values.kwidth = 0;
    const mod = await import(
      `data:text/javascript;base64,${Buffer.from(FIELD).toString('base64')}`
    );
    const el = Object.values(doc.ui.elements).find(e => e.kind === 'canvas')!;
    const f = {
      w: el.rect.w,
      h: el.rect.h,
      state: {},
      value: (id: string) => values[id] as number,
      on: (id: string) => values[id] === true,
      set: (id: string, v: number | boolean) => {
        values[id] = v;
      },
      cursor: () => {},
    };
    mod.default.setup(fakeCanvas(), f);
    const r = 1 - (values.kdrops as number),
      pan = values.kdropspan as number;
    const p = mod.ground(r * pan, r * Math.sqrt(1 - pan * pan), el.rect.w, el.rect.h) as {
      x: number;
      y: number;
    };
    const drag = (x: number, y: number, dx: number, dy: number) => {
      for (const [type, mx, my] of [
        ['down', x, y],
        ['move', x + dx, y + dy],
        ['up', x + dx, y + dy],
      ] as const)
        mod.default.pointer(
          { type, x: mx, y: my, dx: 0, dy: 0, shift: false, alt: false, meta: false },
          f,
        );
    };
    const was = { ...values };
    // Its cloud covers 20 px each side of the spot: 25 px out on either side is the puddle.
    drag(p.x + 25, p.y, 0, -40);
    drag(p.x - 25, p.y, 40, 0);
    expect([values.knob1! > was.knob1!, values.kwidth! > 0]).toEqual([true, true]);
    expect([values.kdrops, values.kdropspan]).toEqual([was.kdrops, was.kdropspan]);
    // The cloud itself still moves the sound.
    drag(p.x, p.y, 0, 30);
    expect(values.kdrops).not.toBe(was.kdrops);
  });

  it('Tonic: plays by itself; Sa moves the whole drone, Jawari brightens the buzz', async () => {
    const doc = build('tonic');
    expect(doc.nodes.string1).toMatchObject({ type: 'kit.part', part: 'string', count: 4 });
    const centroid = async (values: Array<[string, string, number]>) =>
      analyse(await render(turned(doc, values), { seconds: 3 }), SR).centroidHz.mean;
    const low = await centroid([
        ['ksa', 'value', 48],
        ['kjaw', 'value', 0],
      ]),
      high = await centroid([
        ['ksa', 'value', 55],
        ['kjaw', 'value', 0],
      ]);
    note(`tonic: centroid Sa48 ${low} Hz, Sa55 ${high} Hz`);
    expect(high).toBeGreaterThan(1.25 * low);
    const plain = await centroid([['kjaw', 'value', 0]]),
      buzzing = await centroid([['kjaw', 'value', 6]]);
    note(`tonic: centroid jawari0 ${plain} Hz, jawari6 ${buzzing} Hz`);
    expect(buzzing).toBeGreaterThan(1.3 * plain);
  }, 120000);

  it('Shape Drums: the beat plays along only while it is on', async () => {
    const level = async (on: boolean) => {
      const out = await render(turned(build('toy'), [['tbeat', 'value', on]]), { seconds: 2 });
      return Math.hypot(rms(out[0]!, 0, 2), rms(out[1]!, 0, 2));
    };
    const off = await level(false),
      on = await level(true);
    note(`toy: no keys, beat off ${off.toExponential(2)}, beat on ${on.toExponential(2)}`);
    expect(on).toBeGreaterThan(1e-3);
    expect(off).toBeLessThan(on / 100);
  }, 60000);

  it('Tide Bells: plays by itself; low tide rings the low bells, high tide the high ones', async () => {
    const doc = build('tide');
    expect(doc.nodes.bell1).toMatchObject({ type: 'kit.part', part: 'bell', count: 6 });
    // Only the bells, a wave every 5 s, after the sea has come in (8 s).
    const bells = async (hour: number) =>
      analyse(
        slice(
          await render(
            turned(doc, [
              ['khour', 'value', hour],
              ['ksea', 'value', 0],
              ['kbay', 'value', 0],
              ['kwaves', 'value', 12],
            ]),
            { seconds: 14 },
          ),
          9,
          14,
        ),
        SR,
      ).centroidHz.mean;
    const low = await bells(9.5),
      high = await bells(15.5);
    note(`tide: bells centroid low tide ${low} Hz, high tide ${high} Hz`);
    expect(high).toBeGreaterThan(1.3 * low);
  }, 120000);

  it('Tide Bells: the hour is dragged along the tide board or by the sun, Bells on a bell, Bay on a headland, Sea and Waves on the water', async () => {
    const doc = build('tide');
    const shore = Object.values(doc.ui.elements).find(e => e.kind === 'canvas')!;
    const code = await import(
      `data:text/javascript;base64,${Buffer.from(TIDE_SHORE).toString('base64')}`
    );
    const values: Record<string, number> = {
      khour: 14.5,
      kbells: 0.5,
      kbay: 0.35,
      ksea: 0.6,
      kwaves: 6.5,
    };
    const f = {
      w: shore.rect.w,
      h: shore.rect.h,
      props: shore.props,
      state: {},
      value: (id: string) => values[id]!,
      set: (id: string, v: number) => {
        values[id] = v;
      },
      cursor: () => {},
    };
    code.default.setup(fakeCanvas(), f);
    /** A drag from (x, y) by (dx, dy). */
    const drag = (x: number, y: number, dx: number, dy: number) => {
      for (const [type, k] of [
        ['down', 0],
        ['move', 0.5],
        ['move', 1],
        ['up', 1],
      ] as const)
        code.default.pointer(
          {
            type,
            x: x + dx * k,
            y: y + dy * k,
            dx: 0,
            dy: 0,
            shift: false,
            alt: false,
            meta: false,
          },
          f,
        );
    };
    const L = code.layout(f);
    // Along the tide board's chart of the day: the hour under the hand.
    drag(L.CX(12), L.C.y0 + 12, 0, 0);
    expect(values.khour).toBeCloseTo(12, 1);
    // The sun stands at the hour: dragged across, it carries the hour along.
    const sun = code.skyBody(12, L);
    drag(sun.x, sun.y, L.SX(18) - L.SX(12), 0);
    expect(values.khour).toBeCloseTo(18, 1);
    // The rest of the board takes no drag.
    drag(L.B.x0 + 20, L.B.y0 + 50, 0, -40);
    expect(values).toMatchObject({ khour: 18, kbells: 0.5 });
    // The third bell's post, up: Bells rises; nothing else moves.
    drag(L.PX(2), L.TOP(2) + 20, 0, -40);
    expect(values.kbells).toBeCloseTo(0.75, 2);
    // The left headland, up: Bay rises (the bay closes in).
    drag(40, 205, 0, -32);
    expect(values.kbay).toBeCloseTo(0.55, 2);
    // The open water between the board and the first post: up for Sea, across for Waves.
    drag(244, 500, 0, -32);
    expect(values.ksea).toBeCloseTo(0.8, 2);
    drag(244, 500, 64, 0);
    expect(values.kwaves).toBeCloseTo(6.5 + 0.4 * 9, 2);
    expect(values.kbells).toBeCloseTo(0.75, 2);
    expect(values.kbay).toBeCloseTo(0.55, 2);
    expect(values.khour).toBeCloseTo(18, 1);
    // The canvas starts a pixel above and left of the plugin, edge to edge, and is the plugin's only part.
    expect(shore.rect).toMatchObject({ x: -1, y: -1 });
    expect(Object.values(doc.nodes).filter(n => n.panel)).toEqual([]);
  });

  it('Exhale: plays by itself and breathes: the level swells and settles with each breath, as deep as Depth says', async () => {
    const swing = async (depth: number) => {
      const out = await render(
        turned(build('breath'), [
          ['kbpm', 'value', 10],
          ['kdepth', 'value', depth],
          ['kspace', 'value', 0],
        ]),
        { seconds: 12 },
      );
      const levels: number[] = [];
      for (let t = 2; t + 0.5 <= 12; t += 0.5) levels.push(rms(out[0]!, t, t + 0.5));
      return Math.max(...levels) / Math.min(...levels);
    };
    const deep = await swing(1),
      still = await swing(0);
    note(`breath: level max/min depth1 ${deep.toFixed(2)}, depth0 ${still.toFixed(2)}`);
    expect(deep).toBeGreaterThan(4);
    // At Depth 0 only the slight beating of the detuned copies is left.
    expect(still).toBeLessThan(2);
  }, 120000);
});
