// Browser ↔ bridge WebSocket protocol. Dependency-free and erasable-only so the
// Node bridge (type stripping) and the browser share exactly these types.

export const PROTOCOL_VERSION = 1;
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
export interface JevStatus { state: 'off' | 'unknown' | 'ok' | 'error'; detail?: string; model?: string; lastMs?: number }
export interface CodexStatus { state: 'off' | 'starting' | 'ok' | 'login' | 'error'; detail?: string; model?: string; plan?: string; rateLimit?: { usedPercent: number; resetsAt: number | null } | null }
export interface BridgeStatus { jev: JevStatus; codex: CodexStatus }

// ---- Messages ------------------------------------------------------------------
export type ClientMessage =
  | { t: 'hello'; protocol: number; token: string; tab: string; writer: boolean }
  | { t: 'writer'; writer: boolean }
  | { t: 'status.get'; id: string }
  | { t: 'jev.ask'; id: string; request: JevRequest; budgetMs?: number }
  | { t: 'jev.cancel'; id: string }
  | { t: 'telemetry'; record: Record<string, unknown> };

export type ServerMessage =
  | { t: 'welcome'; protocol: number; bridge: string; status: BridgeStatus }
  | { t: 'status'; id?: string; status: BridgeStatus }
  | { t: 'jev.result'; id: string; result: JevResult }
  | { t: 'error'; message: string; ref?: string };

export function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Shape check for messages from the browser (the bridge never trusts the socket). */
export function parseClientMessage(raw: string): ClientMessage | { error: string } {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return { error: 'not JSON' }; }
  if (!isObject(data) || typeof data.t !== 'string') return { error: 'missing message type' };
  switch (data.t) {
    case 'hello': return typeof data.protocol === 'number' && typeof data.token === 'string' && typeof data.tab === 'string' ? { t: 'hello', protocol: data.protocol, token: data.token, tab: data.tab.slice(0, 64), writer: data.writer !== false } : { error: 'bad hello' };
    case 'writer': return { t: 'writer', writer: data.writer === true };
    case 'status.get': return typeof data.id === 'string' ? { t: 'status.get', id: data.id } : { error: 'status.get needs id' };
    case 'jev.ask': return typeof data.id === 'string' && isObject(data.request) && isObject(data.request.questions) ? { t: 'jev.ask', id: data.id, request: data.request as unknown as JevRequest, budgetMs: typeof data.budgetMs === 'number' ? data.budgetMs : undefined } : { error: 'bad jev.ask' };
    case 'jev.cancel': return typeof data.id === 'string' ? { t: 'jev.cancel', id: data.id } : { error: 'bad jev.cancel' };
    case 'telemetry': return isObject(data.record) ? { t: 'telemetry', record: data.record } : { error: 'bad telemetry' };
    default: return { error: `unknown message type "${String(data.t)}"` };
  }
}
