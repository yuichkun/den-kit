// Real Web Audio clock → compiled patch → safety/output, including a patch swap.
import { after, before, it } from 'node:test';
import assert from 'node:assert/strict';
import { openKit, outputPeak, startHarness, type Harness } from './harness.ts';

let h: Harness;
before(async () => {
  h = await startHarness({ bridge: false });
});
after(async () => {
  await h?.close();
});

it('plays clock signals and audition clicks, keeps phase across a patch swap, and stops stale playback', async () => {
  const { page, errors } = await openKit(h);
  const result = await page.evaluate(() => {
    const k = (window as any).__kit;
    const edit = k.commit([
      ...Object.keys(k.doc.value.nodes).map(id => ({ op: 'removeNode', id })),
      { op: 'addNode', node: { id: 'clock1', type: 'kit.transport' } },
      { op: 'addNode', node: { id: 'gain1', type: 'kit.gain', values: { gain: 0.1 } } },
      { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
      { op: 'connect', from: { node: 'clock1', port: 'beat' }, to: { node: 'gain1', port: 'in' } },
      { op: 'connect', from: { node: 'gain1', port: 'out' }, to: { node: 'out1', port: 'left' } },
    ]);
    const origin = performance.now();
    const update = () => {
      const time = performance.now();
      k.engine.setTransport({
        tempo: 120,
        beat: (time - origin) / 500,
        playing: true,
        performanceTime: time,
        startPerformanceTime: origin,
      });
    };
    update();
    (window as any).__clockTimer = setInterval(update, 50);
    return edit;
  });
  assert.equal(result.ok, true);
  await page.waitForFunction(
    () => {
      const k = (window as any).__kit;
      return k.compileStatus.value === 'ok' && k.engine.currentHash === k.generated.value.hash;
    },
    null,
    { timeout: 60000 },
  );
  assert.ok((await outputPeak(page)) > 0.01, 'the Transport beat reaches the speakers');
  await page.evaluate(() => {
    (window as any).__originalClock = (window as any).__kit.engine.transportNode;
  });
  const oldHash = await page.evaluate(() => (window as any).__kit.engine.currentHash);
  await page.evaluate(() => {
    const k = (window as any).__kit;
    k.commit([
      { op: 'disconnectInput', to: { node: 'gain1', port: 'in' } },
      { op: 'connect', from: { node: 'clock1', port: 'bar' }, to: { node: 'gain1', port: 'in' } },
    ]);
  });
  await page.waitForFunction(hash => (window as any).__kit.engine.currentHash !== hash, oldHash);
  assert.ok(
    await page.evaluate(
      () => (window as any).__originalClock === (window as any).__kit.engine.transportNode,
    ),
    'a patch swap uses the same sample clock',
  );
  assert.ok((await outputPeak(page)) > 0.01, 'clock remains connected after a patch swap');
  await page.evaluate(() => {
    const engine = (window as any).__kit.engine;
    engine.setParam('gain1_gain', 0);
    engine.setTransportClick(true);
  });
  assert.ok(
    (await outputPeak(page, 700)) > 0.005,
    'audition click sounds independently of the patch',
  );
  await page.evaluate(() => {
    clearInterval((window as any).__clockTimer);
  });
  await page.waitForTimeout(1200);
  assert.ok((await outputPeak(page)) < 0.00001, 'stale host playback becomes silent');
  assert.deepEqual(errors, []);
  await page.close();
});
