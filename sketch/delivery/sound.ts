// The delivered sound: a playable build (src/work/playable.ts) read from its folder,
// the controls on its screen, the processor's values for a setting of those controls,
// and steps rendered offline with the build's own AudioWorklet processor. Rendering
// is deterministic: the same build, setting and steps give the same samples, which
// is what lets a setting stand for a sound (a kept setting, a reply to the author).
import { createNode, type CompiledProcessor, type UnworkletNode } from '@unworklet/core';
import { makeWorkletNamespaceFromMeta } from '@unworklet/core/worklet';
import { catalog } from '../../src/sound/blocks/index.ts';
import { currentValues, generate, type Generated } from '../../src/sound/codegen.ts';
import type { Artifact } from '../../src/sound/compile/protocol.ts';
import { applyIntents, type Intent } from '../../src/work/ops.ts';
import { parseDocument } from '../../src/work/persistence.ts';
import {
  PLAYABLE_MANIFEST,
  PROCESSOR_MODULE,
  PROCESSOR_WASM,
  readPlayableManifest,
} from '../../src/work/playable.ts';
import type { PatchDocument } from '../../src/work/schema.ts';

/** A control on the work's screen that a setting can move. */
export interface Control {
  id: string;
  label: string;
  min: number;
  max: number;
  scale: 'linear' | 'log';
  unit: string;
  value: number;
}

/** Values of the screen's controls, by control id: what the recipient keeps and sends. */
export type Setting = Record<string, number>;

export interface Build {
  /** The folder the build was read from (ends with /). */
  base: string;
  doc: PatchDocument;
  generated: Generated;
  artifact: Artifact;
  /** The first 8 hex digits of build.json's SHA-256: changes whenever the sound or its controls do. */
  fingerprint: string;
  controls: Control[];
  /** Blob URLs of the processor's module and wasm, made once per build. */
  urls: { moduleUrl: string; wasmUrl: string };
}

