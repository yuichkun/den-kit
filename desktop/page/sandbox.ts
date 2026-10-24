// The Sandbox interface (src/host) in the desktop app's page: each work's origin is
// the app's local server under the work's own host name (desktop/sandbox.ts), on
// the port the page itself comes from.
import type { Sandbox } from '../../src/host/index.ts';
import type { DesktopAPI } from './api.ts';

/** Where a work's files are served under its origin (desktop/sandbox.ts FILES_PATH). */
const FILES_PATH = '/__den-kit/files/';

export function desktopSandbox(shell: Pick<DesktopAPI, 'sandbox' | 'onSandboxRefused'>): Sandbox {
  const origin = (work: string) => `http://${work}.localhost:${location.port}`;
  return {
    async open(work, settings) {
      await shell.sandbox({
        op: 'open',
        work,
        settings: {
          portal: settings.devServer,
          origins: settings.origins,
          devices: settings.devices,
          files: settings.files,
          build: settings.build,
        },
      });
    },
    close(work) {
      void shell.sandbox({ op: 'close', work }).catch(() => undefined);
    },
    origin,
    servesContents: true,
    fileUrl: (work, path) =>
      `${origin(work)}${FILES_PATH}${path.split('/').map(encodeURIComponent).join('/')}`,
    onRefused: listener => shell.onSandboxRefused(listener),
  };
}
