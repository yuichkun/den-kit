import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, closeSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type MacArch = 'arm64' | 'x64';
export const MAC_ARCHES: MacArch[] = ['arm64', 'x64'];
const TRIPLES: Record<MacArch, string> = { arm64: 'aarch64-apple-darwin', x64: 'x86_64-apple-darwin' };

export interface LockedPackage { version: string; resolved: string; integrity: string }

/** The exact native Codex package recorded in package-lock.json, so a build cannot drift from the reviewed lock. */
export function lockedCodex(lock: { packages?: Record<string, Partial<LockedPackage>> }, arch: MacArch): LockedPackage & { base: string } {
  const base = lock.packages?.['node_modules/@openai/codex']?.version;
  const entry = lock.packages?.[`node_modules/@openai/codex-darwin-${arch}`];
  if (!base || !entry?.version || !entry.resolved || !entry.integrity) throw new Error(`package-lock.json does not pin the Codex CLI for macOS ${arch}. Run npm install and commit the lockfile.`);
  if (entry.version !== `${base}-darwin-${arch}`) throw new Error(`The locked Codex CLI for macOS ${arch} (${entry.version}) does not match @openai/codex ${base}.`);
  if (!entry.resolved.startsWith('https://registry.npmjs.org/')) throw new Error(`The locked Codex CLI for macOS ${arch} must come from the npm registry.`);
  return { base, version: entry.version, resolved: entry.resolved, integrity: entry.integrity };
}

export function integrityMatches(data: Uint8Array, integrity: string): boolean {
  const expected = integrity.split(/\s+/).find(value => value.startsWith('sha512-'));
  return !!expected && createHash('sha512').update(data).digest('base64') === expected.slice('sha512-'.length);
}

/** Reads the Mach-O header without running the binary (an x64 binary cannot be executed everywhere). */
export function machoArch(file: string): MacArch | 'universal' | null {
  const header = Buffer.alloc(8);
  const fd = openSync(file, 'r');
  try { if (readSync(fd, header, 0, 8, 0) < 8) return null; } finally { closeSync(fd); }
  const magic = header.readUInt32BE(0);
  if (magic === 0xcafebabe || magic === 0xcafebabf) return 'universal';
  if (header.readUInt32LE(0) !== 0xfeedfacf) return null;
  const cpu = header.readUInt32LE(4);
  return cpu === 0x0100000c ? 'arm64' : cpu === 0x01000007 ? 'x64' : null;
}

interface StageOptions {
  root: string;
  arch: MacArch;
  destination: string;
  cache?: string;
  download?: (url: string) => Promise<Uint8Array>;
}

/** Copies the native Codex CLI for one macOS architecture into `destination` (bin/codex and its helpers). */
export async function stageMacCodex({ root, arch, destination, cache = join(root, 'node_modules/.cache/den-kit'), download = fetchBytes }: StageOptions): Promise<string> {
  const locked = lockedCodex(JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')), arch);
  const triple = TRIPLES[arch];
  const installed = join(root, `node_modules/@openai/codex-darwin-${arch}`);
  let vendor = join(installed, 'vendor', triple);
  if (!existsSync(join(installed, 'package.json')) || JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8')).version !== locked.version) {
    // npm installs only the host architecture; fetch the other one from the exact locked tarball.
    const unpacked = join(cache, `codex-${locked.version}`);
    vendor = join(unpacked, 'package', 'vendor', triple);
    if (!existsSync(join(vendor, 'bin', 'codex'))) {
      const data = await download(locked.resolved);
      if (!integrityMatches(data, locked.integrity)) throw new Error(`The downloaded Codex CLI for macOS ${arch} does not match package-lock.json.`);
      mkdirSync(cache, { recursive: true });
      const work = mkdtempSync(join(cache, `codex-${arch}-`));
      try {
        writeFileSync(join(work, 'package.tgz'), data);
        execFileSync('tar', ['-xzf', join(work, 'package.tgz'), '-C', work]);
        rmSync(unpacked, { recursive: true, force: true });
        mkdirSync(unpacked);
        renameSync(join(work, 'package'), join(unpacked, 'package'));
      } finally { rmSync(work, { recursive: true, force: true }); }
    }
  }
  const binary = join(vendor, 'bin', 'codex');
  if (!existsSync(binary)) throw new Error(`The Codex CLI for macOS ${arch} is missing from ${dirname(dirname(binary))}.`);
  if (machoArch(binary) !== arch) throw new Error(`The Codex CLI staged for macOS ${arch} is built for ${machoArch(binary) ?? 'an unknown architecture'}.`);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(dirname(destination), { recursive: true });
  // Keep the native CLI's relative layout, including its helper binaries and notices.
  cpSync(vendor, destination, { recursive: true });
  chmodSync(join(destination, 'bin', 'codex'), 0o755);
  return locked.base;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Downloading ${url} failed with HTTP ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}
