// Browser ↔ bridge WebSocket protocol. Dependency-free and erasable-only so the
// Node bridge (type stripping) and the browser share exactly these types.

export const PROTOCOL_VERSION = 2;
export const WS_PATH = '/__kit/ws';
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

/** Close codes the bridge uses to explain a refusal. */
export const CLOSE = { badToken: 4401, badOrigin: 4403, protocol: 4409, helloTimeout: 4408, replaced: 4410 } as const;

// ---- Jev (TypeSafe System One) wire shapes -------------------------------------
export type JevInstructions = string | Record<string, unknown> | unknown[];
export type JevQuestion =
  | { type: 'noul'; instructions: JevInstructions; criteria?: { true?: unknown; false?: unknown } }
  | { type: 'choice'; instructions: JevInstructions; criteria: Record<string, unknown> }
  | { type: 'score'; instructions: JevInstructions; criteria: unknown[] };
export interface JevRequest { state: unknown; questions: Record<string, JevQuestion> }
/** As received; the browser validates every answer (see src/ai/jev-answers.ts). */
export interface JevResponse { model: string; answers: Record<string, unknown>; usage?: { input_tokens?: number; output_tokens?: number } }
export type JevErrorKind = 'off' | 'auth' | 'invalid' | 'busy' | 'server' | 'network' | 'timeout' | 'malformed' | 'too-large' | 'cancelled';
export type JevResult =
  | { ok: true; response: JevResponse; ms: number; modelWarning?: string }
  | { ok: false; error: { kind: JevErrorKind; message: string; status?: number; retryAfterMs?: number }; ms: number };

// ---- Status --------------------------------------------------------------------
export interface JevStatus { state: 'off' | 'unknown' | 'ok' | 'error'; detail?: string; model?: string; lastMs?: number; /** Default time budget per request (KIT_JEV_BUDGET_MS). */ budgetMs?: number }
export interface CodexStatus {
  state: 'off' | 'starting' | 'ok' | 'login' | 'error';
  detail?: string;
  /** What to do about `login` / `error` (a command to run, a setting to change). */
  fix?: string;
  model?: string;
  plan?: string;
  /** The model accepts images (kit_listen attaches a spectrogram). */
  images?: boolean;
  /** The busiest usage window of the ChatGPT plan (resetsAt in Unix seconds). */
  rateLimit?: { usedPercent: number; resetsAt: number | null } | null;
}
export interface BridgeStatus { jev: JevStatus; codex: CodexStatus }

// ---- LLM turns (Codex) ------------------------------------------------------------
/** What a kit_* tool returns to the model (the browser runs the tools; see src/ai/llm-workspace.ts). */
export interface ToolOutput { success: boolean; text: string; imageDataUrl?: string }
export interface LlmQuestion { id: string; header: string; question: string; options: string[]; other: boolean }
export interface LlmError { message: string; code?: string; fix?: string }
/** Progress of one LLM request (`id`), in order. Exactly one `done` ends it. */
export type LlmEvent =
  /** The conversation this turn runs in; `fresh` when an earlier one was lost (Codex restarted). */
  | { kind: 'thread'; thread: string; fresh: boolean }
  | { kind: 'started'; turn: string }
  | { kind: 'delta'; text: string }
  | { kind: 'message'; text: string }
  /** thinking, or something den-kit refused (a shell command, a file change, …). */
  | { kind: 'activity'; what: string; detail?: string }
  | { kind: 'retrying'; message: string }
  | { kind: 'question'; question: string; items: LlmQuestion[]; blocking: boolean }
  | { kind: 'question.resolved'; question: string }
  /** A steer request (`llm.steer`) reached the running turn. */
  | { kind: 'steered'; target: string }
  | { kind: 'done'; status: 'completed' | 'interrupted' | 'failed'; error?: LlmError; ms: number };

export const MAX_TOOL_TEXT = 100_000;
export const MAX_TOOL_IMAGE = 2_000_000;
export const MAX_INSTRUCTIONS = 60_000;
export const MAX_LLM_TEXT = 4_000;

// ---- Messages ------------------------------------------------------------------
export type ClientMessage =
  | { t: 'hello'; protocol: number; token: string; tab: string }
  | { t: 'status.get'; id: string }
  | { t: 'jev.ask'; id: string; request: JevRequest; budgetMs?: number }
  | { t: 'jev.cancel'; id: string }
  | { t: 'telemetry'; record: Record<string, unknown> }
  /** Start an LLM turn; `thread` continues an earlier conversation, `instructions` is used for a new one. */
  | { t: 'llm.start'; id: string; text: string; thread?: string; instructions: string }
  /** Add `text` to the running turn of request `target` (answered with `steered` or a failed `done`). */
  | { t: 'llm.steer'; id: string; target: string; text: string }
  | { t: 'llm.stop'; id: string }
  | { t: 'llm.answer'; id: string; question: string; answers: Record<string, string[]> }
  | { t: 'llm.forget'; thread: string }
  | { t: 'tool.result'; id: string; callId: string; output: ToolOutput }
  /** Restart Codex now (after signing in, or after an error). */
  | { t: 'codex.retry' };

