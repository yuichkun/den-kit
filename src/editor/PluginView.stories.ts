// The plugin view (PluginView.vue) in Storybook: den-kit's bar and stage around a work's plugin
// screen, which keeps the work's own look in every theme, and in Edit the plugin's inspector
// (plugin/PluginInspector.vue) beside it, as in the window.
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { h } from 'vue';
import { catalog } from '../sound/blocks/index.ts';
import { WORKS } from '../screen/showcase/index.ts';
import PluginInspector from './plugin/PluginInspector.vue';
import PluginView from './PluginView.vue';
import { editorParameters, mount, storySession } from './story-frame.ts';

const acid = () => WORKS.find(w => w.id === 'acid')!.build(catalog);

const meta = {
  title: 'Editor/Plugin',
  tags: ['editor', '!autodocs'],
  // The accessibility check reports, without failing: the base theme's select is named only by
  // its title, the switch on the work's screen holds a control inside it, and the inspector's
  // labels are not tied to their fields.
  parameters: { ...editorParameters, a11y: { test: 'todo' } },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** Playing the Acid Line work: its plugin screen scaled to the view. */
export const Play: Story = {
  render: () =>
    mount(storySession(acid()), () =>
      h('div', { class: 'main wide', style: 'height:100vh' }, [
        h('div', { class: 'workspace' }, [h(PluginView, { edit: false })]),
      ]),
    ),
};

/** Editing it with the cutoff knob selected: its handles, and its settings in the inspector. */
export const Edit: Story = {
  render: () => {
    const session = storySession(acid());
    session.select(['kcut']);
    return mount(session, () =>
      h('div', { class: 'main', style: 'height:100vh' }, [
        h('div', { class: 'sidebar' }, [h(PluginInspector)]),
        h('div', { class: 'workspace' }, [h(PluginView, { edit: true })]),
      ]),
    );
  },
};
