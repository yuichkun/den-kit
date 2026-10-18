// B1: every catalog node compiles in a minimal patch, globally and (where allowed)
// per voice, and renders finite audio. Guards descriptor drift from den signatures.
import { beforeAll, describe, expect, it } from 'vite-plus/test';
import { renderOffline } from '@unworklet/offline';
import { compile } from '@unworklet/core';
import { catalog } from '../../src/blocks/index.ts';
import { generate } from '../../src/core/codegen.ts';
import { applyIntents, type Intent } from '../../src/core/ops.ts';
import { emptyDocument } from '../../src/core/schema.ts';
import { CODEBOX_TEMPLATE } from '../../src/core/codebox.ts';
import { evaluate } from '../../src/compile/evaluate.ts';
import { loadRegistry } from '../helpers/registry.ts';

let registry: Record<string, unknown>;
beforeAll(async () => { registry = await loadRegistry(); });
const params = (values: Record<string, number>) => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, [v]]));
const wire = (a: string, b: string): Intent => ({ op: 'connect', from: { node: a.split('.')[0]!, port: a.split('.')[1]! }, to: { node: b.split('.')[0]!, port: b.split('.')[1]! } });

const testable = catalog.list().filter(d => !['voiceIn', 'voiceMix', 'out', 'audioIn', 'comment', 'part', 'partIn', 'partOut'].includes(d.kind) && !['ui.keyboard'].includes(d.type));

function patchFor(type: string, voice: boolean) {
  const def = catalog.get(type);
  const intents: Intent[] = [{ op: 'addNode', node: { id: 'src1', type: 'kit.audioIn' } }, { op: 'addNode', node: { id: 'out1', type: 'kit.out' } }];
  const extra = def.kind === 'codebox' ? { code: CODEBOX_TEMPLATE } : {};
  intents.push({ op: 'addNode', node: { id: 'dut1', type, ...extra } });
  if (voice) intents.push({ op: 'addNode', node: { id: 'voice1', type: 'kit.voiceIn', config: { mode: 'poly', capacity: 2, heldCapacity: 4 } } }, { op: 'addNode', node: { id: 'mix1', type: 'kit.voiceMix' } }, { op: 'addNode', node: { id: 'vel1', type: 'kit.mul' } });
  const tmp = applyIntents(emptyDocument(), intents, catalog).doc;
  const ins = catalog.inputs(tmp.nodes.dut1!).filter(p => !p.hidden);
  const outs = catalog.outputs(tmp.nodes.dut1!);
  const audio = ins.find(p => p.role === 'audio' && p.type === 'signal') ?? ins.find(p => p.type === 'signal' && p.role === 'control' && !p.unit);
  if (voice) {
    intents.push(wire('voice1.velocity', 'vel1.a'));
    const signalIn = ins.find(p => p.type === 'signal');
    const sig = outs.find(p => p.type === 'signal');
    if (audio) intents.push(wire('vel1.out', `dut1.${audio.id}`));
    else if (signalIn) intents.push(wire('voice1.pitch', `dut1.${signalIn.id}`));
    if (sig && (audio || signalIn)) intents.push(wire(`dut1.${sig.id}`, 'mix1.in'), wire('mix1.out', 'out1.left'));
    else if (sig) intents.push({ op: 'addNode', node: { id: 'vca1', type: 'kit.mul' } }, wire(`dut1.${sig.id}`, 'vca1.a'), wire('voice1.velocity', 'vca1.b'), wire('vca1.out', 'mix1.in'), wire('mix1.out', 'out1.left'));
  } else {
    if (audio) intents.push(wire('src1.left', `dut1.${audio.id}`));
    const sig = outs.find(p => p.type === 'signal');
    if (sig) intents.push(wire(`dut1.${sig.id}`, 'out1.left'));
    else if (outs.length) { intents.push({ op: 'addNode', node: { id: 'conv1', type: 'kit.gain' } }, wire(`dut1.${outs[0]!.id}`, 'conv1.in'), wire('conv1.out', 'out1.left')); }
    else if (type === 'ui.scope' || type === 'ui.meter') intents.push(wire('src1.left', 'dut1.in'), wire('src1.left', 'out1.left'));
  }
  return applyIntents(emptyDocument(type, 't'), intents, catalog).doc;
}

describe('B1 every block compiles and renders finite audio', () => {
  for (const def of testable) {
    for (const voice of [false, true]) {
      if (voice && (def.scope === 'global' || def.kind === 'widget')) continue;
      it(`${def.type}${voice ? ' (per voice)' : ''}`, async () => {
        const doc = patchFor(def.type, voice);
        const g = generate(doc, catalog);
        expect(g.issues.filter(i => i.severity === 'error')).toEqual([]);
        expect(g.source).not.toBe('');
        const { processor } = evaluate(g.source, registry);
        const frames = 4800;
        const noise = new Float32Array(frames).map((_, i) => Math.sin(i * 0.05) * 0.5);
        const events = voice ? [{ name: 'midi', atSample: 0, payload: { type: 'noteOn', note: 60, velocity: 100, channel: 0 } }, { name: 'midi', atSample: 2400, payload: { type: 'noteOff', note: 60, velocity: 0, channel: 0 } }] : [];
        const result = await renderOffline(processor, { sampleRate: 48000, duration: frames / 48000, inputs: g.audioIn ? { main: [noise, noise] } : undefined, params: params(g.values), events });
        const out = result.outputs.main!;
        for (const ch of out) for (const s of ch) expect(Number.isFinite(s)).toBe(true);
        expect(result.diagnostics.scrubbedSamples).toBe(0);
        if (g.probes.length) expect(result.outputs.probes).toBeDefined();
      });
    }
  }
});

