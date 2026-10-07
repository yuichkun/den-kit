// The editing session: the one document the browser owns, its history, the
// compile→audio pipeline and the hooks CP2 (AI) plugs into. Every change goes
// through commit() with an author, so humans and AI edit the same way.
import { shallowRef, ref, computed, markRaw, triggerRef } from 'vue';
import { catalog } from '../blocks/index.ts';
import { generate, type Generated } from '../core/codegen.ts';
import { History, type Author, type Transaction } from '../core/history.ts';
import { applyIntents, isStructural, OpError, replaceOps, type Intent, type ResolvedOp } from '../core/ops.ts';
import { emptyDocument, randomId, type PatchDocument } from '../core/schema.ts';
import { validate } from '../core/validate.ts';
import type { Issue } from '../core/issues.ts';
import { starter, type StarterId } from '../core/starters.ts';
import { lookIntents, type Work } from '../showcase/index.ts';
import { CompileClient, CompileFailure, compileInputs } from '../compile/compile-client.ts';
import type { Artifact } from '../compile/protocol.ts';
import { AudioEngine, type EngineState, type TestSignal } from '../engine/audio-engine.ts';
import { makeSaveRecord, readSaveRecord, parseDocument, serializeDocument } from '../core/persistence.ts';
import CompilerWorker from '../compile/compiler.worker.ts?worker';
import { AssetStore } from '../plugin/asset-store.ts';
import { lookAt, type LookResult } from '../plugin/look.ts';
import { assetFontFamily, isFontAsset, type AssetMeta } from '../core/ui.ts';
import type { BridgeClient } from '../ai/bridge-client.ts';
import type { FastPath } from '../ai/fast-path.ts';
import type { LlmController } from '../ai/llm.ts';

export type CompileStatus = 'idle' | 'waiting' | 'compiling' | 'ok' | 'error' | 'empty';
export interface Toast { id: number; kind: 'info' | 'warn' | 'error'; text: string }
export interface TransactionListener { (tx: Transaction, doc: PatchDocument): void }
export interface HistoryListener { (kind: 'undo' | 'redo', tx: Transaction): void }

const AUTOSAVE_KEY = 'den-kit:autosave';
/** The AI conversation about the patch being worked on (kept with the autosave). */
const CONVERSATION_KEY = 'den-kit:conversation';

export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

export class KitSession {
  readonly catalog = catalog;
  readonly doc = shallowRef<PatchDocument>(emptyDocument('Untitled'));
  readonly history = markRaw(new History());
  readonly historyVersion = ref(0);
  readonly selection = ref<string[]>([]);
  /** Cables selected in the patch view (they can be attached to an AI request too). */
  readonly edgeSelection = ref<string[]>([]);
  /**
   * The AI conversation the requests belong to. A patch someone opens (a starter, a work,
   * an import, a new patch) starts a new one; what the AI itself puts in place (a template)
   * stays in the conversation that asked for it.
   */
  readonly conversation = ref(randomId('conv'));
  /** The person is editing the plugin screen (so "darker" means the screen, not the sound). */
  readonly screenFocus = ref(false);
  /** The part being edited: the chain of uses entered from the main patch (empty: the main patch). */
  readonly partPath = ref<string[]>([]);
  /** Hear only this part (a chain of uses from the main patch), or everything (null). */
  readonly solo = ref<string[] | null>(null);
  /** The part the patch view shows (undefined: the main patch). */
  readonly scope = computed(() => { const last = this.partPath.value.at(-1); return last ? this.doc.value.nodes[last]?.part : undefined; });
  readonly compileStatus = ref<CompileStatus>('idle');
  readonly compileMessage = ref('');
  readonly compileIssues = shallowRef<Issue[]>([]);
  readonly lastCompileMs = ref(0);
  readonly wasmBytes = ref(0);
  readonly engineState = ref<EngineState>('off');
  readonly engineMessage = ref('Audio is off.');
  readonly toasts = ref<Toast[]>([]);
  readonly healthMuted = ref(false);
  /** Shown as a banner while the safety stage keeps the output muted. */
  readonly healthMessage = ref('');
  /** Notes held from the on-screen keyboard, the computer keyboard or MIDI (for the keyboard display). */
  readonly heldNotes = ref<number[]>([]);
  readonly midiState = ref<'off' | 'on' | 'denied' | 'unsupported'>('off');
  /** What an effect patch hears (test material or the computer's audio input). */
  readonly input = ref<TestSignal>('chords');
  readonly generated = shallowRef<Generated>(generate(this.doc.value, catalog));
  readonly validation = computed(() => validate(this.doc.value, catalog));
  readonly issues = computed<Issue[]>(() => [...this.validation.value.issues, ...this.compileIssues.value]);
  readonly engine: AudioEngine;
  readonly compiler: CompileClient;
  /** The local AI bridge (CP2); null when the editor runs without one (tests, builds). */
  bridge: BridgeClient | null = null;
  /** The fast AI path (lexicon + Jev); null when not wired (unit tests). */
  fast: FastPath | null = null;
  /** The LLM path (Codex through the bridge); null when not wired. */
  llm: LlmController | null = null;
  /** Increments whenever the whole document is replaced (load, import, recall) so views can re-fit. */
  readonly loadEpoch = ref(0);
  /** Where the bytes of pictures and fonts live (IndexedDB), and the URLs the page shows them with. */
  readonly assets: AssetStore;
  readonly assetUrls = shallowRef<Record<string, string>>({});
  private fontFaces = new Set<string>();
  private listeners = new Set<TransactionListener>();
  private historyListeners = new Set<HistoryListener>();
  private compileSerial = 0;
  private compileTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private toastSerial = 0;
  private storage: StorageLike | null;

