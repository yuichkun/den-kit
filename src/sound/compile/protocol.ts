import type { WorkletMeta } from '@unworklet/core/worklet';
import type { Issue } from '../../work/issues.ts';
import type { PortSpec } from '../../work/schema.ts';
import type { ListenReport, TestSignal } from '../analysis.ts';

export interface CompileRequest {
  id: number;
  hash: string;
  source: string;
  /** Node ids, used to attribute unworklet compile errors (instance names) to nodes. */
  nodes: string[];
  codeboxes: Array<{
    node: string;
    code: string;
    inputs: PortSpec[];
    outputs: PortSpec[];
    line: number;
  }>;
}
export interface Artifact {
  hash: string;
  meta: WorkletMeta;
  moduleSource: string;
  wasm: ArrayBuffer;
  processorName: string;
  sampleRate: number;
  compileMs: number;
}
export type CompileResponse =
  | { id: number; phase: string }
  | { id: number; result: Artifact }
  | { id: number; error: { message: string; issues: Issue[] } };

/** Offline render of a patch for the listening tool (same worker, `kind: 'render'`). */
export interface RenderRequest {
  kind: 'render';
  id: number;
  source: string;
  nodes: string[];
  codeboxes: CompileRequest['codeboxes'];
  seconds: number;
  /** Knob values by AudioParam name (Generated.values). */
  params: Record<string, number>;
  /** MIDI events at sample offsets (phraseEvents). */
  events: Array<{ name: string; atSample: number; payload: unknown }>;
  /** What the processor is sent as it starts: the contents of its asset slots, as the editor's sound gets them. */
  messages: Array<{ name: string; atQuantum: number; payload: unknown }>;
  /** Note times for attack/release measurement. */
  notes: { onSamples: number[]; offSamples: number[] };
  /** Test material for effect patches (Audio In). */
  input?: TestSignal;
  /** Also draw a spectrogram PNG. */
  image: boolean;
}
export type RenderResponse =
  | { id: number; report: ListenReport; png?: ArrayBuffer; renderMs: number }
  | { id: number; error: { message: string; issues: Issue[] } };
