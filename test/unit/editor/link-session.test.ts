import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { LinkSession, linkPosition } from '../../../src/editor/link-session.ts';
import type { LinkCommand, LinkSnapshot } from '../../../src/host/link.ts';

const snapshot = (overrides: Partial<LinkSnapshot> = {}): LinkSnapshot => ({
  enabled: true,
  peers: 1,
  tempo: 120,
  beat: 3.5,
  phase: 3.5,
  playing: true,
  startStopSync: false,
  performanceTime: 100,
  startPerformanceTime: 350,
  transportId: 250000,
  ...overrides,
});

afterEach(() => vi.useRealTimers());

describe('Link session', () => {
  it('reads the clock on opening without joining, sending tempo, or starting peers', async () => {
    vi.useFakeTimers();
    const request = vi.fn(async (_command: LinkCommand) =>
      snapshot({ enabled: false, playing: false }),
    );
    const setTransport = vi.fn();
    const changed = vi.fn();
    const controller = new LinkSession({ request }, { setTransport }, changed);
    controller.start();
    await vi.advanceTimersByTimeAsync(151);
    expect(request.mock.calls).toHaveLength(4);
    expect(request.mock.calls.every(([command]) => command.type === 'status')).toBe(true);
    expect(setTransport.mock.calls.every(([value]) => value === null)).toBe(true);
    controller.dispose();
    await vi.advanceTimersByTimeAsync(200);
    expect(request.mock.calls).toHaveLength(4);
  });

  it('forwards measured time unchanged and stops the clock when disconnected or failed', async () => {
    const setTransport = vi.fn();
    const changed = vi.fn();
    const request = vi
      .fn()
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot({ enabled: false }))
      .mockRejectedValueOnce(new Error('Reconnect Link.'));
    const controller = new LinkSession({ request }, { setTransport }, changed);
    await controller.request({ type: 'status' });
    expect(setTransport).toHaveBeenLastCalledWith(snapshot());
    await controller.request({ type: 'enable', value: false });
    expect(setTransport).toHaveBeenLastCalledWith(null);
    await controller.request({ type: 'status' });
    expect(changed).toHaveBeenLastCalledWith(null, 'Reconnect Link.');
    expect(setTransport).toHaveBeenLastCalledWith(null);
    controller.dispose();
  });

  it('never applies a late reply after the editor closes', async () => {
    let release!: (value: LinkSnapshot) => void;
    const request = vi.fn(() => new Promise<LinkSnapshot>(resolve => (release = resolve)));
    const setTransport = vi.fn();
    const changed = vi.fn();
    const controller = new LinkSession({ request }, { setTransport }, changed);
    const pending = controller.request({ type: 'play', value: true });
    await Promise.resolve();
    controller.dispose();
    release(snapshot());
    await pending;
    expect(changed).not.toHaveBeenCalled();
    expect(setTransport).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('shows the four-beat phase and the quantized start without treating it as song position', () => {
    expect(linkPosition(snapshot(), 100)).toEqual({ beat: 3, pending: true });
    expect(linkPosition(snapshot(), 350)).toEqual({ beat: 0, pending: false });
    expect(linkPosition(snapshot({ beat: -0.25, playing: false }), 100)).toEqual({
      beat: 3,
      pending: false,
    });
  });
});
