// The LLM's workbench. Every kit_* tool call runs here, in the browser, against
// the live patch: an edit is tried on a copy first (validated and compiled), and
// only an edit that passes lands on the live patch, at once, as one step of the
// request. A failing edit never lands; its problems go back to the model. The
// controller (src/ai/llm.ts) makes the steps of one request one undo step.
import type { Catalog, PortDef } from '../core/catalog.ts';
import { generate, type Generated } from '../core/codegen.ts';
import { describePatch } from '../core/describe.ts';
import { formatIssue, type Issue } from '../core/issues.ts';
import { applyIntents, OpError, type Intent } from '../core/ops.ts';
import { PHRASES, phraseEvents, type Phrase } from '../core/phrases.ts';
import type { PatchDocument, PortSpec } from '../core/schema.ts';
import { validate } from '../core/validate.ts';
import { latest, type Library } from '../core/library.ts';
import { placeNewNodes } from '../core/layout.ts';
import { pngDataUrl, type TestSignal } from '../core/analysis.ts';
import type { RenderRequest } from '../compile/protocol.ts';
import { compileInputs } from '../compile/compile-client.ts';
import type { Rendered } from '../compile/render-client.ts';
import { describePlugin, describeUiOp, expandOps, screenChanged, uiReference } from './plugin-tools.ts';
import { PICTURE_DOC, SHOWCASE_ASSETS } from '../showcase/assets.ts';
import { checkPlugin, formatPluginIssue } from '../plugin/checks.ts';
import type { LookResult } from '../plugin/look.ts';

import type { LlmRole, ToolOutput } from './protocol.ts';
import { reportOf, type MemberReport } from './members.ts';
import type { PodRunResult } from '../pod/host.ts';
import type { PartReport } from '../pod/pod-session.ts';
import { projectPath } from '../pod/host.ts';

export type { ToolOutput };

/** What the workspace may do with the pod (the screen project's workbench: bash, git, Node, npm). */
export interface PodAccess {
  /** Why it cannot be used and what fixes that; null when it can. */
  unavailable(): { reason: string; fix?: string } | null;
  /** Started and in step with the work (the first call boots it: up to a few minutes on a fresh pod). */
  ensure(): Promise<void>;
  bash(command: string, timeoutMs: number): Promise<PodRunResult>;
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, text: string): Promise<void>;
  /** The project's files that differ from the work (null: deleted), and what was left out. */
  collect(): Promise<{ files: Record<string, string | null>; skipped: string[] }>;
  /** The project's folder in the pod. */
  projectDir(): string;
  /** The code parts on the plugin as they reported (element id → report). */
  parts(): Record<string, PartReport>;
  status(): { state: string; message: string; portal: string | null };
}

export interface WorkspaceDeps {
  catalog: Catalog;
  /** Compile a generated program; resolves with problems instead of throwing. */
  compile(generated: Generated, doc: PatchDocument): Promise<{ ok: true; ms: number } | { ok: false; message: string; issues: Issue[] }>;
  render(request: Omit<RenderRequest, 'id' | 'kind'>): Promise<Rendered>;
  /** The model accepts images (spectrograms). */
  images: boolean;
  /** The live patch as it is now. */
  read(): PatchDocument;
  /** Put checked edits on the live patch as one step of this request. */
  land(intents: Intent[], label: string): { ok: true } | { ok: false; message: string };
  /** Draw the plugin and look it over (and take a picture when `picture`). */
  look(doc: PatchDocument, picture: boolean): Promise<LookResult>;
  /** A picture asset, made small enough to send, with its main colours (null: no such picture, or it cannot be read). */
  viewPicture?(id: string): Promise<Picture | null>;
  /** What the person changed on the screen by hand (handEdits in plugin-tools.ts). */
  handEdits?(): string[];
  /** The person's saved parts (My parts), to list and place. */
  myParts?(): Library;
  /** The pod (absent in tests that do not need it: its tools then say there is none). */
  pod?: PodAccess;
  /** Alone, the lead of a team, or a member (U8). */
  role?: LlmRole;
  /** Why an edit (the live patch → the patch with it) is outside what this AI may change now; null: it may. */
  scope?(before: PatchDocument, after: PatchDocument): string | null;
  /** Why this AI may not use the screen project now (a member without it, the lead while a member holds it); null: it may. */
  project?(): string | null;
  /** The lead's team (kit_delegate, kit_wait, kit_tell, kit_stop_member). */
  team?: Team;
}
/** What a lead does with its members (src/ai/llm.ts runs them). */
export interface Team {
  delegate(args: unknown): ToolOutput | Promise<ToolOutput>;
  wait(args: unknown): Promise<ToolOutput>;
  tell(args: unknown): ToolOutput | Promise<ToolOutput>;
  stop(args: unknown): ToolOutput;
  /** Members still working ("m1 “Sound”"). */
  working(): string[];
}
export interface Picture { png: Uint8Array | null; width: number; height: number; palette: Array<{ color: string; share: number }> }

