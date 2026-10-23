// Page ↔ bridge WebSocket protocol, for the hosts that run the agent runtime
// behind a local bridge (desktop/ and dev/). The request and event types are the
// AI interface's (src/host/ai.ts); this file adds the wire messages. Dependency-free
// and erasable-only, so the Node bridge (type stripping) and the page share it.
import type { AIStatus, LlmEvent, LlmRole, ToolOutput } from '../src/host/ai.ts';
import {
  LLM_ROLES,
  MAX_FORK_TEXT,
  MAX_INSTRUCTIONS,
  MAX_LLM_IMAGES,
  MAX_LLM_TEXT,
  MAX_TOOL_IMAGE,
  MAX_TOOL_TEXT,
} from '../src/host/ai.ts';

export type {
  AIStatus,
  CodexStatus,
  LlmError,
  LlmEvent,
  LlmQuestion,
  LlmRole,
  TokenUsage,
  ToolOutput,
} from '../src/host/ai.ts';
export {
  LLM_ROLES,
  MAX_FORK_TEXT,
  MAX_INSTRUCTIONS,
  MAX_LLM_IMAGES,
  MAX_LLM_TEXT,
  MAX_TOOL_IMAGE,
  MAX_TOOL_TEXT,
};
/** The bridge's status message. */
export type BridgeStatus = AIStatus;

export const PROTOCOL_VERSION = 4;
export const WS_PATH = '/__kit/ws';
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

/** Close codes the bridge uses to explain a refusal. */
export const CLOSE = {
  badToken: 4401,
  badOrigin: 4403,
  protocol: 4409,
  helloTimeout: 4408,
  replaced: 4410,
} as const;

// ---- Messages ------------------------------------------------------------------
export type ClientMessage =
  | { t: 'hello'; protocol: number; token: string; tab: string }
  | { t: 'status.get'; id: string }
  | { t: 'telemetry'; record: Record<string, unknown> }
  /**
   * Start an LLM turn; `thread` continues an earlier conversation, `instructions` is used for a new one.
   * `role` picks the tools (default solo). `images` are data: URLs that come with the text. `fork`: a member
   * that starts from a copy of the lead's conversation; when Codex cannot copy it, the new conversation
   * starts with `fallback` (den-kit's account of that conversation) before the text.
   */
  | {
      t: 'llm.start';
      id: string;
      text: string;
      thread?: string;
      instructions: string;
      role?: LlmRole;
      images?: string[];
      fork?: { thread: string; fallback: string };
    }
  /** Add `text` (and pictures) to the running turn of request `target` (answered with `steered` or a failed `done`). */
  | { t: 'llm.steer'; id: string; target: string; text: string; images?: string[] }
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
  | { t: 'llm.event'; id: string; event: LlmEvent }
  /** Run a kit_* tool for request `id` and answer with `tool.result` (the same callId may arrive again after a reconnect). */
  | { t: 'tool.call'; id: string; callId: string; tool: string; args: unknown }
  | { t: 'error'; message: string; ref?: string };

export function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128;
/** Pictures sent with a request: absent, or up to MAX_LLM_IMAGES data:image/ URLs of at most MAX_TOOL_IMAGE characters. */
function images(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_LLM_IMAGES) return null;
  return value.every(
    v => typeof v === 'string' && v.startsWith('data:image/') && v.length <= MAX_TOOL_IMAGE,
  )
    ? (value as string[])
    : null;
}

