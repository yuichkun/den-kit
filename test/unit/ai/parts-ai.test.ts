// Part views and LLM tools preserve scoped parameters and edits.
import { describe, expect, it } from 'vite-plus/test';
import { shallowRef } from 'vue';
import { AiRequests } from '../../../src/ai/requests.ts';
import { LlmController, type LlmTransport } from '../../../src/ai/llm.ts';
import type { LlmInbound } from '../../../desktop/page/bridge-client.ts';
import type { BridgeStatus, LlmEvent } from '../../../bridge/protocol.ts';
import { LlmWorkspace, type WorkspaceDeps } from '../../../src/ai/llm-workspace.ts';
import { KIT_TOOLS, developerInstructions } from '../../../src/ai/llm-spec.ts';
import { KitSession } from '../../../src/editor/session.ts';
import { catalog } from '../../../src/sound/blocks/index.ts';
import { applyIntents, type Intent } from '../../../src/work/ops.ts';
import { fromPartView, partView } from '../../../src/work/parts.ts';
import { partStarter, starter } from '../../../src/work/starters.ts';
import { validate } from '../../../src/work/validate.ts';
import { analyse } from '../../../src/sound/analysis.ts';
import { checkPlugin } from '../../../src/screen/checks.ts';

const makeSession = () =>
  new KitSession({
    storage: null,
    createWorker: () =>
      ({
        postMessage() {},
        terminate() {},
        onmessage: null,
        onerror: null,
        onmessageerror: null,
      }) as never,
    engine: { setParam() {}, unload() {}, running: false } as never,
  });
class FakeTransport {
  online = true;
  readonly status = shallowRef<BridgeStatus>({ codex: { state: 'ok', images: false, model: 'm' } });
  sent: Array<Record<string, unknown>> = [];
  private listeners = new Set<(m: LlmInbound) => void>();
  get codexReady() {
    return this.online;
  }
  onLlm(l: (m: LlmInbound) => void) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
  llmStart(id: string, text: string, instructions: string, thread?: string) {
    this.sent.push({ t: 'llm.start', id, text, instructions, thread });
    return true;
  }
  llmSteer() {
    return true;
  }
  llmStop() {
    return true;
  }
  llmAnswer() {
    return true;
  }
  llmForget() {
    return true;
  }
  toolResult() {
    return true;
  }
  telemetry() {}
  event(id: string, event: LlmEvent) {
    for (const l of this.listeners) l({ t: 'llm.event', id, event });
  }
  done(id: string) {
    this.event(id, { kind: 'done', status: 'completed', ms: 1 });
  }
  last(t: string) {
    return [...this.sent].reverse().find(m => m.t === t);
  }
}

describe('part views', () => {
  it("a part view shows the use's values; edits planned on it go to the use", () => {
    let doc = applyIntents(
      starter('bass', catalog),
      [{ op: 'makePart', ids: ['cut1', 'filter1'], name: 'Tone' }],
      catalog,
    ).doc;
    doc = applyIntents(
      doc,
      [{ op: 'setValue', node: 'tone1', port: 'resonance', value: 3 }],
      catalog,
    ).doc;
    const view = partView(doc, ['tone1']);
    expect(Object.values(view.nodes).every(n => n.inside === 'tone')).toBe(true);
    expect(view.nodes.filter1!.values.resonance).toBe(3);
    expect(doc.nodes.filter1!.values.resonance).toBe(0.707);
    const intents: Intent[] = [
      { op: 'setValue', node: 'filter1', port: 'resonance', value: 4 },
      { op: 'setValue', node: 'filter1', port: 'cutoff', value: 900 },
    ];
    expect(fromPartView(doc, ['tone1'], intents)).toEqual([
      { op: 'setValue', node: 'tone1', port: 'resonance', value: 4 },
      intents[1],
    ]);
    expect(partView(doc, ['gone'])).toEqual(partView(doc, []));
  });
});