describe('runtime semantics', () => {
  it('B5 History is exactly a one-sample delay', async () => {
    const doc = applyIntents(emptyDocument(), [
      { op: 'addNode', node: { id: 'in1', type: 'kit.audioIn' } }, { op: 'addNode', node: { id: 'h1', type: 'kit.history' } }, { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
      wire('in1.left', 'h1.in'), wire('h1.out', 'out1.left'), wire('in1.left', 'out1.right'),
    ], catalog).doc;
    const g = generate(doc, catalog);
    const { processor } = evaluate(g.source, registry);
    const ramp = new Float32Array(256).map((_, i) => (i + 1) / 256);
    const r = await renderOffline(processor, { sampleRate: 48000, duration: 256 / 48000, inputs: { main: [ramp, ramp] } });
    const [l, rr] = r.outputs.main!;
    expect(l![0]).toBe(0);
    for (let i = 1; i < 256; i++) expect(l![i]).toBe(rr![i - 1]);
  });
  it('B6 a runaway feedback loop raises one kitHealth event and a panic reset recovers', async () => {
    const doc = applyIntents(emptyDocument(), [
      { op: 'addNode', node: { id: 'in1', type: 'kit.audioIn' } }, { op: 'addNode', node: { id: 'h1', type: 'kit.history' } },
      { op: 'addNode', node: { id: 'add1', type: 'kit.add' } }, { op: 'addNode', node: { id: 'g1', type: 'kit.gain', values: { gain: 2 } } }, { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
      wire('in1.left', 'add1.a'), wire('h1.out', 'g1.in'), wire('g1.out', 'add1.b'), wire('add1.out', 'h1.in'), wire('add1.out', 'out1.left'),
    ], catalog).doc;
    const g = generate(doc, catalog);
    const { processor } = evaluate(g.source, registry);
    const impulse = new Float32Array(4800); impulse[0] = 1;
    const r = await renderOffline(processor, { sampleRate: 48000, duration: 0.1, inputs: { main: [impulse, impulse] }, params: params(g.values), messages: [] });
    const health = r.events.filter(e => e.name === 'kitHealth');
    expect(health.length).toBe(1);
    expect(health[0]!.atSample).toBeLessThan(10);
    const after = await renderOffline(processor, { sampleRate: 48000, duration: 0.01, inputs: { main: [new Float32Array(480), new Float32Array(480)] }, params: params(g.values), restore: r.state, events: [{ name: 'reset', atSample: 0, payload: { value: 1 } }] });
    const tail = after.outputs.main![0]!;
    expect(Math.max(...tail.slice(128).map(Math.abs))).toBe(0);
  });
  it('B7 codebox capture errors point at the codebox node', async () => {
    const code = "import { defineSubgraph } from '@unworklet/core';\nexport default defineSubgraph(() => { throw new Error('boom in box'); });";
    const doc = applyIntents(emptyDocument(), [
      { op: 'addNode', node: { id: 'in1', type: 'kit.audioIn' } }, { op: 'addNode', node: { id: 'box1', type: 'kit.codebox', code } }, { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
      wire('in1.left', 'box1.in'), wire('box1.out', 'out1.left'),
    ], catalog).doc;
    const g = generate(doc, catalog);
    let error: unknown;
    try { evaluate(g.source, registry); } catch (e) { error = e; }
    expect(error).toMatchObject({ name: 'EvaluationError', node: 'box1', message: expect.stringContaining('boom in box') });
  });
  it('B7 codebox syntax errors report a line inside the codebox', () => {
    const code = "import { defineSubgraph } from '@unworklet/core';\nexport default defineSubgraph(() => ({\n  tick(i) { return { out: i.in.mul( } }\n}));";
    const doc = applyIntents(emptyDocument(), [
      { op: 'addNode', node: { id: 'in1', type: 'kit.audioIn' } }, { op: 'addNode', node: { id: 'box1', type: 'kit.codebox', code } }, { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
      wire('in1.left', 'box1.in'), wire('box1.out', 'out1.left'),
    ], catalog).doc;
    const g = generate(doc, catalog);
    let line = 0;
    try { evaluate(g.source, registry); } catch (e) { line = (e as { line: number }).line; }
    expect(line - g.codeboxes.box1! + 1).toBe(3);
  });
  it('compile timing stays in the seconds range for the starters', async () => {
    const { starter, STARTERS } = await import('../../src/core/starters.ts');
    for (const id of STARTERS) {
      const g = generate(starter(id, catalog), catalog);
      const t0 = performance.now();
      const compiled = await compile(evaluate(g.source, registry).processor, { sampleRate: 48000 });
      const ms = performance.now() - t0;
      console.log(`compile ${id}: ${ms.toFixed(0)} ms, wasm ${(compiled.wasm.byteLength / 1024).toFixed(0)} KB`);
      expect(ms).toBeLessThan(15000);
      // Regression guard for DAG expansion (pad was 6 MB before den-block inputs were materialized).
      expect(compiled.wasm.byteLength).toBeLessThan(1_000_000);
    }
  });
});
