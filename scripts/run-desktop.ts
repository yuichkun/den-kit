import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const app = join(root, `release/mac${process.arch === 'arm64' ? '-arm64' : ''}/den-kit.app`);
if (process.platform !== 'darwin' || !existsSync(app)) throw new Error('Build the macOS app first: npm run desktop:package');
execFileSync('/usr/bin/open', [app]);
