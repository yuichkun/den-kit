// Node descriptors: the single place that says what a node is. The patch view,
// validation, code generation and the AI-facing descriptions are all derived
// from these, so den's heterogeneous tick signatures are absorbed here.
import type { ConfigValue, PatchNode, PortId, SignalType, Value } from './schema.ts';

export type NodeKind =
  | 'block'
  | 'prim'
  | 'voiceIn'
  | 'voiceMix'
  | 'audioIn'
  | 'out'
  | 'history'
  | 'codebox'
  | 'widget'
  | 'comment'
  | 'part'
  | 'partIn'
  | 'partOut';
/** 'mine' is not a node category: the palettes list My parts under it. */
export type Category =
  | 'voice'
  | 'source'
  | 'filter'
  | 'envelope'
  | 'modulation'
  | 'fx'
  | 'dynamics'
  | 'math'
  | 'io'
  | 'ui'
  | 'code'
  | 'part'
  | 'mine';
export type Unit =
  | 'Hz'
  | 's'
  | 'dB'
  | 'oct'
  | 'st'
  | 'ratio'
  | 'gain'
  | 'mix'
  | 'cycles'
  | 'beats'
  | 'note'
  | 'q'
  | 'level'
  | 'bpm';
/**
 * What an unconnected gate input means. In a voice: `gate`/`retrigger` follow the
 * note, `reset` restarts phase on a new note or a cleared voice, `clear` only on
 * a cleared voice. Globally, `reset`/`clear` follow the panic reset, `retrigger`
 * is false and `gate` becomes a toggle parameter.
 */
export type Binding = 'gate' | 'retrigger' | 'reset' | 'clear';

export interface PortDef {
  id: PortId;
  type: SignalType;
  label?: string;
  doc?: string;
  /** `audio` inputs read 0 when unconnected (no parameter) and are muted while a voice is cleared. */
  role?: 'audio' | 'control';
  default?: Value;
  /** Absolute AudioParam bounds (what den accepts). */
  min?: number;
  max?: number;
  /** Comfortable knob range; defaults to min/max. */
  uiMin?: number;
  uiMax?: number;
  scale?: 'linear' | 'log';
  unit?: Unit;
  binding?: Binding;
  /** Unconnected → the literal default, not a parameter. */
  constant?: boolean;
  /** The incoming signal is written once per sample to a transient slot before use (den's depth caching). */
  materialize?: boolean;
  /** Semantic roles used by intent operations ("brighter" → cutoff). */
  roles?: readonly string[];
  /** Not shown as a cable handle (widget values). */
  hidden?: boolean;
  /** Unconnected → use this other input's signal (e.g. right falls back to left). */
  fallback?: PortId;
  /** A gate input fed by several copies (a thick cable) is on while any copy is; `all`: only while every copy is (a voice is done when all its copies are). */
  merge?: 'all';
}

export interface ConfigDef {
  id: string;
  label?: string;
  kind: 'enum' | 'number' | 'boolean';
  options?: readonly string[];
  default: ConfigValue;
  min?: number;
  max?: number;
  integer?: boolean;
  doc?: string;
}

export interface CallSpec {
  /** Positional args by port id, or one object arg whose fields are port ids. */
  args: ReadonlyArray<PortId | { object: readonly PortId[] }>;
  /** A scalar return becomes this output port; a record maps output port → record field. */
  returns: PortId | Readonly<Record<PortId, string>>;
}

export interface DenBinding {
  /** Module specifier, e.g. `@denaudio/den/filter`. */
  module: string;
  export: string;
  call: CallSpec;
  /** Config keys passed to the den constructor next to `sampleRate`. Default: every config key. */
  configKeys?: readonly string[];
  /** Pass `sampleRate` in the constructor config (default true). */
  sampleRate?: boolean;
  /** Map kit config values to den constructor values (e.g. '4' → 4). */
  mapConfig?: (config: Record<string, ConfigValue>) => Record<string, unknown>;
  /** Approximate state bytes for one instance (validation budget). */
  memoryBytes?: (config: Record<string, ConfigValue>, sampleRate: number) => number;
}

/** Pure expression emitter for primitives: input expressions → output expressions. */
export type PrimEmit = (
  inputs: Record<PortId, string>,
  node: PatchNode,
  env: { sampleRate: string },
) => Record<PortId, string>;

