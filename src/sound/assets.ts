// Audio assets in the sound: a sampler's sound, and what a codebox reads through
// `@den-kit/assets`. The page decodes a file at the AudioContext's rate and sends
// the samples to the running processor, which keeps them in den resident
// samples (bytes in a buffer). Pointing at another asset sends new samples and
// never recompiles.
import type { NodeId } from '../work/schema.ts';

/** Frames one resident holds: den's largest resident sample, about 1.4 s at 48 kHz. */
export const ASSET_FRAMES = 65536;
/** Bytes a codebox's `bytes()` holds. */
export const ASSET_BYTES = 65536;

/** Where an asset's contents go in the processor: the event that loads them, and what they hold. */
export interface AssetSlot {
  event: string;
  /** mono: a sampler's sound, mixed down; left and right: the channels of a codebox's `audio()`; bytes: a codebox's `bytes()`. */
  kind: 'mono' | 'left' | 'right' | 'bytes';
  /** A codebox's asset: its path. */
  path?: string;
  /** A sampler's sound: the node and the config whose value is the path. */
  node?: NodeId;
  config?: string;
}

/** What a slot of the running processor should hold. */
export interface AssetLoad {
  event: string;
  kind: AssetSlot['kind'];
  /** Changes when the contents do (the content's hash, or the URL of a file den-kit ships); '' for nothing. */
  key: string;
  read: () => Promise<Uint8Array | null>;
}

interface Decoded {
  numberOfChannels: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

/** The samples a slot gets from decoded audio: mixed to mono or one channel, cut to what a resident holds, non-finite samples as 0. */
export function slotSamples(audio: Decoded, kind: 'mono' | 'left' | 'right'): Float32Array {
  const frames = Math.min(audio.length, ASSET_FRAMES);
  const out = new Float32Array(frames);
  const channels = Math.max(1, audio.numberOfChannels);
  const pick =
    kind === 'mono' ? [...Array(channels).keys()] : [kind === 'right' && channels > 1 ? 1 : 0];
  for (const c of pick) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < frames; i++) out[i]! += data[i]! / pick.length;
  }
  for (let i = 0; i < frames; i++) if (!Number.isFinite(out[i]!)) out[i] = 0;
  return out;
}

/** The declarations a codebox type-checks `@den-kit/assets` against. */
export const ASSET_API_TYPES = `import type { Node } from '@unworklet/core';

/** An audio asset of the work at the processor's sample rate: two channels (a mono file has the same samples in both), up to ${ASSET_FRAMES} frames each. */
export interface AssetAudio {
  /** Frames loaded: 0 until the samples arrive, and when the work has no such file. */
  length(): Node<'i32'>;
  /** The sample of a channel (0 left, 1 right) at a position in frames; fractional positions interpolate, positions outside the sound read 0. */
  read(channel: 0 | 1, position: Node<'f64'> | Node<'f32'> | Node<'i32'>): Node<'f32'>;
}

/** Any asset of the work as bytes, up to ${ASSET_BYTES}. */
export interface AssetBytes {
  /** Bytes loaded: 0 until they arrive, and when the work has no such file. */
  length(): Node<'i32'>;
  /** The byte at an index (0 to 255); 0 outside the file. */
  at(index: Node<'i32'>): Node<'i32'>;
}

/** An audio asset, by its path written out: audio('assets/kick.wav'). */
export declare function audio(path: string): AssetAudio;
/** Any asset as bytes, by its path written out: bytes('assets/table.bin'). */
export declare function bytes(path: string): AssetBytes;
`;
