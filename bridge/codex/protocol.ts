// The subset of the Codex app-server protocol (CLI 0.160.1, v2 API) that den-kit
// uses, curated from `codex app-server generate-ts --experimental`. The shapes
// were checked against the real 0.160.1 server offline (see the probe notes in
// test/fakes/codex/README.md); test/fakes/codex mimics exactly this.
//
// Wire format: one JSON-RPC message per line on stdio, without "jsonrpc".

export const CODEX_VERSION = '0.160.1';

export type RequestId = string | number;
export interface RpcRequest { id: RequestId; method: string; params?: unknown }
export interface RpcNotification { method: string; params?: unknown }
export interface RpcErrorBody { code: number; message: string; data?: unknown }
export type RpcResponse = { id: RequestId; result: unknown } | { id: RequestId; error: RpcErrorBody };
/** The server uses -32600 for every refusal ("Not initialized", "no active turn to steer", …). */
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;

// ---- initialize ---------------------------------------------------------------------
export interface InitializeParams {
  clientInfo: { name: string; title: string | null; version: string };
  capabilities: { experimentalApi: boolean; requestAttestation: boolean } | null;
}
export interface InitializeResponse { userAgent: string; codexHome: string; platformFamily: string; platformOs: string }

// ---- account and models ------------------------------------------------------------------
export type Account = { type: 'apiKey' } | { type: 'chatgpt'; email: string | null; planType: string } | { type: 'amazonBedrock'; usesCodexManagedCredentials: boolean };
export interface GetAccountResponse { account: Account | null; requiresOpenaiAuth: boolean }
export interface Model {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  inputModalities: Array<'text' | 'image' | 'audio'>;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
}
export interface ModelListResponse { data: Model[]; nextCursor: string | null }
export interface RateLimitWindow { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null }
export interface RateLimitSnapshot { limitId: string | null; primary: RateLimitWindow | null; secondary: RateLimitWindow | null; planType: string | null; rateLimitReachedType?: string | null }
export interface GetAccountRateLimitsResponse { rateLimits: RateLimitSnapshot }

// ---- threads and turns --------------------------------------------------------------------
export interface DynamicToolSpec { type: 'function'; name: string; description: string; inputSchema: unknown }
export interface ThreadStartParams {
  model?: string | null;
  cwd?: string | null;
  approvalPolicy?: 'untrusted' | 'on-request' | 'never';
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  config?: Record<string, unknown> | null;
  developerInstructions?: string | null;
  ephemeral?: boolean | null;
  environments?: unknown[] | null;
  dynamicTools?: DynamicToolSpec[] | null;
}
export interface Thread { id: string; model: string | null; cwd: string; ephemeral: boolean }
export interface ThreadStartResponse {
  thread: Thread;
  model: string;
  cwd: string;
  /** Instruction files (AGENTS.md, …) loaded for the thread: must be empty for den-kit. */
  instructionSources: string[];
  approvalPolicy: unknown;
  sandbox: { type: string; networkAccess?: boolean };
}
/** Text, or a picture by URL (den-kit sends data: URLs: a sketch over the screen). */
export type UserInput = { type: 'text'; text: string; text_elements: unknown[] } | { type: 'image'; url: string };
/**
 * A copy of a conversation (a member that starts from the lead's). The copy keeps the source's tools
 * (there is no dynamicTools here) and takes its own instructions and isolation.
 */
export interface ThreadForkParams {
  threadId: string;
  model?: string | null;
  cwd?: string | null;
  approvalPolicy?: 'untrusted' | 'on-request' | 'never';
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  config?: Record<string, unknown> | null;
  developerInstructions?: string | null;
  ephemeral?: boolean;
}
export interface TurnStartParams { threadId: string; input: UserInput[]; effort?: string | null }
export type TurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress';
/** "usageLimitExceeded", { httpConnectionFailed: { httpStatusCode } }, … */
export type CodexErrorInfo = string | Record<string, { httpStatusCode?: number | null } | Record<string, unknown>>;
export interface TurnError { message: string; codexErrorInfo: CodexErrorInfo | null; additionalDetails: string | null }
export interface Turn { id: string; status: TurnStatus; error: TurnError | null; durationMs: number | null }
export interface TurnStartResponse { turn: Turn }
export interface TurnSteerParams { threadId: string; input: UserInput[]; expectedTurnId: string }
export interface TurnSteerResponse { turnId: string }
export interface TurnInterruptParams { threadId: string; turnId: string }
/** Tokens of one conversation: all of it, and its last model call. */
export interface TokenUsageBreakdown { totalTokens: number; inputTokens: number; cachedInputTokens: number; cacheWriteInputTokens: number; outputTokens: number; reasoningOutputTokens: number }
export interface ThreadTokenUsage { total: TokenUsageBreakdown; last: TokenUsageBreakdown; modelContextWindow: number | null }
export interface ThreadTokenUsageUpdatedNotification { threadId: string; turnId: string; tokenUsage: ThreadTokenUsage }