const MAX_TEXT = 24000;
const clip = (s: string, n = MAX_TEXT) => s.length > n ? `${s.slice(0, n - 30)}\n… (cut, ${s.length} chars)` : s;
const issueKey = (i: Issue) => `${i.code}|${i.node ?? ''}|${i.port ?? ''}|${i.edge ?? ''}`;
const TOOLS = 'kit_get_patch, kit_list_blocks, kit_describe_block, kit_apply_ops, kit_write_codebox, kit_listen, kit_get_plugin, kit_ui_reference, kit_view_picture, kit_look, kit_bash, kit_read_file, kit_write_file, kit_finish';
const TEAM_TOOLS = new Set(['kit_delegate', 'kit_wait', 'kit_tell', 'kit_stop_member']);
/** Kept of a command's output for the model (the end, where errors are). */
const MAX_COMMAND_TEXT = 12000;
const clipEnd = (s: string, n = MAX_COMMAND_TEXT) => s.length > n ? `[… ${s.length - n} characters cut]\n${s.slice(-n)}` : s;

export class LlmWorkspace {
  summary: string | null = null;
  /** How many steps landed on the live patch. */
  landed = 0;
  /** Short human-readable steps for the request's line in the history. */
  readonly steps: string[] = [];
  /** The screen changed since the model last looked at it (kit_finish asks it to look first, once). */
  private unseen = false;
  /** This request changed the plugin screen. */
  screenTouched = false;
  /** This request changed the screen project (den-kit commits it in the pod's git at the end). */
  projectTouched = false;
  /** Edits refused because they were outside this AI's scope. */
  refused = 0;
  /** A member's report to the lead (its kit_finish). */
  report: MemberReport | null = null;
  private remindedToLook = false;
  private readonly deps: WorkspaceDeps;

  constructor(deps: WorkspaceDeps) { this.deps = deps; }