  constructor(options: { storage?: StorageLike | null; createWorker?: () => Worker; engine?: AudioEngine; compileTimeoutMs?: number; rotateAfter?: number; assets?: AssetStore } = {}) {
    this.storage = options.storage === undefined ? safeStorage() : options.storage;
    this.assets = markRaw(options.assets ?? new AssetStore());
    this.engine = markRaw(options.engine ?? new AudioEngine({
      state: (state, message) => { this.engineState.value = state; this.engineMessage.value = message; },
      health: (message, muted) => { this.healthMuted.value = muted; if (message && !muted) this.toast('warn', message); this.healthMessage.value = muted ? message : ''; },
      error: message => this.toast('error', `Audio: ${message}`),
    }, { rotateAfter: options.rotateAfter }));
    this.compiler = markRaw(new CompileClient({ createWorker: () => (options.createWorker ?? (() => new CompilerWorker()))() as never, timeoutMs: options.compileTimeoutMs }));
  }

  // ---- Document lifecycle ----------------------------------------------------
  /** Load the autosave (or a starter) at startup. True when an autosave was restored. */
  restore(fallback: StarterId = 'bass'): boolean {
    const raw = this.storage?.getItem(AUTOSAVE_KEY);
    if (raw) {
      let record: unknown = null;
      try { record = JSON.parse(raw); } catch { record = null; }
      const read = readSaveRecord(record, catalog);
      if (read.ok) {
        this.replace(read.doc, 'Restored autosave', false);
        // The conversation about this patch goes on after a reload.
        const saved = this.loadConversation();
        if (saved && saved.docId === read.doc.id) this.conversation.value = saved.id;
        for (const i of read.report) this.toast('warn', i.message);
        return true;
      }
      // Keep the broken record for recovery and tell the user.
      this.storage?.setItem(`${AUTOSAVE_KEY}:broken:${Date.now()}`, raw);
      this.toast('warn', `Autosave could not be read (${read.error}); a copy was kept and a starter patch was loaded.`);
    }
    this.replace(starter(fallback, catalog), 'Starter', false);
    return false;
  }

  replace(doc: PatchDocument, label: string, undoable = true, author: Author = { kind: 'human' }) {
    const previous = this.doc.value;
    if (undoable) this.history.record({ id: randomId('tx'), author, label, ops: replaceOps(previous, doc), at: Date.now(), baseRevision: previous.revision, replaced: true });
    else this.history.clear();
    this.historyVersion.value++;
    this.doc.value = { ...doc, panel: { ...doc.panel }, revision: previous.revision + 1, id: undoable ? previous.id : doc.id };
    this.selection.value = [];
    this.edgeSelection.value = [];
    this.partPath.value = [];
    this.solo.value = null;
    if (author.kind === 'human') this.conversation.value = randomId('conv');
    this.loadEpoch.value++;
    this.afterChange(true);
  }

