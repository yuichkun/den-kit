// A generated instrument keeps its pitch and MIDI boundary timing across
// device rates and render quanta, including den blocks and a codebox together.
import { beforeAll, describe, expect, it } from 'vite-plus/test';
import { renderOffline, type RenderOfflineResult } from '@unworklet/offline';
import { catalog } from '../../src/sound/blocks/index.ts';
import { generate } from '../../src/sound/codegen.ts';
import { evaluate } from '../../src/sound/compile/evaluate.ts';
import { applyIntents, type Intent } from '../../src/work/ops.ts';
import { emptyDocument } from '../../src/work/schema.ts';
import { loadRegistry } from '../helpers/registry.ts';

const wire = (from: string, to: string): Intent => ({
  op: 'connect',
  from: { node: from.split('.')[0]!, port: from.split('.')[1]! },
  to: { node: to.split('.')[0]!, port: to.split('.')[1]! },
});

const code = `import { defineSubgraph, f32, select, state, type Node } from '@unworklet/core';
export default defineSubgraph((config: { sampleRate: number }) => {
  const last = state.f32(0).named('last');
  const coefficient = 1 - Math.exp(-2 * Math.PI * 1000 / config.sampleRate);
  return {
    tick(i: { in: Node<'f32'>; gate: Node<'bool'> }) {
      const smoothed = last.read().add(i.in.sub(last.read()).mul(coefficient));
      last.write(smoothed);
      return {
        out: select(i.gate, smoothed.mul(0.25), f32(0)),
        marker: select(i.gate, f32(0.25), f32(0)),
      };
    },
  };
});`;

const doc = applyIntents(
  emptyDocument('Target test'),
  [
    {
      op: 'addNode',
      node: {
        id: 'voice1',
        type: 'kit.voiceIn',
        config: { mode: 'mono', capacity: 1, heldCapacity: 4 },
      },
    },
    {
      op: 'addNode',
      node: { id: 'osc1', type: 'den.oscillator', config: { waveform: 'sine' } },
    },
    {
      op: 'addNode',
      node: { id: 'filter1', type: 'den.filter', values: { cutoff: 3000, resonance: 0.707 } },
    },
    {
      op: 'addNode',
      node: {
        id: 'box1',
        type: 'kit.codebox',
        code,
        ports: {
          inputs: [
            { id: 'in', type: 'signal' },
            { id: 'gate', type: 'gate' },
          ],
          outputs: [
            { id: 'out', type: 'signal' },
            { id: 'marker', type: 'signal' },
          ],
        },
      },
    },
    { op: 'addNode', node: { id: 'mix1', type: 'kit.voiceMix' } },
    { op: 'addNode', node: { id: 'marker1', type: 'kit.voiceMix' } },
    { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
    wire('voice1.pitch', 'osc1.frequency'),
    wire('osc1.out', 'filter1.input'),
    wire('filter1.out', 'box1.in'),
    wire('voice1.gate', 'box1.gate'),
    wire('box1.out', 'mix1.in'),
    wire('box1.marker', 'marker1.in'),
    wire('mix1.out', 'out1.left'),
    wire('marker1.out', 'out1.right'),
  ],
  catalog,
).doc;

const generated = generate(doc, catalog);
const duration = 0.25;
// Generated MIDI handlers run before the sample loop. Schedule at boundaries
// shared by every tested quantum to isolate compile-target behavior.
const noteOn = 256;
const noteOff = (sampleRate: number) => Math.floor((sampleRate * 0.16) / 256) * 256;
let registry: Record<string, unknown>;
beforeAll(async () => {
  expect(generated.issues.filter(issue => issue.severity === 'error')).toEqual([]);
  registry = await loadRegistry();
});

function render(sampleRate: number, renderQuantumSize: number) {
  return renderOffline(evaluate(generated.source, registry).processor, {
    sampleRate,
    renderQuantumSize,
    duration,
    params: Object.fromEntries(
      Object.entries(generated.values).map(([name, value]) => [name, [value]]),
    ),
    events: [
      {
        name: 'midi',
        atSample: noteOn,
        payload: { type: 'noteOn', note: 69, velocity: 100, channel: 0 },
      },
      {
        name: 'midi',
        atSample: noteOff(sampleRate),
        payload: { type: 'noteOff', note: 69, velocity: 0, channel: 0 },
      },
    ],
  });
}

for (const sampleRate of [44100, 48000, 96000]) {
  describe(`${sampleRate} Hz generated instrument`, () => {
    let reference: RenderOfflineResult;
    beforeAll(async () => {
      reference = await render(sampleRate, 128);
    });

    for (const renderQuantumSize of [32, 128, 256]) {
      it(`quantum ${renderQuantumSize}: pitch, duration and MIDI timing`, async () => {
        const result =
          renderQuantumSize === 128 ? reference : await render(sampleRate, renderQuantumSize);
        const [audio, marker] = result.outputs.main!;
        expect(result.sampleRate).toBe(sampleRate);
        expect(audio!.length).toBe(
          Math.ceil((duration * sampleRate) / renderQuantumSize) * renderQuantumSize,
        );
        expect(result.diagnostics.scrubbedSamples).toBe(0);

        // The right channel exposes the generated voice gate without an envelope
        // or filter hiding an extra render quantum of event latency.
        let firstWrongMarker = -1;
        for (let i = 0; i < marker!.length; i++) {
          const expected = i >= noteOn && i < noteOff(sampleRate) ? 0.25 : 0;
          if (marker![i] !== expected) {
            firstWrongMarker = i;
            break;
          }
        }
        expect(firstWrongMarker).toBe(-1);

        // Interpolate the settled sine's positive zero crossings. This detects a
        // compiler using 48 kHz while the result claims another sample rate.
        const crossings: number[] = [];
        let peak = 0;
        for (let i = noteOn + Math.ceil(sampleRate * 0.03); i < noteOff(sampleRate); i++) {
          const previous = audio![i - 1]!;
          const current = audio![i]!;
          expect(Number.isFinite(current)).toBe(true);
          peak = Math.max(peak, Math.abs(current));
          if (previous <= 0 && current > 0) crossings.push(i - 1 - previous / (current - previous));
        }
        expect(peak).toBeGreaterThan(0.05);
        expect(crossings.length).toBeGreaterThan(20);
        const frequency =
          ((crossings.length - 1) * sampleRate) / (crossings.at(-1)! - crossings[0]!);
        expect(Math.abs(frequency - 440)).toBeLessThan(0.1);

        // Quantum boundaries cannot change the music. Render lengths may have
        // different padding, so compare the requested duration only.
        const frames = Math.floor(duration * sampleRate);
        for (const channel of [0, 1]) {
          const actual = result.outputs.main![channel]!;
          const expected = reference.outputs.main![channel]!;
          let maxDifference = 0;
          for (let i = 0; i < frames; i++)
            maxDifference = Math.max(maxDifference, Math.abs(actual[i]! - expected[i]!));
          expect(maxDifference).toBe(0);
        }
      });
    }
  });
}
