// `kit:doctor` and `kit:codex:login` as the user runs them, against the fakes
// (fake Jev over HTTP, fake Codex CLI through KIT_CODEX_BIN).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeJev, type FakeJev } from '../fakes/jev/fake-jev.ts';
import { FAKE_CODEX, KIT_ROOT, fakeCodexEnv } from '../helpers/fake-codex.ts';

let jev: FakeJev;
let dir: string;
beforeAll(async () => { jev = await startFakeJev({ key: 'doctor-key' }); dir = mkdtempSync(join(tmpdir(), 'kit-doctor-')); });
afterAll(async () => { await jev.close(); rmSync(dir, { recursive: true, force: true }); });

function run(script: string, env: Record<string, string>, args: string[] = []): Promise<{ code: number; out: string }> {
  return new Promise(resolve => {
    execFile(process.execPath, [script, ...args], { cwd: KIT_ROOT, env: { ...process.env, KIT_PORT: '59180', KIT_BRIDGE_PORT: '59181', ...env }, timeout: 120000 }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1) : 0, out: `${stdout}${stderr}` });
    });
  });
}
function codexEnv(name: string, signedIn: boolean) {
  const home = join(dir, name);
  mkdirSync(home, { recursive: true });
  if (signedIn) writeFileSync(join(home, 'auth.json'), '{"fake":true}');
  return { KIT_CODEX_BIN: FAKE_CODEX, KIT_CODEX_HOME: home, TYPESAFE_API_KEY: 'doctor-key', KIT_JEV_BASE: jev.url, ...fakeCodexEnv(join(dir, `${name}.jsonl`)) };
}
const line = (out: string, name: string) => out.split('\n').find(l => new RegExp(`^(PASS|WARN|FAIL|SKIP)\\s+${name}\\b`).test(l)) ?? `(no ${name} line)\n${out}`;

describe('kit:doctor', () => {
  it('a signed-in Codex passes every check; --deep makes the ping round trip and records it', async () => {
    const { code, out } = await run('scripts/doctor.ts', codexEnv('home-ok', true), ['--deep']);
    expect(line(out, 'Codex CLI')).toMatch(/^PASS.*0\.160\.1 \(KIT_CODEX_BIN\)/);
    expect(line(out, 'CODEX_HOME')).toMatch(/^WARN.*KIT_CODEX_HOME/);
    expect(line(out, 'Codex sign-in')).toMatch(/^PASS.*Logged in using ChatGPT/);
    expect(line(out, 'Codex app-server')).toMatch(/^PASS.*ChatGPT plus · GPT-6\.1-Sol \(sees images\)/);
    expect(line(out, 'Codex isolation')).toMatch(/^PASS\s+Codex isolation\s+no instruction files/);
    expect(line(out, 'Codex live request')).toMatch(/^PASS.*kit_ping round trip · reply “pong”/);
    const recording = line(out, 'Codex recording').replace(/^PASS\s+Codex recording\s+/, '').trim();
    expect(existsSync(join(KIT_ROOT, recording.replace(/^kit\//, '')))).toBe(true);
    rmSync(join(KIT_ROOT, recording.replace(/^kit\//, '')));
    expect(line(out, 'Jev request')).toMatch(/^PASS/);
    expect(code, out).toBe(0);
  }, 150000);

  it('not signed in: one FAIL that says what to run', async () => {
    const { code, out } = await run('scripts/doctor.ts', codexEnv('home-out', false));
    expect(line(out, 'Codex sign-in')).toMatch(/^FAIL.*Not logged in/);
    expect(out).toContain('npm run kit:codex:login');
    expect(line(out, 'Codex live request')).toMatch(/^SKIP/);
    expect(code).toBe(1);
  }, 150000);

  it('instruction files picked up by Codex are reported', async () => {
    const { out } = await run('scripts/doctor.ts', { ...codexEnv('home-agents', true), FAKE_CODEX_INSTRUCTION_SOURCES: '/Users/me/.codex/AGENTS.md' });
    expect(line(out, 'Codex isolation')).toMatch(/^WARN.*instruction files loaded: \/Users\/me\/\.codex\/AGENTS\.md/);
  }, 150000);
});

describe('kit:codex:login', () => {
  it('creates CODEX_HOME (Codex refuses a missing one) and signs in', async () => {
    const home = join(dir, 'fresh-home');
    const { code, out } = await run('scripts/codex-login.ts', { KIT_CODEX_BIN: FAKE_CODEX, KIT_CODEX_HOME: home });
    expect(code, out).toBe(0);
    expect(existsSync(join(home, 'auth.json'))).toBe(true);
    expect(out).toMatch(/picks this up by itself/);
  }, 60000);
});

