// The theme of den-kit's own screens: the person's choice is kept in the browser, set on the
// page's root, and falls back to Tile Light when there is none or it is gone.
import { describe, expect, it } from 'vite-plus/test';
import { DEFAULT_THEME, THEMES, savedTheme, theme, useTheme } from '../../../src/editor/theme.ts';

function storage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}
const refusing = {
  getItem: (): string | null => {
    throw new Error('refused');
  },
  setItem: () => {
    throw new Error('refused');
  },
};
const root = () => ({ dataset: {} as Record<string, string> }) as unknown as HTMLElement;

describe("the theme of den-kit's screens", () => {
  it('starts in Tile Light', () => {
    expect(DEFAULT_THEME).toBe('tile-light');
    expect(savedTheme(storage())).toBe('tile-light');
  });

  it('opens in the theme the person chose', () => {
    expect(savedTheme(storage({ 'den-kit:theme': 'plate-dark' }))).toBe('plate-dark');
  });

  it('falls back to the default when the choice is unknown or cannot be read', () => {
    expect(savedTheme(storage({ 'den-kit:theme': 'graphite' }))).toBe(DEFAULT_THEME);
    expect(savedTheme(refusing)).toBe(DEFAULT_THEME);
  });

  it('sets the theme on the page and keeps it only when asked', () => {
    const page = root(),
      kept = storage();
    useTheme('screen-dark', { root: page, storage: kept });
    expect(page.dataset.theme).toBe('screen-dark');
    expect(theme.value.id).toBe('screen-dark');
    expect(kept.data.size).toBe(0);
    useTheme('screen-light', { keep: true, root: page, storage: kept });
    expect(kept.data.get('den-kit:theme')).toBe('screen-light');
    expect(savedTheme(kept)).toBe('screen-light');
  });

  it('uses the default for an unknown theme, and still applies when storage refuses', () => {
    const page = root();
    useTheme('neon', { keep: true, root: page, storage: refusing });
    expect(page.dataset.theme).toBe(DEFAULT_THEME);
    expect(theme.value.id).toBe(DEFAULT_THEME);
  });

  it('names six themes, a light and a dark of each look', () => {
    expect(THEMES.map(t => t.id)).toEqual([
      'tile-light',
      'tile-dark',
      'screen-light',
      'screen-dark',
      'plate-light',
      'plate-dark',
    ]);
  });
});