export async function loadBuild(base: string): Promise<Build> {
  const text = await fetchText(new URL(PLAYABLE_MANIFEST, base).href);
  const manifest = readPlayableManifest(JSON.parse(text));
  if ('error' in manifest) throw new Error(manifest.error);
  const read = parseDocument(manifest.document, catalog);
  if (!read.ok) throw new Error(read.error);
  const [moduleSource, wasm] = await Promise.all([
    fetchText(new URL(PROCESSOR_MODULE, base).href),
    fetch(new URL(PROCESSOR_WASM, base)).then(r => {
      if (!r.ok) throw new Error(`${PROCESSOR_WASM} is missing.`);
      return r.arrayBuffer();
    }),
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return {
    base,
    doc: read.doc,
    generated: generate(read.doc, catalog),
    artifact: {
      hash: manifest.processor.hash,
      meta: manifest.processor.meta as Artifact['meta'],
      moduleSource,
      wasm,
      processorName: manifest.processor.processorName,
      sampleRate: manifest.processor.sampleRate,
      compileMs: 0,
    },
    fingerprint: [...new Uint8Array(digest).slice(0, 4)]
      .map(b => b.toString(16).padStart(2, '0'))
      .join(''),
    controls: controlsOf(read.doc),
    urls: {
      moduleUrl: URL.createObjectURL(new Blob([moduleSource], { type: 'text/javascript' })),
      wasmUrl: URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' })),
    },
  };
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} is missing.`);
  return response.text();
}

/** The knobs and sliders on the screen, with their ranges and the author's values. */
export function controlsOf(doc: PatchDocument): Control[] {
  return Object.values(doc.nodes)
    .filter(n => (n.type === 'ui.knob' || n.type === 'ui.slider') && n.panel)
    .sort((a, b) => a.panel!.y - b.panel!.y || a.panel!.x - b.panel!.x)
    .map(n => ({
      id: n.id,
      label: n.label ?? n.id,
      min: Number(n.config.min ?? 0),
      max: Number(n.config.max ?? 1),
      scale: n.config.scale === 'log' ? 'log' : 'linear',
      unit: String(n.config.unit ?? ''),
      value: Number(n.values.value ?? n.config.min ?? 0),
    }));
}

/** The author's setting: every control where the work has it. */
export const authorSetting = (build: Build): Setting =>
  Object.fromEntries(build.controls.map(c => [c.id, c.value]));

/** The work's document with the controls moved to a setting (unknown controls are left out). */
export function withSetting(build: Build, setting: Setting): PatchDocument {
  const intents: Intent[] = build.controls
    .filter(c => Number.isFinite(setting[c.id]))
    .map(c => ({
      op: 'setValue',
      node: c.id,
      port: 'value',
      value: Math.min(c.max, Math.max(c.min, setting[c.id]!)),
    }));
  return applyIntents(build.doc, intents, catalog).doc;
}

/** The processor's values for a setting. */
export const paramsFor = (build: Build, setting: Setting): Record<string, number> =>
  currentValues(withSetting(build, setting), catalog, build.generated);

/** A note played in a render: when, which, how hard, how long it is held. */
export interface Step {
  at: number;
  note: number;
  velocity: number;
  hold: number;
}

export const SAMPLE_RATE = 48000;
/** Notes start on a render quantum, so an offset in quanta is exact. */
export const QUANTUM = 128;

/**
 * Render steps offline: `seconds` of sound after `preroll` quanta of silence that are
 * cut off (they move the noise and other free-running parts to another point).
 */
export async function renderSteps(
  build: Build,
  setting: Setting,
  steps: readonly Step[],
  seconds: number,
  preroll = 0,
): Promise<AudioBuffer> {
  const offset = (preroll * QUANTUM) / SAMPLE_RATE;
  const frames = preroll * QUANTUM + Math.ceil(seconds * SAMPLE_RATE);
  const ctx = new OfflineAudioContext(2, frames, SAMPLE_RATE);
  const processor = {
    worklet: {
      ...makeWorkletNamespaceFromMeta(build.artifact.meta),
      moduleUrl: build.urls.moduleUrl,
      wasmUrl: build.urls.wasmUrl,
      processorName: build.artifact.processorName,
      displayName: 'delivered sound',
      bakedSampleRate: build.artifact.sampleRate,
    },
  } as unknown as CompiledProcessor<unknown>;
  const node = (await createNode(ctx as unknown as AudioContext, processor, {
    initial: paramsFor(build, setting),
  })) as UnworkletNode<unknown>;
  if (!node.outputs.main) throw new Error('The sound has no main output.');
  node.outputs.main.connect(ctx.destination);
  const midi = node.midi.midi;
  const events = steps.flatMap(s => [
    {
      at: offset + s.at,
      send: () =>
        midi?.send({ type: 'noteOn', channel: 0, note: s.note, velocity: s.velocity } as never),
    },
    {
      at: offset + s.at + s.hold,
      send: () => midi?.send({ type: 'noteOff', channel: 0, note: s.note, velocity: 0 } as never),
    },
  ]);
  // One suspension per render quantum: events in the same quantum go together.
  const byQuantum = new Map<number, Array<() => void>>();
  for (const e of events) {
    // Not at frame 0: rendering has to start before it can be suspended.
    const q = Math.max(1, Math.round((e.at * SAMPLE_RATE) / QUANTUM));
    if (q * QUANTUM >= frames) continue;
    byQuantum.set(q, [...(byQuantum.get(q) ?? []), e.send]);
  }
  for (const [q, sends] of byQuantum)
    void ctx.suspend((q * QUANTUM) / SAMPLE_RATE).then(() => {
      for (const send of sends) send();
      void ctx.resume();
    });
  const rendered = await ctx.startRendering();
  node.dispose();
  if (!preroll) return rendered;
  const start = preroll * QUANTUM;
  const out = new AudioBuffer({
    numberOfChannels: rendered.numberOfChannels,
    length: rendered.length - start,
    sampleRate: SAMPLE_RATE,
  });
  for (let c = 0; c < rendered.numberOfChannels; c++)
    out.copyToChannel(rendered.getChannelData(c).subarray(start), c);
  return out;
}
