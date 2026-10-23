// The AI interface: what a host offers for talking to an agent runtime. den-kit
// sends requests and answers the runtime's tool calls through it; the runtime
// itself, the provider and the sign-in stay on the host's side. Types only.
import type { Ref } from 'vue';

/** The agent runtime's state, as the host reports it. */
export interface CodexStatus {
  state: 'off' | 'starting' | 'ok' | 'login' | 'error';
  detail?: string;
  /** What to do about `login` / `error` (a command to run, a setting to change). */
  fix?: string;
  model?: string;
  plan?: string;
  /** The model accepts images (kit_listen attaches a spectrogram). */
  images?: boolean;
  /** The busiest usage window of the provider's plan (resetsAt in Unix seconds). */
  rateLimit?: { usedPercent: number; resetsAt: number | null } | null;
}

export interface AIStatus {
  codex: CodexStatus;
}

/** Whether den-kit reaches the host's AI at all. */
export type AIConnection = 'disabled' | 'connecting' | 'online' | 'offline' | 'refused';

/**
 * Who a turn is: alone (no members), the lead of a team (it may start members
 * with kit_delegate), or a member working on one part of the lead's request.
 * The role picks the tools the conversation gets.
 */
export type LlmRole = 'solo' | 'lead' | 'member';
export const LLM_ROLES: readonly LlmRole[] = ['solo', 'lead', 'member'];
/** Tokens, as the runtime counts them for one conversation. */
export interface TokenUsage {
  input: number;
  cached: number;
  output: number;
  reasoning: number;
  total: number;
}
/** What a kit_* tool returns to the model (the page runs the tools; see src/ai/llm-workspace.ts). */
export interface ToolOutput {
  success: boolean;
  text: string;
  imageDataUrl?: string;
}
export interface LlmQuestion {
  id: string;
  header: string;
  question: string;
  options: string[];
  other: boolean;
}
export interface LlmError {
  message: string;
  code?: string;
  fix?: string;
}
/** Progress of one LLM request (`id`), in order. Exactly one `done` ends it. */
export type LlmEvent =
  /**
   * The conversation this turn runs in; `fresh` when an earlier one was lost (the runtime restarted).
   * `forked`: a member asked to start from a copy of the lead's conversation got one (true) or,
   * when the runtime could not copy it, a new conversation that starts with den-kit's summary (false).
   */
  | { kind: 'thread'; thread: string; fresh: boolean; forked?: boolean }
  /** Tokens the turn's conversation has used so far (all of it, and the last model call). */
  | { kind: 'usage'; total: TokenUsage; last: TokenUsage; window: number | null }
  | { kind: 'started'; turn: string }
  | { kind: 'delta'; text: string }
  | { kind: 'message'; text: string }
  /** thinking, or something den-kit refused (a shell command, a file change, …). */
  | { kind: 'activity'; what: string; detail?: string }
  | { kind: 'retrying'; message: string }
  | { kind: 'question'; question: string; items: LlmQuestion[]; blocking: boolean }
  | { kind: 'question.resolved'; question: string }
  /** A steer request reached the running turn. */
  | { kind: 'steered'; target: string }
  | { kind: 'done'; status: 'completed' | 'interrupted' | 'failed'; error?: LlmError; ms: number };

export const MAX_TOOL_TEXT = 100_000;
export const MAX_TOOL_IMAGE = 2_000_000;
export const MAX_INSTRUCTIONS = 60_000;
/** A request with what den-kit adds to it (a member's brief carries the state of its part). */
export const MAX_LLM_TEXT = 40_000;
/** Pictures that come with a request or an addition (a sketch over the screen). */
export const MAX_LLM_IMAGES = 4;
/** What a member starts from when the runtime cannot copy the lead's conversation. */
export const MAX_FORK_TEXT = 60_000;

