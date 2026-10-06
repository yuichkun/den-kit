// The LLM path in the browser against a scripted bridge: the draft lands as one
// undoable step, the user's edits win, steer/stop/questions, broken drafts, lost
// requests, and the hand-off from the fast path.
import { beforeEach, describe, expect, it } from 'vitest';
import { shallowRef } from 'vue';
import { FastPath, type Outcome } from '../../../src/ai/fast-path.ts';
import { LlmController, type LlmTransport } from '../../../src/ai/llm.ts';
import type { LlmInbound } from '../../../src/ai/bridge-client.ts';
import type { BridgeStatus, LlmEvent, ToolOutput } from '../../../src/ai/protocol.ts';
import type { WorkspaceDeps } from '../../../src/ai/llm-workspace.ts';
import { analyse } from '../../../src/core/analysis.ts';
import { clone } from '../../../src/core/schema.ts';
import type { KitSession } from '../../../src/editor/session.ts';
import { testSession, stubBridge } from '../../helpers/fake-bridge.ts';
import { scriptedAnswerer } from '../../fakes/jev/scripted.ts';

class FakeTransport {
  online = true;
  readonly status = shallowRef<BridgeStatus>({ jev: { state: 'ok' }, codex: { state: 'ok', images: false, model: 'GPT-6.1-Sol' } });
  sent: Array<Record<string, unknown>> = [];
  results: Array<{ id: string; callId: string; output: ToolOutput }> = [];
  telemetryRecords: Array<Record<string, unknown>> = [];
  private listeners = new Set<(m: LlmInbound) => void>();
  get codexReady() { return this.online && this.status.value.codex.state === 'ok'; }
  onLlm(l: (m: LlmInbound) => void) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  llmStart(id: string, text: string, instructions: string, thread?: string) { this.sent.push({ t: 'llm.start', id, text, instructions, thread }); return this.online; }
  llmSteer(id: string, target: string, text: string) { this.sent.push({ t: 'llm.steer', id, target, text }); return this.online; }
  llmStop(id: string) { this.sent.push({ t: 'llm.stop', id }); return this.online; }
  llmAnswer(id: string, question: string, answers: Record<string, string[]>) { this.sent.push({ t: 'llm.answer', id, question, answers }); return true; }
  llmForget(thread: string) { this.sent.push({ t: 'llm.forget', thread }); return true; }
  toolResult(id: string, callId: string, output: ToolOutput) { this.results.push({ id, callId, output }); return true; }
  codexRetry() { return true; }
  telemetry(record: Record<string, unknown>) { this.telemetryRecords.push(record); }
  emit(m: LlmInbound) { for (const l of this.listeners) l(m); }
  event(id: string, event: LlmEvent) { this.emit({ t: 'llm.event', id, event }); }
  done(id: string, status: 'completed' | 'interrupted' | 'failed' = 'completed', error?: { message: string; fix?: string; code?: string }) { this.event(id, { kind: 'done', status, ...(error ? { error } : {}), ms: 10 }); }
  /** Send a tool call and wait for its result. */
  async call(id: string, callId: string, tool: string, args: unknown): Promise<ToolOutput> {
    const before = this.results.filter(r => r.callId === callId).length;
    this.emit({ t: 'tool.call', id, callId, tool, args });
    for (let i = 0; i < 500; i++) {
      const found = this.results.filter(r => r.callId === callId);
      if (found.length > before) return found.at(-1)!.output;
      await new Promise(r => setTimeout(r, 2));
    }
    throw new Error(`no result for ${callId}`);
  }
  last(t: string) { return [...this.sent].reverse().find(m => m.t === t); }
}

const WOBBLE = { ops: [
  { op: 'addNode', node: { id: 'lfo2', type: 'den.lfo', values: { rate: 5 } } },
  { op: 'addNode', node: { id: 'wob1', type: 'kit.mul', values: { b: 1.5 } } },
  { op: 'addNode', node: { id: 'sum2', type: 'kit.add' } },
  { op: 'connect', from: { node: 'lfo2', port: 'out' }, to: { node: 'wob1', port: 'a' } },
  { op: 'connect', from: { node: 'fdepth1', port: 'out' }, to: { node: 'sum2', port: 'a' } },
  { op: 'connect', from: { node: 'wob1', port: 'out' }, to: { node: 'sum2', port: 'b' } },
  { op: 'connect', from: { node: 'sum2', port: 'out' }, to: { node: 'cut1', port: 'octaves' }, replace: true },
] };

