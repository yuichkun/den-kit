// The windows of Help → Licenses: licenses.html from the app's resources
// (scripts/licenses.ts makes it), and Electron's notices for Chromium that it links
// to, each in a window of its own. They show den-kit's own files without JavaScript;
// a link to a website opens in the person's browser, and a window never leaves its
// page.
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import { fileURLToPath } from 'node:url';

/** What the windows need from Electron. */
export interface NoticesHost {
  /** A new window (Electron's BrowserWindow). */
  window(options: BrowserWindowConstructorOptions): BrowserWindow;
  /** Opens a website in the person's browser (shell.openExternal). */
  openExternal(url: string): void;
}

export const NOTICES_WINDOW: BrowserWindowConstructorOptions = {
  width: 760,
  height: 860,
  show: false,
  webPreferences: {
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    javascript: false,
    spellcheck: false,
  },
};

/** Where a link in a notices window leads: one of `pages`, a website, or nowhere. */
export function linkTarget(
  url: string,
  pages: readonly string[],
): { page: string } | { website: string } | null {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.protocol === 'https:' || target.protocol === 'http:') return { website: target.href };
  if (target.protocol !== 'file:') return null;
  const path = fileURLToPath(target);
  return pages.includes(path) ? { page: path } : null;
}

/** The notices windows, one for each of `pages` at most. */
export class NoticesWindows {
  private readonly open = new Map<string, BrowserWindow>();
  private readonly host: NoticesHost;
  private readonly pages: readonly string[];

  constructor(host: NoticesHost, pages: readonly string[]) {
    this.host = host;
    this.pages = pages;
  }

  /** Shows `page` in its window: the one already open, or a new one. */
  show(page: string): BrowserWindow {
    const shown = this.open.get(page);
    if (shown && !shown.isDestroyed()) {
      if (shown.isMinimized()) shown.restore();
      shown.show();
      shown.focus();
      return shown;
    }
    const window = this.host.window(NOTICES_WINDOW);
    this.open.set(page, window);
    window.on('closed', () => this.open.delete(page));
    const follow = (url: string) => {
      const target = linkTarget(url, this.pages);
      if (target && 'page' in target) this.show(target.page);
      else if (target) this.host.openExternal(target.website);
    };
    // A link within the page (#…) moves the page without navigating.
    window.webContents.on('will-navigate', (event, url) => {
      event.preventDefault();
      follow(url);
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      follow(url);
      return { action: 'deny' };
    });
    window.once('ready-to-show', () => window.show());
    void window.loadFile(page);
    return window;
  }
}
