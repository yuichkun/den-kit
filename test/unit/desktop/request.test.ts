import { afterEach, describe, expect, it, vi } from 'vitest';
import { desktopRequest } from '../../../src/desktop/request.ts';

afterEach(() => vi.useRealTimers());
describe('settings IPC deadlines', () => {
  it('ends a hung operation and safely ignores its late result', async () => {
    vi.useFakeTimers();
    let resolve!: (value: string) => void;
    const pending = desktopRequest(new Promise<string>(r => { resolve = r; }), 100);
    const failure = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(100);
    await failure;
    resolve('too late');
    expect(await desktopRequest(Promise.resolve('recovered'))).toBe('recovered');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('preserves a failed operation and clears its deadline', async () => {
    vi.useFakeTimers();
    await expect(desktopRequest(Promise.reject(new Error('Connection closed.')))).rejects.toThrow('Connection closed');
    expect(vi.getTimerCount()).toBe(0);
  });
});
