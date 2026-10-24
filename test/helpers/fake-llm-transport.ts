// A scripted bridge for the LLM controller in unit tests: records what the
// browser sends (with the start options: den-kit's notes, pictures) and plays
// what the runtime would send back (events, tool calls, sub-agents) for any
// request id. Conversations it "keeps" are read back from `conversations`.
import { shallowRef } from 'vue';
import type {
  AIStatus,
  ConversationLine,
  LlmEvent,
  LlmInbound,
  LlmStartOptions,
  ToolOutput,
  TokenUsage,
} from '../../src/host/ai.ts';
import { developerWording } from '../../dev/ai-wording.ts';

export class FakeLlmTransport {
  online = true;
  readonly wording = developerWording;
  readonly status = shallowRef<AIStatus>({
    codex: { state: 'ok', images: false, model: 'GPT-6.1-Sol' },
  });
  sent: Array<Record<string, unknown>> = [];
  results: Array<{ id: string; callId: string; output: ToolOutput }> = [];
  telemetryRecords: Array<Record<string, unknown>> = [];
  /** What the runtime keeps of each conversation. */
  conversations = new Map<string, ConversationLine[]>();
  private listeners = new Set<(m: LlmInbound) => void>();
  get codexReady() {
    return this.online && this.status.value.codex.state === 'ok';
  }
  onStatus() {
    return () => {};
  }
  onLlm(l: (m: LlmInbound) => void) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
  llmStart(
    id: string,
    text: string,
    instructions: string,
    thread?: string,
    options: LlmStartOptions = {},
  ) {
    this.sent.push({ t: 'llm.start', id, text, instructions, thread, ...options });
    return this.online;
  }
  llmSteer(id: string, target: string, text: string, options: LlmStartOptions = {}) {
    this.sent.push({ t: 'llm.steer', id, target, text, ...options });
    return this.online;
  }
  conversation(thread: string) {
    return Promise.resolve(this.conversations.get(thread) ?? null);
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
  event(id: string, event: LlmEvent, agent?: string) {
    this.emit({ t: 'llm.event', id, event, ...(agent ? { agent } : {}) });
  }
  /** A sub-agent the request's AI started (the runtime's id for it). */
  agentStarted(id: string, agent: string, name: string) {
    this.event(id, { kind: 'agent', agent, name, state: 'started' }, agent);
  }
  agentEnded(
    id: string,
    agent: string,
    status: 'completed' | 'interrupted' | 'failed' = 'completed',
  ) {
    this.event(id, { kind: 'agent', agent, name: '', state: 'ended', status }, agent);
  }
  done(
    id: string,
    status: 'completed' | 'interrupted' | 'failed' = 'completed',
    error?: { message: string; fix?: string; code?: string },
  ) {
    this.event(id, { kind: 'done', status, ...(error ? { error } : {}), ms: 10 });
  }
  usage(id: string, input: number, output: number, cached = 0) {
    const u = (i: number, o: number, c: number): TokenUsage => ({
      input: i,
      cached: c,
      output: o,
      reasoning: 0,
      total: i + o,
    });
    this.event(id, {
      kind: 'usage',
      total: u(input, output, cached),
      last: u(input, output, cached),
      window: 272000,
    });
  }
  /** Send a tool call and wait for its result. */
  async call(
    id: string,
    callId: string,
    tool: string,
    args: unknown,
    timeoutMs = 2000,
    agent?: string,
  ): Promise<ToolOutput> {
    const before = this.results.filter(r => r.callId === callId).length;
    this.emit({ t: 'tool.call', id, callId, tool, args, ...(agent ? { agent } : {}) });
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const found = this.results.filter(r => r.callId === callId);
      if (found.length > before) return found.at(-1)!.output;
      await new Promise(r => setTimeout(r, 2));
    }
    throw new Error(`no result for ${callId}`);
  }
  last(t: string, id?: string) {
    return [...this.sent].reverse().find(m => m.t === t && (id === undefined || m.id === id));
  }
  all(t: string) {
    return this.sent.filter(m => m.t === t);
  }
}
