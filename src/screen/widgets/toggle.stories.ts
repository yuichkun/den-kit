// The switch and the momentary button in Storybook (both are dk-toggle; `momentary` makes the
// button): each skin (the image skin needs pictures), and den-kit's button behaviors tried on the
// real control. The rules are in src/behaviors/index.ts; test/unit/behaviors checks each in detail.
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html, nothing } from 'lit';
import { expect, fn, userEvent } from 'storybook/test';
import { SKINS } from '../../work/skins.ts';
import { partOf, pointer } from './story-gestures.ts';
import { DkToggle } from './toggle.ts';

interface Args {
  value: boolean;
  momentary: boolean;
  label: string;
  skin: string;
  onInput: (e: Event) => void;
  onChange: (e: Event) => void;
}

const toggleOf = (canvas: HTMLElement) => canvas.querySelector('dk-toggle') as DkToggle;

const meta = {
  title: 'Controls/Switch and button',
  component: 'dk-toggle',
  // The accessibility check reports, without failing: a second control inside each (its <button>,
  // which assistive technology can still reach), and on/off letters below 4.5:1 contrast.
  parameters: { a11y: { test: 'todo' } },
  args: {
    value: false,
    momentary: false,
    label: 'Bypass',
    skin: 'switch',
    onInput: fn(),
    onChange: fn(),
  },
  argTypes: {
    skin: {
      control: 'select',
      options: [
        ...new Set(
          SKINS.filter(s => ['toggle', 'button'].includes(s.control) && s.name !== 'image').map(
            s => s.name,
          ),
        ),
      ],
    },
  },
  render: a =>
    html`<dk-toggle
      style="display:block;width:88px;height:88px"
      value=${String(a.value)}
      ?momentary=${a.momentary}
      label=${a.label || nothing}
      skin=${a.skin}
      @input=${a.onInput}
      @change=${a.onChange}
    ></dk-toggle>`,
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const Switch: Story = {};
export const SwitchAsButton: Story = { args: { skin: 'button' } };
export const SwitchAsFootswitch: Story = { args: { skin: 'footswitch' } };
export const Button: Story = { args: { momentary: true, label: 'Push', skin: 'button' } };
export const ButtonAsFootswitch: Story = {
  args: { momentary: true, label: 'Push', skin: 'footswitch' },
};

/** Rule 6: a switch changes each time it is pressed; Space presses it too. */
export const SwitchPressed: Story = {
  play: async ({ canvasElement }) => {
    const toggle = toggleOf(canvasElement);
    const button = partOf(toggle, 'button');
    pointer(button, 'pointerdown', [10, 10]);
    pointer(button, 'pointerup', [10, 10]);
    await expect(toggle.value).toBe(true);
    toggle.focus();
    await userEvent.keyboard(' ');
    await expect(toggle.value).toBe(false);
  },
};

/** Rule 6: a button is on only while it is pressed, by the pointer or by Enter. */
export const ButtonHeld: Story = {
  args: { momentary: true, label: 'Push', skin: 'button' },
  play: async ({ canvasElement }) => {
    const toggle = toggleOf(canvasElement);
    const button = partOf(toggle, 'button');
    pointer(button, 'pointerdown', [10, 10]);
    await expect(toggle.value).toBe(true);
    pointer(button, 'pointerup', [10, 10]);
    await expect(toggle.value).toBe(false);
    // One keyboard for the press and the release: it knows Enter is held.
    const keyboard = userEvent.setup();
    toggle.focus();
    await keyboard.keyboard('{Enter>}');
    await expect(toggle.value).toBe(true);
    await keyboard.keyboard('{/Enter}');
    await expect(toggle.value).toBe(false);
  },
};
