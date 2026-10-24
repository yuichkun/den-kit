import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { packagedMacApp } from './desktop-paths.ts';
const root = fileURLToPath(new URL('..', import.meta.url));
const app = packagedMacApp(root);
if (process.platform !== 'darwin' || !existsSync(app))
  throw new Error('Build the macOS app first: vp run desktop:package');
// Keep the launcher alive until the app quits: what started it (a sandbox, a task
// runner) may give the app a temporary network proxy that ends with the launcher.
execFileSync('/usr/bin/open', ['-W', app], { stdio: 'inherit' });