  // ---- Parts: going inside, hearing one alone -----------------------------------------
  /** Go inside a use of a part (in the part the view shows now). False when that is not a part here. */
  enterPart(id: string): boolean {
    const node = this.doc.value.nodes[id];
    if (!node || node.type !== 'kit.part' || !node.part || !this.doc.value.parts[node.part] || node.inside !== this.scope.value) return false;
    this.partPath.value = [...this.partPath.value, id];
    this.selection.value = []; this.edgeSelection.value = [];
    return true;
  }
  /** Go out `levels` parts (to the main patch with Infinity); the use we came out of becomes the selection. */
  leavePart(levels = 1) {
    const path = this.partPath.value;
    if (!path.length) return;
    const keep = Math.max(0, path.length - levels);
    const from = path[keep]!;
    this.partPath.value = path.slice(0, keep);
    this.selection.value = this.doc.value.nodes[from] ? [from] : []; this.edgeSelection.value = [];
  }
  /** Hear only this chain of uses (null: everything). Recompiles. */
  setSolo(path: string[] | null) {
    if (JSON.stringify(path) === JSON.stringify(this.solo.value)) return;
    this.solo.value = path && path.length ? [...path] : null;
    this.afterChange(true);
  }
  /** After an edit or an undo: a chain that no longer leads anywhere is cut back to what still exists. */
  private keepPathsValid() {
    const doc = this.doc.value;
    const valid = (path: readonly string[]) => {
      let scope: string | undefined;
      for (const [i, id] of path.entries()) {
        const n = doc.nodes[id];
        if (!n || n.type !== 'kit.part' || !n.part || !doc.parts[n.part] || n.inside !== scope) return i;
        scope = n.part;
      }
      return path.length;
    };
    const keep = valid(this.partPath.value);
    if (keep < this.partPath.value.length) this.partPath.value = this.partPath.value.slice(0, keep);
    if (this.solo.value && valid(this.solo.value) < this.solo.value.length) this.solo.value = null;
  }

  loadStarter(id: StarterId) { this.replace(starter(id, catalog), `Load ${id}`); }
  /** Start from a showcase work, optionally wearing another work's look (one undo step). */
  loadWork(work: Work, look?: Work) {
    let doc = work.build(catalog);
    if (look && look.id !== work.id) doc = applyIntents(doc, lookIntents(doc, look.build(catalog)), catalog).doc;
    this.replace({ ...doc, name: look && look.id !== work.id ? `${doc.name} (${look.title} look)` : doc.name }, `Start from ${work.title}`);
  }

  /** Look the plugin over (the screen checks) as it is drawn now; with `picture`, a PNG of it too. */
  look(options: { picture?: boolean; doc?: PatchDocument } = {}): Promise<LookResult> {
    return lookAt(options.doc ?? this.doc.value, catalog, { generated: this.generated.value, assetUrls: this.assetUrls.value, analyser: probe => probe >= 0 ? this.engine.probeAnalysers[probe] ?? null : this.engine.outAnalyser, picture: options.picture });
  }

  /** Apply intents as one transaction. Returns the resolved ops, or the error. */
  commit(intents: Intent[], options: { author?: Author; label?: string; gesture?: string; /** Steps of one request that undo together (see History). */ group?: string; /** Refuse when the document moved on (AI answers computed on an older revision). */ expectRevision?: number } = {}): { ok: true; ops: ResolvedOp[]; created: string[] } | { ok: false; error: OpError } {
    const before = this.doc.value;
    if (options.expectRevision !== undefined && before.revision !== options.expectRevision) return { ok: false, error: new OpError(`The patch changed (revision ${before.revision}, expected ${options.expectRevision}).`, 0, 'stale') };
    let result;
    try { result = applyIntents(before, intents, catalog); }
    catch (error) {
      if (error instanceof OpError) return { ok: false, error };
      throw error;
    }
    if (!result.ops.length) return { ok: true, ops: [], created: result.created };
    const tx: Transaction = { id: randomId('tx'), author: options.author ?? { kind: 'human' }, label: options.label ?? describeIntents(intents), ops: result.ops, at: Date.now(), gesture: options.gesture, group: options.group, baseRevision: before.revision };
    this.history.record(tx);
    this.historyVersion.value++;
    this.doc.value = result.doc;
    this.afterChange(result.ops.some(isStructural), result.ops);
    for (const listener of this.listeners) listener(tx, result.doc);
    return { ok: true, ops: result.ops, created: result.created };
  }

