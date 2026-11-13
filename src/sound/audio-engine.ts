// Live audio at the context's rate and render quantum: compiled artifacts swapped
// in with a short crossfade, held notes re-sent across swaps, knob values applied as AudioParams,
// assets decoded and sent to the processor that reads them, and a safety stage
// (limiter + clipper + health mute) in front of the speakers.
import { createNode, type CompiledProcessor, type UnworkletNode } from '@unworklet/core';
import { makeWorkletNamespaceFromMeta } from '@unworklet/core/worklet';
import type { Artifact } from './compile/protocol.ts';
import {
  compileKey,
  contextTarget,
  DEFAULT_COMPILE_TARGET,
  sameTarget,
  type CompileTarget,
} from './compile/target.ts';
import { testSignal as testSignalData } from './analysis.ts';
import { slotPayload, type AssetLoad } from './assets.ts';

export type EngineState = 'off' | 'starting' | 'running' | 'suspended' | 'error';
/** What an effect patch hears: test material, the computer's audio input (`input`: a microphone or a line in), or nothing. */
export type TestSignal = 'off' | 'chords' | 'drums' | 'noise' | 'guitar' | 'input';

export interface LoadInfo {
  values: Record<string, number>;
  voices: boolean;
  audioIn: boolean;
  probes: number;
  /** What each asset slot of the processor holds. */
  assets?: AssetLoad[];
}
type Node = UnworkletNode<unknown>;

interface Live {
  node: Node;
  gain: GainNode;
  artifact: Artifact;
  info: LoadInfo;
  ctx: AudioContext;
  /** The key of what was sent to each asset slot. */
  sent: Map<string, string>;
}

export interface EngineEvents {
  state?: (state: EngineState, message: string) => void;
  health?: (message: string, muted: boolean) => void;
  error?: (message: string) => void;
}

