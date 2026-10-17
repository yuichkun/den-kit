// Publishes the signed macOS packages as a GitHub Release. Safe to re-run: a draft is completed, a published
// release is only verified. Assets go to a draft first because published releases are immutable.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

export interface ExistingRelease { isDraft: boolean; assets: string[] }
export type PublishStep = { kind: 'create' } | { kind: 'upload'; files: string[] } | { kind: 'publish' };

export function releaseFiles(names: string[]): string[] {
  return names.filter(name => /\.(dmg|zip|blockmap)$/.test(name) || name === 'latest-mac.yml').sort();
}

export function planPublish(tag: string, existing: ExistingRelease | null, files: string[]): PublishStep[] {
  if (!existing) return [{ kind: 'create' }, { kind: 'upload', files }, { kind: 'publish' }];
  if (existing.isDraft) {
    // Replace every asset: an earlier attempt may have uploaded packages from a different build, and
    // latest-mac.yml must describe exactly the zips beside it.
    return [{ kind: 'upload', files }, { kind: 'publish' }];
  }
  const missing = files.map(file => basename(file)).filter(name => !existing.assets.includes(name));
  if (missing.length) throw new Error(`${tag} is already published without ${missing.join(', ')}. Published releases cannot be changed; release a new version.`);
  return [];
}

function main() {
  const dir = process.argv[2];
  const { VERSION = '', PR = '' } = process.env;
  if (!dir || !/^\d+\.\d+\.\d+$/.test(VERSION) || !/^\d+$/.test(PR)) throw new Error('Usage: VERSION=X.Y.Z PR=<release pull request> node scripts/release-publish.ts <assets-directory>');
  const tag = `v${VERSION}`;
  const files = releaseFiles(readdirSync(dir)).map(name => join(dir, name));
  if (!files.some(file => file.endsWith('latest-mac.yml'))) throw new Error('latest-mac.yml is missing; updates would not find this release.');
  const gh = (...args: string[]) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  // The release pull request's title and description become the release title and notes. They are read as data.
  const { title, body } = JSON.parse(gh('pr', 'view', PR, '--json', 'title,body')) as { title: string; body: string };
  let existing: ExistingRelease | null = null;
  try {
    const found = JSON.parse(gh('release', 'view', tag, '--json', 'isDraft,assets')) as { isDraft: boolean; assets: { name: string }[] };
    existing = { isDraft: found.isDraft, assets: found.assets.map(asset => asset.name) };
  } catch { existing = null; }
  for (const step of planPublish(tag, existing, files)) {
    if (step.kind === 'create') {
      const notes = join(mkdtempSync(join(tmpdir(), 'den-kit-release-')), 'notes.md');
      writeFileSync(notes, `${body.trim() || `See CHANGELOG.md for ${tag}.`}\n`);
      gh('release', 'create', tag, '--draft', '--verify-tag', '--title', title.trim() || tag, '--notes-file', notes);
    }
    if (step.kind === 'upload') gh('release', 'upload', tag, ...step.files, '--clobber');
    if (step.kind === 'publish') gh('release', 'edit', tag, '--draft=false', '--latest');
  }
  console.log(`${tag} is published with ${files.length} files.`);
}

if (import.meta.main) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
