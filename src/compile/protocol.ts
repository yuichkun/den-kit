import type { WorkletMeta } from '@unworklet/core/worklet';
import type { Issue } from '../core/issues.ts';
import type { PortSpec } from '../core/schema.ts';

export interface CompileRequest {
  id: number;
  hash: string;
  source: string;
  /** Node ids, used to attribute unworklet compile errors (instance names) to nodes. */
  nodes: string[];
  codeboxes: Array<{ node: string; code: string; inputs: PortSpec[]; outputs: PortSpec[]; line: number }>;
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
