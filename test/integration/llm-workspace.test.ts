// The LLM tool loop with real code generation, compilation and offline
// rendering (Node), as an LLM would drive it: add an LFO wobbling the cutoff
// (it lands on the live patch), listen, then a codebox with a mistake (it does
// not land), fix it (it lands), listen again. Listening hears the work's assets.
import { beforeAll, describe, expect, it } from 'vite-plus/test';
import { compile } from '@unworklet/core';
import { renderOffline } from '@unworklet/offline';
import { catalog } from '../../src/sound/blocks/index.ts';
import { starter } from '../../src/work/starters.ts';
import { evaluate, EvaluationError } from '../../src/sound/compile/evaluate.ts';
import { analyse, testSignal } from '../../src/sound/analysis.ts';
import { LlmWorkspace, type WorkspaceDeps } from '../../src/ai/llm-workspace.ts';
import { sha256 } from '../../src/work/files.ts';
import { applyIntents, type Intent } from '../../src/work/ops.ts';
import { emptyDocument, type PatchDocument } from '../../src/work/schema.ts';
import { attributeError } from '../../src/sound/compile/compile-errors.ts';
import { compileInputs } from '../../src/sound/compile/compile-client.ts';
import { loadRegistry } from '../helpers/registry.ts';

let registry: Record<string, unknown>;
beforeAll(async () => {
  registry = await loadRegistry();
});

function realWorkspace(doc = starter('bass', catalog), more: Partial<WorkspaceDeps> = {}) {
  const state: { live: PatchDocument } = { live: doc };
  const ws = new LlmWorkspace({
    ...more,
    catalog,
    images: false,
    read: () => state.live,
    land: intents => {
      state.live = applyIntents(state.live, intents, catalog).doc;
      return { ok: true };
    },
    look: async () => ({ issues: [], png: null, width: 0, height: 0, ms: 0 }),
    compile: async (g, doc) => {
      const started = performance.now();
      try {
        await compile(evaluate(g.source, registry).processor, { sampleRate: 48000 });
        return { ok: true, ms: performance.now() - started };
      } catch (error) {
        // Same attribution as the compile worker: codebox lines map back onto the codebox.
        const e = error as EvaluationError;
        const boxes = compileInputs(doc, g).codeboxes.map(b => ({
          node: b.node,
          line: b.line,
          lines: b.code.split('\n').length + 1,
        }));
        return {
          ok: false,
          message: e.message,
          issues: attributeError(e.message, Object.keys(doc.nodes), {
            node: e.node,
            line: e.line,
            codeboxes: boxes,
          }),
        };
      }
    },
    render: async r => {
      const { processor } = evaluate(r.source, registry);
      const params = Object.fromEntries(Object.entries(r.params).map(([k, v]) => [k, [v]]));
      const result = await renderOffline(processor, {
        sampleRate: 48000,
        duration: r.seconds,
        params,
        events: r.events,
        messages: r.messages,
        inputs: r.input ? { main: testSignal(r.input, r.seconds, 48000) } : undefined,
      });
      return {
        report: analyse(result.outputs.main as Float32Array[], 48000, {
          ...r.notes,
          broken: result.diagnostics.scrubbedSamples,
        }),
        renderMs: 0,
      };
    },
  });
  return Object.assign(ws, { state });
}

