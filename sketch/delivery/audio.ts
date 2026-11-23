// What the sketch plays: the live sound of a build (the author's screen and the map,
// through den-kit's audio engine, as the player does), rendered steps played back
// (kept settings, the order sheet, walking), and the renders themselves, made a few
// at a time and kept for the page's life under a key that names everything they
// depend on. Sound starts only on a click.
import { AudioEngine } from '../../src/sound/audio-engine.ts';
import { paramsFor, renderSteps, type Build, type Setting, type Step } from './sound.ts';

/** The live sound of one build at a time, following a setting. */
export class LiveSound {
  readonly engine = new AudioEngine();
  private build: Build | null = null;
  private params: Record<string, number> = {};

  get running() {
    return this.engine.state === 'running' && !!this.build;
  }

  /** Start (from a click) and load the build with a setting. */
  async start(build: Build, setting: Setting): Promise<boolean> {
    if (!(await this.engine.start())) return false;
    if (this.build === build) {
      this.set(build, setting);
      return true;
    }
    const params = paramsFor(build, setting);
    return this.engine
      .load(build.artifact, {
        values: { ...params },
        voices: !!build.generated.voices,
        audioIn: build.generated.audioIn,
        probes: build.generated.probes.length,
        assets: [],
      })
      .then(
        () => {
          this.build = build;
          this.params = params;
          return true;
        },
        () => false,
      );
  }

  /** Follow a setting (only what changed reaches the processor); another build is loaded in. */
  set(build: Build, setting: Setting) {
    if (!this.build) return;
    if (this.build !== build) {
      void this.start(build, setting);
      return;
    }
    const next = paramsFor(build, setting);
    for (const [name, value] of Object.entries(next))
      if (this.params[name] !== value) this.engine.setParam(name, value);
    this.params = next;
  }

  note(note: number, on: boolean, velocity = 100) {
    if (!this.build) return;
    if (on) this.engine.noteOn(note, velocity);
    else this.engine.noteOff(note);
  }

  stop() {
    this.engine.allNotesOff();
  }

  dispose() {
    void this.engine.dispose();
  }
}

let context: AudioContext | null = null;
let playing: AudioBufferSourceNode[] = [];

/** Play rendered steps; each starts `gap` seconds after the one before. */
export async function play(buffers: readonly AudioBuffer[], gap = 0): Promise<void> {
  context ??= new AudioContext({ sampleRate: 48000 });
  if (context.state !== 'running') await context.resume();
  stopPlaying();
  const out = new GainNode(context, { gain: 0.8 });
  out.connect(context.destination);
  const start = context.currentTime + 0.03;
  playing = buffers.map((buffer, i) => {
    const source = new AudioBufferSourceNode(context!, { buffer });
    source.connect(out);
    source.start(start + i * gap);
    return source;
  });
}

export function stopPlaying() {
  for (const source of playing) {
    try {
      source.stop();
    } catch {
      // Already ended.
    }
  }
  playing = [];
}

/** A render to make: a build, a setting and its steps. */
export interface RenderJob {
  build: Build;
  setting: Setting;
  steps: Step[];
  seconds: number;
  preroll: number;
}

const renders = new Map<string, Promise<AudioBuffer>>();
const waiting: Array<() => void> = [];
let active = 0;
const LIMIT = 3;

/** A render, made once per key (the key names everything the render depends on). */
export function render(job: RenderJob): Promise<AudioBuffer> {
  const key = JSON.stringify([
    job.build.fingerprint,
    job.setting,
    job.steps,
    job.seconds,
    job.preroll,
  ]);
  let made = renders.get(key);
  if (!made) {
    made = slot().then(async release => {
      try {
        return await renderSteps(job.build, job.setting, job.steps, job.seconds, job.preroll);
      } finally {
        release();
      }
    });
    made.catch(() => renders.delete(key));
    renders.set(key, made);
  }
  return made;
}

/** Wait for one of the few renders that run at once. */
function slot(): Promise<() => void> {
  const release = () => {
    active--;
    waiting.shift()?.();
  };
  if (active < LIMIT) {
    active++;
    return Promise.resolve(release);
  }
  return new Promise(resolve =>
    waiting.push(() => {
      active++;
      resolve(release);
    }),
  );
}
