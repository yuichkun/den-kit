// What the LLM "hears": plain numbers about a rendered phrase (level, peaks,
// clipping, brightness over time, attack/release, stereo width, DC, broken
// samples) plus an optional spectrogram picture. Pure functions; the same code
// runs in the browser worker and in Node tests on synthetic signals.

export interface ListenReport {
  seconds: number;
  sampleRate: number;
  peakDb: number;
  rmsDb: number;
  /** Samples at or above full scale (0.999). */
  clipped: number;
  /** Samples the renderer had to replace because they were NaN/Inf. */
  broken: number;
  dcOffset: number;
  silent: boolean;
  /** 0 = mono, ~1 = unrelated left/right. */
  stereoWidth: number;
  /** Spectral centroid (Hz) over the loud parts: a brightness measure. */
  centroidHz: { mean: number; min: number; max: number };
  /** Time from the first note-on until the level reaches 90 % of its first peak. */
  attackMs: number | null;
  /** Time from the last note-off until the level falls 40 dB below the level at note-off. */
  releaseMs: number | null;
  /** RMS level per 100 ms, dBFS (rounded), for a quick look at the shape. */
  envelopeDb: number[];
  summary: string;
}

const db = (x: number) => x > 0 ? 20 * Math.log10(x) : -Infinity;
const round = (x: number, d = 1) => Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x;

export function analyse(channels: Float32Array[], sampleRate: number, notes: { onSamples?: number[]; offSamples?: number[]; broken?: number } = {}): ListenReport {
  const n = Math.min(...channels.map(c => c.length));
  const left = channels[0] ?? new Float32Array(0), right = channels[1] ?? left;
  let peak = 0, sumSq = 0, clipped = 0, sum = 0, mid = 0, side = 0;
  for (let i = 0; i < n; i++) {
    const l = left[i]!, r = right[i]!;
    for (const s of channels.length > 1 ? [l, r] : [l]) {
      const a = Math.abs(s);
      if (a > peak) peak = a;
      if (a >= 0.999) clipped++;
      sumSq += s * s;
      sum += s;
    }
    const m = (l + r) / 2, sd = (l - r) / 2;
    mid += m * m; side += sd * sd;
  }
  const count = n * Math.max(1, Math.min(2, channels.length));
  const rms = count ? Math.sqrt(sumSq / count) : 0;
  const silent = peak < 1e-4;

  // Short-time RMS (10 ms) for envelope timing, and 100 ms blocks for the overview.
  const hop = Math.max(1, Math.round(sampleRate * 0.01));
  const frames: number[] = [];
  for (let start = 0; start < n; start += hop) {
    let s2 = 0; const end = Math.min(n, start + hop);
    for (let i = start; i < end; i++) { const m = (left[i]! + right[i]!) / 2; s2 += m * m; }
    frames.push(Math.sqrt(s2 / Math.max(1, end - start)));
  }
  const envelopeDb: number[] = [];
  for (let f = 0; f < frames.length; f += 10) {
    const block = frames.slice(f, f + 10);
    const level = Math.sqrt(block.reduce((a, b) => a + b * b, 0) / Math.max(1, block.length));
    envelopeDb.push(level > 1e-6 ? Math.round(db(level)) : -120);
  }

  const firstOn = notes.onSamples?.length ? Math.min(...notes.onSamples) : 0;
  let attackMs: number | null = null;
  if (!silent) {
    const startFrame = Math.floor(firstOn / hop);
    // The first local peak after the note-on (within 2 s).
    let peakFrame = startFrame, peakLevel = 0;
    for (let f = startFrame; f < Math.min(frames.length, startFrame + 200); f++) {
      if (frames[f]! > peakLevel) { peakLevel = frames[f]!; peakFrame = f; }
      else if (frames[f]! < peakLevel * 0.5) break;
    }
    if (peakLevel > 1e-4) {
      for (let f = startFrame; f <= peakFrame; f++) if (frames[f]! >= peakLevel * 0.9) { attackMs = Math.max(0, Math.round(((f + 1) * hop - firstOn) / sampleRate * 1000)); break; }
    }
  }
  let releaseMs: number | null = null;
  const lastOff = notes.offSamples?.length ? Math.max(...notes.offSamples) : null;
  if (lastOff !== null && !silent) {
    const offFrame = Math.min(frames.length - 1, Math.floor(lastOff / hop));
    const atOff = frames[offFrame] ?? 0;
    if (atOff > 1e-5) for (let f = offFrame; f < frames.length; f++) if (frames[f]! <= atOff * 0.01) { releaseMs = Math.round((f * hop - lastOff) / sampleRate * 1000); break; }
  }

  const centroids = spectralCentroids(left, right, n, sampleRate);
  const centroidHz = centroids.length
    ? { mean: Math.round(centroids.reduce((a, b) => a + b, 0) / centroids.length), min: Math.round(Math.min(...centroids)), max: Math.round(Math.max(...centroids)) }
    : { mean: 0, min: 0, max: 0 };
  const stereoWidth = mid + side > 0 ? round(Math.sqrt(side / Math.max(mid, 1e-12)), 2) : 0;
  const report: ListenReport = {
    seconds: round(n / sampleRate, 2), sampleRate,
    peakDb: round(db(peak)), rmsDb: round(db(rms)), clipped, broken: notes.broken ?? 0,
    dcOffset: round(count ? sum / count : 0, 4), silent, stereoWidth, centroidHz, attackMs, releaseMs, envelopeDb, summary: '',
  };
  report.summary = describeReport(report);
  return report;
}

