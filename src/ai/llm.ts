// The LLM request controller. A request goes to Codex through the bridge; Codex
// works on the live patch with the kit_* tools, which run here in the browser
// (src/ai/llm-workspace.ts). Each edit is tried on a copy first; one that
// validates and compiles lands at once, so the user sees and hears the request
// being built. The steps of one request undo together (one ⌘Z). The user keeps
// playing and editing meanwhile; an edit that no longer fits goes back to Codex.
//
// One request runs at a time. Another request sent while it works
// is steered into the running turn; follow-ups continue the same conversation
// (one per opened patch, shared with the request controller: each request tells Codex
// what happened since its last turn, and a new Codex conversation is told what
// came before). What the person attached (the selection) comes along by id.
// Esc stops it (what already landed stays, ⌘Z takes it back). Loading another
// patch, or undoing the request's edit while it runs, stops it too. Codex never
// gets to ask the user: questions are answered empty and it decides itself.
//
// A team (U8): the AI that takes the request leads it and may hand parts to
// members (kit_delegate) — other Codex conversations with the same model and
// tools that work at the same time, each in a scope den-kit holds it to
// (src/ai/scope.ts). Members get the lead's brief plus what den-kit knows (the
// person's own words, the recent conversation, the state of their scope;
// src/ai/members.ts), land their edits in the same request (one ⌘Z for all),
// show as lanes under the request, and report back (kit_wait). If the lead ends
// its turn while members work, den-kit gives it another turn with their reports
// once they finish. Esc stops everyone; a lane's × stops one member.
import { reactive, ref, shallowRef, watch } from 'vue';
import type { KitSession } from '../editor/session.ts';
import { randomId } from '../core/schema.ts';
import type { Intent } from '../core/ops.ts';
import { CompileClient, CompileFailure, compileInputs, type WorkerLike } from '../compile/compile-client.ts';
import { RenderClient, type RenderWorkerLike } from '../compile/render-client.ts';
import type { BridgeClient, LlmInbound } from './bridge-client.ts';
import type { AgentLane, AiRequests, Outcome } from './requests.ts';
import { developerInstructions } from './llm-spec.ts';
import { LlmWorkspace, type Team, type WorkspaceDeps } from './llm-workspace.ts';
import { handEdits } from './plugin-tools.ts';
import { describeAttachments, type Attachment } from './attachments.ts';
import { RECAP_LINES, handEditsSince, lineForAi } from './conversation.ts';
import { viewPicture } from '../plugin/picture.ts';
import { SHOWCASE_ASSETS } from '../showcase/assets.ts';
import { changes, describeScope, heldByMembers, made, outside, scopesOverlap, seamOf, shortScope, touched, type Holding, type Seam } from './scope.ts';
import { MAX_MEMBERS, MEMBER_COLORS, MEMBER_CONTEXTS, conversationAccount, integrationText, memberReportText, memberText, parseBriefs, scopeState, seamText, type Brief, type MemberContext, type MemberState } from './members.ts';
import { MAX_LLM_IMAGES, MAX_TOOL_IMAGE, type LlmEvent, type LlmRole, type TokenUsage, type ToolOutput } from './protocol.ts';
import { seeingText } from './seeing.ts';
import { desktop } from '../desktop/api.ts';
import { aiFailure, aiUnavailable } from './user-errors.ts';
import { markNumber, type SentSketch, type SketchPart } from './sketch.ts';
import type { Scope } from './scope.ts';
import CompilerWorker from '../compile/compiler.worker.ts?worker';

export type LlmTransport = Pick<BridgeClient, 'llmStart' | 'llmSteer' | 'llmStop' | 'llmAnswer' | 'llmForget' | 'toolResult' | 'onLlm' | 'telemetry' | 'status' | 'codexReady' | 'online'>;

