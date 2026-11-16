// startEditor, which a host calls with what it provides (src/host). It opens the
// last work, or the start screen on the very first launch, mounts den-kit's
// screens, counts den-kit's use as the person allowed it, and saves the record
// before the host quits.
import { createApp, h } from 'vue';
import type { DataKind, Host } from '../host/index.ts';
import { AiRequests } from '../ai/requests.ts';
import { LlmController } from '../ai/llm.ts';
import { PodSession } from '../workspace/pod-session.ts';
import { defineWidgets } from '../screen/widgets/widgets.ts';
import App from './App.vue';
import { KitSession, RECORD_PREFIX } from './session.ts';
import { kitFiles } from '../screen/kit-files.ts';
import { CodeParts } from './code-parts.ts';
import { hostRecords } from './records.ts';
import { savedTheme, useTheme } from './theme.ts';
import { countUsage, Usage } from './usage.ts';
import { unasked } from './data-consent.ts';
import './styles.ts';

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
  useTheme(savedTheme());
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
  // Kinds of data the person has not answered about are asked first; until then, nothing is counted.
  let asking: DataKind[] = [];
  if (host.analytics) {
    const usage = (session.usage = new Usage(host.analytics, records));
    const choice = await host.analytics.choice().catch(() => null);
    if (choice) asking = unasked(host.analytics.kinds, choice);
    if (choice && !asking.length) usage.allow(choice.usage === true);
    countUsage(session, usage);
  }
  host.lifecycle?.beforeQuit(async () => {
    session.saveNow();
    try {
      await records.flush();
    } finally {
      await session.pod?.flush();
    }
  });
  createApp({ render: () => h(App, { session, firstRun, asking }) }).mount(options.mount);
  return session;
}
