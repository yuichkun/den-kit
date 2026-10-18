import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { packagedMacApp } from './desktop-paths.ts';
const root = fileURLToPath(new URL('..', import.meta.url));
const app = packagedMacApp(root);
if (process.platform !== 'darwin' || !existsSync(app))
  throw new Error('Build the macOS app first: npm run desktop:package');
// Keep the launcher alive: npm wrappers may own a temporary network proxy that
// the app inherits. Detaching would leave the app pointing at a closed proxy.
execFileSync('/usr/bin/open', ['-W', app], { stdio: 'inherit' });
