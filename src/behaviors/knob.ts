// Knobs (and what knobs and sliders share): a value in a range, moved by a
// drag, the wheel, the keyboard, and reset by a double-click.
import { Emitter, type KeyInput, type PointerInput, type WheelInput } from './events.ts';
import { defaultOf, fromPosition, toPosition, type Range } from './range.ts';

/** Pixels of drag that move a knob through its whole range (rule 1). */
export const KNOB_TRAVEL_PX = 200;
/** How much finer Shift makes a drag (rule 1). */
export const FINE = 0.1;
/** A wheel notch: 1% of the range, 0.1% with Shift (rule 3). */
export const WHEEL_STEP = 0.01;
/** Arrow keys: 1% of the range; Shift with an arrow, Page Up and Page Down: 10% (rule 4). */
export const KEY_STEP = 0.01;
export const KEY_BIG_STEP = 0.1;

/** What knobs and sliders share: the value, the wheel, the keys and the reset. */
export class Continuous {
  readonly events = new Emitter<number>();
  protected position: number;
  protected range: Range;
  private dragging = false;
  /** Where the pointer was at the last move, along the drag's axis. */
  private last = 0;

  constructor(range: Range, value = defaultOf(range)) {
    this.range = range;
    this.position = toPosition(range, value);
  }
  get value(): number {
    return fromPosition(this.range, this.position);
  }
  /** Follow a value set elsewhere (another control, the AI, an undo): no events. */
  set(value: number) {
    this.position = toPosition(this.range, value);
  }
  setRange(range: Range) {
    const value = this.value;
    this.range = range;
    this.position = toPosition(range, value);
  }
  get min() {
    return this.range.min;
  }
  get max() {
    return this.range.max;
  }
  get dragged() {
    return this.dragging;
  }

  /** Move to a position (0 to 1) and say so when it changed. */
  protected moveTo(position: number) {
    const next = Math.min(1, Math.max(0, position));
    if (next === this.position) return;
    this.position = next;
    this.events.emit({ type: 'value', value: this.value });
  }

  /** A drag along one axis: `at` is the pointer's place on it. */
  protected dragStart(at: number) {
    this.dragging = true;
    this.last = at;
    this.events.emit({ type: 'begin' });
  }
  /** Each movement counts at the speed it is made at (`perPixel` of travel a pixel, finer with Shift). */
  protected dragMove(at: number, fine: boolean, perPixel: number) {
    if (!this.dragging) return;
    const delta = (at - this.last) * perPixel * (fine ? FINE : 1);
    this.last = at;
    this.moveTo(this.position + delta);
  }
  pointerUp() {
    if (!this.dragging) return;
    this.dragging = false;
    this.events.emit({ type: 'end' });
  }

  /** Rule 3. */
  wheel(input: WheelInput) {
    const step = (input.shift ? WHEEL_STEP * FINE : WHEEL_STEP) * (input.up ? 1 : -1);
    this.events.emit({ type: 'begin' });
    this.moveTo(this.position + step);
    this.events.emit({ type: 'end' });
  }

  /** Rule 4. Returns whether the key was the control's (then the page should not act on it). */
  keyDown(input: KeyInput): boolean {
    if (input.command) return false;
    const small = input.shift ? KEY_BIG_STEP : KEY_STEP;
    let next: number;
    switch (input.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        next = this.position + small;
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        next = this.position - small;
        break;
      case 'PageUp':
        next = this.position + KEY_BIG_STEP;
        break;
      case 'PageDown':
        next = this.position - KEY_BIG_STEP;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = 1;
        break;
      default:
        return false;
    }
    this.events.emit({ type: 'begin' });
    this.moveTo(next);
    this.events.emit({ type: 'end' });
    return true;
  }

  /** Rule 2. */
  doubleClick() {
    this.events.emit({ type: 'begin' });
    this.moveTo(toPosition(this.range, defaultOf(this.range)));
    this.events.emit({ type: 'end' });
  }

  /** What assistive technology needs: the role and the value. */
  aria(label: string, text = String(Math.round(this.value * 1000) / 1000)) {
    return {
      role: 'slider',
      'aria-label': label,
      'aria-valuemin': this.range.min,
      'aria-valuemax': this.range.max,
      'aria-valuenow': this.value,
      'aria-valuetext': text,
      tabindex: 0,
    } as const;
  }
}

/** A knob (rule 1): dragging up raises it, by the same amount wherever it was grabbed. */
export class Knob extends Continuous {
  pointerDown(input: PointerInput) {
    this.dragStart(-input.y);
  }
  pointerMove(input: PointerInput) {
    this.dragMove(-input.y, !!input.shift, 1 / KNOB_TRAVEL_PX);
  }
}

export const createKnob = (range: Range, value?: number) => new Knob(range, value);
