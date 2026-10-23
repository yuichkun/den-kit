// den-kit's side of a code part: what a part gets to read and move. A part is a
// file in src/parts/ that exports `part({...})`; den-kit shows it on the plugin
// in its own box, feeds it the controls' values and the sound, and takes back
// what it moves (the sound follows at once, and ⌘Z takes it back).
//
//   import { part } from '../kit';
//   export default part({
//     props: { speed: { type: 'number', default: 1, min: 0, max: 4, label: 'Speed' } },
//     mount(root, kit) {
//       const canvas = root.appendChild(document.createElement('canvas'));
//       return kit.frame(() => { /* draw with kit.audio.level, kit.value('kcut'), kit.props.speed */ });
//     },
//   });
import { CONTROLS, type ControlId } from './controls';
import type { BehaviorEvent } from './behaviors/index';

export { CONTROLS, type ControlId };
/**
 * How den-kit's ready-made controls respond to input (knob, slider, button,
 * switch, XY pad, keyboard, meter), without a look: draw your own control and it
 * behaves like den-kit's. `behaviors.listen(element, behavior)` feeds it the
 * element's pointer, wheel and keys; `kit.bind(behavior, id)` lets it move a control.
 */
export * as behaviors from './behaviors/index';

/** A behavior that can move a control: it sends begin, value and end, and follows a value set elsewhere. */
export interface Bindable<V extends ControlValue = ControlValue> {
  readonly events: { on(listener: (event: BehaviorEvent<V>) => void): () => void };
  set?(value: V): void;
}

/** A setting of the part, shown in den-kit's inspector (the person or the AI changes it there; no code needed). */
export type PropSpec =
  | { type: 'number'; default: number; min?: number; max?: number; step?: number; label?: string }
  | { type: 'boolean'; default: boolean; label?: string }
  | { type: 'text'; default: string; label?: string }
  /** A colour: a CSS colour, or a look token name (bg, fg, accent, track, knob, pointer, muted, glow). */
  | { type: 'color'; default: string; label?: string }
  | { type: 'select'; default: string; options: readonly string[]; label?: string };
export type PropSpecs = Record<string, PropSpec>;
export type PropValues<P extends PropSpecs> = {
  [K in keyof P]: P[K] extends { type: 'number' }
    ? number
    : P[K] extends { type: 'boolean' }
      ? boolean
      : string;
};

/** A knob or slider: its value in its own unit. A switch: on or off. An XY pad: x and y from 0 to 1. */
export type ControlValue = number | boolean | { x: number; y: number };
export interface Audio {
  /** Loudness of the plugin's output now (0..1, RMS-like) and its recent peak. */
  level: number;
  peak: number;
  /** The last 256 samples of the output (−1..1). */
  wave: Float32Array;
  /** 64 bands of the output's spectrum, low to high, 0..1. */
  spectrum: Float32Array;
}

export interface Kit<P extends PropSpecs = PropSpecs> {
  /** This part's settings now. */
  readonly props: PropValues<P>;
  onProps(listener: (props: PropValues<P>) => void): () => void;
  /** A control's value now. */
  value<T extends ControlValue = number>(id: ControlId): T;
  /** Where a control stands from 0 to 1 (a log knob: along the knob; an XY pad: x). */
  norm(id: ControlId): number;
  /** Called when a control's value changes (whoever moved it). */
  on(id: ControlId, listener: (value: ControlValue) => void): () => void;
  /**
   * Move a control (clamped to its range). Moves between begin() and end() — one
   * drag — are one ⌘Z step; moves outside a drag that follow each other closely
   * (wheel turns) are one step too.
   */
  set(id: ControlId, value: ControlValue): void;
  /** Move a control to a position from 0 to 1 (a log knob: along the knob). */
  setNorm(id: ControlId, n: number): void;
  begin(): void;
  end(): void;
  /**
   * Let a behavior move a control: its gestures become moves (one drag, one ⌘Z
   * step), and it follows the control when something else moves it. Returns a
   * function that lets go.
   */
  bind<V extends ControlValue>(behavior: Bindable<V>, id: ControlId): () => void;
  /** The plugin's sound, fresh every frame. */
  readonly audio: Audio;
  /** Called every animation frame (dt and t in seconds) after the sound and the values are fresh; returns a stop function. */
  frame(listener: (dt: number, t: number) => void): () => void;
  /** The look's colours and fonts (bg, fg, accent, …, font, labelFont, valueFont). Also on the page as CSS variables --dk-bg, --dk-accent, … */
  readonly look: Readonly<Record<string, string>>;
  onLook(listener: (look: Readonly<Record<string, string>>) => void): () => void;
  /** The part's box in the plugin's design pixels. */
  readonly size: { readonly width: number; readonly height: number };
  onResize(listener: (size: { width: number; height: number }) => void): () => void;
  /** 'play': the musician plays it. 'edit': it is being laid out (it gets no mouse then). */
  readonly mode: 'play' | 'edit';
  onMode(listener: (mode: 'play' | 'edit') => void): () => void;
  /** A picture or font of the work (asset id) as a URL you can use, or null. */
  asset(id: string): Promise<string | null>;
}

export interface Part<P extends PropSpecs = PropSpecs> {
  props?: P;
  /** It takes the mouse while the plugin plays (default true). A backdrop behind the controls says false, so they stay playable. */
  interactive?: boolean;
  /** Build the part in `root` (it fills the part's box). Return a function that undoes it, if anything must be stopped. */
  mount(root: HTMLElement, kit: Kit<P>): void | (() => void);
}

/** Declare a part (the file's default export). */
export function part<P extends PropSpecs>(def: Part<P>): Part<P> {
  return def;
}
