// Every story shows its control on a plugin screen in the base theme picked in the toolbar
// (Theme), with den-kit's built-in fonts. A story that breaks the accessibility check fails
// as a test. Chromatic takes a snapshot of every story in each base theme.
import type { Preview } from '@storybook/web-components-vite';
import { html } from 'lit';
import { lookVars } from '../src/screen/build.ts';
import '../src/screen/fonts.ts';
import { defineWidgets } from '../src/screen/widgets/widgets.ts';
import { THEMES, emptyDocument, type ThemeId } from '../src/work/schema.ts';

defineWidgets();

/** The CSS custom properties a plugin screen in `theme` gives its controls. */
function screenStyle(theme: ThemeId): string {
  const doc = emptyDocument('storybook');
  doc.panel.theme = theme;
  return Object.entries(lookVars(doc))
    .map(([name, value]) => `${name}:${value}`)
    .join(';');
}

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "The plugin's base theme (a work's look puts its own tokens over it)",
      toolbar: { title: 'Theme', icon: 'paintbrush', items: [...THEMES], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: 'graphite' },
  decorators: [
    // A story alone fills the canvas with the screen; on a docs page it takes the room it needs.
    (story, { globals, viewMode }) =>
      html`<div
        style="${screenStyle(globals.theme as ThemeId)};background:var(--dk-bg);padding:24px;display:grid;place-items:center;${
          viewMode === 'docs' ? '' : 'box-sizing:border-box;min-height:100vh'
        }"
      >
        ${story()}
      </div>`,
  ],
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    chromatic: { modes: Object.fromEntries(THEMES.map(theme => [theme, { theme }])) },
  },
  tags: ['autodocs'],
};

export default preview;
