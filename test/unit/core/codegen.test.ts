import { describe, expect, it } from 'vite-plus/test';
import { catalog } from '../../../src/blocks/index.ts';
import { generate } from '../../../src/core/codegen.ts';
import { inlineCodebox } from '../../../src/core/codebox.ts';
import { applyIntents, type Intent } from '../../../src/core/ops.ts';
import { emptyDocument, type PatchDocument } from '../../../src/core/schema.ts';
import { starter } from '../../../src/core/starters.ts';

const build = (...intents: Intent[]) => applyIntents(emptyDocument('t', 't'), intents, catalog).doc;
const node = (id: string, type: string, extra: object = {}): Intent => ({ op: 'addNode', node: { id, type, ...extra } });
const wire = (a: string, b: string): Intent => ({ op: 'connect', from: { node: a.split('.')[0]!, port: a.split('.')[1]! }, to: { node: b.split('.')[0]!, port: b.split('.')[1]! } });

describe('codegen', () => {
  it('B11 empty and UI-only patches have nothing to compile', () => {
    expect(generate(emptyDocument(), catalog)).toMatchObject({ source: '', issues: [{ code: 'nothing-to-compile' }] });
    expect(generate(build(node('k1', 'ui.knob'), node('c1', 'kit.comment')), catalog).source).toBe('');
  });
  it('errors block compilation and are returned', () => {
    const doc = build(node('voice1', 'kit.voiceIn'), node('osc1', 'den.oscillator'), node('out1', 'kit.out'), wire('voice1.pitch', 'osc1.frequency'), wire('osc1.out', 'out1.left'));
    const g = generate(doc, catalog);
    expect(g.source).toBe('');
    expect(g.issues.some(i => i.code === 'voice-to-global')).toBe(true);
  });
  it('B8 deterministic: insertion order does not change source or hash', () => {
    const a = starter('pad', catalog);
    const shuffled: PatchDocument = { ...a, nodes: Object.fromEntries(Object.entries(a.nodes).reverse()), edges: Object.fromEntries(Object.entries(a.edges).reverse()) };
    expect(generate(shuffled, catalog).source).toBe(generate(a, catalog).source);
  });
  it('B9 values, positions and labels do not change the hash; cables and config do', () => {
    const doc = starter('bass', catalog);
    const h = generate(doc, catalog).hash;
    const moved = applyIntents(doc, [{ op: 'setValue', node: 'filter1', port: 'resonance', value: 3 }, { op: 'move', node: 'osc1', pos: { x: 9, y: 9 } }, { op: 'setLabel', node: 'osc1', label: 'Main' }], catalog).doc;
    expect(generate(moved, catalog).hash).not.toBe('');
    const g2 = generate(moved, catalog);
    expect(g2.values.filter1_resonance).toBe(3);
    expect(g2.hash).toBe(h);
    const rewired = applyIntents(doc, [{ op: 'setConfig', node: 'osc1', key: 'waveform', value: 'sine' }], catalog).doc;
    expect(generate(rewired, catalog).hash).not.toBe(h);
  });
  it('B3 hostile labels and reserved-word ids cannot break the module', () => {
    const doc = build(node('class', 'den.oscillator', { label: "x'); throw 1; //\n*/ `${evil}`" }), node('out1', 'kit.out'), wire('class.out', 'out1.left'));
    const named = applyIntents(doc, [{ op: 'setName', name: "a\n'); throw 2; //" }], catalog).doc;
    expect(generate(named, catalog).source.split('\n')[0]).toContain('throw 2');
    expect(generate(named, catalog).source).not.toMatch(/\n[^/\n]*throw 2/);
    const g = generate(doc, catalog);
    expect(g.source).toContain('const class$ = blocks.class$.tick(');
    expect(g.source).not.toMatch(/\n[^/\n]*throw 1/);
  });
  it('B12 implicit voice bindings follow createInstrument', () => {
    const g = generate(starter('bass', catalog), catalog);
    expect(g.source).toContain('gate: gate, retrigger: trigger, reset: clear');
    expect(g.source).toMatch(/gat\.write\([^;]*, clear\.or\(trigger\)\);/);
    expect(g.source).toMatch(/sig\.write\([^;]*, tuning\.read\(v\.note\.max\(0\)\)\);[\s\S]{0,200}const osc1 = p\.osc1\.tick\(sig\.read\([^)]*\), gat\.read\([^)]*\)\)/);
    expect(g.source).toContain('select(clear, f32(0), osc1)');
  });
  it('B13 mono into stereo: right falls back to left', () => {
    const doc = build(node('noise1', 'den.seededNoise'), node('delay1', 'den.delayFx'), node('out1', 'kit.out'), wire('noise1.out', 'delay1.left'), wire('delay1.left', 'out1.left'), wire('delay1.right', 'out1.right'));
    const g = generate(doc, catalog);
    // noise read by both inputs → materialized once
    expect(g.source).toMatch(/sig\.write\(\d+, noise1\);/);
    expect(g.source).toMatch(/blocks\.delay1\.tick\(sig\.read\(\d+\), sig\.read\(\d+\),/);
  });
  it('B2 shared global signals are materialized before the voice loop reads them', () => {
    const g = generate(starter('pad', catalog), catalog);
    expect(g.source).toMatch(/const lfo1 = blocks\.lfo1\.tick\(lfo1_rate\.at\(i\), reset, f32\(0\)\);\n\s+sig\.write\(0, lfo1\);/);
    expect(g.params.map(p => p.name)).toContain('trem1_depth');
    expect(g.values.trem1_depth).toBe(0.08);
    expect(g.voices).toEqual({ node: 'voice1', capacity: 4, mode: 'poly' });
  });
  it('maps node lines for the code view', () => {
    const g = generate(starter('bass', catalog), catalog);
    const lines = g.source.split('\n');
    for (const [id, nums] of Object.entries(g.nodeLines)) expect(nums.some(n => lines[n - 1]!.includes(id)), id).toBe(true);
    expect(lines[g.nodeLines.filter1![0]! - 1]).toContain('filter1');
  });
});

describe('codebox inlining', () => {
  it('rewrites core imports and the default export, keeping line numbers', () => {
    const code = "import { defineSubgraph, f32, type Node } from '@unworklet/core';\nimport type { State } from '@unworklet/core';\nexport default defineSubgraph(() => ({\n  tick(i: { in: Node<'f32'> }) { return { out: i.in.mul(f32(2)) }; },\n}));\n";
    const r = inlineCodebox('box1', code);
    expect(r.issues).toEqual([]);
    expect(r.lines[0]).toBe('const { defineSubgraph, f32 } = core;');
    expect(r.lines[2]).toBe('const __default = defineSubgraph(() => ({');
    expect(r.lines.at(-1)).toBe('return __default;');
    expect(r.lines.length).toBe(code.trimEnd().split('\n').length + 1);
  });
  it('B7d refuses other imports and missing/duplicate default exports', () => {
    expect(inlineCodebox('b', "import fs from 'node:fs';\nexport default 1;").issues[0]).toMatchObject({ code: 'codebox-import', line: 1 });
    expect(inlineCodebox('b', "import 'x';\nexport default 1;").issues[0]!.code).toBe('codebox-import');
    expect(inlineCodebox('b', 'const a = 1;').issues[0]!.code).toBe('codebox-export');
    expect(inlineCodebox('b', 'export default 1;\nexport default 2;').issues[0]!.code).toBe('codebox-export');
    expect(inlineCodebox('b', "import * as uw from '@unworklet/core';\nexport default uw.defineSubgraph(() => ({}));").lines[0]).toContain('const uw = core;');
  });
});
