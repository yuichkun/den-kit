// Shows or deletes what the usage receiver keeps for one install ID, for a person who asks with the
// ID that Settings shows them (docs/usage-receiver.md, Requests to see or delete data):
// `vp run data show <id>` or `vp run data delete <id>` in receiver/, signed in to Cloudflare with
// wrangler. It prints what the receiver keeps for the ID: after a delete, what is left, which is
// nothing.
import { spawnSync } from 'node:child_process';
import { dataRequest } from './store.ts';

const [action = '', installId = ''] = process.argv.slice(2);
let show: string;
let remove: string | null;
try {
  show = dataRequest('show', installId);
  remove = action === 'show' ? null : dataRequest(action, installId);
} catch (error) {
  console.error((error as Error).message);
  process.exit(2);
}

function run(sql: string): Array<{ results: unknown[] }> {
  const wrangler = spawnSync(
    'wrangler',
    ['d1', 'execute', 'den-kit-usage', '--remote', '--json', '--command', sql],
    { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' },
  );
  if (wrangler.status !== 0) process.exit(wrangler.status ?? 1);
  return JSON.parse(wrangler.stdout);
}

if (remove) run(remove);
const [install, events] = run(show);
console.log(
  JSON.stringify({ install: install?.results[0] ?? null, events: events?.results ?? [] }, null, 2),
);
