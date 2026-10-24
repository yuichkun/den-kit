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
import { evaluate } from '../../src/sound/compile/evaluate.ts';
import { WORKS, lookIntents } from '../../src/screen/showcase/index.ts';
import { CRUSHER } from '../../src/screen/showcase/lofi.ts';
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
/** A phrase that suits the work: a bass line, a held chord, a tune high up, or hits on the pads. */
function phrase(id: string): MidiEvent[] {
  if (id === 'pad') return notes([48, 55, 60, 64].map(n => [n, 0, 1.6]));
  if (id === 'musicbox') return notes([72, 76, 79, 84, 79, 76].map((n, i) => [n, i * 0.25, 0.12]));
  const list =
    id === 'toy'
      ? [48, 50, 52, 55, 57, 60]
      : id === 'acid'
        ? [36, 36, 48, 39, 36, 43]
        : [48, 55, 60, 64];
  return notes(list.map((n, i) => [n, i * 0.25, 0.18]));
}
/** What an effect is heard on: a guitar for the fuzz, drums for the echoes, chords otherwise. */
const inputFor = (id: string) =>
  id === 'fuzz' ? 'guitar' : id === 'tapeecho' || id === 'space' ? 'drums' : 'chords';

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
    const pad = WORKS.find(w => w.id === 'pad')!.build(catalog);
    const r = applyIntents(acid, lookIntents(acid, pad), catalog);
    expect(Object.keys(assetsOf(r.doc.files))).toContain('assets/den-kit/sunset-sky.jpg');
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
      expect(placed.length).toBeGreaterThan(0);
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
        expect(
          readFileSync('public/showcase/SOURCES.md', 'utf8'),
          `${a.id} listed in SOURCES.md`,
        ).toContain(`\`${a.url!.slice('/showcase/'.length)}\``);
      }
    });
  }
});

describe('each work does what its controls say', () => {
  const build = (id: string) => WORKS.find(w => w.id === id)!.build(catalog);

  it('Afterglow: across the XY pad is brightness, up is sway', async () => {
    const chord = notes([48, 55, 60, 64].map(n => [n, 0, 3.8]));
    const centroid = async (x: number, y: number) =>
      analyse(
        await render(
          turned(build('pad'), [
            ['xy1', 'x', x],
            ['xy1', 'y', y],
          ]),
          { seconds: 4, events: chord },
        ),
        SR,
      ).centroidHz;
    const dark = await centroid(0.15, 0),
      bright = await centroid(0.9, 0);
    note(`pad: centroid x0.15 ${dark.mean} Hz, x0.9 ${bright.mean} Hz`);
    expect(bright.mean).toBeGreaterThan(dark.mean * 1.8);
    const still = await centroid(0.5, 0),
      swaying = await centroid(0.5, 1);
    note(
      `pad: centroid range y0 ${still.min}–${still.max} Hz, y1 ${swaying.min}–${swaying.max} Hz`,
    );
    expect(swaying.max / swaying.min).toBeGreaterThan(1.5 * (still.max / still.min));
  }, 60000);

  it('Lullaby Box: Ring lets a tapped note ring on; Shine brightens the strike', async () => {
    const tap = notes([[76, 0, 0.08]]);
    const tail = async (ring: number) => {
      const out = await render(turned(build('musicbox'), [['kring', 'value', ring]]), {
        seconds: 2,
        events: tap,
      });
      return rms(out[0]!, 1.2, 1.8);
    };
    const short = await tail(0.3),
      long = await tail(4);
    note(`musicbox: tail rms ring0.3 ${short.toExponential(2)}, ring4 ${long.toExponential(2)}`);
    expect(long).toBeGreaterThan(8 * short);
    const strike = async (shine: number) =>
      analyse(
        slice(
          await render(turned(build('musicbox'), [['kshine', 'value', shine]]), {
            seconds: 0.5,
            events: tap,
          }),
          0,
          0.3,
        ),
        SR,
      ).centroidHz.mean;
    const plain = await strike(0),
      shiny = await strike(10);
    note(`musicbox: strike centroid shine0 ${plain} Hz, shine10 ${shiny} Hz`);
    expect(shiny).toBeGreaterThan(2 * plain);
  }, 60000);

  it('Reel Echo: echoes come back at the repeat rate, the second head 1.5× later', async () => {
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

  it('Side B: the crusher codebox holds a sample at the rate and rounds it to the bits', async () => {
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

  it('Rainfall: one Drop part ×16 — Rain makes more drops, Pitch moves them, Width spreads them, Wind brings the far rain', async () => {
    const doc = build('rain');
    expect(doc.nodes.drop1).toMatchObject({ type: 'kit.part', part: 'drop', count: 16 });
    expect(doc.parts.drop!.params.map(p => p.id)).toEqual(['rain', 'pitch', 'splash']);
    expect(
      validate(doc, catalog).issues.filter(i => i.code === 'heavy'),
      'not heavy',
    ).toEqual([]);
    const dry: Array<[string, string, number]> = [
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
      windy = await play([
        ['kroom', 'value', 0],
        ['kwind', 'value', 1],
      ]);
    note(
      `rain: wind0 ${both(calm).toFixed(4)} (centroid ${analyse(calm, SR).centroidHz.mean}), wind1 ${both(windy).toFixed(4)} (centroid ${analyse(windy, SR).centroidHz.mean})`,
    );
    expect(both(windy)).toBeGreaterThan(1.4 * both(calm));
    expect(analyse(windy, SR).centroidHz.mean).toBeLessThan(
      0.7 * analyse(calm, SR).centroidHz.mean,
    ); // the far rain is low
  }, 120000);

  it('Rainfall: every copy falls on its own (its own random numbers): sixteen copies are smoother than one, and their two sides differ', async () => {
    const doc = turned(build('rain'), [
      ['kwind', 'value', 0],
      ['kroom', 'value', 0],
    ]);
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

  it('Supersaw: one Saw part ×7 per voice — Detune makes the saws beat, Width spreads them, Cutoff darkens', async () => {
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

  it('Nebula: the sky rings on long after the sound stops, and Sky and Echoes set how much', async () => {
    const input = testSignal('drums', 4, SR).map(c => {
      c.fill(0, SR);
      return c;
    }); // one second of drums, then silence
    const tailOf = async (doc: PatchDocument) => {
      const out = await render(doc, { seconds: 4, input });
      return Math.max(rms(out[0]!, 2.5, 3.5), rms(out[1]!, 2.5, 3.5));
    };
    const full = await tailOf(build('space')),
      dry = await tailOf(
        turned(build('space'), [
          ['ksky', 'value', 0],
          ['kecho', 'value', 0],
        ]),
      );
    note(`space: tail rms full ${full.toExponential(2)}, dry ${dry.toExponential(2)}`);
    expect(20 * Math.log10(full)).toBeGreaterThan(-50);
    expect(full).toBeGreaterThan(10 * dry);
  }, 60000);
});
