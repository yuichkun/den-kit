// The musical keyboard (rule 8): the computer keys play notes along one row (A
// is C, W and E the black keys above it), Z and X move an octave down and up,
// and dragging across the keys with the mouse plays each key it reaches. Where
// a key is clicked, from top to bottom, sets how hard the note is played.
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

export interface KeyboardLayout {
  /** The lowest and highest notes shown (MIDI note numbers). */
  low: number;
  high: number;
  width: number;
  height: number;
}

/** Which key is under a point of the keyboard, black keys first. */
export function keyAt(layout: KeyboardLayout, x: number, y: number): number | null {
  if (x < 0 || y < 0 || x >= layout.width || y >= layout.height) return null;
  const whites: number[] = [];
  for (let n = layout.low; n <= layout.high; n++) if (!isBlack(n)) whites.push(n);
  if (!whites.length) return null;
  const w = layout.width / whites.length;
  const index = Math.min(whites.length - 1, Math.floor(x / w));
  const white = whites[index]!;
  if (y < layout.height * 0.62) {
    const within = x - index * w;
    // A black key sits across the boundary between two white keys, 0.6 of a white key wide.
    if (within > w * 0.7 && white + 1 <= layout.high && isBlack(white + 1)) return white + 1;
    if (within < w * 0.3 && white - 1 >= layout.low && isBlack(white - 1)) return white - 1;
  }
  return white;
}

/** How hard a click plays: soft at the top of a key, hard at its bottom. */
export const velocityAt = (layout: KeyboardLayout, y: number) =>
  Math.max(1, Math.min(127, Math.round(1 + (126 * y) / Math.max(1, layout.height))));

export class Keyboard {
  readonly events = new Emitter<NoteEvent>();
  layout: KeyboardLayout;
  /** The C the A key plays. */
  octaveStart: number;
  private held = new Set<number>();
  private keysDown = new Map<string, number>();
  private pointerNote: number | null = null;

  constructor(layout: KeyboardLayout, octaveStart = 60) {
    this.layout = layout;
    this.octaveStart = octaveStart;
  }
  /** The notes playing now. */
  get notes(): number[] {
    return [...this.held].sort((a, b) => a - b);
  }
  private on(note: number, velocity: number) {
    if (note < 0 || note > 127 || this.held.has(note)) return;
    if (!this.held.size) this.events.emit({ type: 'begin' });
    this.held.add(note);
    this.events.emit({ type: 'value', value: { note, velocity } });
  }
  private off(note: number) {
    if (!this.held.delete(note)) return;
    this.events.emit({ type: 'value', value: { note, velocity: 0 } });
    if (!this.held.size) this.events.emit({ type: 'end' });
  }

  pointerDown(input: PointerInput) {
    const note = keyAt(this.layout, input.x, input.y);
    if (note === null) return;
    this.pointerNote = note;
    this.on(note, velocityAt(this.layout, input.y));
  }
  /** Dragging across the keys plays each key it reaches. */
  pointerMove(input: PointerInput) {
    if (this.pointerNote === null) return;
    const note = keyAt(this.layout, input.x, input.y);
    if (note === null || note === this.pointerNote) return;
    this.off(this.pointerNote);
    this.pointerNote = note;
    this.on(note, velocityAt(this.layout, input.y));
  }
  pointerUp() {
    if (this.pointerNote === null) return;
    this.off(this.pointerNote);
    this.pointerNote = null;
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
    this.pointerNote = null;
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

export const createKeyboard = (layout: KeyboardLayout, octaveStart?: number) =>
  new Keyboard(layout, octaveStart);
