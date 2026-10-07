// Parts and the AI: fast-path words make, unpack and detach parts; inside a
// part, requests are about it (a knob that is a parameter moves the use the
// person came through, never the shared default); the LLM gets the part tools,
// is told where the person is, and what it makes lands with the ids it tried.
import { beforeEach, describe, expect, it } from 'vitest';
import { shallowRef } from 'vue';
import { FastPath } from '../../../src/ai/fast-path.ts';
import { LlmController, type LlmTransport } from '../../../src/ai/llm.ts';
import type { LlmInbound } from '../../../src/ai/bridge-client.ts';
import type { BridgeStatus, LlmEvent } from '../../../src/ai/protocol.ts';
import { parseRequest } from '../../../src/ai/lexicon.ts';
import { LlmWorkspace, type WorkspaceDeps } from '../../../src/ai/llm-workspace.ts';
import { KIT_TOOLS, developerInstructions } from '../../../src/ai/llm-spec.ts';
import { KitSession } from '../../../src/editor/session.ts';
import { catalog } from '../../../src/blocks/index.ts';
import { applyIntents, type Intent } from '../../../src/core/ops.ts';
import { fromPartView, partView } from '../../../src/core/parts.ts';
import { partStarter, starter } from '../../../src/core/starters.ts';
import { validate } from '../../../src/core/validate.ts';
import { analyse } from '../../../src/core/analysis.ts';
import { checkPlugin } from '../../../src/plugin/checks.ts';
import { stubBridge } from '../../helpers/fake-bridge.ts';
import { scriptedAnswerer } from '../../fakes/jev/scripted.ts';

const makeSession = () => new KitSession({
  storage: null,
  createWorker: () => ({ postMessage() {}, terminate() {}, onmessage: null, onerror: null, onmessageerror: null }) as never,
  engine: { setParam() {}, unload() {}, running: false } as never,
});
class FakeTransport {
  online = true;
  readonly status = shallowRef<BridgeStatus>({ jev: { state: 'off' }, codex: { state: 'ok', images: false, model: 'm' } });
  sent: Array<Record<string, unknown>> = [];
  private listeners = new Set<(m: LlmInbound) => void>();
  get codexReady() { return this.online; }
  onLlm(l: (m: LlmInbound) => void) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  llmStart(id: string, text: string, instructions: string, thread?: string) { this.sent.push({ t: 'llm.start', id, text, instructions, thread }); return true; }
  llmSteer() { return true; }
  llmStop() { return true; }
  llmAnswer() { return true; }
  llmForget() { return true; }
  toolResult() { return true; }
  telemetry() {}
  event(id: string, event: LlmEvent) { for (const l of this.listeners) l({ t: 'llm.event', id, event }); }
  done(id: string) { this.event(id, { kind: 'done', status: 'completed', ms: 1 }); }
  last(t: string) { return [...this.sent].reverse().find(m => m.t === t); }
}

describe('the words', () => {
  it.each([
    ['これをパーツにして', 'make'], ['パーツ化して', 'make'], ['ひとまとめにして', 'make'], ['make this a part', 'make'], ['turn these into a part', 'make'],
    ['ほどいて', 'unpack'], ['このパーツをほどいて', 'unpack'], ['unpack it', 'unpack'], ['break it apart', 'unpack'],
    ['切り離して', 'detach'], ['detach this', 'detach'], ['give it its own copy', 'detach'],
  ])('%s', (text, action) => {
    const lex = parseRequest(text);
    expect(lex.items).toEqual([expect.objectContaining({ kind: 'part', action })]);
    expect(lex.full).toBe(true);
  });
  it('other requests are not about parts', () => {
    for (const text of ['パーツの音を明るく', 'ベース作って', 'more bass', 'リリース長く']) expect(parseRequest(text).items.some(i => i.kind === 'part')).toBe(false);
  });
});

