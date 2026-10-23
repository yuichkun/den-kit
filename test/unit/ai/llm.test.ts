// The LLM path in the browser against a scripted bridge: edits land on the live
// patch step by step and undo together, the user's edits in between stay their
// own, steer/stop, questions answered for nobody, edits that do not compile,
// lost requests, and short prompts using the same LLM path.
import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { shallowRef } from 'vue';
import { AiRequests, type Outcome } from '../../../src/ai/requests.ts';
import { LlmController, type LlmTransport } from '../../../src/ai/llm.ts';
import type { AIStatus, LlmEvent, LlmInbound, ToolOutput } from '../../../src/host/ai.ts';
import { developerWording } from '../../../dev/ai-wording.ts';
import type { WorkspaceDeps } from '../../../src/ai/llm-workspace.ts';
import { analyse } from '../../../src/sound/analysis.ts';
import { clone } from '../../../src/work/schema.ts';
import type { KitSession } from '../../../src/editor/session.ts';
import { testSession } from '../../helpers/test-session.ts';

class FakeTransport {
  online = true;
  readonly wording = developerWording;
  readonly status = shallowRef<AIStatus>({
    codex: { state: 'ok', images: false, model: 'GPT-6.1-Sol' },
  });
  sent: Array<Record<string, unknown>> = [];
  results: Array<{ id: string; callId: string; output: ToolOutput }> = [];
  telemetryRecords: Array<Record<string, unknown>> = [];
  private listeners = new Set<(m: LlmInbound) => void>();
  get codexReady() {
    return this.online && this.status.value.codex.state === 'ok';
  }
  onLlm(l: (m: LlmInbound) => void) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
  llmStart(id: string, text: string, instructions: string, thread?: string) {
    this.sent.push({ t: 'llm.start', id, text, instructions, thread });
    return this.online;
  }
  llmSteer(id: string, target: string, text: string) {
    this.sent.push({ t: 'llm.steer', id, target, text });
    return this.online;
  }
  llmStop(id: string) {
    this.sent.push({ t: 'llm.stop', id });
    return this.online;
  }
  llmAnswer(id: string, question: string, answers: Record<string, string[]>) {
    this.sent.push({ t: 'llm.answer', id, question, answers });
    return true;
  }
  llmForget(thread: string) {
    this.sent.push({ t: 'llm.forget', thread });
    return true;
  }
  toolResult(id: string, callId: string, output: ToolOutput) {
    this.results.push({ id, callId, output });
    return true;
  }
  codexRetry() {
    return true;
  }
  telemetry(record: Record<string, unknown>) {
    this.telemetryRecords.push(record);
  }
  emit(m: LlmInbound) {
    for (const l of this.listeners) l(m);
  }
  event(id: string, event: LlmEvent) {
    this.emit({ t: 'llm.event', id, event });
  }
  done(
    id: string,
    status: 'completed' | 'interrupted' | 'failed' = 'completed',
    error?: { message: string; fix?: string; code?: string },
  ) {
    this.event(id, { kind: 'done', status, ...(error ? { error } : {}), ms: 10 });
  }
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
  last(t: string) {
    return [...this.sent].reverse().find(m => m.t === t);
  }
}

const WOBBLE = {
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
};

let session: KitSession, requests: AiRequests, t: FakeTransport, llm: LlmController;
let compileResult: Awaited<ReturnType<WorkspaceDeps['compile']>>;
function setup(options: { stopGraceMs?: number } = {}) {
  session = testSession();
  session.loadStarter('bass');
  requests = new AiRequests(session);
  t = new FakeTransport();
  compileResult = { ok: true, ms: 300 };
  llm = new LlmController(session, requests, t as unknown as LlmTransport, {
    stopGraceMs: options.stopGraceMs,
    deps: {
      compile: async () => compileResult,
      render: async () => {
        const s = new Float32Array(9600).map((_, i) => Math.sin(i / 9) * 0.3);
        return { report: analyse([s, s], 48000), renderMs: 5 };
      },
    },
  });
  session.llm = llm;
}
beforeEach(() => setup());
const line = (id: string) => requests.history.value.find(o => o.id === id)!;
/** The patch's content, independent of key order (undo re-adds a removed cable at the end). */
const snapshot = () => {
  const d = clone(session.doc.value);
  const sort = <T>(o: Record<string, T>) =>
    Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify({ ...d, revision: 0, nodes: sort(d.nodes), edges: sort(d.edges) });
};
const startId = () => String(t.last('llm.start')!.id);