/** One paragraph in plain English for the LLM. */
export function describeReport(r: ListenReport): string {
  if (r.broken) return `Broken output: ${r.broken} samples were NaN/Inf (replaced by silence). Fix the patch before judging the sound.`;
  if (r.silent) return 'Silent: nothing reached the output. Check that the signal path ends at Out and that a note reaches the voice.';
  const parts = [
    `${r.seconds} s rendered; peak ${r.peakDb} dBFS, average ${r.rmsDb} dBFS.`,
    r.clipped ? `${r.clipped} samples clip at full scale (too loud).` : 'No clipping.',
    `Brightness (spectral centroid) about ${r.centroidHz.mean} Hz (range ${r.centroidHz.min}–${r.centroidHz.max} Hz).`,
    r.attackMs !== null ? `Attack about ${r.attackMs} ms.` : '',
    r.releaseMs !== null ? `Release tail about ${r.releaseMs} ms after the last key-up.` : '',
    r.stereoWidth < 0.05 ? 'Mono.' : `Stereo width ${r.stereoWidth} (0 mono, 1 wide).`,
    Math.abs(r.dcOffset) > 0.01 ? `DC offset ${r.dcOffset}.` : '',
    `Level per 100 ms (dBFS): ${r.envelopeDb.join(' ')}.`,
  ];
  return parts.filter(Boolean).join(' ');
}

// ---- spectrum -------------------------------------------------------------------------
const FFT_SIZE = 2048;

function spectralCentroids(left: Float32Array, right: Float32Array, n: number, sampleRate: number): number[] {
  const out: number[] = [];
  const re = new Float64Array(FFT_SIZE), im = new Float64Array(FFT_SIZE);
  const window = hann(FFT_SIZE);
  for (let start = 0; start + FFT_SIZE <= n; start += FFT_SIZE) {
    let energy = 0;
    for (let i = 0; i < FFT_SIZE; i++) { const m = (left[start + i]! + right[start + i]!) / 2; re[i] = m * window[i]!; im[i] = 0; energy += m * m; }
    if (energy / FFT_SIZE < 1e-6) continue; // only the audible parts
    fft(re, im);
    let num = 0, den = 0;
    for (let k = 1; k < FFT_SIZE / 2; k++) { const mag = Math.hypot(re[k]!, im[k]!); num += mag * k * sampleRate / FFT_SIZE; den += mag; }
    if (den > 0) out.push(num / den);
  }
  return out;
}

const hannCache = new Map<number, Float64Array>();
function hann(size: number) {
  let w = hannCache.get(size);
  if (!w) { w = new Float64Array(size).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1))); hannCache.set(size, w); }
  return w;
}

/** In-place radix-2 FFT (size must be a power of two). */
export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci, ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr; im[b] = im[a]! - ti; re[a] = re[a]! + tr; im[a] = im[a]! + ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/** Log-frequency spectrogram as an RGB PNG (time → x, 30 Hz–20 kHz → y). */
export async function spectrogramPng(channel: Float32Array, sampleRate: number, width = 512, height = 256): Promise<Uint8Array> {
  const size = 2048, re = new Float64Array(size), im = new Float64Array(size), w = hann(size);
  const columns: Float64Array[] = [];
  const step = Math.max(1, Math.floor((channel.length - size) / width));
  for (let x = 0; x < width; x++) {
    const start = Math.min(Math.max(0, channel.length - size), x * step);
    for (let i = 0; i < size; i++) { re[i] = (channel[start + i] ?? 0) * w[i]!; im[i] = 0; }
    fft(re, im);
    const col = new Float64Array(height);
    for (let y = 0; y < height; y++) {
      const f = 30 * Math.pow(20000 / 30, 1 - y / (height - 1));
      const k = Math.min(size / 2 - 1, Math.max(1, Math.round(f * size / sampleRate)));
      col[y] = db(Math.hypot(re[k]!, im[k]!) / (size / 4));
    }
    columns.push(col);
  }
  const rgb = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    rgb[y * (width * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const v = Math.max(0, Math.min(1, (columns[x]![y]! + 90) / 90)); // -90..0 dB
      const [r, g, b] = heat(v);
      const o = y * (width * 3 + 1) + 1 + x * 3;
      rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b;
    }
  }
  return encodePng(width, height, rgb);
}

