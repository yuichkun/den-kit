// The question about the data den-kit may send (DataConsent.vue) in Storybook: the first launch
// of a build that sends usage data and crash reports, with nothing checked.
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { h } from 'vue';
import { expect, waitFor } from 'storybook/test';
import type { Analytics } from '../host/index.ts';
import DataConsent from './DataConsent.vue';
import { editorParameters, mount, storySession } from './story-frame.ts';

const analytics: Analytics = {
  kinds: ['usage', 'crashes'],
  contact: 'privacy@example.com',
  choice: async () => ({}),
  choose: async () => {},
  installId: async () => null,
  record: () => {},
};

const meta = {
  title: 'Editor/DataConsent',
  tags: ['editor', '!autodocs'],
  parameters: editorParameters,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(document.activeElement).toBe(canvasElement.querySelector('[role=dialog]')),
    );
    const boxes = canvasElement.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    await expect([...boxes].map(box => box.checked)).toEqual([false, false]);
  },
} satisfies Meta;

export default meta;

/** The first launch: each kind unchecked until the person checks it. */
export const FirstLaunch: StoryObj = {
  render: () => mount(storySession(), () => h(DataConsent, { analytics, kinds: analytics.kinds })),
};
