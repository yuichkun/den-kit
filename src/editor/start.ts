// The editing app's entry. A host calls startEditor with what it provides
// (src/host); the editor opens the last work from the host's storage, wires the
// AI and the workspace when the host has them, and mounts den-kit's screens; it
// saves the record after each change, and before the host quits. Nothing here
// knows which host it is.
import { createApp, h } from 'vue';
import type { Host } from '../host/index.ts';
import { AiRequests } from '../ai/requests.ts';
import { LlmController } from '../ai/llm.ts';
import { PodSession } from '../workspace/pod-session.ts';
import { defineWidgets } from '../screen/widgets/widgets.ts';
import App from './App.vue';
import { KitSession, RECORD_PREFIX } from './session.ts';
import { kitFiles } from '../screen/kit-files.ts';
import { CodeParts } from './code-parts.ts';
import { hostRecords } from './records.ts';
import '@fontsource/lato/400.css';
import '@fontsource/lato/700.css';
import '../screen/fonts.ts';
import './tokens.css';
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

export async function startEditor(host: Host, options: EditorOptions): Promise<KitSession> {
  defineWidgets();
  let unsaved = (_key: string) => {};
  const records = await hostRecords(host.storage, RECORD_PREFIX, key => unsaved(key));
  const session = new KitSession({
    host,
    storage: records,
    compileTimeoutMs: options.compileTimeoutMs,
    rotateAfter: options.rotateAfter,
  });
  unsaved = () =>
    session.toast('warn', 'den-kit could not save your changes; export the work to keep it.');
  // Nothing saved yet (the very first launch): open on the start screen.
  const firstRun = !session.restore('bass') && !options.noStart;
  const opened = session.doc.value;
  void session.lock.claim(opened.id).then(ours => {
    if (!ours) session.refused.value = opened.name;
  });
  if (host.ai) {
    session.bridge = host.ai;
    host.ai.start();
    session.requests = new AiRequests(session);
    session.llm = new LlmController(session, session.requests, host.ai);
  }
  session.pod = new PodSession(session, host.workspace, kitFiles());
  session.codeParts = new CodeParts(session, session.pod, host);
  host.lifecycle?.beforeQuit(async () => {
    session.saveNow();
    try {
      await records.flush();
    } finally {
      await session.pod?.flush();
    }
  });
  createApp({ render: () => h(App, { session, firstRun }) }).mount(options.mount);
  return session;
}
