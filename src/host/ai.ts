// The AI interface: what a host offers for talking to an agent runtime. den-kit
// sends requests and answers the runtime's tool calls through it; the runtime
// itself, the provider, the sign-in, the sub-agents and the conversations stay
// on the host's side. A conversation is known by the runtime's id for it: den-kit
// keeps which conversation belongs to which work, never what was said. Types only.
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
  /** The conversation this turn runs in; `fresh` when the one asked for could not be opened (a new one began). */
  | { kind: 'thread'; thread: string; fresh: boolean }
  /** A sub-agent the request's AI started (the runtime's id for it), and when it ends. */
  | {
      kind: 'agent';
      agent: string;
      name: string;
      state: 'started' | 'ended';
      status?: 'completed' | 'interrupted' | 'failed';
    }
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
/** A request's text, and den-kit's notes that come with it. */
export const MAX_LLM_TEXT = 40_000;
/** Pictures that come with a request or an addition (a sketch over the screen). */
export const MAX_LLM_IMAGES = 4;
/** What comes with the person's words: den-kit's notes about the moment, sent before them, and pictures. */
export interface LlmStartOptions {
  context?: string;
  images?: string[];
}

/** One message of a conversation, as the runtime keeps it. */
export interface ConversationLine {
  who: 'person' | 'ai';
  text: string;
}

/** What den-kit hears about its requests: their progress, the runtime's tool calls, and errors. */
export type LlmInbound =
  /** `agent`: the sub-agent the event is about (none: the request's own AI). */
  | { t: 'llm.event'; id: string; event: LlmEvent; agent?: string }
  /**
   * Run a kit_* tool for request `id` and answer with toolResult (the same callId may arrive again after
   * a reconnect). `agent`: the sub-agent that called it (none: the request's own AI).
   */
  | { t: 'tool.call'; id: string; callId: string; tool: string; args: unknown; agent?: string }
  | { t: 'error'; message: string; ref: string }
  /** `running`: the requests the host still knows after a reconnect (others were lost). */
  | { t: 'welcome'; running: string[] };

/** How the host words what happens to requests, for the people who use it. */
export interface AIWording {
  /** Show what developers need: token counts, the runtime's own messages, sub-agents by that name. */
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
  /** False when the request could not be sent. `thread`: the conversation to go on with. */
  llmStart(
    id: string,
    text: string,
    instructions: string,
    thread?: string,
    options?: LlmStartOptions,
  ): boolean;
  /** What was said in a conversation, oldest first; null when the runtime cannot read it. */
  conversation(thread: string): Promise<ConversationLine[] | null>;
  /** Add text (with den-kit's notes and pictures) to the running turn of request `target`. */
  llmSteer(id: string, target: string, text: string, options?: LlmStartOptions): boolean;
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
