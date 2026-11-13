// The audio engine in a real browser: create → sound → rewire → keeps sounding →
// failure keeps the previous sound; device rates and render quanta; plus runaway
// feedback and a codebox that never finishes building or tries to reach out.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from 'playwright';
import {
  openKit,
  outputPeak,
  reloadKit,
  startAudio,
  startHarness,
  waitCompiled,
  type Harness,
} from './harness.ts';

type K = { __kit: any };
let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h?.close();
});

// Run fn(window.__kit) in the page (fn is serialized; it must not close over test variables).
const kit = (page: Page, fn: (k: any) => unknown): Promise<any> =>
  page.evaluate(`(${fn.toString()})(window.__kit)`);
async function ready(query = '') {
  const { page, errors } = await openKit(h, { query });
  await waitCompiled(page);
  await page.waitForFunction(() => (window as unknown as K).__kit.engine.hasNode, null, {
    timeout: 60000,
  });
  return { page, errors };
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
  await page.waitForTimeout(150);
}

/** A real device at each target, including hosts that do not expose their quantum. */
function deviceScript(
  targets: Array<{ sampleRate: number; renderQuantumSize: number }>,
  hideQuantum = false,
) {
  return `{
    const Real = AudioContext;
    const targets = ${JSON.stringify(targets)};
    let created = 0;
    window.AudioContext = class extends Real {
      constructor(options) {
        if (options?.sampleRate !== undefined) throw new Error('The app forced a sample rate');
        const target = targets[Math.min(created++, targets.length - 1)];
        super({ ...options, sampleRate: target.sampleRate, renderSizeHint: target.renderQuantumSize });
        ${hideQuantum ? "Object.defineProperty(this, 'renderQuantumSize', { value: undefined });" : ''}
      }
    };
  }`;
}

async function sinePatch(page: Page) {
  assert.equal(
    await kit(
      page,
      k =>
        k.commit([
          {
            op: 'addNode',
            node: {
              id: 'tone1',
              type: 'den.oscillator',
              config: { waveform: 'sine' },
              values: { frequency: 440 },
            },
          },
          { op: 'addNode', node: { id: 'quiet1', type: 'kit.gain', values: { gain: 0.1 } } },
          {
            op: 'connect',
            from: { node: 'tone1', port: 'out' },
            to: { node: 'quiet1', port: 'in' },
          },
          {
            op: 'connect',
            from: { node: 'quiet1', port: 'out' },
            to: { node: 'out1', port: 'left' },
            replace: true,
          },
        ]).ok,
    ),
    true,
  );
  assert.equal((await waitCompiled(page)).status, 'ok');
}