  async call(tool: string, args: unknown): Promise<ToolOutput> {
    const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
    try {
      switch (tool) {
        case 'kit_get_patch': return this.getPatch();
        case 'kit_list_blocks': return this.listBlocks(typeof a.category === 'string' ? a.category : undefined);
        case 'kit_describe_block': return this.describeBlock(String(a.type ?? ''));
        case 'kit_apply_ops': return await this.applyOps(a.ops);
        case 'kit_write_codebox': return await this.writeCodebox(a);
        case 'kit_listen': return await this.listen(typeof a.phrase === 'string' ? a.phrase : undefined, typeof a.seconds === 'number' ? a.seconds : undefined);
        case 'kit_get_plugin': {
          const doc = this.deps.read();
          // ("part" was its name before U5; an old habit still works.)
          const canvas = typeof a.canvas === 'string' && a.canvas ? a.canvas : typeof a.part === 'string' && a.part ? a.part : undefined;
          return { success: true, text: clip(describePlugin(doc, this.deps.catalog, { canvas, problems: canvas ? undefined : checkPlugin(doc, this.deps.catalog).map(formatPluginIssue), handEdits: this.deps.handEdits?.(), parts: this.deps.pod?.parts() })) };
        }
        case 'kit_look': return await this.look();
        case 'kit_ui_reference': return { success: true, text: uiReference(typeof a.topic === 'string' ? a.topic : undefined, typeof a.control === 'string' ? a.control : undefined, this.deps.catalog) };
        case 'kit_view_picture': return await this.viewPicture(String(a.id ?? ''));
        case 'kit_bash': return await this.bash(typeof a.command === 'string' ? a.command : '', typeof a.timeout_s === 'number' ? a.timeout_s : undefined);
        case 'kit_read_file': return await this.readFile(a.path, typeof a.from_line === 'number' ? a.from_line : undefined, typeof a.to_line === 'number' ? a.to_line : undefined);
        case 'kit_write_file': return await this.writeFile(a.path, a.content);
        case 'kit_finish': {
          const working = this.deps.team?.working() ?? [];
          if (working.length) return { success: false, text: `Members are still working (${working.join(', ')}). Wait for them with kit_wait (or stop one with kit_stop_member), check their work, then finish.` };
          if (this.unseen && !this.remindedToLook) {
            this.remindedToLook = true;
            return { success: false, text: 'You changed the plugin screen but have not looked at it since. Call kit_look (it checks overlaps, text that does not fit, contrast and more), fix what it finds, then call kit_finish again.' };
          }
          this.summary = String(a.summary ?? '').slice(0, 400) || null;
          if (this.deps.role === 'member') { this.report = reportOf(a); return { success: true, text: 'Reported to the lead. Your edits are already on the live patch.' }; }
          return { success: true, text: 'OK. Your edits are already on the live patch; the user can undo the whole request with one ⌘Z.' };
        }
        default:
          if (TEAM_TOOLS.has(tool)) return await this.team(tool, args);
          return { success: false, text: `Unknown tool "${tool}". Available: ${TOOLS}.` };
      }
    } catch (error) {
      return { success: false, text: `Tool failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  // ---- the team (U8) ---------------------------------------------------------------
  private async team(tool: string, args: unknown): Promise<ToolOutput> {
    const team = this.deps.team;
    if (!team || this.deps.role !== 'lead') return { success: false, text: this.deps.role === 'member' ? 'Members cannot start or manage members; only the lead does. Do your part and report in kit_finish.' : 'Members are off for this request (the person turned them off): do the work yourself.' };
    switch (tool) {
      case 'kit_delegate': return await team.delegate(args);
      case 'kit_wait': return await team.wait(args);
      case 'kit_tell': return await team.tell(args);
      default: return team.stop(args);
    }
  }

  // ---- reading -----------------------------------------------------------------
  private getPatch(): ToolOutput {
    const { catalog } = this.deps;
    const doc = this.deps.read();
    const nodes = Object.values(doc.nodes).map(n => {
      const def = catalog.find(n.type);
      const config = Object.fromEntries(Object.entries(n.config).filter(([k, v]) => def?.config.find(c => c.id === k)?.default !== v));
      return { id: n.id, type: n.type, title: def?.title, label: n.label, inside: n.inside, part: n.part, count: n.count, spread: n.spread, config: Object.keys(config).length ? config : undefined, values: Object.keys(n.values).length ? n.values : undefined, ports: n.ports, code: n.code ? clip(n.code, 4000) : undefined, text: n.text };
    });
    const cables = Object.values(doc.edges).map(e => `${e.from.node}.${e.from.port} -> ${e.to.node}.${e.to.port}`);
    const problems = validate(doc, catalog).issues.filter(i => i.severity !== 'info').map(formatIssue);
    const text = JSON.stringify({ name: doc.name, nodes, cables, problems }, null, 1);
    const onPlugin = Object.values(doc.nodes).filter(n => n.panel && catalog.find(n.type)?.kind === 'widget').length;
    const screen = `The plugin screen (${doc.panel.width}×${doc.panel.height}): ${onPlugin} control${onPlugin === 1 ? '' : 's'} and ${Object.keys(doc.ui.elements).length} decoration${Object.keys(doc.ui.elements).length === 1 ? '' : 's'} — kit_get_plugin shows it.`;
    return { success: true, text: clip(`${describePatch(doc, catalog, { maxChars: 6000, includeIssues: false })}\n${screen}\n\n${text}`) };
  }

  private listBlocks(category?: string): ToolOutput {
    const list = this.deps.catalog.list().filter(d => d.kind !== 'comment' && (d.palette !== 'never' || d.kind === 'part') && (!category || d.category === category));
    if (!list.length) return { success: false, text: `No module types in category "${category}". Categories: ${[...new Set(this.deps.catalog.list().map(d => d.category))].join(', ')}.` };
    const mine = Object.values(this.deps.myParts?.().parts ?? {});
    const shelf = !category && mine.length ? `\n\nMy parts (the person's saved parts; place one with {"op":"placeMyPart","id":"<id>"}; it comes in with one use, and its definition is then a part of this patch):\n${mine.map(p => {
      const v = latest(p), def = v.bundle.part;
      const ports = (list: Array<{ id: string; label?: string }>) => list.map(q => q.label ?? q.id).join(', ') || 'none';
      return `${p.id} — ${p.name} (v${v.version})${p.doc ? `: ${p.doc.replace(/[.。]$/, '')}` : ''}. Inputs: ${ports(def.inputs)}. Parameters: ${ports(def.params)}. Outputs: ${ports(def.outputs)}.`;
    }).join('\n')}` : '';
    return { success: true, text: list.map(d => `${d.type} — ${d.title} (${d.category}): ${d.summary}`).join('\n') + shelf };
  }

  private describeBlock(type: string): ToolOutput {
    const { catalog } = this.deps;
    const def = catalog.find(type);
    if (!def) {
      const near = catalog.list().filter(d => d.type.includes(type.replace(/^\w+\./, '')) || d.title.toLowerCase().includes(type.toLowerCase())).map(d => d.type).slice(0, 8);
      return { success: false, text: `Unknown module type "${type}".${near.length ? ` Did you mean: ${near.join(', ')}?` : ' Use kit_list_blocks.'}` };
    }
    const probe = { id: 'probe', type, pos: { x: 0, y: 0 }, config: {}, values: {} };
    const input = (p: PortDef) => ({ id: p.id, signal: p.type, unit: p.unit, min: p.min, max: p.max, default: p.default, roles: p.roles, unconnected: p.role === 'audio' ? 'silent (audio input)' : p.binding ? `follows the note ${p.binding}` : p.fallback ? `uses ${p.fallback}` : p.constant ? 'fixed at its default' : 'knob', doc: p.doc });
    const text = JSON.stringify({
      type: def.type, title: def.title, category: def.category, summary: def.summary, doc: def.doc,
      runs: def.scope === 'global' ? 'once (not per voice)' : 'per voice inside Voice In … Voice Mix, otherwise once',
      inputs: catalog.inputs(probe).filter(p => !p.hidden).map(input),
      outputs: catalog.outputs(probe).map(p => ({ id: p.id, signal: p.type })),
      config: def.config.map(c => ({ id: c.id, kind: c.kind, options: c.options, default: c.default, min: c.min, max: c.max, doc: c.doc })),
    }, null, 1);
    return { success: true, text };
  }

  // ---- editing ---------------------------------------------------------------------
  private async applyOps(ops: unknown): Promise<ToolOutput> {
    if (!Array.isArray(ops) || !ops.length) return { success: false, text: 'ops must be a non-empty array of edit objects.' };
    const { catalog } = this.deps;
    const before = this.deps.read();
    const refuse = (error: OpError, at: number) => ({ success: false, text: `Edit #${at + 1} (${JSON.stringify(ops[at]).slice(0, 200)}) was rejected: ${error.message}${error.hint ? ` ${error.hint}` : ''}\nNothing was applied; fix it and send the whole list again.` });
    let expanded, trial;
    try {
      expanded = expandOps(before, catalog, ops, { myParts: this.deps.myParts?.() });
      trial = applyIntents(before, expanded.intents, catalog);
    } catch (error) {
      if (error instanceof OpError) return refuse(error, expanded ? expanded.origin[error.index] ?? error.index : error.index);
      throw error;
    }
    // New modules, decorations, groups and parts get their ids now, so the edit lands on the live patch exactly as tried here.
    const madeBy = (i: number) => trial.created.filter((_, j) => trial.createdBy[j] === i);
    const intents = expanded.intents.map((o, i): Intent => {
      const id = madeBy(i)[0];
      if (!id) return o;
      if (o.op === 'addNode') return { ...o, node: { ...o.node, id } };
      if (o.op === 'addElement') return { ...o, element: { ...o.element, id } };
      if (o.op === 'group') return { ...o, id };
      if (o.op === 'makePart') return { ...o, node: id, id: o.id ?? trial.doc.nodes[id]?.part };
      if (o.op === 'importPart') return { ...o, node: id };
      return o;
    });
    // Modules added without a position go next to what they connect to (never on top of others).
    const toPlace = intents.flatMap(o => o.op === 'addNode' && !o.node.pos ? [o.node.id!] : []);
    const moves = toPlace.length ? placeNewNodes(trial.doc, catalog, toPlace) : [];
    const doc = moves.length ? applyIntents(trial.doc, moves, catalog).doc : trial.doc;
    const what = describeOps(intents, trial.created);
    const notes = expanded.notes.length ? ` ${expanded.notes.join(' ')}` : '';
    return this.landChecked(before, doc, [...intents, ...moves], what, `${ops.length} edit${ops.length === 1 ? '' : 's'}${trial.created.length ? ` (new ids: ${trial.created.join(', ')})` : ''}${notes}`);
  }

