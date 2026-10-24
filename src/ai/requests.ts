// The prompt and the requests of this session; what was said earlier in the
// work's conversation is read from the runtime, which keeps it. Every request
// goes to the LLM.
import { shallowRef, watch } from 'vue';
import type { AiSession } from './session.ts';
import { randomId } from '../work/schema.ts';
import type { Attachment } from './attachments.ts';
import type { SentSketch } from './sketch.ts';
import type { ConversationLine } from '../host/ai.ts';

export type OutcomeStatus =
  | 'working'
  | 'applied'
  | 'nothing'
  | 'thinking'
  | 'reply'
  | 'stopped'
  | 'failed'
  | 'merged';
export type RouteKind = 'llm' | 'none';

export interface AgentLane {
  id: string;
  name: string;
  color: string;
  status: 'working' | 'done' | 'failed' | 'stopped';
  activity?: string;
  step?: string;
  ms: number;
  scope: string;
  tokens?: number;
  message?: string;
}

export interface Outcome {
  id: string;
  text: string;
  via?: 'typed' | 'voice';
  undone?: boolean;
  status: OutcomeStatus;
  route: RouteKind;
  ms: number;
  label?: string;
  note?: string;
  message?: string;
  txId?: string;
  live?: boolean;
  activity?: string;
  steps?: string[];
  reply?: string;
  fix?: string;
  screen?: boolean;
  attached?: Attachment[];
  where?: { path: string[]; part: string; name: string };
  agents?: AgentLane[];
  tokens?: number;
  sketch?: SentSketch;
}

/** What was said earlier in a conversation, as request lines (the person's words, and what the AI said). */
export function earlierLines(lines: readonly ConversationLine[]): Outcome[] {
  const out: Outcome[] = [];
  for (const [i, line] of lines.entries()) {
    if (line.who === 'person')
      out.push({ id: `earlier-${i}`, text: line.text, status: 'reply', route: 'llm', ms: 0 });
    else if (out.length) {
      const last = out.at(-1)!;
      out[out.length - 1] = {
        ...last,
        reply: last.reply ? `${last.reply}\n${line.text}` : line.text,
      };
    }
  }
  return out;
}

export class AiRequests {
  readonly outcome = shallowRef<Outcome | null>(null);
  /** This session's requests about the open work. */
  readonly history = shallowRef<Outcome[]>([]);
  /** What was said before, in the open work's conversation. */
  readonly earlier = shallowRef<Outcome[]>([]);
  readonly session: AiSession;
  /** The conversation whose earlier lines were read. */
  private readFor: string | null = null;

  constructor(session: AiSession) {
    this.session = session;
    // Another work opened, or the work starts afresh (a starter loaded over it, a new conversation):
    // its own requests and conversation show.
    const clear = () => {
      this.history.value = [];
      this.outcome.value = null;
      this.earlier.value = [];
      this.readFor = null;
    };
    watch(() => session.doc.value.id, clear, { flush: 'sync' });
    watch(
      () => session.conversation.value,
      (thread, before) => {
        if (thread === null && before !== null) clear();
      },
      { flush: 'sync' },
    );
    // The work's conversation became known (read from the host's storage), or the runtime came online.
    watch(
      () => session.conversation.value,
      () => void this.readEarlier(),
    );
    session.bridge?.onStatus(() => {
      if (this.readFor !== session.conversation.value) void this.readEarlier();
    });
    void this.readEarlier();
    session.onHistory((kind, tx) => {
      if (tx.author.kind !== 'ai-llm') return;
      const past = this.history.value.find(
        o => o.txId === tx.id || (tx.author.kind === 'ai-llm' && o.id === tx.author.take),
      );
      if (kind === 'undo' && past && this.outcome.value?.id === past.id) this.outcome.value = null;
      if (past) this.remember({ ...past, undone: kind === 'undo' });
      session.bridge?.telemetry({
        kind: kind === 'undo' ? 'undo' : 'redo',
        author: tx.author.kind,
        trace: tx.author.trace,
        label: tx.label,
      });
    });
  }

  /** Read what was said earlier in the open work's conversation (the runtime keeps it); not this session's own requests. */
  private async readEarlier() {
    const thread = this.session.conversation.value;
    const bridge = this.session.bridge;
    if (!thread || !bridge?.online || this.readFor === thread || this.history.value.length) return;
    const lines = await bridge.conversation(thread);
    if (this.session.conversation.value !== thread || !lines) return;
    this.readFor = thread;
    this.earlier.value = earlierLines(lines).slice(-60);
  }

  where(): Outcome['where'] {
    const path = this.session.partPath.value,
      doc = this.session.doc.value;
    const part = path.length ? doc.nodes[path.at(-1)!]?.part : undefined;
    return part && doc.parts[part]
      ? { path: [...path], part, name: doc.parts[part]!.name }
      : undefined;
  }

  upsert(outcome: Outcome) {
    const isNew = !this.history.value.some(o => o.id === outcome.id);
    this.remember(outcome);
    if (isNew || this.outcome.value?.id === outcome.id) this.outcome.value = outcome;
  }

  private remember(outcome: Outcome) {
    const list = this.history.value;
    const i = list.findIndex(o => o.id === outcome.id);
    this.history.value =
      i >= 0 ? [...list.slice(0, i), outcome, ...list.slice(i + 1)] : [...list, outcome].slice(-30);
  }

  run(
    raw: string,
    options: { via?: 'typed' | 'voice'; attached?: Attachment[]; sketch?: SentSketch } = {},
  ): Outcome {
    const text = raw.trim().slice(0, 600);
    if (text && this.session.llm) return this.session.llm.run(text, options);
    const line: Outcome = {
      id: randomId('rq'),
      text,
      status: text ? 'failed' : 'nothing',
      route: text ? 'llm' : 'none',
      ms: 0,
      via: options.via,
      attached: options.attached?.length ? options.attached : undefined,
      ...(options.sketch ? { sketch: options.sketch } : {}),
      message: text
        ? 'The AI is not available. Connect ChatGPT to send a request.'
        : 'Type what you want to make or change.',
    };
    this.upsert(line);
    return line;
  }
}
