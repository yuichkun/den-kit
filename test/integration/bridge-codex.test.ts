// The LLM path end to end below the browser: a WebSocket tab ↔ the bridge ↔
// CodexClient ↔ the fake app-server process. Tool calls are answered here with
// canned results; the browser's real tools are covered in llm-workspace and e2e.
import { afterEach, describe, expect, it } from 'vitest';
import { createBridge, type Bridge } from '../../bridge/server.ts';
import { PROTOCOL_VERSION, WS_PATH, type LlmEvent, type ServerMessage, type ToolOutput } from '../../src/ai/protocol.ts';
import { connect, type TestSocket } from '../helpers/ws-client.ts';
import { fakeCodex, type FakeCodex } from '../helpers/fake-codex.ts';
import type { CodexClientOptions } from '../../bridge/codex/client.ts';

const ORIGIN = 'http://127.0.0.1:5180';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

async function setup(options: { signedIn?: boolean; env?: Record<string, string>; client?: Partial<CodexClientOptions>; graceMs?: number; start?: boolean } = {}) {
  const fake = fakeCodex(options);
  const bridge = await createBridge({ origins: [ORIGIN], codex: fake.client, llmGraceMs: options.graceMs ?? 30000 });
  cleanups.push(async () => { await bridge.close(); await fake.cleanup(); });
  if (options.start !== false) await fake.client.start();
  return { fake, bridge };
}
async function tab(bridge: Bridge, name = 'tab-a'): Promise<TestSocket> {
  const s = await connect(`ws://127.0.0.1:${bridge.port}${WS_PATH}`, ORIGIN);
  s.send({ t: 'hello', protocol: PROTOCOL_VERSION, token: bridge.token, tab: name });
  expect((await s.nextOf('welcome')).t).toBe('welcome');
  return s;
}
const until = async (fn: () => boolean, ms = 5000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('condition not met'); await new Promise(r => setTimeout(r, 10)); } };

