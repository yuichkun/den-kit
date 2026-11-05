// Maps a host's renderer-clock snapshot onto the time samples reach the speakers.
// Transport is live performance input, like MIDI, and never changes the work.
export interface TransportSnapshot {
  tempo: number;
  beat: number;
  playing: boolean;
  /** Milliseconds in performance.now()'s clock. */
  performanceTime: number;
  /** A future quantized play event, in the same clock. */
  startPerformanceTime?: number;
  /** Stable identity of the host's last play/stop event. */
  transportId?: number;
}

export interface AudioTransportSnapshot {
  tempo: number;
  beat: number;
  playing: boolean;
  time: number;
  startTime: number;
  expires: number;
  transportId?: number;
}

/** The Web Audio compressor in AudioEngine's safety chain has 6 ms lookahead. */
export const SAFETY_LATENCY = 0.006;

export function audioTransportSnapshot(
  snapshot: TransportSnapshot,
  context: {
    currentTime: number;
    baseLatency?: number;
    outputLatency?: number;
    getOutputTimestamp?: () => { contextTime?: number; performanceTime?: number };
  },
  now: number,
): AudioTransportSnapshot | null {
  if (
    !Number.isFinite(snapshot.tempo) ||
    snapshot.tempo <= 0 ||
    snapshot.tempo > 1000 ||
    !Number.isFinite(snapshot.beat) ||
    !Number.isFinite(snapshot.performanceTime) ||
    (snapshot.startPerformanceTime !== undefined && !Number.isFinite(snapshot.startPerformanceTime))
  )
    return null;
  const stamp = context.getOutputTimestamp?.();
  // The first timestamp after resume can be all zeroes. Until it is valid, use
  // the device's reported latency; never combine both latency estimates.
  const outputNow =
    stamp?.performanceTime && Number.isFinite(stamp.contextTime)
      ? stamp.performanceTime + (context.currentTime - stamp.contextTime!) * 1000
      : now + ((context.baseLatency ?? 0) + (context.outputLatency ?? 0)) * 1000;
  const audibleNow = outputNow + SAFETY_LATENCY * 1000;
  return {
    tempo: snapshot.tempo,
    beat: snapshot.beat + ((audibleNow - snapshot.performanceTime) * snapshot.tempo) / 60000,
    playing: snapshot.playing,
    time: context.currentTime,
    startTime:
      context.currentTime +
      ((snapshot.startPerformanceTime ?? snapshot.performanceTime) - audibleNow) / 1000,
    expires: context.currentTime + (snapshot.performanceTime + 1000 - audibleNow) / 1000,
    transportId: snapshot.transportId,
  };
}
