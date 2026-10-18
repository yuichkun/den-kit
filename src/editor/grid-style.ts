// Visual language modelled on Bitwig's The Grid: near-black blueprint canvas,
// charcoal modules with a signal-coloured title, ring in-ports / dot out-ports
// coloured by signal type, white knobs, thick coloured cables.
import type { NodeDef, PortDef } from '../core/catalog.ts';

/** Grid signal colours (Bitwig: untyped red, control turquoise, pitch orange, phase purple, logic yellow, secondary blue). */
export const SIGNAL = {
  audio: '#ff3a5c',
  control: '#24d3a8',
  modulator: '#3cc6ff',
  pitch: '#ff8c1a',
  phase: '#b26bff',
  logic: '#ffd43b',
  secondary: '#3d9bff',
  neutral: '#c9ccd1',
} as const;
export type SignalKind = keyof typeof SIGNAL;

export const CATEGORY_KIND: Record<string, SignalKind> = {
  voice: 'pitch',
  source: 'audio',
  filter: 'audio',
  envelope: 'control',
  modulation: 'modulator',
  fx: 'audio',
  dynamics: 'audio',
  math: 'audio',
  io: 'neutral',
  ui: 'logic',
  code: 'audio',
  part: 'modulator',
};

export function titleColor(def: NodeDef | undefined): string {
  if (!def) return SIGNAL.audio;
  if (def.type === 'kit.voiceIn') return SIGNAL.pitch;
  if (def.type === 'kit.voiceMix') return SIGNAL.audio;
  if (def.type === 'kit.pitchMod' || def.type === 'kit.mtof') return SIGNAL.pitch;
  if (def.type === 'kit.history') return SIGNAL.secondary;
  return SIGNAL[CATEGORY_KIND[def.category] ?? 'audio'];
}

/** Colour of a port by what the signal means (the ring colour on inputs, dot colour on outputs). */
export function portKind(
  def: NodeDef | undefined,
  port: PortDef,
  direction: 'in' | 'out',
): SignalKind {
  if (port.type === 'gate') return 'logic';
  if (port.unit === 'cycles') return 'phase';
  if (
    port.unit === 'note' ||
    port.unit === 'st' ||
    (port.unit === 'Hz' && port.roles?.includes('pitch'))
  )
    return 'pitch';
  if (def?.type === 'kit.voiceIn') return port.id === 'velocity' ? 'control' : 'pitch';
  if (direction === 'out') {
    if (def?.category === 'envelope') return 'control';
    if (
      def?.category === 'modulation' &&
      def.type !== 'kit.pitchMod' &&
      def.type !== 'kit.cutoffMod' &&
      def.type !== 'kit.tremolo'
    )
      return 'modulator';
    if (def?.type === 'kit.pitchMod') return 'pitch';
    if (def?.category === 'ui') return 'control';
    return 'audio';
  }
  if (port.role === 'audio') return 'audio';
  if (port.unit === 'Hz' || port.unit === 'oct') return 'pitch';
  if (port.unit === 's') return 'control';
  return 'secondary';
}
export const portColor = (def: NodeDef | undefined, port: PortDef, direction: 'in' | 'out') =>
  SIGNAL[portKind(def, port, direction)];

export { visibleInputs } from '../core/layout.ts';

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