type Answer = (call: { tool: string; args: unknown; callId: string }) => ToolOutput | null;
const canned: Answer = call => ({
  kit_get_patch: { success: true, text: '{"nodes":[{"id":"cut1"},{"id":"filter1"}]}' },
  kit_apply_ops: { success: true, text: 'Applied 7 edits. Compiled OK in 0.4 s.' },
  kit_listen: { success: true, text: 'Peak −6 dB.', imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
  kit_finish: { success: true, text: 'OK.' },
  kit_write_codebox: { success: true, text: 'Code saved. Compiled OK in 0.2 s.' },
} as Record<string, ToolOutput>)[call.tool] ?? { success: false, text: 'unknown' };

/** Collect one request's events until `done` (or `steered`), answering its tool calls. */
async function collect(s: TestSocket, id: string, answer: Answer = canned, options: { timeoutMs?: number; until?: (e: LlmEvent) => boolean } = {}) {
  const events: LlmEvent[] = [];
  const calls: Array<{ tool: string; args: unknown; callId: string }> = [];
  const end = Date.now() + (options.timeoutMs ?? 10000);
  for (;;) {
    const m = await s.next(Math.max(1, end - Date.now())) as ServerMessage;
    if (process.env.DEBUG_COLLECT) console.log(id, JSON.stringify(m).slice(0, 160));
    if (m.t === 'tool.call' && m.id === id) {
      calls.push({ tool: m.tool, args: m.args, callId: m.callId });
      const out = answer({ tool: m.tool, args: m.args, callId: m.callId });
      if (out) s.send({ t: 'tool.result', id, callId: m.callId, output: out });
      continue;
    }
    if (m.t !== 'llm.event' || m.id !== id) continue;
    events.push(m.event);
    if (m.event.kind === 'done' || m.event.kind === 'steered' || options.until?.(m.event)) return { events, calls };
  }
}
const start = (s: TestSocket, id: string, text: string, thread?: string) => s.send({ t: 'llm.start', id, text, thread, instructions: 'You edit a synth patch.' });
const doneOf = (events: LlmEvent[]) => events.find((e): e is Extract<LlmEvent, { kind: 'done' }> => e.kind === 'done');
const noViolations = (fake: FakeCodex) => expect(fake.violations()).toEqual([]);

describe('bounded model connection states', () => {
  it('keeps the connection deadline even when an idle check finds a pending tool', async () => {
    const { bridge, fake } = await setup({ client: { timeouts: { idleMs: 60, retryMs: 150, toolMs: 1000 } } });
    const s = await tab(bridge);
    start(s, 'pending', 'connection failure during tool');
    expect(doneOf((await collect(s, 'pending', () => null)).events)).toMatchObject({ status: 'failed', error: { code: 'connection-timeout' } });
    expect(fake.client.busy).toBe(false);
    noViolations(fake);
  });

  it('allows a slow tool to finish without treating it as model silence', async () => {
    const { bridge, fake } = await setup({ client: { timeouts: { idleMs: 60, toolMs: 1000 } } });
    const s = await tab(bridge);
    start(s, 'tool', 'explain this');
    const call = await s.nextOf('tool.call');
    await new Promise(r => setTimeout(r, 180));
    expect(fake.client.busy).toBe(true);
    s.send({ t: 'tool.result', id: 'tool', callId: call.callId, output: { success: true, text: '{}' } });
    expect(doneOf((await collect(s, 'tool')).events)?.status).toBe('completed');
    noViolations(fake);
  });

  it('ends repeated connection failures, releases busy state, and accepts a fresh request', async () => {
    const { bridge, fake } = await setup({ client: { timeouts: { retryMs: 150, idleMs: 1000 } } });
    const s = await tab(bridge);
    start(s, 'failed', 'persistent connection failure');
    const { events } = await collect(s, 'failed');
    expect(events.filter(e => e.kind === 'retrying').length).toBeGreaterThan(1);
    expect(doneOf(events)).toMatchObject({ status: 'failed', error: { code: 'connection-timeout' } });
    expect(fake.client.busy).toBe(false);
    expect(fake.sent('turn/interrupt')).toHaveLength(1);
    expect(fake.sent('thread/unsubscribe')).toHaveLength(1);
    start(s, 'next', 'explain this');
    expect(doneOf((await collect(s, 'next')).events)?.status).toBe('completed');
    expect(fake.sent('thread/start')).toHaveLength(2);
    noViolations(fake);
  });

  it('clears the retry deadline when model output resumes', async () => {
    const { bridge, fake } = await setup({ client: { timeouts: { retryMs: 150, idleMs: 1000 } } });
    const s = await tab(bridge);
    start(s, 'recovered', 'retry then progress');
    const { events } = await collect(s, 'recovered');
    expect(events.some(e => e.kind === 'retrying')).toBe(true);
    expect(doneOf(events)?.status).toBe('completed');
    expect(fake.sent('turn/interrupt')).toHaveLength(0);
    noViolations(fake);
  });

  it('ends an unresponsive model without waiting for a completion notification', async () => {
    const { bridge, fake } = await setup({ client: { timeouts: { idleMs: 150 } } });
    const s = await tab(bridge);
    start(s, 'silent', 'silent model');
    expect(doneOf((await collect(s, 'silent')).events)).toMatchObject({ status: 'failed', error: { code: 'response-timeout' } });
    expect(fake.client.busy).toBe(false);
    noViolations(fake);
  });

  it('stops a reconnecting request without a later timeout changing its result', async () => {
    const { bridge, fake } = await setup({ client: { timeouts: { retryMs: 150 } } });
    const s = await tab(bridge);
    start(s, 'stop', 'persistent connection failure');
    await collect(s, 'stop', canned, { until: e => e.kind === 'retrying' });
    s.send({ t: 'llm.stop', id: 'stop' });
    expect(doneOf((await collect(s, 'stop')).events)?.status).toBe('interrupted');
    await new Promise(r => setTimeout(r, 200));
    expect(fake.client.busy).toBe(false);
    expect(fake.sent('turn/interrupt')).toHaveLength(1);
    noViolations(fake);
  });
});

describe('Codex start-up and status', () => {
  it('signed in: ok, with the default model, image support, plan and the busiest usage window', async () => {
    const { bridge, fake } = await setup();
    const s = await tab(bridge);
    s.send({ t: 'status.get', id: 's1' });
    const { status } = await s.nextOf('status');
    expect(status.codex).toMatchObject({ state: 'ok', model: 'GPT-6.1-Sol', images: true, plan: 'plus' });
    await until(() => bridge.status().codex.rateLimit?.usedPercent === 12);
    const init = fake.sent('initialize')[0]!.params as Record<string, unknown>;
    expect(init).toMatchObject({ clientInfo: { name: 'den-kit' }, capabilities: { experimentalApi: true, requestAttestation: false } });
    noViolations(fake);
  });

  it('not signed in: `login` with the command to run; a request says so; the login is picked up by itself', async () => {
    const { bridge, fake } = await setup({ signedIn: false });
    expect(fake.client.status).toMatchObject({ state: 'login' });
    expect(fake.client.status.fix).toContain('npm run codex:login');
    const s = await tab(bridge);
    start(s, 'r1', 'wobble the cutoff');
    const done = doneOf((await collect(s, 'r1')).events)!;
    expect(done).toMatchObject({ status: 'failed', error: { code: 'login' } });
    fake.signIn();
    await until(() => fake.client.status.state === 'ok');
    noViolations(fake);
  });

  it('a process that dies at start is restarted, then reported with a fix', async () => {
    const { fake } = await setup({ env: { FAKE_CODEX_FAULT: 'crash-on-start' } });
    await until(() => fake.client.status.state === 'error', 8000);
    expect(fake.client.status.detail).toMatch(/stopped unexpectedly/);
    expect(fake.client.status.fix).toMatch(/doctor/);
    expect(fake.client.stats.boots).toBe(4); // first start + 3 restarts
  });

  it('an app-server that never answers initialize is stopped and restarted', async () => {
    const { fake } = await setup({ env: { FAKE_CODEX_FAULT: 'hang-initialize' }, client: { timeouts: { initializeMs: 200 } } });
    await until(() => fake.client.status.state === 'error', 8000);
    expect(fake.client.status.detail).toMatch(/initialize got no reply/);
  });

  it('junk on stdout before the replies is ignored', async () => {
    const { fake } = await setup({ env: { FAKE_CODEX_FAULT: 'garbage', FAKE_CODEX_SPLIT: '1' } });
    expect(fake.client.status.state).toBe('ok');
    expect(fake.client.stats.malformed).toBeGreaterThan(0);
  });
});

describe('a turn', () => {
  it('starts an isolated thread, relays tool calls and results, streams the reply and ends once', async () => {
    const { bridge, fake } = await setup();
    const s = await tab(bridge);
    start(s, 'r1', 'wobble the cutoff');
    const { events, calls } = await collect(s, 'r1');
    expect(calls.map(c => c.tool)).toEqual(['kit_get_patch', 'kit_apply_ops', 'kit_listen', 'kit_finish']);
    expect(events[0]).toMatchObject({ kind: 'thread', fresh: false });
    expect(events.map(e => e.kind)).toContain('started');
    expect(events.map(e => e.kind)).toContain('activity'); // thinking
    expect(events.filter(e => e.kind === 'delta').map(e => (e as { text: string }).text).join('')).toBe('Done.');
    expect(events.filter(e => e.kind === 'done')).toHaveLength(1);
    expect(doneOf(events)!.status).toBe('completed');

    const thread = fake.sent('thread/start')[0]!.params as Record<string, unknown>;
    expect(thread).toMatchObject({ ephemeral: true, environments: [], sandbox: 'read-only', approvalPolicy: 'never', developerInstructions: 'You edit a synth patch.', config: { web_search: 'disabled' } });
    expect((thread.config as { features: Record<string, boolean> }).features).toMatchObject({ multi_agent: false, apps: false, shell_tool: false, plugins: false });
    expect((thread.dynamicTools as Array<{ name: string }>).map(t => t.name)).toEqual(['kit_get_patch', 'kit_list_blocks', 'kit_describe_block', 'kit_apply_ops', 'kit_write_codebox', 'kit_listen', 'kit_get_plugin', 'kit_ui_reference', 'kit_view_picture', 'kit_look', 'kit_bash', 'kit_read_file', 'kit_write_file', 'kit_finish']);
    expect(String(thread.cwd)).toContain('work');
    // The spectrogram went back as an image because the model accepts images.
    const listen = fake.replies().find(r => JSON.stringify(r).includes('Peak'))!;
    expect((listen.result as { contentItems: Array<{ type: string }> }).contentItems.map(c => c.type)).toEqual(['inputText', 'inputImage']);
    noViolations(fake);
  });

  it('a follow-up continues the same conversation; another tab cannot', async () => {
    const { bridge, fake } = await setup();
    const a = await tab(bridge, 'tab-a');
    start(a, 'r1', 'how does this work?');
    const first = await collect(a, 'r1');
    const thread = (first.events[0] as { thread: string }).thread;
    start(a, 'r2', 'and now wobble it', thread);
    const second = await collect(a, 'r2');
    expect(second.events.some(e => e.kind === 'thread')).toBe(false);
    expect(fake.sent('thread/start')).toHaveLength(1);
    const b = await tab(bridge, 'tab-b');
    start(b, 'r3', 'explain', thread);
    const third = await collect(b, 'r3');
    expect(third.events[0]).toMatchObject({ kind: 'thread' });
    expect((third.events[0] as { thread: string }).thread).not.toBe(thread);
    noViolations(fake);
  });

  it('steering adds text to the running turn', async () => {
    const { bridge, fake } = await setup();
    const s = await tab(bridge);
    start(s, 'r1', 'slow please');
    await collect(s, 'r1', canned, { until: e => e.kind === 'activity' });
    s.send({ t: 'llm.steer', id: 'r2', target: 'r1', text: 'make it darker' });
    const steered = await collect(s, 'r2');
    expect(steered.events).toEqual([{ kind: 'steered', target: 'r1' }]);
    const { calls, events } = await collect(s, 'r1');
    expect(calls.find(c => c.tool === 'kit_apply_ops')!.args).toEqual({ ops: [{ op: 'setValue', node: 'cut1', port: 'hz', value: 150 }] });
    expect(doneOf(events)!.status).toBe('completed');
    expect(fake.sent('turn/steer')[0]!.params).toMatchObject({ expectedTurnId: expect.any(String), input: [{ type: 'text', text: 'make it darker', text_elements: [] }] });
    // Steering a finished request fails, so the browser sends it as a new request.
    s.send({ t: 'llm.steer', id: 'r3', target: 'r1', text: 'more' });
    expect(doneOf((await collect(s, 'r3')).events)).toMatchObject({ status: 'failed', error: { code: 'not-steerable' } });
    noViolations(fake);
  });

  it('stop interrupts the turn; a tool call racing the interrupt is refused, not run', async () => {
    const { bridge, fake } = await setup();
    const s = await tab(bridge);
    start(s, 'r1', 'stop me');
    await collect(s, 'r1', canned, { until: e => e.kind === 'started' });
    await new Promise(r => setTimeout(r, 100));
    s.send({ t: 'llm.stop', id: 'r1' });
    const { events, calls } = await collect(s, 'r1');
    expect(doneOf(events)!.status).toBe('interrupted');
    expect(calls.map(c => c.tool)).not.toContain('kit_apply_ops');
    expect(fake.sent('turn/interrupt')).toHaveLength(1);
    noViolations(fake);
  });

  it('usage limit and sign-in failures say what to do', async () => {
    const { bridge } = await setup();
    const s = await tab(bridge);
    start(s, 'r1', 'usage limit please');
    expect(doneOf((await collect(s, 'r1')).events)).toMatchObject({ status: 'failed', error: { code: 'usageLimitExceeded', fix: expect.stringMatching(/limit to reset/) } });
    start(s, 'r2', 'unauthorized please');
    expect(doneOf((await collect(s, 'r2')).events)).toMatchObject({ status: 'failed', error: { code: 'unauthorized', fix: expect.stringMatching(/codex:login/) } });
  });

  it('an error Codex will retry is progress, not failure', async () => {
    const { bridge } = await setup();
    const s = await tab(bridge);
    start(s, 'r1', 'flaky network');
    const { events } = await collect(s, 'r1');
    expect(events.some(e => e.kind === 'retrying')).toBe(true);
    expect(doneOf(events)!.status).toBe('completed');
  });

  it('every request for powers den-kit never grants is declined; unknown requests get an error', async () => {
    const { bridge, fake } = await setup();
    const s = await tab(bridge);
    start(s, 'r1', 'run a shell command');
    const { events } = await collect(s, 'r1');
    const said = JSON.parse((events.find(e => e.kind === 'message') as { text: string }).text);
    expect(said).toEqual({ command: 'decline', file: 'decline', perms: 'turn', mcp: 'decline', legacy: { denied: { rejection: expect.any(String) } }, time: 'number', unknown: 'error' });
    expect(events.filter(e => e.kind === 'activity' && e.what === 'blocked').map(e => (e as { detail: string }).detail)).toEqual(['a shell command', 'a file change', 'extra permissions', 'an MCP request', 'a shell command']);
    expect(fake.client.stats.declined).toBe(5);
    noViolations(fake);
  });

  it('Codex questions reach the tab; a blocking one waits for the answer, an optional one resolves itself', async () => {
    const { bridge, fake } = await setup();
    const s = await tab(bridge);
    start(s, 'r1', 'ask me with codex');
    const { events } = await collect(s, 'r1', canned, { until: e => e.kind === 'question' });
    const q = events.at(-1) as Extract<LlmEvent, { kind: 'question' }>;
    expect(q).toMatchObject({ blocking: true, items: [{ id: 'size', question: 'How big?', options: ['Small', 'Large'] }] });
    s.send({ t: 'llm.answer', id: 'r1', question: q.question, answers: { size: ['Large'] } });
    const rest = await collect(s, 'r1');
    expect(rest.events.find(e => e.kind === 'message')).toMatchObject({ text: 'You chose Large.' });
    start(s, 'r2', 'optional question');
    const auto = await collect(s, 'r2');
    expect(auto.events.map(e => e.kind)).toContain('question.resolved');
    expect(auto.events.find(e => e.kind === 'message')).toMatchObject({ text: 'auto: {}' });
    noViolations(fake);
  });

  it('a tool the model invents is refused without reaching the tab', async () => {
    const { bridge } = await setup();
    const s = await tab(bridge);
    start(s, 'r1', 'unknown tool please');
    const { events, calls } = await collect(s, 'r1');
    expect(calls).toEqual([]);
    expect(events.find(e => e.kind === 'message')).toMatchObject({ text: expect.stringMatching(/^refused: Unknown tool "kit_rm_rf"/) });
  });

  it('a tab that never answers a tool call: the call fails after the deadline and the turn stops', async () => {
    const { bridge, fake } = await setup({ client: { timeouts: { toolMs: 300 } } });
    const s = await tab(bridge);
    start(s, 'r1', 'hang forever');
    const { events } = await collect(s, 'r1', () => null);
    expect(doneOf(events)).toMatchObject({ status: 'interrupted', error: { message: expect.stringMatching(/did not answer a tool call/) } });
    const reply = fake.replies().find(r => JSON.stringify(r).includes('did not answer in time'));
    expect(reply).toBeDefined();
    noViolations(fake);
  });

  it('usage updates reach the status', async () => {
    const { bridge } = await setup();
    const s = await tab(bridge);
    start(s, 'r1', 'rate limits');
    await collect(s, 'r1');
    await until(() => bridge.status().codex.rateLimit?.usedPercent === 87);
  });

  it('junk lines in the middle of a turn are skipped', async () => {
    const { bridge, fake } = await setup();
    const s = await tab(bridge);
    start(s, 'r1', 'garbage');
    const { events } = await collect(s, 'r1');
    expect(doneOf(events)!.status).toBe('completed');
    expect(fake.client.stats.malformed).toBeGreaterThanOrEqual(2);
  });

  it('a crash mid-turn fails the request with a clear message; Codex restarts and the next request works', async () => {
    const { bridge, fake } = await setup();
    const s = await tab(bridge);
    start(s, 'r1', 'crash now');
    const { events } = await collect(s, 'r1');
    expect(doneOf(events)).toMatchObject({ status: 'failed', error: { code: 'crashed', message: expect.stringMatching(/restarts by itself/) } });
    await until(() => fake.client.status.state === 'ok');
    start(s, 'r2', 'explain this');
    expect(doneOf((await collect(s, 'r2')).events)!.status).toBe('completed');
  });

  it('four turns at once is the limit (a lead and three members)', async () => {
    const { bridge } = await setup();
    const s = await tab(bridge);
    for (const id of ['a', 'b', 'c', 'd']) start(s, id, 'slow please');
    start(s, 'e', 'slow please');
    expect(doneOf((await collect(s, 'e')).events)).toMatchObject({ status: 'failed', error: { code: 'busy' } });
    for (const id of ['a', 'b', 'c', 'd']) s.send({ t: 'llm.stop', id });
  });
});

describe('members, pictures and token counts (U8)', () => {
  const tools = (params: Record<string, unknown>) => (params.dynamicTools as Array<{ name: string }>).map(t => t.name);
  it('the role picks the tools: a lead can start members, a member and a request alone cannot', async () => {
    const { bridge, fake } = await setup();
    const s = await tab(bridge);
    for (const [id, role] of [['p1', 'lead'], ['p2', 'member'], ['p3', 'solo']] as const) {
      s.send({ t: 'llm.start', id, text: 'explain', instructions: 'You edit a synth patch.', role });
      expect(doneOf((await collect(s, id)).events)!.status).toBe('completed');
    }
    const [lead, member, solo] = fake.sent('thread/start').map(m => tools(m.params as Record<string, unknown>));
    for (const name of ['kit_delegate', 'kit_wait', 'kit_tell', 'kit_stop_member']) {
      expect(lead).toContain(name);
      expect(member).not.toContain(name);
      expect(solo).not.toContain(name);
    }
    expect(member).toContain('kit_finish');
    noViolations(fake);
  });
  it('a lead tool called in a conversation that does not have it is refused before it reaches the tab', async () => {
    const { bridge, fake } = await setup();
    const s = await tab(bridge);
    s.send({ t: 'llm.start', id: 'u1', text: 'unknown tool', instructions: 'x', role: 'member' });
    const { events, calls } = await collect(s, 'u1');
    expect(calls).toEqual([]);
    expect(events.find(e => e.kind === 'message')).toMatchObject({ text: expect.stringMatching(/^refused: Unknown tool/) });
    noViolations(fake);
  });
  it('pictures come with a request and with an addition to it', async () => {
    const { bridge, fake } = await setup();
    const s = await tab(bridge);
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    s.send({ t: 'llm.start', id: 'k1', text: 'look at my sketch', instructions: 'x', images: [png, png] });
    const first = await collect(s, 'k1', canned, { until: e => e.kind === 'message' });
    expect(first.events.find(e => e.kind === 'message')).toMatchObject({ text: 'pictures: 2' });
    s.send({ t: 'llm.steer', id: 'k2', target: 'k1', text: 'and this one', images: [png] });
    const rest = await collect(s, 'k1');
    expect(rest.events.filter(e => e.kind === 'message').at(-1)).toMatchObject({ text: 'after "and this one": pictures 3' });
    const input = (fake.sent('turn/start')[0]!.params as { input: Array<{ type: string }> }).input;
    expect(input.map(i => i.type)).toEqual(['text', 'image', 'image']);
    expect((fake.sent('turn/steer')[0]!.params as { input: Array<{ type: string }> }).input.map(i => i.type)).toEqual(['text', 'image']);
    noViolations(fake);
  });
  it('pictures that are not data:image URLs, too many of them, or a fork for anyone but a member are refused', async () => {
    const { bridge } = await setup();
    const s = await tab(bridge);
    s.send({ t: 'llm.start', id: 'b1', text: 'x', instructions: 'x', images: ['https://example.com/a.png'] });
    expect(await s.nextOf('error')).toMatchObject({ message: expect.stringMatching(/images/) });
    s.send({ t: 'llm.start', id: 'b2', text: 'x', instructions: 'x', images: Array(5).fill('data:image/png;base64,AA') });
    expect(await s.nextOf('error')).toMatchObject({ message: expect.stringMatching(/images/) });
    s.send({ t: 'llm.start', id: 'b3', text: 'x', instructions: 'x', role: 'lead', fork: { thread: 'abc', fallback: 'y' } });
    expect(await s.nextOf('error')).toMatchObject({ message: expect.stringMatching(/member/) });
  });
  it('token counts of a conversation reach the tab', async () => {
    const { bridge } = await setup();
    const s = await tab(bridge);
    start(s, 't1', 'count my tokens');
    const { events } = await collect(s, 't1');
    const usage = events.filter((e): e is Extract<LlmEvent, { kind: 'usage' }> => e.kind === 'usage');
    expect(usage[0]).toMatchObject({ total: { input: 1200, output: 300, cached: 900, reasoning: 120, total: 1500 }, last: { input: 1200 }, window: 272000 });
    expect(usage.at(-1)).toMatchObject({ total: { input: 1600, output: 400, cached: 1250 }, last: { input: 400, output: 100 } });
  });
  it('a member starts from a copy of the lead\'s conversation when forking is on, with its own rules and the same isolation', async () => {
    const { bridge, fake } = await setup({ client: { fork: true } });
    const s = await tab(bridge);
    s.send({ t: 'llm.start', id: 'L1', text: 'explain', instructions: 'You lead.', role: 'lead' });
    const lead = await collect(s, 'L1');
    const thread = (lead.events.find(e => e.kind === 'thread') as { thread: string }).thread;
    s.send({ t: 'llm.start', id: 'M1', text: '[den-kit] You are a member. Your part: Screen.', instructions: 'You are a member.', role: 'member', fork: { thread, fallback: '[den-kit] The conversation so far: …' } });
    const member = await collect(s, 'M1');
    expect(member.events.find(e => e.kind === 'thread')).toMatchObject({ forked: true });
    expect(member.events.find(e => e.kind === 'message')).toMatchObject({ text: 'forked=yes; begins: [den-kit] You are a member. Your part: Screen.' });
    expect(fake.sent('thread/fork')[0]!.params).toMatchObject({ threadId: thread, ephemeral: true, sandbox: 'read-only', approvalPolicy: 'never', developerInstructions: 'You are a member.', config: { web_search: 'disabled' } });
    noViolations(fake);
  });
  it('when Codex cannot copy the conversation (or forking is off), the member starts fresh with den-kit\'s account first', async () => {
    for (const setupOptions of [{ client: { fork: true }, env: { FAKE_CODEX_FORK: 'refuse' } }, {}]) {
      const { bridge, fake } = await setup(setupOptions);
      const s = await tab(bridge);
      s.send({ t: 'llm.start', id: 'L1', text: 'explain', instructions: 'You lead.', role: 'lead' });
      const thread = ((await collect(s, 'L1')).events.find(e => e.kind === 'thread') as { thread: string }).thread;
      s.send({ t: 'llm.start', id: 'M1', text: '[den-kit] You are a member. Your part: Sound.', instructions: 'You are a member.', role: 'member', fork: { thread, fallback: '[den-kit] You are a member — the conversation so far: …' } });
      const member = await collect(s, 'M1');
      expect(member.events.find(e => e.kind === 'thread')).toMatchObject({ forked: false });
      expect(member.events.find(e => e.kind === 'message')).toMatchObject({ text: expect.stringMatching(/^forked=no; begins: \[den-kit\] You are a member — the conversation so far/) });
      expect(tools(fake.sent('thread/start').at(-1)!.params as Record<string, unknown>)).not.toContain('kit_delegate');
      noViolations(fake);
    }
  });
  it('another tab\'s conversation cannot be copied', async () => {
    const { bridge, fake } = await setup({ client: { fork: true } });
    const a = await tab(bridge, 'tab-a');
    a.send({ t: 'llm.start', id: 'L1', text: 'explain', instructions: 'x', role: 'lead' });
    const thread = ((await collect(a, 'L1')).events.find(e => e.kind === 'thread') as { thread: string }).thread;
    const b = await tab(bridge, 'tab-b');
    b.send({ t: 'llm.start', id: 'M1', text: '[den-kit] You are a member. Your part: X.', instructions: 'x', role: 'member', fork: { thread, fallback: 'nothing of yours' } });
    expect((await collect(b, 'M1')).events.find(e => e.kind === 'thread')).toMatchObject({ forked: false });
    expect(fake.sent('thread/fork')).toEqual([]);
  });
  it('effort "ultra" is not sent (it would start Codex\'s own sub-agents)', async () => {
    const { bridge, fake } = await setup({ client: { effort: 'ultra' } });
    const s = await tab(bridge);
    start(s, 'e1', 'explain');
    await collect(s, 'e1');
    expect(fake.sent('turn/start')[0]!.params).not.toHaveProperty('effort');
  });
});

describe('tabs coming and going', () => {
  it('a reconnecting tab gets what it missed and the tool call again', async () => {
    const { bridge, fake } = await setup();
    const s1 = await tab(bridge, 'tab-r');
    start(s1, 'r1', 'wobble the cutoff');
    const first = await collect(s1, 'r1', () => null, { until: () => false, timeoutMs: 1500 }).catch(() => null);
    void first;
    s1.ws.close();
    await new Promise(r => setTimeout(r, 100));
    const s2 = await tab(bridge, 'tab-r');
    const { calls, events } = await collect(s2, 'r1');
    expect(calls[0]!.tool).toBe('kit_get_patch'); // re-sent after the reconnect
    expect(doneOf(events)!.status).toBe('completed');
    noViolations(fake);
  });

  it('a tab that does not come back has its requests stopped and its conversations closed', async () => {
    const { bridge, fake } = await setup({ graceMs: 200 });
    const s = await tab(bridge, 'tab-gone');
    start(s, 'r1', 'slow please');
    await collect(s, 'r1', canned, { until: e => e.kind === 'activity' });
    s.ws.close();
    await until(() => fake.sent('turn/interrupt').length === 1, 3000);
    await until(() => fake.sent('thread/unsubscribe').length === 1, 3000);
  });

  it('only the asking tab can answer its question or deliver its tool results', async () => {
    const { bridge } = await setup();
    const a = await tab(bridge, 'tab-a');
    const b = await tab(bridge, 'tab-b');
    start(a, 'r1', 'ask me with codex');
    const { events } = await collect(a, 'r1', canned, { until: e => e.kind === 'question' });
    const q = events.at(-1) as Extract<LlmEvent, { kind: 'question' }>;
    b.send({ t: 'llm.answer', id: 'r1', question: q.question, answers: { size: ['Small'] } });
    expect((await b.nextOf('error')).message).toMatch(/no longer open/);
    a.send({ t: 'llm.answer', id: 'r1', question: q.question, answers: { size: ['Large'] } });
    expect((await collect(a, 'r1')).events.find(e => e.kind === 'message')).toMatchObject({ text: 'You chose Large.' });
  });

  it('without Codex the bridge says the LLM path is off', async () => {
    const bridge = await createBridge({ origins: [ORIGIN] });
    cleanups.push(() => bridge.close());
    const s = await tab(bridge);
    expect(bridge.status().codex.state).toBe('off');
    start(s, 'r1', 'hello');
    expect(doneOf((await collect(s, 'r1')).events)).toMatchObject({ status: 'failed', error: { code: 'off' } });
  });

  it('malformed LLM messages are refused with a reason', async () => {
    const { bridge } = await setup();
    const s = await tab(bridge);
    s.send({ t: 'llm.start', id: 'r1', text: '', instructions: '' });
    expect((await s.nextOf('error')).message).toMatch(/llm.start text/);
    s.send({ t: 'tool.result', id: 'r1', callId: 'c', output: { success: true, text: 'x', imageDataUrl: 'javascript:alert(1)' } });
    expect((await s.nextOf('error')).message).toMatch(/image/);
  });
});
