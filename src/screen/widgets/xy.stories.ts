// The XY pad in Storybook: each skin, and den-kit's XY behavior tried on the real control. The
// rules are in src/behaviors/index.ts; test/unit/behaviors checks each in detail.
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';
import { expect, fn, userEvent } from 'storybook/test';
import { SKINS } from '../../work/skins.ts';
import { partOf, pointer } from './story-gestures.ts';
import { DkXy } from './xy.ts';

interface Args {
  x: number;
  y: number;
  label: string;
  skin: string;
  onInput: (e: Event) => void;
  onChange: (e: Event) => void;
}

const padOf = (canvas: HTMLElement) => canvas.querySelector('dk-xy') as DkXy;
const at = (pad: DkXy) => ({
  x: Number(pad.getAttribute('x')),
  y: Number(pad.getAttribute('y')),
});

const meta = {
  title: 'Controls/XY pad',
  component: 'dk-xy',
  args: { x: 0.5, y: 0.5, label: 'Space', skin: 'pad', onInput: fn(), onChange: fn() },
  argTypes: {
    skin: { control: 'select', options: SKINS.filter(s => s.control === 'xy').map(s => s.name) },
  },
  render: a =>
    html`<dk-xy
      style="display:block;width:180px;height:200px"
      x=${a.x}
      y=${a.y}
      label=${a.label}
      skin=${a.skin}
      @input=${a.onInput}
      @change=${a.onChange}
    ></dk-xy>`,
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const Pad: Story = {};
export const Glow: Story = { args: { skin: 'glow' } };

/** Rule 7: the pad jumps to where it is clicked (y grows upward). */
export const ClickJumps: Story = {
  play: async ({ canvasElement, args }) => {
    const pad = padOf(canvasElement);
    const area = partOf(pad, '.pad');
    const box = area.getBoundingClientRect();
    pointer(area, 'pointerdown', [box.width * 0.75, box.height * 0.25]);
    pointer(area, 'pointerup', [box.width * 0.75, box.height * 0.25]);
    await expect(at(pad).x).toBeCloseTo(0.75, 1);
    await expect(at(pad).y).toBeCloseTo(0.75, 1);
    await expect(args.onChange).toHaveBeenCalledTimes(1);
  },
};

/** Rule 7: the arrow keys move x (left, right) and y (up, down). */
export const Arrows: Story = {
  play: async ({ canvasElement }) => {
    const pad = padOf(canvasElement);
    pad.focus();
    await userEvent.keyboard('{ArrowRight}{ArrowUp}{ArrowUp}');
    await expect(at(pad).x).toBeCloseTo(0.51);
    await expect(at(pad).y).toBeCloseTo(0.52);
  },
};