  private async writeCodebox(a: Record<string, unknown>): Promise<ToolOutput> {
    const node = String(a.node ?? '');
    const before = this.deps.read();
    const target = before.nodes[node];
    if (!target) return { success: false, text: `No module "${node}". Add one first: kit_apply_ops [{"op":"addNode","node":{"id":"${node || 'box1'}","type":"kit.codebox"}}].` };
    if (target.type !== 'kit.codebox') return { success: false, text: `"${node}" is a ${target.type}, not a codebox.` };
    const ports = (list: unknown): PortSpec[] => Array.isArray(list) ? list.map(p => ({ id: String((p as PortSpec).id), type: (p as PortSpec).type === 'gate' ? 'gate' : 'signal' })) : [];
    const intents: Intent[] = [{ op: 'setCode', node, code: String(a.code ?? ''), ports: { inputs: ports(a.inputs), outputs: ports(a.outputs) } }];
    let trial;
    try { trial = applyIntents(before, intents, this.deps.catalog); }
    catch (error) { if (error instanceof OpError) return { success: false, text: `Rejected: ${error.message}${error.hint ? ` ${error.hint}` : ''}` }; throw error; }
    return this.landChecked(before, trial.doc, intents, `wrote codebox ${node}`, 'the code');
  }

  /**
   * Check `doc` (the live patch with the edit tried on it): no new validation
   * errors, and it compiles. Then land the edit; otherwise report and land nothing.
   */
  private async landChecked(before: PatchDocument, doc: PatchDocument, intents: Intent[], step: string, what: string): Promise<ToolOutput> {
    const { catalog } = this.deps;
    const reject = (problem: string): ToolOutput => {
      this.steps.push(`${step} — not applied`);
      return { success: false, text: `${problem}\nNothing was applied (the live patch is unchanged). Fix it and send the whole edit again.` };
    };
    const held = this.deps.scope?.(before, doc);
    if (held) { this.refused++; return reject(held); }
    const existing = new Set(validate(before, catalog).issues.filter(i => i.severity === 'error').map(issueKey));
    const problems = validate(doc, catalog).issues.filter(i => i.severity === 'error' && !existing.has(issueKey(i)));
    if (problems.length) return reject(`It would not validate:\n${problems.slice(0, 12).map(formatIssue).join('\n')}`);
    const generated = generate(doc, catalog);
    let report: string;
    if (!generated.source) {
      const blocking = generated.issues.filter(i => i.severity === 'error');
      const before_ = new Set(generate(before, catalog).issues.filter(i => i.severity === 'error').map(issueKey));
      const fresh = blocking.filter(i => !before_.has(issueKey(i)));
      if (fresh.length) return reject(`It would not compile:\n${fresh.map(formatIssue).join('\n')}`);
      report = blocking.length ? `The patch still has problems from before:\n${blocking.slice(0, 6).map(formatIssue).join('\n')}` : 'Nothing reaches Out yet, so it is silent.';
    } else if (generated.hash && generated.hash === generate(before, catalog).hash) {
      report = 'The sound is unchanged.'; // screen-only edits (and knob values) need no compile
    } else {
      const compiled = await this.deps.compile(generated, doc);
      if (!compiled.ok) return reject(`It would not compile: ${compiled.message}\n${compiled.issues.slice(0, 12).map(formatIssue).join('\n')}`);
      report = `Compiled OK in ${(compiled.ms / 1000).toFixed(1)} s.`;
    }
    const landed = this.deps.land(intents, step);
    if (!landed.ok) {
      this.steps.push(`${step} — not applied`);
      return { success: false, text: `Not applied: ${landed.message} Call kit_get_patch to see the patch as it is now, then try again.` };
    }
    this.landed++;
    if (screenChanged(before, doc, catalog)) { this.unseen = true; this.screenTouched = true; }
    this.steps.push(generated.source ? `${step} ✓` : step);
    return { success: true, text: `Applied ${what}; it is live now. ${report}` };
  }

