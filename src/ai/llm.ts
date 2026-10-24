// The LLM request controller. A request goes to the agent runtime through the
// host's AI; the runtime works on the live work with the kit_* tools, which run
// here in the page (src/ai/llm-workspace.ts). Each edit is tried on a copy first;
// one that validates and compiles lands at once, so the person sees and hears the
// request being built. The person keeps playing and editing meanwhile; an edit
// that no longer fits goes back to the runtime.
//
// One request runs at a time; another one sent while it works is added to the
// running turn. Each work has one conversation, which the runtime keeps: den-kit
// keeps only which conversation is the work's (src/ai/session.ts), and a request
// goes on with it. What the person attached, sketched and looks at comes along as
// den-kit's notes. Esc stops the request (what already landed stays, ⌘Z takes it
// back); loading another work, or undoing the request's edit while it runs, stops
// it too. The runtime never gets to ask the person: questions are answered empty.
//
// Sub-agents are the runtime's: the request's AI starts them, and den-kit knows
// them by the runtime's id on their tool calls. A sub-agent says what it will
// change with kit_claim_scope before it edits; den-kit holds every agent to its
// scope on every edit (src/ai/scope.ts), and scopes of agents working at the same
// time do not overlap. All their edits land in the same request: one ⌘Z.
import { assetsOf } from '../work/ui.ts';
import { ref, shallowRef, watch } from 'vue';
import type { AiSession } from './session.ts';
import { randomId } from '../work/schema.ts';
import type { Intent } from '../work/ops.ts';
import {
  CompileClient,
  CompileFailure,
  compileInputs,
  type WorkerLike,
} from '../sound/compile/compile-client.ts';
import { RenderClient, type RenderWorkerLike } from '../sound/compile/render-client.ts';
import type { AI, LlmInbound } from '../host/ai.ts';
import type { AgentLane, AiRequests, Outcome } from './requests.ts';
import { developerInstructions } from './llm-spec.ts';
import { LlmWorkspace, type WorkspaceDeps } from './llm-workspace.ts';
import { handEdits } from './plugin-tools.ts';
import { describeAttachments } from './attachments.ts';
import type { Attachment } from './attachments.ts';
import { handEditsSince } from './conversation.ts';
import { viewPicture } from '../screen/picture.ts';
import { SHOWCASE_ASSETS } from '../screen/showcase/assets.ts';
import {
  changes,
  describeScope,
  heldByOthers,
  made,
  outside,
  parseScope,
  scopesOverlap,
  seamOf,
  shortScope,
  touched,
  type Holding,
} from './scope.ts';
import {
  MAX_LLM_IMAGES,
  MAX_TOOL_IMAGE,
  type LlmEvent,
  type TokenUsage,
  type ToolOutput,
} from '../host/ai.ts';
import { seeingText } from './seeing.ts';
import type { SentSketch, SketchPart } from './sketch.ts';
import CompilerWorker from '../sound/compile/compiler.worker.ts?worker';

export type LlmTransport = Pick<
  AI,
  | 'llmStart'
  | 'llmSteer'
  | 'llmStop'
  | 'llmAnswer'
  | 'llmForget'
  | 'toolResult'
  | 'conversation'
  | 'onLlm'
  | 'telemetry'
  | 'status'
  | 'codexReady'
  | 'online'
  | 'wording'
>;

export interface LlmOptions {
  /** Replace workspace dependencies (tests). */
  deps?: Partial<WorkspaceDeps>;
  createCompileWorker?: () => WorkerLike;
  createRenderWorker?: () => RenderWorkerLike;
  /** After Esc, how long to wait for the runtime to confirm before ending the request here. */
  stopGraceMs?: number;
}

/** What an AI just changed: the views outline it in the AI's colour for a moment. */
export interface Touch {
  ids: string[];
  color: string;
  name: string;
  at: number;
}
export const TOUCH_MS = 2000;

/** Lane colours of sub-agents (the request's own AI uses the accent). */
export const AGENT_COLORS = ['#4fc3f7', '#c792ea', '#9ccc65', '#ffb74d'] as const;

type AgentStatus = AgentLane['status'];
interface Agent {
  /** "request" for the AI the person asked; a sub-agent: the runtime's id for it. */
  id: string;
  name: string;
  color: string;
  ws: LlmWorkspace;
  calls: Map<string, Promise<ToolOutput>>;
  started: number;
  firstLanded: number | null;
  ended: number | null;
  status: AgentStatus;
  message: string;
  activity?: string;
  steps: string[];
  tools: number;
  usage: TokenUsage | null;
  /** What it made: always its own to change. */
  owned: Set<string>;
  /** A sub-agent's claimed scope. */
  holding?: Holding;
  error?: string;
}

interface Turn {
  /** The request's id (its line in the history). */
  id: string;
  line: Outcome;
  started: number;
  epoch: number;
  /** The work it is about. */
  work: string;
  /** The AI the person asked. */
  lead: Agent;
  /** Sub-agents, by the runtime's id for them. */
  agents: Map<string, Agent>;
  /** The person's sketches in this request: with the request and what they added while it ran. */
  sketch: SketchPart[];
  stopping: boolean;
  stopTimer: ReturnType<typeof setTimeout> | null;
  /** Why it was stopped by something other than Esc. */
  stopNote?: string;
  firstChange: number | null;
}

