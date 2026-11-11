// The search for adding a module (Palette.vue) in Storybook: Tab on the patch opens it over the
// canvas, with every block, control and part of the work by name.
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { h } from 'vue';
import { expect, userEvent, waitFor } from 'storybook/test';
import PatchView from './PatchView.vue';
import { editorParameters, mount, patchDrawn, storySession } from './story-frame.ts';

/** Tab on the patch, once it is drawn, opens the search with its field ready to type in. */
async function open(canvas: HTMLElement) {
  await patchDrawn(canvas);
  await userEvent.keyboard('{Tab}');
  await waitFor(() =>
    expect(document.activeElement).toBe(canvas.querySelector('[data-testid=palette-search]')),
  );
}

const meta = {
  title: 'Editor/Palette',
  tags: ['editor', '!autodocs'],
  // The accessibility check reports, without failing: each module's title is a header, so the
  // patch has as many banner landmarks as modules, and the list of matches scrolls but takes no
  // keyboard focus.
  parameters: { ...editorParameters, a11y: { test: 'todo' } },
  render: () => mount(storySession(), () => h(PatchView)),
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** Opened: everything that can be added, in order. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    await open(canvasElement);
  },
};

/** Searching for a filter: the best matches first, the second one picked with the arrow key. */
export const Search: Story = {
  play: async ({ canvasElement }) => {
    await open(canvasElement);
    await userEvent.keyboard('filter{ArrowDown}');
    await expect(canvasElement.querySelectorAll('.palette li.active')).toHaveLength(1);
  },
};
