// What the player reads first (build.json): a playable build is checked before it plays.
import { describe, expect, it } from 'vite-plus/test';
import {
  PLAYABLE_FORMAT,
  PLAYABLE_VERSION,
  readPlayableManifest,
} from '../../../src/work/playable.ts';
import { emptyDocument } from '../../../src/work/schema.ts';

const processor = {
  hash: 'h',
  meta: {},
  processorName: 'p',
  sampleRate: 48000,
  renderQuantumSize: 128,
  schemaHash: 'schema',
};

describe('a playable build’s manifest', () => {
  it('is read when it is one, and refused with a reason otherwise', () => {
    const document = emptyDocument('A');
    expect(
      readPlayableManifest({
        format: PLAYABLE_FORMAT,
        version: PLAYABLE_VERSION,
        document,
        processor,
        parts: true,
      }),
    ).toMatchObject({ document, processor, parts: true });
    expect(readPlayableManifest({ format: 'something else' })).toEqual({
      error: 'This is not a den-kit playable build.',
    });
    expect(
      readPlayableManifest({ format: PLAYABLE_FORMAT, version: 1, document, processor }),
    ).toEqual({
      error: 'This playable build is version 1; this player plays 2.',
    });
    expect(
      readPlayableManifest({ format: PLAYABLE_FORMAT, version: PLAYABLE_VERSION, document }),
    ).toMatchObject({
      error: expect.stringMatching(/compiled sound/),
    });
    expect(readPlayableManifest(null)).toMatchObject({ error: expect.any(String) });
  });
  it('requires the compiled target and schema identity', () => {
    for (const patch of [
      { sampleRate: 0 },
      { sampleRate: NaN },
      { sampleRate: Infinity },
      { renderQuantumSize: undefined },
      { renderQuantumSize: 0 },
      { renderQuantumSize: 1.5 },
      { schemaHash: '' },
      { schemaHash: undefined },
    ]) {
      expect(
        readPlayableManifest({
          format: PLAYABLE_FORMAT,
          version: PLAYABLE_VERSION,
          document: emptyDocument('A'),
          processor: { ...processor, ...patch },
        }),
      ).toMatchObject({ error: expect.stringMatching(/compiled sound/) });
    }
  });
});
