// Release verification adapted from yuichkun/den: publish exactly the reviewed commit, never an older version.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseVersion } from './release-version.ts';

export interface ReleaseFacts {
  branch: string;
  sha: string;
  sameTree: boolean;
  versions: Record<string, string>;
  tags: Record<string, string>;
  changelog: string;
}

export function checkRelease({
  branch,
  sha,
  sameTree,
  versions,
  tags,
  changelog,
}: ReleaseFacts): string {
  assert(
    sameTree,
    'The merge differs from the reviewed PR head. Update the release branch from main and review it again.',
  );
  assert(branch.startsWith('release/v'), 'Expected release/vX.Y.Z.');
  const version = branch.slice('release/v'.length);
  const parsed = parseVersion(version);
  assert(parsed && version !== '0.0.0', 'Expected a plain release version greater than 0.0.0.');
  assert(Object.keys(versions).length > 0, 'No package versions found.');
  for (const [path, actual] of Object.entries(versions))
    assert.equal(
      actual,
      version,
      `${path} does not match ${branch}. Run npm run release:version -- ${version}.`,
    );
  assert(
    changelog.split('\n').some(line => line.startsWith(`## ${version} — `)),
    'Add the release section to CHANGELOG.md.',
  );
  assert(
    !tags[`v${version}`] || tags[`v${version}`] === sha,
    `v${version} already points to a different commit.`,
  );
  for (const tag of Object.keys(tags)) {
    const other = tag.startsWith('v') ? parseVersion(tag.slice(1)) : undefined;
    if (!other) continue;
    const comparison = other[0] - parsed[0] || other[1] - parsed[1] || other[2] - parsed[2];
    assert(
      comparison <= 0,
      `${tag} supersedes this release; refusing to publish an older version.`,
    );
  }
  return version;
}

export function tagsFromRemote(output: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const line of output.trim().split('\n').filter(Boolean)) {
    const [sha, ref] = line.split('\t') as [string, string];
    const name = ref.replace(/^refs\/tags\//, '');
    if (name.endsWith('^{}')) tags[name.slice(0, -3)] = sha;
    else tags[name] ??= sha;
  }
  return tags;
}

export function packageVersions(root: string): Record<string, string> {
  const read = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  const pkg = read('package.json');
  assert.equal(pkg.name, 'den-kit');
  assert.equal(pkg.repository?.url, 'git+https://github.com/yuichkun/den-kit.git');
  const lock = read('package-lock.json');
  return {
    'package.json': pkg.version,
    'package-lock.json': lock.version,
    'package-lock.json root': lock.packages[''].version,
  };
}

function main() {
  const { BRANCH = '', SHA = '', REVIEWED = '', GITHUB_OUTPUT } = process.env;
  for (const value of [SHA, REVIEWED])
    assert(/^[a-f0-9]{40}$/.test(value), 'Missing or invalid release commit.');
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  assert.equal(git('rev-parse', 'HEAD'), SHA, 'Check out the merge commit.');
  git('fetch', 'origin', 'main', REVIEWED);
  git('merge-base', '--is-ancestor', SHA, 'origin/main');
  const version = checkRelease({
    branch: BRANCH,
    sha: SHA,
    sameTree: git('rev-parse', `${SHA}^{tree}`) === git('rev-parse', `${REVIEWED}^{tree}`),
    versions: packageVersions('.'),
    tags: tagsFromRemote(git('ls-remote', '--tags', 'origin', 'refs/tags/v*')),
    changelog: readFileSync('CHANGELOG.md', 'utf8'),
  });
  assert.equal(
    git('status', '--porcelain', '--untracked-files=no'),
    '',
    'Tracked source changed during verification.',
  );
  if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `version=${version}\n`);
  console.log(`Verified release v${version} at ${SHA}.`);
}

if (import.meta.main) main();
