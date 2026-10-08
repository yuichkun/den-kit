// The editing session: the one document the browser owns, its history, the
// compile→audio pipeline and the hooks CP2 (AI) plugs into. Every change goes
// through commit() with an author, so humans and AI edit the same way.
import { shallowRef, ref, computed, markRaw, triggerRef } from 'vue';
import { catalog } from '../blocks/index.ts';
import { currentValues, generate, type Generated } from '../core/codegen.ts';
import { History, type Author, type Transaction } from '../core/history.ts';
import { applyIntents, isStructural, OpError, replaceOps, type Intent, type ResolvedOp } from '../core/ops.ts';
import { emptyDocument, randomId, type PatchDocument, type XY } from '../core/schema.ts';
import { faceGroup } from '../core/face.ts';
import { usesOf } from '../core/parts.ts';
import { FaceError, faceFromPlugin, faceIntents, faceOnPlugin, screenPartIntents } from '../plugin/faces.ts';
import { bundleHash, diffBundles, emptyLibrary, extractBundle, latest, libraryAssets, mergeLibrary, parseLibrary, removeFromLibrary, saveToLibrary, serializeLibrary, versionOf, type BundleDiff, type Library, type MyPart, type MyPartVersion } from '../core/library.ts';
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
import type { Seeing } from '../ai/seeing.ts';
import { MARK_COLORS, type Box, type Mark, type SketchView } from '../ai/sketch.ts';
/** What drawing on a view does: a mark kind, or rubbing marks out. */
export type InkTool = Mark['kind'] | 'eraser';
import { ScreenShare } from './screen-share.ts';
import type { PodSession } from '../pod/pod-session.ts';

export type CompileStatus = 'idle' | 'waiting' | 'compiling' | 'ok' | 'error' | 'empty';
export interface Toast { id: number; kind: 'info' | 'warn' | 'error'; text: string }
export interface TransactionListener { (tx: Transaction, doc: PatchDocument): void }
export interface HistoryListener { (kind: 'undo' | 'redo', tx: Transaction): void }

const AUTOSAVE_KEY = 'den-kit:autosave';
/** The AI conversation about the patch being worked on (kept with the autosave). */
const CONVERSATION_KEY = 'den-kit:conversation';
/** My parts: saved parts every patch can place (kept apart from any one patch). */
export const MY_PARTS_KEY = 'den-kit:my-parts';

export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

