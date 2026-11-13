import { describe, expect, it } from 'vite-plus/test';
import { contextTarget } from '../../../src/sound/compile/target.ts';

describe('the context compile target', () => {
  it('uses the actual context rate and configurable render quantum', () => {
    expect(contextTarget({ sampleRate: 44100, renderQuantumSize: 32 })).toEqual({
      sampleRate: 44100,
      renderQuantumSize: 32,
    });
  });

  it('uses the standard quantum when the browser exposes no renderQuantumSize', () => {
    expect(contextTarget({ sampleRate: 96000 })).toEqual({
      sampleRate: 96000,
      renderQuantumSize: 128,
    });
  });
});
