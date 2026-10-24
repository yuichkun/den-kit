// The development host: den-kit in a browser tab from `vp run dev`, with the AI
// bridge that `dev` starts and BrowserPod with the developer's own key (.env),
// or the stand-in pod of the e2e harness. Developers see the runtime's own
// messages and the commands that fix the setup.
import bridgeConfig from 'virtual:kit-bridge';
import podConfig from 'virtual:kit-pod';
import type { Host, PodFactory } from '../src/host/index.ts';
import { startEditor } from '../src/editor/start.ts';
import { BridgeClient } from '../desktop/page/bridge-client.ts';
import { browserStorage } from '../desktop/page/storage.ts';
import { developerWording } from './ai-wording.ts';
import { tabCapture } from './tab-capture.ts';
import { devSandbox } from './sandbox.ts';

// A service worker another app left on this address would keep the page from being cross-origin isolated (see browserpod.ts).
if (!globalThis.crossOriginIsolated && 'serviceWorker' in navigator)
  void import('../desktop/page/browserpod.ts').then(m => m.clearForeignServiceWorkers());

const query = new URLSearchParams(location.search);
const number = (key: string) =>
  query.has(key) && Number.isFinite(Number(query.get(key))) ? Number(query.get(key)) : undefined;
const apiKey = podConfig.apiKey;
const workspace: PodFactory = podConfig.fakeUrl
  ? {
      kind: 'fake',
      create: async work =>
        (await import('./fake-pod.ts')).connectFakePod(podConfig.fakeUrl!, work),
    }
  : apiKey
    ? {
        kind: 'browserpod',
        startEarly: true,
        create: async (work, progress) =>
          (await import('../desktop/page/browserpod.ts')).bootBrowserPod({
            apiKey,
            audience: 'developer',
            work,
            log: progress,
          }),
      }
    : {
        kind: null,
        create: () => Promise.reject(new Error('Project tools are unavailable.')),
        reason: 'Project tools are not configured.',
        fix: 'Put BROWSERPOD_API_KEY=… in .env (a key from console.browserpod.io), then restart `vp run dev`.',
      };
const host: Host = {
  storage: browserStorage(),
  // Without a token (no bridge was started) the AI says it is offline and the editor works on.
  ai: new BridgeClient({ token: bridgeConfig.token, wording: developerWording }),
  account: null,
  workspace,
  // Code parts load from each work's own origin on the bridge (none without a bridge).
  sandbox: bridgeConfig.token ? devSandbox(bridgeConfig.token, bridgeConfig.port) : null,
  fetch: null,
  screenCapture: tabCapture(),
  consent: null,
  lifecycle: null,
};
const session = await startEditor(host, {
  mount: '#app',
  compileTimeoutMs: number('compileTimeout'),
  rotateAfter: number('rotateAfter'),
  noStart: query.has('noStart'),
});
// Tests drive the same session.
(window as unknown as { __kit: typeof session }).__kit = session;
