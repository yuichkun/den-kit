import type { Page } from 'playwright';
import type { DesktopInfo } from '../desktop/page/api.ts';

/**
 * Waits until the desktop shell reports a matching state. Playwright's waitForFunction does not await an async
 * predicate (the pending promise counts as true), so the asynchronous info() call is polled from Node instead.
 */
export async function waitForShell(
  page: Page,
  matches: (info: DesktopInfo) => boolean,
  { timeout = 60000, interval = 500 } = {},
): Promise<DesktopInfo> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const info = await page.evaluate(() => window.denKitShell!.info());
    if (matches(info)) return info;
    if (Date.now() >= deadline) {
      const last = {
        codex: info.codex.state,
        login: info.login,
        aiBusy: info.aiBusy,
        update: info.update,
      };
      throw new Error(
        `den-kit did not reach the expected state within ${timeout} ms. Last state: ${JSON.stringify(last)}`,
      );
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}
