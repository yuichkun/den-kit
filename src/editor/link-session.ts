// Live Link state feeds the audio clock without editing the work. Polling reads
// the timeline; the audio worklet decides when each sample crosses a beat.
import type { Link, LinkCommand, LinkSnapshot } from '../host/link.ts';
import type { AudioEngine } from '../sound/audio-engine.ts';

export class LinkSession {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly link: Link;
  private readonly engine: Pick<AudioEngine, 'setTransport'>;
  private readonly changed: (state: LinkSnapshot | null, error: string) => void;

  constructor(
    link: Link,
    engine: Pick<AudioEngine, 'setTransport'>,
    changed: (state: LinkSnapshot | null, error: string) => void,
  ) {
    this.link = link;
    this.engine = engine;
    this.changed = changed;
  }

  start() {
    void this.poll();
  }

  request(command: LinkCommand): Promise<void> {
    const task = this.tail.then(async () => {
      if (this.disposed) return;
      try {
        const state = await this.link.request(command);
        if (this.disposed) return;
        this.engine.setTransport(state.enabled ? state : null);
        this.changed(state, '');
      } catch (error) {
        if (this.disposed) return;
        this.engine.setTransport(null);
        this.changed(null, error instanceof Error ? error.message : 'Link is unavailable.');
      }
    });
    this.tail = task;
    return task;
  }

  private async poll() {
    await this.request({ type: 'status' });
    if (!this.disposed) this.timer = setTimeout(() => void this.poll(), 50);
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.engine.setTransport(null);
  }
}

export function linkPosition(state: LinkSnapshot, now: number) {
  const beat = state.beat + ((now - state.performanceTime) * state.tempo) / 60000;
  return {
    beat: ((Math.floor(beat) % 4) + 4) % 4,
    pending: state.playing && now < state.startPerformanceTime,
  };
}
