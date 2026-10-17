import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRelease, tagsFromRemote, type ReleaseFacts } from '../../scripts/release-check.ts';
import { parseVersion, prepareVersion } from '../../scripts/release-version.ts';
import { planPublish, releaseFiles } from '../../scripts/release-publish.ts';
import { packageNames, parseUpdateInfo } from '../../scripts/check-desktop-artifacts.ts';
import { releasePullRequest, type PullRequestSummary } from '../../scripts/release-pr.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const facts = (overrides: Partial<ReleaseFacts> = {}): ReleaseFacts => ({
  branch: 'release/v0.2.0', sha: 'a'.repeat(40), sameTree: true,
  versions: { 'package.json': '0.2.0', 'package-lock.json': '0.2.0', 'package-lock.json root': '0.2.0' },
  tags: { 'v0.1.0': 'b'.repeat(40) },
  changelog: '# Changelog\n\n## 0.2.0 — 2026-11-01\n\n- Changes.\n',
  ...overrides,
});

describe('release checks', () => {
  it('accepts the reviewed release of a newer version', () => {
    expect(checkRelease(facts())).toBe('0.2.0');
    expect(checkRelease(facts({ tags: { 'v0.2.0': 'a'.repeat(40) } }))).toBe('0.2.0');
  });

  it.each([
    [{ sameTree: false }, 'differs from the reviewed PR head'],
    [{ branch: 'feature/x' }, 'release/vX.Y.Z'],
    [{ branch: 'release/v1.0.0-beta.1' }, 'plain release version'],
    [{ versions: { 'package.json': '0.1.9' } }, 'does not match'],
    [{ changelog: '## Unreleased\n' }, 'CHANGELOG.md'],
    [{ tags: { 'v0.2.0': 'c'.repeat(40) } }, 'different commit'],
    [{ tags: { 'v0.10.0': 'c'.repeat(40) } }, 'supersedes this release'],
  ] as const)('refuses %o', (overrides, message) => {
    expect(() => checkRelease(facts(overrides as Partial<ReleaseFacts>))).toThrow(message);
  });

  it('reads peeled annotated tags from ls-remote', () => {
    expect(tagsFromRemote(`${'1'.repeat(40)}\trefs/tags/v0.1.0\n${'2'.repeat(40)}\trefs/tags/v0.1.0^{}\n${'3'.repeat(40)}\trefs/tags/v0.2.0\n`))
      .toEqual({ 'v0.1.0': '2'.repeat(40), 'v0.2.0': '3'.repeat(40) });
  });

  it('prepares the app version without touching anything else', () => {
    const root = mkdtempSync(join(tmpdir(), 'den-kit-release-')); roots.push(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'den-kit', version: '0.1.0', dependencies: { vue: '3.5.43' } }));
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ name: 'den-kit', version: '0.1.0', packages: { '': { name: 'den-kit', version: '0.1.0' }, 'node_modules/vue': { version: '3.5.43' } } }));
    prepareVersion(root, '0.1.1');
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))).toEqual({ name: 'den-kit', version: '0.1.1', dependencies: { vue: '3.5.43' } });
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
    expect([lock.version, lock.packages[''].version, lock.packages['node_modules/vue'].version]).toEqual(['0.1.1', '0.1.1', '3.5.43']);
    expect(() => prepareVersion(root, '1.0')).toThrow('plain release version');
    expect(parseVersion('01.2.3')).toBeUndefined();
  });
});

