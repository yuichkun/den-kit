// Buttons and switches (rule 6): a button is on only while it is pressed, a
// switch changes each time it is pressed. Space and Enter press both. A button
// held by a key is let go when focus leaves it: the key's release goes elsewhere.
import { Emitter, type KeyInput } from './events.ts';

const PRESS_KEYS = new Set([' ', 'Enter']);

/** Momentary: on while held. */
export class Button {
  readonly events = new Emitter<boolean>();
  private down = false;
  private key: string | null = null;
  get value() {
    return this.down;
  }
  pointerDown() {
    if (this.down) return;
    this.down = true;
    this.events.emit({ type: 'begin' });
    this.events.emit({ type: 'value', value: true });
  }
  pointerUp() {
    if (!this.down || this.key) return;
    this.release();
  }
  keyDown(input: KeyInput): boolean {
    if (input.command || !PRESS_KEYS.has(input.key)) return false;
    if (input.repeat || this.down) return true;
    this.key = input.key;
    this.pointerDown();
    return true;
  }
  keyUp(input: KeyInput): boolean {
    if (input.key !== this.key) return PRESS_KEYS.has(input.key);
    this.key = null;
    this.release();
    return true;
  }
  /** Focus left: let go, whatever held it. */
  releaseAll() {
    if (!this.down) return;
    this.key = null;
    this.release();
  }
  private release() {
    this.down = false;
    this.events.emit({ type: 'value', value: false });
    this.events.emit({ type: 'end' });
  }
  aria(label: string) {
    return { role: 'button', 'aria-label': label, 'aria-pressed': this.down, tabindex: 0 } as const;
  }
}

/** Latching: each press changes it. */
export class Switch {
  readonly events = new Emitter<boolean>();
  private on: boolean;
  constructor(value = false) {
    this.on = value;
  }
  get value() {
    return this.on;
  }
  set(value: boolean) {
    this.on = value;
  }
  pointerDown() {
    this.on = !this.on;
    this.events.once(this.on);
  }
  keyDown(input: KeyInput): boolean {
    if (input.command || !PRESS_KEYS.has(input.key)) return false;
    if (!input.repeat) this.pointerDown();
    return true;
  }
  aria(label: string) {
    return { role: 'switch', 'aria-label': label, 'aria-checked': this.on, tabindex: 0 } as const;
  }
}

export const createButton = () => new Button();
export const createSwitch = (value?: boolean) => new Switch(value);
