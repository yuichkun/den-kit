// The patch (PatchView.vue) in Storybook: modules in their types' colors, cables in the line of
// what they carry along the theme's route, the theme's canvas, and the palette of modules
// beside it (docs/design-system.md).
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { h } from 'vue';
import { catalog } from '../sound/blocks/index.ts';
import { WORKS } from '../screen/showcase/index.ts';
import { applyIntents } from '../work/ops.ts';
import { starter } from '../work/starters.ts';
import PatchView from './PatchView.vue';
import type { KitSession } from './session.ts';
import { editorParameters, mount, patchDrawn, storySession } from './story-frame.ts';

const bass = () => starter('bass', catalog);
const supersaw = () => WORKS.find(w => w.id === 'supersaw')!.build(catalog);
/** The patch view of the session `open` makes. */
const patch = (open: () => KitSession): StoryObj => ({
  render: () => mount(open(), () => h(PatchView)),
});

const meta = {
  title: 'Editor/Patch',
  tags: ['editor', '!autodocs'],
  // The accessibility check reports, without failing: each module's title is a header, so the
  // patch has as many banner landmarks as modules.
  parameters: { ...editorParameters, a11y: { test: 'todo' } },
  play: async ({ canvasElement }) => {
    await patchDrawn(canvasElement);
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** The Bass starter as it opens: a voice, an oscillator, envelopes, a filter and the output. */
export const Bass: Story = patch(() => storySession(bass()));

/** The filter and the cable into it, selected. */
export const Selected: Story = patch(() => {
  const session = storySession(bass());
  session.select(['filter1']);
  session.selectEdges(['e5']);
  return session;
});

/**
 * What is wrong in a patch, on the modules: a Voice Mix with nothing coming in, a codebox with no
 * code yet, and a block den-kit does not have.
 */
export const Problems: Story = patch(() => {
  const doc = applyIntents(
    bass(),
    [
      { op: 'disconnect', id: 'e10' },
      { op: 'addNode', node: { type: 'kit.codebox', code: '', pos: { x: 348, y: 312 } } },
    ],
    catalog,
  ).doc;
  doc.nodes.gone1 = {
    id: 'gone1',
    type: 'den.retired',
    pos: { x: 732, y: 312 },
    config: {},
    values: {},
  };
  return storySession(doc);
});

/** A part used as seven copies side by side: its thick cables carry one signal per copy. */
export const PartsAndCopies: Story = patch(() => storySession(supersaw()));

/** Inside that part: the way back to the main patch, and hearing the part alone. */
export const InsideAPart: Story = patch(() => {
  const session = storySession(supersaw());
  session.enterPart('saw1');
  return session;
});