describe('LLM tool loop (real compile and render)', () => {
  it('wobble the cutoff with an LFO: it lands on the live patch, and it sounds', async () => {
    const ws = realWorkspace();
    const edit = await ws.call('kit_apply_ops', {
      ops: [
        { op: 'addNode', node: { id: 'lfo2', type: 'den.lfo', values: { rate: 5 } } },
        { op: 'addNode', node: { id: 'wob1', type: 'kit.mul', values: { b: 1.5 } } },
        { op: 'addNode', node: { id: 'sum2', type: 'kit.add' } },
        { op: 'connect', from: { node: 'lfo2', port: 'out' }, to: { node: 'wob1', port: 'a' } },
        { op: 'connect', from: { node: 'fdepth1', port: 'out' }, to: { node: 'sum2', port: 'a' } },
        { op: 'connect', from: { node: 'wob1', port: 'out' }, to: { node: 'sum2', port: 'b' } },
        {
          op: 'connect',
          from: { node: 'sum2', port: 'out' },
          to: { node: 'cut1', port: 'octaves' },
          replace: true,
        },
      ],
    });
    expect(edit.text).toMatch(/live now.*Compiled OK/);
    expect(
      Object.values(ws.state.live.edges).find(e => e.to.node === 'cut1' && e.to.port === 'octaves')!
        .from.node,
    ).toBe('sum2');
    const heard = await ws.call('kit_listen', { phrase: 'bass', seconds: 2 });
    expect(heard.success).toBe(true);
    expect(heard.text).not.toMatch(/Silent|Broken/);
  }, 120000);

  it('a codebox with a mistake reports where; the fix compiles and sounds', async () => {
    const ws = realWorkspace();
    await ws.call('kit_apply_ops', {
      ops: [
        { op: 'addNode', node: { id: 'box1', type: 'kit.codebox' } },
        { op: 'connect', from: { node: 'gain1', port: 'out' }, to: { node: 'box1', port: 'in' } },
        {
          op: 'connect',
          from: { node: 'box1', port: 'out' },
          to: { node: 'out1', port: 'left' },
          replace: true,
        },
      ],
    });
    const broken = await ws.call('kit_write_codebox', {
      node: 'box1',
      code: "import { defineSubgraph, type Node } from '@unworklet/core';\nexport default defineSubgraph(() => ({ tick(i: { in: Node<'f32'> }) { return { out: i.in.mul( } } }));",
      inputs: [{ id: 'in', type: 'signal' }],
      outputs: [{ id: 'out', type: 'signal' }],
    });
    expect(broken.success).toBe(false);
    expect(broken.text).toMatch(/would not compile/);
    expect(broken.text).toMatch(/box1/);
    expect(ws.state.live.nodes.box1!.code ?? '').not.toContain('i.in.mul(');
    const fixed = await ws.call('kit_write_codebox', {
      node: 'box1',
      code: "import { defineSubgraph, type Node } from '@unworklet/core';\nexport default defineSubgraph(() => ({ tick(i: { in: Node<'f32'>; drive: Node<'f32'> }) { return { out: i.in.mul(i.drive).tanh() }; } }));",
      inputs: [
        { id: 'in', type: 'signal' },
        { id: 'drive', type: 'signal' },
      ],
      outputs: [{ id: 'out', type: 'signal' }],
    });
    expect(fixed.text).toMatch(/Compiled OK/);
    await ws.call('kit_apply_ops', {
      ops: [{ op: 'setValue', node: 'box1', port: 'drive', value: 3 }],
    });
    const heard = await ws.call('kit_listen', { phrase: 'bass', seconds: 1.5 });
    expect(heard.text).not.toMatch(/Silent|Broken/);
  }, 120000);

  it("hears the work's assets: what a codebox reads, and a sampler's sound", async () => {
    const contents = new Map<string, Uint8Array>();
    const asset = async (id: string, mime: string, bytes: Uint8Array): Promise<Intent> => {
      const hash = await sha256(bytes);
      contents.set(hash, bytes);
      return { op: 'addAsset', asset: { id, name: id.slice(7), mime, bytes: bytes.length, hash } };
    };
    const wire = (a: string, b: string): Intent => ({
      op: 'connect',
      from: { node: a.split('.')[0]!, port: a.split('.')[1]! },
      to: { node: b.split('.')[0]!, port: b.split('.')[1]! },
    });
    const deps: Partial<WorkspaceDeps> = {
      readAsset: async a => contents.get(a.hash ?? '') ?? null,
      // Node has no audio decoder: a second of a steady level stands in for the file.
      decodeAudio: async (_, rate) => ({
        numberOfChannels: 1,
        length: rate,
        getChannelData: () => new Float32Array(rate).fill(0.5),
      }),
    };
    const code = `import { defineSubgraph, f32, i32, type Node } from '@unworklet/core';
import { bytes } from '@den-kit/assets';

export default defineSubgraph(() => {
  const table = bytes('assets/table.bin');
  return { tick: (i: { in: Node<'f32'> }) => ({ out: f32(table.at(i32(0))).mul(1 / 255).add(i.in.mul(0)) }) };
});
`;
    const boxWork = applyIntents(
      emptyDocument('t', 't'),
      [
        await asset('assets/table.bin', 'application/octet-stream', new Uint8Array([200])),
        { op: 'addNode', node: { id: 'box1', type: 'kit.codebox', code } },
        { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
        wire('box1.out', 'out1.left'),
      ],
      catalog,
    ).doc;
    expect((await realWorkspace(boxWork).call('kit_listen', { seconds: 0.5 })).text).toMatch(
      /Silent/,
    );
    const box = await realWorkspace(boxWork, deps).call('kit_listen', { seconds: 0.5 });
    expect(box.text).not.toMatch(/Silent|Not loaded/);
    const samplerWork = applyIntents(
      emptyDocument('t', 't'),
      [
        await asset('assets/tone.wav', 'audio/wav', new TextEncoder().encode('a wave file')),
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
      ],
      catalog,
    ).doc;
    const sampler = await realWorkspace(samplerWork, deps).call('kit_listen', {
      phrase: 'bass',
      seconds: 1,
    });
    expect(sampler.text).not.toMatch(/Silent|Not loaded/);
    // Contents that are not here are said, and play as silence.
    const missing = await realWorkspace(samplerWork, { ...deps, readAsset: async () => null }).call(
      'kit_listen',
      { phrase: 'bass', seconds: 1 },
    );
    expect(missing.text).toMatch(/Not loaded.*assets\/tone\.wav/);
  }, 120000);

  it('an effect patch is heard through its test input', async () => {
    const ws = realWorkspace(starter('chorus', catalog));
    const heard = await ws.call('kit_listen', { phrase: 'drums', seconds: 1 });
    expect(heard.success).toBe(true);
    expect(heard.text).not.toMatch(/Silent/);
  }, 120000);
});