export interface LlmOptions {
  /** Replace workspace dependencies (tests). */
  deps?: Partial<WorkspaceDeps>;
  createCompileWorker?: () => WorkerLike;
  createRenderWorker?: () => RenderWorkerLike;
  /** After Esc, how long to wait for Codex to confirm before ending the request here. */
  stopGraceMs?: number;
  /** Where the settings are kept (tests pass null: not kept). */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

/**
 * Members (U8): "auto" lets the AI that takes a request start members when it
 * judges the work splits; "off" keeps every request to one AI (to compare).
 * memberContext "lead" lets the lead choose how much each member is told; a
 * fixed value overrides it (to compare brief, full and bare).
 */
export interface LlmSettings { members: 'auto' | 'off'; memberContext: 'lead' | MemberContext }
const SETTINGS_KEY = 'den-kit:llm-settings';
function readSettings(storage: Pick<Storage, 'getItem'> | null): LlmSettings {
  const settings: LlmSettings = { members: 'auto', memberContext: 'lead' };
  try {
    const saved = JSON.parse(storage?.getItem(SETTINGS_KEY) ?? 'null') as Partial<LlmSettings> | null;
    if (saved?.members === 'off' || saved?.members === 'auto') settings.members = saved.members;
    if (saved?.memberContext === 'lead' || MEMBER_CONTEXTS.includes(saved?.memberContext as MemberContext)) settings.memberContext = saved!.memberContext!;
  } catch { /* defaults */ }
  return settings;
}
const browserStorage = (): Storage | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

/** What an AI just changed: the views outline it in the AI's colour for a moment. */
export interface Touch { ids: string[]; color: string; name: string; at: number }
export const TOUCH_MS = 2000;

type AgentStatus = AgentLane['status'];
interface Agent {
  /** "lead", "m1", "m2"… */
  id: string;
  /** The bridge request id of its running turn (the lead gets a new one for each of its turns). */
  key: string;
  role: LlmRole;
  name: string;
  color: string;
  ws: LlmWorkspace;
  calls: Map<string, Promise<ToolOutput>>;
  started: number;
  firstLanded: number | null;
  ended: number | null;
  status: AgentStatus;
  stopping: boolean;
  stopTimer: ReturnType<typeof setTimeout> | null;
  stoppedBy?: 'person' | 'lead';
  message: string;
  activity?: string;
  steps: string[];
  tools: number;
  thread: string | null;
  usage: TokenUsage | null;
  /** What it made: always its own to change. */
  owned: Set<string>;
  // ---- members ----
  brief?: Brief;
  holding?: Holding;
  error?: string;
  forked?: boolean;
  textChars?: number;
  /** Its report reached the lead (kit_wait or the lead's next turn). */
  reported?: boolean;
}

interface Turn {
  /** The request's id (its line in the history; the lead's first turn). */
  id: string;
  line: Outcome;
  started: number;
  epoch: number;
  /** The conversation it belongs to (session.conversation). */
  conversation: string;
  lead: Agent;
  members: Agent[];
  /** Every agent by the bridge request id of each of its turns. */
  byKey: Map<string, Agent>;
  /** What members keep (set when the first members start). */
  seam: Seam | null;
  /** A lead waiting for members (kit_wait). */
  waiting: Array<{ ids: string[]; resolve: (why: WakeReason) => void; timer: ReturnType<typeof setTimeout> }>;
  /** The lead's turn ended while members worked: it gets another turn when they finish. */
  leadEnded: Extract<LlmEvent, { kind: 'done' }> | null;
  /** What the person added while the lead's turn was over (goes to its next turn), and the pictures of sketches among it. */
  additions: string[];
  additionImages: string[];
  /** The person's sketches in this request (U8c): with the request and what they added while it ran. */
  sketch: SketchPart[];
  /** The person's words in this request: the first, then what they added. */
  words: string[];
  integrations: number;
  stopping: boolean;
  stopTimer: ReturnType<typeof setTimeout> | null;
  /** Why it was stopped by something other than Esc. */
  stopNote?: string;
  firstChange: number | null;
}
type WakeReason = 'done' | 'timeout' | 'steer' | 'stopped';

const MAX_STEPS = 12;
const MAX_MEMBER_STEPS = 30;
/** Turns the lead gets after its members finish while its own turn was over. */
const MAX_INTEGRATIONS = 3;
const WAIT_MS = 60_000;
const TOOL_ACTIVITY: Record<string, string> = {
  kit_get_patch: 'reading the patch…', kit_list_blocks: 'looking up modules…', kit_describe_block: 'looking up a module…',
  kit_apply_ops: 'editing…', kit_write_codebox: 'writing code…', kit_listen: 'listening…', kit_finish: 'finishing…', kit_bash: 'running a command…', kit_read_file: 'reading a file…', kit_write_file: 'writing a file…',
  kit_get_plugin: 'reading the plugin screen…', kit_ui_reference: 'looking up how screens are built…', kit_look: 'looking at the screen…', kit_view_picture: 'looking at a picture…',
  kit_delegate: 'starting members…', kit_wait: 'waiting for members…', kit_tell: 'telling a member…', kit_stop_member: 'stopping a member…',
};
const TOOL_DONE: Record<string, string> = { kit_get_patch: 'read the patch', kit_list_blocks: 'looked up modules', kit_describe_block: 'looked up a module', kit_get_plugin: 'read the plugin screen', kit_ui_reference: 'looked up the screen reference', kit_read_file: 'read a file', kit_wait: '', kit_tell: '' };
const KEPT = 'What it already changed stays; ⌘Z takes it back.';

/** Pictures that go with a message (at most MAX_LLM_IMAGES). */
const pictures = (images: readonly string[]): { images?: string[] } => images.length ? { images: images.slice(0, MAX_LLM_IMAGES) } : {};
/** The pictures of sketches. */
const imagesOf = (parts: readonly SketchPart[] | undefined) => pictures((parts ?? []).flatMap(p => p.image ? [p.image] : []));
/** Sketches in words, one [den-kit] block per view. */
const sketchLines = (parts: readonly SketchPart[] | undefined) => (parts ?? []).filter(p => p.text).map(p => `\n[den-kit] ${p.text}`).join('');
/** The sketches a member gets: those on what its scope holds (the plugin: the screen; the patch: the sound). */
const sketchesFor = (parts: readonly SketchPart[], scope: Scope) => parts.filter(p => p.view === 'plugin' ? !!scope.screen : !!scope.sound);
/** Only the marks with these numbers (and the line that says where they are). */
function onlyMarks(part: SketchPart, numbers: readonly number[]): SketchPart {
  if (!part.text) return part;
  const wanted = new Set(numbers.map(markNumber));
  const [head, ...lines] = part.text.split('\n');
  return { ...part, text: [head, ...lines.filter(l => wanted.has([...l][0] ?? ''))].join('\n') };
}

export class LlmController {
  /** A request is running (Esc stops it). */
  readonly busy = ref(false);
  readonly settings: LlmSettings;
  /** What the AIs of the running request just changed (newest last). */
  readonly touches = shallowRef<Touch[]>([]);
  private turn: Turn | null = null;
  /** Requests waiting for the running request to end (a steer that came too late). */
  private queue: Outcome[] = [];
  private steering = new Map<string, Outcome>();
  /** The lead's additions to a member (kit_tell), by their bridge id. */
  private tells = new Map<string, Agent>();
  private tellSerial = 0;
  private thread: string | null = null;
  /** The conversation (session.conversation) the Codex thread belongs to; a patch someone opens starts a new one. */
  private threadConversation: string | null = null;
  /** The role the conversation was started with (its tools). */
  private threadRole: LlmRole | null = null;
  /** The last request the LLM itself took in this conversation, and when its turn started (for "since your last turn"). */
  private lastLine: string | null = null;
  private lastStarted = 0;
  /** Each AI checks its edits on its own compiler (the lead's is kept between requests). */
  private compilers = new Map<string, CompileClient>();
  private renderer: RenderClient | null = null;
  readonly session: KitSession;
  private readonly requests: AiRequests;
  private readonly bridge: LlmTransport;
  private readonly options: LlmOptions;
  private readonly stopWatching: Array<() => void> = [];

  constructor(session: KitSession, requests: AiRequests, bridge: LlmTransport, options: LlmOptions = {}) {
    this.session = session;
    this.requests = requests;
    this.bridge = bridge;
    this.options = options;
    const storage = options.storage === undefined ? browserStorage() : options.storage;
    this.settings = reactive(readSettings(storage));
    bridge.onLlm(m => this.inbound(m));
    // Another patch was loaded: the request was about the old one.
    this.stopWatching.push(watch(() => session.loadEpoch.value, () => { if (this.turn) this.stop('A different patch was loaded, so it stopped.'); }, { flush: 'sync' }));
    // ⌘Z on what the running request just did: the user does not want it to go on.
    this.stopWatching.push(session.onHistory((kind, tx) => {
      if (kind === 'undo' && tx.author.kind === 'ai-llm' && this.turn && tx.author.take === this.turn.id) this.stop('You undid its edit, so it stopped.');
    }));
    // Members on or off changes the tools: the next request starts a new conversation.
    this.stopWatching.push(watch(() => this.settings.members, () => { if (!this.turn) this.reset(); }));
    this.stopWatching.push(watch(() => ({ ...this.settings }), value => { try { storage?.setItem(SETTINGS_KEY, JSON.stringify(value)); } catch { /* not kept */ } }));
  }

  get ready() { return this.bridge.codexReady; }
  get off() { const c = this.bridge.status.value?.codex; return !this.bridge.online || !c || c.state === 'off'; }
  get running() { return this.turn !== null; }

  /** Why the LLM cannot take a request right now. */
  reason(): string {
    if (desktop()) return aiUnavailable(this.bridge.online, this.bridge.status.value?.codex.state);
    if (!this.bridge.online) return 'The LLM is not available: the AI bridge is not connected.';
    const c = this.bridge.status.value?.codex;
    if (!c || c.state === 'off') return `The LLM is off${c?.detail ? `: ${c.detail}` : '.'}`;
    if (c.state === 'login') return `The LLM is not available: Codex is not signed in. ${c.fix ?? 'Run `npm run codex:login`.'}`;
    if (c.state === 'starting') return 'The LLM is still starting; try again in a moment.';
    return `The LLM is not available: ${c.detail ?? 'Codex reported an error'}.${c.fix ? ` ${c.fix}` : ''}`;
  }