const MAX_STEPS = 12;
const MAX_AGENT_STEPS = 30;
const TOOL_ACTIVITY: Record<string, string> = {
  kit_get_patch: 'reading the patch…',
  kit_list_blocks: 'looking up modules…',
  kit_describe_block: 'looking up a module…',
  kit_apply_ops: 'editing…',
  kit_write_codebox: 'writing code…',
  kit_listen: 'listening…',
  kit_finish: 'finishing…',
  kit_bash: 'running a command…',
  kit_read_file: 'reading a file…',
  kit_write_file: 'writing a file…',
  kit_get_plugin: 'reading the plugin screen…',
  kit_ui_reference: 'looking up how screens are built…',
  kit_look: 'looking at the screen…',
  kit_view_picture: 'looking at a picture…',
  kit_claim_scope: 'claiming its part…',
};
const TOOL_DONE: Record<string, string> = {
  kit_get_patch: 'read the patch',
  kit_list_blocks: 'looked up modules',
  kit_describe_block: 'looked up a module',
  kit_get_plugin: 'read the plugin screen',
  kit_ui_reference: 'looked up the screen reference',
  kit_read_file: 'read a file',
};
const KEPT = 'What it already changed stays; ⌘Z takes it back.';

/** Pictures that go with a message (at most MAX_LLM_IMAGES). */
const pictures = (images: readonly string[]): string[] | undefined =>
  images.length ? images.slice(0, MAX_LLM_IMAGES) : undefined;
/** The pictures of sketches. */
const imagesOf = (parts: readonly SketchPart[] | undefined) =>
  pictures((parts ?? []).flatMap(p => (p.image ? [p.image] : [])));
/** Sketches in words, one [den-kit] note per view. */
const sketchLines = (parts: readonly SketchPart[] | undefined) =>
  (parts ?? [])
    .filter(p => p.text)
    .map(p => `[den-kit] ${p.text}`)
    .join('\n');

export class LlmController {
  /** A request is running (Esc stops it). */
  readonly busy = ref(false);
  /** What the AIs of the running request just changed (newest last). */
  readonly touches = shallowRef<Touch[]>([]);
  private turn: Turn | null = null;
  /** Requests waiting for the running request to end (an addition that came too late). */
  private queue: Outcome[] = [];
  private steering = new Map<string, Outcome>();
  /** When the request's AI last started a turn of this work's conversation (for "since your last turn"). */
  private lastStarted = new Map<string, number>();
  /** Each agent checks its edits on its own compiler (the request's AI keeps one between requests). */
  private compilers = new Map<string, CompileClient>();
  private renderer: RenderClient | null = null;
  readonly session: AiSession;
  private readonly requests: AiRequests;
  private readonly bridge: LlmTransport;
  private readonly options: LlmOptions;
  private readonly stopWatching: Array<() => void> = [];

  constructor(
    session: AiSession,
    requests: AiRequests,
    bridge: LlmTransport,
    options: LlmOptions = {},
  ) {
    this.session = session;
    this.requests = requests;
    this.bridge = bridge;
    this.options = options;
    bridge.onLlm(m => this.inbound(m));
    // Another work was loaded: the request was about the old one.
    this.stopWatching.push(
      watch(
        () => session.loadEpoch.value,
        () => {
          if (this.turn) this.stop('A different patch was loaded, so it stopped.');
        },
        { flush: 'sync' },
      ),
    );
    // ⌘Z on what the running request just did: the person does not want it to go on.
    this.stopWatching.push(
      session.onHistory((kind, tx) => {
        if (
          kind === 'undo' &&
          tx.author.kind === 'ai-llm' &&
          this.turn &&
          tx.author.take === this.turn.id
        )
          this.stop('You undid its edit, so it stopped.');
      }),
    );
  }

  get ready() {
    return this.bridge.codexReady;
  }
  get off() {
    const c = this.bridge.status.value?.codex;
    return !this.bridge.online || !c || c.state === 'off';
  }
  get running() {
    return this.turn !== null;
  }

  /** Why the LLM cannot take a request right now. */
  reason(): string {
    return this.bridge.wording.unavailable(this.bridge.online, this.bridge.status.value?.codex);
  }

  /** Send a request with its attachments. Always returns its history line. */
  run(
    text: string,
    options: {
      via?: 'typed' | 'voice';
      attached?: Attachment[];
      /** The person's rough sketch. */ sketch?: SentSketch;
    } = {},
  ): Outcome {
    const line: Outcome = {
      id: randomId('rq'),
      text: text.trim().slice(0, 600),
      via: options.via,
      status: 'thinking',
      route: 'llm',
      ms: 0,
      attached: options.attached?.length ? options.attached : undefined,
      where: this.requests.where(),
      ...(options.sketch ? { sketch: options.sketch } : {}),
    };
    // The marks stay (dimmed) while the request runs.
    if (options.sketch?.ids?.length) this.session.markSent(options.sketch.ids, line.id);
    const taken = this.take(line);
    if (taken) return taken;
    this.session.releaseSent(line.id, true);
    const failed: Outcome = { ...line, status: 'failed', message: this.reason() };
    this.requests.upsert(failed);
    return failed;
  }