describe('a request', () => {
  it('replaces reconnecting progress when output resumes and clears loading after a failed connection', () => {
    const o = llm.run('make a sequencer');
    t.event(o.id, { kind: 'retrying', message: 'Connection refused' });
    expect(line(o.id)).toMatchObject({
      live: true,
      activity: expect.stringMatching(/reconnecting/),
    });
    t.event(o.id, { kind: 'delta', text: 'Working on the sequencer.' });
    expect(line(o.id)).toMatchObject({
      activity: 'responding…',
      reply: 'Working on the sequencer.',
    });
    t.done(o.id, 'failed', { code: 'connection-timeout', message: 'ChatGPT could not reconnect.' });
    expect(line(o.id)).toMatchObject({ live: false, status: 'failed' });
    expect(llm.busy.value).toBe(false);
    const again = llm.run('try again');
    expect(t.last('llm.start')!.id).toBe(again.id);
    t.done(again.id);
  });

  it('lands on the live patch step by step; one ⌘Z takes the whole request back', async () => {
    const before = snapshot();
    const undoSteps = session.history.size;
    const o = llm.run('wobble the cutoff');
    expect(o).toMatchObject({ status: 'thinking', route: 'llm', live: true });
    const start = t.last('llm.start')!;
    expect(String(start.text)).toMatch(
      /^\[den-kit\] You edit the live patch; each edit that checks out lands at once\.[\s\S]*wobble the cutoff$/,
    );
    expect(String(start.instructions)).toContain('kit_get_patch');
    expect(String(start.instructions)).toContain('den.lfo');
    t.event(o.id, { kind: 'thread', thread: 'th1', fresh: false });
    const edit = await t.call(o.id, 'c1', 'kit_apply_ops', WOBBLE);
    expect(edit.text).toMatch(/Applied 7 edits.*live now.*Compiled OK/s);
    // Live at once, while the request is still running.
    expect(session.doc.value.nodes.lfo2).toBeDefined();
    expect(line(o.id).live).toBe(true);
    expect(session.history.peek()!.author).toMatchObject({ kind: 'ai-llm', take: o.id });
    // A call sent again after a reconnect gets the same answer and is not applied twice.
    const again = await t.call(o.id, 'c1', 'kit_apply_ops', WOBBLE);
    expect(again).toBe(edit);
    const second = await t.call(o.id, 'c2', 'kit_apply_ops', {
      ops: [{ op: 'setValue', node: 'lfo2', port: 'rate', value: 7 }],
    });
    expect(second.success).toBe(true);
    expect(session.history.size).toBe(undoSteps + 1); // both steps are one undo step
    expect(line(o.id).steps!.join(' ')).toMatch(/\+ lfo2.*✓/);
    await t.call(o.id, 'c3', 'kit_finish', { summary: 'Added an LFO wobbling the cutoff' });
    t.done(o.id);
    expect(line(o.id)).toMatchObject({
      status: 'applied',
      label: 'Added an LFO wobbling the cutoff',
      live: false,
    });
    expect(llm.busy.value).toBe(false);
    session.undo();
    expect(snapshot()).toBe(before);
    expect(line(o.id).undone).toBe(true);
  });

  it('an edit by the user in between stays their own: the request undoes in two parts around it', async () => {
    const before = snapshot();
    const undoSteps = session.history.size;
    const o = llm.run('wobble and open it');
    await t.call(o.id, 'c1', 'kit_apply_ops', WOBBLE);
    session.commit([{ op: 'setValue', node: 'filter1', port: 'resonance', value: 2 }]); // the user, meanwhile
    await t.call(o.id, 'c2', 'kit_apply_ops', {
      ops: [{ op: 'setValue', node: 'cut1', port: 'hz', value: 900 }],
    });
    t.done(o.id);
    expect(line(o.id).status).toBe('applied');
    expect(session.history.size).toBe(undoSteps + 3);
    session.undo(); // the LLM's second part
    expect(session.doc.value.nodes.cut1!.values.hz).not.toBe(900);
    expect(session.doc.value.nodes.filter1!.values.resonance).toBe(2);
    session.undo();
    session.undo();
    expect(snapshot()).toBe(before);
  });

  it('a reply without changes shows the words; a follow-up continues the conversation', async () => {
    const o = llm.run('how does this work?');
    t.event(o.id, { kind: 'thread', thread: 'th1', fresh: false });
    await t.call(o.id, 'c1', 'kit_get_patch', {});
    t.event(o.id, { kind: 'delta', text: 'An oscillator ' });
    expect(line(o.id).reply).toBe('An oscillator ');
    t.event(o.id, { kind: 'message', text: 'An oscillator goes through a filter.' });
    t.done(o.id);
    expect(line(o.id)).toMatchObject({
      status: 'reply',
      reply: 'An oscillator goes through a filter.',
    });
    llm.run('make it darker');
    expect(t.last('llm.start')!.thread).toBe('th1');
    expect(String(t.last('llm.start')!.text)).toMatch(/may have changed since your last turn/);
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
    expect(t.last('llm.steer')).toMatchObject({
      id: steer.id,
      target: first.id,
      text: expect.stringMatching(/adds, while you work[\s\S]*make it darker/),
    });
    t.event(steer.id, { kind: 'steered', target: first.id });
    expect(line(steer.id)).toMatchObject({ status: 'merged', live: false });
    expect(line(first.id).steps!.at(-1)).toMatch(/you added: “make it darker”/);
    const late = llm.run('and wider');
    t.event(late.id, {
      kind: 'done',
      status: 'failed',
      error: { message: 'That request has already finished.', code: 'not-steerable' },
      ms: 0,
    });
    expect(line(late.id)).toMatchObject({
      status: 'thinking',
      message: expect.stringMatching(/waits/),
    });
    t.done(first.id);
    expect(t.last('llm.start')).toMatchObject({
      id: late.id,
      text: expect.stringMatching(/and wider$/),
    });
    expect(llm.busy.value).toBe(true);
  });

  it('Esc stops it; what already landed stays and one ⌘Z takes it back; if Codex never confirms, it ends anyway', async () => {
    const before = snapshot();
    const o = llm.run('wobble');
    await t.call(o.id, 'c1', 'kit_apply_ops', WOBBLE);
    expect(llm.stop()).toBe(true);
    expect(t.last('llm.stop')).toEqual({ t: 'llm.stop', id: o.id });
    expect(line(o.id).activity).toBe('stopping…');
    // A tool call racing the stop does not land.
    const late = await t.call(o.id, 'c2', 'kit_apply_ops', {
      ops: [{ op: 'setValue', node: 'cut1', port: 'hz', value: 50 }],
    });
    expect(late.success).toBe(false);
    t.done(o.id, 'interrupted');
    expect(line(o.id)).toMatchObject({
      status: 'stopped',
      message: 'Stopped.',
      note: expect.stringMatching(/stays; ⌘Z takes it back/),
    });
    expect(session.doc.value.nodes.lfo2).toBeDefined();
    session.undo();
    expect(snapshot()).toBe(before);

    setup({ stopGraceMs: 30 });
    const p = llm.run('wobble');
    llm.stop();
    await new Promise(r => setTimeout(r, 60));
    expect(line(p.id)).toMatchObject({ status: 'stopped', note: 'Nothing was changed.' });
    expect(llm.busy.value).toBe(false);
  });

  it('⌘Z on what the running request did stops it', async () => {
    const o = llm.run('wobble');
    await t.call(o.id, 'c1', 'kit_apply_ops', WOBBLE);
    session.undo();
    expect(t.last('llm.stop')).toEqual({ t: 'llm.stop', id: o.id });
    t.done(o.id, 'interrupted');
    expect(line(o.id)).toMatchObject({
      status: 'stopped',
      message: 'You undid its edit, so it stopped.',
    });
    expect(session.doc.value.nodes.lfo2).toBeUndefined();
  });

  it('loading another patch stops it, and nothing more lands on the new patch', async () => {
    const o = llm.run('wobble');
    session.loadStarter('pad');
    expect(t.last('llm.stop')).toEqual({ t: 'llm.stop', id: o.id });
    const r = await t.call(o.id, 'c1', 'kit_apply_ops', WOBBLE);
    expect(r.success).toBe(false);
    expect(session.doc.value.nodes.lfo2).toBeUndefined();
    t.done(o.id, 'interrupted');
    expect(line(o.id)).toMatchObject({
      status: 'stopped',
      message: 'A different patch was loaded, so it stopped.',
    });
  });

  it('Codex questions are never put to the user: answered empty at once, and it goes on', async () => {
    const o = llm.run('ask me');
    t.event(o.id, {
      kind: 'question',
      question: 'q7',
      blocking: true,
      items: [
        {
          id: 'size',
          header: 'Size',
          question: 'How big?',
          options: ['Small', 'Large'],
          other: false,
        },
      ],
    });
    expect(t.last('llm.answer')).toEqual({
      t: 'llm.answer',
      id: o.id,
      question: 'q7',
      answers: {},
    });
    expect(line(o.id).message).toBeUndefined();
    expect(line(o.id).steps!.at(-1)).toMatch(/skipped a question/);
  });

  it('a tool call for a request that already ended gets no answer', async () => {
    const o = llm.run('explain');
    t.done(o.id);
    t.emit({ t: 'tool.call', id: o.id, callId: 'late', tool: 'kit_get_patch', args: {} });
    await new Promise(r => setTimeout(r, 20));
    expect(t.results.filter(r => r.callId === 'late')).toEqual([]);
  });
});

