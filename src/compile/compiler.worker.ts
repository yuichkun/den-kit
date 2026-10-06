// Disposable compile worker: codebox type check → evaluate → unworklet compile →
// WebAssembly validation → worklet module source. The client terminates it on
// timeout (a codebox loop cannot be interrupted any other way).
import { compile, emitWorkletModuleSource, extractWorkletMeta } from '@unworklet/core';
import registry from 'virtual:kit-modules';
import runtime from 'virtual:kit-runtime';
import types from 'virtual:kit-types';
import { createTypeProject } from './type-project.ts';
import { evaluate, EvaluationError } from './evaluate.ts';
import { attributeError } from './compile-errors.ts';
import type { CompileRequest, CompileResponse } from './protocol.ts';

const worker = globalThis as unknown as { onmessage: ((event: MessageEvent<CompileRequest>) => void) | null; postMessage(value: CompileResponse, transfer?: Transferable[]): void };
let project: ReturnType<typeof createTypeProject> | undefined;

worker.onmessage = async event => {
  const request = event.data;
  const { id } = request;
  const boxes = request.codeboxes.map(b => ({ node: b.node, line: b.line, lines: b.code.split('\n').length + 1 }));
  try {
    if (typeof request.source !== 'string' || request.source.length > 400_000) throw new Error('Generated source is too large (over 400,000 characters).');
    if (request.codeboxes.length) {
      worker.postMessage({ id, phase: 'checking codebox types' });
      project ??= createTypeProject(types);
      const issues = request.codeboxes.flatMap(b => project!.checkCodebox(b.node, b.code, b.inputs, b.outputs));
      if (issues.some(i => i.severity === 'error')) { worker.postMessage({ id, error: { message: 'Fix the codebox errors.', issues } }); return; }
    }
    worker.postMessage({ id, phase: 'compiling' });
    const started = performance.now();
    let processor;
    try { processor = evaluate(request.source, registry).processor; }
    catch (error) {
      const e = error as EvaluationError;
      worker.postMessage({ id, error: { message: e.message, issues: attributeError(e.message, request.nodes, { node: e.node, line: e.line, codeboxes: boxes }) } });
      return;
    }
    const compiled = await compile(processor, { sampleRate: 48000 });
    // Validate now so the function-size limit is reported here, not when the worklet loads.
    await WebAssembly.compile(compiled.wasm as BufferSource);
    const meta = extractWorkletMeta(compiled.graph as unknown as Parameters<typeof extractWorkletMeta>[0]);
    const processorName = `den-kit-${request.hash}`;
    const moduleSource = emitWorkletModuleSource(meta, { processorName, runtime: { kind: 'inline', code: runtime } });
    const wasm = Uint8Array.from(compiled.wasm).buffer;
    worker.postMessage({ id, result: { hash: request.hash, meta, moduleSource, wasm, processorName, sampleRate: 48000, compileMs: performance.now() - started } }, [wasm]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    worker.postMessage({ id, error: { message, issues: attributeError(message, request.nodes, { codeboxes: boxes }) } });
  }
};
