// The knob in Storybook: each skin (the image skin needs a picture), and den-kit's knob behavior
// tried on the real control. The rules are in src/behaviors/index.ts; test/unit/behaviors checks
// each in detail.
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';
import { expect, fn, userEvent } from 'storybook/test';
import { SKINS } from '../../work/skins.ts';
import { DkKnob } from './knob.ts';
import { drag, partOf } from './story-gestures.ts';

interface Args {
  value: number;
  min: number;
  max: number;
  default: number;
  label: string;
  unit: string;
  skin: string;
  onInput: (e: Event) => void;
  onChange: (e: Event) => void;
}

const knobOf = (canvas: HTMLElement) => canvas.querySelector('dk-knob') as DkKnob;

const meta = {
  title: 'Controls/Knob',
  component: 'dk-knob',
  args: {
    value: 0.5,
    min: 0,
    max: 1,
    default: 0.5,
    label: 'Cutoff',
    unit: '',
    skin: 'classic',
    onInput: fn(),
    onChange: fn(),
  },
  argTypes: {
    skin: {
      control: 'select',
      options: SKINS.filter(s => s.control === 'knob' && s.name !== 'image').map(s => s.name),
    },
  },
  render: a =>
    html`<dk-knob
      style="display:block;width:88px;height:108px"
      value=${a.value}
      min=${a.min}
      max=${a.max}
      default=${a.default}
      label=${a.label}
      unit=${a.unit}
      skin=${a.skin}
      @input=${a.onInput}
      @change=${a.onChange}
    ></dk-knob>`,
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const Classic: Story = {};
export const Ring: Story = { args: { skin: 'ring' } };
export const Cap: Story = { args: { skin: 'cap' } };
export const Dot: Story = { args: { skin: 'dot' } };

/** Rule 1: 200 px of dragging up is the whole range, wherever the knob is grabbed. */
export const Drag: Story = {
  args: { value: 0 },
  play: async ({ canvasElement, args }) => {
    const knob = knobOf(canvasElement);
    // 100 px up from near the bottom edge: half the range.
    drag(partOf(knob, '.dial'), [10, 50], [10, -50]);
    await expect(knob.value).toBeCloseTo(0.5);
    await expect(args.onChange).toHaveBeenCalledTimes(1);
  },
};

/** Rule 4: the arrow keys move 1% of the range, Shift 10%; Home and End go to the ends. */
export const Keys: Story = {
  play: async ({ canvasElement }) => {
    const knob = knobOf(canvasElement);
    knob.focus();
    await userEvent.keyboard('{ArrowUp}');
    await expect(knob.value).toBeCloseTo(0.51);
    await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}');
    await expect(knob.value).toBeCloseTo(0.41);
    await userEvent.keyboard('{End}');
    await expect(knob.value).toBe(1);
    await userEvent.keyboard('{Home}');
    await expect(knob.value).toBe(0);
  },
};

/** Rule 2: a double-click returns the knob to its default value. */
export const DoubleClick: Story = {
  args: { value: 0.9, default: 0.25 },
  play: async ({ canvasElement }) => {
    const knob = knobOf(canvasElement);
    await userEvent.dblClick(partOf(knob, '.dial'));
    await expect(knob.value).toBe(0.25);
  },
};
