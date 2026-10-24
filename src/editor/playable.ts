// The open work's playable build (src/work/playable.ts), made from one document of
// it and what the editor has: that document's compiled sound (nothing soloed), its
// assets, the player den-kit was built with (player/ next to den-kit's page), and,
// when the work has code parts, their build from the workspace (npm run build) while
// it holds that document's files. A part that cannot be made is left out and said
// so; the rest still plays.
import { serializeDocument } from '../work/persistence.ts';
import {
  PARTS_FOLDER,
  PLAYABLE_FORMAT,
  PLAYABLE_MANIFEST,
  PLAYABLE_VERSION,
  PROCESSOR_MODULE,
  PROCESSOR_WASM,
  type PlayableManifest,
} from '../work/playable.ts';
import type { PlayableBuild } from '../work/work-file.ts';
import { isContent, textFiles } from '../work/files.ts';
import type { PatchDocument } from '../work/schema.ts';
import { assetsOf } from '../work/ui.ts';
import { generate } from '../sound/codegen.ts';
import type { KitSession } from './session.ts';

/** The player's files, from den-kit's own player/ folder (its build manifest lists them). */
async function playerFiles(): Promise<PlayableBuild | null> {
  const base = new URL('player/', location.href);
  const manifest = (await fetch(new URL('manifest.json', base))
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null)) as Record<
    string,
    {
      file: string;
      css?: string[];
      assets?: string[];
      imports?: string[];
      dynamicImports?: string[];
    }
  > | null;
  if (!manifest?.['player.html']) return null;
  const paths = new Set<string>(['player.html']);
  const seen = new Set<string>();
  const visit = (key: string) => {
    const entry = manifest[key];
    if (!entry || seen.has(key)) return;
    seen.add(key);
    paths.add(entry.file);
    for (const p of [...(entry.css ?? []), ...(entry.assets ?? [])]) paths.add(p);
    for (const k of [...(entry.imports ?? []), ...(entry.dynamicImports ?? [])]) visit(k);
  };
  visit('player.html');
  const files: PlayableBuild = {};
  for (const path of paths) {
    const r = await fetch(new URL(path, base));
    if (!r.ok) return null;
    // The player's page is the build's own page.
    files[path === 'player.html' ? 'index.html' : path] = new Uint8Array(await r.arrayBuffer());
  }
  return files;
}

export async function buildPlayable(
  session: KitSession,
  doc: PatchDocument,
): Promise<{ build: PlayableBuild; notes: string[] }> {
  const notes: string[] = [];
  const generated = generate(doc, session.catalog);
  const artifact = generated.source
    ? await session.compileApart(doc, generated).catch(() => null)
    : null;
  if (!artifact) throw new Error('The sound does not compile; fix it to make a playable build.');
  const player = await playerFiles();
  if (!player) throw new Error('This den-kit has no player to put in a playable build.');
  const build: PlayableBuild = { ...player };
  build[PROCESSOR_MODULE] = new TextEncoder().encode(artifact.moduleSource);
  build[PROCESSOR_WASM] = new Uint8Array(artifact.wasm);
  const assets = assetsOf(doc.files);
  for (const [path, file] of Object.entries(doc.files)) {
    if (!isContent(file) || !assets[path]) continue;
    const bytes = await session.assets.read(assets[path]);
    if (bytes) build[path] = bytes;
    else notes.push(`${path} is missing and is not in the playable build.`);
  }
  let parts = false;
  if (Object.keys(textFiles(doc.files)).some(p => p.startsWith('src/parts/'))) {
    const built = await session.pod?.buildParts(doc).catch(() => null);
    if (built && built !== 'changed') {
      for (const [path, bytes] of Object.entries(built)) build[PARTS_FOLDER + path] = bytes;
      parts = true;
      // The editor shows them from this build too while the workspace does not run them.
      await session.codeParts?.keep(built, session.codeParts.builtFrom(doc), doc.id);
    } else
      notes.push(
        built === 'changed'
          ? 'The code parts are not in the playable build: the project changed while it was made (export again).'
          : 'The code parts are not in the playable build: they could not be built (start the project tools, then export again).',
      );
  }
  const manifest: PlayableManifest = {
    format: PLAYABLE_FORMAT,
    version: PLAYABLE_VERSION,
    document: JSON.parse(serializeDocument(doc)),
    processor: {
      hash: artifact.hash,
      meta: artifact.meta,
      processorName: artifact.processorName,
      sampleRate: artifact.sampleRate,
    },
    parts,
  };
  build[PLAYABLE_MANIFEST] = new TextEncoder().encode(JSON.stringify(manifest));
  return { build, notes };
}
