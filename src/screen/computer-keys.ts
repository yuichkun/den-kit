// The computer keys as a musical keyboard, for whoever shows one: the keyboard
// behavior's rule (A plays C, W and E the black keys above it, Z and X move an
// octave), heard on the whole page. Keys typed into a text field, and shortcuts
// with Cmd, Ctrl or Alt, are left alone.
import { Keyboard } from '../behaviors/index.ts';

export interface ComputerKeys {
  /** The note the A key plays now. */
  readonly octaveStart: number;
  /** Stop listening, ending the notes the keys hold. */
  stop(): void;
}

export function computerKeys(options: {
  octaveStart: number;
  onNote(note: number, velocity: number): void;
  onOctave?(octaveStart: number): void;
}): ComputerKeys {
  // Only the computer keys play it: there is nothing to point at.
  const keyboard = new Keyboard(() => null, options.octaveStart);
  keyboard.events.on(e => {
    if (e.type === 'value') options.onNote(e.value.note, e.value.velocity);
  });
  const typing = (e: KeyboardEvent) =>
    !!(e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]');
  const down = (e: KeyboardEvent) => {
    if (typing(e)) return;
    const before = keyboard.octaveStart;
    keyboard.keyDown({
      key: e.key,
      shift: e.shiftKey,
      repeat: e.repeat,
      command: e.metaKey || e.ctrlKey || e.altKey,
    });
    if (keyboard.octaveStart !== before) options.onOctave?.(keyboard.octaveStart);
  };
  const up = (e: KeyboardEvent) => keyboard.keyUp({ key: e.key });
  const release = () => keyboard.releaseAll();
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', release);
  return {
    get octaveStart() {
      return keyboard.octaveStart;
    },
    stop() {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
      release();
    },
  };
}