  /** Send a request with its attachments. Always returns its history line. */
  run(text: string, options: { via?: 'typed' | 'voice'; attached?: Attachment[]; /** The person's rough sketch (U8c). */ sketch?: SentSketch } = {}): Outcome {
    const line: Outcome = { id: randomId('rq'), text: text.trim().slice(0, 600), via: options.via, status: 'thinking', route: 'llm', ms: 0, attached: options.attached?.length ? options.attached : undefined, where: this.requests.where(), ...(options.sketch ? { sketch: options.sketch } : {}) };
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
    if (this.turn) { const waiting = { ...line, status: 'thinking' as const, route: 'llm' as const, live: true, message: 'waits for the running request to stop…' }; this.queue.push(waiting); this.requests.upsert(waiting); return waiting; }
    return this.start(line);
  }

  /** Esc: stop the running request, members included; what already landed stays (⌘Z takes it back). */
  stop(note?: string): boolean {
    const turn = this.turn;
    if (!turn || turn.stopping) return false;
    turn.stopping = true;
    turn.stopNote = note;
    this.update(turn, { activity: 'stopping…' });
    this.wake(turn, 'stopped');
    const working = this.agents(turn).filter(a => a.status === 'working' && !(a === turn.lead && turn.leadEnded));
    if (!this.bridge.online) { this.finish(turn, { kind: 'done', status: 'interrupted', ms: 0 }); return true; }
    for (const agent of working) {
      agent.stopping = true;
      if (!this.bridge.llmStop(agent.key)) { this.finish(turn, { kind: 'done', status: 'interrupted', ms: 0 }); return true; }
    }
    turn.stopTimer = setTimeout(() => { if (this.turn === turn) this.finish(turn, { kind: 'done', status: 'interrupted', ms: 0 }); }, this.options.stopGraceMs ?? 15000);
    return true;
  }

  /** The person stops one member (its lane's ×); the lead hears that the person stopped it. */
  stopMember(id: string): boolean {
    const turn = this.turn;
    const member = turn?.members.find(m => m.id === id);
    if (!turn || !member || member.status !== 'working' || member.stopping) return false;
    this.haltMember(turn, member, 'person');
    return true;
  }

  /** Forget the conversation (the next request starts a new one). */
  reset() {
    if (this.thread) this.bridge.llmForget(this.thread);
    this.thread = null; this.threadConversation = null; this.threadRole = null;
    this.lastLine = null; this.lastStarted = 0;
  }

  dispose() {
    for (const stop of this.stopWatching) stop();
    for (const c of this.compilers.values()) c.dispose();
    this.compilers.clear();
    this.renderer?.dispose(); this.renderer = null;
  }

  // ---- turns ----------------------------------------------------------------------------
  private role(): LlmRole { return this.settings.members === 'off' ? 'solo' : 'lead'; }
  private agents(turn: Turn): Agent[] { return [turn.lead, ...turn.members]; }

  private start(line: Outcome): Outcome {
    if (this.threadConversation !== null && this.threadConversation !== this.session.conversation.value) this.reset();
    const role = this.role();
    if (this.thread && this.threadRole !== role) this.reset();
    const started = performance.now();
    const turn = {
      id: line.id, started, epoch: this.session.loadEpoch.value, conversation: this.session.conversation.value,
      line: { ...line, status: 'thinking', route: 'llm', live: true, steps: [], activity: 'starting…', message: undefined },
      members: [], byKey: new Map(), seam: null, waiting: [], leadEnded: null, additions: [], additionImages: [], sketch: [...(line.sketch?.parts ?? [])], words: [line.text], integrations: 0,
      stopping: false, stopTimer: null, firstChange: null,
    } as unknown as Turn;
    turn.lead = this.makeAgent(turn, { id: 'lead', key: line.id, role, name: 'Lead', color: 'var(--accent)' });
    this.turn = turn;
    this.busy.value = true;
    this.requests.upsert(turn.line);
    // Instructions are sent every time: a bridge that lost the conversation starts a new one with them.
    const text = this.compose(line.text, false, line);
    this.lastLine = line.id;
    this.lastStarted = Date.now();
    if (!this.bridge.llmStart(turn.lead.key, text, developerInstructions(this.blocks(), role), this.thread ?? undefined, { role, ...imagesOf(line.sketch?.parts) })) {
      this.finish(turn, { kind: 'done', status: 'failed', error: { message: 'The AI bridge is not connected.' }, ms: 0 });
    }
    return turn.line;
  }

  private makeAgent(turn: Turn, spec: { id: string; key: string; role: LlmRole; name: string; color: string }): Agent {
    const agent = {
      ...spec, calls: new Map(), started: performance.now(), firstLanded: null, ended: null, status: 'working', stopping: false, stopTimer: null,
      message: '', steps: [], tools: 0, thread: null, usage: null, owned: new Set<string>(),
    } as unknown as Agent;
    agent.ws = new LlmWorkspace(this.deps(turn, agent));
    turn.byKey.set(agent.key, agent);
    return agent;
  }

  private steer(line: Outcome): Outcome {
    const turn = this.turn!;
    turn.words.push(line.text);
    // A sketch added to the running request stays (dimmed) until the request ends.
    if (line.sketch?.parts.length) {
      turn.sketch.push(...line.sketch.parts);
      if (line.sketch.ids?.length) this.session.markSent(line.sketch.ids, turn.id);
    }
    if (turn.leadEnded) {
      // The lead's turn is over while its members work: what the person adds goes to its next turn.
      this.addition(turn, line);
      const merged: Outcome = { ...line, status: 'merged', route: 'llm', live: false, message: '→ added to the running request' };
      this.requests.upsert(merged);
      this.step(turn, turn.lead, `you added: “${line.text.slice(0, 60)}”`);
      return merged;
    }
    const steer: Outcome = { ...line, status: 'thinking', route: 'llm', live: true, message: 'adding this to the running request…' };
    this.steering.set(steer.id, steer);
    this.requests.upsert(steer);
    this.wake(turn, 'steer'); // a lead waiting for its members reads it at once
    if (!this.bridge.llmSteer(steer.id, turn.lead.key, this.compose(line.text, true, line), imagesOf(line.sketch?.parts).images)) this.later(steer);
    return steer;
  }

  /** What the person said while the lead's turn was over: for its next turn (with the sketch, if any). */
  private addition(turn: Turn, line: Outcome) {
    const sketch = line.sketch?.parts.map(p => p.text).filter(Boolean).join('\n') ?? '';
    turn.additions.push(sketch ? `${line.text}\n${sketch}` : line.text);
    turn.additionImages.push(...(imagesOf(line.sketch?.parts).images ?? []));
  }

  /** Run after the current request (a steer that arrived as it ended). */
  private later(line: Outcome) {
    this.steering.delete(line.id);
    if (line.sketch?.ids?.length) this.session.markSent(line.sketch.ids, line.id);
    const waiting: Outcome = { ...line, status: 'thinking', live: true, message: 'waits for the running request…' };
    this.queue.push(waiting);
    this.requests.upsert(waiting);
    if (!this.turn) this.next();
  }

  private next() {
    const line = this.queue.shift();
    if (!line) return;
    if (!this.ready) { this.session.releaseSent(line.id, true); this.requests.upsert({ ...line, status: 'failed', live: false, message: this.reason() }); this.next(); return; }
    this.start(line);
  }

