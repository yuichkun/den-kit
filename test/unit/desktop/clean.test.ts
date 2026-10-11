import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanDesktopData } from '../../../scripts/clean-desktop.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function setup() {
  const home = mkdtempSync(join(tmpdir(), 'den-kit-clean-')); roots.push(home);
  const directory = join(home, 'Library', 'Application Support', 'den-kit');
  for (const file of ['codex/auth.json', 'Local Storage/leveldb/patch', 'IndexedDB/assets', 'settings.json']) {
    const path = join(directory, file); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, 'fixture');
  }
  const neighbor = join(home, 'Library', 'Application Support', 'other-app');
  mkdirSync(neighbor); writeFileSync(join(neighbor, 'keep'), 'keep');
  return { home, directory, neighbor, platform: 'darwin' as const, processList: () => '123 /usr/bin/unrelated\n' };
}

describe('desktop data cleanup', () => {
  it('removes the complete app profile while preserving neighboring app data', () => {
    const options = setup();
    expect(cleanDesktopData(options)).toEqual({ directory: options.directory, removed: true });
    expect(existsSync(options.directory)).toBe(false);
    expect(existsSync(join(options.neighbor, 'keep'))).toBe(true);
    expect(cleanDesktopData(options).removed).toBe(false);
  });
  it.each([
    '123 /Applications/den-kit.app/Contents/MacOS/den-kit',
    '123 /project/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /project/.desktop-build/app',
  ])('refuses cleanup while the app runs: %s', process => {
    const options = setup();
    expect(() => cleanDesktopData({ ...options, processList: () => process })).toThrow('Quit den-kit');
    expect(existsSync(join(options.directory, 'codex/auth.json'))).toBe(true);
  });
  it('does not delete anything if process inspection fails', () => {
    const options = setup();
    expect(() => cleanDesktopData({ ...options, processList: () => { throw new Error('Process list unavailable'); } })).toThrow();
    expect(existsSync(options.directory)).toBe(true);
  });
  it('previews the target without deleting data or querying processes', () => {
    const options = setup();
    expect(cleanDesktopData({ ...options, dryRun: true, processList: () => { throw new Error('Must not run'); } })).toEqual({ directory: options.directory, removed: false });
    expect(existsSync(options.directory)).toBe(true);
  });
  it('rejects a symbolic link and preserves its target', () => {
    const options = setup(); rmSync(options.directory, { recursive: true }); symlinkSync(options.neighbor, options.directory);
    expect(() => cleanDesktopData(options)).toThrow('symbolic link');
    expect(existsSync(join(options.neighbor, 'keep'))).toBe(true);
  });
});
