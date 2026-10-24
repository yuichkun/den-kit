// What the AI works with: the editing session the editor hands it. The AI reads
// the work and changes it only through commit() (operations), compiles and
// looks through the session's own tools, and keeps which conversation (the
// runtime's id) is each work's.
import type { ComputedRef, Ref, ShallowRef } from 'vue';
import type { Catalog } from '../work/catalog.ts';
import type { CommitOptions, History, Transaction } from '../work/history.ts';
import type { OpError } from '../work/op-error.ts';
import type { Intent, ResolvedOp } from '../work/ops.ts';
import type { Library } from '../work/library.ts';
import type { PatchDocument } from '../work/schema.ts';
import type { AssetMeta } from '../work/ui.ts';
import type { CompileClient } from '../sound/compile/compile-client.ts';
import type { LookResult } from '../screen/look.ts';
import type { PodSession } from '../workspace/pod-session.ts';
import type { PageRect, Picture } from '../host/index.ts';
import type { AI } from '../host/ai.ts';
import type { Seeing } from './seeing.ts';
import type { LlmController } from './llm.ts';
import type { AiRequests } from './requests.ts';

export type { CommitOptions };
export type CommitResult =
  | { ok: true; ops: ResolvedOp[]; created: string[] }
  | { ok: false; error: OpError };
export type HistoryListener = (kind: 'undo' | 'redo', tx: Transaction) => void;

export interface AiSession {
  readonly catalog: Catalog;
  readonly doc: ShallowRef<PatchDocument>;
  readonly history: History;
  readonly myParts: ShallowRef<Library>;
  readonly partPath: Ref<string[]>;
  readonly compiler: CompileClient;
  readonly loadEpoch: Ref<number>;
  readonly assetUrls: ShallowRef<Record<string, string>>;
  /** The contents of the work's assets. */
  readonly assets: { read(asset: AssetMeta): Promise<Uint8Array | null> };
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
  /** The runtime's id of the open work's conversation (null: none yet). */
  readonly conversation: Ref<string | null>;
  /** Keep which conversation is the open work's (null: none, the next request starts one). */
  keepConversation(thread: string | null): void;
  /** A file from a public URL, kept and checked as an asset but not yet in the work; throws with the reason it cannot. */
  importFromUrl(url: string, name?: string): Promise<{ asset: AssetMeta; url: string }>;
}
