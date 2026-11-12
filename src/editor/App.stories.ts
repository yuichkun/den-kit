// den-kit's whole window (App.vue) in Storybook: the toolbar, the inspector, the patch, the
// keyboard bar and the AI panel around a work, and the overlay den-kit opens behind.
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { h } from 'vue';
import { kitFiles } from '../screen/kit-files.ts';
import type { PodFactory } from '../host/index.ts';
import { PodSession } from '../workspace/pod-session.ts';
import App from './App.vue';
import { editorParameters, mount, patchDrawn, storySession, withAI } from './story-frame.ts';

/** A host without a workspace: the Project view is there, and its tools never start. */
const noWorkspace: PodFactory = {
  kind: null,
  reason: 'Storybook has no project workspace.',
  create: () => Promise.reject(new Error('Storybook has no project workspace.')),
};

/** den-kit's window on the Bass starter, with the sound `running` or not started yet. */
const shell = (running: boolean): StoryObj => ({
  render: () => {
    const session = withAI(storySession());
    session.pod = new PodSession(session, noWorkspace, kitFiles());
    if (running) session.engineState.value = 'running';
    return mount(session, () => h(App, { session }));
  },
});

const meta = {
  title: 'Editor/Shell',
  tags: ['editor', '!autodocs'],
  // The accessibility check reports, without failing: each module's title is a header, so the
  // patch has as many banner landmarks as modules; the work's name has no label; the palette of
  // modules scrolls but takes no keyboard focus; and in the light themes the octave names on the
  // keyboard are below 4.5:1 contrast.
  parameters: { ...editorParameters, a11y: { test: 'todo' } },
  play: async ({ canvasElement }) => {
    await patchDrawn(canvasElement);
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** A work open in the patch view, with the sound running and the AI panel beside it. */
export const Window: Story = shell(true);

/** den-kit opens behind this overlay: the first click or key starts the sound. */
export const Start: Story = shell(false);
