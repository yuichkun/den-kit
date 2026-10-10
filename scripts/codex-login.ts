// `npm run codex:login`: sign the pinned Codex CLI in for den-kit with your
// ChatGPT account. It uses den-kit's own CODEX_HOME (.codex-home, or
// KIT_CODEX_HOME), creating it first because Codex refuses a missing one. Extra
// arguments go to `codex login` (e.g. `-- --device-auth` on a machine without a browser).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from '../bridge/env.ts';
import { codexEnv, codexHome, isProblem, resolveCodex } from '../bridge/codex/process.ts';

const kit = fileURLToPath(new URL('..', import.meta.url));
loadEnvFile(join(kit, '.env'));
const command = resolveCodex(kit);
if (isProblem(command)) { console.error(`${command.error}\n→ ${command.fix}`); process.exit(1); }
const home = codexHome(kit);
mkdirSync(home.path, { recursive: true });
console.log(`Signing Codex in for den-kit (CODEX_HOME=${home.isolated ? '.codex-home' : home.path}).\nCodex opens ChatGPT sign-in in your browser…\n`);
const child = spawn(command.command, [...command.args, 'login', ...process.argv.slice(2)], { stdio: 'inherit', env: codexEnv(home.path) });
child.on('error', error => { console.error(`Could not run Codex: ${error.message}`); process.exit(1); });
child.on('exit', code => {
  if (code === 0) console.log('\nSigned in. If `npm run dev` is running, den-kit picks this up by itself (the LLM status turns green).\nCheck everything with `npm run doctor -- --deep`.');
  process.exit(code ?? 1);
});
