import { describe, expect, it } from 'vite-plus/test';
import { LinkClock, desktopLink } from '../../../desktop/page/link.ts';
import type { DesktopLinkState } from '../../../desktop/page/api.ts';
import type { LinkCommand } from '../../../src/host/link.ts';

const state = (timeUs = 1000000): DesktopLinkState => ({
  enabled: true,
  peers: 1,
  tempo: 120,
  beat: 3,
  phase: 3,
  playing: true,
  startStopSync: false,
  timeUs,
  startTimeUs: timeUs + 500000,
  transportTimeUs: 250000,
});

describe('Link clock mapping', () => {
  it('maps the beat and scheduled start with the same minimum-RTT offset', () => {
    const clock = new LinkClock();
    const first = clock.map(state(), 100, 104);
    expect(first.performanceTime).toBe(102);
    expect(first.startPerformanceTime).toBe(602);
    const delayed = clock.map(state(1100000), 200, 280);
    expect(delayed.performanceTime).toBe(202);
    expect(delayed.startPerformanceTime).toBe(702);
    expect(delayed.beat).toBe(3);
    expect(delayed.tempo).toBe(120);
    expect(delayed.transportId).toBe(first.transportId);
  });

  it('refreshes the offset after old observations expire', () => {
    const clock = new LinkClock();
    clock.map(state(), 100, 104);
    expect(clock.map(state(12000000), 11100, 11102).performanceTime).toBe(11101);
  });

  it('refuses a stalled IPC sample instead of anchoring audio to its arrival', () => {
    expect(() => new LinkClock().map(state(), 0, 1200)).toThrow(/not responding/);
  });

  it('serializes control and status requests and recovers after a rejected request', async () => {
    const calls: LinkCommand[] = [];
    let release!: (state: DesktopLinkState) => void;
    const first = new Promise<DesktopLinkState>(resolve => (release = resolve));
    const link = desktopLink(
      async command => {
        calls.push(command);
        if (calls.length === 1) return first;
        if (command.type === 'tempo') throw new Error('Unavailable');
        return state();
      },
      () => 100,
    );
    const status = link.request({ type: 'status' });
    const tempo = link.request({ type: 'tempo', value: 130 });
    const rejection = expect(tempo).rejects.toThrow('Unavailable');
    await Promise.resolve();
    expect(calls).toEqual([{ type: 'status' }]);
    release(state());
    await status;
    await rejection;
    await link.request({ type: 'enable', value: false });
    expect(calls).toEqual([
      { type: 'status' },
      { type: 'tempo', value: 130 },
      { type: 'enable', value: false },
    ]);
  });
});
