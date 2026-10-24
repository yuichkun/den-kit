// The playable build without den-kit: the work file den-kit exports carries it; one
// static server serves it, another one on a second origin serves the built code
// parts. The player plays when clicked, the computer keys play notes, a code part
// shows from its own origin, and moving a control changes only the player's own
// state. The record and the build are of the work as it was when the export
// started, and the build plays the whole sound, whatever the editor has soloed.
// Needs den-kit's player build (vp run build makes dist/player/).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join } from 'node:path';
import { kitRoot, openKit, startHarness, waitCompiled, type Harness } from './harness.ts';
import { catalog } from '../../src/sound/blocks/index.ts';
import { generate } from '../../src/sound/codegen.ts';
import { parseDocument } from '../../src/work/persistence.ts';
import { readZip } from '../../src/work/zip.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
// A code part that shows the sound's level.
const METER = `import { part } from '../kit';
export default part({ mount(root, kit) {
  const bar = root.appendChild(document.createElement('div'));
  bar.id = 'level';
  return kit.frame(() => { bar.dataset.level = String(kit.audio.level); });
} });
`;
/** A work file's entries by path. */
const entriesOf = (bytes: number[]) =>
  new Map(
    readZip(new Uint8Array(bytes), {
      maxEntryBytes: 100 * 1024 * 1024,
      maxTotalBytes: 1024 * 1024 * 1024,
      maxEntries: 10000,
    }).map(e => [e.path, e.data] as const),
  );
const json = (data: Uint8Array | undefined) => JSON.parse(new TextDecoder().decode(data));
const servers: Server[] = [];
async function serve(files: Map<string, Uint8Array>, headers: Record<string, string>) {
  const server = createServer((req, res) => {
    const path =
      decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname.slice(1)) || 'index.html';
    const data = files.get(path);
    if (!data) {
      res.writeHead(404).end();
      return;
    }
    res
      .writeHead(200, {
        'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
        ...headers,
      })
      .end(Buffer.from(data));
  });
  servers.push(server);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

let h: Harness;
before(async () => {
  h = await startHarness({ pod: true });
});
after(async () => {
  for (const s of servers) s.close();
  await h?.close();
});