export class KitSession {
  readonly catalog = catalog;
  readonly doc = shallowRef<PatchDocument>(emptyDocument('Untitled'));
  readonly history = markRaw(new History());
  readonly historyVersion = ref(0);
  /** My parts, as last read from storage. */
  readonly myParts = shallowRef<Library>(emptyLibrary());
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
  /** The pod (BrowserPod): the screen project's workbench for the AI and the person; null when not wired (unit tests). */
  pod: PodSession | null = null;
  /** What the person is looking at (U8b): the view and the plugin's mode (the editor keeps it up to date). */
  readonly seeing = shallowRef<Seeing>({ view: 'patch', edit: false, full: false });
  /** The view on screen adds what only it knows (the patch view's zoom and the modules in sight; the plugin's scale). */
  viewDetails: (() => Partial<Seeing>) | null = null;
  /** The patch view adds where its modules are drawn (boxes in the patch's positions), for reading sketches (U8c). */
  patchBoxes: (() => Record<string, Box>) | null = null;
  /** Pictures of den-kit as the person sees it, once they let the AI see the screen (U8b). */
  readonly screen = markRaw(new ScreenShare());
  /** The person's rough sketch over each view (U8c): marks for the AI, not part of the work and not in the undo history. */
  readonly sketch = shallowRef<Record<SketchView, Mark[]>>({ plugin: [], patch: [] });
  /** Drawing on the view: the tool in hand (null: not drawing). */
  readonly inking = ref<InkTool | null>(null);
  readonly inkColor = ref<string>(MARK_COLORS[0]);
  /** Keep marks after the AI has dealt with them. */
  readonly inkPinned = ref(false);
  /** A stylus draws when it touches a view, without picking the pen first. */
  readonly stylusDraws = ref(true);
  /** Marks sent with a request (dimmed until it ends): mark id → request id. */
  readonly sentMarks = shallowRef<Record<string, string>>({});
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
    this.reloadMyParts();
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
    // Marks were about the patch that was there.
    this.sketch.value = { plugin: [], patch: [] };
    this.sentMarks.value = {};
    this.inking.value = null;
    this.loadEpoch.value++;
    this.afterChange(true);
  }

  // ---- My parts: saved parts every patch can place -----------------------------------------
  /** Read My parts from storage again (another tab may have saved one). */
  reloadMyParts() {
    const raw = this.storage?.getItem(MY_PARTS_KEY);
    if (!raw) { this.myParts.value = emptyLibrary(); return; }
    const read = parseLibrary(raw, catalog);
    this.myParts.value = read.ok ? read.library : emptyLibrary();
  }
  private storeMyParts(library: Library): boolean {
    try { this.storage?.setItem(MY_PARTS_KEY, serializeLibrary(library)); }
    catch { this.toast('warn', 'My parts could not be saved: the browser storage is full.'); return false; }
    this.myParts.value = library;
    return true;
  }
  /** Where a part of this patch stands with My parts: which entry and version it came from, whether there is a newer one, and whether it was changed here since. */
  myPartStatus(defId: string): { entry: MyPart | null; version: number | null; newer: MyPartVersion | null; changedHere: boolean; diff: BundleDiff | null } {
    const def = this.doc.value.parts[defId];
    const entry = def?.from ? this.myParts.value.parts[def.from.id] ?? null : null;
    if (!def || !def.from || !entry) return { entry, version: def?.from?.version ?? null, newer: null, changedHere: false, diff: null };
    const now = extractBundle(this.doc.value, defId);
    const placed = versionOf(entry, def.from.version);
    const changedHere = placed ? bundleHash(placed.bundle) !== bundleHash(now) : def.from.hash !== undefined && def.from.hash !== bundleHash(now);
    const last = latest(entry);
    const newer = last.version > def.from.version ? last : null;
    return { entry, version: def.from.version, newer, changedHere, diff: newer ? diffBundles(now, newer.bundle) : null };
  }
  /** Save a part of this patch to My parts (a new version when it came from there). */
  saveToMyParts(defId: string): { ok: boolean; message: string } {
    let saved;
    try { saved = saveToLibrary(this.myParts.value, this.doc.value, defId); }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : String(error) }; }
    if (saved.unchanged) return { ok: true, message: `“${saved.entry.name}” is already in My parts (v${saved.version}).` };
    if (!this.storeMyParts(saved.library)) return { ok: false, message: 'My parts could not be saved: the browser storage is full.' };
    const r = this.commit([{ op: 'updatePart', part: defId, from: saved.from }], { label: `Save ${saved.entry.name} to My parts` });
    if (!r.ok) return { ok: false, message: r.error.message };
    return { ok: true, message: saved.version > 1 ? `Saved “${saved.entry.name}” to My parts as v${saved.version}.` : `Saved “${saved.entry.name}” to My parts.` };
  }
  /** Place a My part: another use when this patch already has that version unchanged, else its definition comes in with one use. */
  placeMyPart(id: string, options: { pos?: XY; inside?: string } = {}): { ok: true; created: string[] } | { ok: false; message: string } {
    const entry = this.myParts.value.parts[id];
    if (!entry) return { ok: false, message: `There is no “${id}” in My parts.` };
    const last = latest(entry);
    const here = Object.values(this.doc.value.parts).find(p => p.from?.id === id && p.from.version === last.version && bundleHash(extractBundle(this.doc.value, p.id)) === bundleHash(last.bundle));
    const intents: Intent[] = here
      ? [{ op: 'addNode', node: { type: 'kit.part', part: here.id, pos: options.pos, inside: options.inside } }]
      : [{ op: 'importPart', bundle: last.bundle, from: { id, version: last.version, hash: bundleHash(last.bundle) }, pos: options.pos, inside: options.inside }];
    // A screen part (nothing inside but its face) is for the plugin: its face goes there at once.
    if (!Object.keys(last.bundle.nodes).length && options.inside === undefined) {
      try {
        const placed = applyIntents(this.doc.value, intents, catalog);
        intents.push(...faceIntents(placed.doc, catalog, placed.created[0]!).intents);
      } catch { /* placing it says what is wrong */ }
    }
    const r = this.commit(intents, { label: `Place ${entry.name}` });
    return r.ok ? { ok: true, created: r.created } : { ok: false, message: r.error.message };
  }
  /** Bring a part of this patch up to the newest version in My parts (its uses keep their values where the knob is still there). */
  updateFromMyParts(defId: string): { ok: boolean; message: string } {
    const status = this.myPartStatus(defId);
    if (!status.entry || !status.newer) return { ok: false, message: 'There is no newer version in My parts.' };
    const r = this.commit([{ op: 'replacePart', part: defId, bundle: status.newer.bundle, from: { id: status.entry.id, version: status.newer.version, hash: bundleHash(status.newer.bundle) } }], { label: `Update ${status.entry.name} to v${status.newer.version}` });
    return r.ok ? { ok: true, message: `Updated to v${status.newer.version}.` } : { ok: false, message: r.error.message };
  }
  removeFromMyParts(id: string): boolean {
    if (!this.myParts.value.parts[id]) return false;
    return this.storeMyParts(removeFromLibrary(this.myParts.value, id));
  }
  /** My parts as a file, with the pictures and fonts their faces use inside (so it opens on another machine). */
  async exportMyParts(ids?: readonly string[]): Promise<string> {
    const assetData: Record<string, string> = {};
    for (const asset of libraryAssets(this.myParts.value, ids)) {
      let data: string | null = null;
      try { data = await this.assets.dataUrl(asset); } catch { /* said below */ }
      if (data) assetData[asset.id] = data; else this.toast('warn', `"${asset.name}" is missing; the file only names it.`);
    }
    return serializeLibrary(this.myParts.value, ids, { assetData });
  }
  importMyParts(text: string): { ok: boolean; message: string; report: Issue[] } {
    const read = parseLibrary(text, catalog);
    if (!read.ok) return { ok: false, message: read.error, report: [] };
    const merged = mergeLibrary(this.myParts.value, read.library);
    if (!this.storeMyParts(merged.library)) return { ok: false, message: 'My parts could not be saved: the browser storage is full.', report: read.report };
    const carried = Object.entries(read.assetData);
    if (carried.length) void Promise.all(carried.map(([id, data]) => this.assets.putDataUrl(id, data))).then(() => this.syncAssets(), () => this.toast('warn', 'Some pictures in that file could not be kept.'));
    const bits = [merged.added.length ? `added ${merged.added.length}` : '', merged.updated.length ? `new versions of ${merged.updated.length}` : ''].filter(Boolean);
    return { ok: true, message: bits.length ? `My parts: ${bits.join(', ')}.` : 'Nothing new in that file.', report: read.report };
  }

  // ---- Faces: a part's own screen on the plugin -------------------------------------------
  /** Put the face of a use on the plugin (in place of the one there, if any). */
  putFace(useId: string, at?: { x: number; y: number }): { ok: boolean; message: string } {
    let made;
    try { made = faceIntents(this.doc.value, catalog, useId, { at }); }
    catch (error) { if (error instanceof FaceError) return { ok: false, message: error.message }; throw error; }
    const r = this.commit(made.intents, { label: `Face of ${useId} on the plugin` });
    if (!r.ok) return { ok: false, message: r.error.message };
    return { ok: true, message: made.notes.length ? made.notes.join(' ') : `The face of ${useId} is on the plugin.` };
  }
  /**
   * Make a part's face from controls and decorations on the plugin (`ids`, the
   * controls wired to `useId`'s parameters); they become that use's face, and
   * the other uses whose face is on the plugin take the new one where they are.
   */
  saveFace(useId: string, ids: readonly string[]): { ok: boolean; message: string } {
    const doc = this.doc.value;
    let taken;
    try { taken = faceFromPlugin(doc, catalog, useId, ids); }
    catch (error) { if (error instanceof FaceError) return { ok: false, message: error.message }; throw error; }
    const def = doc.parts[doc.nodes[useId]!.part!]!;
    const group = faceGroup(useId);
    const intents: Intent[] = [{ op: 'updatePart', part: def.id, face: taken.face }];
    const same = JSON.stringify([...(doc.ui.groups[group] ?? [])].sort()) === JSON.stringify([...taken.members].sort());
    if (!same) {
      if (doc.ui.groups[group]) intents.push({ op: 'ungroup', id: group });
      if (taken.members.length) intents.push({ op: 'group', ids: taken.members, id: group });
    }
    let after: PatchDocument;
    try { after = applyIntents(doc, intents, catalog).doc; }
    catch (error) { if (error instanceof OpError) return { ok: false, message: error.message }; throw error; }
    const others: string[] = [];
    for (const other of usesOf(after, def.id)) {
      if (other.id === useId || !faceOnPlugin(after, other.id).length) continue;
      const made = faceIntents(after, catalog, other.id);
      intents.push(...made.intents);
      after = applyIntents(after, made.intents, catalog).doc;
      others.push(other.id);
    }
    const r = this.commit(intents, { label: `Face of ${def.name}` });
    if (!r.ok) return { ok: false, message: r.error.message };
    const notes = taken.notes.length ? ` ${taken.notes.join(' ')}` : '';
    return { ok: true, message: `${def.name}'s face: ${taken.face.controls.length} control${taken.face.controls.length === 1 ? '' : 's'}, ${taken.face.elements.length} decoration${taken.face.elements.length === 1 ? '' : 's'}${others.length ? `; updated on ${others.join(', ')}` : ''}.${notes}` };
  }

  /**
   * A part that is only a screen: these decorations on the plugin become its
   * face (to keep in My parts and put on other plugins). Its use sits in the
   * main patch; the decorations become that use's face on the plugin.
   */
  makeScreenPart(ids: readonly string[], name?: string): { ok: boolean; message: string; use?: string } {
    let made;
    try { made = screenPartIntents(this.doc.value, ids, name); }
    catch (error) { if (error instanceof FaceError) return { ok: false, message: error.message }; throw error; }
    const r = this.commit(made.intents, { label: `Screen part ${made.name}` });
    if (!r.ok) return { ok: false, message: r.error.message };
    return { ok: true, message: `Made the screen part “${made.name}” (${made.use}); save it to My parts to put it on other plugins.${made.notes.length ? ` ${made.notes.join(' ')}` : ''}`, use: made.use };
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

  // ---- the sketch (U8c) ----
  /** Where marks belong: the plugin is one place; on the patch, the main patch or the part the person is inside. */
  private markPlace(view: SketchView): string { return view === 'patch' ? this.partPath.value.join('/') : ''; }
  /** The marks on a view, where the person is now. */
  marksHere(view: SketchView): Mark[] { const at = this.markPlace(view); return this.sketch.value[view].filter(m => (m.where ?? '') === at); }
  /** Add a mark to a view's sketch, where the person is; it gets the next number there. */
  addMark(view: SketchView, mark: Omit<Mark, 'id' | 'n' | 'where'>): Mark {
    const at = this.markPlace(view);
    const added: Mark = { ...mark, id: randomId('mark'), n: this.marksHere(view).reduce((n, m) => Math.max(n, m.n), 0) + 1, ...(at ? { where: at } : {}) };
    this.sketch.value = { ...this.sketch.value, [view]: [...this.sketch.value[view], added] };
    return added;
  }
  updateMark(view: SketchView, id: string, patch: Partial<Mark>) {
    this.sketch.value = { ...this.sketch.value, [view]: this.sketch.value[view].map(m => m.id === id ? { ...m, ...patch } : m) };
  }
  removeMark(view: SketchView, id: string) {
    this.sketch.value = { ...this.sketch.value, [view]: this.sketch.value[view].filter(m => m.id !== id) };
  }
  /** Take back the last mark here not sent yet. */
  undoMark(view: SketchView): boolean {
    const last = [...this.marksHere(view)].reverse().find(m => !this.sentMarks.value[m.id]);
    if (!last) return false;
    this.removeMark(view, last.id);
    return true;
  }
  /** Rub out the marks here (all, or only those not sent yet). */
  clearSketch(view: SketchView, onlyUnsent = false) {
    const here = new Set(this.marksHere(view).filter(m => !onlyUnsent || !this.sentMarks.value[m.id]).map(m => m.id));
    this.sketch.value = { ...this.sketch.value, [view]: this.sketch.value[view].filter(m => !here.has(m.id)) };
  }
  /** The marks here not sent yet: what goes with the next request. */
  unsentMarks(view: SketchView): Mark[] { return this.marksHere(view).filter(m => !this.sentMarks.value[m.id]); }
  markSent(ids: readonly string[], request: string) { this.sentMarks.value = { ...this.sentMarks.value, ...Object.fromEntries(ids.map(id => [id, request])) }; }
  /**
   * The request is over: its marks go (pinned ones become new marks again). `keep`: it did nothing (failed, stopped,
   * not understood), so they become new marks for the next try.
   */
  releaseSent(request: string, keep = false) {
    const done = new Set(Object.entries(this.sentMarks.value).filter(([, r]) => r === request).map(([id]) => id));
    if (!done.size) return;
    this.sentMarks.value = Object.fromEntries(Object.entries(this.sentMarks.value).filter(([id]) => !done.has(id)));
    if (keep || this.inkPinned.value) return;
    for (const view of ['plugin', 'patch'] as const) if (this.sketch.value[view].some(m => done.has(m.id))) this.sketch.value = { ...this.sketch.value, [view]: this.sketch.value[view].filter(m => !done.has(m.id)) };
  }

  /** What the person is looking at now. */
  seeingNow(): Seeing { return { ...this.seeing.value, ...(this.viewDetails?.() ?? {}) }; }

  /** Where a view is on the page (CSS pixels): the plugin, the patch, the whole working area, or the window. */
  viewRect(which: 'plugin' | 'patch' | 'workspace' | 'window'): { x: number; y: number; width: number; height: number } | null {
    if (typeof document === 'undefined') return null;
    if (which === 'window') return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
    const selector = which === 'plugin' ? '[data-testid=plugin-view] [data-testid=panel]' : which === 'patch' ? '[data-testid=patch-view]' : '[data-testid=workspace]';
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    // Only what is on screen.
    const x = Math.max(0, r.left), y = Math.max(0, r.top), right = Math.min(window.innerWidth, r.right), bottom = Math.min(window.innerHeight, r.bottom);
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
  }

  /** Look the plugin over (the screen checks) as it is drawn now; with `picture`, a PNG of it too. */
  look(options: { picture?: boolean; doc?: PatchDocument } = {}): Promise<LookResult> {
    return lookAt(options.doc ?? this.doc.value, catalog, { generated: this.generated.value, assetUrls: this.assetUrls.value, analyser: probe => probe >= 0 ? this.engine.probeAnalysers[probe] ?? null : this.engine.outAnalyser, picture: options.picture, pod: this.pod });
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
    // A knob may stand for several AudioParams (each use of a part, each copy of a spread knob) or none (a use's parameter
    // sets it): the patch is expanded again and every AudioParam whose value moved is sent.
    if (!structural && ops.length) {
      if (!ops.some(op => op.op === 'setValue' || (op.op === 'setField' && op.field === 'spread'))) return;
      const g = this.generated.value;
      const next = currentValues(this.doc.value, catalog, g, this.solo.value ? { solo: this.solo.value } : {});
      let changed = false;
      for (const [name, value] of Object.entries(next)) if (g.values[name] !== value) { this.engine.setParam(name, value); changed = true; }
      if (changed) this.generated.value = { ...g, values: next };
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
      case 'makePart': return 'Make a part';
      case 'unpackPart': return 'Unpack a part';
      case 'detachPart': return 'Own copy of a part';
      case 'addParam': return `Show ${i.node}.${i.port} on the part`;
      case 'removeParam': return `Hide ${i.id} from the part`;
      case 'updatePart': return i.name !== undefined ? 'Rename a part' : 'Describe a part';
      default: return i.op;
    }
  }
  return `${intents.length} edits`;
}

function safeStorage(): StorageLike | null {
  try { const s = globalThis.localStorage; s.setItem('den-kit:probe', '1'); s.removeItem('den-kit:probe'); return s; } catch { return null; }
}
