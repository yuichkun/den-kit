# Design system

How den-kit's own screens, the editor in `src/editor`, look and what they say: the themes,
the tokens the themes set, and the rules every editor component follows. A work's plugin
screen is drawn in the work's own look ([architecture.md](architecture.md#terms)) and reads
none of this.

## Themes

den-kit has three looks, each in a light and a dark theme.
[theme.ts](../src/editor/theme.ts) names the themes and keeps the person's choice, and
[tokens.css](../src/editor/tokens.css) holds each theme's values. Tile Light applies until
the person picks another theme in Settings.

- **Tile**: flat fields of color. Modules are filled with their type's color, the docked
  panels are inset cards with round corners, cables curve, and lines rule the canvas.
- **Screen**: an instrument's display. Control labels are lower case, a module is a panel in
  the body color with its title in its type's color, cables turn only at 45° and 90°, and
  the canvas is plain.
- **Plate**: an industrial control panel. Control labels are upper case in the mono font,
  corners are square and controls have cut corners, cables turn at 45° and 90°, and a dot
  marks each point of the snap grid.

Storybook shows the main parts of these screens in each theme
([development.md](development.md#storybook)).

## Tokens

A theme is one block of tokens.css, and every theme sets every token. Components read the
tokens by name:

| Tokens                                                                                                                                   | What they are for                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `app-*`, `line-*`, `text-*`, `ink`, `accent`, `accent-text`, `focus`, `selection*`                                                       | Surfaces, lines and text of the shell, panels, menus and dialogs       |
| `module-*`, `port-*`, `cable`, `param-*`, `title-type`                                                                                   | Modules and cables on the patch                                        |
| `cat-<type>`, `cat-<type>-ink`, `cat-<type>-cable`                                                                                       | A module type's color, the text and lines drawn on it, and its cables  |
| `key-*`, `note-*`, `state-*`, `code-*`                                                                                                   | The keyboard bar, sticky notes, states (ok, warning, danger), code     |
| `font-*`, `case-control`, `tracking-control`, `weight-title`, `heading-prefix`                                                           | Type, and the letter case of den-kit's own words                       |
| `radius-*`, `clip-control`, `button-*`, `field-*`, `dock-*`, `shadow-*`, `module-fill-type`, `module-ring`, `module-edge`, `cable-width` | Corners, lines and depth, and whether a module is filled with its type |

What is drawn in script reads the theme in theme.ts instead: the cables' route (angled or
curved) and what rules the canvas (lines, dots or nothing).

## Rules

- Components take every color and every rounded corner from the tokens, set text in the
  theme's fonts (sticky notes keep their handwriting), and never ask which theme is on.
  Controls and small marks round with `radius-control`, panels, cards, menus and dialogs
  with `radius-panel`, docked panels with `dock-radius`, modules with `radius-module` and
  ports with `port-radius`; a circle (50%) stays a circle in every theme.
- Text is readable in every theme: the text, `accent-text` and state colors have a contrast
  of at least 4.5:1 on den-kit's surfaces (the `app-*` tokens). Text in the accent's color uses `accent-text`, not
  `accent`.
- [look.test.ts](../test/unit/editor/look.test.ts) checks the styles in `src/editor`: no
  hex or functional color and no fixed radius outside the tokens, the same tokens in every
  theme with that contrast, no `none` for a token used in a list of shadows (it would void
  the list), and no theme known outside tokens.css and theme.ts.
- A theme changes how things look, never the layout: modules, ports, rows and the snap grid
  keep their sizes, so a patch is laid out the same in every theme.
- A module's type sets its color ([grid-style.ts](../src/editor/grid-style.ts)). What a
  cable carries is in its line, the same in every theme: audio solid, control dashed, gate
  dotted (the short arrow between neighboring modules is always solid). Ports have no color
  of their own.
- The theme's letter case is for den-kit's own words: labels of controls, tabs and headings.
  Names, of modules and their types, inputs, files, parts and works, and anything people or
  the AI wrote, are shown as written; a control that shows them has the `as-written` class.
- No theme reaches a work's plugin screen. The keyboard bar draws the ready-made keyboard
  with the `key-*` tokens through the keyboard's `--dk-key-*` properties.

To add a theme, add a block to tokens.css that sets every token, and add the theme to
`THEMES` in theme.ts with its route and canvas.

## What the screens say

den-kit's screens are for people making instruments and effects. They show what helps them
do a task, choose an option, recover from an error, or understand what happens to their
data. Who pays for a service and whose account or key it uses, the plumbing between den-kit
and its services, and switches that compare implementations stay off them. A technical
detail that is needed goes in the developer docs or in a section labeled Diagnostics, and
a failure tells the person what they can do, not how to set up a development environment.

The development host is for contributors and also shows the technical details. A host says
which it is for, as the AI's wording (`AIWording.technical`) and the project tools' failures
(BrowserPod's `audience`) do, so den-kit's code never checks which host it runs in
([principle 4](principles.md#4-host-and-os-differences-sit-behind-interfaces)).