describe('the fast path with parts', () => {
  let session: KitSession, fast: FastPath;
  beforeEach(() => {
    session = makeSession();
    session.loadStarter('bass');
    session.bridge = stubBridge(scriptedAnswerer({}), 'off').bridge;
    fast = new FastPath(session);
  });
  it('パーツにして makes a part of the selection (one ⌘Z takes it back); without a selection it says what to do', async () => {
    const before = session.doc.value;
    const none = await fast.run('パーツにして');
    expect(none.status).toBe('nothing');
    expect(none.message).toMatch(/Select the modules/);
    session.select(['osc1', 'filter1']);
    const made = await fast.run('パーツにして');
    expect(made.status).toBe('applied');
    expect(Object.keys(session.doc.value.parts)).toHaveLength(1);
    const use = Object.values(session.doc.value.nodes).find(n => n.type === 'kit.part')!;
    session.select([use.id]);
    const own = await fast.run('切り離して');
    expect(own.status).toBe('nothing'); // used once: already its own
    const unpacked = await fast.run('ほどいて');
    expect(unpacked.status).toBe('applied');
    expect(session.doc.value.parts).toEqual({});
    session.undo(); session.undo();
    expect({ ...session.doc.value, revision: 0 }).toEqual({ ...before, revision: 0 });
  });
  it('in the main patch, a request reaches a part through its parameters, never the knobs inside it', async () => {
    const r = session.commit([{ op: 'makePart', ids: ['cut1', 'filter1'], name: 'Tone' }]);
    expect(r.ok).toBe(true);
    const use = r.ok ? r.created[0]! : '';
    expect(session.doc.value.parts.tone!.params.map(p => p.id)).toEqual(['hz', 'resonance']);
    const hz = session.doc.value.nodes[use]!.values.hz as number;
    const out = await fast.run('明るく');
    expect(out.status).toBe('applied');
    expect(session.doc.value.nodes[use]!.values.hz).toBeGreaterThan(hz);
    expect(session.doc.value.nodes.cut1!.values.hz).toBe(hz); // the default inside is untouched
  });
  it('inside a part, a request is about it: a knob that is a parameter moves the use the person came through', async () => {
    const r = session.commit([{ op: 'makePart', ids: ['cut1', 'filter1'], name: 'Tone' }]);
    const use = r.ok ? r.created[0]! : '';
    session.commit([{ op: 'setValue', node: use, port: 'hz', value: 600 }]);
    session.enterPart(use);
    const out = await fast.run('明るく');
    expect(out.status).toBe('applied');
    expect(out.where).toEqual({ path: [use], part: 'tone', name: 'Tone' });
    const after = session.doc.value.nodes[use]!.values.hz as number;
    expect(after).toBeGreaterThan(600); // from the use's own value, not the default (300)
    expect(session.doc.value.nodes.cut1!.values.hz).toBe(300);
    // A knob inside that is not a parameter is shared: it moves for every use.
    session.leavePart();
    const view = partView(session.doc.value, []);
    expect(Object.keys(view.nodes)).not.toContain('cut1');
  });
  it('a part view shows the use\'s values; edits planned on it go to the use', () => {
    let doc = applyIntents(starter('bass', catalog), [{ op: 'makePart', ids: ['cut1', 'filter1'], name: 'Tone' }], catalog).doc;
    doc = applyIntents(doc, [{ op: 'setValue', node: 'tone1', port: 'resonance', value: 3 }], catalog).doc;
    const view = partView(doc, ['tone1']);
    expect(Object.values(view.nodes).every(n => n.inside === 'tone')).toBe(true);
    expect(view.nodes.filter1!.values.resonance).toBe(3);
    expect(doc.nodes.filter1!.values.resonance).toBe(0.707);
    const intents: Intent[] = [{ op: 'setValue', node: 'filter1', port: 'resonance', value: 4 }, { op: 'setValue', node: 'filter1', port: 'cutoff', value: 900 }];
    expect(fromPartView(doc, ['tone1'], intents)).toEqual([{ op: 'setValue', node: 'tone1', port: 'resonance', value: 4 }, intents[1]]);
    expect(partView(doc, ['gone'])).toEqual(partView(doc, []));
  });
});