  /** Send a prompt with its attachments and sketch; null when the LLM is not available. */
  take(line: Outcome): Outcome | null {
    if (!line.text || !this.ready) return null;
    if (this.turn && !this.turn.stopping) return this.steer(line);
    if (this.turn) {
      const waiting = {
        ...line,
        status: 'thinking' as const,
        route: 'llm' as const,
        live: true,
        message: 'waits for the running request to stop…',
      };
      this.queue.push(waiting);
      this.requests.upsert(waiting);
      return waiting;
    }
    return this.start(line);
  }

  /** Esc: stop the running request, sub-agents included; what already landed stays (⌘Z takes it back). */
  stop(note?: string): boolean {
    const turn = this.turn;
    if (!turn || turn.stopping) return false;
    turn.stopping = true;
    turn.stopNote = note;
    this.update(turn, { activity: 'stopping…' });
    if (!this.bridge.online || !this.bridge.llmStop(turn.id)) {
      this.finish(turn, { kind: 'done', status: 'interrupted', ms: 0 });
      return true;
    }
    turn.stopTimer = setTimeout(() => {
      if (this.turn === turn) this.finish(turn, { kind: 'done', status: 'interrupted', ms: 0 });
    }, this.options.stopGraceMs ?? 15000);
    return true;
  }

  dispose() {
    for (const stop of this.stopWatching) stop();
    for (const c of this.compilers.values()) c.dispose();
    this.compilers.clear();
    this.renderer?.dispose();
    this.renderer = null;
  }

  // ---- turns ----------------------------------------------------------------------------
  private agentsOf(turn: Turn): Agent[] {
    return [turn.lead, ...turn.agents.values()];
  }

  private start(line: Outcome): Outcome {
    const started = performance.now();
    const work = this.session.doc.value.id;
    const turn: Turn = {
      id: line.id,
      started,
      epoch: this.session.loadEpoch.value,
      work,
      line: {
        ...line,
        status: 'thinking',
        route: 'llm',
        live: true,
        steps: [],
        activity: 'starting…',
        message: undefined,
      },
      lead: null as unknown as Agent,
      agents: new Map(),
      sketch: [...(line.sketch?.parts ?? [])],
      stopping: false,
      stopTimer: null,
      firstChange: null,
    };
    turn.lead = this.makeAgent(turn, { id: 'request', name: 'AI', color: 'var(--accent)' });
    this.turn = turn;
    this.busy.value = true;
    this.requests.upsert(turn.line);
    this.send(turn, line);
    return turn.line;
  }

  /** Send the request in the work's conversation (the runtime opens it again by its id). */
  private send(turn: Turn, line: Outcome) {
    const thread = this.session.conversation.value;
    const context = this.context(line, !!thread, turn.work);
    this.lastStarted.set(turn.work, Date.now());
    const sent = this.bridge.llmStart(
      turn.id,
      line.text,
      // Instructions are sent every time: a new conversation starts with them.
      developerInstructions(this.blocks()),
      thread ?? undefined,
      { context, images: imagesOf(line.sketch?.parts) },
    );
    if (!sent)
      this.finish(turn, {
        kind: 'done',
        status: 'failed',
        error: { message: 'The AI bridge is not connected.' },
        ms: 0,
      });
  }

  private makeAgent(turn: Turn, spec: { id: string; name: string; color: string }): Agent {
    const agent: Agent = {
      ...spec,
      ws: null as unknown as LlmWorkspace,
      calls: new Map(),
      started: performance.now(),
      firstLanded: null,
      ended: null,
      status: 'working',
      message: '',
      steps: [],
      tools: 0,
      usage: null,
      owned: new Set<string>(),
    };
    agent.ws = new LlmWorkspace(this.deps(turn, agent));
    return agent;
  }

  /** A sub-agent, known from its first event or tool call. */
  private subAgent(turn: Turn, id: string, name?: string): Agent {
    let agent = turn.agents.get(id);
    if (!agent) {
      const n = turn.agents.size;
      agent = this.makeAgent(turn, {
        id,
        name: name || `Agent ${n + 1}`,
        color: AGENT_COLORS[n % AGENT_COLORS.length]!,
      });
      turn.agents.set(id, agent);
      this.step(turn, turn.lead, `started ${agent.name}`);
      this.syncLanes(turn);
    } else if (name && agent.name !== name && !agent.holding) {
      // The runtime's name for it, unless it named itself when it claimed its scope.
      agent.name = name;
      this.syncLanes(turn);
    }
    return agent;
  }

