// Makes the playable builds that the delivery sketch (delivery.html) hands over:
// Footsteps (sketch/delivery/footsteps.ts) in both versions and the showcase's
// Rainfall, compiled by den-kit itself on a running dev server, written to
// public/delivery/<work>/<version> as the sound part of a playable build
// (src/work/playable.ts: build.json, processor.js, processor.wasm). The player's own
// files are left out: the sketch is the page.
// Run `vp run dev`, then: node scripts/delivery-builds.ts [address of den-kit]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const kit = fileURLToPath(new URL('..', import.meta.url));
const address = process.argv[2] ?? 'http://127.0.0.1:5180';
const executablePath =
  process.env.CHROMIUM_PATH ??
  (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

interface Made {
  folder: string;
  files: Record<string, string>;
  binary: string[];
  issues: string[];
}

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto(`${address}/?noStart`);
  await page.waitForFunction(() => 'kit' in window || '__kit' in window, null, {
    timeout: 120_000,
  });
  const made: Made[] = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const session = (window as unknown as { __kit: { compileApart: Function } }).__kit;
    const { catalog } = await load('/src/sound/blocks/index.ts');
    const { generate } = await load('/src/sound/codegen.ts');
    const { serializeDocument } = await load('/src/work/persistence.ts');
    const { isContent } = await load('/src/work/files.ts');
    const playable = await load('/src/work/playable.ts');
    const { footsteps } = await load('/sketch/delivery/footsteps.ts');
    const { rain } = await load('/src/screen/showcase/rain.ts');
    const base64 = (bytes: ArrayBuffer) => {
      let text = '';
      const view = new Uint8Array(bytes);
      for (let i = 0; i < view.length; i += 0x8000)
        text += String.fromCharCode(...view.subarray(i, i + 0x8000));
      return btoa(text);
    };
    const out: Made[] = [];
    const works = [
      { folder: 'footsteps/v1', doc: footsteps(catalog, 1) },
      { folder: 'footsteps/v2', doc: footsteps(catalog, 2) },
      { folder: 'rain/v1', doc: rain(catalog) },
    ];
    for (const { folder, doc } of works) {
      const generated = generate(doc, catalog);
      const issues = generated.issues.map((i: { message: string }) => i.message);
      if (!generated.source) throw new Error(`${folder}: ${issues.join('; ')}`);
      const artifact = await session.compileApart(doc, generated);
      const manifest = {
        format: playable.PLAYABLE_FORMAT,
        version: playable.PLAYABLE_VERSION,
        document: JSON.parse(
          serializeDocument({
            ...doc,
            files: Object.fromEntries(
              Object.entries(doc.files).filter(([, file]) => isContent(file)),
            ),
          }),
        ),
        processor: {
          hash: artifact.hash,
          meta: artifact.meta,
          processorName: artifact.processorName,
          sampleRate: artifact.sampleRate,
        },
        parts: false,
      };
      out.push({
        folder,
        files: {
          [playable.PLAYABLE_MANIFEST]: JSON.stringify(manifest),
          [playable.PROCESSOR_MODULE]: artifact.moduleSource,
          [playable.PROCESSOR_WASM]: base64(artifact.wasm),
        },
        binary: [playable.PROCESSOR_WASM],
        issues,
      });
    }
    return out;
  });
  for (const build of made) {
    const folder = join(kit, 'public/delivery', build.folder);
    mkdirSync(folder, { recursive: true });
    for (const [name, text] of Object.entries(build.files))
      writeFileSync(
        join(folder, name),
        build.binary.includes(name) ? Buffer.from(text, 'base64') : text,
      );
    console.log(
      `${build.folder}: written${build.issues.length ? ` (${build.issues.join('; ')})` : ''}`,
    );
  }
} finally {
  await browser.close();
}
