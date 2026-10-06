import { createApp, h } from 'vue';
import App from './editor/App.vue';
import { KitSession } from './editor/session.ts';
import { defineWidgets } from './widgets/widgets.ts';
import '@fontsource/lato/400.css';
import '@fontsource/lato/700.css';
import './editor/style.css';

defineWidgets();
const query = new URLSearchParams(location.search);
const number = (key: string) => query.has(key) && Number.isFinite(Number(query.get(key))) ? Number(query.get(key)) : undefined;
const session = new KitSession({ compileTimeoutMs: number('compileTimeout'), rotateAfter: number('rotateAfter') });
session.restore('bass');
void session.claimWriter();
// Dev/test handle: e2e tests and the CP2 bridge client drive the same session.
(window as unknown as { __kit: KitSession }).__kit = session;
createApp({ render: () => h(App, { session }) }).mount('#app');
