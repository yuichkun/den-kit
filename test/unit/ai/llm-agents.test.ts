// Sub-agents are the runtime's; den-kit knows them by the runtime's id on their
// tool calls and holds each to its scope: a sub-agent claims what it will change
// before it edits, an edit outside its scope is refused, scopes of agents working
// at the same time do not overlap, and nobody else changes what a working
// sub-agent holds. One request, its sub-agents' edits included, is one undo step,
// and the person's edits in between stay their own.
import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { AiRequests } from '../../../src/ai/requests.ts';
import { LlmController, type LlmTransport } from '../../../src/ai/llm.ts';
import type { WorkspaceDeps } from '../../../src/ai/llm-workspace.ts';
import { analyse } from '../../../src/sound/analysis.ts';
import type { KitSession } from '../../../src/editor/session.ts';
import { testSession } from '../../helpers/test-session.ts';
import { FakeLlmTransport } from '../../helpers/fake-llm-transport.ts';

let session: KitSession, requests: AiRequests, t: FakeLlmTransport, llm: LlmController;
beforeEach(() => {
  session = testSession();
  session.loadStarter('bass');
  requests = new AiRequests(session);
  t = new FakeLlmTransport();
  llm = new LlmController(session, requests, t as unknown as LlmTransport, {
    stopGraceMs: 200,
    deps: {
      compile: async () => ({ ok: true, ms: 300 }) as Awaited<ReturnType<WorkspaceDeps['compile']>>,
      render: async () => {
        const s = new Float32Array(9600).map((_, i) => Math.sin(i / 9) * 0.3);
        return { report: analyse([s, s], 48000), renderMs: 5 };
      },
      look: async () => ({ issues: [], png: null, width: 640, height: 360, ms: 1 }),
    },
  });
  session.llm = llm;
});
const value = (node: string, port: string) => session.doc.value.nodes[node]!.values[port];
const set = (node: string, port: string, v: number) => ({
  ops: [{ op: 'setValue', node, port, value: v }],
});
const SUB = 'thread-sub-1',
  OTHER = 'thread-sub-2';
const line = (id: string) => requests.history.value.find(o => o.id === id)!;

describe("a sub-agent's tool calls are checked against its scope", () => {
  it('it claims a scope before it edits; outside it, nothing lands', async () => {
    const o = llm.run('a squelchy acid bass');
    t.agentStarted(o.id, SUB, 'Filter');
    const unclaimed = await t.call(
      o.id,
      's1',
      'kit_apply_ops',
      set('filter1', 'cutoff', 900),
      2000,
      SUB,
    );
    expect(unclaimed).toMatchObject({
      success: false,
      text: expect.stringMatching(/kit_claim_scope/),
    });
    expect(
      (
        await t.call(
          o.id,
          's2',
          'kit_claim_scope',
          { scope: { sound: { nodes: ['filter1'] } } },
          2000,
          SUB,
        )
      ).success,
    ).toBe(true);
    expect(
      (await t.call(o.id, 's3', 'kit_apply_ops', set('filter1', 'cutoff', 900), 2000, SUB)).success,
    ).toBe(true);
    expect(value('filter1', 'cutoff')).toBe(900);
    const before = value('osc1', 'frequency');
    const outside = await t.call(
      o.id,
      's4',
      'kit_apply_ops',
      set('osc1', 'frequency', 55),
      2000,
      SUB,
    );
    expect(outside).toMatchObject({
      success: false,
      text: expect.stringMatching(/outside your scope/),
    });
    expect(value('osc1', 'frequency')).toBe(before);
    // The person sees it as a lane of the request, with its scope.
    expect(line(o.id).agents).toEqual([
      expect.objectContaining({
        id: SUB,
        name: 'Filter',
        status: 'working',
        scope: 'part of the sound',
      }),
    ]);
    t.agentEnded(o.id, SUB);
    t.done(o.id);
    expect(line(o.id).agents![0]).toMatchObject({ status: 'done' });
  });

  it('scopes of agents working at the same time do not overlap, and nobody changes what a working sub-agent holds', async () => {
    const o = llm.run('sound and screen');
    t.agentStarted(o.id, SUB, 'Sound');
    t.agentStarted(o.id, OTHER, 'Also sound');
    await t.call(
      o.id,
      'c1',
      'kit_claim_scope',
      { scope: { sound: { nodes: ['filter1'] } } },
      2000,
      SUB,
    );
    const overlap = await t.call(
      o.id,
      'c2',
      'kit_claim_scope',
      { scope: { sound: 'all' } },
      2000,
      OTHER,
    );
    expect(overlap).toMatchObject({
      success: false,
      text: expect.stringMatching(/overlaps what “Sound” holds/),
    });
    // The agent the person asked cannot change it either while it works…
    const lead = await t.call(o.id, 'c3', 'kit_apply_ops', set('filter1', 'resonance', 3));
    expect(lead).toMatchObject({
      success: false,
      text: expect.stringMatching(/another agent holds/),
    });
    // …but anything else, yes; and once it is done, that too.
    expect((await t.call(o.id, 'c4', 'kit_apply_ops', set('osc1', 'frequency', 110))).success).toBe(
      true,
    );
    t.agentEnded(o.id, SUB);
    expect(
      (await t.call(o.id, 'c5', 'kit_apply_ops', set('filter1', 'resonance', 3))).success,
    ).toBe(true);
    t.done(o.id);
  });
});

describe('one request is one undo step, its sub-agents included', () => {
  it("the request's AI and a sub-agent edit, the person edits in between: ⌘Z takes the request back and keeps the person's edit", async () => {
    const cutoff = value('filter1', 'cutoff'),
      frequency = value('osc1', 'frequency');
    const o = llm.run('make it bite');
    t.agentStarted(o.id, SUB, 'Filter');
    await t.call(o.id, 'a1', 'kit_apply_ops', set('osc1', 'frequency', 82));
    session.commit([{ op: 'setValue', node: 'filter1', port: 'resonance', value: 2 }]);
    await t.call(
      o.id,
      'a2',
      'kit_claim_scope',
      { scope: { sound: { nodes: ['filter1'] } } },
      2000,
      SUB,
    );
    await t.call(o.id, 'a3', 'kit_apply_ops', set('filter1', 'cutoff', 1500), 2000, SUB);
    t.agentEnded(o.id, SUB);
    t.done(o.id);
    expect(value('filter1', 'cutoff')).toBe(1500);
    session.undo();
    expect(value('filter1', 'cutoff')).toBe(cutoff);
    expect(value('osc1', 'frequency')).toBe(frequency);
    // The person's own edit is a step of its own.
    expect(value('filter1', 'resonance')).toBe(2);
    session.undo();
    expect(value('filter1', 'resonance')).not.toBe(2);
  });

  it('Esc stops the request: its sub-agents end with it', async () => {
    const o = llm.run('a long one');
    t.agentStarted(o.id, SUB, 'Screen');
    llm.stop();
    expect(t.last('llm.stop')).toEqual({ t: 'llm.stop', id: o.id });
    t.done(o.id, 'interrupted');
    expect(line(o.id).agents![0]).toMatchObject({ status: 'stopped' });
    expect(line(o.id).status).toBe('stopped');
  });
});