  // ---- looking ---------------------------------------------------------------------------
  private async viewPicture(id: string): Promise<ToolOutput> {
    const doc = this.deps.read();
    const asset = doc.assets[id] ?? SHOWCASE_ASSETS[id];
    if (!asset || !asset.mime.startsWith('image/')) {
      const pictures = Object.values(doc.assets).filter(a => a.mime.startsWith('image/')).map(a => a.id);
      return { success: false, text: `No picture "${id}". ${pictures.length ? `Pictures in this patch: ${pictures.join(', ')}.` : 'This patch has no pictures.'} Bundled ones: kit_ui_reference "pictures".` };
    }
    const seen = await this.deps.viewPicture?.(id) ?? null;
    if (!seen) return { success: false, text: `The picture "${id}" could not be read in this browser.` };
    this.steps.push(`looked at the picture ${id}`);
    const palette = seen.palette.map(p => `${p.color} (${Math.round(p.share * 100)}%)`).join(', ');
    const where = PICTURE_DOC[id] ? ` ${PICTURE_DOC[id]}` : asset.source?.title ? ` (${asset.source.title})` : '';
    return { success: true, text: `Picture ${id}${where}: ${asset.width ?? seen.width}×${asset.height ?? seen.height}. Main colours: ${palette}.${this.deps.images && seen.png ? ' The picture is attached.' : ''}`, imageDataUrl: this.deps.images && seen.png ? pngDataUrl(seen.png) : undefined };
  }

