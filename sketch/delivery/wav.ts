// Rendered sound as files and pictures: 16-bit PCM WAV (mono is the average of the
// two channels), with a short fade at the end so a cut tail does not click, the peaks
// a waveform picture draws, and files handed to the person as downloads.

export interface Samples {
  channels: Float32Array[];
  sampleRate: number;
}

export const samplesOf = (buffer: AudioBuffer): Samples => ({
  channels: Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)),
  sampleRate: buffer.sampleRate,
});

export function wav(samples: Samples, channels: 1 | 2, fadeSeconds = 0.01): Uint8Array {
  const [left, right = left] = samples.channels;
  if (!left) throw new Error('There is no sound to write.');
  const frames = left.length;
  const fade = Math.min(frames, Math.round(fadeSeconds * samples.sampleRate));
  const bytes = new Uint8Array(44 + frames * channels * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + frames * channels * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, samples.sampleRate, true);
  view.setUint32(28, samples.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, frames * channels * 2, true);
  let at = 44;
  for (let i = 0; i < frames; i++) {
    const gain = i >= frames - fade ? (frames - i) / fade : 1;
    const frame =
      channels === 1 ? [((left[i]! + right[i]!) / 2) * gain] : [left[i]! * gain, right[i]! * gain];
    for (const s of frame) {
      const v = Math.max(-1, Math.min(1, s));
      view.setInt16(at, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      at += 2;
    }
  }
  return bytes;
}

/** The highest level in each of `columns` slices (both channels). */
export function peaks(samples: Samples, columns: number): number[] {
  const [left, right = left] = samples.channels;
  if (!left) return [];
  const out: number[] = [];
  const size = left.length / columns;
  for (let c = 0; c < columns; c++) {
    let top = 0;
    for (let i = Math.floor(c * size); i < Math.floor((c + 1) * size); i++)
      top = Math.max(top, Math.abs(left[i]!), Math.abs(right[i]!));
    out.push(top);
  }
  return out;
}

/** Hand bytes to the person as a file. */
export function download(bytes: Uint8Array, name: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