  /** The request text with what Codex should know about the moment it was made. */
  private compose(text: string, steering: boolean, line: Outcome): string {
    const attached = line.attached?.length ? `\n[den-kit] The person attached (points at) these: ${describeAttachments(line.attached)}. The request is about them: change these unless they clearly ask for something new.` : '';
    const where = `${line.where ? `\n[den-kit] ${this.whereText(line)}` : ''}\n[den-kit] ${this.seeingLine()}${sketchLines(line.sketch?.parts)}`;
    if (steering) return `[den-kit] The user adds, while you work:${attached}${where}\n\n${text}`;
    const parts = [`[den-kit] You edit the live patch; each edit that checks out lands at once${this.thread ? '. It may have changed since your last turn, so read it again' : ''}.`];
    // What happened that this conversation's LLM has not seen: the whole recent story for a new conversation,
    // otherwise the requests after its last one (the request controller handled them) and the person's own edits.
    // (Lines added to a running request were seen by it; a line still working has no result yet.)
    const lines = this.requests.history.value.filter(o => o.id !== line.id);
    const at = this.thread && this.lastLine ? lines.findIndex(o => o.id === this.lastLine) : -1;
    const unseen = (at >= 0 ? lines.slice(at + 1) : lines.slice(-RECAP_LINES)).filter(o => o.status !== 'working' && o.status !== 'merged');
    if (unseen.length) parts.push(`[den-kit] ${this.thread ? 'Since your last turn' : 'Earlier in this conversation (you were not there; this is what happened)'}:\n${unseen.map(lineForAi).join('\n')}`);
    // Edits made while it worked count too: it may not have looked at them.
    const hand = handEditsSince(this.session.history.entries(), this.thread ? this.lastStarted : 0);
    if (hand) parts.push(`[den-kit] The person edited by hand${this.thread ? ' since your last turn' : ''}: ${hand}.`);
    return `${parts.join('\n')}${attached}${where}\n\n${text}`;
  }

  /** What the person is looking at now, in one line. */
  private seeingLine(): string {
    const s = this.session;
    return seeingText(s.seeingNow(), s.doc.value, s.catalog, { selection: s.selection.value, held: s.heldNotes.value, inside: s.scope.value, shared: !!s.screen.source });
  }

  private whereText(line: Outcome): string {
    const w = line.where!;
    return `The person is inside part "${w.name}" (part ${w.part}, entered through ${w.path.join(' › ')}). The request is about this part unless they clearly say otherwise: add modules with "inside": "${w.part}", show knobs on it with addParam; the parameters of the use they came through are set on ${w.path.at(-1)}. An edit inside changes every use of the part.`;
  }

  private blocks(): string {
    // Not what expansion makes (sums of copies and the like): only what can be placed.
    return this.session.catalog.list().filter(d => d.kind !== 'comment' && (d.palette !== 'never' || d.kind === 'part')).map(d => `${d.type} — ${d.title} (${d.category}): ${d.summary}`).join('\n');
  }

  /** What the workspace of `agent` may do; landing works only while its request runs, on the patch it started on. */
  private deps(turn: Turn, agent: Agent): WorkspaceDeps {
    return {
      catalog: this.session.catalog,
      images: !!this.bridge.status.value?.codex.images,
      read: () => this.session.doc.value,
      myParts: () => this.session.myParts.value,
      role: agent.role,
      land: (intents, label) => this.land(turn, agent, intents, label),
      compile: async (generated, doc) => {
        try {
          const artifact = await this.compilerFor(agent).compile(generated, compileInputs(doc, generated));
          this.session.compiler.prime(artifact); // the live patch then swaps it in without compiling again
          return { ok: true, ms: artifact.compileMs };
        } catch (error) {
          if (error instanceof CompileFailure) return { ok: false, message: error.message, issues: error.issues };
          return { ok: false, message: error instanceof Error ? error.message : String(error), issues: [] };
        }
      },
      render: request => this.checkRenderer().render(request),
      look: (doc, picture) => this.session.look({ doc, picture }),
      viewPicture: async id => {
        const asset = this.session.doc.value.assets[id] ?? SHOWCASE_ASSETS[id];
        const url = this.session.assetUrls.value[id] ?? asset?.url;
        if (!url) return null;
        try { return await viewPicture(url); } catch { return null; }
      },
      handEdits: () => handEdits(this.session.history.entries(), this.session.doc.value, this.session.catalog),
      pod: this.session.pod?.access(),
      scope: (before, after) => this.scopeCheck(turn, agent, before, after),
      project: () => this.projectCheck(turn, agent),
      team: agent.role === 'lead' ? this.teamOf(turn) : undefined,
      seen: async view => {
        const s = this.session;
        const seeing = s.seeingNow();
        const looking = seeing.view === 'plugin' ? 'plugin' : seeing.view === 'patch' ? 'patch' : 'other';
        const text = this.seeingLine();
        if (!s.screen.source) return { text, looking, reason: 'The person has not shared their screen with you (they can, in the AI panel).' };
        const which = view ?? (looking === 'other' ? 'window' : looking);
        if (which !== 'window' && which !== looking) return { text, looking, reason: `The person is not looking at the ${which} now, so it is not on their screen.` };
        const rect = s.viewRect(which === 'window' ? 'window' : which);
        if (!rect) return { text, looking, reason: `The ${which} is not on the screen now.` };
        try { return { text, looking, picture: await s.screen.picture(rect, 1280) }; }
        catch (error) { return { text, looking, reason: `The picture could not be taken (${error instanceof Error ? error.message : String(error)}).` }; }
      },
      ...this.options.deps,
    };
  }

  private land(turn: Turn, agent: Agent, intents: Intent[], label: string): { ok: true } | { ok: false; message: string } {
    if (this.turn !== turn || turn.stopping || agent.stopping || agent.status !== 'working') return { ok: false, message: 'This request was stopped.' };
    if (this.session.loadEpoch.value !== turn.epoch) return { ok: false, message: 'A different patch was loaded.' };
    const before = this.session.doc.value;
    const r = this.session.commit(intents, { author: { kind: 'ai-llm', take: turn.id, trace: agent.id === 'lead' ? turn.id : agent.key }, label: `AI: ${label}`, group: turn.id });
    if (!r.ok) return { ok: false, message: `${r.error.message}${r.error.hint ? ` ${r.error.hint}` : ''} (the user may have changed the patch meanwhile).` };
    if (r.ops.length) {
      if (!turn.line.txId) this.update(turn, { txId: this.session.history.peek()?.id });
      const now = performance.now();
      agent.firstLanded ??= now;
      turn.firstChange ??= now;
      const list = changes(before, this.session.doc.value, this.session.catalog);
      for (const id of [...r.created, ...made(list)]) agent.owned.add(id);
      if (turn.members.length) this.touch(agent, touched(list));
    }
    return { ok: true };
  }

