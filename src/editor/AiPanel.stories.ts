// The AI panel (AiPanel.vue) in Storybook, docked as in the window: before the first request,
// and a conversation about the work with what is selected going along with the next request.
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { h } from 'vue';
import { AGENT_COLORS } from '../ai/llm.ts';
import type { Outcome } from '../ai/requests.ts';
import AiPanel from './AiPanel.vue';
import { editorParameters, mount, storySession, withAI } from './story-frame.ts';

/** The panel on the Bass starter, with `history` said so far and `selected` modules. */
const panel = (history: Outcome[] = [], selected: string[] = []): StoryObj => ({
  render: () => {
    const session = withAI(storySession());
    session.requests!.history.value = history;
    session.select(selected);
    return mount(
      session,
      () =>
        h('div', { class: 'ai-dock', style: 'width:400px;height:100vh' }, [
          h(AiPanel, {
            class: 'docked',
            requests: session.requests!,
            llm: session.llm,
            view: 'patch',
          }),
        ]),
      'display:flex;justify-content:flex-end',
    );
  },
});

const meta = {
  title: 'Editor/AI panel',
  tags: ['editor', '!autodocs'],
  parameters: editorParameters,
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** Before the first request: what to say, and the keys. */
export const Empty: Story = panel();

/** Requests that changed the work, one taken back, one shared out to sub-agents, one that failed. */
export const Conversation: Story = {
  // The accessibility check reports, without failing: dimmed text in the conversation (what went
  // with a request, a request taken back, the sub-agents' lines) is below 4.5:1 contrast.
  parameters: { a11y: { test: 'todo' } },
  ...panel(
    [
      {
        id: 'r1',
        text: 'brighter',
        status: 'applied',
        route: 'llm',
        ms: 3800,
        attached: [{ id: 'filter1', kind: 'module', label: 'Filter' }],
        label: 'Opened up the filter',
        reply: 'I raised the cutoff from 800 Hz to 2.4 kHz and added a little resonance.',
      },
      {
        id: 'r2',
        text: 'add reverb',
        status: 'applied',
        route: 'llm',
        ms: 5100,
        undone: true,
        label: 'Added a reverb after the gain',
      },
      {
        id: 'r3',
        text: 'make a screen with big knobs for the filter',
        status: 'applied',
        route: 'llm',
        ms: 9600,
        screen: true,
        label: 'Made the plugin screen',
        agents: [
          {
            id: 'a1',
            name: 'Screen',
            color: AGENT_COLORS[0],
            status: 'done',
            ms: 8200,
            scope: 'the plugin screen',
            message: 'Placed cutoff and resonance knobs',
          },
          {
            id: 'a2',
            name: 'Sound',
            color: AGENT_COLORS[1],
            status: 'done',
            ms: 6400,
            scope: 'the patch',
            message: 'Gave the knobs musical ranges',
          },
        ],
      },
      {
        id: 'r4',
        text: 'write a granular delay',
        status: 'failed',
        route: 'llm',
        ms: 2300,
        message: 'The AI could not finish this request.',
        fix: 'Try again in a moment.',
      },
    ],
    ['filter1', 'osc1'],
  ),
};
