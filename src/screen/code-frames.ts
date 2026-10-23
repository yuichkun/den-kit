// Code parts (kind 'code') on the page: where they come from, and, for each
// part's frame, a way to get a picture of what it shows (a frame from another
// origin cannot be read; the part's page makes the picture itself and sends it).
// capture.ts draws the picture where the frame is.
import type { InjectionKey, Ref } from 'vue';

/** What a code part reported about itself. */
export interface CodePartReport {
  part: string;
  state: 'loading' | 'ready' | 'missing' | 'error';
  /** Its settings as the part declares them (the inspector shows them). */
  props?: Record<string, unknown>;
  interactive?: boolean;
  error?: string;
  /** Its last console lines and errors (newest last). */
  logs: string[];
  /** When it last (re)loaded (ms since epoch). */
  at?: number;
}

/** Where the code parts' pages come from, as their frames see it. */
export interface CodePartSource {
  readonly available: boolean;
  /** The address the parts' pages load from; null while there is none. */
  readonly portal: Readonly<Ref<string | null>>;
  readonly state: Readonly<Ref<string>>;
  readonly message: Readonly<Ref<string>>;
  /** Bumped when the parts' files changed and their pages reload. */
  readonly reloads: Readonly<Ref<number>>;
  /** Start it (code parts on the plugin need it). */
  ensure(): Promise<unknown>;
  report(element: string, patch: Partial<CodePartReport> & { log?: string }): void;
}

export const POD: InjectionKey<CodePartSource | null> = Symbol('den-kit-pod');
export const CODE_FRAMES = new WeakMap<HTMLIFrameElement, () => Promise<string | null>>();
