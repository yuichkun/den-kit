// Open only the isolated prototype bundle; no installed den-kit is replaced.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const app = join(
  root,
  'release-link',
  process.arch === 'arm64' ? 'mac-arm64' : 'mac',
  'den-kit Link Prototype.app',
);
if (process.platform !== 'darwin' || !existsSync(app))
  throw new Error('Build the prototype first: vp run desktop:link:package');
execFileSync('/usr/bin/open', ['-W', app], { stdio: 'inherit' });