/** How an LLM turn starts besides its text: the role (tools), pictures, a member's copy of the lead's conversation. */
export interface LlmStartOptions {
  role?: LlmRole;
  images?: string[];
  fork?: { thread: string; fallback: string };
}

/** What den-kit hears about its requests: their progress, the runtime's tool calls, and errors. */
export type LlmInbound =
  | { t: 'llm.event'; id: string; event: LlmEvent }
  /** Run a kit_* tool for request `id` and answer with toolResult (the same callId may arrive again after a reconnect). */
  | { t: 'tool.call'; id: string; callId: string; tool: string; args: unknown }
  | { t: 'error'; message: string; ref: string }
  /** `running`: the requests the host still knows after a reconnect (others were lost). */
  | { t: 'welcome'; running: string[] };

/** How the host words what happens to requests, for the people who use it. */
export interface AIWording {
  /** Show what developers need: token counts, the runtime's own messages, members by that name. */
  technical: boolean;
  /** Why no request can be sent now. */
  unavailable(online: boolean, status: CodexStatus | undefined): string;
  /** A failed request: what happened, and what the person can do. */
  failure(error: LlmError | undefined): { message: string; fix?: string };
  /** A request that was stopped. */
  stopped(error: LlmError | undefined): string;
  /** The runtime did or tried something besides thinking; null says nothing. */
  activity(what: string, detail?: string): string | null;
  retrying(message: string): string;
  /** Said when the runtime asked a question and den-kit let it decide; null says nothing. */
  skippedQuestion: string | null;
}

/** The person's AI account as den-kit shows it: signed in or not, the model and how hard it thinks. */
export interface AIAccountInfo {
  settings: AISettings;
  models: AIModel[];
  codex: CodexStatus;
  aiBusy: boolean;
  signedIn: boolean;
  login: 'idle' | 'starting' | 'waiting' | 'checking' | 'canceling' | 'complete' | 'error';
  loginError?: string;
}
export interface AISettings {
  model: string;
  effort: string;
  fork: boolean;
}
export interface AIModel {
  id: string;
  name: string;
  isDefault: boolean;
  efforts: string[];
}

/** Signing in and choosing a model inside den-kit, when the host lets the person do that here. */
export interface AIAccount {
  info(): Promise<AIAccountInfo>;
  saveSettings(settings: AISettings): Promise<AIAccountInfo>;
  signIn(): Promise<void>;
  cancelSignIn(): Promise<void>;
  signOut(): Promise<void>;
  reconnect(): Promise<AIAccountInfo>;
  /** Opens the provider's page about the person's usage. */
  openUsage(): Promise<void>;
}

export interface AI {
  readonly state: Readonly<Ref<AIConnection>>;
  readonly detail: Readonly<Ref<string>>;
  readonly status: Readonly<Ref<AIStatus | null>>;
  readonly online: boolean;
  /** The runtime is signed in and ready for requests. */
  readonly codexReady: boolean;
  start(): void;
  stop(): void;
  retryNow(): void;
  onStatus(listener: (status: AIStatus) => void): () => void;
  onLlm(listener: (message: LlmInbound) => void): () => void;
  /** False when the request could not be sent. */
  llmStart(
    id: string,
    text: string,
    instructions: string,
    thread?: string,
    options?: LlmStartOptions,
  ): boolean;
  /** Add text (and pictures) to the running turn of request `target`. */
  llmSteer(id: string, target: string, text: string, images?: string[]): boolean;
  llmStop(id: string): boolean;
  llmAnswer(id: string, question: string, answers: Record<string, string[]>): boolean;
  llmForget(thread: string): boolean;
  toolResult(id: string, callId: string, output: ToolOutput): boolean;
  /** Restart the runtime now (after signing in, or after an error). */
  codexRetry(): boolean;
  telemetry(record: Record<string, unknown>): void;
  readonly wording: AIWording;
  /** Null when the person signs in and picks a model outside den-kit. */
  readonly account: AIAccount | null;
}