describe('the LLM and parts', () => {
  it('the tools and the rules teach parts', () => {
    const apply = KIT_TOOLS.find(t => t.name === 'kit_apply_ops')!;
    for (const op of ['makePart', 'unpackPart', 'detachPart', 'updatePart', 'addParam', 'removeParam']) {
      expect(apply.description).toContain(`"op":"${op}"`);
      expect(JSON.stringify(apply.inputSchema)).toContain(op);
    }
    const rules = developerInstructions('');
    expect(rules).toMatch(/build small, listen, then reuse/);
    expect(rules).toMatch(/inside a part \(a \[den-kit\] note says which\)/);
  });
  it('a request made inside a part tells the LLM which part and which use', async () => {
    const session = makeSession();
    session.loadStarter('bass');
    session.bridge = stubBridge(scriptedAnswerer({}), 'off').bridge;
    const fast = new FastPath(session);
    const t = new FakeTransport();
    const llm = new LlmController(session, fast, t as unknown as LlmTransport);
    session.llm = llm;
    session.commit([{ op: 'makePart', ids: ['osc1', 'filter1'], name: 'Drop' }]);
    session.enterPart('drop1');
    const first = llm.run('add a second oscillator');
    expect(String(t.last('llm.start')!.text)).toMatch(/The person is inside part "Drop" \(part drop, entered through drop1\)\. The request is about this part[^\n]*"inside": "drop"[^\n]*set on drop1/);
    expect(String(t.last('llm.start')!.text)).toMatch(/The person edited by hand: Make a part\./);
    t.done(first.id);
    await new Promise(r => setTimeout(r, 5));
    session.leavePart();
    llm.run('louder');
    expect(t.sent.filter(m => m.t === 'llm.start')).toHaveLength(2);
    expect(String(t.last('llm.start')!.text)).not.toMatch(/inside part "Drop"/);
  });
  it('kit_apply_ops makes a part, uses it again and edits inside; the ids it tried are the ids that land', async () => {
    const state = { live: starter('bass', catalog) };
    const landed: Intent[][] = [];
    const deps: WorkspaceDeps = {
      catalog, images: false, read: () => state.live,
      land: intents => { state.live = applyIntents(state.live, intents, catalog).doc; landed.push(intents); return { ok: true }; },
      compile: async () => ({ ok: true, ms: 1 }),
      render: async () => { const s = new Float32Array(4800).map((_, i) => Math.sin(i / 20) * 0.3); return { report: analyse([s, s], 48000), renderMs: 1 }; },
      look: async doc => ({ issues: checkPlugin(doc, catalog), png: null, width: doc.panel.width, height: doc.panel.height, ms: 1 }),
    };
    const ws = new LlmWorkspace(deps);
    const made = await ws.call('kit_apply_ops', { ops: [{ op: 'makePart', ids: ['osc1', 'filter1'], name: 'Drop' }] });
    expect(made.success).toBe(true);
    expect(made.text).toMatch(/new ids: drop1/);
    expect(landed[0]![0]).toMatchObject({ op: 'makePart', node: 'drop1', id: 'drop' });
    // Someone adds a module meanwhile: the next edit still lands with the ids it tried.
    state.live = applyIntents(state.live, [{ op: 'addNode', node: { id: 'drop2', type: 'den.lfo' } }], catalog).doc;
    const more = await ws.call('kit_apply_ops', { ops: [
      { op: 'addNode', node: { type: 'den.lfo', inside: 'drop', values: { rate: 4 } } },
      { op: 'addParam', part: 'drop', node: 'lfo1', port: 'rate', label: 'Rate' },
      { op: 'updatePart', part: 'drop', doc: 'One drop' },
    ] });
    expect(more.success).toBe(true);
    expect(state.live.nodes.lfo1!.inside).toBe('drop');
    expect(state.live.parts.drop!.params.some(p => p.id === 'rate')).toBe(true);
    // Refused edits say why and land nothing.
    const bad = await ws.call('kit_apply_ops', { ops: [{ op: 'connect', from: { node: 'voice1', port: 'pitch' }, to: { node: 'lfo1', port: 'rate' } }] });
    expect(bad.success).toBe(false);
    expect(bad.text).toMatch(/not in the same place/);
    const patch = await ws.call('kit_get_patch', {});
    expect(patch.text).toMatch(/Part drop "Drop" — One drop\. Used by: drop1/);
    expect(patch.text).toMatch(/"inside": "drop"/);
    expect(validate(state.live, catalog).issues.filter(i => i.severity === 'error')).toEqual([]);
  });
});

describe('starting from a part', () => {
  it('an empty part wired to Out, with one output inside; it validates (silent until something is inside)', () => {
    const doc = partStarter(catalog, 'Rain');
    expect(doc.parts.part).toMatchObject({ name: 'Rain', outputs: [{ id: 'out', node: 'partOut1' }] });
    expect(catalog.outputs(doc.nodes.part1!).map(p => p.id)).toEqual(['out']);
    expect(Object.values(doc.edges)).toEqual([{ id: 'e1', from: { node: 'part1', port: 'out' }, to: { node: 'out1', port: 'left' } }]);
    expect(validate(doc, catalog).issues.filter(i => i.severity === 'error')).toEqual([]);
    const session = makeSession();
    session.replace(doc, 'Start from a part', false);
    expect(session.enterPart('part1')).toBe(true);
    expect(session.scope.value).toBe('part');
  });
});
