// Patch → one readable unworklet core-API processor module.
//
// Rules (see docs in README.md):
// - One AudioParam per unconnected control input, named `${node}_${port}`, declared
//   with the descriptor default; current values are applied at node creation, so a
//   knob turn never recompiles.
// - Voice In / Voice Mix replicate den's createInstrument loop exactly (voice
//   controls, deferred retrigger, CC120 capture, release at block end).
// - unworklet 0.4.1 expands expression DAGs recursively, so any non-trivial signal
//   that is read more than once (or by every voice) is written once per sample into
//   a transient slot and read from there. Single-use signals stay expressions, like
//   den's own final audio paths, so tiny values are never flushed needlessly.
import { isParamInput, defaultValue, type Catalog, type NodeDef, type PortDef } from './catalog.ts';
import { inlineCodebox } from './codebox.ts';
import { hasErrors, type Issue } from './issues.ts';
import { flatten, mapIssue, type FlattenOptions } from './parts.ts';
import type { Scope } from './scope.ts';
import { edgesInto, type NodeId, type PatchDocument, type PatchNode, type PortId, type PortSpec } from './schema.ts';
import { validate } from './validate.ts';
import { hashString } from './hash.ts';

export interface ParamInfo { name: string; node: NodeId; port: PortId; min: number; max: number; default: number; gate: boolean }
export interface Generated {
  /** Empty when there is nothing to compile or errors block compilation. */
  source: string;
  /** Hash of `source`; equal hashes mean the compiled artifact can be reused. */
  hash: string;
  params: ParamInfo[];
  /** Current values for every param, from the document. */
  values: Record<string, number>;
  /** Generated line ranges (1-based, inclusive) per node, for the code view. */
  nodeLines: Record<NodeId, number[]>;
  /** First generated line of each inlined codebox (codebox line 1). */
  codeboxes: Record<NodeId, number>;
  probes: Array<{ node: NodeId; channel: number }>;
  voices: { node: NodeId; capacity: number; mode: 'mono' | 'poly' } | null;
  audioIn: boolean;
  issues: Issue[];
  /** Parts and copies are expanded before generation: expanded node id → original ids from the main patch down. */
  origin: Record<NodeId, NodeId[]>;
  /** Ids of the generated program's nodes (for attributing compile errors). */
  nodes: NodeId[];
  /** Codebox sources by generated node id (a codebox inside a part appears once per use). */
  boxes: Record<NodeId, { code: string; inputs: PortSpec[]; outputs: PortSpec[] }>;
}

const RESERVED = new Set(('break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async of ' +
  'i n v p at core reset clear gate trigger sum blocks parts policy output input probes sig gat hist trace midi panic rendered live tuning voiceControls deferredRetrigger completed cleared health healthBad sampleRate select f32 f64 i32 bool state param event forSample instantiate defineProcessor audioInput audioOutput modulatePitch modulateCutoff').split(' '));
