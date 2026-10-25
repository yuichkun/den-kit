// The scope and the meter in Storybook (both are dk-scope; `mode` picks which), each skin, drawing
// a steady sine wave in place of the sound. They only show (rule 9 of src/behaviors/index.ts).
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';
import { SKINS } from '../../work/skins.ts';
import { DkScope } from './display.ts';

interface Args {
  mode: 'scope' | 'meter';
  label: string;
  skin: string;
}

/** What the scope reads from its AnalyserNode: a sine wave that moves on each frame. */
function sine(): DkScope['analyser'] {
  let phase = 0;
  return {
    getFloatTimeDomainData(data: Float32Array) {
      for (let i = 0; i < data.length; i++) data[i] = 0.5 * Math.sin(phase + i / 12);
      phase += 0.25;
    },
  } as unknown as AnalyserNode;
}

const meta = {
  title: 'Controls/Scope and meter',
  component: 'dk-scope',
  args: { mode: 'scope', label: 'Out', skin: 'line' },
  argTypes: {
    mode: { control: 'inline-radio', options: ['scope', 'meter'] },
    skin: {
      control: 'select',
      options: SKINS.filter(s => s.control === 'scope' || s.control === 'meter').map(s => s.name),
    },
  },
  render: a =>
    html`<dk-scope
      style="display:block;width:${a.mode === 'meter' ? 96 : 240}px;height:${
        a.mode === 'meter' ? 180 : 120
      }px"
      mode=${a.mode}
      label=${a.label}
      skin=${a.skin}
      .analyser=${sine()}
    ></dk-scope>`,
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const Scope: Story = {};
export const Phosphor: Story = { args: { skin: 'phosphor' } };
export const MeterBar: Story = { args: { mode: 'meter', skin: 'bar' } };
export const MeterNeedle: Story = { args: { mode: 'meter', skin: 'needle' } };
export const MeterLed: Story = { args: { mode: 'meter', skin: 'led' } };
