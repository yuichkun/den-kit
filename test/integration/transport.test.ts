import { beforeAll, expect, it } from 'vite-plus/test';
import { renderOffline } from '@unworklet/offline';
import { catalog } from '../../src/sound/blocks/index.ts';
import { generate } from '../../src/sound/codegen.ts';
import { evaluate } from '../../src/sound/compile/evaluate.ts';
import { applyIntents, type Intent } from '../../src/work/ops.ts';
import { emptyDocument } from '../../src/work/schema.ts';
import { loadRegistry } from '../helpers/registry.ts';

let registry: Record<string, unknown>;
beforeAll(async () => {
  registry = await loadRegistry();
});

const wire = (port: string, to: string): Intent => ({
  op: 'connect',
  from: { node: 'clock1', port },
  to: { node: 'out1', port: to },
});

it('renders the live clock channels through a compiled patch without touching work values', async () => {
  for (const [left, right, a, b] of [
    ['beat', 'bar', 1, 2],
    ['pulse', 'playing', 3, 4],
  ] as const) {
    const doc = applyIntents(
      emptyDocument(),
      [
        { op: 'addNode', node: { id: 'clock1', type: 'kit.transport' } },
        { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
        wire(left, 'left'),
        wire(right, 'right'),
      ],
      catalog,
    ).doc;
    const saved = JSON.stringify(doc);
    const g = generate(doc, catalog);
    expect(g.issues.filter(i => i.severity === 'error')).toEqual([]);
    const { processor } = evaluate(g.source, registry);
    const channels = [
      new Float32Array(256).fill(120),
      Float32Array.from({ length: 256 }, (_, i) => i / 256),
      Float32Array.from({ length: 256 }, (_, i) => i / 1024),
      Float32Array.from({ length: 256 }, (_, i) => (i % 64 === 0 ? 1 : 0)),
      new Float32Array(256).fill(1),
    ];
    const rendered = await renderOffline(processor, {
      sampleRate: 48000,
      duration: 256 / 48000,
      inputs: { transport: channels },
    });
    expect(Array.from(rendered.outputs.main![0])).toEqual(Array.from(channels[a]));
    expect(Array.from(rendered.outputs.main![1])).toEqual(Array.from(channels[b]));
    expect(JSON.stringify(doc)).toBe(saved);
    expect(g.params).toEqual([]);
    const standalone = await renderOffline(processor, { sampleRate: 48000, duration: 256 / 48000 });
    expect(standalone.outputs.main!.every(channel => channel.every(value => value === 0))).toBe(
      true,
    );
  }
});