describe('the LLM and parts', () => {
  it('the tools and the rules teach parts', () => {
    const apply = KIT_TOOLS.find(t => t.name === 'kit_apply_ops')!;
    for (const op of [
      'makePart',
      'unpackPart',
      'detachPart',
      'updatePart',
      'addParam',
      'removeParam',
    ]) {
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
    const requests = new AiRequests(session);
    const t = new FakeTransport();
    const llm = new LlmController(session, requests, t as unknown as LlmTransport);
    session.llm = llm;
    session.commit([{ op: 'makePart', ids: ['osc1', 'filter1'], name: 'Drop' }]);
    session.enterPart('drop1');
    const first = llm.run('add a second oscillator');
    expect(String(t.last('llm.start')!.text)).toMatch(
      /The person is inside part "Drop" \(part drop, entered through drop1\)\. The request is about this part[^\n]*"inside": "drop"[^\n]*set on drop1/,
    );
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
      catalog,
      images: false,
      read: () => state.live,
      land: intents => {
        state.live = applyIntents(state.live, intents, catalog).doc;
        landed.push(intents);
        return { ok: true };
      },
      compile: async () => ({ ok: true, ms: 1 }),
      render: async () => {
        const s = new Float32Array(4800).map((_, i) => Math.sin(i / 20) * 0.3);
        return { report: analyse([s, s], 48000), renderMs: 1 };
      },
      look: async doc => ({
        issues: checkPlugin(doc, catalog),
        png: null,
        width: doc.panel.width,
        height: doc.panel.height,
        ms: 1,
      }),
    };
    const ws = new LlmWorkspace(deps);
    const made = await ws.call('kit_apply_ops', {
      ops: [{ op: 'makePart', ids: ['osc1', 'filter1'], name: 'Drop' }],
    });
    expect(made.success).toBe(true);
    expect(made.text).toMatch(/new ids: drop1/);
    expect(landed[0]![0]).toMatchObject({ op: 'makePart', node: 'drop1', id: 'drop' });
    // Someone adds a module meanwhile: the next edit still lands with the ids it tried.
    state.live = applyIntents(
      state.live,
      [{ op: 'addNode', node: { id: 'drop2', type: 'den.lfo' } }],
      catalog,
    ).doc;
    const more = await ws.call('kit_apply_ops', {
      ops: [
        { op: 'addNode', node: { type: 'den.lfo', inside: 'drop', values: { rate: 4 } } },
        { op: 'addParam', part: 'drop', node: 'lfo1', port: 'rate', label: 'Rate' },
        { op: 'updatePart', part: 'drop', doc: 'One drop' },
      ],
    });
    expect(more.success).toBe(true);
    expect(state.live.nodes.lfo1!.inside).toBe('drop');
    expect(state.live.parts.drop!.params.some(p => p.id === 'rate')).toBe(true);
    // Refused edits say why and land nothing.
    const bad = await ws.call('kit_apply_ops', {
      ops: [
        {
          op: 'connect',
          from: { node: 'voice1', port: 'pitch' },
          to: { node: 'lfo1', port: 'rate' },
        },
      ],
    });
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
    expect(doc.parts.part).toMatchObject({
      name: 'Rain',
      outputs: [{ id: 'out', node: 'partOut1' }],
    });
    expect(catalog.outputs(doc.nodes.part1!).map(p => p.id)).toEqual(['out']);
    expect(Object.values(doc.edges)).toEqual([
      { id: 'e1', from: { node: 'part1', port: 'out' }, to: { node: 'out1', port: 'left' } },
    ]);
    expect(validate(doc, catalog).issues.filter(i => i.severity === 'error')).toEqual([]);
    const session = makeSession();
    session.replace(doc, 'Start from a part', false);
    expect(session.enterPart('part1')).toBe(true);
    expect(session.scope.value).toBe('part');
  });
});
