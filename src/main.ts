import { createApp, h } from 'vue';
import bridgeConfig from 'virtual:kit-bridge';
import { BridgeClient } from './ai/bridge-client.ts';
import { FastPath } from './ai/fast-path.ts';
import { LlmController } from './ai/llm.ts';
import App from './editor/App.vue';
import { KitSession } from './editor/session.ts';
import { defineWidgets } from './widgets/widgets.ts';
import '@fontsource/lato/400.css';
import '@fontsource/lato/700.css';
import './plugin/fonts.ts';
import './editor/style.css';

defineWidgets();
const query = new URLSearchParams(location.search);
const number = (key: string) => query.has(key) && Number.isFinite(Number(query.get(key))) ? Number(query.get(key)) : undefined;
const session = new KitSession({ compileTimeoutMs: number('compileTimeout'), rotateAfter: number('rotateAfter') });
// Nothing saved yet (the very first launch): open on the start screen.
const firstRun = !session.restore('bass') && !query.has('noStart');
// The local AI bridge (started by `kit:dev`); without it the editor runs as in CP1 and shows "AI offline".
session.bridge = new BridgeClient({ token: bridgeConfig.token });
session.bridge.start();
session.fast = new FastPath(session);
session.llm = new LlmController(session, session.fast, session.bridge);
// Dev/test handle: e2e tests and the CP2 bridge client drive the same session.
(window as unknown as { __kit: KitSession }).__kit = session;
createApp({ render: () => h(App, { session, firstRun }) }).mount('#app');
