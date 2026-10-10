import { createApp, h } from 'vue';
import bridgeConfig from 'virtual:kit-bridge';
import podConfig from 'virtual:kit-pod';
import { BridgeClient } from './ai/bridge-client.ts';
import { AiRequests } from './ai/requests.ts';
import { LlmController } from './ai/llm.ts';
import App from './editor/App.vue';
import { KitSession } from './editor/session.ts';
import { PodSession, type PodFactory } from './pod/pod-session.ts';
import { defineWidgets } from './widgets/widgets.ts';
import { desktop } from './desktop/api.ts';
import '@fontsource/lato/400.css';
import '@fontsource/lato/700.css';
import './plugin/fonts.ts';
import './editor/style.css';

// A service worker another app left on this address would keep the page from being cross-origin isolated (see browserpod.ts).
if (!globalThis.crossOriginIsolated && 'serviceWorker' in navigator) void import('./pod/browserpod.ts').then(m => m.clearForeignServiceWorkers());
defineWidgets();
const query = new URLSearchParams(location.search);
const number = (key: string) => query.has(key) && Number.isFinite(Number(query.get(key))) ? Number(query.get(key)) : undefined;
const session = new KitSession({ compileTimeoutMs: number('compileTimeout'), rotateAfter: number('rotateAfter') });
// Nothing saved yet (the very first launch): open on the start screen.
const firstRun = !session.restore('bass') && !query.has('noStart');
// The local AI bridge (started by `dev`); without it the editor runs as in CP1 and shows "AI offline".
const shell = desktop();
session.bridge = new BridgeClient({ token: shell?.runtime.token ?? bridgeConfig.token });
session.bridge.start();
session.requests = new AiRequests(session);
session.llm = new LlmController(session, session.requests, session.bridge);
// The pod: BrowserPod when .env has BROWSERPOD_API_KEY; the e2e harness's stand-in when it sets one up (tests only).
const apiKey = shell?.runtime.apiKey ?? podConfig.apiKey;
const pod: PodFactory = podConfig.fakeUrl
  ? { kind: 'fake', create: async () => (await import('./pod/fake-host.ts')).connectFakePod(podConfig.fakeUrl!) }
  : apiKey
    ? { kind: 'browserpod', create: async progress => (await import('./pod/browserpod.ts')).bootBrowserPod({ apiKey, storageKey: 'den-kit', log: progress }) }
    : { kind: null, create: () => Promise.reject(new Error('No pod.')), reason: shell ? 'BrowserPod is unavailable in this app build.' : 'The pod (BrowserPod) is off: no API key.', fix: shell ? 'Contact the app maintainer for a build with BrowserPod configured. You do not need your own BrowserPod account or key.' : 'Put BROWSERPOD_API_KEY=… in .env (a key from console.browserpod.io), then restart `npm run dev`.' };
session.pod = new PodSession(session, pod);
// Dev/test handle: e2e tests and the CP2 bridge client drive the same session.
(window as unknown as { __kit: KitSession }).__kit = session;
createApp({ render: () => h(App, { session, firstRun }) }).mount('#app');
