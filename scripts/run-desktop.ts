import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { packagedMacApp } from './desktop-paths.ts';
const root = fileURLToPath(new URL('..', import.meta.url));
const app = packagedMacApp(root);
if (process.platform !== 'darwin' || !existsSync(app)) throw new Error('Build the macOS app first: npm run desktop:package');
execFileSync('/usr/bin/open', [app]);
