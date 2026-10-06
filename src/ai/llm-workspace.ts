// The LLM's workbench: a draft copy of the patch taken when its turn starts.
// Every kit_* tool call runs here, in the browser, against the draft only; the
// live patch is not touched until the turn ends (then src/core/rebase.ts lands
// the draft as one undoable step).
import type { Catalog, PortDef } from '../core/catalog.ts';
import { generate, type Generated } from '../core/codegen.ts';
import { describePatch } from '../core/describe.ts';
import { formatIssue, type Issue } from '../core/issues.ts';
import { applyIntents, diffDocuments, OpError, type Intent } from '../core/ops.ts';
import { PHRASES, phraseEvents, type Phrase } from '../core/phrases.ts';
import { clone, type PatchDocument, type PortSpec } from '../core/schema.ts';
import { validate } from '../core/validate.ts';
import { pngDataUrl, type TestSignal } from '../core/analysis.ts';
import type { RenderRequest } from '../compile/protocol.ts';
import type { Rendered } from '../compile/render-client.ts';

import type { ToolOutput } from './protocol.ts';

export type { ToolOutput };

export interface WorkspaceDeps {
  catalog: Catalog;
  /** Compile a generated program; resolves with problems instead of throwing. */
  compile(generated: Generated, doc: PatchDocument): Promise<{ ok: true; ms: number } | { ok: false; message: string; issues: Issue[] }>;
  render(request: Omit<RenderRequest, 'id' | 'kind'>): Promise<Rendered>;
  /** The model accepts images (spectrograms). */
  images: boolean;
}

const MAX_TEXT = 24000;
const clip = (s: string, n = MAX_TEXT) => s.length > n ? `${s.slice(0, n - 30)}\n… (cut, ${s.length} chars)` : s;

export class DraftWorkspace {
  readonly base: PatchDocument;
  draft: PatchDocument;
  summary: string | null = null;
  /** A question for the user (kit_ask), shown as buttons when the turn ends. */
  question: { text: string; options: string[] } | null = null;
  /** The draft after the last edit: `ok` = validates and compiles (or nothing changed yet). */
  health: 'ok' | 'invalid' | 'compile-error' | 'silent' = 'ok';
  /** The last problem report (for the user when the draft cannot be applied). */
  problem = '';
  /** Short human-readable steps for the request's line in the history. */
  readonly steps: string[] = [];
  private readonly deps: WorkspaceDeps;

  constructor(base: PatchDocument, deps: WorkspaceDeps) {
    this.base = clone(base);
    this.draft = clone(base);
    this.deps = deps;
  }

