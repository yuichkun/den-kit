// The prompt and its saved conversation. Every new request goes to the LLM;
// there is no local phrase interpreter or separate classification service.
import { shallowRef, watch } from 'vue';
import type { AiSession } from './session.ts';
import { randomId } from '../work/schema.ts';
import type { Attachment } from './attachments.ts';
import type { SentSketch } from './sketch.ts';
import { SAVED_LINES, readSavedLines, savedLine } from './conversation.ts';

export type OutcomeStatus =
  | 'working'
  | 'applied'
  | 'nothing'
  | 'thinking'
  | 'reply'
  | 'stopped'
  | 'failed'
  | 'merged';
/** Older route names are accepted only when reading a saved conversation. */
export type RouteKind = 'llm' | 'none' | 'lexicon' | 'jev' | 'jev-target';

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
  /** Preserved for conversations saved before the phrase interpreter was removed. */
  repeats?: string;
  where?: { path: string[]; part: string; name: string };
  agents?: AgentLane[];
  tokens?: number;
  sketch?: SentSketch;
}

export class AiRequests {
  readonly outcome = shallowRef<Outcome | null>(null);
  readonly history = shallowRef<Outcome[]>([]);
  readonly earlier = shallowRef<Outcome[]>([]);
  readonly session: AiSession;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(session: AiSession) {
    this.session = session;
    const saved = session.loadConversation();
    if (saved && saved.id === session.conversation.value)
      this.history.value = readSavedLines(saved.lines);
    watch(
      () => session.conversation.value,
      () => {
        this.earlier.value = [...this.earlier.value, ...this.history.value.map(savedLine)].slice(
          -60,
        );
        this.history.value = [];
        this.outcome.value = null;
        this.persist();
      },
      { flush: 'sync' },
    );
    watch(this.history, () => {
      if (this.persistTimer) return;
      this.persistTimer = setTimeout(() => {
        this.persistTimer = null;
        this.persist();
      }, 250);
    });
    session.onHistory((kind, tx) => {
      // Older saved edits remain undoable, alongside the current LLM edits.
      if (tx.author.kind !== 'ai-fast' && tx.author.kind !== 'ai-llm') return;
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

  where(): Outcome['where'] {
    const path = this.session.partPath.value,
      doc = this.session.doc.value;
    const part = path.length ? doc.nodes[path.at(-1)!]?.part : undefined;
    return part && doc.parts[part]
      ? { path: [...path], part, name: doc.parts[part]!.name }
      : undefined;
  }

  persist() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.session.saveConversation(this.history.value.slice(-SAVED_LINES).map(savedLine));
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
