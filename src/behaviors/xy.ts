// XY pads (rule 7): a click puts the point where the pointer is and it follows
// the pointer; the arrow keys move x and y. Both axes have their own range;
// y rises upward.
import { Emitter, type KeyInput, type PointerInput } from './events.ts';
import { KEY_BIG_STEP, KEY_STEP } from './knob.ts';
import { defaultOf, fromPosition, toPosition, type Range } from './range.ts';

export interface XY {
  x: number;
  y: number;
}

export class XYPad {
  readonly events = new Emitter<XY>();
  private ranges: { x: Range; y: Range };
  /** The pad's size in pixels. */
  size: { width: number; height: number };
  private position: XY;
  private dragging = false;

  constructor(ranges: { x: Range; y: Range }, size: { width: number; height: number }, value?: XY) {
    this.ranges = ranges;
    this.size = size;
    this.position = {
      x: toPosition(ranges.x, value?.x ?? defaultOf(ranges.x)),
      y: toPosition(ranges.y, value?.y ?? defaultOf(ranges.y)),
    };
  }
  get value(): XY {
    return {
      x: fromPosition(this.ranges.x, this.position.x),
      y: fromPosition(this.ranges.y, this.position.y),
    };
  }
  set(value: XY) {
    this.position = {
      x: toPosition(this.ranges.x, value.x),
      y: toPosition(this.ranges.y, value.y),
    };
  }
  private moveTo(x: number, y: number) {
    const next = { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
    if (next.x === this.position.x && next.y === this.position.y) return;
    this.position = next;
    this.events.emit({ type: 'value', value: this.value });
  }
  private at(input: PointerInput) {
    return {
      x: input.x / Math.max(1, this.size.width),
      y: 1 - input.y / Math.max(1, this.size.height),
    };
  }
  /** The control's box. */
  fit(width: number, height: number) {
    this.size = { width, height };
  }
  pointerDown(input: PointerInput) {
    this.dragging = true;
    this.events.emit({ type: 'begin' });
    const p = this.at(input);
    this.moveTo(p.x, p.y);
  }
  pointerMove(input: PointerInput) {
    if (!this.dragging) return;
    const p = this.at(input);
    this.moveTo(p.x, p.y);
  }
  pointerUp() {
    if (!this.dragging) return;
    this.dragging = false;
    this.events.emit({ type: 'end' });
  }
  keyDown(input: KeyInput): boolean {
    if (input.command) return false;
    const step = input.shift ? KEY_BIG_STEP : KEY_STEP;
    const { x, y } = this.position;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [x - step, y],
      ArrowRight: [x + step, y],
      ArrowUp: [x, y + step],
      ArrowDown: [x, y - step],
    };
    const to = moves[input.key];
    if (!to) return false;
    this.events.emit({ type: 'begin' });
    this.moveTo(to[0], to[1]);
    this.events.emit({ type: 'end' });
    return true;
  }
  aria(label: string) {
    const v = this.value;
    return {
      role: 'slider',
      'aria-label': label,
      'aria-valuetext': `x ${Math.round(v.x * 1000) / 1000}, y ${Math.round(v.y * 1000) / 1000}`,
      tabindex: 0,
    } as const;
  }
}

export const createXYPad = (
  ranges: { x: Range; y: Range },
  size: { width: number; height: number },
  value?: XY,
) => new XYPad(ranges, size, value);
