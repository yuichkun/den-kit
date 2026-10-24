// Audio assets reach the sound, with the real den blocks, rendered offline and
// checked against the samples that were sent: a sampler plays its sound on each
// note, a codebox reads an asset's audio and bytes through @den-kit/assets, and
// pointing a sampler at another sound does not change the program.
import { beforeAll, describe, expect, it } from 'vite-plus/test';
import { renderOffline } from '@unworklet/offline';
import { catalog } from '../../src/sound/blocks/index.ts';
import { currentAssets, generate } from '../../src/sound/codegen.ts';
import { evaluate } from '../../src/sound/compile/evaluate.ts';
import { sha256 } from '../../src/work/files.ts';
import { applyIntents, type Intent } from '../../src/work/ops.ts';
import { emptyDocument, type PatchDocument } from '../../src/work/schema.ts';
import { loadRegistry } from '../helpers/registry.ts';

let registry: Record<string, unknown>;
beforeAll(async () => {
  registry = await loadRegistry();
});

const wire = (a: string, b: string): Intent => ({
  op: 'connect',
  from: { node: a.split('.')[0]!, port: a.split('.')[1]! },
  to: { node: b.split('.')[0]!, port: b.split('.')[1]! },
});
async function asset(path: string, mime: string): Promise<Intent> {
  const bytes = new TextEncoder().encode(path);
  return {
    op: 'addAsset',
    asset: { id: path, name: path.slice(7), mime, bytes: bytes.length, hash: await sha256(bytes) },
  };
}
const params = (values: Record<string, number>) =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, [v]]));
/** Samples that never cross zero, so the first one played is easy to find. */
const ramp = (n: number, from: number, to: number) =>
  new Float32Array(n).map((_, i) => from + ((to - from) * i) / n);

async function work(intents: Intent[]): Promise<PatchDocument> {
  return applyIntents(
    emptyDocument('t', 't'),
    [
      await asset('assets/tone.wav', 'audio/wav'),
      await asset('assets/other.wav', 'audio/wav'),
      await asset('assets/table.bin', 'application/octet-stream'),
      ...intents,
    ],
    catalog,
  ).doc;
}

describe('a sampler plays an audio asset', () => {
  async function samplerWork() {
    return work([
      {
        op: 'addNode',
        node: {
          id: 'voice1',
          type: 'kit.voiceIn',
          config: { mode: 'poly', capacity: 2, heldCapacity: 4 },
        },
      },
      {
        op: 'addNode',
        node: { id: 'sampler1', type: 'den.samplePlayer', config: { sound: 'assets/tone.wav' } },
      },
      { op: 'addNode', node: { id: 'vca1', type: 'kit.mul' } },
      { op: 'addNode', node: { id: 'mix1', type: 'kit.voiceMix' } },
      { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
      wire('sampler1.out', 'vca1.a'),
      wire('voice1.velocity', 'vca1.b'),
      wire('vca1.out', 'mix1.in'),
      wire('mix1.out', 'out1.left'),
    ]);
  }

  it('each note plays the samples it was sent, from the start', async () => {
    const doc = await samplerWork();
    const g = generate(doc, catalog);
    expect(g.issues.filter(i => i.severity === 'error')).toEqual([]);
    expect(currentAssets(doc, catalog, g)).toEqual([
      {
        slot: { event: 'kitAsset0', kind: 'mono', node: 'sampler1', config: 'sound' },
        path: 'assets/tone.wav',
      },
    ]);
    const sound = ramp(4000, 0.25, 0.75);
    const { processor } = evaluate(g.source, registry);
    const result = await renderOffline(processor, {
      sampleRate: 48000,
      duration: 0.12,
      params: params(g.values),
      messages: [{ name: 'kitAsset0', payload: { data: sound }, atQuantum: 0 }],
      events: [
        {
          name: 'midi',
          atSample: 512,
          payload: { type: 'noteOn', note: 60, velocity: 127, channel: 0 },
        },
      ],
    });
    const out = result.outputs.main![0]!;
    const start = out.findIndex(s => Math.abs(s) > 1e-6);
    expect(start).toBeGreaterThanOrEqual(512);
    expect(start).toBeLessThan(512 + 4);
    for (let k = 0; k < 4000; k++) expect(out[start + k]).toBeCloseTo(sound[k]!, 5);
    // One-shot: after the sound it is silent.
    expect(out[start + 4100]).toBe(0);
  });

  it('without samples it is silent, and pointing it at another sound does not change the program', async () => {
    const doc = await samplerWork();
    const g = generate(doc, catalog);
    const { processor } = evaluate(g.source, registry);
    const result = await renderOffline(processor, {
      sampleRate: 48000,
      duration: 0.05,
      params: params(g.values),
      events: [
        {
          name: 'midi',
          atSample: 0,
          payload: { type: 'noteOn', note: 60, velocity: 127, channel: 0 },
        },
      ],
    });
    expect(result.outputs.main![0]!.every(s => s === 0)).toBe(true);
    const other = applyIntents(
      doc,
      [{ op: 'setConfig', node: 'sampler1', key: 'sound', value: 'assets/other.wav' }],
      catalog,
    ).doc;
    const g2 = generate(other, catalog);
    expect(g2.hash).toBe(g.hash);
    expect(currentAssets(other, catalog, g2)[0]!.path).toBe('assets/other.wav');
  });
});

describe('a codebox reads assets through @den-kit/assets', () => {
  const code = `import { defineSubgraph, f32, i32, state, type Node } from '@unworklet/core';
import { audio, bytes } from '@den-kit/assets';

export default defineSubgraph((config: { sampleRate: number }) => {
  const tone = audio('assets/tone.wav');
  const table = bytes('assets/table.bin');
  const position = state.f64(0).named('position');
  return {
    tick(i: { in: Node<'f32'> }) {
      const p = position.read();
      position.write(p.add(1));
      return { out: tone.read(1, p).add(f32(table.at(i32(1))).mul(0.001)) };
    },
  };
});
`;

  it('reads the channel of the audio and the bytes it was sent', async () => {
    const doc = await work([
      { op: 'addNode', node: { id: 'box1', type: 'kit.codebox', code } },
      { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
      wire('box1.out', 'out1.left'),
    ]);
    const g = generate(doc, catalog);
    expect(g.issues.filter(i => i.severity === 'error')).toEqual([]);
    expect(g.assets).toEqual([
      { event: 'kitAsset0', kind: 'left', path: 'assets/tone.wav' },
      { event: 'kitAsset1', kind: 'right', path: 'assets/tone.wav' },
      { event: 'kitAsset2', kind: 'bytes', path: 'assets/table.bin' },
    ]);
    const left = ramp(2000, -0.5, -0.25);
    const right = ramp(2000, 0.25, 0.5);
    const table = new Uint8Array([9, 200, 7]);
    const { processor } = evaluate(g.source, registry);
    const result = await renderOffline(processor, {
      sampleRate: 48000,
      duration: 0.05,
      params: params(g.values),
      messages: [
        { name: 'kitAsset0', payload: { data: left }, atQuantum: 0 },
        { name: 'kitAsset1', payload: { data: right }, atQuantum: 0 },
        { name: 'kitAsset2', payload: { data: table, length: table.length }, atQuantum: 0 },
      ],
    });
    const out = result.outputs.main![0]!;
    for (let k = 0; k < 2000; k++) expect(out[k]).toBeCloseTo(right[k]! + 0.2, 5);
    // Past the end of the sound it reads 0, and the byte is still there.
    expect(out[2100]).toBeCloseTo(0.2, 5);
  });
});