  private async look(): Promise<ToolOutput> {
    const doc = this.deps.read();
    const seen = await this.deps.look(doc, this.deps.images);
    this.unseen = false;
    const errors = seen.issues.filter(i => i.severity === 'error').length;
    this.steps.push(`looked at the screen (${seen.issues.length ? `${seen.issues.length} to fix` : 'fine'})`);
    const head = `Looked at the plugin (${doc.panel.width}×${doc.panel.height}).${this.deps.images && seen.png ? ' The picture is attached.' : ''}`;
    const body = seen.issues.length ? `${seen.issues.length} thing${seen.issues.length === 1 ? '' : 's'} to fix${errors ? ` (${errors} serious)` : ''}:\n${seen.issues.map(i => `- ${formatPluginIssue(i)}`).join('\n')}` : 'The checks found nothing to fix (overlaps, edges, text that does not fit, contrast, labels, wiring, pictures, canvases).';
    return { success: true, text: `${head}\n${body}`, imageDataUrl: this.deps.images && seen.png ? pngDataUrl(seen.png) : undefined };
  }

  // ---- the pod: the screen project ---------------------------------------------------------
  /** The pod, or why the tools cannot use it. */
  private async pod(write = true): Promise<PodAccess | ToolOutput> {
    const held = write ? this.deps.project?.() : null;
    if (held) return { success: false, text: held };
    const pod = this.deps.pod;
    const instead = 'Until then, build the screen from den-kit\'s controls, decorations and canvases.';
    if (!pod) return { success: false, text: `This den-kit has no pod, so the screen project cannot be used. ${instead}` };
    const off = pod.unavailable();
    if (off) return { success: false, text: `The pod is not available: ${off.reason}${off.fix ? ` (Tell the person: ${off.fix})` : ''} ${instead}` };
    try { await pod.ensure(); } catch (error) {
      const status = pod.status();
      return { success: false, text: `The pod did not start: ${error instanceof Error ? error.message : String(error)} (state: ${status.state}; ${status.message}). If the project itself is broken (package.json, vite.config.ts), fix it and try again; otherwise ${instead.toLowerCase()}` };
    }
    return pod;
  }

  /** Read the project back and keep what changed in the work (one step of this request); a line for the model. */
  private async keepProject(pod: PodAccess, what: string): Promise<string> {
    const { files, skipped } = await pod.collect();
    const paths = Object.keys(files).sort();
    const lines: string[] = [];
    if (paths.length) {
      const before = this.deps.read().project?.files ?? {};
      const landed = this.deps.land([{ op: 'setProjectFiles', files }], what);
      const list = paths.map(p => `${p} (${files[p] === null ? 'deleted' : p in before ? 'changed' : 'new'})`);
      if (landed.ok) {
        this.landed++;
        this.screenTouched = true; this.projectTouched = true;
        this.steps.push(`kept ${paths.length === 1 ? paths[0] : `${paths.length} files`} in the work ✓`);
        if (paths.some(p => p.startsWith('src/'))) this.unseen = true;
        lines.push(`Kept in the work: ${list.slice(0, 30).join(', ')}${list.length > 30 ? `, and ${list.length - 30} more` : ''}.`);
      } else lines.push(`The project changed (${list.slice(0, 10).join(', ')}) but could not be kept in the work: ${landed.message}`);
    }
    if (skipped.length) lines.push(`Not kept: ${skipped.slice(0, 10).join('; ')}.`);
    return lines.join('\n');
  }