let session: KitSession, fast: FastPath, t: FakeTransport, llm: LlmController;
let compileResult: Awaited<ReturnType<WorkspaceDeps['compile']>>;
function setup(options: { stopGraceMs?: number } = {}) {
  session = testSession();
  session.loadStarter('bass');
  session.bridge = stubBridge(scriptedAnswerer({}), 'off').bridge;
  fast = new FastPath(session);
  t = new FakeTransport();
  compileResult = { ok: true, ms: 300 };
  llm = new LlmController(session, fast, t as unknown as LlmTransport, {
    stopGraceMs: options.stopGraceMs,
    deps: {
      compile: async () => compileResult,
      render: async () => { const s = new Float32Array(9600).map((_, i) => Math.sin(i / 9) * 0.3); return { report: analyse([s, s], 48000), renderMs: 5 }; },
    },
  });
  session.llm = llm;
}
beforeEach(() => setup());
const line = (id: string) => fast.history.value.find(o => o.id === id)!;
/** The patch's content, independent of key order (undo re-adds a removed cable at the end). */
const snapshot = () => { const d = clone(session.doc.value); const sort = <T,>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))); return JSON.stringify({ ...d, revision: 0, nodes: sort(d.nodes), edges: sort(d.edges) }); };
const startId = () => String(t.last('llm.start')!.id);

describe('a request', () => {
  it('runs on a draft (live untouched) and lands as one ai-llm step; ⌘Z takes all of it back', async () => {
    const before = snapshot();
    const o = llm.run('wobble the cutoff');
    expect(o).toMatchObject({ status: 'thinking', route: 'llm', live: true });
    const start = t.last('llm.start')!;
    expect(String(start.text)).toMatch(/^\[den-kit\] Your draft is a copy of the live patch[\s\S]*wobble the cutoff$/);
    expect(String(start.instructions)).toContain('kit_get_patch');
    expect(String(start.instructions)).toContain('den.lfo');
    t.event(o.id, { kind: 'thread', thread: 'th1', fresh: false });
    const edit = await t.call(o.id, 'c1', 'kit_apply_ops', WOBBLE);
    expect(edit.text).toMatch(/Applied 7 edits.*Compiled OK/s);
    expect(snapshot()).toBe(before); // live untouched while the LLM works
    // A call sent again after a reconnect gets the same answer and is not applied twice.
    const again = await t.call(o.id, 'c1', 'kit_apply_ops', WOBBLE);
    expect(again).toBe(edit);
    expect(line(o.id).steps!.join(' ')).toMatch(/\+ lfo2.*compiled ✓/);
    await t.call(o.id, 'c2', 'kit_finish', { summary: 'Added an LFO wobbling the cutoff' });
    t.done(o.id);
    expect(line(o.id)).toMatchObject({ status: 'applied', label: 'Added an LFO wobbling the cutoff', live: false });
    expect(session.history.peek()!.author).toMatchObject({ kind: 'ai-llm', take: o.id });
    expect(session.doc.value.nodes.lfo2).toBeDefined();
    expect(llm.busy.value).toBe(false);
    session.undo();
    expect(snapshot()).toBe(before);
    expect(line(o.id).undone).toBe(true);
  });

  it('the user’s edits made meanwhile win; the line says what was kept', async () => {
    const o = llm.run('open the filter and wobble it');
    await t.call(o.id, 'c1', 'kit_apply_ops', { ops: [...WOBBLE.ops, { op: 'setValue', node: 'cut1', port: 'hz', value: 900 }] });
    session.commit([{ op: 'setValue', node: 'cut1', port: 'hz', value: 500 }]); // the user, meanwhile
    t.done(o.id);
    expect(line(o.id).status).toBe('applied');
    expect(session.doc.value.nodes.cut1!.values.hz).toBe(500);
    expect(session.doc.value.nodes.lfo2).toBeDefined();
    expect(line(o.id).conflicts).toEqual([expect.stringMatching(/hz.*your version was kept/)]);
  });

  it('a reply without changes shows the words; kit_ask becomes buttons that continue the conversation', async () => {
    const o = llm.run('how does this work?');
    t.event(o.id, { kind: 'thread', thread: 'th1', fresh: false });
    await t.call(o.id, 'c1', 'kit_get_patch', {});
    t.event(o.id, { kind: 'delta', text: 'An oscillator ' });
    expect(line(o.id).reply).toBe('An oscillator ');
    t.event(o.id, { kind: 'message', text: 'An oscillator goes through a filter.' });
    t.done(o.id);
    expect(line(o.id)).toMatchObject({ status: 'reply', reply: 'An oscillator goes through a filter.' });
    const before = snapshot();
    const q = llm.run('make it different');
    expect(t.last('llm.start')!.thread).toBe('th1');
    expect(String(t.last('llm.start')!.text)).toMatch(/may have changed since your last turn/);
    await t.call(q.id, 'c2', 'kit_ask', { question: 'Which direction?', options: ['Brighter', 'Darker'] });
    t.done(q.id);
    const asked = line(q.id);
    expect(asked).toMatchObject({ status: 'chips', message: 'Which direction?' });
    expect(asked.actions!.map(a => [a.kind, a.label])).toEqual([['send', 'Brighter'], ['send', 'Darker']]);
    expect(snapshot()).toBe(before);
    llm.act(asked.actions![1]!, asked);
    expect(t.last('llm.start')).toMatchObject({ thread: 'th1', text: expect.stringMatching(/Darker$/) });
  });

  it('a new conversation starts when a different patch is loaded', async () => {
    const o = llm.run('explain');
    t.event(o.id, { kind: 'thread', thread: 'th1', fresh: false });
    t.done(o.id);
    session.loadStarter('pad');
    llm.run('explain again');
    expect(t.last('llm.forget')).toEqual({ t: 'llm.forget', thread: 'th1' });
    expect(t.last('llm.start')!.thread).toBeUndefined();
  });
});

