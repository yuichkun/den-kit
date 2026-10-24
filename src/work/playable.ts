// The playable build: static files that play a work without the editor or a
// workspace, carried in the work file's build/ folder (work-file.ts). It holds the
// player (its page at index.html, and its files), build.json (what the player
// reads: the work's document for its screen and parameters, and the compiled
// sound's description), the compiled sound (processor.js and processor.wasm), the
// work's assets at their paths, and the built code parts under parts/. The code
// parts are served from a second origin (the player is told where with ?parts=).
import type { PatchDocument } from './schema.ts';

export const PLAYABLE_FORMAT = 'den-kit/playable';
export const PLAYABLE_VERSION = 1;
/** What the player reads first. */
export const PLAYABLE_MANIFEST = 'build.json';
export const PROCESSOR_MODULE = 'processor.js';
export const PROCESSOR_WASM = 'processor.wasm';
/** The built code parts, served from their own origin. */
export const PARTS_FOLDER = 'parts/';

export interface PlayableManifest {
  format: typeof PLAYABLE_FORMAT;
  version: number;
  /** The work's document: its screen and the parameters' values (its file contents are not in it). */
  document: PatchDocument;
  /** The compiled sound: what the player loads into the audio worklet. */
  processor: {
    hash: string;
    meta: unknown;
    processorName: string;
    sampleRate: number;
  };
  /** The build carries the code parts' pages (under parts/). */
  parts: boolean;
}

/** A playable build's manifest as read from build.json, or the reason it cannot be played. */
export function readPlayableManifest(value: unknown): PlayableManifest | { error: string } {
  if (!value || typeof value !== 'object') return { error: 'build.json is not an object.' };
  const m = value as Partial<PlayableManifest>;
  if (m.format !== PLAYABLE_FORMAT) return { error: 'This is not a den-kit playable build.' };
  if (m.version !== PLAYABLE_VERSION)
    return {
      error: `This playable build is version ${m.version}; this player plays ${PLAYABLE_VERSION}.`,
    };
  const p = m.processor;
  if (
    !p ||
    typeof p.hash !== 'string' ||
    typeof p.processorName !== 'string' ||
    typeof p.sampleRate !== 'number' ||
    !p.meta
  )
    return { error: 'build.json does not describe the compiled sound.' };
  if (!m.document || typeof m.document !== 'object')
    return { error: 'build.json has no document.' };
  return {
    format: PLAYABLE_FORMAT,
    version: PLAYABLE_VERSION,
    document: m.document,
    processor: p,
    parts: m.parts === true,
  };
}
