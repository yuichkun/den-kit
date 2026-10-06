// Transpile and evaluate a generated processor module against a module registry.
// Runs only in the disposable compile worker (browser) or in Node tests.
import ts from 'typescript';
import type { CompiledProcessor } from '@unworklet/core';

export class EvaluationError extends Error {
  readonly node?: string;
  readonly line?: number;
  constructor(message: string, node?: string, line?: number) { super(message); this.name = 'EvaluationError'; this.node = node; this.line = line; }
}

export interface Evaluated { processor: CompiledProcessor<unknown>; trace: { node: string } }

export function transpile(source: string): string {
  const result = ts.transpileModule(source, {
    fileName: 'patch.processor.ts', reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  });
  const error = result.diagnostics?.find(d => d.category === ts.DiagnosticCategory.Error);
  if (error) {
    const line = error.file && error.start !== undefined ? error.file.getLineAndCharacterOfPosition(error.start).line + 1 : undefined;
    throw new EvaluationError(`Syntax error: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`, undefined, line);
  }
  return result.outputText;
}

/** Evaluate the module. The processor body runs later, inside compile(). */
export function evaluate(source: string, modules: Record<string, unknown>): Evaluated {
  const js = transpile(source);
  const record = { exports: {} as Record<string, unknown> };
  const require = (name: string) => {
    if (!Object.hasOwn(modules, name)) throw new EvaluationError(`Unsupported import: ${name}.`);
    return modules[name];
  };
  const execute = new Function('require', 'module', 'exports', js);
  // defineProcessor captures the graph immediately, so DSP construction errors
  // (den RangeErrors, codebox exceptions) surface here; `trace` names the node.
  try { execute(require, record, record.exports); }
  catch (error) {
    if (error instanceof EvaluationError) throw error;
    const node = (record.exports.trace as { node?: string } | undefined)?.node || undefined;
    throw new EvaluationError(error instanceof Error ? error.message : String(error), node);
  }
  const processor = record.exports.default as CompiledProcessor<unknown> | undefined;
  if (!processor || typeof processor !== 'object' || !('worklet' in processor)) throw new EvaluationError('The module must default-export a processor.');
  const trace = (record.exports.trace as { node: string } | undefined) ?? { node: '' };
  return { processor, trace };
}
