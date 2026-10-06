// `npm run kit:doctor`: checks the local setup step by step and says how to fix each problem.
// CP2a adds the AI bridge port and Jev (key present, masked; three tiny live requests).
// The Codex checks arrive with CP2b.
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadEnvFile, maskSecret } from '../bridge/env.ts';
import { JevClient, JEV_MODEL } from '../bridge/jev.ts';

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

// 3. Ports (editor and AI bridge)
const portFree = (port: number) => new Promise<boolean>(resolve => { const s = createServer(); s.once('error', () => resolve(false)); s.listen(port, '127.0.0.1', () => s.close(() => resolve(true))); });
for (const [name, env, fallback] of [['editor port', 'KIT_PORT', 5180], ['AI bridge port', 'KIT_BRIDGE_PORT', 5181]] as const) {
  const port = Number(process.env[env] ?? fallback);
  const free = await portFree(port);
  report(free ? 'PASS' : 'WARN', `${name} ${port}`, free ? 'free' : 'in use', free ? undefined : `Another kit:dev may be running; stop it or set ${env}.`);
}

// 4. Jev (TypeSafe System One): key from the environment or kit/.env, never printed.
loadEnvFile(join(kit, '.env'));
const key = process.env.TYPESAFE_API_KEY;
if (!key) report('WARN', 'Jev key', 'not set — the fast path will use the built-in lexicon only', 'Add `TYPESAFE_API_KEY=…` to kit/.env (this file is git-ignored), then rerun `npm run kit:doctor`.');
else {
  report('PASS', 'Jev key', maskSecret(key));
  const jev = new JevClient({ apiKey: key, baseUrl: process.env.KIT_JEV_BASE });
  const times: number[] = [];
  let failure: string | undefined;
  let warning: string | undefined;
  for (let i = 0; i < 3 && !failure; i++) {
    const r = await jev.ask({ state: 'den-kit doctor', questions: { ping: { type: 'noul', instructions: 'Is this message a connectivity check?' } } }, { budgetMs: 8000 });
    if (r.ok) { times.push(r.ms); warning ??= r.modelWarning; } else failure = `${r.error.kind}: ${r.error.message}`;
  }
  if (failure) {
    const fix = /^auth/.test(failure) ? 'The key was rejected: check TYPESAFE_API_KEY in kit/.env (no quotes or spaces).'
      : /^(network|timeout)/.test(failure) ? 'Check the network / proxy; den-kit still works with the lexicon only.'
      : /^busy/.test(failure) ? 'Jev is rate-limited or overloaded right now; try again in a minute.' : undefined;
    report('FAIL', 'Jev request', failure, fix);
  } else {
    const sorted = [...times].sort((a, b) => a - b);
    report(warning ? 'WARN' : 'PASS', 'Jev request', `${JEV_MODEL} · ${times.join(' / ')} ms (median ${sorted[1]} ms)`, warning);
  }
}

const width = Math.max(...results.map(r => r.name.length));
for (const r of results) console.log(`${r.status.padEnd(4)}  ${r.name.padEnd(width)}  ${r.detail}${r.fix && r.status !== 'PASS' ? `\n      → ${r.fix}` : ''}`);
const failed = results.filter(r => r.status === 'FAIL').length;
console.log(failed ? `\n${failed} problem(s) to fix.` : '\nAll checks passed. Start with `npm run kit:dev`.');
process.exit(failed ? 1 : 0);