  private steer(line: Outcome): Outcome {
    const turn = this.turn!;
    // A sketch added to the running request stays (dimmed) until the request ends.
    if (line.sketch?.parts.length) {
      turn.sketch.push(...line.sketch.parts);
      if (line.sketch.ids?.length) this.session.markSent(line.sketch.ids, turn.id);
    }
    const steer: Outcome = {
      ...line,
      status: 'thinking',
      route: 'llm',
      live: true,
      message: 'adding this to the running request…',
    };
    this.steering.set(steer.id, steer);
    this.requests.upsert(steer);
    const notes = this.notes(line);
    if (
      !this.bridge.llmSteer(steer.id, turn.id, line.text, {
        context: ['[den-kit] The person adds this while you work.', notes]
          .filter(Boolean)
          .join('\n'),
        images: imagesOf(line.sketch?.parts),
      })
    )
      this.later(steer);
    return steer;
  }

  /** Run after the current request (an addition that arrived as it ended). */
  private later(line: Outcome) {
    this.steering.delete(line.id);
    if (line.sketch?.ids?.length) this.session.markSent(line.sketch.ids, line.id);
    const waiting: Outcome = {
      ...line,
      status: 'thinking',
      live: true,
      message: 'waits for the running request…',
    };
    this.queue.push(waiting);
    this.requests.upsert(waiting);
    if (!this.turn) this.next();
  }

  private next() {
    const line = this.queue.shift();
    if (!line) return;
    if (!this.ready) {
      this.session.releaseSent(line.id, true);
      this.requests.upsert({ ...line, status: 'failed', live: false, message: this.reason() });
      this.next();
      return;
    }
    this.start(line);
  }

