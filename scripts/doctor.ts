// `npm run kit:doctor`: checks the local setup step by step and says how to fix each problem.
// CP1 checks only; CP2 (Codex / Jev) checks are added with the bridge.
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

type Status = 'PASS' | 'WARN' | 'FAIL' | 'SKIP';
const kit = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const den = dirname(kit);
const results: Array<{ status: Status; name: string; detail: string; fix?: string }> = [];
const report = (status: Status, name: string, detail: string, fix?: string) => { results.push({ status, name, detail, fix }); };
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

// 1. Node
const [major, minor] = process.versions.node.split('.').map(Number) as [number, number];
if (major >= 24 || (major === 22 && minor >= 18)) report(major >= 24 ? 'PASS' : 'WARN', 'Node.js', `v${process.versions.node}`, major >= 24 ? undefined : 'den targets Node 24 (see .node-version); 22.18+ works for den-kit.');
else report('FAIL', 'Node.js', `v${process.versions.node}`, 'Install Node 24 (e.g. `fnm install 24` or `nvm install 24`).');

// 2. Dependencies
const core = join(den, 'node_modules/@unworklet/core/package.json');
if (!existsSync(core)) report('FAIL', 'den dependencies', 'missing node_modules at the repo root', 'Run `npm ci` in the den repo root.');
else { const v = json(core).version; report(v === '0.4.1' ? 'PASS' : 'FAIL', '@unworklet/core', v, v === '0.4.1' ? undefined : 'den-kit is pinned to unworklet 0.4.1: run `npm ci` at the repo root.'); }
if (existsSync(join(kit, '@unworklet')) || existsSync(join(kit, 'node_modules/@unworklet/core'))) report('FAIL', 'single @unworklet/core', 'kit/node_modules has its own copy', 'Delete kit/node_modules/@unworklet and run `npm run kit:setup`.');
for (const [name, path] of [['vue', 'node_modules/vue/package.json'], ['@vue-flow/core', 'node_modules/@vue-flow/core/package.json'], ['vite', 'node_modules/vite/package.json']] as const) {
  report(existsSync(join(kit, path)) ? 'PASS' : 'FAIL', name, existsSync(join(kit, path)) ? json(join(kit, path)).version : 'not installed', 'Run `npm run kit:setup` from the repo root.');
}

// 3. Port
const port = Number(process.env.KIT_PORT ?? 5180);
const free = await new Promise<boolean>(resolve => { const s = createServer(); s.once('error', () => resolve(false)); s.listen(port, '127.0.0.1', () => s.close(() => resolve(true))); });
report(free ? 'PASS' : 'WARN', `port ${port}`, free ? 'free' : 'in use', free ? undefined : 'Another den-kit may be running; stop it or set KIT_PORT.');

const width = Math.max(...results.map(r => r.name.length));
for (const r of results) console.log(`${r.status.padEnd(4)}  ${r.name.padEnd(width)}  ${r.detail}${r.fix && r.status !== 'PASS' ? `\n      → ${r.fix}` : ''}`);
const failed = results.filter(r => r.status === 'FAIL').length;
console.log(failed ? `\n${failed} problem(s) to fix.` : '\nAll checks passed. Start with `npm run kit:dev`.');
process.exit(failed ? 1 : 0);
