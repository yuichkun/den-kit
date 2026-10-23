// The musical keyboard (rule 8): the computer keys play notes along one row (A
// is C, W and E the black keys above it), Z and X move an octave down and up,
// and dragging across the keys with the mouse plays each key it reaches. Where
// a key is clicked, from top to bottom, sets how hard the note is played. Each
// finger on a touch screen plays its own key.
import { Emitter, type KeyInput, type PointerInput } from './events.ts';

/** A note starting (velocity 1–127) or ending (velocity 0). */
export interface NoteEvent {
  note: number;
  velocity: number;
}

/** The computer keys, by their place in the octave from the C on A. */
const KEY_NOTES: Readonly<Record<string, number>> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
  o: 13,
  l: 14,
  p: 15,
  ';': 16,
};
const BLACK = new Set([1, 3, 6, 8, 10]);
export const isBlack = (note: number) => BLACK.has(((note % 12) + 12) % 12);
/** How far down a black key reaches, and how wide it is, against a white key. */
const BLACK_LENGTH = 0.6,
  BLACK_WIDTH = 0.6;

/** A piano keyboard: white keys side by side, black keys over their boundaries. */
export interface KeyboardLayout {
  /** The lowest and highest notes shown (MIDI note numbers). */
  low: number;
  high: number;
  width: number;
  height: number;
}
/** The key under a point and how hard a press there plays, for layouts other than a piano (pads). */
export type KeyFinder = (x: number, y: number) => NoteEvent | null;

/** Which key is under a point of the keyboard, black keys first. */
export function keyAt(layout: KeyboardLayout, x: number, y: number): number | null {
  if (x < 0 || y < 0 || x >= layout.width || y >= layout.height) return null;
  const whites: number[] = [];
  for (let n = layout.low; n <= layout.high; n++) if (!isBlack(n)) whites.push(n);
  if (!whites.length) return null;
  const w = layout.width / whites.length;
  const index = Math.min(whites.length - 1, Math.floor(x / w));
  const white = whites[index]!;
  if (y < layout.height * BLACK_LENGTH) {
    const within = x - index * w;
    const half = (1 - BLACK_WIDTH / 2) * w;
    if (within > half && white + 1 <= layout.high && isBlack(white + 1)) return white + 1;
    if (within < w - half && white - 1 >= layout.low && isBlack(white - 1)) return white - 1;
  }
  return white;
}

/** How hard a click plays: soft at the top of a key, hard at its bottom. */
export const velocityAt = (height: number, y: number) =>
  Math.max(1, Math.min(127, Math.round(1 + (126 * y) / Math.max(1, height))));

export class Keyboard {
  readonly events = new Emitter<NoteEvent>();
  layout: KeyboardLayout | KeyFinder;
  /** The C the A key plays. */
  octaveStart: number;
  private held = new Set<number>();
  private keysDown = new Map<string, number>();
  /** The key each pointer holds. */
  private pointers = new Map<number, number>();

  constructor(layout: KeyboardLayout | KeyFinder, octaveStart = 60) {
    this.layout = layout;
    this.octaveStart = octaveStart;
  }
  /** The notes playing now. */
  get notes(): number[] {
    return [...this.held].sort((a, b) => a - b);
  }
  /** The control's box (a piano layout spreads its keys over it). */
  fit(width: number, height: number) {
    if (typeof this.layout !== 'function') this.layout = { ...this.layout, width, height };
  }
  private hit(x: number, y: number): NoteEvent | null {
    if (typeof this.layout === 'function') return this.layout(x, y);
    const note = keyAt(this.layout, x, y);
    return note === null ? null : { note, velocity: velocityAt(this.layout.height, y) };
  }
  private on(note: number, velocity: number) {
    if (note < 0 || note > 127 || this.held.has(note)) return;
    if (!this.held.size) this.events.emit({ type: 'begin' });
    this.held.add(note);
    this.events.emit({ type: 'value', value: { note, velocity } });
  }
  private off(note: number) {
    // Another finger or key still holds it.
    if ([...this.pointers.values(), ...this.keysDown.values()].includes(note)) return;
    if (!this.held.delete(note)) return;
    this.events.emit({ type: 'value', value: { note, velocity: 0 } });
    if (!this.held.size) this.events.emit({ type: 'end' });
  }

  pointerDown(input: PointerInput) {
    const id = input.pointer ?? 0;
    const key = this.hit(input.x, input.y);
    if (!key || this.pointers.has(id)) return;
    this.pointers.set(id, key.note);
    this.on(key.note, key.velocity);
  }
  /** Dragging across the keys plays each key it reaches. */
  pointerMove(input: PointerInput) {
    const id = input.pointer ?? 0;
    const old = this.pointers.get(id);
    if (old === undefined) return;
    const key = this.hit(input.x, input.y);
    if (!key || key.note === old) return;
    this.pointers.set(id, key.note);
    this.off(old);
    this.on(key.note, key.velocity);
  }
  pointerUp(input: Partial<PointerInput> = {}) {
    const id = input.pointer ?? 0;
    const note = this.pointers.get(id);
    if (note === undefined) return;
    this.pointers.delete(id);
    this.off(note);
  }

  /** Computer keys: notes, and Z / X for the octave. Returns whether the key was the keyboard's. */
  keyDown(input: KeyInput, velocity = 100): boolean {
    if (input.command) return false;
    const key = input.key.toLowerCase();
    if (key === 'z' || key === 'x') {
      if (!input.repeat)
        this.octaveStart = Math.max(0, Math.min(108, this.octaveStart + (key === 'z' ? -12 : 12)));
      return true;
    }
    const offset = KEY_NOTES[key];
    if (offset === undefined) return false;
    if (input.repeat || this.keysDown.has(key)) return true;
    const note = this.octaveStart + offset;
    this.keysDown.set(key, note);
    this.on(note, velocity);
    return true;
  }
  /** A note ends when its key comes up, with or without Cmd, Ctrl or Alt. */
  keyUp(input: KeyInput): boolean {
    const key = input.key.toLowerCase();
    const note = this.keysDown.get(key);
    if (note === undefined) return KEY_NOTES[key] !== undefined || key === 'z' || key === 'x';
    this.keysDown.delete(key);
    this.off(note);
    return true;
  }
  /** Everything stops (focus lost, the page hidden). */
  releaseAll() {
    this.keysDown.clear();
    this.pointers.clear();
    for (const note of this.notes) this.off(note);
  }
  aria(label: string) {
    return {
      role: 'application',
      'aria-label': `${label}: keys A to ; play notes, Z and X change the octave`,
      tabindex: 0,
    } as const;
  }
}

export const createKeyboard = (layout: KeyboardLayout | KeyFinder, octaveStart?: number) =>
  new Keyboard(layout, octaveStart);
