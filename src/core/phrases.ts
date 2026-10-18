// Audition phrases (den's sound-candidate fixtures, tests/sound-candidates-consumer/fixtures.mjs),
// in render quanta (128 samples at 48 kHz). Used by the engine's play buttons,
// the listening tool and the equivalence tests.
export interface PhraseEvent {
  q: number;
  type: 'noteOn' | 'noteOff';
  note: number;
  velocity: number;
}
export interface Phrase {
  id: string;
  title: string;
  quanta: number;
  events: PhraseEvent[];
}

const on = (q: number, note: number, velocity = 100): PhraseEvent => ({
  q,
  type: 'noteOn',
  note,
  velocity,
});
const off = (q: number, note: number): PhraseEvent => ({ q, type: 'noteOff', note, velocity: 0 });

export const PHRASES: Record<'bass' | 'percussion' | 'pad', Phrase> = {
  bass: {
    id: 'bass',
    title: 'Bass line',
    quanta: 2048,
    events: [
      on(0, 36),
      on(128, 43),
      off(192, 43),
      off(256, 36),
      on(384, 36, 64),
      off(448, 36),
      on(512, 36, 127),
      off(576, 36),
      on(704, 60),
      off(896, 60),
      on(960, 72),
      off(1152, 72),
    ],
  },
  percussion: {
    id: 'percussion',
    title: 'Hits',
    quanta: 2048,
    events: [
      ...(
        [
          [0, 64],
          [192, 100],
          [384, 127],
        ] as const
      ).flatMap(([q, v]) => [on(q, 36, v), off(q + 96, 36)]),
      on(640, 36),
      off(664, 36),
      on(668, 36),
      off(764, 36),
      ...Array.from({ length: 8 }, (_, k) => {
        const q = 896 + 24 * k;
        return [on(q, 36), off(q + 12, 36)];
      }).flat(),
      on(1280, 48),
      off(1376, 48),
    ],
  },
  pad: {
    id: 'pad',
    title: 'Chord',
    quanta: 6000,
    events: [
      ...[48, 55, 60, 64].map(n => on(0, n, 80)),
      off(3000, 48),
      off(3375, 55),
      off(3750, 60),
      off(4125, 64),
    ],
  },
};

export type PhraseId = keyof typeof PHRASES;

/** Offline-render MIDI events at 48 kHz. */
export function phraseEvents(phrase: Phrase, maxQuanta = phrase.quanta) {
  return phrase.events
    .filter(e => e.q < maxQuanta)
    .map(e => ({
      name: 'midi',
      atSample: e.q * 128,
      payload: { type: e.type, note: e.note, velocity: e.velocity, channel: 0 },
    }));
}
