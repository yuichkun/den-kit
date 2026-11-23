// Recording and playing a phrase: the notes a person plays, kept as notes rather
// than sound, so the same phrase can be played again on any version of a work.
// Recording starts at the first note and stops by itself after 12 seconds.
import { ref, shallowRef } from 'vue';
import type { Phrase } from './passage.ts';

const MAX_MS = 12_000;
const MAX_EVENTS = 300;

export class PhrasePlayer {
  readonly recording = ref(false);
  /** The phrase playing now (null: none). */
  readonly playing = shallowRef<Phrase | null>(null);
  readonly recorded = shallowRef<Phrase>([]);
  private started = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private sounding = new Set<number>();
  private held = new Set<number>();
  private readonly play: (note: number, velocity: number) => void;

  constructor(play: (note: number, velocity: number) => void) {
    this.play = play;
  }

  record() {
    this.stop();
    this.recorded.value = [];
    this.started = 0;
    this.held.clear();
    this.recording.value = true;
  }

  /** A note the person played (velocity 0: released); kept while recording. */
  note(note: number, velocity: number) {
    if (!this.recording.value) return;
    const now = performance.now();
    if (!this.started) {
      if (velocity === 0) return;
      this.started = now;
    }
    const at = Math.round(now - this.started);
    if (at > MAX_MS || this.recorded.value.length >= MAX_EVENTS) {
      this.finish();
      return;
    }
    if (velocity > 0) this.held.add(note);
    else if (!this.held.delete(note)) return;
    this.recorded.value = [...this.recorded.value, [at, note, velocity]];
  }

  /** Stop recording; notes still held end where the phrase ends. */
  finish() {
    if (!this.recording.value) return;
    this.recording.value = false;
    const end = this.recorded.value.at(-1)?.[0] ?? 0;
    const open = [...this.held].map((note): [number, number, number] => [end + 120, note, 0]);
    this.held.clear();
    if (open.length) this.recorded.value = [...this.recorded.value, ...open];
  }

  clear() {
    this.finish();
    this.recorded.value = [];
  }

  /** Play a phrase, again and again when `loop`, until stop(). */
  start(phrase: Phrase, loop = false) {
    this.stop();
    if (!phrase.length) return;
    this.playing.value = phrase;
    const length = (phrase.at(-1)?.[0] ?? 0) + 400;
    const once = () => {
      // Every timer of the last pass has fired by now.
      this.timers = [];
      for (const [at, note, velocity] of phrase)
        this.timers.push(
          setTimeout(() => {
            if (velocity > 0) this.sounding.add(note);
            else this.sounding.delete(note);
            this.play(note, velocity);
          }, at),
        );
      this.timers.push(setTimeout(() => (loop ? once() : this.stop()), length));
    };
    once();
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    for (const note of this.sounding) this.play(note, 0);
    this.sounding.clear();
    this.playing.value = null;
  }
}
