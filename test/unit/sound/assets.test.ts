// Audio assets in the sound, without audio: a codebox names the assets it reads
// by their paths written out, a sampler's sound must be an audio asset of the
// work and follows it when it is renamed, and the samples a slot gets are mixed,
// picked and cut as the slot says.
import { describe, expect, it } from 'vite-plus/test';
import { catalog } from '../../../src/sound/blocks/index.ts';
import { ASSET_FRAMES, slotSamples } from '../../../src/sound/assets.ts';
import { inlineCodebox } from '../../../src/sound/codebox.ts';
import { sha256 } from '../../../src/work/files.ts';
import { OpError } from '../../../src/work/op-error.ts';
import { applyIntents, type Intent } from '../../../src/work/ops.ts';
import type { PatchDocument } from '../../../src/work/schema.ts';
import { emptyDocument } from '../../../src/work/schema.ts';
import { validate } from '../../../src/work/validate.ts';

describe('a codebox reads assets through @den-kit/assets', () => {
  it('takes the asset API from the processor and names the assets it reads', () => {
    const code = [
      "import { defineSubgraph } from '@unworklet/core';",
      "import { audio, bytes as raw, type AssetAudio } from '@den-kit/assets';",
      'export default defineSubgraph(() => {',
      '  const kick = audio(\'assets/kick.wav\'), snare = audio("assets/snare.wav");',
      "  const table = raw( 'assets/table.bin' );",
      '  return { tick: () => ({ out: kick.read(0, table.length()) }) };',
      '});',
    ].join('\n');
    const r = inlineCodebox('box1', code);
    expect(r.issues).toEqual([]);
    expect(r.lines[0]).toBe(
      'const { defineSubgraph } = core; const { audio, bytes: raw } = assets;',
    );
    expect(r.assets).toEqual({
      audio: ['assets/kick.wav', 'assets/snare.wav'],
      bytes: ['assets/table.bin'],
    });
  });

  it('refuses a path that is not written out, and names the API has not', () => {
    const r = inlineCodebox(
      'box1',
      [
        "import { audio } from '@den-kit/assets';",
        "const name = 'assets/kick.wav';",
        'export default audio(name);',
      ].join('\n'),
    );
    expect(r.issues).toEqual([
      expect.objectContaining({
        code: 'codebox-asset',
        line: 3,
        message: expect.stringMatching(/written out/),
      }),
    ]);
    expect(
      inlineCodebox('box1', "import { video } from '@den-kit/assets';\nexport default 1;")
        .issues[0],
    ).toMatchObject({ code: 'codebox-import', message: expect.stringMatching(/audio and bytes/) });
    expect(
      inlineCodebox('box1', "import { x } from 'lodash';\nexport default 1;").issues[0]!.message,
    ).toMatch(/@unworklet\/core and @den-kit\/assets/);
  });
});

/** applyIntents, with a refusal as a value. */
function attempt(doc: PatchDocument, intents: Intent[]) {
  try {
    return { ok: true as const, doc: applyIntents(doc, intents, catalog).doc };
  } catch (error) {
    if (error instanceof OpError) return { ok: false as const, error };
    throw error;
  }
}

describe("a sampler's sound", () => {
  async function work(extra: Intent[] = []) {
    const add = async (id: string, mime: string): Promise<Intent> => {
      const bytes = new TextEncoder().encode(id);
      return {
        op: 'addAsset',
        asset: { id, name: id.slice(7), mime, bytes: bytes.length, hash: await sha256(bytes) },
      };
    };
    return applyIntents(
      emptyDocument('t', 't'),
      [
        await add('assets/kick.wav', 'audio/wav'),
        await add('assets/logo.png', 'image/png'),
        { op: 'addNode', node: { id: 'sampler1', type: 'den.samplePlayer' } },
        ...extra,
      ],
      catalog,
    );
  }
  const set = (value: unknown): Intent =>
    ({ op: 'setConfig', node: 'sampler1', key: 'sound', value }) as Intent;

  it('is an audio asset of the work, or nothing', async () => {
    const { doc } = await work();
    expect(
      applyIntents(doc, [set('assets/kick.wav')], catalog).doc.nodes.sampler1!.config.sound,
    ).toBe('assets/kick.wav');
    expect(attempt(doc, [set('')]).ok).toBe(true);
    for (const [value, reason] of [
      ['assets/none.wav', /No asset/],
      ['assets/logo.png', /takes an audio file/],
      ['kick.wav', /path of an asset/],
      [3, /path of an asset/],
    ] as const) {
      const r = attempt(doc, [set(value)]);
      expect(r.ok, String(value)).toBe(false);
      if (!r.ok) expect(r.error.message).toMatch(reason);
    }
  });

  it('follows the asset when it is renamed, and keeps it from being removed', async () => {
    const { doc } = await work([set('assets/kick.wav')]);
    const renamed = applyIntents(
      doc,
      [{ op: 'updateAsset', id: 'assets/kick.wav', set: { name: 'boom.wav' } }],
      catalog,
    );
    expect(renamed.doc.nodes.sampler1!.config.sound).toBe('assets/boom.wav');
    const removed = attempt(doc, [{ op: 'removeAsset', id: 'assets/kick.wav' }]);
    expect(removed.ok).toBe(false);
    if (!removed.ok) expect(removed.error.message).toMatch(/sampler1's sound/);
  });

  it('pointing at a file that is gone is a warning: it plays nothing', async () => {
    const { doc } = await work([set('assets/kick.wav')]);
    const gone = { ...doc, files: { ...doc.files } };
    delete gone.files['assets/kick.wav'];
    expect(validate(gone, catalog).issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'missing-asset', node: 'sampler1' }),
    );
  });
});

describe('the samples a slot gets', () => {
  const decoded = (...channels: number[][]) => ({
    numberOfChannels: channels.length,
    length: channels[0]!.length,
    getChannelData: (c: number) => Float32Array.from(channels[c]!),
  });
  it('mono mixes the channels; left and right pick one; a mono file gives both the same', () => {
    const stereo = decoded([1, 0.5], [0, -0.5]);
    expect([...slotSamples(stereo, 'mono')]).toEqual([0.5, 0]);
    expect([...slotSamples(stereo, 'right')]).toEqual([0, -0.5]);
    const mono = decoded([0.25, 0.75]);
    expect([...slotSamples(mono, 'right')]).toEqual([...slotSamples(mono, 'left')]);
  });
  it('cuts to what a resident holds and turns broken samples into silence', () => {
    const long = decoded(
      Array.from({ length: ASSET_FRAMES + 10 }, (_, i) => (i === 3 ? NaN : 0.1)),
    );
    const out = slotSamples(long, 'mono');
    expect(out.length).toBe(ASSET_FRAMES);
    expect(out[3]).toBe(0);
    expect(out[4]).toBeCloseTo(0.1, 6);
  });
});
