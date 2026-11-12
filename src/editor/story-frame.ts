// What every story of den-kit's own screens shares (docs/development.md, Storybook): a session
// on a work that makes no sound, each part mounted on it with den-kit's fonts and styles, and a
// snapshot in each of den-kit's themes. .storybook/preview.ts applies the theme picked in the
// toolbar.
import { createApp, ref, type App, type VNode } from 'vue';
import { expect, waitFor } from 'storybook/test';
import { LlmController } from '../ai/llm.ts';
import { AiRequests } from '../ai/requests.ts';
import type { AI, AIConnection, AIStatus } from '../host/ai.ts';
// App.vue before the styles, as in start.ts: the components' styles come before the shell's.
import './App.vue';
import './styles.ts';
import { catalog } from '../sound/blocks/index.ts';
import type { AudioEngine } from '../sound/audio-engine.ts';
import type { WorkerLike } from '../sound/compile/compile-client.ts';
import type { Artifact } from '../sound/compile/protocol.ts';
import { THEMES as BASE_THEMES, type PatchDocument } from '../work/schema.ts';
import { starter } from '../work/starters.ts';
import { SESSION } from './context.ts';
import { KitSession } from './session.ts';
import { THEMES } from './theme.ts';

/**
 * The parameters of every story file of den-kit's own screens: a snapshot in each of den-kit's
 * themes, instead of each base theme of a plugin screen. Its meta also has the tags `editor`,
 * which runs its stories once in each of den-kit's themes (vite.config.ts), and `!autodocs`: a
 * docs page would show all its stories at once, and each screen takes the window and its keys.
 * Storybook reads tags only as written in the file, so each file writes them itself.
 */
export const editorParameters = {
  chromatic: {
    modes: {
      ...Object.fromEntries(BASE_THEMES.map(theme => [theme, { disable: true }])),
      ...Object.fromEntries(THEMES.map(theme => [theme.name, { editorTheme: theme.id }])),
    },
  },
};

/** Stories make no sound: every compile succeeds at once, with an empty sound that took 1.2 s. */
function silentCompiler(): WorkerLike {
  const worker: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(request) {
      const result: Artifact = {
        hash: request.hash,
        meta: {} as Artifact['meta'],
        moduleSource: '',
        wasm: new ArrayBuffer(0),
        processorName: '',
        sampleRate: 48000,
        compileMs: 1200,
      };
      queueMicrotask(() => worker.onmessage?.({ data: { id: request.id, result } }));
    },
    terminate() {},
  };
  return worker;
}

/**
 * Stories make no sound: the engine only keeps the held notes, so the keyboard shows them, and
 * gives scopes and meters nothing to draw.
 */
function silentEngine(): AudioEngine {
  const engine = {
    running: false,
    heldNotes: [] as number[],
    outAnalyser: null,
    probeAnalysers: [],
    start: async () => false,
    dispose: async () => {},
    setParam() {},
    setAssets() {},
    setTestSignal() {},
    unload() {},
    noteOn(note: number) {
      engine.heldNotes = [...new Set([...engine.heldNotes, note])];
    },
    noteOff(note: number) {
      engine.heldNotes = engine.heldNotes.filter(n => n !== note);
    },
    panic() {
      engine.heldNotes = [];
    },
  };
  return engine as unknown as AudioEngine;
}

/**
 * The host's AI as the stories show it: online and signed in, worded for the people who use it
 * as in the desktop app. It sends no request.
 */
function storyAI(): AI {
  const unavailable = 'The AI does not answer in Storybook.';
  return {
    state: ref<AIConnection>('online'),
    detail: ref(''),
    status: ref<AIStatus | null>({ codex: { state: 'ok', plan: 'Plus', images: true } }),
    online: true,
    codexReady: true,
    start() {},
    stop() {},
    retryNow() {},
    onStatus: () => () => {},
    onLlm: () => () => {},
    llmStart: () => false,
    conversation: async () => null,
    llmSteer: () => false,
    llmStop: () => false,
    llmAnswer: () => false,
    llmForget: () => false,
    toolResult: () => false,
    codexRetry: () => false,
    telemetry() {},
    wording: {
      technical: false,
      unavailable: () => unavailable,
      failure: () => ({ message: unavailable }),
      stopped: () => unavailable,
      activity: () => null,
      retrying: message => message,
      skippedQuestion: null,
    },
    account: null,
  };
}

/** `session` with the AI, its requests and the controller wired in as start.ts wires the host's. */
export function withAI(session: KitSession): KitSession {
  const ai = storyAI();
  session.bridge = ai;
  session.requests = new AiRequests(session);
  session.llm = new LlmController(session, session.requests, ai);
  return session;
}

/** A session on `doc` (the Bass starter unless given), with no storage and no sound. */
export function storySession(doc: PatchDocument = starter('bass', catalog)): KitSession {
  const session = new KitSession({
    storage: null,
    createWorker: () => silentCompiler() as unknown as Worker,
    engine: silentEngine(),
  });
  session.replace(doc, 'Story', false);
  return session;
}

/**
 * Waits until the patch view in `canvas` has drawn its modules and cables and fitted them in
 * view, as it does a moment after a work opens, with the theme's fonts.
 */
export async function patchDrawn(canvas: HTMLElement) {
  await document.fonts.ready;
  await waitFor(
    () => {
      const pane = canvas.querySelector<HTMLElement>('.vue-flow__transformationpane');
      expect(pane?.style.transform).toMatch(/^translate\(/);
      expect(pane?.style.transform).not.toBe('translate(0px, 0px) scale(1)');
      expect(canvas.querySelector('.vue-flow__edge')).not.toBeNull();
    },
    { timeout: 5000 },
  );
}

/** Mounts its Vue tree while it is in the page, so a story that goes away unmounts its part. */
class StoryPart extends HTMLElement {
  session: KitSession | null = null;
  view: (() => VNode) | null = null;
  private app: App | null = null;
  connectedCallback() {
    if (this.app || !this.session || !this.view) return;
    this.app = createApp({ render: this.view });
    this.app.provide(SESSION, this.session);
    this.app.mount(this);
  }
  disconnectedCallback() {
    this.app?.unmount();
    this.app = null;
  }
}
if (!customElements.get('story-part')) customElements.define('story-part', StoryPart);

/**
 * A part of den-kit's screens on `session`, which it reads the way App.vue provides it, in a box
 * of `style` (the whole window unless given).
 */
export function mount(
  session: KitSession,
  view: () => VNode,
  style = 'display:block;height:100vh',
): HTMLElement {
  const part = document.createElement('story-part') as StoryPart;
  part.session = session;
  part.view = view;
  part.style.cssText = style;
  return part;
}
