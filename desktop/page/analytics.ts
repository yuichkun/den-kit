// The desktop app's Analytics (src/host/analytics.ts) in its page: the main process
// keeps the answers, the install's ID and the events (desktop/analytics.ts), and
// this asks it over the preload bridge. Null when the build sends nothing.
import type { Analytics, DataChoice } from '../../src/host/index.ts';
import type { DesktopAPI } from './api.ts';

export function desktopAnalytics(shell: DesktopAPI): Analytics | null {
  const config = shell.runtime.analytics;
  if (!config?.kinds.length) return null;
  return {
    kinds: config.kinds,
    contact: config.contact,
    choice: async () => (await shell.analytics({ op: 'choice' })) as DataChoice,
    choose: async choice => {
      await shell.analytics({ op: 'choose', choice });
    },
    installId: async () => (await shell.analytics({ op: 'installId' })) as string | null,
    record: event => {
      // An event the main process cannot take is not counted; den-kit goes on.
      shell.analytics({ op: 'record', event }).catch(() => undefined);
    },
  };
}
