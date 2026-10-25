// The musical keyboard in Storybook: each skin, and den-kit's keyboard behavior tried with the
// pointer on the real control. The computer keys are played by whoever shows the keyboard, so
// they are not tried here. The rules are in src/behaviors/index.ts; test/unit/behaviors checks
// each in detail.
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';
import { expect, fn } from 'storybook/test';
import { SKINS } from '../../work/skins.ts';
import { DkKeyboard } from './keyboard.ts';
import { partOf, pointer } from './story-gestures.ts';

interface Args {
  start: number;
  octaves: number;
  skin: string;
  onNote: (e: Event) => void;
}

const keyboardOf = (canvas: HTMLElement) => canvas.querySelector('dk-keyboard') as DkKeyboard;
/** Where the key for `note` is, inside the keys' area: its middle, `depth` of the way down. */
function keyAt(keys: HTMLElement, note: number, depth = 0.8): [number, number] {
  const key = keys.querySelector(`[data-note="${note}"]`)!.getBoundingClientRect();
  const area = keys.getBoundingClientRect();
  return [key.left - area.left + key.width / 2, key.top - area.top + key.height * depth];
}
const notes = (onNote: (e: Event) => void) =>
  (onNote as unknown as { mock: { calls: Array<[CustomEvent]> } }).mock.calls.map(
    ([e]) => e.detail as { note: number; on: boolean },
  );

const meta = {
  title: 'Controls/Keyboard',
  component: 'dk-keyboard',
  // The accessibility check reports, without failing: the letters on the keys are below 4.5:1
  // contrast.
  parameters: { a11y: { test: 'todo' } },
  args: { start: 48, octaves: 2, skin: 'piano', onNote: fn() },
  argTypes: {
    skin: {
      control: 'select',
      options: SKINS.filter(s => s.control === 'keyboard').map(s => s.name),
    },
  },
  render: a =>
    html`<dk-keyboard
      style="display:block;width:420px;height:120px"
      start=${a.start}
      octaves=${a.octaves}
      skin=${a.skin}
      @note=${a.onNote}
    ></dk-keyboard>`,
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const Piano: Story = {};
export const Pads: Story = { args: { skin: 'pads' } };

/** Rule 8: a pressed key plays its note until it is let go. */
export const PlayAKey: Story = {
  play: async ({ canvasElement, args }) => {
    const keys = partOf(keyboardOf(canvasElement), '.kb');
    pointer(keys, 'pointerdown', keyAt(keys, 60));
    pointer(keys, 'pointerup', keyAt(keys, 60));
    await expect(notes(args.onNote)).toMatchObject([
      { note: 60, on: true },
      { note: 60, on: false },
    ]);
  },
};

/** Rule 8: dragging across the keys plays each key it reaches. */
export const DragAcross: Story = {
  play: async ({ canvasElement, args }) => {
    const keys = partOf(keyboardOf(canvasElement), '.kb');
    pointer(keys, 'pointerdown', keyAt(keys, 60));
    pointer(keys, 'pointermove', keyAt(keys, 62));
    pointer(keys, 'pointerup', keyAt(keys, 62));
    await expect(
      notes(args.onNote)
        .filter(n => n.on)
        .map(n => n.note),
    ).toEqual([60, 62]);
  },
};
