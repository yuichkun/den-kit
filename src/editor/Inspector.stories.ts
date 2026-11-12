// The patch's inspector (Inspector.vue) in Storybook, in the shell's sidebar: a selected module
// and its settings, a module with a problem, and a part's use.
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { h } from 'vue';
import { catalog } from '../sound/blocks/index.ts';
import { WORKS } from '../screen/showcase/index.ts';
import { applyIntents } from '../work/ops.ts';
import { starter } from '../work/starters.ts';
import Inspector from './Inspector.vue';
import type { KitSession } from './session.ts';
import { editorParameters, mount, storySession } from './story-frame.ts';

/** The inspector of the session `open` makes, in the sidebar's place in the window. */
const sidebar = (open: () => KitSession): StoryObj => ({
  render: () =>
    mount(
      open(),
      () => h('div', { class: 'sidebar' }, [h(Inspector)]),
      'display:grid;grid-template:100vh / 270px',
    ),
});

const meta = {
  title: 'Editor/Inspector',
  tags: ['editor', '!autodocs'],
  // The accessibility check reports, without failing: a field's label is not tied to the field,
  // the selects of how copies differ have no name, and in Tile Light and Screen Light the copy
  // count that is chosen is below 4.5:1 contrast.
  parameters: { ...editorParameters, a11y: { test: 'todo' } },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** The filter of the Bass starter: what it does, how many copies run, and its inputs. */
export const Module: Story = sidebar(() => {
  const session = storySession(starter('bass', catalog));
  session.select(['filter1']);
  return session;
});

/** A codebox with no code yet: the button that opens its code, and the problem. */
export const Problem: Story = sidebar(() => {
  const { doc, created } = applyIntents(
    starter('bass', catalog),
    [{ op: 'addNode', node: { type: 'kit.codebox', code: '', pos: { x: 348, y: 312 } } }],
    catalog,
  );
  const session = storySession(doc);
  session.select(created);
  return session;
});

/** One use of a part: the part's name and actions, and this use's own values. */
export const PartUse: Story = sidebar(() => {
  const session = storySession(WORKS.find(w => w.id === 'supersaw')!.build(catalog));
  session.select(['saw1']);
  return session;
});
