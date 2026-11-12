// The keyboard bar (KeyboardBar.vue) in Storybook, at the bottom of the window: the plugin's
// keyboard control drawn in the theme's key colors, with a chord held.
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { h } from 'vue';
import KeyboardBar from './KeyboardBar.vue';
import { editorParameters, mount, storySession } from './story-frame.ts';

const meta = {
  title: 'Editor/Keyboard bar',
  tags: ['editor', '!autodocs'],
  // The accessibility check reports, without failing: the octave names on the keys (the plugin's
  // keyboard control) are below 4.5:1 contrast.
  parameters: { ...editorParameters, a11y: { test: 'todo' } },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** C minor held: white and black keys down among the others. */
export const Chord: Story = {
  render: () => {
    const session = storySession();
    for (const note of [48, 51, 55]) session.noteOn(note);
    return mount(
      session,
      () => h('div', { class: 'bottom' }, [h(KeyboardBar)]),
      'display:flex;flex-direction:column;justify-content:flex-end;height:100vh',
    );
  },
};