describe('when something does not work', () => {
  it('an edit that does not compile lands nothing; Codex gets the problem and can fix it', async () => {
    compileResult = {
      ok: false,
      message: 'boom',
      issues: [{ severity: 'error', code: 'compile', message: 'boom', node: 'lfo2' }],
    };
    const o = llm.run('wobble');
    const r = await t.call(o.id, 'c1', 'kit_apply_ops', WOBBLE);
    expect(r).toMatchObject({
      success: false,
      text: expect.stringMatching(/would not compile: boom[\s\S]*Nothing was applied/),
    });
    expect(session.doc.value.nodes.lfo2).toBeUndefined();
    compileResult = { ok: true, ms: 10 };
    expect((await t.call(o.id, 'c2', 'kit_apply_ops', WOBBLE)).success).toBe(true);
    t.done(o.id);
    expect(line(o.id).status).toBe('applied');
    expect(session.doc.value.nodes.lfo2).toBeDefined();
  });

  it('a failure says why and what to do (and that what landed stays)', async () => {
    const o = llm.run('wobble');
    await t.call(o.id, 'c1', 'kit_apply_ops', WOBBLE);
    t.done(o.id, 'failed', {
      message: 'Your ChatGPT plan’s Codex usage limit is reached.',
      fix: 'Wait for the limit to reset.',
      code: 'usageLimitExceeded',
    });
    expect(line(o.id)).toMatchObject({
      status: 'failed',
      message: expect.stringMatching(/usage limit/),
      fix: 'Wait for the limit to reset.',
      note: expect.stringMatching(/stays/),
    });
  });

  it('a request the bridge lost (it restarted) fails instead of waiting forever', () => {
    const o = llm.run('wobble');
    t.emit({ t: 'welcome', running: [] });
    expect(line(o.id)).toMatchObject({
      status: 'failed',
      message: expect.stringMatching(/restarted and lost/),
    });
    const p = llm.run('wobble again');
    t.emit({ t: 'welcome', running: [p.id] });
    expect(line(p.id).status).toBe('thinking');
  });

  it('Codex not signed in: the line says what to run', () => {
    t.status.value = {
      ...t.status.value,
      codex: { state: 'login', fix: 'Run `npm run codex:login` once.' },
    };
    const o = llm.run('wobble');
    expect(o).toMatchObject({
      status: 'failed',
      message: expect.stringMatching(/not signed in.*codex:login/),
    });
    expect(t.sent).toEqual([]);
  });
});