function heat(v: number): [number, number, number] {
  return [Math.round(255 * Math.min(1, v * 1.6)), Math.round(255 * Math.max(0, Math.min(1, (v - 0.35) * 1.8))), Math.round(255 * Math.max(0, Math.min(1, (v - 0.75) * 4)) + 40 * (1 - v))];
}

// ---- PNG (CompressionStream: browser and Node 18+) ------------------------------------
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes: Uint8Array) { let c = 0xffffffff; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** `raw` is filtered scanlines (one filter byte per row), 8-bit RGB. */
export async function encodePng(width: number, height: number, raw: Uint8Array): Promise<Uint8Array> {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width); v.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of parts) { png.set(p, o); o += p.length; }
  return png;
}

export function pngDataUrl(png: Uint8Array): string {
  let s = '';
  for (let i = 0; i < png.length; i += 0x8000) s += String.fromCharCode(...png.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(s)}`;
}

// ---- test inputs for effect patches -------------------------------------------------------
export type TestSignal = 'chords' | 'drums' | 'noise' | 'guitar';

/** A plucked-string riff (Karplus–Strong): a dry guitar to try distortion and delays on. */
const RIFF: Array<[number[], number]> = [[[40, 47, 52], 0.5], [[40], 0.25], [[40], 0.25], [[43, 50, 55], 0.5], [[45, 52, 57], 0.5], [[40, 47, 52], 0.5], [[40], 0.25], [[38], 0.25], [[47], 0.25], [[45], 0.25], [[43], 0.5]];

/** Deterministic stereo test material for effect patches (no randomness between runs). */
export function testSignal(kind: TestSignal, seconds: number, sampleRate: number): Float32Array[] {
  const n = Math.round(seconds * sampleRate);
  const l = new Float32Array(n), r = new Float32Array(n);
  let seed = 12345;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 1073741824 - 1; };
  if (kind === 'noise') { for (let i = 0; i < n; i++) { l[i] = rand() * 0.25; r[i] = rand() * 0.25; } return [l, r]; }
  if (kind === 'guitar') {
    let at = 0, k = 0;
    while (at < n) {
      const [notes, beats] = RIFF[k++ % RIFF.length]!;
      const len = Math.round(beats * sampleRate * 0.6);
      for (const note of notes) {
        const period = Math.max(2, Math.round(sampleRate / (440 * 2 ** ((note - 69) / 12))));
        const line = new Float32Array(period);
        for (let i = 0; i < period; i++) line[i] = rand() * 0.5;
        let prev = 0;
        for (let i = 0; i < Math.min(len * 1.6, n - at); i++) {
          const j = i % period, v = line[j]!;
          const next = 0.996 * 0.5 * (v + prev);
          prev = v; line[j] = next;
          const s = v * 0.32 / Math.sqrt(notes.length);
          l[at + i]! += s; r[at + i]! += s;
        }
      }
      at += len;
    }
    return [l, r];
  }
  if (kind === 'drums') {
    const beat = Math.round(sampleRate * 0.5);
    for (let start = 0; start < n; start += beat) {
      const kick = (start / beat) % 2 === 0;
      for (let i = 0; i < beat && start + i < n; i++) {
        const t = i / sampleRate;
        const v = kick ? Math.sin(2 * Math.PI * (50 + 100 * Math.exp(-t * 30)) * t) * Math.exp(-t * 8) * 0.8 : rand() * Math.exp(-t * 25) * 0.5;
        l[start + i] = v; r[start + i] = v;
      }
    }
    return [l, r];
  }
  const chords = [[48, 55, 60, 64], [45, 52, 57, 60]];
  const len = Math.round(sampleRate * 1);
  for (let start = 0, c = 0; start < n; start += len, c++) {
    const notes = chords[c % 2]!;
    for (let i = 0; i < len && start + i < n; i++) {
      const t = i / sampleRate, env = Math.min(1, t * 50) * Math.exp(-t * 2);
      let v = 0;
      for (const note of notes) { const f = 440 * Math.pow(2, (note - 69) / 12); v += ((t * f) % 1) * 2 - 1; }
      l[start + i] = v * env * 0.12; r[start + i] = v * env * 0.12;
    }
  }
  return [l, r];
}
