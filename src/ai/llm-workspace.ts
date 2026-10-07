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
import { placeNewNodes } from '../core/layout.ts';
import { pngDataUrl, type TestSignal } from '../core/analysis.ts';
import type { RenderRequest } from '../compile/protocol.ts';
import type { Rendered } from '../compile/render-client.ts';
import { describePlugin, describeUiOp, expandOps, screenChanged, uiReference } from './plugin-tools.ts';
import { checkPlugin, formatPluginIssue } from '../plugin/checks.ts';
import type { LookResult } from '../plugin/look.ts';

import type { ToolOutput } from './protocol.ts';

export type { ToolOutput };

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
}

const MAX_TEXT = 24000;
const clip = (s: string, n = MAX_TEXT) => s.length > n ? `${s.slice(0, n - 30)}\n… (cut, ${s.length} chars)` : s;
const issueKey = (i: Issue) => `${i.code}|${i.node ?? ''}|${i.port ?? ''}|${i.edge ?? ''}`;
const TOOLS = 'kit_get_patch, kit_list_blocks, kit_describe_block, kit_apply_ops, kit_write_codebox, kit_listen, kit_get_plugin, kit_ui_reference, kit_look, kit_finish';

export class LlmWorkspace {
  summary: string | null = null;
  /** How many steps landed on the live patch. */
  landed = 0;
  /** Short human-readable steps for the request's line in the history. */
  readonly steps: string[] = [];
  /** The screen changed since the model last looked at it (kit_finish asks it to look first, once). */
  private unseen = false;
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
          const part = typeof a.part === 'string' && a.part ? a.part : undefined;
          return { success: true, text: clip(describePlugin(doc, this.deps.catalog, { part, problems: part ? undefined : checkPlugin(doc, this.deps.catalog).map(formatPluginIssue) })) };
        }
        case 'kit_look': return await this.look();
        case 'kit_ui_reference': return { success: true, text: uiReference(typeof a.topic === 'string' ? a.topic : undefined, typeof a.control === 'string' ? a.control : undefined) };
        case 'kit_finish':
          if (this.unseen && !this.remindedToLook) {
            this.remindedToLook = true;
            return { success: false, text: 'You changed the plugin screen but have not looked at it since. Call kit_look (it checks overlaps, text that does not fit, contrast and more), fix what it finds, then call kit_finish again.' };
          }
          this.summary = String(a.summary ?? '').slice(0, 400) || null;
          return { success: true, text: 'OK. Your edits are already on the live patch; the user can undo the whole request with one ⌘Z.' };
        default: return { success: false, text: `Unknown tool "${tool}". Available: ${TOOLS}.` };
      }
    } catch (error) {
      return { success: false, text: `Tool failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  // ---- reading -----------------------------------------------------------------
  private getPatch(): ToolOutput {
    const { catalog } = this.deps;
    const doc = this.deps.read();
    const nodes = Object.values(doc.nodes).map(n => {
      const def = catalog.find(n.type);
      const config = Object.fromEntries(Object.entries(n.config).filter(([k, v]) => def?.config.find(c => c.id === k)?.default !== v));
      return { id: n.id, type: n.type, title: def?.title, label: n.label, config: Object.keys(config).length ? config : undefined, values: Object.keys(n.values).length ? n.values : undefined, ports: n.ports, code: n.code ? clip(n.code, 4000) : undefined, text: n.text };
    });
    const cables = Object.values(doc.edges).map(e => `${e.from.node}.${e.from.port} -> ${e.to.node}.${e.to.port}`);
    const problems = validate(doc, catalog).issues.filter(i => i.severity !== 'info').map(formatIssue);
    const text = JSON.stringify({ name: doc.name, nodes, cables, problems }, null, 1);
    const onPlugin = Object.values(doc.nodes).filter(n => n.panel && catalog.find(n.type)?.kind === 'widget').length;
    const screen = `The plugin screen (${doc.panel.width}×${doc.panel.height}): ${onPlugin} control${onPlugin === 1 ? '' : 's'} and ${Object.keys(doc.ui.elements).length} decoration${Object.keys(doc.ui.elements).length === 1 ? '' : 's'} — kit_get_plugin shows it.`;
    return { success: true, text: clip(`${describePatch(doc, catalog, { maxChars: 6000, includeIssues: false })}\n${screen}\n\n${text}`) };
  }

  private listBlocks(category?: string): ToolOutput {
    const list = this.deps.catalog.list().filter(d => d.kind !== 'comment' && (!category || d.category === category));
    if (!list.length) return { success: false, text: `No module types in category "${category}". Categories: ${[...new Set(this.deps.catalog.list().map(d => d.category))].join(', ')}.` };
    return { success: true, text: list.map(d => `${d.type} — ${d.title} (${d.category}): ${d.summary}`).join('\n') };
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
      expanded = expandOps(before, catalog, ops);
      trial = applyIntents(before, expanded.intents, catalog);
    } catch (error) {
      if (error instanceof OpError) return refuse(error, expanded ? expanded.origin[error.index] ?? error.index : error.index);
      throw error;
    }
    // New modules get their ids now, so the edit lands on the live patch exactly as tried here.
    let k = 0;
    const intents = expanded.intents.map(o => o.op === 'addNode' ? { ...o, node: { ...o.node, id: trial.created[k++]! } } : o);
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
    if (screenChanged(before, doc, catalog)) this.unseen = true;
    this.steps.push(generated.source ? `${step} ✓` : step);
    return { success: true, text: `Applied ${what}; it is live now. ${report}` };
  }

  // ---- looking ---------------------------------------------------------------------------
  private async look(): Promise<ToolOutput> {
    const doc = this.deps.read();
    const seen = await this.deps.look(doc, this.deps.images);
    this.unseen = false;
    const errors = seen.issues.filter(i => i.severity === 'error').length;
    this.steps.push(`looked at the screen (${seen.issues.length ? `${seen.issues.length} to fix` : 'fine'})`);
    const head = `Looked at the plugin (${doc.panel.width}×${doc.panel.height}).${this.deps.images && seen.png ? ' The picture is attached.' : ''}`;
    const body = seen.issues.length ? `${seen.issues.length} thing${seen.issues.length === 1 ? '' : 's'} to fix${errors ? ` (${errors} serious)` : ''}:\n${seen.issues.map(i => `- ${formatPluginIssue(i)}`).join('\n')}` : 'The checks found nothing to fix (overlaps, edges, text that does not fit, contrast, labels, wiring, pictures, custom parts).';
    return { success: true, text: `${head}\n${body}`, imageDataUrl: this.deps.images && seen.png ? pngDataUrl(seen.png) : undefined };
  }

  // ---- listening ---------------------------------------------------------------------
  private async listen(phrase?: string, seconds?: number): Promise<ToolOutput> {
    const { catalog } = this.deps;
    const doc = this.deps.read();
    const generated = generate(doc, catalog);
    if (!generated.source) return { success: false, text: 'There is nothing to play: the patch does not compile or nothing reaches Out. Fix that first (kit_get_patch shows the problems).' };
    const effect = generated.audioIn;
    let request: Omit<RenderRequest, 'id' | 'kind'>;
    const base = { source: generated.source, nodes: Object.keys(doc.nodes), codeboxes: Object.entries(generated.codeboxes).map(([node, line]) => ({ node, line, code: doc.nodes[node]?.code ?? '', inputs: doc.nodes[node]?.ports?.inputs ?? [], outputs: doc.nodes[node]?.ports?.outputs ?? [] })), params: { ...generated.values }, image: this.deps.images };
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
      default: return describeUiOp(o) ?? o.op;
    }
  });
  return parts.join(', ') + (ops.length > 6 ? ` … (+${ops.length - 6})` : '');
}