  /** What the code parts on the plugin say now (errors first), after giving them a moment to reload. */
  private async partNews(pod: PodAccess, waitMs: number): Promise<string> {
    const shown = Object.values(this.deps.read().ui.elements).filter(e => e.kind === 'code');
    if (!shown.length) return '';
    if (waitMs) await new Promise(r => setTimeout(r, waitMs));
    const reports = pod.parts();
    const lines = shown.map(el => {
      const r = reports[el.id];
      if (!r) return `${el.id} (part "${el.kind === 'code' ? el.part : ''}"): not loaded yet`;
      const logs = r.logs.filter(l => /^(error|warn)/.test(l)).slice(-3);
      return `${el.id} (part "${r.part}"): ${r.state}${r.error ? ` — ${r.error}` : ''}${logs.length && !r.error ? ` · ${logs.join(' · ')}` : ''}`;
    });
    return `Code parts on the plugin: ${lines.join('; ')}.`;
  }

  private async bash(command: string, timeoutS?: number): Promise<ToolOutput> {
    if (!command.trim()) return { success: false, text: 'Give a command (bash, run in the screen project\'s folder).' };
    const pod = await this.pod(); if (!('bash' in pod)) return pod;
    const seconds = Math.min(600, Math.max(1, timeoutS ?? 120));
    const r = await pod.bash(command, seconds * 1000);
    this.steps.push(`ran \`${command.length > 48 ? `${command.slice(0, 47)}…` : command}\`${r.exitCode === 0 ? '' : ` (exit ${r.exitCode ?? 'none'})`}`);
    const kept = await this.keepProject(pod, `ran ${command.slice(0, 40)}`);
    const news = await this.partNews(pod, kept.startsWith('Kept') ? 1500 : 0);
    const status = r.timedOut ? `stopped after ${seconds} s (give timeout_s for longer commands, up to 600)` : r.exitCode === null ? 'ended without an exit status' : `exit ${r.exitCode}`;
    const dev = pod.status();
    return {
      success: true,
      text: [`$ ${command}`, clipEnd(r.output) || '(no output)', `[${status} · ${(r.ms / 1000).toFixed(1)} s]`, kept, news, dev.state === 'ready' ? '' : `Dev server: ${dev.state} — ${dev.message}`].filter(Boolean).join('\n'),
    };
  }

  private async readFile(path: unknown, from?: number, to?: number): Promise<ToolOutput> {
    const pod = await this.pod(false); if (!('bash' in pod)) return pod;
    const p = projectPath(path, pod.projectDir());
    if (!p.ok) return { success: false, text: p.message };
    const text = await pod.readFile(p.path);
    if (text === null) return { success: false, text: `There is no file ${p.path} in the project. (kit_bash "git ls-files" lists them.)` };
    const lines = text.split('\n');
    const a = Math.max(1, Math.floor(from ?? 1)), b = Math.min(lines.length, Math.floor(to ?? lines.length));
    const shown = lines.slice(a - 1, b).join('\n');
    const head = `${p.path} (${lines.length} lines${a > 1 || b < lines.length ? `; lines ${a}–${b}` : ''})`;
    if (shown.length > 60000) return { success: true, text: `${head}, too long to show at once: read it in parts with from_line and to_line.\n${shown.slice(0, 60000)}` };
    return { success: true, text: `${head}:\n${shown}` };
  }

  private async writeFile(path: unknown, content: unknown): Promise<ToolOutput> {
    const pod = await this.pod(); if (!('bash' in pod)) return pod;
    const p = projectPath(path, pod.projectDir());
    if (!p.ok) return { success: false, text: p.message };
    if (typeof content !== 'string') return { success: false, text: 'content is the whole text of the file.' };
    if (p.path === 'src/kit/controls.ts') return { success: false, text: 'src/kit/controls.ts is made by den-kit from the patch (the controls and their ranges); change the patch\'s controls instead.' };
    await pod.writeFile(p.path, content);
    const kept = await this.keepProject(pod, `wrote ${p.path}`);
    const news = await this.partNews(pod, p.path.startsWith('src/') ? 1500 : 0);
    return { success: true, text: [`Wrote ${p.path} (${content.split('\n').length} lines).`, kept, news, 'Check it with kit_bash "npm run check" (TypeScript) and "npm run lint"; see it with kit_look.'].filter(Boolean).join('\n') };
  }