describe('while it works', () => {
  it('another request is steered in; one that arrives too late runs next', async () => {
    const first = llm.run('slow please');
    const steer = llm.run('make it darker');
    expect(t.last('llm.steer')).toMatchObject({ id: steer.id, target: first.id, text: expect.stringMatching(/adds, while you work[\s\S]*make it darker/) });
    t.event(steer.id, { kind: 'steered', target: first.id });
    expect(line(steer.id)).toMatchObject({ status: 'merged', live: false });
    expect(line(first.id).steps!.at(-1)).toMatch(/you added: “make it darker”/);
    const late = llm.run('and wider');
    t.event(late.id, { kind: 'done', status: 'failed', error: { message: 'That request has already finished.', code: 'not-steerable' }, ms: 0 });
    expect(line(late.id)).toMatchObject({ status: 'thinking', message: expect.stringMatching(/waits/) });
    t.done(first.id);
    expect(t.last('llm.start')).toMatchObject({ id: late.id, text: expect.stringMatching(/and wider$/) });
    expect(llm.busy.value).toBe(true);
  });

  it('Esc stops it and nothing is applied; if Codex never confirms, it ends anyway', async () => {
    const before = snapshot();
    const o = llm.run('wobble');
    await t.call(o.id, 'c1', 'kit_apply_ops', WOBBLE);
    expect(llm.stop()).toBe(true);
    expect(t.last('llm.stop')).toEqual({ t: 'llm.stop', id: o.id });
    expect(line(o.id).activity).toBe('stopping…');
    t.done(o.id, 'interrupted');
    expect(line(o.id)).toMatchObject({ status: 'stopped', message: 'Stopped. Nothing was changed.' });
    expect(snapshot()).toBe(before);

    setup({ stopGraceMs: 30 });
    const p = llm.run('wobble');
    llm.stop();
    await new Promise(r => setTimeout(r, 60));
    expect(line(p.id).status).toBe('stopped');
    expect(llm.busy.value).toBe(false);
  });

  it('Codex questions become buttons; a click answers', async () => {
    const o = llm.run('ask me');
    t.event(o.id, { kind: 'question', question: 'q7', blocking: true, items: [{ id: 'size', header: 'Size', question: 'How big?', options: ['Small', 'Large'], other: false }] });
    const asked = line(o.id);
    expect(asked.message).toBe('How big?');
    const large = asked.actions!.find(a => a.label === 'Large')!;
    llm.act(large, asked);
    expect(t.last('llm.answer')).toEqual({ t: 'llm.answer', id: o.id, question: 'q7', answers: { size: ['Large'] } });
    expect(line(o.id).actions!.map(a => a.kind)).toEqual([]);
  });

  it('a tool call for a request that already ended gets no answer', async () => {
    const o = llm.run('explain');
    t.done(o.id);
    t.emit({ t: 'tool.call', id: o.id, callId: 'late', tool: 'kit_get_patch', args: {} });
    await new Promise(r => setTimeout(r, 20));
    expect(t.results.filter(r => r.callId === 'late')).toEqual([]);
  });
});

