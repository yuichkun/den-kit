// A compiled sound belongs to one sample rate and one render quantum. Source
// hashes describe the patch; cache keys also describe the context that plays it.
export interface CompileTarget {
  sampleRate: number;
  renderQuantumSize: number;
}

/** Validation and offline compilation before a live context exists. */
export const DEFAULT_COMPILE_TARGET: Readonly<CompileTarget> = Object.freeze({
  sampleRate: 48000,
  renderQuantumSize: 128,
});

/** Browsers without configurable render quanta process 128 samples at a time. */
export function contextTarget(context: {
  sampleRate: number;
  renderQuantumSize?: number;
}): CompileTarget {
  return {
    sampleRate: context.sampleRate,
    renderQuantumSize: context.renderQuantumSize ?? 128,
  };
}

export function sameTarget(a: CompileTarget, b: CompileTarget): boolean {
  return a.sampleRate === b.sampleRate && a.renderQuantumSize === b.renderQuantumSize;
}

export function compileKey(hash: string, target: CompileTarget): string {
  return `${hash}-${target.sampleRate}-${target.renderQuantumSize}`;
}