  /** Why an edit is outside what this AI may change now (a member: its scope; the lead: not what members hold). */
  private scopeCheck(turn: Turn, agent: Agent, before: Parameters<typeof outside>[0], after: Parameters<typeof outside>[1]): string | null {
    if (agent.role === 'member') {
      if (!agent.holding) return null;
      const reasons = outside(before, after, this.session.catalog, agent.holding);
      return reasons.length ? `It is outside your scope: ${reasons.join('; ')}. Your scope: ${describeScope(agent.holding.scope)}. Change only that; put what you need elsewhere in kit_finish "needs" (the lead adds it).` : null;
    }
    const working = turn.members.filter(m => m.status === 'working' && m.holding);
    if (!working.length) return null;
    const reasons = heldByMembers(before, after, this.session.catalog, working.map(m => ({ id: m.id, name: m.name, holding: m.holding! })));
    return reasons.length ? `It touches what a member holds: ${reasons.join('; ')}. Wait for it (kit_wait), tell it (kit_tell) or stop it (kit_stop_member) first.` : null;
  }

  private projectCheck(turn: Turn, agent: Agent): string | null {
    if (agent.role === 'member') return agent.holding?.scope.project ? null : 'The screen project is not in your scope. If your part needs it, say so in kit_finish "needs" (the lead takes care of it).';
    const holder = turn.members.find(m => m.status === 'working' && m.holding?.scope.project);
    return holder ? `The screen project is held by ${holder.id} “${holder.name}” while it works. Wait for it (kit_wait) or tell it what you need (kit_tell).` : null;
  }

  // Edits are checked and rendered on their own workers, so the live patch never waits for them.
  private compilerFor(agent: Agent): CompileClient {
    let compiler = this.compilers.get(agent.id);
    if (!compiler) {
      compiler = new CompileClient({ createWorker: this.options.createCompileWorker ?? (() => new CompilerWorker() as unknown as WorkerLike) });
      this.compilers.set(agent.id, compiler);
    }
    return compiler;
  }
  private checkRenderer(): RenderClient {
    this.renderer ??= new RenderClient({ createWorker: this.options.createRenderWorker ?? (() => new CompilerWorker() as unknown as RenderWorkerLike) });
    return this.renderer;
  }

  // ---- the team ------------------------------------------------------------------------------
  private teamOf(turn: Turn): Team {
    return {
      delegate: args => this.delegate(turn, args),
      wait: args => this.wait(turn, args),
      tell: args => this.tell(turn, args),
      stop: args => this.stopMemberTool(turn, args),
      working: () => turn.members.filter(m => m.status === 'working').map(m => `${m.id} “${m.name}”`),
    };
  }

  private delegate(turn: Turn, args: unknown): ToolOutput {
    if (this.turn !== turn || turn.stopping) return { success: false, text: 'This request was stopped.' };
    const doc = this.session.doc.value;
    const parsed = parseBriefs(args, doc, this.settings.memberContext === 'lead' ? undefined : this.settings.memberContext);
    if ('error' in parsed) return { success: false, text: parsed.error };
    const working = turn.members.filter(m => m.status === 'working');
    if (working.length + parsed.briefs.length > MAX_MEMBERS) return { success: false, text: `At most ${MAX_MEMBERS} members work at once (${working.length} working now: ${working.map(m => `${m.id} “${m.name}”`).join(', ')}). Wait for one, or give fewer.` };
    const holders = [...working.map(m => ({ name: `${m.id} “${m.name}”`, scope: m.holding!.scope })), ...parsed.briefs.map(b => ({ name: `“${b.name}”`, scope: b.scope }))];
    for (let i = 0; i < holders.length; i++) for (let j = Math.max(i + 1, working.length); j < holders.length; j++) {
      const why = scopesOverlap(holders[i]!.scope, holders[j]!.scope, doc);
      if (why) return { success: false, text: `The scopes of ${holders[i]!.name} and ${holders[j]!.name} overlap (${why}). Give each its own part; nothing was started.` };
    }
    turn.seam ??= seamOf(doc, this.session.catalog);
    const seam = seamText(doc, this.session.catalog, turn.seam);
    const recent = this.requests.history.value.filter(o => o.id !== turn.id && o.status !== 'working' && o.status !== 'merged' && o.status !== 'thinking');
    const started: string[] = [];
    // All of them first, so each knows who else works meanwhile.
    const fresh = parsed.briefs.map(brief => {
      const n = turn.members.length + 1;
      const id = `m${n}`;
      const member = this.makeAgent(turn, { id, key: `${turn.id}~${id}`, role: 'member', name: brief.name, color: MEMBER_COLORS[(n - 1) % MEMBER_COLORS.length]! });
      member.brief = brief;
      member.holding = { scope: brief.scope, owned: member.owned, seam: turn.seam! };
      turn.members.push(member);
      return member;
    });
    for (const member of fresh) {
      const brief = member.brief!, id = member.id;
      const others = turn.members.filter(m => m !== member && m.status === 'working').map(m => ({ id: m.id, name: m.name, scope: m.holding!.scope }));
      // The person's sketches on what the member holds go with it (words and pictures), unless it gets only its brief.
      const sketches = brief.context === 'bare' ? [] : sketchesFor(turn.sketch, brief.scope);
      const text = memberText({
        id, brief, others, words: turn.words, recent: recent.slice(-RECAP_LINES).map(lineForAi),
        attached: turn.line.attached?.length ? describeAttachments(turn.line.attached) : undefined,
        where: turn.line.where ? this.whereText(turn.line) : undefined,
        sketch: sketches.length ? sketches.map(p => p.text).filter(Boolean).join('\n') : undefined,
        designBrief: doc.ui.brief, seam, state: scopeState(doc, this.session.catalog, brief.scope), seeing: this.seeingLine(),
      });
      member.textChars = text.length;
      const fork = brief.context === 'full' ? { thread: this.thread ?? '', fallback: conversationAccount(recent.map(lineForAi), { steps: turn.lead.steps, message: turn.lead.message }) } : undefined;
      if (!this.bridge.llmStart(member.key, text, developerInstructions(this.blocks(), 'member'), undefined, { role: 'member', fork, ...imagesOf(sketches) })) {
        this.memberEnded(turn, member, { kind: 'done', status: 'failed', error: { message: 'The AI bridge is not connected.' }, ms: 0 });
        continue;
      }
      started.push(`${id} “${brief.name}” (${describeScope(brief.scope)}; context ${brief.context})`);
    }
    if (started.length) this.step(turn, turn.lead, `members: ${parsed.briefs.map(b => b.name).join(', ')}`);
    this.syncLanes(turn);
    if (!started.length) return { success: false, text: 'No member could be started (the AI bridge is not connected).' };
    return { success: true, text: `Started: ${started.join('; ')}. They work now, each in its own scope (yours is the rest). Do your own part outside their scopes, or call kit_wait.` };
  }