export interface NodeDef {
  type: string;
  kind: NodeKind;
  title: string;
  category: Category;
  /** One line, shown in the palette and given to AI. */
  summary: string;
  /** Longer AI-facing notes: units, typical values, caveats. */
  doc?: string;
  config: readonly ConfigDef[];
  inputs: readonly PortDef[] | ((node: PatchNode) => PortDef[]);
  outputs: readonly PortDef[] | ((node: PatchNode) => PortDef[]);
  /** Where the node may live. Default `any`. */
  scope?: 'any' | 'global';
  den?: DenBinding;
  prim?: PrimEmit;
  /** Named imports a primitive's expressions need. */
  imports?: ReadonlyArray<{ module: string; names: readonly string[] }>;
  /** Search keywords for the palette and the router. */
  keywords?: readonly string[];
  /** Max one per patch. */
  singleton?: boolean;
  /** Inputs shown as big knobs on the module face (Grid style); other params stay compact. */
  face?: readonly PortId[];
  /** Where the palettes offer it: never (parts are placed by definition) or only inside a part. Default: everywhere. */
  palette?: 'never' | 'inside';
  /** False: never runs as copies (×N), e.g. nodes that sum copies up. */
  stack?: false;
  /** A config key that seeds randomness: copies of the node each get their own seed. */
  seed?: string;
}

export class Catalog {
  private readonly defs = new Map<string, NodeDef>();
  constructor(defs: readonly NodeDef[]) {
    for (const def of defs) {
      if (this.defs.has(def.type)) throw new Error(`Duplicate node type: ${def.type}`);
      this.defs.set(def.type, def);
    }
  }
  has(type: string): boolean {
    return this.defs.has(type);
  }
  get(type: string): NodeDef {
    const def = this.defs.get(type);
    if (!def) throw new Error(`Unknown node type: ${type}`);
    return def;
  }
  find(type: string): NodeDef | undefined {
    return this.defs.get(type);
  }
  list(): NodeDef[] {
    return [...this.defs.values()];
  }
  inputs(node: PatchNode): PortDef[] {
    const def = this.find(node.type);
    if (!def) return [];
    return typeof def.inputs === 'function' ? def.inputs(node) : [...def.inputs];
  }
  outputs(node: PatchNode): PortDef[] {
    const def = this.find(node.type);
    if (!def) return [];
    return typeof def.outputs === 'function' ? def.outputs(node) : [...def.outputs];
  }
  input(node: PatchNode, port: PortId): PortDef | undefined {
    return this.inputs(node).find(p => p.id === port);
  }
  /** Inputs drawn as big knobs on the module (a part shows its first parameters). */
  face(node: PatchNode): PortId[] {
    if (node.type === 'kit.part')
      return this.inputs(node)
        .filter(p => p.role === 'control' && p.type === 'signal')
        .slice(0, 4)
        .map(p => p.id);
    return [...(this.find(node.type)?.face ?? [])];
  }
  output(node: PatchNode, port: PortId): PortDef | undefined {
    return this.outputs(node).find(p => p.id === port);
  }
  /** Effective config: defaults filled in, unknown keys dropped. */
  config(node: PatchNode): Record<string, ConfigValue> {
    const def = this.find(node.type);
    if (!def) return { ...node.config };
    return Object.fromEntries(
      def.config.map(c => [
        c.id,
        Object.hasOwn(node.config, c.id) ? node.config[c.id]! : c.default,
      ]),
    );
  }
}

/** Does `value` satisfy a config definition? Returns a reason when it does not. */
export function checkConfigValue(def: ConfigDef, value: unknown): string | undefined {
  if (def.kind === 'enum')
    return typeof value === 'string' && def.options?.includes(value)
      ? undefined
      : `${def.id} must be one of ${def.options?.join(', ')}`;
  if (def.kind === 'boolean')
    return typeof value === 'boolean' ? undefined : `${def.id} must be true or false`;
  if (typeof value !== 'number' || !Number.isFinite(value))
    return `${def.id} must be a finite number`;
  if (def.integer && !Number.isInteger(value)) return `${def.id} must be an integer`;
  if (def.min !== undefined && value < def.min) return `${def.id} must be >= ${def.min}`;
  if (def.max !== undefined && value > def.max) return `${def.id} must be <= ${def.max}`;
  return undefined;
}

/** Does `value` fit an input port? Returns a reason when it does not. */
export function checkPortValue(port: PortDef, value: unknown): string | undefined {
  if (port.type === 'gate')
    return typeof value === 'boolean' || value === 0 || value === 1
      ? undefined
      : `${port.id} is a gate: use true or false`;
  if (typeof value !== 'number' || !Number.isFinite(value))
    return `${port.id} must be a finite number`;
  if (port.min !== undefined && value < port.min)
    return `${port.id} must be >= ${port.min}${port.unit ? ` ${port.unit}` : ''}`;
  if (port.max !== undefined && value > port.max)
    return `${port.id} must be <= ${port.max}${port.unit ? ` ${port.unit}` : ''}`;
  return undefined;
}

export function clampPortValue(port: PortDef, value: number): number {
  return Math.min(port.max ?? Infinity, Math.max(port.min ?? -Infinity, value));
}

/** An unconnected input becomes an AudioParam unless it is audio, bound, or constant. */
export function isParamInput(port: PortDef, scope: 'global' | 'voice'): boolean {
  if (port.role === 'audio' || port.constant) return false;
  if (port.binding === 'gate') return scope === 'global';
  return port.binding === undefined;
}

export function defaultValue(port: PortDef): Value {
  return port.default ?? (port.type === 'gate' ? false : 0);
}