/** Shape check for messages from the browser (the bridge never trusts the socket). */
export function parseClientMessage(raw: string): ClientMessage | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { error: 'not JSON' };
  }
  if (!isObject(data) || typeof data.t !== 'string') return { error: 'missing message type' };
  switch (data.t) {
    case 'hello':
      return typeof data.protocol === 'number' &&
        typeof data.token === 'string' &&
        typeof data.tab === 'string'
        ? { t: 'hello', protocol: data.protocol, token: data.token, tab: data.tab.slice(0, 64) }
        : { error: 'bad hello' };
    case 'status.get':
      return typeof data.id === 'string'
        ? { t: 'status.get', id: data.id }
        : { error: 'status.get needs id' };
    case 'telemetry':
      return isObject(data.record)
        ? { t: 'telemetry', record: data.record }
        : { error: 'bad telemetry' };
    case 'llm.start': {
      if (
        !isId(data.id) ||
        typeof data.text !== 'string' ||
        typeof data.instructions !== 'string' ||
        (data.thread !== undefined && !isId(data.thread))
      )
        return { error: 'bad llm.start' };
      if (!data.text.trim() || data.text.length > MAX_LLM_TEXT)
        return { error: `llm.start text must be 1–${MAX_LLM_TEXT} characters` };
      if (data.instructions.length > MAX_INSTRUCTIONS)
        return { error: 'llm.start instructions are too long' };
      if (data.role !== undefined && !LLM_ROLES.includes(data.role as LlmRole))
        return { error: 'bad llm.start role' };
      const pictures = images(data.images);
      if (pictures === null)
        return { error: `llm.start images must be up to ${MAX_LLM_IMAGES} data:image/ URLs` };
      let fork: { thread: string; fallback: string } | undefined;
      if (data.fork !== undefined) {
        const f = data.fork;
        if (
          !isObject(f) ||
          !isId(f.thread) ||
          typeof f.fallback !== 'string' ||
          f.fallback.length > MAX_FORK_TEXT
        )
          return { error: 'bad llm.start fork' };
        if (data.role !== 'member')
          return { error: "only a member starts from a copy of the lead's conversation" };
        fork = { thread: f.thread, fallback: f.fallback };
      }
      return {
        t: 'llm.start',
        id: data.id,
        text: data.text,
        thread: data.thread as string | undefined,
        instructions: data.instructions,
        ...(data.role ? { role: data.role as LlmRole } : {}),
        ...(pictures?.length ? { images: pictures } : {}),
        ...(fork ? { fork } : {}),
      };
    }
    case 'llm.steer': {
      if (
        !isId(data.id) ||
        !isId(data.target) ||
        typeof data.text !== 'string' ||
        !data.text.trim() ||
        data.text.length > MAX_LLM_TEXT
      )
        return { error: 'bad llm.steer' };
      const pictures = images(data.images);
      if (pictures === null)
        return { error: `llm.steer images must be up to ${MAX_LLM_IMAGES} data:image/ URLs` };
      return {
        t: 'llm.steer',
        id: data.id,
        target: data.target,
        text: data.text,
        ...(pictures?.length ? { images: pictures } : {}),
      };
    }
    case 'llm.stop':
      return isId(data.id) ? { t: 'llm.stop', id: data.id } : { error: 'bad llm.stop' };
    case 'llm.answer': {
      if (!isId(data.id) || !isId(data.question) || !isObject(data.answers))
        return { error: 'bad llm.answer' };
      const answers: Record<string, string[]> = {};
      for (const [key, value] of Object.entries(data.answers)) {
        if (!Array.isArray(value) || !value.every(v => typeof v === 'string' && v.length <= 2000))
          return { error: 'bad llm.answer' };
        answers[key.slice(0, 200)] = value as string[];
      }
      return { t: 'llm.answer', id: data.id, question: data.question, answers };
    }
    case 'llm.forget':
      return isId(data.thread)
        ? { t: 'llm.forget', thread: data.thread }
        : { error: 'bad llm.forget' };
    case 'tool.result': {
      const o = data.output;
      if (
        !isId(data.id) ||
        !isId(data.callId) ||
        !isObject(o) ||
        typeof o.success !== 'boolean' ||
        typeof o.text !== 'string'
      )
        return { error: 'bad tool.result' };
      if (
        o.imageDataUrl !== undefined &&
        (typeof o.imageDataUrl !== 'string' ||
          !o.imageDataUrl.startsWith('data:image/') ||
          o.imageDataUrl.length > MAX_TOOL_IMAGE)
      )
        return { error: 'bad tool.result image' };
      return {
        t: 'tool.result',
        id: data.id,
        callId: data.callId,
        output: {
          success: o.success,
          text: o.text.slice(0, MAX_TOOL_TEXT),
          imageDataUrl: o.imageDataUrl as string | undefined,
        },
      };
    }
    case 'codex.retry':
      return { t: 'codex.retry' };
    default:
      return { error: `unknown message type "${String(data.t)}"` };
  }
}