/** Interpolate positive zero crossings: checks pitch, not just nonzero output. */
async function outputFrequency(page: Page) {
  return page.evaluate(async () => {
    const engine = (window as unknown as K).__kit.engine;
    const analyser = engine.rawAnalyser as AnalyserNode;
    const data = new Float32Array(analyser.fftSize);
    for (let attempt = 0; attempt < 50; attempt++) {
      analyser.getFloatTimeDomainData(data);
      const crossings: number[] = [];
      let peak = 0;
      for (let i = 1; i < data.length; i++) {
        peak = Math.max(peak, Math.abs(data[i]));
        if (data[i - 1] < 0 && data[i] >= 0)
          crossings.push(i - 1 - data[i - 1] / (data[i] - data[i - 1]));
      }
      if (peak > 0.01 && crossings.length > 4)
        return (
          ((crossings.length - 1) * engine.ctx.sampleRate) / (crossings.at(-1)! - crossings[0])
        );
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('No periodic audio reached the analyser');
  });
}

async function samplerPatch(page: Page) {
  return page.evaluate(async () => {
    const rate = 48000;
    const frames = rate / 4;
    const wav = new DataView(new ArrayBuffer(44 + frames * 2));
    const text = (at: number, value: string) =>
      [...value].forEach((char, i) => wav.setUint8(at + i, char.charCodeAt(0)));
    text(0, 'RIFF');
    wav.setUint32(4, 36 + frames * 2, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    wav.setUint32(16, 16, true);
    wav.setUint16(20, 1, true);
    wav.setUint16(22, 1, true);
    wav.setUint32(24, rate, true);
    wav.setUint32(28, rate * 2, true);
    wav.setUint16(32, 2, true);
    wav.setUint16(34, 16, true);
    text(36, 'data');
    wav.setUint32(40, frames * 2, true);
    for (let i = 0; i < frames; i++)
      wav.setInt16(44 + i * 2, Math.round(3276 * Math.sin((2 * Math.PI * 440 * i) / rate)), true);
    const k = (window as unknown as K).__kit;
    await k.addAssetFile(new File([wav.buffer], 'target-tone.wav', { type: 'audio/wav' }));
    return k.commit([
      {
        op: 'addNode',
        node: {
          id: 'targetSampler',
          type: 'den.samplePlayer',
          config: { sound: 'assets/target-tone.wav', loop: true },
          values: { gate: true },
        },
      },
      {
        op: 'connect',
        from: { node: 'targetSampler', port: 'out' },
        to: { node: 'out1', port: 'left' },
        replace: true,
      },
    ]).ok;
  });
}

describe('audio engine', () => {
  it('plays, survives a structural edit while a note is held, and keeps the old sound when compilation fails', async () => {
    const { page, errors } = await ready();
    await kit(page, k => k.engine.noteOn(48, 100));
    assert.ok((await outputPeak(page)) > 0.005, 'bass should sound');
    const firstHash = await kit(page, k => k.engine.currentHash);
    // Structural edit while the key is held: new artifact, held note re-sent.
    await kit(page, k =>
      k.commit([{ op: 'setConfig', node: 'osc1', key: 'waveform', value: 'sine' }]),
    );
    await settle(page);
    await page.waitForFunction(
      h0 => (window as unknown as K).__kit.engine.currentHash !== h0,
      firstHash,
    );
    assert.ok((await outputPeak(page)) > 0.005, 'still sounding after the swap');
    // Now break it: a codebox with a syntax error in the signal path.
    const before = await kit(page, k => k.engine.currentHash);
    const r = await kit(
      page,
      k =>
        k.commit([
          {
            op: 'addNode',
            node: {
              id: 'box1',
              type: 'kit.codebox',
              code: "import { defineSubgraph } from '@unworklet/core';\nexport default defineSubgraph(() => ({ tick(i) { return { out: i.in.mul( } } }));",
            },
          },
          { op: 'connect', from: { node: 'gain1', port: 'out' }, to: { node: 'box1', port: 'in' } },
          {
            op: 'connect',
            from: { node: 'box1', port: 'out' },
            to: { node: 'out1', port: 'left' },
            replace: true,
          },
        ]).ok,
    );
    assert.equal(r, true);
    const status = await waitCompiled(page);
    assert.equal(status.status, 'error');
    const issues = await kit(page, k => k.compileIssues.value);
    assert.ok(
      issues.some((i: { node?: string; line?: number }) => i.node === 'box1' && i.line),
      `codebox error attributed with a line: ${JSON.stringify(issues)}`,
    );
    assert.equal(
      await kit(page, k => k.engine.currentHash),
      before,
      'previous artifact stays loaded',
    );
    assert.ok((await outputPeak(page)) > 0.005, 'previous sound keeps playing');
    // Undo returns to a compilable patch.
    await kit(page, k => k.undo());
    assert.equal((await waitCompiled(page)).status, 'ok');
    await kit(page, k => k.engine.noteOff(48));
    assert.deepEqual(
      errors.filter(e => !e.includes('favicon')),
      [],
    );
    await page.close();
  });

  it('value edits reach the AudioParam without recompiling', async () => {
    const { page } = await ready();
    const started = await kit(page, k => k.compiler.stats.started);
    await kit(page, k => k.commit([{ op: 'setValue', node: 'gain1', port: 'gain', value: 0.5 }]));
    await page.waitForTimeout(100);
    assert.equal(await kit(page, k => k.compiler.stats.started), started);
    assert.equal(await kit(page, k => k.compileStatus.value), 'ok');
    const value = await kit(page, async k => {
      await new Promise(r => setTimeout(r, 50));
      return (k.engine as any).current.node.params.gain1_gain.value;
    });
    assert.ok(Math.abs(value - 0.5) < 1e-6, `param value ${value}`);
    await page.close();
  });

  it('a burst of structural edits ends on the latest patch with few compiles', async () => {
    const { page } = await ready();
    const started = await kit(page, k => k.compiler.stats.started);
    for (let n = 0; n < 12; n++)
      await kit(page, k =>
        k.commit([
          {
            op: 'setConfig',
            node: 'osc1',
            key: 'waveform',
            value: k.doc.value.nodes.osc1.config.waveform === 'saw' ? 'sine' : 'saw',
          },
        ]),
      );
    await settle(page);
    await page.waitForFunction(
      () => {
        const k = (window as unknown as K).__kit;
        return k.engine.currentHash === k.generated.value.hash;
      },
      null,
      { timeout: 60000 },
    );
    const compiles = (await kit(page, k => k.compiler.stats.started)) - started;
    assert.ok(compiles <= 3, `compiled ${compiles} times`);
    await page.close();
  });

  it('many swaps rotate the AudioContext and leak no nodes', async () => {
    const { page, errors } = await ready('?rotateAfter=6');
    await kit(page, k => k.engine.noteOn(50, 100));
    for (let n = 0; n < 14; n++) {
      await page.evaluate(
        held =>
          (window as unknown as K).__kit.commit([
            { op: 'setValue', node: 'filter1', port: 'resonance', value: 0.6 },
            { op: 'setConfig', node: 'voice1', key: 'heldCapacity', value: held },
          ]),
        8 + n,
      );
      await settle(page);
    }
    await page.waitForTimeout(300);
    const stats = await kit(page, k => k.engine.stats);
    assert.ok(stats.rotations >= 1, JSON.stringify(stats));
    assert.ok(
      stats.created - stats.disposed <= 2 && stats.created - stats.disposed >= 1,
      JSON.stringify(stats),
    );
    assert.ok((await outputPeak(page)) > 0.005, 'sounding after rotation');
    assert.deepEqual(errors, []);
    await page.close();
  });

  it('runaway feedback is muted, reported and recoverable; the safety stage bounds the output', async () => {
    const { page } = await ready();
    const ok = await kit(
      page,
      k =>
        k.commit([
          { op: 'addNode', node: { id: 'noise1', type: 'den.seededNoise' } },
          { op: 'addNode', node: { id: 'h1', type: 'kit.history' } },
          { op: 'addNode', node: { id: 'sum1', type: 'kit.add' } },
          { op: 'addNode', node: { id: 'fb1', type: 'kit.gain', values: { gain: 1.5 } } },
          { op: 'connect', from: { node: 'noise1', port: 'out' }, to: { node: 'sum1', port: 'a' } },
          { op: 'connect', from: { node: 'h1', port: 'out' }, to: { node: 'fb1', port: 'in' } },
          { op: 'connect', from: { node: 'fb1', port: 'out' }, to: { node: 'sum1', port: 'b' } },
          { op: 'connect', from: { node: 'sum1', port: 'out' }, to: { node: 'h1', port: 'in' } },
          {
            op: 'connect',
            from: { node: 'sum1', port: 'out' },
            to: { node: 'out1', port: 'left' },
            replace: true,
          },
        ]).ok,
    );
    assert.equal(ok, true);
    await settle(page);
    await page.waitForFunction(
      () => (window as unknown as K).__kit.engine.stats.healthEvents > 0,
      null,
      { timeout: 15000 },
    );
    const peak = await outputPeak(page, 400);
    assert.ok(peak <= 0.99, `post-safety peak ${peak}`);
    assert.ok(
      await kit(page, k =>
        k.toasts.value.some((t: { text: string }) => /runaway|NaN/.test(t.text)),
      ),
    );
    // It keeps running away: muted, explained in a banner (not a blocking overlay)…
    await page.waitForSelector('[data-testid=banner]', { timeout: 20000 });
    assert.match((await page.textContent('[data-testid=banner]')) ?? '', /muted/i);
    assert.equal(await page.$('[data-testid=start-overlay]'), null);
    // …and the next change (here: undo) brings the sound back without any button.
    await kit(page, k => k.undo());
    await settle(page);
    await page.waitForFunction(() => !document.querySelector('[data-testid=banner]'), null, {
      timeout: 20000,
    });
    assert.equal(await kit(page, k => k.healthMuted.value), false);
    await page.close();
  });

  it('a codebox that loops forever while building times out; the worker is replaced', async () => {
    const { page } = await ready('?compileTimeout=4000');
    const before = await kit(page, k => k.engine.currentHash);
    await kit(page, k =>
      k.commit([
        {
          op: 'addNode',
          node: {
            id: 'box1',
            type: 'kit.codebox',
            code: "import { defineSubgraph, type Node } from '@unworklet/core';\nexport default defineSubgraph(() => { while (Date.now() > 0) { /* never ends */ } return { tick(i: { in: Node<'f32'> }) { return { out: i.in }; } }; });",
          },
        },
        { op: 'connect', from: { node: 'gain1', port: 'out' }, to: { node: 'box1', port: 'in' } },
        {
          op: 'connect',
          from: { node: 'box1', port: 'out' },
          to: { node: 'out1', port: 'left' },
          replace: true,
        },
      ]),
    );
    const status = await waitCompiled(page, 30000);
    assert.equal(status.status, 'error');
    assert.match(status.message, /timed out/);
    assert.equal(await kit(page, k => k.engine.currentHash), before);
    assert.equal(await kit(page, k => k.compiler.stats.timeouts), 1);
    await kit(page, k => k.undo());
    assert.equal((await waitCompiled(page)).status, 'ok');
    await page.close();
  });

  it("a codebox's code has no network or storage while the sound is built", async () => {
    const { page } = await ready();
    const before = await kit(page, k => k.engine.currentHash);
    await kit(page, k =>
      k.commit([
        {
          op: 'addNode',
          node: {
            id: 'box1',
            type: 'kit.codebox',
            code: "import { defineSubgraph, type Node } from '@unworklet/core';\nexport default defineSubgraph(() => { const g = globalThis as unknown as Record<string, unknown>; const reach = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches'].filter(name => g[name] !== undefined); if (reach.length) throw new Error(`reachable: ${reach.join(', ')}`); if (Date.now() > 0) throw new Error('nothing reachable'); return { tick(i: { in: Node<'f32'> }) { return { out: i.in }; } }; });",
          },
        },
        { op: 'connect', from: { node: 'gain1', port: 'out' }, to: { node: 'box1', port: 'in' } },
        {
          op: 'connect',
          from: { node: 'box1', port: 'out' },
          to: { node: 'out1', port: 'left' },
          replace: true,
        },
      ]),
    );
    const status = await waitCompiled(page, 30000);
    assert.equal(status.status, 'error');
    assert.match(status.message, /nothing reachable/);
    assert.equal(await kit(page, k => k.engine.currentHash), before);
    await page.close();
  });

  it("a codebox's code reaches no network while the sound is built, whatever code it evaluates", async () => {
    // A server that records every request; the codebox tries every way out of the worker it has.
    const reached: string[] = [];
    // And den-kit's own server, which records the requests marked as the codebox's before it
    // handles them: the AI bridge it passes requests to, and files of the checkout.
    const local: string[] = [];
    const recorder = {
      route: '',
      handle: (req: { url?: string }, _res: unknown, next: () => void) => {
        if (req.url?.includes('codebox-probe')) local.push(req.url);
        next();
      },
    };
    h.server.middlewares.stack.unshift(recorder);
    const record = createServer((req, res) => {
      reached.push(req.url ?? '');
      res.writeHead(200, {
        'content-type': 'text/javascript',
        'access-control-allow-origin': '*',
        'cross-origin-resource-policy': 'cross-origin',
      });
      res.end('export {};');
    });
    record.on('upgrade', (req, socket) => {
      reached.push(req.url ?? '');
      socket.destroy();
    });
    await new Promise<void>(resolve => record.listen(0, '127.0.0.1', resolve));
    const at = `127.0.0.1:${(record.address() as AddressInfo).port}`;
    try {
      const { page } = await ready();
      const tries = String.raw`
const g = globalThis as unknown as Record<string, any>;
const http = 'http://${at}';
const settle = (p: any) => void p?.then?.(undefined, () => undefined);
settle(import(http + '/import'));
settle((0, eval)("import('" + http + "/eval')"));
settle(new Function("return import('" + http + "/function')")());
settle((async () => {}).constructor("return import('" + http + "/async-function')")());
g.setTimeout("import('" + http + "/timer')", 0);
settle((0, eval)("import('data:text/javascript,import \"" + http + "/data-module\"')"));
settle((0, eval)("import(URL.createObjectURL(new Blob(['import \"" + http + "/blob-module\"'], { type: 'text/javascript' })))"));
settle(new g.FontFace('probe', 'url(' + http + '/font)').load());
try { settle(new g.WebSocketStream('ws://${at}/socket').opened); } catch {}
settle((0, eval)("import('/__kit/token?codebox-probe')"));
settle((0, eval)("import('/package.json?import&codebox-probe')"));
settle((0, eval)("import('/package.json?codebox-probe', { with: { type: 'json' } })"));`;
      await kit(
        page,
        new Function(
          'k',
          `return k.commit(${JSON.stringify([
            {
              op: 'addNode',
              node: {
                id: 'box1',
                type: 'kit.codebox',
                code: `import { defineSubgraph, type Node } from '@unworklet/core';\nexport default defineSubgraph(() => {${tries}\nif (Date.now() > 0) throw new Error('tried every way out'); return { tick(i: { in: Node<'f32'> }) { return { out: i.in }; } }; });`,
              },
            },
            {
              op: 'connect',
              from: { node: 'gain1', port: 'out' },
              to: { node: 'box1', port: 'in' },
            },
            {
              op: 'connect',
              from: { node: 'box1', port: 'out' },
              to: { node: 'out1', port: 'left' },
              replace: true,
            },
          ])})`,
        ) as (k: any) => unknown,
      );
      const status = await waitCompiled(page, 30000);
      assert.equal(status.status, 'error');
      assert.match(status.message, /tried every way out/);
      // What the code started settles after the build; give it time to arrive.
      await page.waitForTimeout(2000);
      assert.deepEqual(reached, []);
      assert.deepEqual(local, []);
      await page.close();
    } finally {
      record.close();
      h.server.middlewares.stack.splice(h.server.middlewares.stack.indexOf(recorder), 1);
    }
  });

  it("a compile worker without the host's policy runs no codebox's code", async () => {
    const { page } = await ready();
    // The compile worker started from a blob takes the page's policies, not its own.
    const reply = await page.evaluate(async script => {
      const { default: url } = await import(script);
      const blob = new Blob([`import ${JSON.stringify(new URL(url, location.href).href)};`], {
        type: 'text/javascript',
      });
      const worker = new Worker(URL.createObjectURL(blob), { type: 'module' });
      const data = await new Promise<{ error?: { message: string; issues: unknown[] } }>(
        resolve => {
          worker.onmessage = e => {
            if (!('phase' in e.data)) resolve(e.data);
          };
          worker.postMessage({
            id: 1,
            hash: 'unguarded',
            source: 'export default 1;',
            nodes: ['box1'],
            codeboxes: [{ node: 'box1', code: '', inputs: [], outputs: [], line: 1 }],
          });
        },
      );
      worker.terminate();
      return data;
    }, '/src/sound/compile/compiler.worker.ts?worker&url');
    assert.match(reply.error?.message ?? '', /cannot keep their code off the network/);
    assert.deepEqual(reply.error?.issues, [
      {
        severity: 'error',
        code: 'codebox-isolation',
        node: 'box1',
        message: reply.error?.message,
      },
    ]);
    await page.close();
  });

  it('opens behind a start overlay: the first key press starts audio and that note sounds; the bottom is just the keyboard', async () => {
    const { page, errors } = await openKit(h, { start: false });
    await waitCompiled(page);
    assert.match(
      (await page.textContent('[data-testid=start-overlay]')) ?? '',
      /Click anywhere to start/,
    );
    await page.keyboard.down('a');
    await page.waitForSelector('[data-testid=start-overlay]', {
      state: 'detached',
      timeout: 30000,
    });
    await page.waitForFunction(() => (window as unknown as K).__kit.engine.hasNode, null, {
      timeout: 60000,
    });
    assert.ok((await outputPeak(page)) > 0.005, 'the key that started audio also plays');
    await page.keyboard.up('a');
    assert.equal(
      await page.$('[data-testid=enable-audio], [data-testid=volume], [data-phrase]'),
      null,
      'no audio buttons, volume or phrase buttons',
    );
    const printed = await page.evaluate(() =>
      [
        ...(document
          .querySelector('[data-testid=keyboard] dk-keyboard')
          ?.shadowRoot?.querySelectorAll('.k') ?? []),
      ]
        .map(e => e.textContent)
        .join(''),
    );
    assert.equal(
      [...printed].sort().join(''),
      [...'AWSEDFTGYHUJK'].sort().join(''),
      'the computer keys are printed on the keyboard',
    );
    assert.deepEqual(errors, []);
    await page.close();
    // A click on the overlay works the same.
    const second = await openKit(h, { start: false });
    await startAudio(second.page);
    assert.equal(await kit(second.page, k => k.engineState.value), 'running');
    await second.page.close();
  });

  for (const sampleRate of [44100, 48000, 96000]) {
    for (const renderQuantumSize of [32, 128, 256]) {
      it(`plays at the device's ${sampleRate} Hz / ${renderQuantumSize} samples after compiling before audio starts`, async () => {
        const target = { sampleRate, renderQuantumSize };
        const { page, errors } = await openKit(h, {
          start: false,
          initScript: deviceScript([target]),
        });
        try {
          await waitCompiled(page);
          await sinePatch(page);
          assert.ok(await page.$('[data-testid=start-overlay]'));
          await startAudio(page);
          await page.waitForFunction(() => (window as unknown as K).__kit.engine.hasNode, null, {
            timeout: 60000,
          });
          assert.deepEqual(
            await kit(page, k => ({
              sampleRate: k.engine.ctx.sampleRate,
              renderQuantumSize: k.engine.ctx.renderQuantumSize,
            })),
            target,
            'the browser renders at the requested target',
          );
          assert.deepEqual(
            await kit(page, k => ({
              sampleRate: k.engine.current.artifact.sampleRate,
              renderQuantumSize: k.engine.current.artifact.renderQuantumSize,
            })),
            target,
            'the loaded processor was compiled for that context',
          );
          const frequency = await outputFrequency(page);
          assert.ok(Math.abs(frequency - 440) < 0.5, `440 Hz became ${frequency} Hz`);
          assert.ok((await outputPeak(page, 100)) > 0.01, 'audio reaches the output');
          assert.deepEqual(errors, []);
        } finally {
          await page.close();
        }
      });
    }
  }

  it('uses 128 samples on a browser without renderQuantumSize', async () => {
    const { page, errors } = await openKit(h, {
      start: false,
      initScript: deviceScript([{ sampleRate: 44100, renderQuantumSize: 128 }], true),
    });
    try {
      await waitCompiled(page);
      await sinePatch(page);
      await startAudio(page);
      await page.waitForFunction(() => (window as unknown as K).__kit.engine.hasNode, null, {
        timeout: 60000,
      });
      assert.equal(await kit(page, k => k.engine.ctx.renderQuantumSize), undefined);
      assert.equal(await kit(page, k => k.engine.current.artifact.renderQuantumSize), 128);
      const frequency = await outputFrequency(page);
      assert.ok(Math.abs(frequency - 440) < 0.5, `440 Hz became ${frequency} Hz`);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('recompiles for a changed device target during context rotation', async () => {
    const { page, errors } = await openKit(h, {
      start: false,
      query: '?rotateAfter=1',
      initScript: deviceScript([
        { sampleRate: 44100, renderQuantumSize: 32 },
        { sampleRate: 96000, renderQuantumSize: 256 },
      ]),
    });
    try {
      await waitCompiled(page);
      await sinePatch(page);
      await startAudio(page);
      await page.waitForFunction(() => (window as unknown as K).__kit.engine.hasNode, null, {
        timeout: 60000,
      });
      assert.ok(Math.abs((await outputFrequency(page)) - 440) < 0.5);
      for (const waveform of ['saw', 'sine']) {
        assert.equal(
          await page.evaluate(
            value =>
              (window as unknown as K).__kit.commit([
                { op: 'setConfig', node: 'tone1', key: 'waveform', value },
              ]).ok,
            waveform,
          ),
          true,
        );
        await settle(page);
        await page.waitForFunction(
          () => {
            const k = (window as unknown as K).__kit;
            return k.engine.currentHash === k.generated.value.hash;
          },
          null,
          { timeout: 60000 },
        );
      }
      await page.waitForFunction(
        () => {
          const engine = (window as unknown as K).__kit.engine;
          return engine.stats.rotations > 0 && engine.ctx.sampleRate === 96000;
        },
        null,
        { timeout: 60000 },
      );
      assert.deepEqual(
        await kit(page, k => ({
          sampleRate: k.engine.current.artifact.sampleRate,
          renderQuantumSize: k.engine.current.artifact.renderQuantumSize,
        })),
        { sampleRate: 96000, renderQuantumSize: 256 },
      );
      const frequency = await outputFrequency(page);
      assert.ok(Math.abs(frequency - 440) < 0.5, `440 Hz became ${frequency} Hz after rotation`);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('decodes an unchanged audio asset again at a new device rate without changing its pitch or duration', async () => {
    const { page, errors } = await openKit(h, {
      start: false,
      query: '?rotateAfter=1',
      initScript: deviceScript([
        { sampleRate: 44100, renderQuantumSize: 32 },
        { sampleRate: 96000, renderQuantumSize: 256 },
      ]),
    });
    const decoded = () =>
      kit(page, async k => {
        const audio = (await Promise.all(k.engine.decoded.values()))[0] as AudioBuffer;
        return { sampleRate: audio.sampleRate, duration: audio.duration, length: audio.length };
      });
    try {
      await waitCompiled(page);
      assert.equal(await samplerPatch(page), true);
      assert.equal((await waitCompiled(page)).status, 'ok');
      await startAudio(page);
      await page.waitForFunction(() => (window as unknown as K).__kit.engine.hasNode, null, {
        timeout: 60000,
      });
      assert.ok(Math.abs((await outputFrequency(page)) - 440) < 0.5);
      const initial = await decoded();
      assert.equal(initial.sampleRate, 44100);
      // Browser resampling can round the decoded frame count down by one.
      assert.ok(Math.abs(initial.length - 11025) <= 1, JSON.stringify(initial));
      assert.ok(Math.abs(initial.duration - 0.25) * 44100 < 1.000001, JSON.stringify(initial));
      for (const loop of [false, true]) {
        assert.equal(
          await page.evaluate(
            value =>
              (window as unknown as K).__kit.commit([
                { op: 'setConfig', node: 'targetSampler', key: 'loop', value },
              ]).ok,
            loop,
          ),
          true,
        );
        await settle(page);
        await page.waitForFunction(
          () => {
            const k = (window as unknown as K).__kit;
            return k.engine.currentHash === k.generated.value.hash;
          },
          null,
          { timeout: 60000 },
        );
      }
      await page.waitForFunction(
        () => {
          const engine = (window as unknown as K).__kit.engine;
          return engine.stats.rotations > 0 && engine.current?.artifact.sampleRate === 96000;
        },
        null,
        { timeout: 60000 },
      );
      const frequency = await outputFrequency(page);
      assert.ok(Math.abs(frequency - 440) < 0.5, `the asset became ${frequency} Hz`);
      const rotated = await decoded();
      assert.equal(rotated.sampleRate, 96000);
      assert.ok(Math.abs(rotated.length - 24000) <= 1, JSON.stringify(rotated));
      assert.ok(Math.abs(rotated.duration - 0.25) * 96000 < 1.000001, JSON.stringify(rotated));
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('autosave restores after reload; a corrupted autosave falls back with a warning', async () => {
    const { page } = await openKit(h);
    await waitCompiled(page);
    await kit(page, k => {
      k.commit([
        { op: 'setName', name: 'Persist me' },
        { op: 'setValue', node: 'filter1', port: 'resonance', value: 2.5 },
      ]);
      k.saveNow();
    });
    // The host keeps the record (here: the page's own storage), written through after each change.
    const kept = await page.waitForFunction(
      () => {
        const r = localStorage.getItem('den-kit:editor:work');
        return r && r.includes('Persist me') ? r : null;
      },
      null,
      { timeout: 10000 },
    );
    const written = (await kept.jsonValue()) as string;
    await page.evaluate(() => sessionStorage.setItem('kit-e2e-keep', '1'));
    await reloadKit(page);
    await page.waitForFunction(
      () => (window as unknown as K).__kit?.doc.value.name === 'Persist me',
      null,
      { timeout: 60000 },
    );
    assert.equal(await kit(page, k => k.doc.value.nodes.filter1.values.resonance), 2.5);
    await page.close();
    // A torn write: the checksum no longer matches. Inject it before the app starts.
    const context = await h.browser.newContext();
    const broken = JSON.stringify({
      ...JSON.parse(written),
      text: (JSON.parse(written).text as string).replace('Persist', 'Broken'),
    });
    await context.addInitScript(value => {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('den-kit:editor:work', value);
      }
    }, broken);
    const second = await context.newPage();
    await second.goto(h.url);
    await second.waitForFunction(
      () => (window as unknown as K).__kit?.toasts.value.length > 0,
      null,
      { timeout: 60000 },
    );
    assert.ok(
      await kit(second, k =>
        k.toasts.value.some((t: { text: string }) => /Autosave could not be read/.test(t.text)),
      ),
    );
    assert.equal(await kit(second, k => k.doc.value.name), 'Bass');
    // The broken record is kept next to the record, written through to the host.
    await second.waitForFunction(
      () => Object.keys(localStorage).some(key => key.startsWith('den-kit:editor:work:broken:')),
      null,
      { timeout: 10000 },
    );
    await context.close();
  });

  it('leaving the page closes the audio while the page is still whole; a page kept in the back/forward cache keeps playing', async () => {
    const { page, errors } = await ready();
    await page.evaluate(() =>
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })),
    );
    assert.equal(await kit(page, k => k.engine.ctx?.state), 'running');
    // Closed by the time pagehide returns, before the browser tears the page down.
    assert.equal(
      await kit(page, k => {
        const ctx = k.engine.ctx;
        dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
        return ctx.state;
      }),
      'closed',
    );
    await page.waitForFunction(() => (window as unknown as K).__kit.engineState.value === 'off');
    assert.deepEqual(errors, []);
    await page.close();
  });
});
