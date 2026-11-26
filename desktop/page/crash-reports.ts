// Crash reports in den-kit's page (desktop/crash-reports.ts): once the person allows
// them, Sentry's renderer SDK takes the page's errors nobody caught and hands them to
// the main process through den-kit's preload; the main process scrubs them and sends
// them only while the person allows crash reports. Nothing of Sentry loads before.
import { DATA_COLLECTION } from '../crash-reports.ts';

/** The page's integrations that are kept: errors nobody caught, with their causes. */
export const PAGE_INTEGRATIONS: ReadonlySet<string> = new Set([
  'EventFilters',
  'FunctionToString',
  'BrowserApiErrors',
  'GlobalHandlers',
  'LinkedErrors',
  'Dedupe',
]);

let started: Promise<void> | null = null;

/** Starts Sentry in the page, once; it stays until the page closes, and turning crash reports off stops the sending in the main process. */
export function startCrashReports(): Promise<void> {
  // Crash reports never stop den-kit: Sentry that cannot start takes nothing.
  started ??= import('@sentry/electron/renderer')
    .then(sentry =>
      sentry.init({
        integrations: defaults => defaults.filter(i => PAGE_INTEGRATIONS.has(i.name)),
        dataCollection: DATA_COLLECTION,
        beforeBreadcrumb: () => null,
      }),
    )
    .catch(() => undefined);
  return started;
}
