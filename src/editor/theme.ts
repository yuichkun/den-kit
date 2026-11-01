// The themes of den-kit's own screens (docs/design-system.md) and the one the person chose.
// Each theme is a set of token values in tokens.css; this file names them, holds what is
// drawn in script, and keeps the choice. The choice is an editor preference kept in the
// browser, like the AI panel's width: it is not part of a work.
import { ref } from 'vue';

/** How cables run between ports in a theme: turning only at 45° and 90°, or as curves. */
export type CableRoute = 'angled' | 'curved';
/** What the patch's canvas is ruled with: lines, dots on the 12 px snap grid, or nothing. */
export type CanvasRule = 'lines' | 'dots' | 'plain';

export interface Theme {
  id: string;
  name: string;
  route: CableRoute;
  canvas: CanvasRule;
}

export const THEMES: readonly Theme[] = [
  { id: 'tile-light', name: 'Tile Light', route: 'curved', canvas: 'lines' },
  { id: 'tile-dark', name: 'Tile Dark', route: 'curved', canvas: 'lines' },
  { id: 'screen-light', name: 'Screen Light', route: 'angled', canvas: 'plain' },
  { id: 'screen-dark', name: 'Screen Dark', route: 'angled', canvas: 'plain' },
  { id: 'plate-light', name: 'Plate Light', route: 'angled', canvas: 'dots' },
  { id: 'plate-dark', name: 'Plate Dark', route: 'angled', canvas: 'dots' },
];

export const DEFAULT_THEME = 'tile-light';
const KEY = 'den-kit:theme';

const known = (id: unknown): id is string =>
  typeof id === 'string' && THEMES.some(t => t.id === id);

/** The chosen theme, or the default when none was chosen or the choice is gone. */
export function savedTheme(
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
): string {
  try {
    const id = storage?.getItem(KEY);
    return known(id) ? id : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** The theme in use; components that draw in script (cable routes) follow it. */
export const theme = ref<Theme>(THEMES.find(t => t.id === DEFAULT_THEME)!);

/** Use a theme on the page; `keep` stores it as the person's choice. */
export function useTheme(
  id: string,
  {
    keep = false,
    root = globalThis.document?.documentElement,
    storage = globalThis.localStorage,
  }: {
    keep?: boolean;
    root?: Pick<HTMLElement, 'dataset'>;
    storage?: Pick<Storage, 'setItem'>;
  } = {},
) {
  const next = THEMES.find(t => t.id === id) ?? THEMES.find(t => t.id === DEFAULT_THEME)!;
  theme.value = next;
  if (root) root.dataset.theme = next.id;
  if (!keep) return;
  try {
    storage?.setItem(KEY, next.id);
  } catch {
    // Storage refused (a private window): the theme still applies until den-kit closes.
  }
}