export type ServerMessage =
  /** `running`: this tab's LLM requests the bridge still knows (after a reconnect, others were lost). */
  | { t: 'welcome'; protocol: number; bridge: string; status: BridgeStatus; running?: string[] }
  | { t: 'status'; id?: string; status: BridgeStatus }
  | { t: 'jev.result'; id: string; result: JevResult }
  | { t: 'llm.event'; id: string; event: LlmEvent }
  /** Run a kit_* tool for request `id` and answer with `tool.result` (the same callId may arrive again after a reconnect). */
  | { t: 'tool.call'; id: string; callId: string; tool: string; args: unknown }
  | { t: 'error'; message: string; ref?: string };

export function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128;

/** Shape check for messages from the browser (the bridge never trusts the socket). */
export function parseClientMessage(raw: string): ClientMessage | { error: string } {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return { error: 'not JSON' }; }
  if (!isObject(data) || typeof data.t !== 'string') return { error: 'missing message type' };
  switch (data.t) {
    case 'hello': return typeof data.protocol === 'number' && typeof data.token === 'string' && typeof data.tab === 'string' ? { t: 'hello', protocol: data.protocol, token: data.token, tab: data.tab.slice(0, 64) } : { error: 'bad hello' };
    case 'status.get': return typeof data.id === 'string' ? { t: 'status.get', id: data.id } : { error: 'status.get needs id' };
    case 'jev.ask': return typeof data.id === 'string' && isObject(data.request) && isObject(data.request.questions) ? { t: 'jev.ask', id: data.id, request: data.request as unknown as JevRequest, budgetMs: typeof data.budgetMs === 'number' ? data.budgetMs : undefined } : { error: 'bad jev.ask' };
    case 'jev.cancel': return typeof data.id === 'string' ? { t: 'jev.cancel', id: data.id } : { error: 'bad jev.cancel' };
    case 'telemetry': return isObject(data.record) ? { t: 'telemetry', record: data.record } : { error: 'bad telemetry' };
    case 'llm.start':
      if (!isId(data.id) || typeof data.text !== 'string' || typeof data.instructions !== 'string' || (data.thread !== undefined && !isId(data.thread))) return { error: 'bad llm.start' };
      if (!data.text.trim() || data.text.length > MAX_LLM_TEXT) return { error: `llm.start text must be 1–${MAX_LLM_TEXT} characters` };
      if (data.instructions.length > MAX_INSTRUCTIONS) return { error: 'llm.start instructions are too long' };
      return { t: 'llm.start', id: data.id, text: data.text, thread: data.thread as string | undefined, instructions: data.instructions };
    case 'llm.steer': return isId(data.id) && isId(data.target) && typeof data.text === 'string' && data.text.trim() && data.text.length <= MAX_LLM_TEXT ? { t: 'llm.steer', id: data.id, target: data.target, text: data.text } : { error: 'bad llm.steer' };
    case 'llm.stop': return isId(data.id) ? { t: 'llm.stop', id: data.id } : { error: 'bad llm.stop' };
    case 'llm.answer': {
      if (!isId(data.id) || !isId(data.question) || !isObject(data.answers)) return { error: 'bad llm.answer' };
      const answers: Record<string, string[]> = {};
      for (const [key, value] of Object.entries(data.answers)) {
        if (!Array.isArray(value) || !value.every(v => typeof v === 'string' && v.length <= 2000)) return { error: 'bad llm.answer' };
        answers[key.slice(0, 200)] = value as string[];
      }
      return { t: 'llm.answer', id: data.id, question: data.question, answers };
    }
    case 'llm.forget': return isId(data.thread) ? { t: 'llm.forget', thread: data.thread } : { error: 'bad llm.forget' };
    case 'tool.result': {
      const o = data.output;
      if (!isId(data.id) || !isId(data.callId) || !isObject(o) || typeof o.success !== 'boolean' || typeof o.text !== 'string') return { error: 'bad tool.result' };
      if (o.imageDataUrl !== undefined && (typeof o.imageDataUrl !== 'string' || !o.imageDataUrl.startsWith('data:image/') || o.imageDataUrl.length > MAX_TOOL_IMAGE)) return { error: 'bad tool.result image' };
      return { t: 'tool.result', id: data.id, callId: data.callId, output: { success: o.success, text: o.text.slice(0, MAX_TOOL_TEXT), imageDataUrl: o.imageDataUrl as string | undefined } };
    }
    case 'codex.retry': return { t: 'codex.retry' };
    default: return { error: `unknown message type "${String(data.t)}"` };
  }
}