describe('the playable build', () => {
  it(
    'plays without den-kit from a static server, its code part from another origin; a moved control changes only the player',
    { timeout: 300000 },
    async () => {
      assert.ok(
        existsSync(join(kitRoot, 'dist/player/manifest.json')),
        'den-kit has no player build: run vp run build first',
      );
      const { page, errors } = await openKit(h);
      await waitCompiled(page);
      const placed = await page.evaluate(async part => {
        const k = (window as any).__kit;
        // den-kit's own files (the controls list, the kit's behaviors) are not kept in the work.
        const files = Object.fromEntries(
          [...k.pod.wanted()].filter(
            ([p]: [string]) => !p.startsWith('src/kit/behaviors/') && p !== 'src/kit/controls.ts',
          ),
        );
        const result = k.commit([
          { op: 'setProjectFiles', files: { ...files, 'src/parts/meter.ts': part } },
          // A knob on the plugin that sets the filter's cutoff.
          {
            op: 'addNode',
            node: {
              id: 'cutknob',
              type: 'ui.knob',
              label: 'Cutoff',
              pos: { x: 400, y: 480 },
              panel: { x: 160, y: 20, w: 120, h: 140 },
              config: { min: 100, max: 2000, scale: 'linear', unit: 'Hz' },
              values: { value: 300 },
            },
          },
          {
            op: 'connect',
            from: { node: 'cutknob', port: 'out' },
            to: { node: 'cut1', port: 'hz' },
          },
          {
            op: 'addElement',
            element: {
              id: 'meter1',
              kind: 'code',
              part: 'meter',
              rect: { x: 20, y: 20, w: 120, h: 80 },
              props: {},
            },
          },
        ]);
        return { ok: result.ok, error: result.error?.message };
      }, METER);
      assert.equal(placed.ok, true, placed.error);
      // The work file carries the playable build: the player, the compiled sound and the built code parts.
      const bytes = await page.evaluate(async () =>
        Array.from((await (window as any).__kit.exportWork()) as Uint8Array),
      );
      const build = new Map(
        readZip(new Uint8Array(bytes), {
          maxEntryBytes: 100 * 1024 * 1024,
          maxTotalBytes: 1024 * 1024 * 1024,
          maxEntries: 10000,
        })
          .filter(e => e.path.startsWith('build/'))
          .map(e => [e.path.slice('build/'.length), e.data] as const),
      );
      for (const file of ['index.html', 'build.json', 'processor.js', 'processor.wasm'])
        assert.ok(build.has(file), `${file} in the build`);
      const parts = new Map(
        [...build]
          .filter(([p]) => p.startsWith('parts/'))
          .map(([p, d]) => [p.slice('parts/'.length), d] as const),
      );
      assert.ok(parts.has('index.html'), 'the code parts were built');
      const site = await serve(new Map([...build].filter(([p]) => !p.startsWith('parts/'))), {
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'require-corp',
      });
      const partsSite = await serve(parts, {
        'cross-origin-resource-policy': 'cross-origin',
        'cross-origin-embedder-policy': 'require-corp',
      });
      const player = await h.browser.newPage();
      const playerErrors: string[] = [];
      player.on('pageerror', e => playerErrors.push(e.message));
      await player.goto(`${site}/index.html?parts=${encodeURIComponent(`${partsSite}/`)}`);
      await player.click('[data-testid=player-start]');
      await player.waitForFunction(
        () =>
          document.querySelector('[data-testid=player]')?.getAttribute('data-state') === 'playing',
        null,
        { timeout: 30000 },
      );
      // The code part runs, from its own origin.
      await player.waitForSelector('[data-element=meter1] [data-code-state=ready]', {
        timeout: 30000,
      });
      await player.waitForFunction(
        origin => [...document.querySelectorAll('iframe')].some(f => f.src.startsWith(origin)),
        partsSite,
      );
      // The computer keys play a note: the output moves.
      const peak = () =>
        player.evaluate(async () => {
          const a = (window as any).__player.engine.outAnalyser as AnalyserNode;
          const data = new Float32Array(a.fftSize);
          let max = 0;
          for (let i = 0; i < 10; i++) {
            a.getFloatTimeDomainData(data);
            for (const s of data) max = Math.max(max, Math.abs(s));
            await new Promise(r => setTimeout(r, 20));
          }
          return max;
        });
      await player.keyboard.down('a');
      await player.waitForTimeout(200);
      assert.ok((await peak()) > 0.001, 'a note sounds');
      await player.keyboard.up('a');
      // A control moved: the sound's value follows, the player's own state changes, the build does not.
      const before = await player.evaluate(() => (window as any).__player.values());
      const knob = player.locator('[data-widget=cutknob] dk-knob');
      await knob.focus();
      await player.keyboard.press('ArrowUp');
      await player.waitForFunction(
        b => JSON.stringify((window as any).__player.values()) !== b,
        JSON.stringify(before),
      );
      const manifest = await (await fetch(`${site}/build.json`)).text();
      assert.equal(manifest, new TextDecoder().decode(build.get('build.json')));
      assert.deepEqual(playerErrors, []);
      assert.deepEqual(errors, []);
      await player.close();
      // Never from the player's own origin, where a part could reach the player.
      const same = await h.browser.newPage();
      await same.goto(`${site}/index.html?parts=${encodeURIComponent(`${site}/parts/`)}`);
      const status = await same.waitForSelector('[data-element=meter1] [data-testid=code-status]');
      assert.match((await status.textContent()) ?? '', /from another origin/);
      assert.equal(
        await same.evaluate(
          () => [...document.querySelectorAll('iframe')].filter(f => f.src).length,
        ),
        0,
      );
      await same.close();
      await page.close();
    },
  );

  it(
    'is of the work as it was when the export started, edits made meanwhile in neither the record nor the build, and plays the whole sound while the editor solos a part',
    { timeout: 300000 },
    async () => {
      const { page, errors } = await openKit(h);
      await waitCompiled(page);
      // A code part, a part of the sound soloed in the editor, then a change to what the solo leaves out.
      const soloed: string = await page.evaluate(async part => {
        const k = (window as any).__kit;
        const files = Object.fromEntries(
          [...k.pod.wanted()].filter(
            ([p]: [string]) => !p.startsWith('src/kit/behaviors/') && p !== 'src/kit/controls.ts',
          ),
        );
        if (
          !k.commit([{ op: 'setProjectFiles', files: { ...files, 'src/parts/meter.ts': part } }]).ok
        )
          throw new Error('the code part was not added');
        const made = k.commit([{ op: 'makePart', ids: ['cut1', 'filter1'], name: 'Tone' }]);
        k.setSolo([made.created[0]]);
        k.commit([{ op: 'setConfig', node: 'osc1', key: 'waveform', value: 'square' }]);
        return k.generated.value.hash;
      }, METER);
      await waitCompiled(page);
      const exported = await page.evaluate(async () => {
        const k = (window as any).__kit;
        const name = k.doc.value.name;
        const making = k.exportWork();
        k.commit([{ op: 'setName', name: 'Renamed while exporting' }]);
        const meter = k.doc.value.files['src/parts/meter.ts'].text;
        k.commit([
          { op: 'setProjectFiles', files: { 'src/parts/meter.ts': `// changed\n${meter}` } },
        ]);
        const bytes = Array.from((await making) as Uint8Array);
        return { name, bytes, toasts: k.toasts.value.map((t: { text: string }) => t.text) };
      });
      const file = entriesOf(exported.bytes);
      const record = json(file.get('work.json')).document;
      const manifest = json(file.get('build/build.json'));
      assert.equal(record.name, exported.name);
      assert.doesNotMatch(JSON.stringify(record), /\/\/ changed/);
      assert.deepEqual(manifest.document, record);
      const read = parseDocument(record, catalog);
      assert.ok(read.ok);
      const whole = generate(read.doc, catalog).hash;
      assert.notEqual(whole, soloed);
      assert.equal(manifest.processor.hash, whole, "the build plays the record's whole sound");
      assert.equal(manifest.parts, false);
      assert.ok(![...file.keys()].some(p => p.startsWith('build/parts/')));
      assert.ok(
        exported.toasts.some((t: string) => /the project changed while it was made/.test(t)),
        JSON.stringify(exported.toasts),
      );
      // Exported again, with nothing changing meanwhile: the edits are in it, the code parts built from them.
      const again = entriesOf(
        await page.evaluate(async () =>
          Array.from((await (window as any).__kit.exportWork()) as Uint8Array),
        ),
      );
      const record2 = json(again.get('work.json')).document;
      assert.equal(record2.name, 'Renamed while exporting');
      assert.match(JSON.stringify(record2), /\/\/ changed/);
      assert.deepEqual(json(again.get('build/build.json')).document, record2);
      assert.ok(again.has('build/parts/index.html'), 'the code parts were built');
      assert.deepEqual(errors, []);
      await page.close();
    },
  );
});