  private async wait(turn: Turn, args: unknown): Promise<ToolOutput> {
    const a = (args && typeof args === 'object' ? args : {}) as { members?: unknown; timeout_s?: unknown };
    let ids = Array.isArray(a.members) ? a.members.filter((v): v is string => typeof v === 'string') : turn.members.filter(m => m.status === 'working').map(m => m.id);
    const unknown = ids.filter(id => !turn.members.some(m => m.id === id));
    if (unknown.length) return { success: false, text: `No member ${unknown.join(', ')}. Members: ${turn.members.map(m => `${m.id} “${m.name}”`).join(', ') || 'none (start them with kit_delegate)'}.` };
    if (!ids.length) ids = turn.members.filter(m => !m.reported).map(m => m.id);
    if (!ids.length) return { success: false, text: turn.members.length ? 'Every member has finished and reported already.' : 'There are no members. Start them with kit_delegate.' };
    const seconds = typeof a.timeout_s === 'number' && Number.isFinite(a.timeout_s) ? Math.min(60, Math.max(5, a.timeout_s)) : WAIT_MS / 1000;
    const pending = () => ids.filter(id => turn.members.find(m => m.id === id)?.status === 'working');
    let why: WakeReason = 'done';
    if (pending().length && this.turn === turn && !turn.stopping) {
      why = await new Promise<WakeReason>(resolve => {
        const waiter = { ids, resolve: (reason: WakeReason) => { clearTimeout(waiter.timer); turn.waiting = turn.waiting.filter(w => w !== waiter); resolve(reason); }, timer: setTimeout(() => waiter.resolve('timeout'), seconds * 1000) };
        turn.waiting.push(waiter);
      });
    }
    if (this.turn !== turn || why === 'stopped') return { success: false, text: 'This request was stopped.' };
    const members = ids.map(id => turn.members.find(m => m.id === id)!);
    for (const m of members) if (m.status !== 'working') m.reported = true;
    const still = pending();
    const head = why === 'steer' ? 'The person added something to the request (you will see it next). ' : why === 'timeout' ? `Still waiting after ${seconds} s. ` : '';
    const tail = still.length ? `\nStill working: ${still.join(', ')}. Call kit_wait again, or do your own part meanwhile.` : '\nThey have finished: check the seam, look and listen once over the whole, then kit_finish.';
    return { success: true, text: `${head}${members.map(m => memberReportText(this.memberState(m))).join('\n')}${tail}` };
  }

  private tell(turn: Turn, args: unknown): ToolOutput {
    const a = (args && typeof args === 'object' ? args : {}) as { member?: unknown; text?: unknown; marks?: unknown };
    const member = turn.members.find(m => m.id === a.member);
    if (!member) return { success: false, text: `No member ${String(a.member)}. Members: ${turn.members.map(m => `${m.id} “${m.name}”`).join(', ') || 'none'}.` };
    if (member.status !== 'working' || member.stopping) return { success: false, text: `${member.id} “${member.name}” has already finished.` };
    const text = typeof a.text === 'string' ? a.text.trim().slice(0, 4000) : '';
    if (!text) return { success: false, text: 'Say what to tell it (text).' };
    // Marks of the person's sketch the lead passes along: their lines, and the pictures they are on.
    const numbers = Array.isArray(a.marks) ? a.marks.filter((n): n is number => Number.isInteger(n) && n > 0).slice(0, 40) : [];
    const marked = numbers.length ? turn.sketch.map(p => onlyMarks(p, numbers)).filter(p => p.text?.includes('\n')) : [];
    if (numbers.length && !marked.length) return { success: false, text: `No marks ${numbers.join(', ')} in the person's sketch${turn.sketch.length ? '' : ' (there is none in this request)'}.` };
    const key = `${member.key}~t${++this.tellSerial}`;
    this.tells.set(key, member);
    if (!this.bridge.llmSteer(key, member.key, `[den-kit] The lead adds: ${text}${sketchLines(marked)}`, imagesOf(marked).images)) { this.tells.delete(key); return { success: false, text: 'The AI bridge is not connected.' }; }
    this.step(turn, member, `the lead added: “${text.slice(0, 60)}”`);
    return { success: true, text: `Sent to ${member.id} “${member.name}”; it reads it at its next step.` };
  }

  private stopMemberTool(turn: Turn, args: unknown): ToolOutput {
    const a = (args && typeof args === 'object' ? args : {}) as { member?: unknown; why?: unknown };
    const member = turn.members.find(m => m.id === a.member);
    if (!member) return { success: false, text: `No member ${String(a.member)}.` };
    if (member.status !== 'working') return { success: false, text: `${member.id} “${member.name}” has already finished.` };
    this.haltMember(turn, member, 'lead');
    return { success: true, text: `Stopping ${member.id} “${member.name}”; what it changed stays and its scope is yours again once it has stopped (kit_wait reports it).` };
  }

  private haltMember(turn: Turn, member: Agent, by: 'person' | 'lead') {
    member.stopping = true;
    member.stoppedBy = by;
    member.activity = 'stopping…';
    this.syncLanes(turn);
    if (!this.bridge.online || !this.bridge.llmStop(member.key)) { this.memberEnded(turn, member, { kind: 'done', status: 'interrupted', ms: 0 }); return; }
    member.stopTimer = setTimeout(() => { if (member.status === 'working') this.memberEnded(turn, member, { kind: 'done', status: 'interrupted', ms: 0 }); }, this.options.stopGraceMs ?? 15000);
  }

  /** Wake a lead waiting for members: when the ones it waits for are done, or at once (the person added something; the request stops). */
  private wake(turn: Turn, why: WakeReason) {
    for (const w of [...turn.waiting]) {
      if (why !== 'done' || w.ids.every(id => turn.members.find(m => m.id === id)?.status !== 'working')) w.resolve(why);
    }
  }

  private memberState(m: Agent): MemberState {
    return { id: m.id, name: m.name, status: m.status, ms: Math.round((m.ended ?? performance.now()) - m.started), landed: m.ws.landed, steps: m.steps, report: m.ws.report ?? undefined, error: m.error, stoppedBy: m.stoppedBy, usage: m.usage ?? undefined, refused: m.ws.refused };
  }

  /** The lead's next turn: its members finished while its own turn was over. */
  private integrate(turn: Turn) {
    turn.integrations++;
    const lead = turn.lead;
    lead.key = `${turn.id}~i${turn.integrations}`;
    turn.byKey.set(lead.key, lead);
    turn.leadEnded = null;
    const reports = turn.members.filter(m => !m.reported).map(m => { m.reported = true; return memberReportText(this.memberState(m)); });
    const text = integrationText(reports, turn.additions);
    const images = turn.additionImages.splice(0);
    turn.additions = [];
    this.step(turn, lead, 'checking what the members did');
    this.update(turn, { activity: 'checking the members’ work…' });
    if (!this.bridge.llmStart(lead.key, text, developerInstructions(this.blocks(), lead.role), this.thread ?? undefined, { role: lead.role, ...pictures(images) })) {
      this.finish(turn, { kind: 'done', status: 'failed', error: { message: 'The AI bridge is not connected.' }, ms: 0 });
    }
  }

