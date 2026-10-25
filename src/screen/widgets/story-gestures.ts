// Gestures for the controls' stories (*.stories.ts): presses and drags on the part of a control
// that takes the pointer, sent as the browser sends them.

type Point = [x: number, y: number];

/** The element in a control's shadow DOM that takes the pointer (a knob's `.dial`, a slider's `.track`, …). */
export const partOf = (control: Element, selector: string) =>
  control.shadowRoot!.querySelector(selector) as HTMLElement;

/** One pointer event on `part`, at a point in pixels from its top left corner. */
export function pointer(
  part: HTMLElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  at: Point,
) {
  const box = part.getBoundingClientRect();
  part.dispatchEvent(
    new PointerEvent(type, {
      clientX: box.left + at[0],
      clientY: box.top + at[1],
      pointerId: 1,
      button: 0,
      bubbles: true,
      composed: true,
    }),
  );
}

/** Press at `from`, move through each point of `to`, and let go at the last. */
export function drag(part: HTMLElement, from: Point, ...to: Point[]) {
  pointer(part, 'pointerdown', from);
  for (const at of to) pointer(part, 'pointermove', at);
  pointer(part, 'pointerup', to.at(-1) ?? from);
}