// ---- items -------------------------------------------------------------------------------------
export type ToolContentItem = { type: 'inputText'; text: string } | { type: 'inputImage'; imageUrl: string } | { type: 'inputAudio'; audioUrl: string };
export type ThreadItem =
  | { type: 'userMessage'; id: string }
  | { type: 'agentMessage'; id: string; text: string }
  | { type: 'reasoning'; id: string; summary: string[] }
  | { type: 'dynamicToolCall'; id: string; tool: string; status: 'inProgress' | 'completed' | 'failed'; success: boolean | null; durationMs: number | null }
  | { type: string; id: string; [key: string]: unknown };
/** Item types a den-kit turn may produce; anything else (commandExecution, mcpToolCall, webSearch, …) is reported. */
export const EXPECTED_ITEMS = new Set(['userMessage', 'agentMessage', 'reasoning', 'dynamicToolCall', 'plan', 'contextCompaction']);

// ---- server → client requests ------------------------------------------------------------------
export interface DynamicToolCallParams { threadId: string; turnId: string; callId: string; namespace: string | null; tool: string; arguments: unknown }
export interface DynamicToolCallResponse { contentItems: ToolContentItem[]; success: boolean }
export interface UserInputQuestion { id: string; header: string; question: string; isOther: boolean; isSecret: boolean; options: Array<{ label: string; description: string }> | null }
export interface ToolRequestUserInputParams { threadId: string; turnId: string; itemId: string; questions: UserInputQuestion[]; isBlocking: boolean; autoResolutionMs: number | null }
export interface ToolRequestUserInputResponse { answers: Record<string, { answers: string[] }> }

/** Answers den-kit gives to requests it never wants to grant (an unanswered request stalls the turn). */
export const DECLINE: Record<string, unknown> = {
  'item/commandExecution/requestApproval': { decision: 'decline' },
  'item/fileChange/requestApproval': { decision: 'decline' },
  'item/permissions/requestApproval': { permissions: {}, scope: 'turn' },
  'mcpServer/elicitation/request': { action: 'decline', content: null, _meta: null },
  applyPatchApproval: { decision: { denied: { rejection: 'den-kit does not allow file changes.' } } },
  execCommandApproval: { decision: { denied: { rejection: 'den-kit does not allow shell commands.' } } },
};

// ---- notifications ---------------------------------------------------------------------------------
export interface ErrorNotification { error: TurnError; willRetry: boolean; threadId: string; turnId: string }
export interface TurnNotification { threadId: string; turn: Turn }
export interface ItemNotification { item: ThreadItem; threadId: string; turnId: string }
export interface AgentMessageDeltaNotification { threadId: string; turnId: string; itemId: string; delta: string }
export interface ServerRequestResolvedNotification { threadId: string; requestId: RequestId }
export interface RateLimitsUpdatedNotification { rateLimits: RateLimitSnapshot }

/** A short reason and fix for a failed turn, from its codexErrorInfo. */
export function explainCodexError(error: TurnError | null | undefined, loginHint: string): { message: string; code: string; fix?: string } {
  const info = error?.codexErrorInfo ?? null;
  const code = typeof info === 'string' ? info : info && typeof info === 'object' ? Object.keys(info)[0] ?? 'other' : 'other';
  const message = error?.message || 'The LLM turn failed.';
  switch (code) {
    case 'usageLimitExceeded': return { code, message: 'Your ChatGPT plan’s Codex usage limit is reached.', fix: 'Wait for the limit to reset (see the AI status), or keep editing by hand meanwhile.' };
    case 'rateLimitExceeded': case 'serverOverloaded': return { code, message: 'The model is busy right now.', fix: 'Try again in a minute.' };
    case 'unauthorized': return { code, message: 'Codex is not signed in (or the login expired).', fix: loginHint };
    case 'contextWindowExceeded': return { code, message: 'The conversation got too long for the model.', fix: 'Start fresh: the next request opens a new conversation.' };
    case 'httpConnectionFailed': case 'responseStreamConnectionFailed': case 'responseStreamDisconnected': case 'responseTooManyFailedAttempts':
      return { code, message: `Could not reach the model (${message}).`, fix: 'Check the network connection and try again.' };
    case 'cyberPolicy': case 'misalignmentPolicyViolation': return { code, message: 'The model declined this request.', fix: 'Rephrase the request.' };
    default: return { code, message };
  }
}
