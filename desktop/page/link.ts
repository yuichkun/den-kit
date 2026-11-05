// Map the native Link clock into the renderer clock. The shortest recent round
// trip estimates the offset; IPC arrival jitter must not move the musical beat.
import type { Link, LinkCommand, LinkSnapshot } from '../../src/host/link.ts';
import type { DesktopLinkState } from './api.ts';

export class LinkClock {
  private samples: Array<{ at: number; roundTrip: number; offset: number }> = [];

  map(state: DesktopLinkState, sent: number, received: number): LinkSnapshot {
    const roundTrip = received - sent;
    if (!Number.isFinite(roundTrip) || roundTrip < 0 || roundTrip > 1000)
      throw new Error('Link is not responding. Try reconnecting.');
    this.samples = this.samples.filter(sample => received - sample.at < 10000);
    this.samples.push({
      at: received,
      roundTrip,
      offset: (sent + received) / 2 - state.timeUs / 1000,
    });
    const best = this.samples.reduce((a, b) => (a.roundTrip <= b.roundTrip ? a : b));
    const { timeUs, startTimeUs, transportTimeUs, ...rest } = state;
    return {
      ...rest,
      performanceTime: timeUs / 1000 + best.offset,
      startPerformanceTime: startTimeUs / 1000 + best.offset,
      transportId: transportTimeUs,
    };
  }
}

/** Commands and polling share one ordered request stream. */
export function desktopLink(
  invoke: (command: LinkCommand) => Promise<DesktopLinkState>,
  now = () => performance.now(),
): Link {
  const clock = new LinkClock();
  let tail: Promise<unknown> = Promise.resolve();
  return {
    request(command) {
      const request = tail.then(async () => {
        const sent = now();
        const state = await invoke(command);
        return clock.map(state, sent, now());
      });
      tail = request.catch(() => {});
      return request;
    },
  };
}
