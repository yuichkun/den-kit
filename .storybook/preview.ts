// A control's story shows it on a plugin screen in the base theme picked in the toolbar (Theme),
// with den-kit's built-in fonts. A story of den-kit's own screens (tagged editor) shows them in
// the den-kit theme picked there (docs/development.md, Storybook).
import type { Preview } from '@storybook/web-components-vite';
import { html } from 'lit';
import { DEFAULT_THEME, THEMES as EDITOR_THEMES, useTheme } from '../src/editor/theme.ts';
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
    editorTheme: {
      description: "The theme of den-kit's own screens",
      toolbar: {
        title: 'den-kit theme',
        icon: 'contrast',
        items: EDITOR_THEMES.map(theme => ({ value: theme.id, title: theme.name })),
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'graphite', editorTheme: DEFAULT_THEME },
  decorators: [
    // den-kit's own screens fill the canvas themselves. A control's screen fills the canvas when
    // the story is alone, and takes the room it needs on a docs page.
    (story, { globals, viewMode, tags }) => {
      if (tags.includes('editor')) {
        useTheme(globals.editorTheme as string);
        return story();
      }
      return html`<div
        style="${screenStyle(globals.theme as ThemeId)};background:var(--dk-bg);padding:24px;display:grid;place-items:center;${
          viewMode === 'docs' ? '' : 'box-sizing:border-box;min-height:100vh'
        }"
      >
        ${story()}
      </div>`;
    },
  ],
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    chromatic: { modes: Object.fromEntries(THEMES.map(theme => [theme, { theme }])) },
  },
  tags: ['autodocs'],
};

export default preview;
