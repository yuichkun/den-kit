// Disposable compile worker: codebox type check → evaluate → unworklet compile →
// WebAssembly validation → worklet module source. The client terminates it on
// timeout (a codebox loop cannot be interrupted any other way). A codebox's code
// runs here while the sound is built, on den-kit's own origin, so the worker has
// no network or storage before it runs any: code in a work stays away from
// den-kit's server and the person's accounts. The host's policy for this script
// (worker-policy.ts) lets it load nothing but den-kit's own scripts and make no other
// request, whatever code it evaluates, and no codebox's code runs without that policy.
import { compile, emitWorkletModuleSource, extractWorkletMeta } from '@unworklet/core';
import { renderOffline } from '@unworklet/offline';
import registry from 'virtual:kit-modules';
import runtime from 'virtual:kit-runtime';
import types from 'virtual:kit-types';
import { createTypeProject } from './type-project.ts';
import { evaluate, EvaluationError } from './evaluate.ts';
import { attributeError } from './compile-errors.ts';
import type { CompileRequest, CompileResponse, RenderRequest, RenderResponse } from './protocol.ts';
import type { Issue } from '../../work/issues.ts';
import { analyse, spectrogramPng, testSignal } from '../analysis.ts';

for (const name of [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'WebTransport',
  'EventSource',
  'importScripts',
  'Worker',
  'SharedWorker',
  'indexedDB',
  'caches',
  'BroadcastChannel',
]) {
  for (let o: object | null = self; o; o = Object.getPrototypeOf(o)) {
    try {
      delete (o as Record<string, unknown>)[name];
    } catch {
      /* not ours to delete */
    }
  }
  try {
    Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false });
  } catch {
    /* already gone */
  }
}

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<CompileRequest | RenderRequest>) => void) | null;
  postMessage(value: CompileResponse | RenderResponse, transfer?: Transferable[]): void;
};
let project: ReturnType<typeof createTypeProject> | undefined;

/**
 * Whether the host's policy is in force: it refuses a script from a data: URL, as it
 * refuses every script but den-kit's own. Asked once, before any codebox's code runs
 * here.
 */
let guarded: Promise<boolean> | undefined;
/** Issues for the codeboxes of a request that this worker must not run, or none. */
async function unguarded(codeboxes: CompileRequest['codeboxes']): Promise<Issue[]> {
  if (!codeboxes.length) return [];
  // The URL is made at run time, so the bundler leaves the import to the browser.
  guarded ??= import(/* @vite-ignore */ ['data:text/javascript', ''].join(',')).then(
    () => false,
    () => true,
  );
  if (await guarded) return [];
  return codeboxes.map(b => ({
    severity: 'error',
    code: 'codebox-isolation',
    node: b.node,
    message: UNGUARDED,
  }));
}
const UNGUARDED =
  'Codeboxes cannot run here: den-kit cannot keep their code off the network. Remove the codebox to compile the patch.';

/** Listening tool: evaluate → render offline → measure (→ spectrogram). */
async function render(request: RenderRequest) {
  const { id } = request;
  const boxes = request.codeboxes.map(b => ({
    node: b.node,
    line: b.line,
    lines: b.code.split('\n').length + 1,
  }));
  const started = performance.now();
  try {
    const refused = await unguarded(request.codeboxes);
    if (refused.length) {
      worker.postMessage({ id, error: { message: UNGUARDED, issues: refused } });
      return;
    }
    let processor;
    try {
      processor = evaluate(request.source, registry).processor;
    } catch (error) {
      const e = error as EvaluationError;
      worker.postMessage({
        id,
        error: {
          message: e.message,
          issues: attributeError(e.message, request.nodes, {
            node: e.node,
            line: e.line,
            codeboxes: boxes,
          }),
        },
      });
      return;
    }
    const sampleRate = 48000;
    const seconds = Math.max(0.1, Math.min(8, request.seconds));
    const inputs = request.input
      ? { main: testSignal(request.input, seconds, sampleRate) }
      : undefined;
    const params = Object.fromEntries(Object.entries(request.params).map(([k, v]) => [k, [v]]));
    const result = await renderOffline(processor, {
      sampleRate,
      duration: seconds,
      inputs,
      params,
      events: request.events,
      messages: request.messages,
    });
    const channels = (result.outputs.main ?? []) as Float32Array[];
    const report = analyse(channels, sampleRate, {
      ...request.notes,
      broken: result.diagnostics.scrubbedSamples,
    });
    let png: ArrayBuffer | undefined;
    if (request.image && channels[0]) {
      const bytes = await spectrogramPng(channels[0], sampleRate);
      png = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
    }
    worker.postMessage(
      { id, report, png, renderMs: performance.now() - started },
      png ? [png] : [],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    worker.postMessage({
      id,
      error: { message, issues: attributeError(message, request.nodes, { codeboxes: boxes }) },
    });
  }
}

worker.onmessage = async event => {
  if ((event.data as RenderRequest).kind === 'render') {
    await render(event.data as RenderRequest);
    return;
  }
  const request = event.data as CompileRequest;
  const { id } = request;
  const boxes = request.codeboxes.map(b => ({
    node: b.node,
    line: b.line,
    lines: b.code.split('\n').length + 1,
  }));
  try {
    if (typeof request.source !== 'string' || request.source.length > 400_000)
      throw new Error('Generated source is too large (over 400,000 characters).');
    const refused = await unguarded(request.codeboxes);
    if (refused.length) {
      worker.postMessage({ id, error: { message: UNGUARDED, issues: refused } });
      return;
    }
    if (request.codeboxes.length) {
      worker.postMessage({ id, phase: 'checking codebox types' });
      project ??= createTypeProject(types);
      const issues = request.codeboxes.flatMap(b =>
        project!.checkCodebox(b.node, b.code, b.inputs, b.outputs),
      );
      if (issues.some(i => i.severity === 'error')) {
        worker.postMessage({ id, error: { message: 'Fix the codebox errors.', issues } });
        return;
      }
    }
    worker.postMessage({ id, phase: 'compiling' });
    const started = performance.now();
    let processor;
    try {
      processor = evaluate(request.source, registry).processor;
    } catch (error) {
      const e = error as EvaluationError;
      worker.postMessage({
        id,
        error: {
          message: e.message,
          issues: attributeError(e.message, request.nodes, {
            node: e.node,
            line: e.line,
            codeboxes: boxes,
          }),
        },
      });
      return;
    }
    const compiled = await compile(processor, { sampleRate: 48000 });
    // Validate now so the function-size limit is reported here, not when the worklet loads.
    await WebAssembly.compile(compiled.wasm as BufferSource);
    const meta = extractWorkletMeta(
      compiled.graph as unknown as Parameters<typeof extractWorkletMeta>[0],
    );
    const processorName = `den-kit-${request.hash}`;
    const moduleSource = emitWorkletModuleSource(meta, {
      processorName,
      runtime: { kind: 'inline', code: runtime },
    });
    const wasm = Uint8Array.from(compiled.wasm).buffer;
    worker.postMessage(
      {
        id,
        result: {
          hash: request.hash,
          meta,
          moduleSource,
          wasm,
          processorName,
          sampleRate: 48000,
          compileMs: performance.now() - started,
        },
      },
      [wasm],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    worker.postMessage({
      id,
      error: { message, issues: attributeError(message, request.nodes, { codeboxes: boxes }) },
    });
  }
};