describe('release publication', () => {
  const files = ['den-kit-0.2.0-arm64.dmg', 'den-kit-0.2.0-arm64.zip', 'latest-mac.yml'].map(name => `assets/${name}`);

  it('publishes only the packages and the update feed', () => {
    expect(releaseFiles(['den-kit-0.2.0-arm64.zip', 'builder-debug.yml', 'latest-mac.yml', 'den-kit-0.2.0-arm64.zip.blockmap', 'mac-arm64', 'den-kit-0.2.0-x64.dmg']))
      .toEqual(['den-kit-0.2.0-arm64.zip', 'den-kit-0.2.0-arm64.zip.blockmap', 'den-kit-0.2.0-x64.dmg', 'latest-mac.yml']);
  });

  it('creates a draft, attaches every file and then publishes', () => {
    expect(planPublish('v0.2.0', null, files)).toEqual([{ kind: 'create' }, { kind: 'upload', files }, { kind: 'publish' }]);
  });

  it('replaces all assets of an unfinished draft so the feed matches its zips', () => {
    expect(planPublish('v0.2.0', { isDraft: true, assets: ['den-kit-0.2.0-arm64.zip'] }, files)).toEqual([{ kind: 'upload', files }, { kind: 'publish' }]);
  });

  it('leaves a complete published release alone and refuses to patch an incomplete one', () => {
    expect(planPublish('v0.2.0', { isDraft: false, assets: files.map(file => file.slice('assets/'.length)) }, files)).toEqual([]);
    expect(() => planPublish('v0.2.0', { isDraft: false, assets: ['den-kit-0.2.0-arm64.dmg'] }, files)).toThrow('release a new version');
  });
});

describe('update feed', () => {
  it('reads both architectures from latest-mac.yml', () => {
    const text = `version: 0.2.0
files:
  - url: den-kit-0.2.0-arm64.zip
    sha512: abc+/=
    size: 123
  - url: den-kit-0.2.0-x64.zip
    sha512: 'def'
    size: 456
path: den-kit-0.2.0-arm64.zip
sha512: abc+/=
releaseDate: '2026-11-01T00:00:00.000Z'
`;
    expect(parseUpdateInfo(text)).toEqual({ version: '0.2.0', files: [
      { url: 'den-kit-0.2.0-arm64.zip', sha512: 'abc+/=', size: 123 },
      { url: 'den-kit-0.2.0-x64.zip', sha512: 'def', size: 456 },
    ] });
    expect(packageNames('0.2.0')).toEqual(['den-kit-0.2.0-arm64.dmg', 'den-kit-0.2.0-arm64.zip', 'den-kit-0.2.0-x64.dmg', 'den-kit-0.2.0-x64.zip']);
  });
});

describe('release pull request of a push to main', () => {
  const sha = 'a'.repeat(40);
  const repository = 'yuichkun/den-kit';
  type Changes = Partial<Omit<PullRequestSummary, 'head'>> & { head?: Partial<PullRequestSummary['head']> };
  const pull = ({ head, ...changes }: Changes = {}): PullRequestSummary => ({
    number: 6, merged_at: '2026-10-17T07:00:00Z', merge_commit_sha: sha, base: { ref: 'main' },
    head: { ref: 'release/v0.1.0', sha: 'b'.repeat(40), repo: { full_name: repository }, ...head },
    ...changes,
  });

  it('finds the merged release pull request whose merge commit was pushed', () => {
    expect(releasePullRequest([pull()], sha, repository)).toEqual({ number: 6, branch: 'release/v0.1.0', reviewed: 'b'.repeat(40) });
  });

  it('ignores other pull requests that merely contain the commit', () => {
    expect(releasePullRequest([pull({ number: 7, merged_at: null, merge_commit_sha: null }), pull()], sha, repository)?.number).toBe(6);
  });

  const ignored: [string, Changes][] = [
    ['an ordinary merge', { head: { ref: 'claude/feature' } }],
    ['a release branch from a fork', { head: { repo: { full_name: 'someone/den-kit' } } }],
    ['a pull request from a deleted fork', { head: { repo: null } }],
    ['a merge into another branch', { base: { ref: 'next' } }],
    ['a pull request merged as another commit', { merge_commit_sha: 'c'.repeat(40) }],
    ['an unmerged pull request', { merged_at: null }],
  ];
  it.each(ignored)('publishes nothing for %s', (_, changes) => {
    expect(releasePullRequest([pull(changes)], sha, repository)).toBeNull();
  });
});