  // ---- from the bridge -------------------------------------------------------------------
  private inbound(m: LlmInbound) {
    if (m.t === 'welcome') {
      // Back after a disconnect: a turn the bridge no longer knows was lost (the bridge restarted).
      const turn = this.turn;
      if (!turn) return;
      for (const member of turn.members) if (member.status === 'working' && !m.running.includes(member.key)) this.memberEnded(turn, member, { kind: 'done', status: 'failed', error: { message: 'The AI bridge restarted and lost this member.' }, ms: 0 });
      if (this.turn === turn && !turn.leadEnded && !m.running.includes(turn.lead.key)) {
        // What was being added to it runs as new requests. Otherwise the missed messages follow.
        const steers = [...this.steering.values()];
        this.steering.clear();
        this.queue.unshift(...steers.map(line => ({ ...line, message: 'waits for the running request…' })));
        for (const member of turn.members) if (member.status === 'working') this.haltMember(turn, member, 'lead');
        this.finish(turn, { kind: 'done', status: 'failed', error: { message: 'The AI bridge restarted and lost this request. Send it again.' }, ms: 0 });
      }
      return;
    }
    const turn = this.turn;
    if (m.t === 'error') {
      const agent = turn?.byKey.get(m.ref);
      const message = desktop() ? aiFailure({ message: m.message }) : m.message;
      if (turn && agent === turn.lead) this.update(turn, { note: message });
      else if (turn && agent) this.step(turn, agent, message);
      return;
    }
    if (m.t === 'tool.call') { const agent = turn?.byKey.get(m.id); if (turn && agent && agent.key === m.id) void this.toolCall(turn, agent, m.id, m.callId, m.tool, m.args); return; }
    const steer = this.steering.get(m.id);
    if (steer) { this.steerEvent(steer, m.event); return; }
    if (this.tells.has(m.id)) { if (m.event.kind === 'steered' || m.event.kind === 'done') this.tells.delete(m.id); return; }
    const agent = turn?.byKey.get(m.id);
    if (turn && agent && agent.key === m.id) this.event(turn, agent, m.event);
  }

  private steerEvent(line: Outcome, event: LlmEvent) {
    if (event.kind === 'steered') {
      this.steering.delete(line.id);
      this.requests.upsert({ ...line, status: 'merged', live: false, message: '→ added to the running request' });
      if (this.turn) this.step(this.turn, this.turn.lead, `you added: “${line.text.slice(0, 60)}”`);
    } else if (event.kind === 'done') {
      // The lead's turn ended first: with members still working the words go to its next turn; otherwise they run next.
      const turn = this.turn;
      if (turn && turn.leadEnded && !turn.stopping) {
        this.steering.delete(line.id);
        this.addition(turn, line);
        this.requests.upsert({ ...line, status: 'merged', live: false, message: '→ added to the running request' });
      } else this.later(line);
    }
  }

  private async toolCall(turn: Turn, agent: Agent, key: string, callId: string, tool: string, args: unknown) {
    let pending = agent.calls.get(callId);
    if (!pending) { pending = this.runTool(turn, agent, tool, args); agent.calls.set(callId, pending); }
    let output = await pending;
    // A picture too large for the bridge would lose the whole result: send the words without it.
    if (output.imageDataUrl && output.imageDataUrl.length > MAX_TOOL_IMAGE) output = { ...output, imageDataUrl: undefined, text: `${output.text}\n(The picture was too large to send.)` };
    if (this.turn === turn) this.bridge.toolResult(key, callId, output);
  }

  private async runTool(turn: Turn, agent: Agent, tool: string, args: unknown): Promise<ToolOutput> {
    agent.tools++;
    this.activity(turn, agent, TOOL_ACTIVITY[tool] ?? `${tool}…`);
    const before = agent.ws.steps.length;
    const output = await agent.ws.call(tool, args);
    if (this.turn !== turn) return output;
    const added = agent.ws.steps.slice(before);
    if (agent.ws.screenTouched && !turn.line.screen) this.update(turn, { screen: true });
    const step = added.length ? added.join(' · ') : TOOL_DONE[tool] ?? (output.success ? '' : `${tool} failed`);
    if (tool === 'kit_finish' && agent === turn.lead && agent.ws.summary) this.update(turn, { label: agent.ws.summary });
    if (step) this.step(turn, agent, step);
    this.activity(turn, agent, 'thinking…');
    return output;
  }

  private event(turn: Turn, agent: Agent, event: LlmEvent) {
    const lead = agent === turn.lead;
    switch (event.kind) {
      case 'thread':
        agent.thread = event.thread;
        if (lead) {
          this.thread = event.thread; this.threadConversation = turn.conversation; this.threadRole = agent.role;
          if (event.fresh) this.step(turn, agent, 'started a new conversation (the earlier one was lost)');
        } else if (event.forked !== undefined) agent.forked = event.forked;
        return;
      case 'started': this.activity(turn, agent, 'thinking…'); return;
      case 'delta': this.activity(turn, agent, 'responding…'); agent.message += event.text; if (lead) this.update(turn, { reply: tail(agent.message) }); return;
      case 'message':
        this.activity(turn, agent, 'responding…');
        if (lead) { agent.message = ''; this.update(turn, { reply: tail(event.text) }); }
        else { agent.message = event.text; this.syncLanes(turn); }
        return;
      case 'activity':
        if (event.what === 'thinking') this.activity(turn, agent, 'thinking…');
        else if (desktop()) {
          if (event.what === 'blocked') this.step(turn, agent, 'Skipped an unsupported AI action.');
        }
        else this.step(turn, agent, event.what === 'blocked' ? `blocked ${event.detail ?? 'a request'} (den-kit allows only its own tools)` : `${event.what}${event.detail ? `: ${event.detail}` : ''}`);
        return;
      case 'retrying': this.activity(turn, agent, desktop() ? 'Connection lost. Retrying ChatGPT…' : `reconnecting to the model… (${event.message})`); return;
      case 'question':
        // Nobody is asked to choose: an empty answer, and Codex decides itself.
        this.bridge.llmAnswer(agent.key, event.question, {});
        if (!desktop()) this.step(turn, agent, 'skipped a question (it decides itself)');
        return;
      case 'usage': agent.usage = event.total; this.syncLanes(turn); return;
      case 'question.resolved': return;
      case 'steered': return;
      case 'done':
        if (lead) this.leadEnded(turn, event);
        else this.memberEnded(turn, agent, event);
        return;
    }
  }

  /** The lead's turn ended: the request ends, unless members still work (then it waits for them). */
  private leadEnded(turn: Turn, done: Extract<LlmEvent, { kind: 'done' }>) {
    const working = turn.members.filter(m => m.status === 'working');
    if (!working.length) { this.finish(turn, done); return; }
    turn.leadEnded = done;
    if (done.status !== 'completed' && !turn.stopping) for (const m of working) if (!m.stopping) this.haltMember(turn, m, 'lead');
    this.update(turn, { activity: `waiting for ${working.map(m => m.name).join(', ')}…` });
  }

