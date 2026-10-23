// What every behavior sends, and the input it takes.

/** begin: a gesture starts; value: a new value; end: the gesture is over. */
export type BehaviorEvent<V> = { type: 'begin' } | { type: 'value'; value: V } | { type: 'end' };
export type Listener<V> = (event: BehaviorEvent<V>) => void;

/** A pointer (mouse, pen or touch) at a position, in pixels of the control's own box. */
export interface PointerInput {
  x: number;
  y: number;
  shift?: boolean;
  /** Which pointer: each finger on a touch screen is its own. */
  pointer?: number;
}
/** One wheel notch: up (toward the user's screen top) is positive. */
export interface WheelInput {
  up: boolean;
  shift?: boolean;
}
/** A key, as KeyboardEvent.key names it. */
export interface KeyInput {
  key: string;
  shift?: boolean;
  /** Held down and repeating. */
  repeat?: boolean;
  /** Pressed with Cmd, Ctrl or Alt: a shortcut of the app, which no control takes. */
  command?: boolean;
}

/** Listeners, and the begin/value/end of one change. */
export class Emitter<V> {
  private listeners = new Set<Listener<V>>();
  on(listener: Listener<V>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  emit(event: BehaviorEvent<V>) {
    for (const listener of this.listeners) listener(event);
  }
  /** A change that is a gesture of its own (a key, a notch, a double-click). */
  once(value: V) {
    this.emit({ type: 'begin' });
    this.emit({ type: 'value', value });
    this.emit({ type: 'end' });
  }
}
