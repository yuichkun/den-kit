// The editing app's entry. A host calls startEditor with what it provides
// (src/host); the editor opens the work, wires the AI and the workspace when the
// host has them, and mounts den-kit's screens. Nothing here knows which host it is.
import { createApp, h } from 'vue';
import type { Host } from '../host/index.ts';
import { AiRequests } from '../ai/requests.ts';
import { LlmController } from '../ai/llm.ts';
import { PodSession } from '../workspace/pod-session.ts';
import { defineWidgets } from '../screen/widgets/widgets.ts';
import App from './App.vue';
import { KitSession } from './session.ts';
import '@fontsource/lato/400.css';
import '@fontsource/lato/700.css';
import '../screen/fonts.ts';
import './style.css';

export interface EditorOptions {
  /** The element den-kit mounts into. */
  mount: string | Element;
  /** Tests: how long a compile may take, and when the audio context is replaced. */
  compileTimeoutMs?: number;
  rotateAfter?: number;
  /** Tests: never open on the start screen. */
  noStart?: boolean;
}

export function startEditor(host: Host, options: EditorOptions): KitSession {
  defineWidgets();
  const session = new KitSession({
    host,
    compileTimeoutMs: options.compileTimeoutMs,
    rotateAfter: options.rotateAfter,
  });
  // Nothing saved yet (the very first launch): open on the start screen.
  const firstRun = !session.restore('bass') && !options.noStart;
  if (host.ai) {
    session.bridge = host.ai;
    host.ai.start();
    session.requests = new AiRequests(session);
    session.llm = new LlmController(session, session.requests, host.ai);
  }
  session.pod = new PodSession(session, host.workspace);
  host.lifecycle?.beforeQuit(async () => {
    session.saveNow();
    await session.pod?.flush();
  });
  createApp({ render: () => h(App, { session, firstRun }) }).mount(options.mount);
  return session;
}
