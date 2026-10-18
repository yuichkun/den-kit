import { afterEach, describe, expect, it } from 'vite-plus/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  integrityMatches,
  lockedCodex,
  machoArch,
  stageMacCodex,
} from '../../../scripts/codex-native.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'den-kit-codex-'));
  roots.push(dir);
  return dir;
};

/** A minimal 64-bit Mach-O header for the CPU type. */
function macho(cpu: 'arm64' | 'x64' | 'fat') {
  const header = Buffer.alloc(32);
  if (cpu === 'fat') header.writeUInt32BE(0xcafebabe, 0);
  else {
    header.writeUInt32LE(0xfeedfacf, 0);
    header.writeUInt32LE(cpu === 'arm64' ? 0x0100000c : 0x01000007, 4);
  }
  return header;
}
const integrity = (data: Buffer) => `sha512-${createHash('sha512').update(data).digest('base64')}`;
const lock = (x64: Record<string, string>) => ({
  packages: {
    'node_modules/@openai/codex': { version: '0.160.1' },
    'node_modules/@openai/codex-darwin-arm64': {
      version: '0.160.1-darwin-arm64',
      resolved: 'https://registry.npmjs.org/@openai/codex/-/codex-0.160.1-darwin-arm64.tgz',
      integrity: 'sha512-AAAA',
    },
    'node_modules/@openai/codex-darwin-x64': x64,
  },
});

function project(
  x64Tarball: Buffer,
  x64Lock = {
    version: '0.160.1-darwin-x64',
    resolved: 'https://registry.npmjs.org/@openai/codex/-/codex-0.160.1-darwin-x64.tgz',
    integrity: integrity(x64Tarball),
  },
) {
  const root = temp();
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock(x64Lock)));
  // The host's package as npm installs it.
  const arm = join(root, 'node_modules/@openai/codex-darwin-arm64');
  mkdirSync(join(arm, 'vendor/aarch64-apple-darwin/bin'), { recursive: true });
  writeFileSync(join(arm, 'package.json'), JSON.stringify({ version: '0.160.1-darwin-arm64' }));
  writeFileSync(join(arm, 'vendor/aarch64-apple-darwin/bin/codex'), macho('arm64'));
  writeFileSync(join(arm, 'vendor/aarch64-apple-darwin/codex-package.json'), '{}');
  return root;
}

function tarball(cpu: 'arm64' | 'x64') {
  const dir = temp();
  mkdirSync(join(dir, 'package/vendor/x86_64-apple-darwin/bin'), { recursive: true });
  mkdirSync(join(dir, 'package/vendor/x86_64-apple-darwin/codex-path'), { recursive: true });
  writeFileSync(join(dir, 'package/vendor/x86_64-apple-darwin/bin/codex'), macho(cpu));
  writeFileSync(join(dir, 'package/vendor/x86_64-apple-darwin/codex-path/rg'), macho(cpu));
  execFileSync('tar', ['-czf', join(dir, 'codex.tgz'), '-C', dir, 'package']);
  return readFileSync(join(dir, 'codex.tgz'));
}

describe('native Codex CLI staging', () => {
  it('reads the CPU type from Mach-O headers without running the binary', () => {
    const dir = temp();
    for (const cpu of ['arm64', 'x64', 'fat'] as const) writeFileSync(join(dir, cpu), macho(cpu));
    writeFileSync(join(dir, 'script'), '#!/bin/sh\n');
    expect([
      machoArch(join(dir, 'arm64')),
      machoArch(join(dir, 'x64')),
      machoArch(join(dir, 'fat')),
      machoArch(join(dir, 'script')),
    ]).toEqual(['arm64', 'x64', 'universal', null]);
  });

  it('accepts only a registry tarball pinned to the same Codex version', () => {
    expect(
      lockedCodex(
        lock({
          version: '0.160.1-darwin-x64',
          resolved: 'https://registry.npmjs.org/x.tgz',
          integrity: 'sha512-x',
        }),
        'x64',
      ),
    ).toMatchObject({ base: '0.160.1', version: '0.160.1-darwin-x64' });
    expect(() =>
      lockedCodex(
        lock({
          version: '0.159.0-darwin-x64',
          resolved: 'https://registry.npmjs.org/x.tgz',
          integrity: 'sha512-x',
        }),
        'x64',
      ),
    ).toThrow('does not match');
    expect(() =>
      lockedCodex(
        lock({
          version: '0.160.1-darwin-x64',
          resolved: 'https://example.com/x.tgz',
          integrity: 'sha512-x',
        }),
        'x64',
      ),
    ).toThrow('npm registry');
    expect(() => lockedCodex(lock({}), 'x64')).toThrow('does not pin');
  });

  it('compares sha512 integrity', () => {
    const data = Buffer.from('codex');
    expect(integrityMatches(data, integrity(data))).toBe(true);
    expect(integrityMatches(Buffer.from('other'), integrity(data))).toBe(false);
    expect(integrityMatches(data, 'sha1-abc')).toBe(false);
  });

  it('copies the installed host CLI and downloads the other architecture from the locked tarball', async () => {
    const x64 = tarball('x64');
    const root = project(x64);
    const downloads: string[] = [];
    const download = async (url: string) => {
      downloads.push(url);
      return new Uint8Array(x64);
    };
    expect(
      await stageMacCodex({ root, arch: 'arm64', destination: join(root, 'out/arm64'), download }),
    ).toBe('0.160.1');
    expect(
      await stageMacCodex({ root, arch: 'x64', destination: join(root, 'out/x64'), download }),
    ).toBe('0.160.1');
    expect(downloads).toEqual([
      'https://registry.npmjs.org/@openai/codex/-/codex-0.160.1-darwin-x64.tgz',
    ]);
    expect(machoArch(join(root, 'out/arm64/bin/codex'))).toBe('arm64');
    expect(machoArch(join(root, 'out/x64/bin/codex'))).toBe('x64');
    expect(existsSync(join(root, 'out/x64/codex-path/rg'))).toBe(true);
    // The cache is reused for the next build.
    await stageMacCodex({ root, arch: 'x64', destination: join(root, 'out/again'), download });
    expect(downloads).toHaveLength(1);
  });

  it('refuses a tarball that does not match the lockfile or the architecture', async () => {
    const x64 = tarball('x64');
    const tampered = project(x64, {
      version: '0.160.1-darwin-x64',
      resolved: 'https://registry.npmjs.org/@openai/codex/-/codex-0.160.1-darwin-x64.tgz',
      integrity: integrity(Buffer.from('reviewed')),
    });
    await expect(
      stageMacCodex({
        root: tampered,
        arch: 'x64',
        destination: join(tampered, 'out'),
        download: async () => new Uint8Array(x64),
      }),
    ).rejects.toThrow('does not match package-lock.json');
    const wrong = tarball('arm64');
    const mislabeled = project(wrong);
    await expect(
      stageMacCodex({
        root: mislabeled,
        arch: 'x64',
        destination: join(mislabeled, 'out'),
        download: async () => new Uint8Array(wrong),
      }),
    ).rejects.toThrow('built for arm64');
  });
});
