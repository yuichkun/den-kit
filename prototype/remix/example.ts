// An example passage to look at without passing a work on first: Acid Line,
// shared by its author and passed on by three people, each going one level
// deeper (settings, then a phrase, then a change inside). Every change is made by
// den-kit's own operations, as the page and the editor make them. The names are
// made up.
import type { Catalog } from '../../src/work/catalog.ts';
import { applyIntents, type Intent } from '../../src/work/ops.ts';
import type { PatchDocument } from '../../src/work/schema.ts';
import { findWork } from '../../src/screen/showcase/index.ts';
import { PASSAGE_VERSION, type Passage, type Phrase } from './passage.ts';

const HOUR = 3_600_000;

/** A riff of sixteenth notes at 125 BPM: each note held for most of its step. */
function riff(notes: Array<number | null>, step = 120): Phrase {
  const phrase: Phrase = [];
  notes.forEach((note, i) => {
    if (note === null) return;
    const at = i * step;
    phrase.push([at, note, i % 4 === 0 ? 118 : 96], [at + step - 20, note, 0]);
  });
  return phrase;
}

function change(doc: PatchDocument, intents: Intent[], catalog: Catalog) {
  return applyIntents(doc, intents, catalog);
}

export function examplePassage(catalog: Catalog, now = Date.now()): Passage {
  const v0 = findWork('acid')!.build(catalog);
  const mika = change(
    v0,
    [
      { op: 'setValue', node: 'kcut', port: 'value', value: 820 },
      { op: 'setValue', node: 'kres', port: 'value', value: 0.86 },
    ],
    catalog,
  );
  const juniper = change(
    mika.doc,
    [
      { op: 'setValue', node: 'kdec', port: 'value', value: 0.42 },
      { op: 'setValue', node: 'kglide', port: 'value', value: 0.12 },
    ],
    catalog,
  );
  const gain = juniper.doc.nodes.gain1!,
    out = juniper.doc.nodes.out1!;
  const pico = change(
    juniper.doc,
    [
      {
        op: 'addNode',
        node: {
          id: 'echo1',
          type: 'den.pingPongDelay',
          label: 'Echo',
          pos: { x: Math.round((gain.pos.x + out.pos.x) / 2), y: out.pos.y + 140 },
          values: { timeSeconds: 0.36, feedback: 0.45, mix: 0.28 },
        },
      },
      { op: 'connect', from: { node: 'gain1', port: 'out' }, to: { node: 'echo1', port: 'left' } },
      { op: 'connect', from: { node: 'gain1', port: 'out' }, to: { node: 'echo1', port: 'right' } },
      {
        op: 'connect',
        from: { node: 'echo1', port: 'left' },
        to: { node: 'out1', port: 'left' },
        replace: true,
      },
      {
        op: 'connect',
        from: { node: 'echo1', port: 'right' },
        to: { node: 'out1', port: 'right' },
      },
    ],
    catalog,
  );
  return {
    v: PASSAGE_VERSION,
    id: 'example-acid',
    work: 'acid',
    author: {
      name: 'Owl',
      words: 'A squelchy line for late nights. Make it yours.',
      at: now - 72 * HOUR,
      allowInside: true,
    },
    hops: [
      {
        by: 'Mika',
        words: 'Thanks Owl! I opened the filter up for the daytime.',
        at: now - 50 * HOUR,
        ops: mika.ops,
      },
      {
        by: 'Juniper',
        words:
          "Owl's line with Mika's filter. A longer decay, a little glide, and the riff I kept humming.",
        at: now - 26 * HOUR,
        ops: juniper.ops,
        phrase: riff([36, null, 48, 36, 39, null, 36, 43, 46, null, 48, 36, 51, 48, null, 43]),
      },
      {
        by: 'Pico',
        words: 'Added a ping-pong echo inside. Thank you Owl, Mika and Juniper.',
        at: now - 3 * HOUR,
        ops: pico.ops,
      },
    ],
  };
}
