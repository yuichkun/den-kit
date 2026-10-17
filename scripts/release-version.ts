// Release PR preparation, following yuichkun/den's release-PR model.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function parseVersion(version: string): [number, number, number] | undefined {
  const parts = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version)?.slice(1).map(Number);
  return parts?.length === 3 && parts.every(Number.isSafeInteger) ? parts as [number, number, number] : undefined;
}

/** Sets the app version in package.json and package-lock.json. It does not tag, commit, push or publish. */
export function prepareVersion(root: string, version: string) {
  if (!parseVersion(version) || version === '0.0.0') throw new Error('Use a plain release version greater than 0.0.0 (for example 0.1.1).');
  const read = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  const pkg = read('package.json');
  const lock = read('package-lock.json');
  if (pkg.name !== 'den-kit' || lock.packages?.['']?.name !== pkg.name) throw new Error('Unexpected package identity.');
  pkg.version = lock.version = lock.packages[''].version = version;
  for (const [path, data] of [['package.json', pkg], ['package-lock.json', lock]] as const) {
    writeFileSync(resolve(root, path), JSON.stringify(data, null, 2) + '\n');
  }
}

if (import.meta.main) {
  try {
    const version = process.argv[2] ?? '';
    prepareVersion(resolve(import.meta.dirname, '..'), version);
    console.log(`Prepared ${version}. Add its CHANGELOG.md section and review the diff; no tag or publication was created.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