  private memberEnded(turn: Turn, member: Agent, done: Extract<LlmEvent, { kind: 'done' }>) {
    if (member.status !== 'working') return;
    if (member.stopTimer) clearTimeout(member.stopTimer);
    member.status = done.status === 'completed' ? 'done' : done.status === 'interrupted' ? 'stopped' : 'failed';
    member.ended = performance.now();
    member.activity = undefined;
    if (member.status === 'failed') member.error = done.error?.message ?? 'The member failed.';
    const seconds = ((member.ended - member.started) / 1000).toFixed(1);
    this.step(turn, turn.lead, `${member.name} ${member.status === 'done' ? 'finished' : member.status === 'stopped' ? (member.stoppedBy === 'person' ? 'stopped by you' : 'stopped') : 'failed'} (${seconds} s)`);
    this.compilers.get(member.id)?.dispose();
    this.compilers.delete(member.id);
    this.bridge.telemetry({ kind: 'llm-member', request: turn.id, member: member.id, name: member.name, status: member.status, context: member.brief?.context, forked: member.forked, scope: member.brief ? shortScope(member.brief.scope) : undefined, briefChars: member.brief ? JSON.stringify(member.brief).length : 0, textChars: member.textChars, startMs: Math.round(member.started - turn.started), firstLandedMs: member.firstLanded === null ? null : Math.round(member.firstLanded - member.started), ms: Math.round(member.ended - member.started), tools: member.tools, landed: member.ws.landed, refused: member.ws.refused, tokens: member.usage, error: member.error });
    this.wake(turn, 'done');
    this.syncLanes(turn);
    if (this.turn !== turn || turn.members.some(m => m.status === 'working')) return;
    const ended = turn.leadEnded;
    if (!ended) return; // the lead is still working: it hears through kit_wait
    if (ended.status === 'completed' && !turn.stopping && turn.integrations < MAX_INTEGRATIONS) this.integrate(turn);
    else this.finish(turn, ended);
  }

  private finish(turn: Turn, done: Extract<LlmEvent, { kind: 'done' }>) {
    if (this.turn !== turn) return;
    this.turn = null;
    this.busy.value = false;
    if (turn.stopTimer) clearTimeout(turn.stopTimer);
    this.wake(turn, 'stopped');
    for (const agent of this.agents(turn)) {
      if (agent.stopTimer) clearTimeout(agent.stopTimer);
      if (agent !== turn.lead && agent.status === 'working') {
        // Forced to end here (the grace ran out, the bridge lost it): stop it at the bridge too.
        agent.status = 'stopped'; agent.ended = performance.now();
        this.bridge.llmStop(agent.key);
      }
    }
    for (const [key, member] of this.tells) if (turn.members.includes(member)) this.tells.delete(key);
    for (const member of turn.members) {
      if (member.thread) this.bridge.llmForget(member.thread);
      this.compilers.get(member.id)?.dispose();
      this.compilers.delete(member.id);
    }
    const ms = Math.round(performance.now() - turn.started);
    const agents = this.agents(turn);
    const landed = agents.some(a => a.ws.landed > 0);
    const lead = turn.lead;
    const steps = [...lead.steps, ...turn.members.flatMap(m => m.steps)];
    const label = lead.ws.summary ?? (landed ? describeSteps(steps) : undefined);
    // The screen project's changes of this request become one commit in the pod's git.
    if (agents.some(a => a.ws.projectTouched)) void this.session.pod?.commit(`den-kit AI: ${label ?? turn.line.text}`).catch(() => undefined);
    const status = turn.stopping && done.status === 'completed' ? 'interrupted' : done.status;
    // The request is over: its marks go, unless it did nothing with them (then they are new marks for another try).
    this.session.releaseSent(turn.id, status !== 'completed' && !landed);
    this.syncLanes(turn);
    if (status === 'completed') this.close(turn, { status: landed ? 'applied' : 'reply', ms, label });
    else if (status === 'interrupted') this.close(turn, { status: 'stopped', ms, label: landed ? label : undefined, message: turn.stopNote ?? (desktop() ? 'Stopped.' : done.error?.message ? `Stopped: ${done.error.message}` : 'Stopped.'), note: landed ? KEPT : 'Nothing was changed.' });
    else this.close(turn, { status: 'failed', ms, label: landed ? label : undefined, message: desktop() ? aiFailure(done.error) : done.error?.message ?? 'The LLM request failed.', fix: desktop() ? undefined : done.error?.fix, note: landed ? KEPT : undefined });
    this.next();
  }

  private close(turn: Turn, patch: Partial<Outcome>) {
    const agents = this.agents(turn);
    const tokens = agents.reduce((n, a) => n + (a.usage?.total ?? 0), 0);
    const line: Outcome = { ...turn.line, live: false, activity: undefined, ...(tokens ? { tokens } : {}), ...patch };
    turn.line = line;
    this.requests.upsert(line);
    const end = performance.now();
    const work = agents.reduce((n, a) => n + ((a.ended ?? end) - a.started), 0);
    this.bridge.telemetry({
      kind: 'llm', id: turn.id, text: line.text, status: line.status, ms: line.ms, tools: agents.reduce((n, a) => n + a.tools, 0), landed: agents.reduce((n, a) => n + a.ws.landed, 0), steps: line.steps, message: line.message,
      role: turn.lead.role, members: turn.members.length, firstChangeMs: turn.firstChange === null ? null : Math.round(turn.firstChange - turn.started),
      workMs: Math.round(work), parallelism: line.ms ? Math.round(work / line.ms * 100) / 100 : null, tokens: tokens || null, leadTokens: turn.lead.usage, integrations: turn.integrations,
    });
  }

  private step(turn: Turn, agent: Agent, text: string) {
    if (agent === turn.lead) { this.update(turn, { steps: [...(turn.line.steps ?? []), text].slice(-MAX_STEPS) }); return; }
    agent.steps = [...agent.steps, text].slice(-MAX_MEMBER_STEPS);
    this.syncLanes(turn);
  }

  private activity(turn: Turn, agent: Agent, text: string) {
    if (agent === turn.lead) { this.update(turn, { activity: text }); return; }
    agent.activity = text;
    this.syncLanes(turn);
  }

  /** The members' lanes under the request line. */
  private syncLanes(turn: Turn) {
    if (!turn.members.length) return;
    const now = performance.now();
    const agents: AgentLane[] = turn.members.map(m => ({
      id: m.id, name: m.name, color: m.color, status: m.status, activity: m.status === 'working' ? m.activity ?? 'thinking…' : undefined, step: m.steps.at(-1),
      ms: Math.round((m.ended ?? now) - m.started), scope: m.brief ? shortScope(m.brief.scope) : '', tokens: m.usage?.total, message: m.ws.report?.summary ?? (m.status === 'failed' ? desktop() ? aiFailure({ message: m.error ?? '' }) : m.error : undefined),
    }));
    this.update(turn, { agents });
  }

  private touch(agent: Agent, ids: string[]) {
    if (!ids.length) return;
    const now = performance.now();
    this.touches.value = [...this.touches.value.filter(t => now - t.at < TOUCH_MS), { ids, color: agent.color, name: agent.name, at: now }];
  }

  private update(turn: Turn, patch: Partial<Outcome>) {
    if (this.turn !== turn) return;
    turn.line = { ...turn.line, ...patch, ms: Math.round(performance.now() - turn.started) };
    this.requests.upsert(turn.line);
  }
}

const tail = (text: string) => text.length > 700 ? `…${text.slice(-700)}` : text;
function describeSteps(steps: string[]): string {
  const edits = steps.filter(s => !/^(read|looked|listened|skipped|you added|started|members:|checking|the lead added)/.test(s) && !/not applied$/.test(s) && !/ (finished|stopped|failed|stopped by you) \(\d/.test(s));
  return edits.length ? edits.slice(-2).join(' · ').replace(/ ✓/g, '').slice(0, 120) : 'LLM edit';
}
