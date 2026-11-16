// The page of test/desktop/crash-app.ts: it starts crash reports as den-kit's page
// does, at start when the person allowed them (desktop/page/main.ts) and when they
// allow them in Settings (desktop/page/analytics.ts, here window.startCrashReports).
import { startCrashReports } from '../../desktop/page/crash-reports.ts';
import type {} from '../../desktop/page/api.ts';

if (window.denKitShell?.runtime.analytics?.crashReports) void startCrashReports();
Object.assign(window, {
  startCrashReports,
  /** An error nobody catches, thrown from the page's own code. */
  throwInPage: (message: string) =>
    setTimeout(() => {
      throw new Error(message);
    }),
});
