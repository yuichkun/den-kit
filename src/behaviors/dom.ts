// Input from the page to a behavior: pointer, wheel, keys and double-click on an
// element, turned into the values the behaviors take. The ready-made controls
// and code parts both listen through this, so they respond the same way.
import type { KeyInput, PointerInput, WheelInput } from './events.ts';

/** What a behavior may take. */
export interface InputTaker {
  pointerDown?(input: PointerInput): void;
  pointerMove?(input: PointerInput): void;
  pointerUp?(input?: Partial<PointerInput>): void;
  wheel?(input: WheelInput): void;
  keyDown?(input: KeyInput): boolean;
  keyUp?(input: KeyInput): boolean;
  doubleClick?(): void;
  /** The box the pointer moves in, measured when a press starts. */
  fit?(width: number, height: number): void;
  /** Focus left: let go of whatever keys hold. */
  releaseAll?(): void;
}

export interface ListenOptions {
  /** The part of the element that takes the pointer (default: the element itself). */
  target?: HTMLElement;
  /** The box the behavior gets, from the target's (default: the target's own size on screen). */
  box?: (rect: DOMRect) => { width: number; height: number };
}

const keyOf = (e: KeyboardEvent): KeyInput => ({
  key: e.key,
  shift: e.shiftKey,
  repeat: e.repeat,
  command: e.metaKey || e.ctrlKey || e.altKey,
});

/** Feed an element's input to a behavior; returns a function that stops it. The element takes keyboard focus. */
export function listen(
  element: HTMLElement,
  behavior: InputTaker,
  options: ListenOptions = {},
): () => void {
  const target = options.target ?? element;
  const at = (e: PointerEvent): PointerInput => {
    const r = target.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, shift: e.shiftKey, pointer: e.pointerId };
  };
  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      target.setPointerCapture?.(e.pointerId);
    } catch {
      // A pointer the browser no longer tracks (it was let go meanwhile): the press still counts.
    }
    const r = target.getBoundingClientRect();
    const box = options.box?.(r) ?? { width: r.width, height: r.height };
    behavior.fit?.(box.width, box.height);
    behavior.pointerDown?.(at(e));
    element.focus({ preventScroll: true });
  };
  const move = (e: PointerEvent) => behavior.pointerMove?.(at(e));
  const up = (e: PointerEvent) => behavior.pointerUp?.(at(e));
  const wheel = (e: WheelEvent) => {
    if (!behavior.wheel || e.deltaY === 0) return;
    e.preventDefault();
    behavior.wheel({ up: e.deltaY < 0, shift: e.shiftKey });
  };
  // A key the control takes is the control's alone: the page's shortcuts do not see it.
  const keydown = (e: KeyboardEvent) => {
    if (behavior.keyDown?.(keyOf(e))) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const keyup = (e: KeyboardEvent) => {
    if (behavior.keyUp?.(keyOf(e))) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const dblclick = (e: MouseEvent) => {
    if (!behavior.doubleClick) return;
    e.preventDefault();
    behavior.doubleClick();
  };
  const blur = () => behavior.releaseAll?.();
  if (element.tabIndex < 0) element.tabIndex = 0;
  const on: Array<[EventTarget, string, EventListener, AddEventListenerOptions?]> = [
    [target, 'pointerdown', down as EventListener],
    [target, 'pointermove', move as EventListener],
    [target, 'pointerup', up as EventListener],
    [target, 'pointercancel', up as EventListener],
    [target, 'wheel', wheel as EventListener, { passive: false }],
    [target, 'dblclick', dblclick as EventListener],
    [element, 'keydown', keydown as EventListener],
    [element, 'keyup', keyup as EventListener],
    [element, 'blur', blur],
  ];
  for (const [t, type, fn, opts] of on) t.addEventListener(type, fn, opts);
  return () => {
    for (const [t, type, fn] of on) t.removeEventListener(type, fn);
  };
}
