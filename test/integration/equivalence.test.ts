// References, not audio goldens: the starters built from modules must reproduce
// den's own engines sample for sample.
import { describe, expect, it, beforeAll } from 'vite-plus/test';
import { renderOffline } from '@unworklet/offline';
import {
  audioInput,
  audioOutput,
  bool,
  defineProcessor,
  f32,
  forSample,
  instantiate,
  type CompiledProcessor,
} from '@unworklet/core';
import {
  createInstrument,
  bassConfig,
  bassParameters,
  percussionConfig,
  percussionParameters,
  padConfig,
  padParameters,
} from '@denaudio/den/instrument';
import { delayFx } from '@denaudio/den/delay-fx';
import { chorusSettings, rhythmicDelaySettings } from '@denaudio/den/delay-settings';
import { catalog } from '../../src/sound/blocks/index.ts';
import { generate } from '../../src/sound/codegen.ts';
import { starter } from '../../src/work/starters.ts';
import { PHRASES, phraseEvents } from '../../src/sound/phrases.ts';
import { evaluate } from '../../src/sound/compile/evaluate.ts';
import { loadRegistry } from '../helpers/registry.ts';

let registry: Record<string, unknown>;
beforeAll(async () => {
  registry = await loadRegistry();
});

const params = (values: Record<string, number>) =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, [v]]));

function compare(a: Float32Array, b: Float32Array) {
  expect(a.length).toBe(b.length);
  let max = 0,
    first = -1;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i]! - b[i]!);
    if (d > max) max = d;
    if (d > 0 && first < 0) first = i;
  }
  return { max, first };
}

const cases = [
  {
    id: 'bass',
    config: bassConfig,
    parameters: bassParameters,
    phrase: PHRASES.bass,
    quanta: 1200,
  },
  {
    id: 'percussion',
    config: percussionConfig,
    parameters: percussionParameters,
    phrase: PHRASES.percussion,
    quanta: 1400,
  },
  { id: 'pad', config: padConfig, parameters: padParameters, phrase: PHRASES.pad, quanta: 1200 },
] as const;

describe('starter instruments reproduce den createInstrument', () => {
  for (const c of cases) {
    it(`${c.id}: sample-identical to createInstrument`, async () => {
      const generated = generate(starter(c.id, catalog), catalog);
      expect(generated.issues.filter(i => i.severity === 'error')).toEqual([]);
      const { processor } = evaluate(generated.source, registry);
      const duration = (c.quanta * 128) / 48000;
      const events = phraseEvents(c.phrase, c.quanta);
      const kit = await renderOffline(processor, {
        sampleRate: 48000,
        duration,
        events,
        params: params(generated.values),
      });
      const den = await renderOffline(createInstrument(c.config), {
        sampleRate: 48000,
        duration,
        events,
        params: params(c.parameters),
      });
      const k = kit.outputs.main!,
        d = den.outputs.main!;
      let peak = 0;
      for (const s of d[0]!) peak = Math.max(peak, Math.abs(s));
      expect(peak).toBeGreaterThan(0.001);
      for (const ch of [0, 1]) {
        const { max, first } = compare(k[ch]!, d[ch]!);
        expect({ channel: ch, max, first }).toEqual({ channel: ch, max: 0, first: -1 });
      }
      expect(kit.diagnostics.scrubbedSamples).toBe(0);
    });
  }
});

describe('starter delays reproduce a direct delayFx processor', () => {
  for (const [id, settings] of [
    ['chorus', chorusSettings],
    ['rhythmic', rhythmicDelaySettings],
  ] as const) {
    it(`${id}: sample-identical`, async () => {
      const generated = generate(starter(id, catalog), catalog);
      const { processor } = evaluate(generated.source, registry);
      const s = settings.parameters;
      const reference = defineProcessor(({ sampleRate }) => {
        const input = audioInput({ name: 'main', channels: 2 });
        const output = audioOutput({ name: 'main', channels: 2 });
        const fx = instantiate(delayFx, { sampleRate, ...settings.config }, { name: 'fx' });
        return {
          process() {
            forSample(i => {
              const wet = fx.tick(input.ch(0).at(i), input.ch(1).at(i), {
                timeLeftSeconds: f32(s.timeLeftSeconds),
                timeRightSeconds: f32(s.timeRightSeconds),
                sync: bool(s.sync),
                bpm: f32(s.bpm),
                beatsLeft: f32(s.beatsLeft),
                beatsRight: f32(s.beatsRight),
                feedback: f32(s.feedback),
                cutoffHz: f32(s.cutoffHz),
                mix: f32(s.mix),
                rateHz: f32(s.rateHz),
                depthSeconds: f32(s.depthSeconds),
                bypass: bool(s.bypass),
                reset: bool(false),
              });
              output.ch(0).at(i).write(wet.left);
              output.ch(1).at(i).write(wet.right);
            });
          },
        };
      }) as CompiledProcessor<unknown>;
      const frames = 48000;
      const left = new Float32Array(frames),
        right = new Float32Array(frames);
      let seed = 1234567;
      for (let i = 0; i < frames; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        left[i] = (seed / 2 ** 32 - 0.5) * (i < 24000 ? 0.5 : 0);
        right[i] = Math.sin(i * 0.02) * 0.3;
      }
      const inputs = { main: [left, right] };
      const kit = await renderOffline(processor, {
        sampleRate: 48000,
        duration: 1,
        inputs,
        params: params(generated.values),
      });
      const ref = await renderOffline(reference, { sampleRate: 48000, duration: 1, inputs });
      for (const ch of [0, 1])
        expect({ ch, ...compare(kit.outputs.main![ch]!, ref.outputs.main![ch]!) }).toEqual({
          ch,
          max: 0,
          first: -1,
        });
    });
  }
});
