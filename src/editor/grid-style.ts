// How the patch shows what things are (docs/design-system.md): the color group of a
// module's type (one of the themes' cat-* tokens), and the kind of signal a cable carries.
import type { NodeDef, PortDef } from '../work/catalog.ts';

/** The color groups of module types. io, code and parts carry no color of their own. */
export type TypeGroup =
  | 'source'
  | 'filter'
  | 'envelope'
  | 'modulation'
  | 'fx'
  | 'dynamics'
  | 'voice'
  | 'ui'
  | 'math'
  | 'neutral';
const GROUPS: Record<string, TypeGroup> = {
  source: 'source',
  filter: 'filter',
  envelope: 'envelope',
  modulation: 'modulation',
  fx: 'fx',
  dynamics: 'dynamics',
  voice: 'voice',
  ui: 'ui',
  math: 'math',
};
/** A module's color group; the class `cat-<group>` (style.css) gives its colors. */
export const typeGroup = (def: NodeDef | undefined): TypeGroup =>
  (def && GROUPS[def.category]) || 'neutral';

/** What a cable carries, by what the port means. */
export type SignalKind = 'audio' | 'control' | 'gate';
export function signalKind(
  def: NodeDef | undefined,
  port: PortDef,
  direction: 'in' | 'out',
): SignalKind {
  if (port.type === 'gate') return 'gate';
  if (port.unit === 'cycles') return 'control';
  if (
    port.unit === 'note' ||
    port.unit === 'st' ||
    (port.unit === 'Hz' && port.roles?.includes('pitch'))
  )
    return 'control';
  if (def?.type === 'kit.voiceIn') return 'control';
  if (direction === 'out') {
    if (def?.category === 'envelope' || def?.category === 'ui') return 'control';
    if (
      def?.category === 'modulation' &&
      def.type !== 'kit.cutoffMod' &&
      def.type !== 'kit.tremolo'
    )
      return 'control';
    return 'audio';
  }
  return port.role === 'audio' ? 'audio' : 'control';
}

export { visibleInputs } from '../work/layout.ts';

export const GRID = { cell: 120, snap: 12, gap: 6 } as const;

export function formatValue(value: number, unit?: string): string {
  const a = Math.abs(value);
  if (unit === 's')
    return a < 1 ? `${(value * 1000).toFixed(a < 0.01 ? 1 : 0)} ms` : `${value.toFixed(2)} s`;
  if (unit === 'mix' || unit === 'level') return `${(value * 100).toFixed(1)} %`;
  if (unit === 'Hz')
    return a >= 1000 ? `${(value / 1000).toFixed(2)} kHz` : `${value.toFixed(a >= 100 ? 0 : 1)} Hz`;
  const text = a >= 1000 ? value.toFixed(0) : a >= 100 ? value.toFixed(1) : value.toFixed(2);
  return unit && unit !== 'ratio' && unit !== 'q' ? `${text} ${unit}` : text;
}

export function shortLabel(port: PortDef): string {
  const map: Record<string, string> = {
    attack: 'A',
    decay: 'D',
    sustain: 'S',
    release: 'R',
    resonance: 'Res',
    frequency: 'Freq',
    frequencyHz: 'Freq',
    cutoffHz: 'Cutoff',
    poleHz: 'Cutoff',
    timeLeftSeconds: 'Time',
    timeSeconds: 'Time',
    feedback: 'Fdbk',
    thresholdDb: 'Thresh',
    depthSeconds: 'Depth',
    rateHz: 'Rate',
    modulatorHz: 'Mod',
    deviationHz: 'Dev',
    feedbackHz: 'Fdbk',
    gainDb: 'Gain',
    semitones: 'Semi',
    octaves: 'Oct',
    phaseOffset: 'Phase',
    correlation: 'Corr',
    seconds: 'Time',
    b: 'Amount',
    hz: 'Base',
  };
  return port.label ?? map[port.id] ?? port.id.charAt(0).toUpperCase() + port.id.slice(1);
}
