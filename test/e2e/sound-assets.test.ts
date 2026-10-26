// Audio assets and the safety stage in a real browser, measured from the output
// (nothing has to be heard): a sampler plays an audio asset of the work, a
// codebox plays one through @den-kit/assets, pointing a sampler at another sound
// does not recompile, and broken audio (NaN) is muted before the speakers.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { openKit, outputPeak, startHarness, waitCompiled, type Harness } from './harness.ts';

type K = { __kit: any };
let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h?.close();
});

const kit = (page: Page, fn: (k: any) => unknown): Promise<any> =>
  page.evaluate(`(${fn.toString()})(window.__kit)`);
async function ready() {
  const { page } = await openKit(h, {});
  await waitCompiled(page);
  await page.waitForFunction(() => (window as unknown as K).__kit.engine.hasNode, null, {
    timeout: 60000,
  });
  return page;
}
async function settle(page: Page) {
  await page.waitForFunction(
    () => {
      const k = (window as unknown as K).__kit;
      return k.compileStatus.value !== 'waiting' && k.compileStatus.value !== 'compiling';
    },
    null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(300);
}
/** Adds a mono 16-bit WAV of a sine (or silence) as an asset; returns its path. */
async function addWav(page: Page, name: string, amplitude: number): Promise<string> {
  return page.evaluate(
    async ({ name, amplitude }) => {
      const rate = 48000,
        frames = 24000;
      const view = new DataView(new ArrayBuffer(44 + frames * 2));
      const text = (at: number, s: string) =>
        [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
      text(0, 'RIFF');
      view.setUint32(4, 36 + frames * 2, true);
      text(8, 'WAVE');
      text(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, rate, true);
      view.setUint32(28, rate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      text(36, 'data');
      view.setUint32(40, frames * 2, true);
      for (let i = 0; i < frames; i++)
        view.setInt16(
          44 + i * 2,
          Math.round(32767 * amplitude * Math.sin((2 * Math.PI * 220 * i) / rate)),
          true,
        );
      const k = (window as unknown as K).__kit;
      const meta = await k.addAssetFile(new File([view.buffer], name, { type: 'audio/wav' }));
      return meta.id as string;
    },
    { name, amplitude },
  );
}

describe('audio assets in the sound', () => {
  it('a sampler plays its sound; pointing it at another sound sends new samples without recompiling', async () => {
    const page = await ready();
    const tone = await addWav(page, 'tone.wav', 0.5);
    const quiet = await addWav(page, 'quiet.wav', 0);
    assert.equal(
      await kit(
        page,
        k =>
          k.commit([
            {
              op: 'addNode',
              node: {
                id: 'sampler1',
                type: 'den.samplePlayer',
                config: { sound: 'assets/tone.wav', loop: true },
              },
            },
            {
              op: 'connect',
              from: { node: 'sampler1', port: 'out' },
              to: { node: 'out1', port: 'left' },
              replace: true,
            },
          ]).ok,
      ),
      true,
    );
    assert.equal(tone, 'assets/tone.wav');
    await settle(page);
    assert.ok((await outputPeak(page, 200)) < 0.001, 'silent until its gate is on');
    await kit(page, k =>
      k.commit([{ op: 'setValue', node: 'sampler1', port: 'gate', value: true }]),
    );
    await page.waitForTimeout(200);
    const playing = await outputPeak(page, 300);
    assert.ok(playing > 0.1, `the sampler plays its sound (peak ${playing})`);
    // Another sound: no new program, new samples (a held gate does not restart it, so it falls silent).
    const before = await kit(page, k => ({
      hash: k.engine.currentHash,
      created: k.engine.stats.created,
    }));
    await kit(page, k =>
      k.commit([{ op: 'setConfig', node: 'sampler1', key: 'sound', value: 'assets/quiet.wav' }]),
    );
    await settle(page);
    assert.deepEqual(
      await kit(page, k => ({ hash: k.engine.currentHash, created: k.engine.stats.created })),
      before,
    );
    assert.ok((await outputPeak(page, 300)) < 0.001, `now ${quiet} plays`);
    // Back to the tone, and the gate pressed again: it plays again, still without recompiling.
    await kit(page, k =>
      k.commit([
        { op: 'setConfig', node: 'sampler1', key: 'sound', value: 'assets/tone.wav' },
        { op: 'setValue', node: 'sampler1', port: 'gate', value: false },
      ]),
    );
    await settle(page);
    await kit(page, k =>
      k.commit([{ op: 'setValue', node: 'sampler1', port: 'gate', value: true }]),
    );
    await page.waitForTimeout(200);
    assert.ok((await outputPeak(page, 300)) > 0.1, 'the tone again');
    assert.equal(await kit(page, k => k.engine.stats.created), before.created);
    await page.close();
  });

  it('a codebox plays an audio asset through @den-kit/assets', async () => {
    const page = await ready();
    await addWav(page, 'tone.wav', 0.5);
    const code = `import { defineSubgraph, f64, state, type Node } from '@unworklet/core';
import { audio } from '@den-kit/assets';

export default defineSubgraph((config: { sampleRate: number }) => {
  const tone = audio('assets/tone.wav');
  const position = state.f64(0).named('position');
  return {
    tick(i: { in: Node<'f32'> }) {
      const p = position.read();
      position.write(p.add(1).mod(f64(tone.length()).max(1)));
      return { out: tone.read(0, p) };
    },
  };
});
`;
    const r = await page.evaluate(
      code =>
        (window as unknown as K).__kit.commit([
          { op: 'addNode', node: { id: 'box1', type: 'kit.codebox', code } },
          {
            op: 'connect',
            from: { node: 'box1', port: 'out' },
            to: { node: 'out1', port: 'left' },
            replace: true,
          },
        ]),
      code,
    );
    assert.equal(r.ok, true, JSON.stringify(r.error));
    await settle(page);
    const status = await kit(page, k => ({
      status: k.compileStatus.value,
      issues: k.compileIssues.value,
    }));
    assert.equal(status.status, 'ok', JSON.stringify(status));
    const peak = await outputPeak(page, 400);
    assert.ok(peak > 0.1, `the codebox plays the asset (peak ${peak})`);
    await page.close();
  });

  it('broken audio (NaN) is reported and muted before the speakers', async () => {
    const page = await ready();
    const code = `import { defineSubgraph, f32, type Node } from '@unworklet/core';

export default defineSubgraph(() => ({
  tick(i: { in: Node<'f32'> }) {
    return { out: f32(0).div(f32(0)) };
  },
}));
`;
    await page.evaluate(
      code =>
        (window as unknown as K).__kit.commit([
          { op: 'addNode', node: { id: 'box1', type: 'kit.codebox', code } },
          {
            op: 'connect',
            from: { node: 'box1', port: 'out' },
            to: { node: 'out1', port: 'left' },
            replace: true,
          },
        ]),
      code,
    );
    await settle(page);
    await page.waitForFunction(
      () => (window as unknown as K).__kit.engine.stats.healthEvents > 0,
      null,
      { timeout: 15000 },
    );
    const peak = await outputPeak(page, 300);
    assert.ok(Number.isFinite(peak) && peak <= 0.99, `post-safety peak ${peak}`);
    assert.ok(
      await kit(page, k =>
        k.toasts.value.some((t: { text: string }) => /runaway|NaN/.test(t.text)),
      ),
    );
    await page.close();
  });
});
