// Optional musical synchronization supplied by a host. These live values are not
// part of a work; a Transport block chooses where they enter its patch.
export type LinkCommand =
  | { type: 'status' }
  | { type: 'enable' | 'sync' | 'play'; value: boolean }
  | { type: 'tempo'; value: number };

export interface LinkSnapshot {
  enabled: boolean;
  peers: number;
  tempo: number;
  beat: number;
  phase: number;
  playing: boolean;
  startStopSync: boolean;
  /** performance.now() time at which beat was measured, in milliseconds. */
  performanceTime: number;
  /** The quantized local start time, in the same clock. */
  startPerformanceTime: number;
  /** Native play/stop event identity; unchanged while its beat timeline moves. */
  transportId: number;
}

export interface Link {
  request(command: LinkCommand): Promise<LinkSnapshot>;
}
