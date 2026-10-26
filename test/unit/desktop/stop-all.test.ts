// Stopping everything in BrowserPod's pod before an install: only den-kit's own
// processes stay, whatever the others call themselves, and the stop fails when one
// keeps running. ps, kill, uname, sleep and the read of a process's command line
// are stand-ins here: the script is never let loose on this computer's processes.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { STOP_ALL } from '../../../desktop/page/browserpod.ts';

/** Run STOP_ALL against listings for its passes (SELF: its shell, LISTER: the ps it runs); `exited`: the processes with no command line. */
function stop(listings: string[], exited = ['2']) {
  const dir = mkdtempSync(join(tmpdir(), 'den-kit-stop-all-'));
  listings.forEach((text, i) => writeFileSync(join(dir, `listing-${i + 1}`), text));
  const script = [
    'uname() { echo 5.0.0-cheerpos; }',
    'sleep() { :; }',
    `ps() { n=$(( $(cat '${dir}/passes' 2>/dev/null || echo 0) + 1 )); echo "$n" > '${dir}/passes'; sed -e "s/SELF/$$/" -e "s/LISTER/$BASHPID/" '${dir}/listing-'"$n"; }`,
    `kill() { echo "$*" >> '${dir}/killed'; }`,
    // A process's command line: none for those that have exited.
    `head() { case "$3" in /proc/*/cmdline) p=\${3#/proc/}; p=\${p%/cmdline}; case " ${exited.join(' ')} " in *" $p "*) ;; *) printf x ;; esac ;; *) command head "$@" ;; esac; }`,
    STOP_ALL,
  ].join('\n');
  const r = spawnSync('bash', ['-c', script], {
    env: { ...process.env, HOME: dir, DEN_KIT_RUNNER: '41' },
    encoding: 'utf8',
  });
  const killed = join(dir, 'killed');
  return {
    status: r.status,
    output: r.stdout,
    killed: existsSync(killed) ? readFileSync(killed, 'utf8').trim().split('\n') : [],
  };
}

const own = [
  'PID   COMMAND',
  '    1 init',
  '    2 [kthreadd]',
  ' SELF bash /home/user/.den-kit/run/3.sh',
  '   41 bash -c cd "$1"; DEN_KIT_RUNNER=$$ bash "$2"; printf <<den-kit-exit:nonce:%d>> den-kit',
  'LISTER ps -o pid,args',
];

describe("stopping the pod's processes before an install (BrowserPod)", () => {
  it("stops every process but den-kit's own, one named like den-kit's included", () => {
    const r = stop([
      [...own, '   77 den-kit-exit sleep 30', '   88 node vite'].join('\n'),
      [...own, '   77 den-kit-exit sleep 30'].join('\n'),
      own.join('\n'),
    ]);
    expect(r.killed).toEqual(['-TERM 77', '-TERM 88', '-KILL 77']);
    expect(r.status).toBe(0);
  });

  it('stops a process that names itself in brackets as an exited one shows; one with no command line is not stopped', () => {
    const named = '   77 [work-owned] sleep 30';
    const r = stop([
      [...own, named].join('\n'),
      [...own, named].join('\n'),
      [...own, named].join('\n'),
    ]);
    expect(r.killed).toEqual(['-TERM 77', '-KILL 77']);
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/Still running: 77/);
    // An exited process stays listed in brackets: it is not stopped, and the stop does not fail on it.
    const exited = '   90 [git]';
    const after = stop(
      [[...own, exited].join('\n'), [...own, exited].join('\n'), [...own, exited].join('\n')],
      ['2', '90'],
    );
    expect(after.killed).toEqual([]);
    expect(after.status).toBe(0);
  });

  it('never signals process 0 (that would reach its whole process group)', () => {
    const r = stop(
      [
        [...own, '    0 []'].join('\n'),
        [...own, '    0 []'].join('\n'),
        [...own, '    0 []'].join('\n'),
      ],
      ['2'],
    );
    expect(r.killed).toEqual([]);
    expect(r.status).toBe(0);
  });

  it('fails, naming them, when processes keep running', () => {
    const r = stop([
      [...own, '   77 den-kit-exit sleep 30'].join('\n'),
      [...own, '   77 den-kit-exit sleep 30'].join('\n'),
      [...own, '   77 den-kit-exit sleep 30'].join('\n'),
    ]);
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/Still running: 77/);
  });

  it('does nothing on a machine other than BrowserPod', () => {
    const r = spawnSync(
      'bash',
      ['-c', `uname() { echo 6.1.0; }\nkill() { exit 9; }\n${STOP_ALL}`],
      {
        encoding: 'utf8',
      },
    );
    expect(r.status).toBe(0);
  });
});
