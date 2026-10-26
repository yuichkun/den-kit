// What the player reads first (build.json): a playable build is checked before it plays.
import { describe, expect, it } from 'vite-plus/test';
import { PLAYABLE_FORMAT, readPlayableManifest } from '../../../src/work/playable.ts';
import { emptyDocument } from '../../../src/work/schema.ts';

const processor = { hash: 'h', meta: {}, processorName: 'p', sampleRate: 48000 };

describe('a playable build’s manifest', () => {
  it('is read when it is one, and refused with a reason otherwise', () => {
    const document = emptyDocument('A');
    expect(
      readPlayableManifest({
        format: PLAYABLE_FORMAT,
        version: 1,
        document,
        processor,
        parts: true,
      }),
    ).toMatchObject({ document, processor, parts: true });
    expect(readPlayableManifest({ format: 'something else' })).toEqual({
      error: 'This is not a den-kit playable build.',
    });
    expect(
      readPlayableManifest({ format: PLAYABLE_FORMAT, version: 2, document, processor }),
    ).toEqual({
      error: 'This playable build is version 2; this player plays 1.',
    });
    expect(readPlayableManifest({ format: PLAYABLE_FORMAT, version: 1, document })).toMatchObject({
      error: expect.stringMatching(/compiled sound/),
    });
    expect(readPlayableManifest(null)).toMatchObject({ error: expect.any(String) });
  });
});