  undo() { const r = this.history.undo(this.doc.value); if (r) { this.doc.value = r.doc; this.historyVersion.value++; this.afterChange(r.tx.ops.some(isStructural), r.tx.ops); for (const l of this.historyListeners) l('undo', r.tx); } return r?.tx ?? null; }
  redo() { const r = this.history.redo(this.doc.value); if (r) { this.doc.value = r.doc; this.historyVersion.value++; this.afterChange(r.tx.ops.some(isStructural), r.tx.ops); for (const l of this.historyListeners) l('redo', r.tx); } return r?.tx ?? null; }
  onTransaction(listener: TransactionListener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  onHistory(listener: HistoryListener) { this.historyListeners.add(listener); return () => this.historyListeners.delete(listener); }

  // ---- Change propagation ------------------------------------------------------
  private afterChange(structural: boolean, ops: readonly ResolvedOp[] = []) {
    this.scheduleSave();
    this.keepPathsValid();
    if (!ops.length || ops.some(op => op.op === 'addAsset')) void this.syncAssets();
    // Value-only edits go straight to AudioParams, and the plugin's screen never touches the sound: no codegen, no recompile.
    // Inside parts a knob may stand for several AudioParams (each use of a part has its own), or none (a use's parameter sets it).
    if (!structural && ops.length) {
      const g = this.generated.value;
      let values: Record<string, number> | null = null;
      for (const op of ops) {
        if (op.op !== 'setValue' || typeof op.to === 'undefined') continue;
        const name = `${op.node}_${op.port}`;
        for (const target of g.aliases[name] ?? [name]) {
          this.engine.setParam(target, Number(op.to));
          if (Object.hasOwn(g.values, target)) (values ??= { ...g.values })[target] = Number(op.to);
        }
      }
      if (values) this.generated.value = { ...g, values };
      return;
    }
    const generated = generate(this.doc.value, catalog, this.solo.value ? { solo: this.solo.value } : {});
    const same = generated.hash && generated.hash === this.generated.value.hash;
    this.generated.value = generated;
    if (same) { for (const [name, value] of Object.entries(generated.values)) this.engine.setParam(name, value); return; }
    this.scheduleCompile();
  }

  private scheduleCompile() {
    if (this.compileTimer) clearTimeout(this.compileTimer);
    this.compileStatus.value = 'waiting';
    this.compileTimer = setTimeout(() => { this.compileTimer = null; void this.compileNow(); }, 120);
  }

  /** Compile the current document and swap it in. Old sound keeps playing on failure. */
  async compileNow(): Promise<Artifact | null> {
    const doc = this.doc.value, generated = this.generated.value;
    if (!generated.source) {
      this.compileIssues.value = [];
      const blocking = generated.issues.filter(i => i.severity === 'error');
      if (blocking.length) { this.compileStatus.value = 'error'; this.compileMessage.value = blocking[0]!.message; }
      else { this.compileStatus.value = 'empty'; this.compileMessage.value = generated.issues.find(i => i.code === 'nothing-to-compile')?.message ?? 'Nothing to play.'; this.engine.unload(); }
      return null;
    }
    const serial = ++this.compileSerial;
    const previousStatus = { status: this.compileStatus.value, message: this.compileMessage.value };
    this.compileStatus.value = 'compiling';
    this.compileMessage.value = 'Compiling…';
    try {
      const artifact = await this.compiler.compile(generated, compileInputs(doc, generated), phase => { this.compileMessage.value = `${phase}…`; });
      if (this.generated.value.hash !== artifact.hash) return artifact; // a newer edit is on its way
      this.compileIssues.value = [];
      this.lastCompileMs.value = artifact.compileMs;
      this.wasmBytes.value = artifact.wasm.byteLength;
      this.compileStatus.value = 'ok';
      this.compileMessage.value = `Compiled in ${(artifact.compileMs / 1000).toFixed(2)} s`;
      if (this.engine.running) await this.loadIntoEngine(artifact);
      return artifact;
    } catch (error) {
      if (error instanceof CompileFailure && error.kind === 'superseded') {
        // Superseded by something other than a newer compileNow: do not leave "Compiling…" behind.
        if (serial === this.compileSerial && !this.compileTimer) {
          const cached = this.compiler.cached(this.generated.value.hash);
          this.compileStatus.value = cached ? 'ok' : previousStatus.status === 'compiling' || previousStatus.status === 'waiting' ? 'idle' : previousStatus.status;
          this.compileMessage.value = cached ? 'Compiled' : previousStatus.message;
        }
        return null;
      }
      if (this.generated.value.hash !== generated.hash) return null;
      this.compileStatus.value = 'error';
      this.compileMessage.value = error instanceof Error ? error.message : String(error);
      this.compileIssues.value = error instanceof CompileFailure ? error.issues : [];
      return null;
    }
  }

  private async loadIntoEngine(artifact: Artifact) {
    const g = this.generated.value;
    try {
      await this.engine.load(artifact, { values: { ...g.values }, voices: !!g.voices, audioIn: g.audioIn, probes: g.probes.length });
    } catch (error) {
      this.toast('error', `Audio: ${error instanceof Error ? error.message : String(error)} (the previous sound keeps playing)`);
    }
  }

  private audioStarting: Promise<boolean> | null = null;
  /** Start audio once (concurrent callers share the attempt); true when it runs. Call from a user gesture. */
  ensureAudio(): Promise<boolean> {
    if (this.engine.running) return Promise.resolve(true);
    this.audioStarting ??= this.enableAudio().finally(() => { this.audioStarting = null; });
    return this.audioStarting;
  }

  async enableAudio() {
    const ok = await this.engine.start();
    if (!ok) return false;
    const artifact = this.compiler.cached(this.generated.value.hash);
    if (artifact) await this.loadIntoEngine(artifact);
    // A compile already on its way loads itself once audio runs; do not start a second one.
    else if (this.compileStatus.value !== 'compiling' && this.compileStatus.value !== 'waiting') await this.compileNow();
    return true;
  }

  // ---- Playing ------------------------------------------------------------------------
  setInput(kind: TestSignal) { this.input.value = kind; this.engine.setTestSignal(kind); }
  noteOn(note: number, velocity = 100) { this.engine.noteOn(note, velocity); this.heldNotes.value = this.engine.heldNotes; }
  noteOff(note: number) { this.engine.noteOff(note); this.heldNotes.value = this.engine.heldNotes; }
  /** Stop everything (⌘.): release notes and reset DSP state. */
  panic() { this.engine.panic(); this.heldNotes.value = this.engine.heldNotes; }

  private midiAccess: Promise<void> | null = null;
  /** Listen to every MIDI input (asked once, after the first click; refusing is fine). */
  connectMidi(): Promise<void> {
    this.midiAccess ??= (async () => {
      const nav = navigator as Navigator & { requestMIDIAccess?: () => Promise<MIDIAccess> };
      if (!nav.requestMIDIAccess) { this.midiState.value = 'unsupported'; return; }
      try {
        const access = await nav.requestMIDIAccess();
        const bind = () => { for (const input of access.inputs.values()) input.onmidimessage = m => this.onMidi(m.data); };
        bind(); access.onstatechange = bind;
        this.midiState.value = 'on';
      } catch { this.midiState.value = 'denied'; }
    })();
    return this.midiAccess;
  }
  private onMidi(data: Uint8Array | null) {
    const [status = 0, a = 0, b = 0] = data ?? [];
    const type = status & 0xf0;
    if (type === 0x90 && b > 0) this.noteOn(a, b);
    else if (type === 0x80 || (type === 0x90 && b === 0)) this.noteOff(a);
  }

  // ---- Assets ---------------------------------------------------------------------
  /** Find a URL for every asset of the patch that has none yet; fonts get registered with the page. */
  async syncAssets() {
    const doc = this.doc.value;
    const missing = Object.values(doc.assets).filter(a => !this.assetUrls.value[a.id]);
    if (!missing.length) return;
    const found: Record<string, string> = {};
    for (const asset of missing) { const url = await this.assets.url(asset); if (url) found[asset.id] = url; }
    if (Object.keys(found).length) this.assetUrls.value = { ...this.assetUrls.value, ...found };
    for (const asset of missing) if (isFontAsset(asset) && found[asset.id] && !this.fontFaces.has(asset.id) && typeof FontFace !== 'undefined') {
      this.fontFaces.add(asset.id);
      try { const face = new FontFace(assetFontFamily(asset.id), `url("${found[asset.id]}")`); document.fonts.add(await face.load()); }
      catch { this.toast('warn', `The font "${asset.name}" could not be read.`); }
    }
  }

  /** Add a dropped file as an asset of the patch (one undo step); null when it is refused. */
  async addAssetFile(file: Blob & { name?: string }): Promise<AssetMeta | null> {
    let meta: AssetMeta;
    try { meta = await this.assets.add(file); }
    catch (error) { this.toast('warn', error instanceof Error ? error.message : String(error)); return null; }
    if (!this.doc.value.assets[meta.id]) {
      const r = this.commit([{ op: 'addAsset', asset: meta }], { label: `Add ${meta.name}` });
      if (!r.ok) { this.toast('warn', r.error.message); return null; }
    }
    await this.syncAssets();
    return this.doc.value.assets[meta.id] ?? meta;
  }

  // ---- Persistence --------------------------------------------------------------
  private scheduleSave() {
    if (!this.storage) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 800);
  }
  saveNow() {
    if (!this.storage) return;
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    try { this.storage.setItem(AUTOSAVE_KEY, JSON.stringify(makeSaveRecord(this.doc.value))); }
    catch (error) { this.toast('warn', `Autosave failed (${error instanceof Error ? error.message : String(error)}); export the patch to keep it.`); }
  }
  /** The saved AI conversation (null when there is none or it cannot be read). */
  loadConversation(): { id: string; docId: string; lines: unknown[] } | null {
    try {
      const raw = this.storage?.getItem(CONVERSATION_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as { id?: unknown; docId?: unknown; lines?: unknown };
      return typeof data.id === 'string' && typeof data.docId === 'string' && Array.isArray(data.lines) ? { id: data.id, docId: data.docId, lines: data.lines } : null;
    } catch { return null; }
  }
  saveConversation(lines: unknown[]) {
    try { this.storage?.setItem(CONVERSATION_KEY, JSON.stringify({ id: this.conversation.value, docId: this.doc.value.id, lines })); }
    catch { /* a full storage loses the conversation, never the patch */ }
  }
  exportText() { return serializeDocument(this.doc.value); }
  /** The patch with its pictures and fonts inside (a file that opens anywhere). */
  async exportWithAssets(): Promise<string> {
    const assetData: Record<string, string> = {};
    for (const asset of Object.values(this.doc.value.assets)) {
      const data = await this.assets.dataUrl(asset);
      if (data) assetData[asset.id] = data; else this.toast('warn', `"${asset.name}" is missing; the export only names it.`);
    }
    return serializeDocument(this.doc.value, { assetData });
  }
  importText(text: string): boolean {
    const parsed = parseDocument(text, catalog);
    if (!parsed.ok) { this.toast('error', `Import refused: ${parsed.error}`); return false; }
    const carried = Object.entries(parsed.assetData);
    this.replace(parsed.doc, 'Import');
    if (carried.length) void Promise.all(carried.map(([id, data]) => this.assets.putDataUrl(id, data))).then(() => this.syncAssets());
    for (const issue of parsed.report.slice(0, 6)) this.toast(issue.severity === 'error' ? 'error' : 'warn', issue.message);
    if (parsed.report.length > 6) this.toast('warn', `…and ${parsed.report.length - 6} more repairs.`);
    return true;
  }

  // ---- Misc ------------------------------------------------------------------------
  toast(kind: Toast['kind'], text: string) {
    const id = ++this.toastSerial;
    this.toasts.value = [...this.toasts.value.slice(-4), { id, kind, text }];
    setTimeout(() => { this.toasts.value = this.toasts.value.filter(t => t.id !== id); }, kind === 'error' ? 9000 : 5000);
  }
  select(ids: string[]) { this.selection.value = ids; }
  selectEdges(ids: string[]) { this.edgeSelection.value = ids; }
  touch() { triggerRef(this.doc); }
}

function describeIntents(intents: Intent[]): string {
  if (intents.length === 1) {
    const i = intents[0]!;
    switch (i.op) {
      case 'setValue': return `Set ${i.node}.${i.port}`;
      case 'connect': return `Connect ${i.from.node} → ${i.to.node}`;
      case 'addNode': return `Add ${i.node.type.split('.').pop()}`;
      case 'removeNode': return `Delete ${i.id}`;
      default: return i.op;
    }
  }
  return `${intents.length} edits`;
}

function safeStorage(): StorageLike | null {
  try { const s = globalThis.localStorage; s.setItem('den-kit:probe', '1'); s.removeItem('den-kit:probe'); return s; } catch { return null; }
}