  /** den-kit's notes about the moment of a request: what the person attached, where they are, what they look at, their sketch. */
  private notes(line: Outcome): string {
    const attached = line.attached?.length
      ? `[den-kit] The person attached (points at) these: ${describeAttachments(line.attached)}. The request is about them: change these unless they clearly ask for something new.`
      : '';
    return [
      attached,
      line.where ? `[den-kit] ${this.whereText(line)}` : '',
      `[den-kit] ${this.seeingLine()}`,
      sketchLines(line.sketch?.parts),
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** The notes a new request comes with: the notes, and the person's own edits since the conversation's last turn. */
  private context(line: Outcome, goingOn: boolean, work: string): string {
    const parts = [
      `[den-kit] You edit the live work; each edit that checks out lands at once${goingOn ? '. It may have changed since your last turn, so read it again' : ''}.`,
    ];
    // The person's own edits: since the conversation's last turn, or (a new conversation) all of them.
    const since = goingOn ? (this.lastStarted.get(work) ?? 0) : 0;
    const hand = handEditsSince(this.session.history.entries(), since);
    if (hand)
      parts.push(
        `[den-kit] The person edited by hand${goingOn ? ' since your last turn' : ''}: ${hand}.`,
      );
    return [...parts, this.notes(line)].join('\n');
  }

  /** What the person is looking at now, in one line. */
  private seeingLine(): string {
    const s = this.session;
    return seeingText(s.seeingNow(), s.doc.value, s.catalog, {
      selection: s.selection.value,
      held: s.heldNotes.value,
      inside: s.scope.value,
      shared: !!s.screen.source,
    });
  }

  private whereText(line: Outcome): string {
    const w = line.where!;
    return `The person is inside part "${w.name}" (part ${w.part}, entered through ${w.path.join(' › ')}). The request is about this part unless they clearly say otherwise: add modules with "inside": "${w.part}", show knobs on it with addParam; the parameters of the use they came through are set on ${w.path.at(-1)}. An edit inside changes every use of the part.`;
  }

  private blocks(): string {
    // Not what expansion makes (sums of copies and the like): only what can be placed.
    return this.session.catalog
      .list()
      .filter(d => d.kind !== 'comment' && (d.palette !== 'never' || d.kind === 'part'))
      .map(d => `${d.type} — ${d.title} (${d.category}): ${d.summary}`)
      .join('\n');
  }

  /** What the workspace of `agent` may do; landing works only while its request runs, on the work it started on. */
  private deps(turn: Turn, agent: Agent): WorkspaceDeps {
    const sub = agent !== turn.lead && agent.id !== 'request';
    return {
      catalog: this.session.catalog,
      images: !!this.bridge.status.value?.codex.images,
      read: () => this.session.doc.value,
      myParts: () => this.session.myParts.value,
      land: (intents, label, seen) => this.land(turn, agent, intents, label, seen),
      compile: async (generated, doc) => {
        try {
          const artifact = await this.compilerFor(agent).compile(
            generated,
            compileInputs(doc, generated),
          );
          this.session.compiler.prime(artifact); // the live work then swaps it in without compiling again
          return { ok: true, ms: artifact.compileMs };
        } catch (error) {
          if (error instanceof CompileFailure)
            return { ok: false, message: error.message, issues: error.issues };
          return {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
            issues: [],
          };
        }
      },
      render: request => this.checkRenderer().render(request),
      readAsset: asset => this.session.assets.read(asset),
      look: (doc, picture) => this.session.look({ doc, picture }),
      viewPicture: async id => {
        const asset = assetsOf(this.session.doc.value.files)[id] ?? SHOWCASE_ASSETS[id];
        const url = this.session.assetUrls.value[id] ?? asset?.url;
        if (!url) return null;
        try {
          return await viewPicture(url);
        } catch {
          return null;
        }
      },
      handEdits: () =>
        handEdits(this.session.history.entries(), this.session.doc.value, this.session.catalog),
      pod: this.session.pod?.access(),
      scope: (before, after) => this.scopeCheck(turn, agent, before, after),
      project: () => this.projectCheck(turn, agent),
      claim: args => this.claim(turn, agent, args),
      working: sub
        ? undefined
        : () =>
            [...turn.agents.values()].filter(a => a.status === 'working').map(a => `“${a.name}”`),
      seen: async view => {
        const s = this.session;
        const seeing = s.seeingNow();
        const looking =
          seeing.view === 'plugin' ? 'plugin' : seeing.view === 'patch' ? 'patch' : 'other';
        const text = this.seeingLine();
        if (!s.screen.source)
          return {
            text,
            looking,
            reason: 'The person has not shared their screen with you (they can, in the AI panel).',
          };
        const which = view ?? (looking === 'other' ? 'window' : looking);
        if (which !== 'window' && which !== looking)
          return {
            text,
            looking,
            reason: `The person is not looking at the ${which} now, so it is not on their screen.`,
          };
        const rect = s.viewRect(which === 'window' ? 'window' : which);
        if (!rect) return { text, looking, reason: `The ${which} is not on the screen now.` };
        try {
          return { text, looking, picture: await s.screen.picture(rect, 1280) };
        } catch (error) {
          return {
            text,
            looking,
            reason: `The picture could not be taken (${error instanceof Error ? error.message : String(error)}).`,
          };
        }
      },
      importFile: (url, name) => this.session.importFromUrl(url, name),
      ...this.options.deps,
    };
  }

  private land(
    turn: Turn,
    agent: Agent,
    intents: Intent[],
    label: string,
    seen: number,
  ): { ok: true } | { ok: false; message: string } {
    if (this.turn !== turn || turn.stopping || agent.status !== 'working')
      return { ok: false, message: 'This request was stopped.' };
    if (this.session.loadEpoch.value !== turn.epoch)
      return { ok: false, message: 'A different patch was loaded.' };
    const before = this.session.doc.value;
    const r = this.session.commit(intents, {
      author: {
        kind: 'ai-llm',
        take: turn.id,
        trace: agent === turn.lead ? turn.id : `${turn.id}:${agent.id}`,
      },
      label: `AI: ${label}`,
      group: turn.id,
      seen,
    });
    if (!r.ok)
      return {
        ok: false,
        message: `${r.error.message}${r.error.hint ? ` ${r.error.hint}` : ''} (the person may have changed the work meanwhile).`,
      };
    if (r.ops.length) {
      if (!turn.line.txId) this.update(turn, { txId: this.session.history.peek()?.id });
      const now = performance.now();
      agent.firstLanded ??= now;
      turn.firstChange ??= now;
      const list = changes(before, this.session.doc.value, this.session.catalog);
      for (const id of [...r.created, ...made(list)]) agent.owned.add(id);
      if (turn.agents.size) this.touch(agent, touched(list));
    }
    return { ok: true };
  }

  /** kit_claim_scope: an agent says what it will change; it may not overlap what another working agent holds. */
  private claim(turn: Turn, agent: Agent, args: unknown): ToolOutput {
    if (this.turn !== turn || turn.stopping)
      return { success: false, text: 'This request was stopped.' };
    const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
    const doc = this.session.doc.value;
    const parsed = parseScope(a.scope, doc);
    if ('error' in parsed) return { success: false, text: parsed.error };
    for (const other of this.agentsOf(turn)) {
      if (other === agent || other.status !== 'working' || !other.holding) continue;
      const overlap = scopesOverlap(parsed.scope, other.holding.scope, doc);
      if (overlap)
        return {
          success: false,
          text: `It overlaps what “${other.name}” holds while it works (${overlap}). Its scope: ${describeScope(other.holding.scope)}. Claim another part, or wait until it is done.`,
        };
    }
    if (typeof a.name === 'string' && a.name.trim() && agent !== turn.lead)
      agent.name = a.name.trim().slice(0, 40);
    agent.holding = {
      scope: parsed.scope,
      owned: agent.owned,
      // What existed when it claimed its part stays as it is (others rely on those names).
      seam: seamOf(doc, this.session.catalog),
    };
    this.syncLanes(turn);
    return {
      success: true,
      text: `Your scope: ${describeScope(parsed.scope)}. Edits outside it are refused; while you work, nobody else changes it.`,
    };
  }

  /** Why an edit is outside what this agent may change now (a sub-agent: its scope; anyone: not what another working agent holds). */
  private scopeCheck(
    turn: Turn,
    agent: Agent,
    before: Parameters<typeof outside>[0],
    after: Parameters<typeof outside>[1],
  ): string | null {
    if (agent !== turn.lead) {
      if (!agent.holding)
        return 'Say what you will change first: call kit_claim_scope with your scope, then edit.';
      const reasons = outside(before, after, this.session.catalog, agent.holding);
      if (reasons.length)
        return `It is outside your scope: ${reasons.join('; ')}. Your scope: ${describeScope(agent.holding.scope)}. Change only that; say what you need elsewhere in your report.`;
    }
    const others = this.agentsOf(turn).filter(
      a => a !== agent && a.status === 'working' && a.holding,
    );
    if (!others.length) return null;
    const reasons = heldByOthers(
      before,
      after,
      this.session.catalog,
      others.map(a => ({ name: a.name, holding: a.holding! })),
    );
    return reasons.length
      ? `It touches what another agent holds while it works: ${reasons.join('; ')}. Wait until it is done, or ask it.`
      : null;
  }

  private projectCheck(turn: Turn, agent: Agent): string | null {
    if (agent !== turn.lead && !agent.holding?.scope.project)
      return 'The screen project is not in your scope. Claim it with kit_claim_scope ("project": "all") if your part needs it.';
    const holder = this.agentsOf(turn).find(
      a => a !== agent && a.status === 'working' && a.holding?.scope.project,
    );
    return holder
      ? `The screen project is held by “${holder.name}” while it works. Wait until it is done.`
      : null;
  }

  // Edits are checked and rendered on their own workers, so the live work never waits for them.
  // The request's AI keeps its compiler between requests; a sub-agent's goes when it ends.
  private compilerFor(agent: Agent): CompileClient {
    let compiler = this.compilers.get(agent.id);
    if (!compiler) {
      compiler = new CompileClient({
        createWorker:
          this.options.createCompileWorker ?? (() => new CompilerWorker() as unknown as WorkerLike),
      });
      this.compilers.set(agent.id, compiler);
    }
    return compiler;
  }
  private checkRenderer(): RenderClient {
    this.renderer ??= new RenderClient({
      createWorker:
        this.options.createRenderWorker ??
        (() => new CompilerWorker() as unknown as RenderWorkerLike),
    });
    return this.renderer;
  }

  // ---- from the host -------------------------------------------------------------------
  private inbound(m: LlmInbound) {
    if (m.t === 'welcome') {
      // Back after a disconnect: a request the host no longer knows was lost (it restarted).
      const turn = this.turn;
      if (turn && !m.running.includes(turn.id)) {
        // What was being added to it runs as new requests.
        const steers = [...this.steering.values()];
        this.steering.clear();
        this.queue.unshift(
          ...steers.map(line => ({ ...line, message: 'waits for the running request…' })),
        );
        this.finish(turn, {
          kind: 'done',
          status: 'failed',
          error: { message: 'The AI bridge restarted and lost this request. Send it again.' },
          ms: 0,
        });
      }
      return;
    }
    const turn = this.turn;
    if (m.t === 'error') {
      const message = this.bridge.wording.failure({ message: m.message }).message;
      if (turn && m.ref === turn.id) this.update(turn, { note: message });
      return;
    }
    if (m.t === 'tool.call') {
      if (turn && m.id === turn.id) {
        const agent = m.agent ? this.subAgent(turn, m.agent) : turn.lead;
        void this.toolCall(turn, agent, m.callId, m.tool, m.args);
      }
      return;
    }
    const steer = this.steering.get(m.id);
    if (steer) {
      this.steerEvent(steer, m.event);
      return;
    }
    if (!turn || m.id !== turn.id) return;
    if (m.agent) this.agentEvent(turn, m.agent, m.event);
    else this.event(turn, turn.lead, m.event);
  }

  private steerEvent(line: Outcome, event: LlmEvent) {
    if (event.kind === 'steered') {
      this.steering.delete(line.id);
      this.requests.upsert({
        ...line,
        status: 'merged',
        live: false,
        message: '→ added to the running request',
      });
      if (this.turn) this.step(this.turn, this.turn.lead, `you added: “${line.text.slice(0, 60)}”`);
    } else if (event.kind === 'done') this.later(line);
  }

  private async toolCall(turn: Turn, agent: Agent, callId: string, tool: string, args: unknown) {
    let pending = agent.calls.get(callId);
    if (!pending) {
      pending = this.runTool(turn, agent, tool, args);
      agent.calls.set(callId, pending);
    }
    let output = await pending;
    // A picture too large for the bridge would lose the whole result: send the words without it.
    if (output.imageDataUrl && output.imageDataUrl.length > MAX_TOOL_IMAGE)
      output = {
        ...output,
        imageDataUrl: undefined,
        text: `${output.text}\n(The picture was too large to send.)`,
      };
    if (this.turn === turn) this.bridge.toolResult(turn.id, callId, output);
  }

  private async runTool(
    turn: Turn,
    agent: Agent,
    tool: string,
    args: unknown,
  ): Promise<ToolOutput> {
    agent.tools++;
    this.activity(turn, agent, TOOL_ACTIVITY[tool] ?? `${tool}…`);
    const before = agent.ws.steps.length;
    const output = await agent.ws.call(tool, args);
    if (this.turn !== turn) return output;
    const added = agent.ws.steps.slice(before);
    if (agent.ws.screenTouched && !turn.line.screen) this.update(turn, { screen: true });
    const step = added.length
      ? added.join(' · ')
      : (TOOL_DONE[tool] ?? (output.success ? '' : `${tool} failed`));
    if (tool === 'kit_finish' && agent === turn.lead && agent.ws.summary)
      this.update(turn, { label: agent.ws.summary });
    if (step) this.step(turn, agent, step);
    this.activity(turn, agent, 'thinking…');
    return output;
  }

  /** What the runtime says about a sub-agent. */
  private agentEvent(turn: Turn, id: string, event: LlmEvent) {
    if (event.kind === 'agent') {
      const agent = this.subAgent(turn, id, event.state === 'started' ? event.name : undefined);
      if (event.state === 'ended') this.agentEnded(turn, agent, event.status ?? 'completed');
      return;
    }
    this.event(turn, this.subAgent(turn, id), event);
  }

  private agentEnded(
    turn: Turn,
    agent: Agent,
    status: 'completed' | 'interrupted' | 'failed',
    error?: string,
  ) {
    if (agent.status !== 'working') return;
    agent.status =
      status === 'completed' ? 'done' : status === 'interrupted' ? 'stopped' : 'failed';
    agent.ended = performance.now();
    agent.activity = undefined;
    if (agent.status === 'failed') agent.error = error ?? 'It failed.';
    const seconds = ((agent.ended - agent.started) / 1000).toFixed(1);
    this.step(
      turn,
      turn.lead,
      `${agent.name} ${agent.status === 'done' ? 'finished' : agent.status === 'stopped' ? 'stopped' : 'failed'} (${seconds} s)`,
    );
    this.compilers.get(agent.id)?.dispose();
    this.compilers.delete(agent.id);
    this.bridge.telemetry({
      kind: 'llm-agent',
      request: turn.id,
      name: agent.name,
      status: agent.status,
      scope: agent.holding ? shortScope(agent.holding.scope) : undefined,
      startMs: Math.round(agent.started - turn.started),
      firstLandedMs:
        agent.firstLanded === null ? null : Math.round(agent.firstLanded - agent.started),
      ms: Math.round(agent.ended - agent.started),
      tools: agent.tools,
      landed: agent.ws.landed,
      refused: agent.ws.refused,
      tokens: agent.usage,
      error: agent.error,
    });
    this.syncLanes(turn);
  }

  private event(turn: Turn, agent: Agent, event: LlmEvent) {
    const lead = agent === turn.lead;
    switch (event.kind) {
      case 'thread':
        if (lead) {
          if (this.session.doc.value.id === turn.work) this.session.keepConversation(event.thread);
          if (event.fresh)
            this.step(
              turn,
              agent,
              'started a new conversation (the earlier one could not be opened)',
            );
        }
        return;
      case 'agent':
        return;
      case 'started':
        this.activity(turn, agent, 'thinking…');
        return;
      case 'delta':
        this.activity(turn, agent, 'responding…');
        agent.message += event.text;
        if (lead) this.update(turn, { reply: tail(agent.message) });
        return;
      case 'message':
        this.activity(turn, agent, 'responding…');
        if (lead) {
          agent.message = '';
          this.update(turn, { reply: tail(event.text) });
        } else {
          agent.message = event.text;
          this.syncLanes(turn);
        }
        return;
      case 'activity':
        if (event.what === 'thinking') this.activity(turn, agent, 'thinking…');
        else {
          const said = this.bridge.wording.activity(event.what, event.detail);
          if (said) this.step(turn, agent, said);
        }
        return;
      case 'retrying':
        this.activity(turn, agent, this.bridge.wording.retrying(event.message));
        return;
      case 'question':
        // Nobody is asked to choose: an empty answer, and the runtime decides itself.
        this.bridge.llmAnswer(turn.id, event.question, {});
        if (this.bridge.wording.skippedQuestion)
          this.step(turn, agent, this.bridge.wording.skippedQuestion);
        return;
      case 'usage':
        agent.usage = event.total;
        this.syncLanes(turn);
        return;
      case 'question.resolved':
      case 'steered':
        return;
      case 'done':
        if (lead) this.finish(turn, event);
        else this.agentEnded(turn, agent, event.status, event.error?.message);
        return;
    }
  }

  private finish(turn: Turn, done: Extract<LlmEvent, { kind: 'done' }>) {
    if (this.turn !== turn) return;
    // Sub-agents end with the request.
    for (const agent of turn.agents.values())
      if (agent.status === 'working')
        this.agentEnded(turn, agent, done.status === 'failed' ? 'failed' : 'interrupted');
    this.turn = null;
    this.busy.value = false;
    if (turn.stopTimer) clearTimeout(turn.stopTimer);
    for (const agent of turn.agents.values()) {
      this.compilers.get(agent.id)?.dispose();
      this.compilers.delete(agent.id);
    }
    const ms = Math.round(performance.now() - turn.started);
    const agents = this.agentsOf(turn);
    const landed = agents.some(a => a.ws.landed > 0);
    const steps = agents.flatMap(a => a.steps);
    const label = turn.lead.ws.summary ?? (landed ? describeSteps(steps) : undefined);
    // The screen project's changes of this request become one commit in the pod's git.
    if (agents.some(a => a.ws.projectTouched))
      void this.session.pod
        ?.commit(`den-kit AI: ${label ?? turn.line.text}`)
        .catch(() => undefined);
    const status = turn.stopping && done.status === 'completed' ? 'interrupted' : done.status;
    // The request is over: its marks go, unless it did nothing with them (then they are new marks for another try).
    this.session.releaseSent(turn.id, status !== 'completed' && !landed);
    this.syncLanes(turn);
    if (status === 'completed')
      this.close(turn, { status: landed ? 'applied' : 'reply', ms, label });
    else if (status === 'interrupted')
      this.close(turn, {
        status: 'stopped',
        ms,
        label: landed ? label : undefined,
        message: turn.stopNote ?? this.bridge.wording.stopped(done.error),
        note: landed ? KEPT : 'Nothing was changed.',
      });
    else {
      const failure = this.bridge.wording.failure(done.error);
      this.close(turn, {
        status: 'failed',
        ms,
        label: landed ? label : undefined,
        message: failure.message,
        fix: failure.fix,
        note: landed ? KEPT : undefined,
      });
    }
    this.next();
  }

  private close(turn: Turn, patch: Partial<Outcome>) {
    const agents = this.agentsOf(turn);
    const tokens = agents.reduce((n, a) => n + (a.usage?.total ?? 0), 0);
    const line: Outcome = {
      ...turn.line,
      live: false,
      activity: undefined,
      ...(tokens ? { tokens } : {}),
      ...patch,
    };
    turn.line = line;
    this.requests.upsert(line);
    const end = performance.now();
    const work = agents.reduce((n, a) => n + ((a.ended ?? end) - a.started), 0);
    this.bridge.telemetry({
      kind: 'llm',
      id: turn.id,
      text: line.text,
      status: line.status,
      ms: line.ms,
      tools: agents.reduce((n, a) => n + a.tools, 0),
      landed: agents.reduce((n, a) => n + a.ws.landed, 0),
      steps: line.steps,
      message: line.message,
      agents: turn.agents.size,
      firstChangeMs: turn.firstChange === null ? null : Math.round(turn.firstChange - turn.started),
      workMs: Math.round(work),
      parallelism: line.ms ? Math.round((work / line.ms) * 100) / 100 : null,
      tokens: tokens || null,
      leadTokens: turn.lead.usage,
    });
  }

  private step(turn: Turn, agent: Agent, text: string) {
    if (agent === turn.lead) {
      this.update(turn, { steps: [...(turn.line.steps ?? []), text].slice(-MAX_STEPS) });
      return;
    }
    agent.steps = [...agent.steps, text].slice(-MAX_AGENT_STEPS);
    this.syncLanes(turn);
  }

  private activity(turn: Turn, agent: Agent, text: string) {
    if (agent === turn.lead) {
      this.update(turn, { activity: text });
      return;
    }
    agent.activity = text;
    this.syncLanes(turn);
  }

  /** The sub-agents' lanes under the request line. */
  private syncLanes(turn: Turn) {
    if (!turn.agents.size) return;
    const now = performance.now();
    const agents: AgentLane[] = [...turn.agents.values()].map(a => ({
      id: a.id,
      name: a.name,
      color: a.color,
      status: a.status,
      activity: a.status === 'working' ? (a.activity ?? 'thinking…') : undefined,
      step: a.steps.at(-1),
      ms: Math.round((a.ended ?? now) - a.started),
      scope: a.holding ? shortScope(a.holding.scope) : '',
      tokens: a.usage?.total,
      message:
        a.status === 'failed'
          ? this.bridge.wording.failure(a.error === undefined ? undefined : { message: a.error })
              .message
          : a.message || undefined,
    }));
    this.update(turn, { agents });
  }

  private touch(agent: Agent, ids: string[]) {
    if (!ids.length) return;
    const now = performance.now();
    this.touches.value = [
      ...this.touches.value.filter(t => now - t.at < TOUCH_MS),
      { ids, color: agent.color, name: agent.name, at: now },
    ];
  }

  private update(turn: Turn, patch: Partial<Outcome>) {
    if (this.turn !== turn) return;
    turn.line = { ...turn.line, ...patch, ms: Math.round(performance.now() - turn.started) };
    this.requests.upsert(turn.line);
  }
}

const tail = (text: string) => (text.length > 700 ? `…${text.slice(-700)}` : text);
function describeSteps(steps: string[]): string {
  const edits = steps.filter(
    s =>
      !/^(read|looked|listened|skipped|you added|started|checking)/.test(s) &&
      !s.endsWith('not applied') &&
      !/ (finished|stopped|failed) \(\d/.test(s),
  );
  return edits.length ? edits.slice(-2).join(' · ').replace(/ ✓/g, '').slice(0, 120) : 'LLM edit';
}
