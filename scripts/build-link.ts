// Explicit prototype build: fetch verified SDK sources and compile a separate
// helper executable. Ordinary installs and desktop builds do not invoke this.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export function buildLink(): string {
  const probe = spawnSync('cmake', ['--version'], { encoding: 'utf8' });
  const version = /cmake version (\d+)\.(\d+)/.exec(probe.stdout ?? '');
  if (
    probe.error ||
    probe.status !== 0 ||
    !version ||
    Number(version[1]) < 3 ||
    (Number(version[1]) === 3 && Number(version[2]) < 24)
  ) {
    throw new Error(
      'The Link prototype needs CMake 3.24+ and a C++17 compiler. On macOS, run xcode-select --install and brew install cmake, then retry.',
    );
  }
  const build = join(root, '.link-build/cmake');
  for (const args of [
    ['-S', join(root, 'desktop/link'), '-B', build, '-DCMAKE_BUILD_TYPE=Release'],
    ['--build', build, '--config', 'Release', '--parallel', '2'],
  ]) {
    const result = spawnSync('cmake', args, { cwd: root, stdio: 'inherit' });
    if (result.error || result.status !== 0) {
      throw new Error(
        'Link helper build failed. Check the CMake output above; the first build needs GitHub access and a C++17 toolchain (macOS: xcode-select --install).',
      );
    }
  }
  const executable = join(
    root,
    '.link-build/bin',
    process.platform === 'win32' ? 'den-kit-link.exe' : 'den-kit-link',
  );
  if (!existsSync(executable)) throw new Error(`Link helper was not produced at ${executable}`);
  return executable;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Link prototype helper built: ${buildLink()}`);
}