const jsName = (id: string) => RESERVED.has(id) ? `${id}$` : id;
const lit = (value: unknown) => typeof value === 'string' ? `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : JSON.stringify(value);
const num = (n: number) => Number.isInteger(n) ? String(n) : String(n);
/** Cheap expressions that may be repeated without DAG expansion. */
const isLeafPattern = (expr: string) => /^[\w$]+(\.[\w$]+)*(\.at\(i\)(\.gte\(0\.5\))?|\.read\(([\w$ +*()]*)\))?$/.test(expr) || /^(f32|bool)\((-?[\d.e+-]+|true|false)\)$/.test(expr);

class Writer {
  lines: string[] = [];
  private depth = 0;
  push(line = '') { this.lines.push(line ? '  '.repeat(this.depth) + line : ''); return this.lines.length; }
  indent<T>(fn: () => T): T { this.depth++; try { return fn(); } finally { this.depth--; } }
  get line() { return this.lines.length; }
}

interface OutRef { expr: string }

export function generate(input: PatchDocument, catalog: Catalog, options: FlattenOptions = {}): Generated {
  const validation = validate(input, catalog, options);
  const { flat } = validation;
  // Generation works on the expanded patch; what it finds is said in terms of the patch as drawn.
  const doc = flat.doc, analysis = validation.flatAnalysis;
  const issues = [...validation.issues];
  const known = issues.length;
  const finish = (list: Issue[]) => [...list.slice(0, known), ...list.slice(known).map(i => mapIssue(i, flat))];
  // Copies of a codebox (a part used twice, a stacked codebox) share one module: it is inlined, and checked, once.
  const boxOf = new Map<string, NodeId>();
  for (const n of Object.values(doc.nodes).sort((a, b) => a.id.localeCompare(b.id))) if (n.code !== undefined && catalog.find(n.type)?.kind === 'codebox' && !boxOf.has(n.code)) boxOf.set(n.code, n.id);
  const mapping = { origin: flat.origin, nodes: Object.keys(doc.nodes), boxes: Object.fromEntries([...boxOf.values()].map(id => { const n = doc.nodes[id]!; return [id, { code: n.code ?? '', inputs: n.ports?.inputs ?? [], outputs: n.ports?.outputs ?? [] }]; })) };
  const empty = (extra: Issue[] = []): Generated => ({ source: '', hash: '', params: [], values: {}, nodeLines: {}, codeboxes: {}, probes: [], voices: null, audioIn: false, issues: finish([...issues, ...extra]), ...mapping });
  if (hasErrors(issues)) return empty();
  const node = (id: NodeId) => doc.nodes[id]!;
  const def = (id: NodeId) => catalog.get(node(id).type);
  const kind = (id: NodeId) => def(id).kind;
  const live = (id: NodeId) => analysis.live.has(id);
  const outNode = Object.values(doc.nodes).find(n => n.type === 'kit.out' && live(n.id));
  const probeNodes = Object.values(doc.nodes).filter(n => (n.type === 'ui.scope' || n.type === 'ui.meter') && live(n.id)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 8);
  if (!outNode && !probeNodes.length) return empty([{ severity: 'info', code: 'nothing-to-compile', message: 'Connect something to Out to hear it.' }]);

  const scopeOf = (id: NodeId): Scope => analysis.scope.get(id) ?? 'global';
  const voiceInNode = Object.values(doc.nodes).find(n => n.type === 'kit.voiceIn' && live(n.id));
  const mixes = analysis.order.post.concat(analysis.order.pre).filter(id => kind(id) === 'voiceMix' && live(id)).sort();
  const mode = voiceInNode?.config.mode === 'mono' ? 'mono' : 'poly';
  const capacity = voiceInNode ? (mode === 'mono' ? 1 : Number(voiceInNode.config.capacity ?? 4)) : 0;
  const voiceOrder = analysis.order.voice.filter(live);
  const pre = analysis.order.pre.filter(id => live(id) && kind(id) !== 'voiceMix');
  const post = analysis.order.post.filter(id => live(id) && kind(id) !== 'voiceMix');
  const audioIn = Object.values(doc.nodes).some(n => n.type === 'kit.audioIn' && live(n.id));

  // ---- Params -------------------------------------------------------------
  const params: ParamInfo[] = [];
  const values: Record<string, number> = {};
  const addParam = (n: PatchNode, port: PortDef) => {
    // A knob that is the same in every copy is one AudioParam (named as if there were one copy).
    const name = flat.shared[n.id]?.[port.id] ?? `${n.id}_${port.id}`;
    if (!params.some(p => p.name === name)) {
      const gate = port.type === 'gate';
      const info: ParamInfo = { name, node: n.id, port: port.id, gate, min: gate ? 0 : port.min ?? -1e6, max: gate ? 1 : port.max ?? 1e6, default: Number(defaultValue(port)) };
      params.push(info);
      const value = n.values[port.id];
      values[name] = value === undefined ? info.default : Number(value);
    }
    return port.type === 'gate' ? `${name}.at(i).gte(0.5)` : `${name}.at(i)`;
  };

  // ---- Use counts (decide materialization) ---------------------------------
  const uses = new Map<string, number>();
  const bump = (key: string, by: number) => uses.set(key, (uses.get(key) ?? 0) + by);
  const primMultiplicity = new Map<NodeId, Record<PortId, number>>();
  const multiplicity = (id: NodeId): Record<PortId, number> => {
    let m = primMultiplicity.get(id);
    if (m) return m;
    m = {};
    const d = def(id);
    if (d.kind === 'prim' && d.prim) {
      const inputs = catalog.inputs(node(id));
      const tokens = Object.fromEntries(inputs.map(p => [p.id, `\u0001${p.id}\u0001`]));
      const text = Object.values(d.prim(tokens, node(id), { sampleRate: 'sampleRate' })).join(' ');
      for (const p of inputs) m[p.id] = text.split(`\u0001${p.id}\u0001`).length - 1;
    }
    primMultiplicity.set(id, m);
    return m;
  };
  for (const edge of Object.values(doc.edges)) {
    if (!live(edge.to.node) || !live(edge.from.node)) continue;
    const targetDef = def(edge.to.node);
    const consumerVoice = scopeOf(edge.to.node) === 'voice' || targetDef.kind === 'voiceMix';
    const sourceGlobal = scopeOf(edge.from.node) === 'global' || kind(edge.from.node) === 'voiceMix';
    const port = catalog.input(node(edge.to.node), edge.to.port);
    let times = targetDef.kind === 'prim' && !port?.materialize ? Math.max(1, multiplicity(edge.to.node)[edge.to.port] ?? 1) : 1;
    // A port that another unconnected port falls back to is read twice.
    for (const other of catalog.inputs(node(edge.to.node))) if (other.fallback === edge.to.port && !edgesInto(doc, edge.to.node, other.id).length && targetDef.kind !== 'out') times++;
    bump(`${edge.from.node}.${edge.from.port}`, consumerVoice && sourceGlobal ? times * Math.max(1, capacity) : times);
  }

  // ---- Slots ---------------------------------------------------------------
  let globalF = 0, globalB = 0, voiceF = 0, voiceB = 0, histG = 0, histV = 0;
  const VOICE_F = '__VF__', VOICE_B = '__VB__';
  const slot = (type: 'signal' | 'gate', scope: Scope) => {
    if (scope === 'voice') return type === 'gate' ? `gat.read(${VOICE_B} + n * ${'__VBS__'} + ${voiceB++})` : `sig.read(${VOICE_F} + n * ${'__VFS__'} + ${voiceF++})`;
    return type === 'gate' ? `gat.read(${globalB++})` : `sig.read(${globalF++})`;
  };
  const writeOf = (read: string, expr: string) => `${read.replace(/^(sig|gat)\.read\(/, '$1.write(').replace(/\)$/, '')}, ${expr});`;

  // ---- Emission --------------------------------------------------------------
  const w = new Writer();
  // Line marks: body marks are relative to the forSample body writer, declaration marks are final.
  const bodyMarks: Record<NodeId, number[]> = {};
  const declMarks: Record<NodeId, number[]> = {};
  const mark = (id: NodeId, line: number) => (bodyMarks[id] ??= []).push(line);
  const markDecl = (id: NodeId, line: number) => (declMarks[id] ??= []).push(line);
  const outputs = new Map<string, OutRef>();
  const imports = new Map<string, Set<string>>();
  const need = (module: string, ...names: string[]) => { const set = imports.get(module) ?? imports.set(module, new Set()).get(module)!; names.forEach(n => set.add(n)); };
  need('@unworklet/core', 'defineProcessor', 'forSample', 'audioOutput', 'event', 'state', 'param', 'f32', 'bool', 'select', 'instantiate');

  // Names bound to node results hold expressions, not cheap reads.
  const exprVars = new Set<string>();
  const isLeaf = (expr: string) => isLeafPattern(expr) && !exprVars.has(expr.split('.')[0]!);
  const typeOfOutput = (id: NodeId, port: PortId) => catalog.output(node(id), port)?.type ?? 'signal';
  const convert = (expr: string, from: 'signal' | 'gate', to: 'signal' | 'gate') => from === to ? expr : to === 'gate' ? `${expr}.gte(0.5)` : `select(${expr}, f32(1), f32(0))`;

  const voiceBinding = { gate: 'gate', retrigger: 'trigger', reset: 'clear.or(trigger)', clear: 'clear' } as const;
  const globalBinding = { retrigger: 'bool(false)', reset: 'reset', clear: 'reset' } as const;

  const inputExpr = (n: PatchNode, port: PortDef, scope: Scope, seen = new Set<PortId>()): string => {
    const edge = edgesInto(doc, n.id, port.id)[0];
    if (edge && live(edge.from.node)) {
      const ref = outputs.get(`${edge.from.node}.${edge.from.port}`);
      if (!ref) throw new Error(`internal: ${edge.from.node}.${edge.from.port} used before it was computed`);
      return convert(ref.expr, typeOfOutput(edge.from.node, edge.from.port), port.type);
    }
    if (port.fallback && !seen.has(port.fallback)) {
      const other = catalog.input(n, port.fallback);
      if (other) return inputExpr(n, other, scope, new Set([...seen, port.id]));
    }
    if (port.binding) {
      if (scope === 'voice') return voiceBinding[port.binding];
      if (port.binding !== 'gate') return globalBinding[port.binding];
    }
    if (!isParamInput(port, scope)) {
      const value = defaultValue(port);
      return port.type === 'gate' ? `bool(${Boolean(value)})` : `f32(${num(Number(value))})`;
    }
    return addParam(n, port);
  };

  /** Bind an output; materialize when it is read more than once and is not trivially cheap. */
  const bindOutput = (id: NodeId, port: PortId, expr: string, scope: Scope) => {
    const count = uses.get(`${id}.${port}`) ?? 0;
    if (count > 1 && !isLeaf(expr)) {
      const read = slot(typeOfOutput(id, port), scope);
      mark(id, w.push(writeOf(read, expr)));
      outputs.set(`${id}.${port}`, { expr: read });
    } else outputs.set(`${id}.${port}`, { expr });
  };

  const materializeInput = (id: NodeId, expr: string, type: 'signal' | 'gate', scope: Scope) => {
    if (isLeaf(expr)) return expr;
    const read = slot(type, scope);
    mark(id, w.push(writeOf(read, expr)));
    return read;
  };

  // Codebox modules (top level).
  const codeboxLines: Record<NodeId, number> = {};
  const codeboxIds = [...new Set([...pre, ...voiceOrder, ...post].filter(id => kind(id) === 'codebox').map(id => boxOf.get(node(id).code ?? '') ?? id))];
  const top = new Writer();
  for (const id of codeboxIds) {
    const inlined = inlineCodebox(id, node(id).code ?? '');
    issues.push(...inlined.issues);
    top.push(`// ${id}: codebox`);
    top.push(`const ${jsName(id)}Box = (() => {`);
    codeboxLines[id] = top.line + 1;
    for (const line of inlined.lines) top.lines.push(line);
    top.push('})();');
  }
  if (hasErrors(issues)) return empty();

  // Instances.
  const instanceLines: string[] = [];
  const voiceInstances: string[] = [];
  const instanceExpr = (id: NodeId, name: string): string | null => {
    const d = def(id), n = node(id);
    if (d.kind === 'codebox') return `instantiate(${jsName(boxOf.get(n.code ?? '') ?? id)}Box, { sampleRate }, { name: ${name} })`;
    if (d.kind !== 'block' || !d.den) return null;
    need(d.den.module, d.den.export);
    const config = catalog.config(n);
    const mapped = d.den.mapConfig ? d.den.mapConfig(config) : Object.fromEntries((d.den.configKeys ?? Object.keys(config)).map(k => [k, config[k]]));
    const fields = [...(d.den.sampleRate === false ? [] : ['sampleRate']), ...Object.entries(mapped).map(([k, v]) => `${k}: ${lit(v)}`)];
    return `instantiate(${d.den.export}, { ${fields.join(', ')} }, { name: ${name} })`;
  };
  // `at(id)` first, so a constructor error (den RangeError, codebox throw) names its node.
  for (const id of [...pre, ...post]) { const e = instanceExpr(id, lit(id)); if (e) instanceLines.push(`${jsName(id)}: (at('${id}'), ${e}),`); }
  for (const id of voiceOrder) { const e = instanceExpr(id, `\`${id}_v\${n}\``); if (e) voiceInstances.push(`${jsName(id)}: (at('${id}'), ${e}),`); }

  // Widgets and Value-like leaves are known before emission.
  const preBind = (id: NodeId) => {
    const n = node(id), d = def(id);
    if (d.kind !== 'widget') return;
    for (const port of catalog.inputs(n)) addParam(n, port);
    if (n.type === 'ui.xy') { outputs.set(`${id}.x`, { expr: `${id}_x.at(i)` }); outputs.set(`${id}.y`, { expr: `${id}_y.at(i)` }); }
    else if (n.type === 'ui.toggle' || n.type === 'ui.button') outputs.set(`${id}.out`, { expr: `${id}_value.at(i).gte(0.5)` });
    else if (catalog.outputs(n).length) outputs.set(`${id}.out`, { expr: `${id}_value.at(i)` });
  };
  for (const id of [...pre, ...post]) preBind(id);

  const histories = { global: [] as NodeId[], voice: [] as NodeId[] };
  for (const id of [...pre, ...post, ...voiceOrder]) if (kind(id) === 'history') histories[scopeOf(id)].push(id);
  const histSlot = new Map<NodeId, number>();
  for (const id of histories.global) histSlot.set(id, histG++);
  for (const id of histories.voice) histSlot.set(id, histV++);
  const histRef = (id: NodeId) => scopeOf(id) === 'voice' ? `${histG} + n * ${Math.max(1, histV)} + ${histSlot.get(id)}` : `${histSlot.get(id)}`;

  const emitNode = (id: NodeId, scope: Scope, holder: string) => {
    const n = node(id), d = def(id);
    // Labels stay out of the source so renaming never recompiles.
    const start = () => mark(id, w.push(`at('${id}'); // ${d.title}`));
    const inputsOf = () => catalog.inputs(n);
    switch (d.kind) {
      case 'widget': case 'comment': case 'voiceIn': case 'voiceMix': case 'history': return; // handled elsewhere
      case 'audioIn': {
        need('@unworklet/core', 'audioInput');
        outputs.set(`${id}.left`, { expr: 'input.ch(0).at(i)' });
        outputs.set(`${id}.right`, { expr: 'input.ch(1).at(i)' });
        return;
      }
      case 'out': {
        // The final mix is written once per sample (flushes |x| < 1e-30, i.e. below -600 dBFS)
        // and read back for both channels and the health check, instead of expanding it repeatedly.
        start();
        const [left, right] = inputsOf();
        const hasRight = edgesInto(doc, id, 'right').some(e => live(e.from.node));
        const l = slot('signal', 'global');
        mark(id, w.push(writeOf(l, `select(reset, f32(0), ${inputExpr(n, left!, scope)})`)));
        if (hasRight) {
          const r = slot('signal', 'global');
          mark(id, w.push(writeOf(r, `select(reset, f32(0), ${inputExpr(n, right!, scope)})`)));
          mark(id, w.push(`const outL = ${l}, outR = ${r};`));
        } else mark(id, w.push(`const outL = ${l}, outR = outL;`));
        return;
      }
      case 'prim': {
        start();
        const multi = multiplicity(id);
        const exprs: Record<PortId, string> = {};
        for (const port of inputsOf()) {
          let expr = inputExpr(n, port, scope);
          if (port.materialize || (multi[port.id] ?? 0) > 1) expr = materializeInput(id, expr, port.type, scope);
          exprs[port.id] = expr;
        }
        for (const m of d.imports ?? []) need(m.module, ...m.names);
        const result = d.prim!(exprs, n, { sampleRate: 'sampleRate' });
        const keys = Object.keys(result);
        exprVars.add(jsName(id));
        if (keys.length === 1) {
          const name = jsName(id);
          mark(id, w.push(`const ${name} = ${result[keys[0]!]};`));
          bindOutput(id, keys[0]!, name, scope);
        } else {
          const name = jsName(id);
          mark(id, w.push(`const ${name} = { ${keys.map(k => `${k}: ${result[k]}`).join(', ')} };`));
          for (const k of keys) bindOutput(id, k, `${name}.${k}`, scope);
        }
        return;
      }
      case 'block': case 'codebox': {
        start();
        const ports = new Map(inputsOf().map(p => [p.id, p]));
        const arg = (portId: PortId) => {
          const port = ports.get(portId)!;
          let expr = inputExpr(n, port, scope);
          // A cleared voice starts cold: stateful blocks see silence on their audio inputs (den createInstrument).
          if (scope === 'voice' && port.role === 'audio' && d.kind === 'block' && edgesInto(doc, id, portId).length) expr = `select(clear, f32(0), ${expr})`;
          // den ticks read their arguments several times internally; pass slots, never big expressions.
          return materializeInput(id, expr, port.type, scope);
        };
        let call: string;
        if (d.kind === 'codebox') {
          const ins = (n.ports?.inputs ?? []).map(p => `${p.id}: ${arg(p.id)}`);
          call = `${holder}.${jsName(id)}.tick({ ${ins.join(', ')} })`;
        } else {
          const args = d.den!.call.args.map(a => typeof a === 'string' ? arg(a) : `{ ${a.object.map(k => `${k}: ${arg(k)}`).join(', ')} }`);
          call = `${holder}.${jsName(id)}.tick(${args.join(', ')})`;
        }
        const name = jsName(id);
        exprVars.add(name);
        mark(id, w.push(`const ${name} = ${call};`));
        if (d.kind === 'codebox') for (const p of n.ports?.outputs ?? []) bindOutput(id, p.id, `${name}.${p.id}`, scope);
        else if (typeof d.den!.call.returns === 'string') bindOutput(id, d.den!.call.returns, name, scope);
        else for (const [port, field] of Object.entries(d.den!.call.returns)) bindOutput(id, port, `${name}.${field}`, scope);
        return;
      }
    }
  };

  // History reads at scope start (copied to slots so later writes cannot be observed).
  const readHistories = (scope: Scope) => {
    for (const id of histories[scope]) {
      const read = slot('signal', scope);
      mark(id, w.push(`at('${id}'); ${writeOf(read, `hist.read(${histRef(id)})`)} // History: last sample`));
      outputs.set(`${id}.out`, { expr: read });
    }
  };
  const writeHistories = (scope: Scope) => {
    for (const id of histories[scope]) {
      const n = node(id);
      mark(id, w.push(`hist.write(${histRef(id)}, ${inputExpr(n, catalog.inputs(n)[0]!, scope)}); // History: store for next sample`));
    }
  };

  // Body of forSample.
  w.indent(() => w.indent(() => w.indent(() => {
    w.push('const reset = panic.read();');
    readHistories('global');
    for (const id of pre) emitNode(id, 'global', 'blocks');
    if (voiceInNode) {
      for (const m of mixes) w.push(`let ${jsName(m)} = f32(0);`);
      w.push('policy.voices.forEach((voice, n) => {');
      w.indent(() => {
        const vid = voiceInNode.id;
        mark(vid, w.push(`at('${vid}'); // Voice In: den createInstrument voice controls`));
        if (voiceInstances.length) w.push('const p = parts[n];');
        mark(vid, w.push('const v = voice.read();'));
        mark(vid, w.push('voiceControls.write(n * 3, reset.or(rendered.read().and(live.read().not())).or(v.active.not()).or(cleared.read(n)));'));
        mark(vid, w.push('voiceControls.write(n * 3 + 1, v.gate.and(voiceControls.read(n * 3).not()));'));
        mark(vid, w.push('voiceControls.write(n * 3 + 2, voice.takeRetrigger().or(deferredRetrigger.read(n)));'));
        mark(vid, w.push('const clear = voiceControls.read(n * 3), gate = voiceControls.read(n * 3 + 1), trigger = voiceControls.read(n * 3 + 2);'));
        mark(vid, w.push('deferredRetrigger.write(n, clear.and(trigger).and(v.active).and(v.gate));'));
        bindOutput(vid, 'pitch', 'tuning.read(v.note.max(0))', 'voice');
        bindOutput(vid, 'note', 'f32(v.note)', 'voice');
        outputs.set(`${vid}.gate`, { expr: 'gate' });
        outputs.set(`${vid}.trigger`, { expr: 'trigger' });
        bindOutput(vid, 'velocity', 'v.velocity', 'voice');
        readHistories('voice');
        for (const id of voiceOrder) if (id !== vid) emitNode(id, 'voice', 'p');
        let done: string | null = null;
        for (const m of mixes) {
          const mixNode = node(m);
          const [inPort, donePort] = catalog.inputs(mixNode);
          const hasIn = edgesInto(doc, m, 'in').some(e => live(e.from.node));
          mark(m, w.push(`at('${m}'); // Voice Mix: sum active voices`));
          if (hasIn) mark(m, w.push(`${jsName(m)} = ${jsName(m)}.add(select(v.active.and(clear.not()), ${inputExpr(mixNode, inPort!, 'voice')}, f32(0)));`));
          if (!done && edgesInto(doc, m, 'done').some(e => live(e.from.node))) done = inputExpr(mixNode, donePort!, 'voice');
        }
        writeHistories('voice');
        w.push(`completed.write(n, ${done ?? 'gate.not()'});`);
        w.push('cleared.write(n, 0);');
      });
      w.push('});');
      for (const m of mixes) { exprVars.add(jsName(m)); outputs.set(`${m}.out`, { expr: jsName(m) }); }
    }
    for (const id of post) emitNode(id, 'global', 'blocks');
    writeHistories('global');
    if (outNode) {
      w.push('output.ch(0).at(i).write(outL);');
      w.push('output.ch(1).at(i).write(outR);');
      w.push('// Edge-triggered health report (NaN/Inf or runaway level).');
      w.push('const bad = outL.eq(outL).not().or(outR.eq(outR).not()).or(outL.abs().gt(64)).or(outR.abs().gt(64));');
      w.push('health.emitIf(bad.and(healthBad.read().not()), { code: 1 });');
      w.push('healthBad.write(bad);');
    }
    probeNodes.forEach((probe, channel) => {
      mark(probe.id, w.push(`probes.ch(${channel}).at(i).write(${inputExpr(probe, catalog.inputs(probe)[0]!, 'global')});`));
    });
    w.push('panic.write(false);');
    if (voiceInNode) { w.push('rendered.write(true);'); w.push('live.write(true);'); }
  })));

  // ---- Assemble ---------------------------------------------------------------
  const sigSize = Math.max(1, globalF + capacity * voiceF), gatSize = Math.max(1, globalB + capacity * voiceB), histSize = Math.max(1, histG + capacity * histV);
  const body = w.lines.map(line => line.replaceAll(VOICE_F, String(globalF)).replaceAll('__VFS__', String(Math.max(1, voiceF))).replaceAll(VOICE_B, String(globalB)).replaceAll('__VBS__', String(Math.max(1, voiceB))));
  const out = new Writer();
  out.push(`// Generated by den-kit from "${doc.name.replace(/[\r\n]/g, ' ')}". Edit the patch, not this file.`);
  out.push('// Conventions: one AudioParam per unconnected input (`node_port`); signals read more than');
  out.push('// once are written once per sample to transient slots (sig/gat) and read back.');
  out.push("import * as core from '@unworklet/core';");
  if (voiceInNode) { need('@denaudio/den/voice-policy', 'voicePolicy'); need('@unworklet/core', 'i32'); }
  for (const [module, names] of [...imports].sort(([a], [b]) => a === '@unworklet/core' ? -1 : b === '@unworklet/core' ? 1 : a.localeCompare(b))) out.push(`import { ${[...names].sort().join(', ')} } from '${module}';`);
  out.push('');
  out.push('export const trace = { node: \'\' };');
  out.push('const at = (id: string) => { trace.node = id; };');
  const topOffset = out.line;
  for (const line of top.lines) out.lines.push(line);
  for (const [id, line] of Object.entries(codeboxLines)) codeboxLines[id] = line + topOffset;
  out.push('');
  out.push('export default defineProcessor(({ sampleRate }) => {');
  out.indent(() => {
    if (outNode) out.push("const output = audioOutput({ channels: 2, name: 'main' });");
    if (audioIn) out.push("const input = audioInput({ channels: 2, name: 'main' });");
    if (probeNodes.length) out.push(`const probes = audioOutput({ channels: ${probeNodes.length}, name: 'probes' });`);
    out.push("const panic = state.bool(false).expose({ name: 'kit_panic', snapshot: 'transient' });");
    out.push("event<{ value: number }>({ from: 'main', name: 'reset' }).onReceive(() => panic.write(true));");
    out.push("const health = event<{ code: number }>({ to: 'main', name: 'kitHealth' });");
    out.push("const healthBad = state.bool(false).expose({ name: 'kit_healthBad', snapshot: 'transient' });");
    out.push(`const sig = state.buffer.f32({ size: ${sigSize} }).expose({ name: 'kit_sig', snapshot: 'transient' });`);
    out.push(`const gat = state.buffer.bool({ size: ${gatSize} }).expose({ name: 'kit_gate', snapshot: 'transient' });`);
    if (histG + histV) out.push(`const hist = state.buffer.f32({ size: ${histSize} }).expose({ name: 'kit_history', snapshot: 'transient' });`);
    for (const p of params) out.push(`const ${p.name} = param.f32({ default: ${num(p.default)}, min: ${num(p.min)}, max: ${num(p.max)}, automationRate: 'a-rate' }).named('${p.name}');`);
    if (voiceInNode) {
      const c = voiceInNode.config;
      const policyConfig = mode === 'mono' ? `{ mode: 'mono', capacity: 1, heldCapacity: ${Number(c.heldCapacity ?? 16)}, legato: ${Boolean(c.legato)} }` : `{ mode: 'poly', capacity: ${capacity}, heldCapacity: ${Number(c.heldCapacity ?? 16)} }`;
      markDecl(voiceInNode.id, out.push(`at('${voiceInNode.id}');`));
      markDecl(voiceInNode.id, out.push(`const policy = instantiate(voicePolicy, ${policyConfig}, { name: 'kit_voices' });`));
      out.push("const midi = event.midi({ from: 'main', name: 'midi' });");
      out.push("const rendered = state.bool(false).named('kit_rendered');");
      out.push("const live = state.bool(false).expose({ name: 'kit_live', snapshot: 'transient' });");
      out.push("const voiceControls = state.buffer.bool({ size: 3 * policy.capacity }).expose({ name: 'kit_voiceControls', snapshot: 'transient' });");
      out.push("const deferredRetrigger = state.buffer.bool({ size: policy.capacity }).expose({ name: 'kit_deferredRetrigger', snapshot: 'transient' });");
      out.push("const completed = state.buffer.bool({ size: policy.capacity }).expose({ name: 'kit_completed', snapshot: 'transient' });");
      out.push("const cleared = state.buffer.bool({ size: policy.capacity }).expose({ name: 'kit_cleared', snapshot: 'transient' });");
      out.push("const tuning = state.buffer.f32({ size: 128 }).expose({ name: 'kit_tuning', snapshot: 'transient' });");
      out.push('midi.onEvent(\'noteOn\', e => policy.noteOn(e.note, e.channel, e.velocity));');
      out.push('midi.onEvent(\'noteOff\', e => policy.noteOff(e.note, e.channel));');
      out.push('midi.onEvent(\'cc\', e => {');
      out.indent(() => {
        out.push('policy.voices.forEach((voice, n) => cleared.write(n, cleared.read(n).or(e.controller.eq(120).and(voice.read().channel.eq(e.channel)))));');
        out.push('policy.allNotesOff(select(e.controller.eq(123), e.channel, i32(-1)));');
        out.push('policy.allSoundOff(select(e.controller.eq(120), e.channel, i32(-1)));');
      });
      out.push('});');
    }
    if (instanceLines.length) {
      out.push('const blocks = {');
      out.indent(() => instanceLines.forEach(line => { const id = line.slice(0, line.indexOf(':')).replace(/\$$/, ''); markDecl(id, out.push(line)); }));
      out.push('};');
    }
    if (voiceInstances.length) {
      out.push('const parts = policy.voices.map((_, n) => ({');
      out.indent(() => voiceInstances.forEach(line => { const id = line.slice(0, line.indexOf(':')).replace(/\$$/, ''); markDecl(id, out.push(line)); }));
      out.push('}));');
    }
    out.push('return { process() {');
    out.indent(() => {
      if (voiceInNode) {
        out.push('policy.reset(panic.read());');
        out.push('for (let note = 0; note < 128; note++) tuning.write(note, 440 * 2 ** ((note - 69) / 12));');
      }
      out.push('forSample(i => {');
    });
    const bodyOffset = out.line;
    for (const line of body) out.lines.push(line);
    for (const [id, lines] of Object.entries(bodyMarks)) (declMarks[id] ??= []).push(...lines.map(l => l + bodyOffset));
    out.indent(() => {
      out.push('});');
      if (voiceInNode) out.push('policy.voices.forEach((voice, n) => voice.releaseFinished(completed.read(n)));');
    });
    out.push('} };');
  });
  out.push('});');
  out.push('');
  const source = out.lines.join('\n');
  return { source, hash: hashString(source), params, values, nodeLines: declMarks, codeboxes: codeboxLines, probes: probeNodes.map((p, channel) => ({ node: p.id, channel })), voices: voiceInNode ? { node: voiceInNode.id, capacity, mode } : null, audioIn, issues: finish(issues), ...mapping };
}

/**
 * The AudioParam values of `generated` for a patch that differs from the one it
 * was made from only in knob values (no recompile): what the session sends when
 * a knob turns. Parts and copies are expanded again, so a knob that stands for
 * several AudioParams (each use of a part, each copy of a spread) reaches all of them.
 */
export function currentValues(doc: PatchDocument, catalog: Catalog, generated: Pick<Generated, 'params'>, options: FlattenOptions = {}): Record<string, number> {
  const flat = flatten(doc, catalog, options).doc;
  const values: Record<string, number> = {};
  for (const p of generated.params) {
    const value = flat.nodes[p.node]?.values[p.port];
    values[p.name] = value === undefined ? p.default : Number(value);
  }
  return values;
}
