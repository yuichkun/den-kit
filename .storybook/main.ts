// Storybook: the plugin's ready-made controls (src/screen/widgets), each skin in each base
// theme, tried by hand and as tests (docs/development.md says how). It builds with its own
// Vite config (vite.config.ts beside this file): den-kit's own serves the editor and the pod.
import type { StorybookConfig } from '@storybook/web-components-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.ts'],
  framework: {
    name: '@storybook/web-components-vite',
    options: { builder: { viteConfigPath: '.storybook/vite.config.ts' } },
  },
  addons: [
    '@storybook/addon-docs',
    '@storybook/addon-a11y',
    '@storybook/addon-vitest',
    '@storybook/addon-mcp',
  ],
  // Storybook would otherwise send usage data from each contributor's machine.
  core: { disableTelemetry: true },
};

export default config;
