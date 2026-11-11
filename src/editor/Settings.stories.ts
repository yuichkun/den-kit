// Settings (Settings.vue) in Storybook: the theme in every host, and the ChatGPT account, AI
// settings and updates in a host that lets the person manage them in den-kit.
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { h } from 'vue';
import { expect, waitFor } from 'storybook/test';
import type { AIAccount, AIAccountInfo } from '../host/ai.ts';
import type { Lifecycle } from '../host/index.ts';
import Settings from './Settings.vue';
import { editorParameters, mount, storySession } from './story-frame.ts';
import { theme, useTheme } from './theme.ts';

/** Signed in with ChatGPT Plus, with two models to choose from. */
const info: AIAccountInfo = {
  settings: { model: '', effort: '' },
  models: [
    { id: 'large', name: 'Large', isDefault: true, efforts: ['low', 'medium', 'high'] },
    { id: 'small', name: 'Small', isDefault: false, efforts: ['low', 'medium'] },
  ],
  codex: { state: 'ok', plan: 'Plus' },
  aiBusy: false,
  signedIn: true,
  login: 'idle',
};
const account: AIAccount = {
  info: async () => info,
  saveSettings: async () => info,
  signIn: async () => {},
  cancelSignIn: async () => {},
  signOut: async () => {},
  reconnect: async () => info,
  openUsage: async () => {},
};
/** An update downloaded and ready to install. */
const lifecycle: Lifecycle = {
  info: async () => ({ version: '0.2.0', update: { state: 'ready', version: '0.2.1' } }),
  checkForUpdates: async () => ({ version: '0.2.0', update: { state: 'ready', version: '0.2.1' } }),
  installUpdate: async () => {},
  onUpdate: () => () => {},
  onShowSettings: () => () => {},
  beforeQuit: () => () => {},
};

/** The Settings dialog with what the host provides. */
const dialog = (host: { account: AIAccount | null; lifecycle: Lifecycle | null }): StoryObj => ({
  render: () => {
    // Settings shows the person's choice: the theme picked in the toolbar is kept as it.
    useTheme(theme.value.id, { keep: true });
    return mount(storySession(), () => h(Settings, host));
  },
});

const meta = {
  title: 'Editor/Settings',
  tags: ['editor', '!autodocs'],
  parameters: editorParameters,
  // The dialog takes the focus once it has what the host says.
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(document.activeElement).toBe(canvasElement.querySelector('[role=dialog]')),
    );
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** A host where the person signs in outside den-kit, such as the development host: the theme. */
export const Theme: Story = dialog({ account: null, lifecycle: null });

/** The desktop app: the theme, the ChatGPT account and AI settings, and an update to install. */
export const Account: Story = dialog({ account, lifecycle });
