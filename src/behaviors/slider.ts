// Sliders (faders): like a knob, but dragged along their own track; the value
// moves by as much as the pointer moves along it, from wherever it was grabbed.
import { Continuous } from './knob.ts';
import type { PointerInput } from './events.ts';
import type { Range } from './range.ts';

export interface SliderShape {
  /** Which way it runs: vertical sliders rise upward. */
  orientation: 'vertical' | 'horizontal';
  /** The length of its track in pixels: dragging this far moves it through its whole range. */
  length: number;
}

/** Rule 5: no jump on click; the drag carries the value along the track. */
export class Slider extends Continuous {
  shape: SliderShape;
  constructor(range: Range, shape: SliderShape, value?: number) {
    super(range, value);
    this.shape = shape;
  }
  private along(input: PointerInput) {
    return this.shape.orientation === 'vertical' ? -input.y : input.x;
  }
  pointerDown(input: PointerInput) {
    this.dragStart(this.along(input));
  }
  pointerMove(input: PointerInput) {
    this.dragMove(this.along(input), !!input.shift, 1 / Math.max(1, this.shape.length));
  }
}

export const createSlider = (range: Range, shape: SliderShape, value?: number) =>
  new Slider(range, shape, value);
