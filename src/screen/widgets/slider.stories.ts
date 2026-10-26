// The slider in Storybook: each skin (the image skin needs a picture), lying and standing, and
// den-kit's slider behavior tried on the real control. The rules are in src/behaviors/index.ts;
// test/unit/behaviors checks each in detail.
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';
import { expect, fn, userEvent } from 'storybook/test';
import { SKINS } from '../../work/skins.ts';
import { DkSlider } from './slider.ts';
import { drag, partOf, pointer } from './story-gestures.ts';

interface Args {
  value: number;
  min: number;
  max: number;
  default: number;
  label: string;
  unit: string;
  skin: string;
  width: number;
  height: number;
  onInput: (e: Event) => void;
  onChange: (e: Event) => void;
}

const sliderOf = (canvas: HTMLElement) => canvas.querySelector('dk-slider') as DkSlider;

const meta = {
  title: 'Controls/Slider',
  component: 'dk-slider',
  args: {
    value: 0.5,
    min: 0,
    max: 1,
    default: 0.5,
    label: 'Mix',
    unit: '',
    skin: 'bar',
    width: 200,
    height: 56,
    onInput: fn(),
    onChange: fn(),
  },
  argTypes: {
    skin: {
      control: 'select',
      options: SKINS.filter(s => s.control === 'slider' && s.name !== 'image').map(s => s.name),
    },
  },
  render: a =>
    html`<dk-slider
      style="display:block;width:${a.width}px;height:${a.height}px"
      value=${a.value}
      min=${a.min}
      max=${a.max}
      default=${a.default}
      label=${a.label}
      unit=${a.unit}
      skin=${a.skin}
      @input=${a.onInput}
      @change=${a.onChange}
    ></dk-slider>`,
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const Bar: Story = {};
export const Fader: Story = { args: { skin: 'fader' } };
/** Taller than it is wide (by more than 1.4 times), a slider stands. */
export const Standing: Story = { args: { skin: 'fader', width: 64, height: 180 } };

/** Rule 5: clicking the track never makes the value jump. */
export const ClickStays: Story = {
  play: async ({ canvasElement }) => {
    const slider = sliderOf(canvasElement);
    const track = partOf(slider, '.track');
    pointer(track, 'pointerdown', [4, 10]);
    pointer(track, 'pointerup', [4, 10]);
    await expect(slider.value).toBe(0.5);
  },
};

/** Rule 5: the slider moves from where it is grabbed, with the pointer. */
export const Drag: Story = {
  play: async ({ canvasElement, args }) => {
    const slider = sliderOf(canvasElement);
    const track = partOf(slider, '.track');
    const middle = track.getBoundingClientRect().width / 2;
    drag(track, [middle - 60, 10], [middle - 20, 10]);
    await expect(slider.value).toBeGreaterThan(0.5);
    await expect(slider.value).toBeLessThan(1);
    await expect(args.onChange).toHaveBeenCalledTimes(1);
  },
};

/** Rule 4: the arrow keys move 1% of the range, Page Up and Page Down 10%. */
export const Keys: Story = {
  play: async ({ canvasElement }) => {
    const slider = sliderOf(canvasElement);
    slider.focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(slider.value).toBeCloseTo(0.51);
    await userEvent.keyboard('{PageDown}');
    await expect(slider.value).toBeCloseTo(0.41);
  },
};

/** Rule 2: a double-click returns the slider to its default value. */
export const DoubleClick: Story = {
  args: { value: 0.2, default: 0.75 },
  play: async ({ canvasElement }) => {
    const slider = sliderOf(canvasElement);
    await userEvent.dblClick(partOf(slider, '.track'));
    await expect(slider.value).toBe(0.75);
  },
};
