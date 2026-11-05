// Open only the isolated prototype bundle; no installed den-kit is replaced.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requirePackagedLinkApp } from './link-paths.ts';
const root = fileURLToPath(new URL('..', import.meta.url));
if (process.platform !== 'darwin') throw new Error('Run the packaged Link prototype on macOS.');
const app = requirePackagedLinkApp(root);
if (process.argv.includes('--check')) console.log(`Link prototype ready: ${app}`);
else execFileSync('/usr/bin/open', ['-W', app], { stdio: 'inherit' });
