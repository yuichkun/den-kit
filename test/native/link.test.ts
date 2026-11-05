// Exercises the real helper process. Network tests join the local Link session,
// so opt in only on an isolated machine with music apps closed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

interface State {
  enabled: boolean;
  peers: number;
  tempo: number;
  beat: number;
  phase: number;
  playing: boolean;
  startStopSync: boolean;
  timeUs: number;
  startTimeUs: number;
  transportTimeUs: number;
}
type Reply = { id: number; ok: true; state: State } | { id: number; ok: false; error: string };
const executable = fileURLToPath(
  new URL(
    `../../.link-build/bin/den-kit-link${process.platform === 'win32' ? '.exe' : ''}`,
    import.meta.url,
  ),
);

function helper() {
  const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map<
    number,
    { resolve: (reply: Reply) => void; reject: (error: Error) => void }
  >();
  let sequence = 0;
  let stderr = '';
  child.stderr.on('data', data => {
    stderr += String(data);
  });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    const reply = JSON.parse(line) as Reply;
    pending.get(reply.id)?.resolve(reply);
    pending.delete(reply.id);
  });
  const rejectAll = (error: Error) => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  child.on('error', rejectAll);
  child.on('exit', code => rejectAll(new Error(`Link helper exited (${code}): ${stderr}`)));
  async function request(command: string): Promise<Reply> {
    const id = ++sequence;
    return await new Promise<Reply>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Link request timed out: ${command}; ${stderr}`));
      }, 5000);
      pending.set(id, {
        resolve: reply => {
          clearTimeout(timeout);
          resolve(reply);
        },
        reject: error => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      child.stdin.write(`${id} ${command}\n`);
    });
  }
  return {
    request,
    async state(command = 'status'): Promise<State> {
      const reply = await request(command);
      assert.equal(reply.ok, true, JSON.stringify(reply));
      return (reply as Extract<Reply, { ok: true }>).state;
    },
    async close() {
      const exited = once(child, 'exit');
      child.stdin.end();
      const timeout = setTimeout(() => child.kill('SIGKILL'), 2000);
      try {
        await exited;
      } finally {
        clearTimeout(timeout);
        lines.close();
      }
    },
  };
}

test('real Link helper starts disconnected and exposes a continuous local timeline', async () => {
  const link = helper();
  try {
    const initial = await link.state();
    assert.equal(initial.enabled, false);
    assert.equal(initial.startStopSync, false);
    assert.equal(initial.playing, false);
    assert.equal(initial.peers, 0);
    assert.equal(initial.tempo, 120);
    assert.equal(initial.transportTimeUs, 0);
    assert.ok(initial.phase >= 0 && initial.phase < 4);
    await link.state('tempo 97.5');
    const before = await link.state();
    await delay(80);
    const after = await link.state();
    assert.equal(after.tempo, 97.5);
    assert.ok(after.timeUs > before.timeUs);
    const beatsElapsed = (((after.timeUs - before.timeUs) / 1e6) * 97.5) / 60;
    assert.ok(Math.abs(after.beat - before.beat - beatsElapsed) < 0.00001);
    const started = await link.state('play 1');
    assert.equal(started.playing, true);
    assert.ok(started.beat < 0, 'WebAudio has time to schedule beat zero');
    assert.ok(started.startTimeUs - started.timeUs > 100000);
    assert.ok(started.startTimeUs - started.timeUs <= 150000);
    assert.ok(started.transportTimeUs > 0);
    const changedTempo = await link.state('tempo 150');
    assert.equal(changedTempo.transportTimeUs, started.transportTimeUs);
    assert.notEqual(changedTempo.startTimeUs, started.startTimeUs);
    await delay(200);
    assert.ok((await link.state()).beat > 0);
    assert.equal((await link.state('play 0')).playing, false);
    const restarted = await link.state('play 1');
    assert.notEqual(restarted.transportTimeUs, started.transportTimeUs);
    assert.ok(restarted.beat < 0);
  } finally {
    await link.close();
  }
});

test('malformed native requests cannot mutate tempo or transport', async () => {
  const link = helper();
  try {
    for (const command of [
      'tempo NaN',
      'tempo Infinity',
      'tempo 0',
      'tempo 1000',
      'tempo 120abc',
      'tempo',
      'tempo 100 extra',
      'play true',
      'enable -1',
      'sync 2',
      'status extra',
      'unknown',
    ]) {
      const reply = await link.request(command);
      assert.equal(reply.ok, false, command);
      assert.ok('error' in reply && reply.error.length > 0);
    }
    const state = await link.state();
    assert.equal(state.enabled, false);
    assert.equal(state.tempo, 120);
    assert.equal(state.playing, false);
  } finally {
    await link.close();
  }
});

test(
  'two real peers share tempo, quantized phase and opt-in transport',
  {
    skip: process.env.KIT_LINK_NETWORK_TEST !== '1',
    timeout: 30000,
  },
  async () => {
    const a = helper();
    const b = helper();
    async function until(condition: (a: State, b: State) => boolean): Promise<[State, State]> {
      const deadline = performance.now() + 8000;
      while (performance.now() < deadline) {
        const states = await Promise.all([a.state(), b.state()]);
        if (condition(...states)) return states;
        await delay(30);
      }
      throw new Error('Link peers did not converge. Check local multicast permission.');
    }
    try {
      await a.state('tempo 131');
      await a.state('enable 1');
      await a.state('sync 1');
      await a.state('play 1');
      // Establish the first session before the second peer joins; two simultaneous
      // new sessions can legitimately elect either session's initial tempo.
      await delay(1200);
      await b.state('tempo 90');
      await b.state('enable 1');
      await b.state('sync 1');
      let states = await until(
        (x, y) => x.peers === 1 && y.peers === 1 && Math.abs(y.tempo - 131) < 0.001,
      );
      assert.equal(states[0].tempo, 131, 'joining must not overwrite session tempo');
      assert.equal(states[1].playing, false, 'joining must not start playback');

      await b.state('tempo 143');
      await until((x, y) => Math.abs(x.tempo - 143) < 0.001 && Math.abs(y.tempo - 143) < 0.001);
      const active = await a.state();
      await b.state('play 1');
      // Let the new Play event reach the already-running peer before checking
      // its local run; both playing flags were true even before delivery.
      await delay(250);
      states = await until((x, y) => x.playing && y.playing);
      const [x, y] = states;
      assert.equal(
        x.transportTimeUs,
        active.transportTimeUs,
        'peer Play must preserve our run identity',
      );
      const expectedBeat = active.beat + (((x.timeUs - active.timeUs) / 1e6) * active.tempo) / 60;
      assert.ok(
        Math.abs(x.beat - expectedBeat) < 0.02,
        'peer Play must not reset an active sequence',
      );
      const xPhaseAtY = x.phase + (((y.timeUs - x.timeUs) / 1e6) * x.tempo) / 60;
      const difference = (((y.phase - xPhaseAtY) % 4) + 4) % 4;
      assert.ok(
        Math.min(difference, 4 - difference) < 0.02,
        'shared phase should agree across clocks',
      );
      assert.ok(Math.abs((((y.startTimeUs - y.timeUs) / 1e6) * y.tempo) / 60 + y.beat) < 0.001);

      const beforeHiddenRestart = await a.state();
      await b.state('play 0');
      // Do not poll a: its Link callback must remember the intermediate stop
      // even when the renderer is busy for the entire stop/start sequence.
      await delay(180);
      await b.state('play 1');
      await delay(120);
      const restarted = await a.state();
      assert.equal(restarted.playing, true);
      assert.notEqual(restarted.transportTimeUs, beforeHiddenRestart.transportTimeUs);
      assert.ok(restarted.beat < 0, 'an unseen remote restart must rebase the local sequence');
      assert.ok(
        restarted.startTimeUs - restarted.timeUs > 140000,
        'restart must remain schedulable',
      );
      await delay(40);
      const afterRestart = await a.state();
      assert.equal(afterRestart.transportTimeUs, restarted.transportTimeUs);
      const resumedBeat =
        restarted.beat + (((afterRestart.timeUs - restarted.timeUs) / 1e6) * restarted.tempo) / 60;
      assert.ok(
        Math.abs(afterRestart.beat - resumedBeat) < 0.02,
        'a delayed stop callback must not rebase twice',
      );

      await b.state('play 0');
      await until((x, y) => !x.playing && !y.playing);
      await a.state('play 1');
      await until((x, y) => x.playing && y.playing);
      await b.state('enable 0');
      states = await until((x, y) => !y.enabled && !y.playing && x.peers === 0);
      assert.equal(states[0].playing, true, 'disconnect must not send a peer Stop');
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  },
);
