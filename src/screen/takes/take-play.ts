// Playing a take (src/work/takes.ts) on a plugin screen: its moves go out as control
// values and its notes as notes, at their times, to whoever shows the screen (the
// player, or the editor's look as the recipient), which applies them like the
// person's own. Each control, and the keys, is played by the take or by the person:
// a control the person has in hand (they grabbed it) gets nothing from the take
// until they give it back, when it returns to where the take has it then; keys in
// the person's hand silence the take's notes. Played from the middle, the notes held
// there sound from there. Nothing here changes a work. The
// clock is passed in and `tick` is called by whoever shows it, so tests drive time.
import type { Take, TakeMove, TakeValues } from '../../work/takes.ts';

export interface TakeOutput {
  move(control: string, values: TakeValues): void;
  note(note: number, on: boolean, velocity: number): void;
}

type Cue =
  | { t: number; kind: 'move'; control: string; values: TakeValues }
  | { t: number; kind: 'note'; note: number; on: boolean; velocity: number };

export class TakePlayback {
  readonly take: Take;
  /** Controls the person plays; the take leaves them alone. */
  readonly hand = new Set<string>();
  /** The person plays the keys; the take's notes are silent. */
  keysInHand = false;
  /** Called when the take (or the part being played) reaches its end. */
  onEnd: (() => void) | null = null;
  private readonly cues: Cue[];
  private readonly tracks = new Map<string, TakeMove[]>();
  private readonly sounding = new Set<number>();
  /** When each control last got a move from the take (take time). */
  private readonly moved = new Map<string, number>();
  private next = 0;
  private from = 0;
  private startedAt = 0;
  private range: { from: number; to: number } | null = null;
  playing = false;
  private readonly out: TakeOutput;
  private readonly now: () => number;

  constructor(take: Take, out: TakeOutput, now: () => number = () => performance.now()) {
    this.take = take;
    this.out = out;
    this.now = now;
    const cues: Cue[] = take.moves.map(m => ({
      t: m.t,
      kind: 'move',
      control: m.control,
      values: m.values,
    }));
    for (const n of take.notes) {
      cues.push({ t: n.t, kind: 'note', note: n.note, on: true, velocity: n.velocity });
      cues.push({ t: n.t + n.length, kind: 'note', note: n.note, on: false, velocity: 0 });
    }
    // At the same time, a note ends before one starts (the same note played again sounds again).
    const order = (c: Cue) => (c.kind === 'note' ? (c.on ? 2 : 0) : 1);
    this.cues = cues.sort((a, b) => a.t - b.t || order(a) - order(b));
    for (const m of take.moves) {
      const list = this.tracks.get(m.control) ?? [];
      list.push(m);
      this.tracks.set(m.control, list);
    }
  }

  /** The controls the take moves, and the ones it only sets when it starts. */
  get controls(): string[] {
    return [...new Set([...this.tracks.keys(), ...Object.keys(this.take.start)])];
  }
  get moving(): string[] {
    return [...this.tracks.keys()];
  }
  get end() {
    return this.range ? this.range.to : this.take.length;
  }
  get position() {
    if (!this.playing) return this.from;
    return Math.min(this.end, this.from + (this.now() - this.startedAt));
  }

  /** A control's values where the take is at `t` (now, by default). */
  valuesAt(control: string, t = this.position): TakeValues | undefined {
    const track = this.tracks.get(control);
    const start = this.take.start[control];
    if (!track?.length) return start ? { ...start } : undefined;
    let lo = 0,
      hi = track.length - 1,
      found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (track[mid]!.t <= t) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (found < 0) return start ? { ...start } : undefined;
    return { ...start, ...track[found]!.values };
  }
  /** The take's moves of a control between two times, for drawing where it goes. */
  movesOf(control: string, from: number, to: number): TakeMove[] {
    return (this.tracks.get(control) ?? []).filter(m => m.t >= from && m.t <= to);
  }
  /** The take moved this control within the last `ms`. */
  isMoving(control: string, ms = 350) {
    const at = this.moved.get(control);
    return this.playing && at !== undefined && this.position - at <= ms;
  }

  /** Play from `from` (the start, or where it stopped), the controls first set to where the take has them there. */
  play(from?: number) {
    let at = from ?? this.position;
    if (at >= this.end) at = this.range?.from ?? 0;
    this.releaseNotes();
    this.settle(at);
    if (!this.keysInHand)
      for (const n of this.take.notes)
        if (n.t < at && n.t + n.length > at && !this.sounding.has(n.note)) {
          this.sounding.add(n.note);
          this.out.note(n.note, true, n.velocity);
        }
    this.from = at;
    this.startedAt = this.now();
    this.next = this.cues.findIndex(c => c.t >= at);
    if (this.next < 0) this.next = this.cues.length;
    this.playing = true;
    this.tick();
  }
  /** Play only from `from` to `to`, then stop (a step, watched). */
  playRange(from: number, to: number) {
    this.range = { from, to: Math.max(from, to) };
    this.play(from);
  }
  /** Leave the part being played (back to the whole take), where it is. */
  clearRange() {
    const at = this.position;
    this.range = null;
    if (!this.playing) this.from = at;
  }
  pause() {
    this.from = this.position;
    this.playing = false;
    this.releaseNotes();
  }
  /** Set every control the take names to where it has it at `t`, without playing. */
  seek(t: number) {
    const was = this.playing;
    this.pause();
    this.from = Math.max(0, Math.min(t, this.take.length));
    this.settle(this.from);
    if (was) this.play(this.from);
  }

  /** The person took a control: the take leaves it alone. */
  grab(control: string) {
    this.hand.add(control);
  }
  /** The person gave a control back: it returns to where the take has it now. */
  giveBack(control: string) {
    if (!this.hand.delete(control)) return;
    const values = this.valuesAt(control);
    if (values) this.out.move(control, values);
  }
  setKeysInHand(mine: boolean) {
    this.keysInHand = mine;
    if (mine) this.releaseNotes();
  }

  /** Send what is due; call often while playing. */
  tick() {
    if (!this.playing) return;
    const at = this.position;
    while (this.next < this.cues.length && this.cues[this.next]!.t <= at) {
      const cue = this.cues[this.next++]!;
      if (cue.kind === 'move') {
        if (this.hand.has(cue.control)) continue;
        this.moved.set(cue.control, cue.t);
        this.out.move(cue.control, cue.values);
      } else if (cue.on) {
        if (this.keysInHand) continue;
        if (this.sounding.has(cue.note)) this.out.note(cue.note, false, 0);
        this.sounding.add(cue.note);
        this.out.note(cue.note, true, cue.velocity);
      } else if (this.sounding.delete(cue.note)) this.out.note(cue.note, false, 0);
    }
    if (at >= this.end) {
      this.from = this.end;
      this.playing = false;
      this.releaseNotes();
      this.onEnd?.();
    }
  }

  private settle(t: number) {
    for (const control of this.controls) {
      if (this.hand.has(control)) continue;
      // Where it is just before `t` (the take's times are whole ms): a move at `t` is sent as it plays.
      const values = this.valuesAt(control, t - 0.5);
      if (values) this.out.move(control, values);
    }
  }
  private releaseNotes() {
    for (const n of this.sounding) this.out.note(n, false, 0);
    this.sounding.clear();
  }
}