describe('when it cannot be applied', () => {
  it('a draft that does not compile is not applied; “Apply anyway” lands it', async () => {
    compileResult = { ok: false, message: 'boom', issues: [{ severity: 'error', code: 'compile', message: 'boom', node: 'lfo2' }] };
    const o = llm.run('wobble');
    await t.call(o.id, 'c1', 'kit_apply_ops', WOBBLE);
    t.done(o.id);
    const failed = line(o.id);
    expect(failed).toMatchObject({ status: 'failed', message: expect.stringMatching(/does not compile, so it was not applied/) });
    expect(session.doc.value.nodes.lfo2).toBeUndefined();
    llm.act(failed.actions!.find(a => a.kind === 'apply-anyway')!, failed);
    expect(line(o.id)).toMatchObject({ status: 'applied', note: expect.stringMatching(/did not compile/) });
    expect(session.doc.value.nodes.lfo2).toBeDefined();
  });

  it('a failure says why and what to do', () => {
    const o = llm.run('wobble');
    t.done(o.id, 'failed', { message: 'Your ChatGPT plan’s Codex usage limit is reached.', fix: 'Wait for the limit to reset.', code: 'usageLimitExceeded' });
    expect(line(o.id)).toMatchObject({ status: 'failed', message: expect.stringMatching(/usage limit/), fix: 'Wait for the limit to reset.' });
  });

  it('a request the bridge lost (it restarted) fails instead of waiting forever', () => {
    const o = llm.run('wobble');
    t.emit({ t: 'welcome', running: [] });
    expect(line(o.id)).toMatchObject({ status: 'failed', message: expect.stringMatching(/restarted and lost/) });
    const p = llm.run('wobble again');
    t.emit({ t: 'welcome', running: [p.id] });
    expect(line(p.id).status).toBe('thinking');
  });

  it('a different patch loaded meanwhile: the edit is not applied', async () => {
    const o = llm.run('wobble');
    await t.call(o.id, 'c1', 'kit_apply_ops', WOBBLE);
    session.loadStarter('pad');
    t.done(o.id);
    expect(line(o.id)).toMatchObject({ status: 'failed', message: expect.stringMatching(/different patch/) });
    expect(session.doc.value.nodes.lfo2).toBeUndefined();
  });

  it('Codex not signed in: the line says what to run', () => {
    t.status.value = { ...t.status.value, codex: { state: 'login', fix: 'Run `npm run kit:codex:login` once.' } };
    const o = llm.run('wobble');
    expect(o).toMatchObject({ status: 'failed', message: expect.stringMatching(/not signed in.*kit:codex:login/) });
    expect(t.sent).toEqual([]);
  });
});

describe('hand-off from the fast path', () => {
  it('code, wiring and explanations go to the LLM', async () => {
    const o: Outcome = await fast.run('write a granular codebox');
    expect(o).toMatchObject({ route: 'llm', status: 'thinking' });
    expect(t.last('llm.start')!.text).toMatch(/write a granular codebox$/);
  });

  it('what the fast path does not understand goes to the LLM (Jev off here)', async () => {
    const o = await fast.run('make it sound like a spaceship landing');
    expect(o.route).toBe('llm');
  });

  it('plain knob requests stay on the fast path and apply at once, even while the LLM works', async () => {
    const busy = llm.run('slow please');
    const o = await fast.run('リリース長く');
    expect(o).toMatchObject({ status: 'applied', route: 'lexicon' });
    expect(t.sent.filter(m => m.t === 'llm.steer')).toEqual([]);
    expect(line(busy.id).status).toBe('thinking');
  });

  it('without the LLM the line says why', async () => {
    t.status.value = { ...t.status.value, codex: { state: 'error', detail: 'Codex stopped unexpectedly.', fix: 'Run `npm run kit:doctor`.' } };
    const o = await fast.run('write a granular codebox');
    expect(o).toMatchObject({ status: 'escalate', message: expect.stringMatching(/not available: Codex stopped unexpectedly.*kit:doctor/) });
  });
});
