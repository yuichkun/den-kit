// What the AI works with: the editing session the editor hands it. The AI reads
// the work and changes it only through commit() (operations), compiles and
// looks through the session's own tools, and keeps one conversation per work.
import type { ComputedRef, Ref, ShallowRef } from 'vue';
import type { Catalog } from '../work/catalog.ts';
import type { Author, History, Transaction } from '../work/history.ts';
import type { OpError } from '../work/op-error.ts';
import type { Intent, ResolvedOp } from '../work/ops.ts';
import type { Library } from '../work/library.ts';
import type { PatchDocument } from '../work/schema.ts';
import type { CompileClient } from '../sound/compile/compile-client.ts';
import type { LookResult } from '../screen/look.ts';
import type { PodSession } from '../workspace/pod-session.ts';
import type { PageRect, Picture } from '../host/index.ts';
import type { AI } from '../host/ai.ts';
import type { Seeing } from './seeing.ts';
import type { LlmController } from './llm.ts';
import type { AiRequests } from './requests.ts';

export interface CommitOptions {
  author?: Author;
  label?: string;
  gesture?: string;
  /** Steps of one request that undo together (see History). */
  group?: string;
  /** Refuse when the document moved on (AI answers computed on an older revision). */
  expectRevision?: number;
}
export type CommitResult =
  | { ok: true; ops: ResolvedOp[]; created: string[] }
  | { ok: false; error: OpError };
export type HistoryListener = (kind: 'undo' | 'redo', tx: Transaction) => void;

export interface AiSession {
  readonly catalog: Catalog;
  readonly doc: ShallowRef<PatchDocument>;
  readonly history: History;
  readonly myParts: ShallowRef<Library>;
  readonly conversation: Ref<string>;
  readonly partPath: Ref<string[]>;
  readonly compiler: CompileClient;
  readonly loadEpoch: Ref<number>;
  readonly assetUrls: ShallowRef<Record<string, string>>;
  readonly selection: Ref<string[]>;
  /** Notes held from the on-screen keyboard, the computer keyboard or MIDI. */
  readonly heldNotes: Ref<number[]>;
  /** The part the patch view shows (undefined: the main patch). */
  readonly scope: ComputedRef<string | undefined>;
  /** Pictures of den-kit as the person sees it, once they share the screen. */
  readonly screen: {
    readonly source: 'tab' | 'shell' | null;
    picture(rect: PageRect, maxSide?: number): Promise<Picture>;
  };
  bridge: AI | null;
  requests: AiRequests | null;
  llm: LlmController | null;
  pod: PodSession | null;
  commit(intents: Intent[], options?: CommitOptions): CommitResult;
  onHistory(listener: HistoryListener): () => void;
  look(options?: { picture?: boolean; doc?: PatchDocument }): Promise<LookResult>;
  /** What the person is looking at now. */
  seeingNow(): Seeing;
  /** Where a view is on the page (CSS pixels). */
  viewRect(which: 'plugin' | 'patch' | 'workspace' | 'window'): PageRect | null;
  markSent(ids: readonly string[], request: string): void;
  releaseSent(request: string, keep?: boolean): void;
  loadConversation(): { id: string; docId: string; lines: unknown[] } | null;
  saveConversation(lines: unknown[]): void;
}
