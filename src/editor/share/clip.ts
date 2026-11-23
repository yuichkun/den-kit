// A clip of the work's sound for a link's sound outside (Host.publish): the work plays for
// a few seconds as the editor plays it, an instrument an arpeggio that keeps sounding
// through the clip (C, A minor, F, G in eighth notes) and an effect the test sound it is
// heard through, and its output (after the editor's limiter) is recorded with the poster
// and a meter of the sound, as a video: apps that play a link's video (og:video) play it
// in place, before the link is opened. The person hears it as it is recorded.
import type { KitSession } from '../session.ts';
import { OUTSIDE_SIZE } from './outside.ts';

export interface Clip {
  bytes: Uint8Array;
  type: string;
  seconds: number;
}

/** Eighth notes at 112 BPM in render quanta (128 samples at 48 kHz): about 100 quanta each. */
const EIGHTH = 100;
const CHORDS = [
  [48, 52, 55, 60],
  [45, 48, 52, 57],
  [41, 45, 48, 53],
  [43, 47, 50, 55],
];
const ARPEGGIO = CHORDS.flatMap((notes, c) =>
  notes.flatMap((note, i) => {
    const q = (c * 4 + i) * EIGHTH;
    const velocity = i === 0 ? 104 : 80;
    return [
      { q, type: 'noteOn' as const, note, velocity },
      { q: q + EIGHTH - 10, type: 'noteOff' as const, note, velocity: 0 },
    ];
  }),
);

const TYPES = [
  'video/mp4;codecs=avc1,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export async function recordClip(
  session: KitSession,
  poster: Uint8Array,
  accent: string,
  seconds = 8,
): Promise<Clip> {
  const engine = session.engine;
  if (!(await engine.start()) || !engine.ctx || !engine.outAnalyser)
    throw new Error('The sound could not start, so there is nothing to record.');
  const mime = TYPES.find(t => MediaRecorder.isTypeSupported(t));
  if (!mime) throw new Error('This browser cannot record a clip.');
  const ctx = engine.ctx;
  const out = engine.outAnalyser;
  const sound = ctx.createMediaStreamDestination();
  out.connect(sound);
  const picture = await createImageBitmap(new Blob([poster as BlobPart], { type: 'image/png' }));
  const c = document.createElement('canvas');
  c.width = OUTSIDE_SIZE.width;
  c.height = OUTSIDE_SIZE.height;
  const g = c.getContext('2d')!;
  const samples = new Float32Array(out.fftSize);
  let level = 0;
  let drawing = true;
  const draw = () => {
    if (!drawing) return;
    out.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const s of samples) sum += s * s;
    level = Math.max(Math.sqrt(sum / samples.length) * 3, level * 0.9);
    g.drawImage(picture, 0, 0, c.width, c.height);
    g.fillStyle = accent;
    g.fillRect(0, c.height - 12, c.width * Math.min(1, level), 12);
    requestAnimationFrame(draw);
  };
  draw();
  const stream = new MediaStream([
    ...c.captureStream(30).getVideoTracks(),
    ...sound.stream.getAudioTracks(),
  ]);
  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: 1_200_000,
    audioBitsPerSecond: 128_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = e => {
    if (e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise<void>(resolve => (recorder.onstop = () => resolve()));
  const effect = session.generated.value.audioIn;
  const signal = engine.testSignalKind;
  recorder.start(250);
  if (effect) {
    if (signal === 'off' || signal === 'input') engine.setTestSignal('drums');
  } else engine.playPhrase(ARPEGGIO, CHORDS.length * 4 * EIGHTH, true);
  await new Promise(resolve => setTimeout(resolve, seconds * 1000));
  recorder.stop();
  if (effect) {
    if (engine.testSignalKind !== signal) engine.setTestSignal(signal);
  } else engine.stopPhrase();
  await stopped;
  drawing = false;
  out.disconnect(sound);
  for (const track of stream.getTracks()) track.stop();
  const type = mime.startsWith('video/mp4') ? 'video/mp4' : 'video/webm';
  return { bytes: new Uint8Array(await new Blob(chunks).arrayBuffer()), type, seconds };
}