export interface EngineOptions {
  createContext?: () => AudioContext;
  /** Rotate the AudioContext after this many module registrations (Web Audio cannot unload modules). */
  rotateAfter?: number;
  crossfadeMs?: number;
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function timeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      v => {
        clearTimeout(t);
        resolve(v);
      },
      e => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export class AudioEngine {
  state: EngineState = 'off';
  message = 'Audio is off. It starts on the first click or key press.';
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  rawAnalyser: AnalyserNode | null = null;
  outAnalyser: AnalyserNode | null = null;
  probeAnalysers: AnalyserNode[] = [];
  volume = 0.5;
  readonly stats = {
    created: 0,
    disposed: 0,
    registrations: 0,
    rotations: 0,
    swaps: 0,
    healthEvents: 0,
  };
  private current: Live | null = null;
  private fading: Live[] = [];
  private held = new Map<number, number>();
  private urls = new Map<string, { moduleUrl: string; wasmUrl: string }>();
  private testSignal: TestSignal = 'chords';
  private inputBus: GainNode | null = null;
  private inputTimer: ReturnType<typeof setInterval> | null = null;
  private inputSources: AudioScheduledSourceNode[] = [];
  private liveInput: { stream: MediaStream; source: MediaStreamAudioSourceNode } | null = null;
  private guitar: AudioBuffer | null = null;
  private phraseTimers: Array<ReturnType<typeof setTimeout>> = [];
  private healthTimes: number[] = [];
  /** The node being swapped in (not yet `current`): it may run away in its very first render quanta. */
  private incoming: Node | null = null;
  private healthMuted = false;
  private loadSerial = 0;
  private pendingLoad: { info: LoadInfo; node?: Node; ctx?: AudioContext } | null = null;
  private preparing = new Set<AudioContext>();
  private assetLoads: AssetLoad[] = [];
  private decoded = new Map<string, Promise<AudioBuffer | null>>();
  private incomingSent: Map<string, string> | null = null;
  private readonly options: Required<EngineOptions>;
  private readonly events: EngineEvents;

  constructor(events: EngineEvents = {}, options: EngineOptions = {}) {
    this.events = events;
    this.options = {
      createContext: () => new AudioContext({ latencyHint: 'interactive' }),
      rotateAfter: options.rotateAfter ?? 40,
      crossfadeMs: options.crossfadeMs ?? 30,
      ...(options.createContext ? { createContext: options.createContext } : {}),
    };
  }

  private setState(state: EngineState, message: string) {
    this.state = state;
    this.message = message;
    this.events.state?.(state, message);
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  async start(): Promise<boolean> {
    if (this.ctx && this.ctx.state === 'running') return true;
    if (this.ctx && this.ctx.state === 'suspended') {
      const ctx = this.ctx;
      const serial = ++this.loadSerial;
      try {
        await timeout(ctx.resume(), 3000, 'Audio did not resume.');
        if (serial !== this.loadSerial || this.ctx !== ctx) return false;
        this.setState('running', 'Audio running.');
        return true;
      } catch (e) {
        if (serial === this.loadSerial && this.ctx === ctx)
          this.setState('suspended', `Audio is suspended: ${(e as Error).message} Click to retry.`);
        return false;
      }
    }
    this.setState('starting', 'Starting audio…');
    const serial = ++this.loadSerial;
    const previous = this.ctx;
    let ctx: AudioContext | undefined;
    try {
      ctx = this.options.createContext();
      this.preparing.add(ctx);
      await timeout(ctx.resume(), 3000, 'Audio did not resume (the browser may need a click).');
      if (serial !== this.loadSerial) {
        await ctx.close().catch(() => {});
        return false;
      }
      this.releaseSound();
      this.attachContext(ctx);
      void previous?.close().catch(() => {});
      this.setState('running', 'Audio running.');
      return true;
    } catch (e) {
      await ctx?.close().catch(() => {});
      if (serial === this.loadSerial) this.setState('error', (e as Error).message || String(e));
      return false;
    } finally {
      if (ctx) this.preparing.delete(ctx);
    }
  }

  private attachContext(ctx: AudioContext) {
    this.ctx = ctx;
    this.urls.clear();
    for (const key of this.decoded.keys())
      if (!key.startsWith(`${ctx.sampleRate}:`)) this.decoded.delete(key);
    this.guitar = null;
    this.stats.registrations = 0;
    this.rawAnalyser = new AnalyserNode(ctx, { fftSize: 2048 });
    this.master = new GainNode(ctx, { gain: this.volume });
    const limiter = new DynamicsCompressorNode(ctx, {
      threshold: -3,
      knee: 0,
      ratio: 20,
      attack: 0.001,
      release: 0.1,
    });
    const curve = new Float32Array(1025).map((_, i) =>
      Math.max(-0.98, Math.min(0.98, (i / 512 - 1) * 1)),
    );
    const clip = new WaveShaperNode(ctx, { curve, oversample: 'none' });
    this.outAnalyser = new AnalyserNode(ctx, { fftSize: 2048 });
    this.rawAnalyser
      .connect(this.master)
      .connect(limiter)
      .connect(clip)
      .connect(this.outAnalyser)
      .connect(ctx.destination);
    this.inputBus = new GainNode(ctx, { gain: 0 });
    ctx.onstatechange = () => {
      if (this.ctx !== ctx) return;
      if (ctx.state === 'suspended' || (ctx.state as string) === 'interrupted')
        this.setState(
          'suspended',
          'Audio was suspended by the browser or device. Click anywhere or press a key to resume.',
        );
      else if (ctx.state === 'running' && this.state !== 'running')
        this.setState('running', 'Audio running.');
      else if (ctx.state === 'closed' && this.ctx === ctx)
        this.setState(
          'error',
          'Audio device closed. Press "Retry audio" next to the keyboard to restart.',
        );
    };
  }

  get running() {
    return this.state === 'running' && !!this.ctx;
  }
  get hasNode() {
    return !!this.current;
  }
  get currentHash() {
    return this.current?.artifact.hash ?? null;
  }
  get target(): CompileTarget {
    return this.ctx ? contextTarget(this.ctx) : { ...DEFAULT_COMPILE_TARGET };
  }

  /** Swap in a compiled artifact. Keeps the previous sound if anything fails. */
  async load(
    artifact: Artifact,
    info: LoadInfo,
    recompile?: (target: CompileTarget) => Promise<Artifact>,
  ): Promise<void> {
    if (!this.ctx || !this.master) throw new Error('Audio is not running.');
    const serial = ++this.loadSerial;
    const loading: NonNullable<AudioEngine['pendingLoad']> = { info };
    this.pendingLoad = loading;
    try {
      const prepared = await this.prepare(artifact, info, serial, recompile);
      if (!prepared) return;
      const { node, ctx } = prepared;
      artifact = prepared.artifact;
      if (serial !== this.loadSerial || this.ctx !== ctx) {
        node.dispose();
        this.stats.disposed++;
        return;
      }
      loading.node = node;
      loading.ctx = ctx;
      for (const [name, value] of Object.entries(info.values))
        this.applyParam(node, ctx, name, value);
      const gain = new GainNode(ctx, { gain: 0 });
      this.incoming = node;
      this.retryAfterChange(); // a new patch gets a fresh chance before its health is checked
      while (prepared.health.pending > 0) {
        prepared.health.pending--;
        this.onHealth();
      }
      // Assets go in before the node is heard (they arrive at a block boundary).
      const sent = prepared.sent;
      this.incomingSent = sent;
      this.assetLoads = info.assets ?? [];
      void this.sendAssets(node, sent);
      node.outputs.main!.connect(gain);
      gain.connect(this.rawAnalyser!);
      if (info.audioIn && node.inputs.main) this.inputBus!.connect(node.inputs.main);
      node.onError(event => {
        if (event.code !== 'sab-unavailable')
          this.events.error?.('message' in event ? String(event.message) : JSON.stringify(event));
      });
      this.attachProbes(node, info.probes);
      const live: Live = { node, gain, artifact, info, ctx, sent };
      // Wall time is not audio time: a newly resumed device may take longer to start rendering.
      const rendered =
        ctx.currentTime + (2 * contextTarget(ctx).renderQuantumSize) / ctx.sampleRate;
      const renderDeadline = performance.now() + 3000;
      while (
        ctx.state === 'running' &&
        ctx.currentTime < rendered &&
        serial === this.loadSerial &&
        this.ctx === ctx
      ) {
        if (performance.now() >= renderDeadline) {
          if (this.incoming === node) this.incoming = null;
          node.dispose();
          gain.disconnect();
          this.stats.disposed++;
          throw new Error('The audio device did not start rendering.');
        }
        await wait(4);
      }
      if (serial !== this.loadSerial || this.ctx !== ctx) {
        if (this.incoming === node) this.incoming = null;
        node.dispose();
        this.stats.disposed++;
        return;
      }
      const now = ctx.currentTime,
        fade = this.options.crossfadeMs / 1000;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + fade);
      const previous = this.current;
      this.current = live;
      this.incoming = null;
      this.incomingSent = null;
      // Send held notes once the new node has started, including keys pressed while it was loading.
      if (info.voices)
        for (const [note, velocity] of this.held)
          node.midi.midi?.send({ type: 'noteOn', channel: 0, note, velocity } as never);
      this.stats.swaps++;
      if (previous) {
        previous.gain.gain.cancelScheduledValues(now);
        previous.gain.gain.setValueAtTime(previous.gain.gain.value, now);
        previous.gain.gain.linearRampToValueAtTime(0, now + fade);
        this.fading.push(previous);
        setTimeout(() => this.retire(previous), this.options.crossfadeMs + 40);
      }
      // At most two nodes alive: retire anything older immediately.
      while (this.fading.length > 1) this.retire(this.fading[0]!);
      this.applyTestSignal();
    } finally {
      if (this.pendingLoad === loading) this.pendingLoad = null;
    }
  }

  private retire(live: Live) {
    const i = this.fading.indexOf(live);
    if (i < 0) return;
    this.fading.splice(i, 1);
    try {
      live.node.outputs.main?.disconnect();
    } catch {
      /* ok */
    }
    try {
      live.gain.disconnect();
    } catch {
      /* ok */
    }
    try {
      if (live.node.inputs.main) this.inputBus?.disconnect(live.node.inputs.main);
    } catch {
      /* ok */
    }
    live.node.dispose();
    this.stats.disposed++;
  }

  /** Stop the current sound (patch has nothing to compile). */
  unload() {
    ++this.loadSerial;
    this.pendingLoad = null;
    if (!this.current) return;
    const live = this.current;
    this.current = null;
    this.fading.push(live);
    const now = live.ctx.currentTime;
    live.gain.gain.cancelScheduledValues(now);
    live.gain.gain.setValueAtTime(live.gain.gain.value, now);
    live.gain.gain.linearRampToValueAtTime(0, now + 0.03);
    setTimeout(() => this.retire(live), 80);
  }

  /** Prepare a replacement without interrupting the sounding context on a compile or load failure. */
  private async prepare(
    artifact: Artifact,
    info: LoadInfo,
    serial: number,
    recompile?: (target: CompileTarget) => Promise<Artifact>,
  ): Promise<
    | {
        artifact: Artifact;
        node: Node;
        ctx: AudioContext;
        health: { pending: number };
        sent: Map<string, string>;
      }
    | undefined
  > {
    const previous = this.ctx!;
    const rotating =
      this.stats.registrations >= this.options.rotateAfter &&
      !this.urls.has(compileKey(artifact.hash, this.target));
    const ctx = rotating ? this.options.createContext() : previous;
    const urls = rotating ? new Map<string, { moduleUrl: string; wasmUrl: string }>() : this.urls;
    let committed = !rotating;
    let abandoned = false;
    let disposedLate = false;
    let node: Node | undefined;
    if (rotating) this.preparing.add(ctx);
    const stale = () => serial !== this.loadSerial || this.ctx !== previous;
    try {
      if (rotating && ctx.state !== 'suspended')
        await timeout(ctx.suspend(), 3000, 'Audio did not pause while preparing its replacement.');
      const target = contextTarget(ctx);
      if (!sameTarget(artifact, target)) {
        if (!recompile)
          throw new Error(
            `The sound needs compiling for ${target.sampleRate} Hz and ${target.renderQuantumSize} samples.`,
          );
        const hash = artifact.hash;
        artifact = await recompile(target);
        if (artifact.hash !== hash || !sameTarget(artifact, target))
          throw new Error('The compiled sound does not match this patch and audio context.');
      }
      if (stale()) return;
      const key = compileKey(artifact.hash, target);
      let source = urls.get(key);
      if (!source) {
        source = {
          moduleUrl: URL.createObjectURL(
            new Blob([artifact.moduleSource], { type: 'text/javascript' }),
          ),
          wasmUrl: URL.createObjectURL(new Blob([artifact.wasm], { type: 'application/wasm' })),
        };
        urls.set(key, source);
        if (!rotating) this.stats.registrations++;
      }
      const processor = {
        schemaHash: artifact.schemaHash,
        worklet: {
          ...makeWorkletNamespaceFromMeta(artifact.meta),
          ...source,
          processorName: artifact.processorName,
          displayName: 'den-kit patch',
          bakedSampleRate: artifact.sampleRate,
        },
      } as unknown as CompiledProcessor<unknown>;
      const pending = createNode(ctx, processor, { initial: info.values });
      pending.then(
        late => {
          if (abandoned || stale()) {
            late.dispose();
            this.stats.disposed++;
            disposedLate = true;
          }
        },
        () => {},
      );
      node = await timeout(pending, 15000, 'The audio worklet did not become ready in 15 s.');
      this.stats.created++;
      if (stale()) {
        if (disposedLate) node = undefined;
        return;
      }
      if (!Object.hasOwn(node.outputs, 'main')) throw new Error('The patch has no main output.');
      // A candidate can report its only health edge during silent prewarming.
      // Keep it until that node is incoming, without muting the sound it may fail to replace.
      const health = { pending: 0 };
      const candidate = node;
      candidate.events.kitHealth?.on(() => {
        if (this.current?.node === candidate || this.incoming === candidate) this.onHealth();
        else if (serial === this.loadSerial) health.pending++;
      });
      // Resident samples must arrive before the first gate is processed. A patch
      // can start with a held gate, whose rising edge occurs only once.
      const sent = new Map<string, string>();
      let assets: LoadInfo['assets'];
      do {
        assets = info.assets;
        await this.sendAssets(node, sent, ctx, () => (stale() ? [] : (info.assets ?? [])));
      } while (!stale() && assets !== info.assets);
      if (stale()) return;
      if (rotating) {
        // The new context stays suspended until its assets are queued: a worklet
        // can process without a connection and consume a held gate before then.
        await timeout(ctx.resume(), 3000, 'Audio did not resume after rotating the audio context.');
        if (stale()) return;
        // A silent connection starts rendering before the old sound is retired.
        const silent = new GainNode(ctx, { gain: 0 });
        node.outputs.main!.connect(silent);
        silent.connect(ctx.destination);
        const rendered = ctx.currentTime + (2 * target.renderQuantumSize) / target.sampleRate;
        const deadline = performance.now() + 3000;
        try {
          while (ctx.currentTime < rendered && !stale()) {
            if (ctx.state !== 'running' || performance.now() >= deadline)
              throw new Error('The audio device did not start rendering.');
            await wait(4);
          }
        } finally {
          node.outputs.main!.disconnect();
          silent.disconnect();
        }
        if (stale()) return;
        this.releaseSound();
        this.attachContext(ctx);
        this.urls = urls;
        this.stats.registrations = urls.size;
        this.stats.rotations++;
        committed = true;
        void previous.close().catch(() => {});
      }
      const prepared = { artifact, node, ctx, health, sent };
      node = undefined; // the caller owns the node
      return prepared;
    } catch (error) {
      if (!stale()) throw error;
    } finally {
      abandoned = true;
      if (node) {
        node.dispose();
        this.stats.disposed++;
      }
      if (rotating) {
        this.preparing.delete(ctx);
        if (!committed) {
          for (const source of urls.values()) {
            URL.revokeObjectURL(source.moduleUrl);
            URL.revokeObjectURL(source.wasmUrl);
          }
          await ctx.close().catch(() => {});
        }
      }
    }
  }

  private releaseSound() {
    for (const live of Array.from(this.fading)) this.retire(live);
    if (this.current) {
      this.fading.push(this.current);
      this.retire(this.current);
      this.current = null;
    }
    this.incoming = null;
    this.incomingSent = null;
    for (const { moduleUrl, wasmUrl } of this.urls.values()) {
      URL.revokeObjectURL(moduleUrl);
      URL.revokeObjectURL(wasmUrl);
    }
    this.urls.clear();
    this.stopTestSignal();
  }

  setParam(name: string, value: number) {
    this.retryAfterChange();
    for (const live of [this.current, ...this.fading])
      if (live) this.applyParam(live.node, live.ctx, name, value);
    if (this.pendingLoad) {
      this.pendingLoad.info.values[name] = value;
      const { node, ctx } = this.pendingLoad;
      if (node && ctx) this.applyParam(node, ctx, name, value);
    }
    if (this.current) this.current.info.values[name] = value;
  }

  private applyParam(node: Node, ctx: AudioContext, name: string, value: number) {
    const param = node.params[name];
    if (!param) return;
    const v = Math.fround(Math.max(param.minValue, Math.min(param.maxValue, value)));
    param.setValueAtTime(v, ctx.currentTime);
  }

  /** What the asset slots should hold now: anything that changed is decoded and sent, without recompiling. */
  setAssets(loads: AssetLoad[]) {
    this.assetLoads = loads;
    if (this.pendingLoad) this.pendingLoad.info.assets = loads;
    if (this.current) void this.sendAssets(this.current.node, this.current.sent);
    if (this.incoming && this.incomingSent) void this.sendAssets(this.incoming, this.incomingSent);
  }

  private async sendAssets(
    node: Node,
    sent: Map<string, string>,
    ctx = this.ctx,
    loads = () => this.assetLoads,
  ) {
    const events = node.events as unknown as Record<string, { emit?: (p: unknown) => void }>;
    for (const load of loads()) {
      // Superseded by newer loads: they are on their way, and the rest of these would send old contents.
      if (!loads().includes(load)) return;
      if (sent.get(load.event) === load.key || !events[load.event]?.emit) continue;
      sent.set(load.event, load.key);
      let payload: unknown;
      try {
        const contents = !load.key
          ? null
          : load.kind === 'bytes'
            ? await load.read()
            : await this.decode(load, ctx);
        payload = slotPayload(load.kind, contents);
      } catch (error) {
        this.events.error?.(`Could not read an asset: ${(error as Error).message}`);
        continue;
      }
      // Pointed elsewhere while this was read: the newer one is on its way.
      const current = loads().find(value => value.event === load.event);
      if (
        sent.get(load.event) !== load.key ||
        current?.key !== load.key ||
        current.kind !== load.kind
      )
        continue;
      events[load.event]!.emit!(payload);
    }
  }

  private decode(load: AssetLoad, ctx: AudioContext | null): Promise<AudioBuffer | null> {
    if (!ctx) return Promise.resolve(null);
    const key = `${ctx.sampleRate}:${load.key}`;
    let decoding = this.decoded.get(key);
    if (!decoding) {
      decoding = load
        .read()
        .then(bytes =>
          bytes ? ctx.decodeAudioData(bytes.slice().buffer).catch(() => null) : null,
        );
      this.decoded.set(key, decoding);
      // Keep the few sounds in use, not every one ever heard.
      while (this.decoded.size > 16) this.decoded.delete(this.decoded.keys().next().value!);
    }
    return decoding;
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master && this.ctx && !this.healthMuted)
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.01);
  }

  noteOn(note: number, velocity = 100) {
    if (note < 0 || note > 127) return;
    this.held.set(note, velocity);
    this.send({ type: 'noteOn', channel: 0, note, velocity });
  }
  noteOff(note: number) {
    if (!this.held.delete(note)) return;
    this.send({ type: 'noteOff', channel: 0, note, velocity: 0 });
  }
  allNotesOff() {
    for (const note of Array.from(this.held.keys())) this.noteOff(note);
    this.send({ type: 'cc', channel: 0, controller: 123, value: 0 });
  }
  get heldNotes() {
    return [...this.held.keys()];
  }

  private send(event: Record<string, unknown>) {
    // Note-offs go to every live node (incl. fading ones) so nothing sticks across a swap.
    for (const live of [this.current, ...this.fading]) live?.node.midi.midi?.send(event as never);
  }

  /** Panic: release everything and reset all DSP state (History, codebox state, delays). */
  panic() {
    this.stopPhrase();
    this.allNotesOff();
    for (const live of [this.current, ...this.fading])
      live?.node.events.reset?.emit({ value: 1 } as never);
    this.healthTimes = [];
    if (this.healthMuted) {
      this.healthMuted = false;
      this.setVolume(this.volume);
      this.events.health?.('Audio reset.', false);
    }
  }

  /** The patch changed: give a muted patch another chance (it mutes again if it still runs away). */
  private retryAfterChange() {
    if (!this.healthMuted) return;
    this.healthMuted = false;
    this.healthTimes = [];
    this.setVolume(this.volume);
    this.events.health?.('', false);
  }

  private onHealth() {
    if (!this.ctx || !this.master) return;
    this.stats.healthEvents++;
    const now = performance.now();
    this.healthTimes = [...this.healthTimes.filter(t => now - t < 5000), now];
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.002);
    for (const live of [this.current, ...this.fading])
      live?.node.events.reset?.emit({ value: 1 } as never);
    this.incoming?.events.reset?.emit({ value: 1 } as never);
    if (this.healthTimes.length >= 3) {
      this.healthMuted = true;
      this.events.health?.(
        'Sound is muted: the patch keeps producing runaway or invalid audio (often a feedback loop). Change the patch or undo (⌘Z) and it comes back.',
        true,
      );
      return;
    }
    this.events.health?.(
      'The patch produced NaN/Inf or a runaway level; output was muted and the DSP state reset.',
      false,
    );
    setTimeout(() => {
      if (!this.healthMuted && this.master && this.ctx)
        this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }, 250);
  }

  // ---- Probes (scope/meter widgets) ------------------------------------------
  private attachProbes(node: Node, count: number) {
    this.probeAnalysers = [];
    const out = node.outputs.probes;
    if (!out || !count || !this.ctx) return;
    const splitter = new ChannelSplitterNode(this.ctx, { numberOfOutputs: count });
    out.connect(splitter);
    for (let k = 0; k < count; k++) {
      const a = new AnalyserNode(this.ctx, { fftSize: 1024 });
      splitter.connect(a, k);
      this.probeAnalysers.push(a);
    }
  }

  // ---- Test input for effect patches -------------------------------------------
  setTestSignal(signal: TestSignal) {
    this.testSignal = signal;
    this.applyTestSignal();
  }
  get testSignalKind() {
    return this.testSignal;
  }

  private stopTestSignal() {
    if (this.inputTimer) clearInterval(this.inputTimer);
    this.inputTimer = null;
    for (const s of this.inputSources) {
      try {
        s.stop();
      } catch {
        /* ok */
      }
      s.disconnect();
    }
    this.inputSources = [];
    if (this.liveInput) {
      this.liveInput.source.disconnect();
      for (const t of this.liveInput.stream.getTracks()) t.stop();
      this.liveInput = null;
    }
  }

  /** The computer's audio input, unprocessed (no echo cancelling, noise suppression or automatic gain). */
  private async startLiveInput(bus: GainNode, ctx: AudioContext) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (this.testSignal !== 'input' || this.ctx !== ctx) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      const source = new MediaStreamAudioSourceNode(ctx, { mediaStream: stream });
      source.connect(bus);
      this.liveInput = { stream, source };
    } catch (error) {
      this.events.error?.(
        `The audio input could not be opened (${error instanceof Error ? error.message : String(error)}). Allow the microphone for this page, or pick a test input.`,
      );
    }
  }

  private applyTestSignal() {
    this.stopTestSignal();
    const ctx = this.ctx,
      bus = this.inputBus;
    if (!ctx || !bus || !this.current?.info.audioIn || this.testSignal === 'off') {
      if (bus) bus.gain.value = 0;
      return;
    }
    bus.gain.value = 1;
    if (this.testSignal === 'input') {
      void this.startLiveInput(bus, ctx);
      return;
    }
    if (this.testSignal === 'guitar') {
      if (!this.guitar || this.guitar.sampleRate !== ctx.sampleRate) {
        const [l, r] = testSignalData('guitar', 6, ctx.sampleRate);
        this.guitar = new AudioBuffer({
          numberOfChannels: 2,
          length: l!.length,
          sampleRate: ctx.sampleRate,
        });
        this.guitar.copyToChannel(l as Float32Array<ArrayBuffer>, 0);
        this.guitar.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
      }
      const src = new AudioBufferSourceNode(ctx, { buffer: this.guitar, loop: true });
      src.connect(bus);
      src.start();
      this.track(src);
      return;
    }
    let next = ctx.currentTime + 0.05;
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = seed / 2147483648 - 1;
    }
    const chords = [
      [48, 55, 60, 64],
      [45, 52, 57, 60],
      [41, 48, 53, 57],
      [43, 50, 55, 59],
    ];
    let step = 0;
    const schedule = () => {
      while (next < ctx.currentTime + 1) {
        if (this.testSignal === 'chords') {
          for (const note of chords[Math.floor(step / 4) % chords.length]!) {
            const osc = new OscillatorNode(ctx, {
              type: 'sawtooth',
              frequency: 440 * 2 ** ((note - 69) / 12),
            });
            const env = new GainNode(ctx, { gain: 0 });
            env.gain.setValueAtTime(0, next);
            env.gain.linearRampToValueAtTime(0.06, next + 0.01);
            env.gain.setTargetAtTime(0, next + 0.2, 0.08);
            osc.connect(env).connect(bus);
            osc.start(next);
            osc.stop(next + 0.6);
            this.track(osc);
          }
          next += 0.5;
        } else if (this.testSignal === 'drums') {
          const kick = step % 2 === 0;
          const src = new AudioBufferSourceNode(ctx, { buffer: noise });
          const env = new GainNode(ctx, { gain: 0 });
          const tone = new OscillatorNode(ctx, { type: 'sine', frequency: kick ? 60 : 200 });
          env.gain.setValueAtTime(kick ? 0.5 : 0.25, next);
          env.gain.setTargetAtTime(0, next, kick ? 0.08 : 0.04);
          (kick ? tone : src).connect(env).connect(bus);
          (kick ? tone : src).start(next);
          (kick ? tone : src).stop(next + 0.3);
          this.track(kick ? tone : src);
          next += 0.25;
        } else {
          const src = new AudioBufferSourceNode(ctx, { buffer: noise });
          const env = new GainNode(ctx, { gain: 0 });
          env.gain.setValueAtTime(0.15, next);
          env.gain.setTargetAtTime(0, next + 0.1, 0.05);
          src.connect(env).connect(bus);
          src.start(next);
          src.stop(next + 0.4);
          this.track(src);
          next += 0.5;
        }
        step++;
      }
    };
    schedule();
    this.inputTimer = setInterval(schedule, 250);
  }
  private track(source: AudioScheduledSourceNode) {
    this.inputSources.push(source);
    source.onended = () => {
      const i = this.inputSources.indexOf(source);
      if (i >= 0) this.inputSources.splice(i, 1);
      source.disconnect();
    };
  }

  // ---- Phrases ---------------------------------------------------------------
  playPhrase(
    events: Array<{ q: number; type: 'noteOn' | 'noteOff'; note: number; velocity: number }>,
    quanta: number,
    loop = false,
  ) {
    this.stopPhrase();
    const seconds = (q: number) => ((q * 128) / 48000) * 1000;
    for (const e of events)
      this.phraseTimers.push(
        setTimeout(
          () => (e.type === 'noteOn' ? this.noteOn(e.note, e.velocity) : this.noteOff(e.note)),
          seconds(e.q),
        ),
      );
    if (loop)
      this.phraseTimers.push(
        setTimeout(() => this.playPhrase(events, quanta, true), seconds(quanta)),
      );
  }
  stopPhrase() {
    for (const t of this.phraseTimers) clearTimeout(t);
    this.phraseTimers = [];
    for (const note of Array.from(this.held.keys())) this.noteOff(note);
  }

  async dispose() {
    ++this.loadSerial;
    this.pendingLoad = null;
    this.stopPhrase();
    this.releaseSound();
    this.decoded.clear();
    this.guitar = null;
    const closing = Array.from(this.preparing, ctx => ctx.close().catch(() => {}));
    if (this.ctx) closing.push(this.ctx.close().catch(() => {}));
    this.preparing.clear();
    await Promise.all(closing);
    this.ctx = null;
    this.setState('off', 'Audio is off.');
  }
}