  get changed() { return diffDocuments(this.base, this.draft).length > 0; }

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
        case 'kit_ask': return this.ask(a);
        case 'kit_finish': this.summary = String(a.summary ?? '').slice(0, 400) || null; return { success: true, text: 'OK. Your draft will be applied to the live patch when your turn ends.' };
        default: return { success: false, text: `Unknown tool "${tool}". Available: kit_get_patch, kit_list_blocks, kit_describe_block, kit_apply_ops, kit_write_codebox, kit_listen, kit_ask, kit_finish.` };
      }
    } catch (error) {
      return { success: false, text: `Tool failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  // ---- reading -----------------------------------------------------------------
  private getPatch(): ToolOutput {
    const { catalog } = this.deps;
    const doc = this.draft;
    const nodes = Object.values(doc.nodes).map(n => {
      const def = catalog.find(n.type);
      const config = Object.fromEntries(Object.entries(n.config).filter(([k, v]) => def?.config.find(c => c.id === k)?.default !== v));
      return { id: n.id, type: n.type, title: def?.title, label: n.label, config: Object.keys(config).length ? config : undefined, values: Object.keys(n.values).length ? n.values : undefined, ports: n.ports, code: n.code ? clip(n.code, 4000) : undefined, text: n.text };
    });
    const cables = Object.values(doc.edges).map(e => `${e.from.node}.${e.from.port} -> ${e.to.node}.${e.to.port}`);
    const problems = validate(doc, catalog).issues.filter(i => i.severity !== 'info').map(formatIssue);
    const text = JSON.stringify({ name: doc.name, nodes, cables, problems }, null, 1);
    return { success: true, text: clip(`${describePatch(doc, catalog, { maxChars: 6000, includeIssues: false })}\n\n${text}`) };
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

  private ask(a: Record<string, unknown>): ToolOutput {
    const text = String(a.question ?? '').trim().slice(0, 300);
    const options = Array.isArray(a.options) ? [...new Set(a.options.map(o => String(o).trim().slice(0, 80)).filter(Boolean))].slice(0, 5) : [];
    if (!text || options.length < 2) return { success: false, text: 'kit_ask needs a question and 2–5 short options.' };
    this.question = { text, options };
    this.steps.push('asked a question');
    return { success: true, text: 'The question is shown to the user with your options as buttons. End your turn now (one short sentence at most); the answer arrives as the next message.' };
  }

  // ---- editing ---------------------------------------------------------------------
  private async applyOps(ops: unknown): Promise<ToolOutput> {
    if (!Array.isArray(ops) || !ops.length) return { success: false, text: 'ops must be a non-empty array of edit objects.' };
    let result;
    try { result = applyIntents(this.draft, ops as Intent[], this.deps.catalog); }
    catch (error) {
      if (error instanceof OpError) return { success: false, text: `Edit #${error.index + 1} (${JSON.stringify(ops[error.index]).slice(0, 200)}) was rejected: ${error.message}${error.hint ? ` ${error.hint}` : ''}\nNothing was applied; fix it and send the whole list again.` };
      throw error;
    }
    this.draft = result.doc;
    this.steps.push(describeOps(ops as Intent[], result.created));
    const check = await this.check();
    return { success: true, text: `Applied ${ops.length} edit${ops.length === 1 ? '' : 's'}${result.created.length ? ` (new ids: ${result.created.join(', ')})` : ''}. ${check}` };
  }

  private async writeCodebox(a: Record<string, unknown>): Promise<ToolOutput> {
    const node = String(a.node ?? '');
    const target = this.draft.nodes[node];
    if (!target) return { success: false, text: `No module "${node}". Add one first: kit_apply_ops [{"op":"addNode","node":{"id":"${node || 'box1'}","type":"kit.codebox"}}].` };
    if (target.type !== 'kit.codebox') return { success: false, text: `"${node}" is a ${target.type}, not a codebox.` };
    const ports = (list: unknown): PortSpec[] => Array.isArray(list) ? list.map(p => ({ id: String((p as PortSpec).id), type: (p as PortSpec).type === 'gate' ? 'gate' : 'signal' })) : [];
    let result;
    try { result = applyIntents(this.draft, [{ op: 'setCode', node, code: String(a.code ?? ''), ports: { inputs: ports(a.inputs), outputs: ports(a.outputs) } }], this.deps.catalog); }
    catch (error) { if (error instanceof OpError) return { success: false, text: `Rejected: ${error.message}${error.hint ? ` ${error.hint}` : ''}` }; throw error; }
    this.draft = result.doc;
    this.steps.push(`wrote codebox ${node}`);
    return { success: true, text: `Code saved. ${await this.check()}` };
  }

  /** Validate and compile the draft; a short report for the LLM. */
  private async check(): Promise<string> {
    const { catalog } = this.deps;
    const fail = (health: DraftWorkspace['health'], text: string) => { this.health = health; this.problem = text; return text; };
    const problems = validate(this.draft, catalog).issues.filter(i => i.severity === 'error');
    if (problems.length) return fail('invalid', `It does not validate yet:\n${problems.slice(0, 12).map(formatIssue).join('\n')}`);
    const generated = generate(this.draft, catalog);
    if (!generated.source) {
      const blocking = generated.issues.filter(i => i.severity !== 'info');
      return blocking.length ? fail('invalid', `It does not compile yet:\n${blocking.map(formatIssue).join('\n')}`) : fail('silent', 'Nothing reaches Out yet, so there is nothing to compile.');
    }
    const compiled = await this.deps.compile(generated, this.draft);
    if (compiled.ok) { this.health = 'ok'; this.problem = ''; this.steps.push(`compiled ✓`); return `Compiled OK in ${(compiled.ms / 1000).toFixed(1)} s.`; }
    this.steps.push('compile error');
    return fail('compile-error', `It does not compile: ${compiled.message}\n${compiled.issues.slice(0, 12).map(formatIssue).join('\n')}`);
  }

  // ---- listening ---------------------------------------------------------------------
  private async listen(phrase?: string, seconds?: number): Promise<ToolOutput> {
    const { catalog } = this.deps;
    const generated = generate(this.draft, catalog);
    if (!generated.source) return { success: false, text: 'There is nothing to play: the patch does not compile or nothing reaches Out. Fix that first (kit_get_patch shows the problems).' };
    const effect = generated.audioIn;
    let request: Omit<RenderRequest, 'id' | 'kind'>;
    const base = { source: generated.source, nodes: Object.keys(this.draft.nodes), codeboxes: Object.entries(generated.codeboxes).map(([node, line]) => ({ node, line, code: this.draft.nodes[node]?.code ?? '', inputs: this.draft.nodes[node]?.ports?.inputs ?? [], outputs: this.draft.nodes[node]?.ports?.outputs ?? [] })), params: { ...generated.values }, image: this.deps.images };
    if (effect) {
      const input: TestSignal = phrase === 'drums' || phrase === 'noise' ? phrase : 'chords';
      request = { ...base, seconds: Math.min(8, seconds ?? 4), events: [], notes: { onSamples: [], offSamples: [] }, input };
    } else {
      const chosen: Phrase = phrase === 'chord' || phrase === 'chords' ? PHRASES.pad : phrase === 'hits' || phrase === 'drums' ? PHRASES.percussion : phrase === 'bass' ? PHRASES.bass : (generated.voices && (this.draft.nodes[Object.keys(this.draft.nodes).find(id => this.draft.nodes[id]!.type === 'kit.voiceIn') ?? '']?.config.mode === 'poly') ? PHRASES.pad : PHRASES.bass);
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
      default: return o.op;
    }
  });
  return parts.join(', ') + (ops.length > 6 ? ` … (+${ops.length - 6})` : '');
}
