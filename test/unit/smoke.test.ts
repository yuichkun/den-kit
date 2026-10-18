import { describe, expect, it } from 'vite-plus/test';
import { defineProcessor } from '@unworklet/core';
import { oscillator } from '@denaudio/den/oscillator';

describe('scaffold', () => {
  it('resolves den source and the single root copy of @unworklet/core', () => {
    expect(typeof defineProcessor).toBe('function');
    expect(oscillator).toBeTruthy();
  });
});