  // ---- listening ---------------------------------------------------------------------
  private async listen(phrase?: string, seconds?: number): Promise<ToolOutput> {
    const { catalog } = this.deps;
    const doc = this.deps.read();
    const generated = generate(doc, catalog);
    if (!generated.source) return { success: false, text: 'There is nothing to play: the patch does not compile or nothing reaches Out. Fix that first (kit_get_patch shows the problems).' };
    const effect = generated.audioIn;
    let request: Omit<RenderRequest, 'id' | 'kind'>;
    const base = { source: generated.source, ...compileInputs(doc, generated), params: { ...generated.values }, image: this.deps.images };
    if (effect) {
      const input: TestSignal = phrase === 'drums' || phrase === 'noise' ? phrase : 'chords';
      request = { ...base, seconds: Math.min(8, seconds ?? 4), events: [], notes: { onSamples: [], offSamples: [] }, input };
    } else {
      const chosen: Phrase = phrase === 'chord' || phrase === 'chords' ? PHRASES.pad : phrase === 'hits' || phrase === 'drums' ? PHRASES.percussion : phrase === 'bass' ? PHRASES.bass : (generated.voices && (doc.nodes[Object.keys(doc.nodes).find(id => doc.nodes[id]!.type === 'kit.voiceIn') ?? '']?.config.mode === 'poly') ? PHRASES.pad : PHRASES.bass);
      const length = chosen.quanta * 128 / 48000 + 1;
      const s = Math.min(8, seconds ?? length);
      const events = phraseEvents(chosen, Math.floor(s * 48000 / 128));
      request = { ...base, seconds: s, events, notes: { onSamples: events.filter(e => (e.payload as { type: string }).type === 'noteOn').map(e => e.atSample), offSamples: events.filter(e => (e.payload as { type: string }).type === 'noteOff').map(e => e.atSample) } };
    }
    const rendered = await this.deps.render(request);
    this.steps.push(`listened (${rendered.report.silent ? 'silent' : `${rendered.report.peakDb} dB peak`})`);
    const { summary, ...metrics } = rendered.report;
    return { success: true, text: `${summary}\n${JSON.stringify(metrics)}`, imageDataUrl: rendered.png ? pngDataUrl(rendered.png) : undefined };
  }
}

/** "+ LFO, cable lfo2 → cut1.octaves, filter1.resonance = 2" */
export function describeOps(ops: Intent[], created: string[]): string {
  let k = 0;
  const parts = ops.slice(0, 6).map(o => {
    switch (o.op) {
      case 'addNode': return `+ ${o.node.id ?? created[k++] ?? o.node.type}`;
      case 'removeNode': return `− ${o.id}`;
      case 'connect': return `${o.from.node} → ${o.to.node}.${o.to.port}`;
      case 'disconnect': case 'disconnectInput': return 'unplug';
      case 'setValue': return `${o.node}.${o.port} = ${typeof o.value === 'number' ? +o.value.toFixed(3) : o.value}`;
      case 'setConfig': return `${o.node} ${o.key} = ${o.value}`;
      case 'setCode': return `code ${o.node}`;
      case 'makePart': return `part ${o.name ?? o.id ?? ''}`.trim();
      case 'unpackPart': return `unpack ${o.node}`;
      case 'detachPart': return `own copy of ${o.node}`;
      case 'addParam': return `◆ ${o.node}.${o.port}`;
      case 'removeParam': return `− ◆ ${o.id}`;
      case 'updatePart': return `part ${o.name ?? o.part}`;
      case 'importPart': return `+ ${(o.bundle as { part?: { name?: string } })?.part?.name ?? 'part'}${o.from ? ' from My parts' : ''}`;
      case 'replacePart': return `update ${o.part}`;
      case 'setCount': return `${o.node} ×${o.count}`;
      case 'setSpread': return `${o.node}.${o.port} ${o.spread ? `spread ${o.spread.kind}` : 'same in every copy'}`;
      default: return describeUiOp(o) ?? o.op;
    }
  });
  return parts.join(', ') + (ops.length > 6 ? ` … (+${ops.length - 6})` : '');
}