describe('the prompt sends every request to the LLM', () => {
  it.each([
    'write a granular codebox',
    'brighter',
    'longer release',
    'undo that',
    'more',
    'make it a part',
    'layer eight copies',
  ])('%s waits for the LLM instead of editing locally', text => {
    const before = snapshot();
    const undoSteps = session.history.size;
    const o: Outcome = requests.run(text);
    expect(o).toMatchObject({ route: 'llm', status: 'thinking' });
    expect(String(t.last('llm.start')!.text).endsWith(`\n\n${text}`)).toBe(true);
    expect(snapshot()).toBe(before);
    expect(session.history.size).toBe(undoSteps);
  });

  it('a short request while the LLM works steers the running request and preserves the patch', () => {
    const before = snapshot();
    const busy = requests.run('slow please');
    const added = requests.run('longer release');
    expect(added).toMatchObject({ status: 'thinking', route: 'llm' });
    expect(t.last('llm.steer')).toMatchObject({
      id: added.id,
      target: busy.id,
      text: expect.stringMatching(/longer release$/),
    });
    t.event(added.id, { kind: 'steered', target: busy.id });
    expect(line(added.id)).toMatchObject({ status: 'merged', route: 'llm' });
    expect(line(busy.id).status).toBe('thinking');
    expect(snapshot()).toBe(before);
  });

  it('an unavailable LLM explains the failure without interpreting the phrase or changing the patch', () => {
    t.status.value = {
      codex: {
        state: 'error',
        detail: 'Codex stopped unexpectedly.',
        fix: 'Run `npm run doctor`.',
      },
    };
    const before = snapshot();
    const undoSteps = session.history.size;
    const o = requests.run('brighter');
    expect(o).toMatchObject({
      status: 'failed',
      route: 'llm',
      message: expect.stringMatching(/not available: Codex stopped unexpectedly.*doctor/),
    });
    expect(t.sent).toEqual([]);
    expect(snapshot()).toBe(before);
    expect(session.history.size).toBe(undoSteps);
  });

  it('a missing LLM controller fails without changing the patch; blank input sends no request', () => {
    session.llm = null;
    const before = snapshot();
    expect(requests.run('undo that')).toMatchObject({
      status: 'failed',
      route: 'llm',
      message: expect.stringMatching(/Connect ChatGPT/),
    });
    expect(requests.run('  ')).toMatchObject({ status: 'nothing', route: 'none', text: '' });
    expect(t.sent).toEqual([]);
    expect(snapshot()).toBe(before);
  });
});
