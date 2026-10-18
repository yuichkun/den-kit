import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { cleanOutput, exitMarker, keepEnd, newNonce, projectPath, readExit, runnerLine } from '../../../src/pod/host.ts';

describe('pod: terminal output', () => {
  it('drops colours, cursor codes and titles, and keeps what a progress line last said', () => {
    expect(cleanOutput('\x1b[32madded\x1b[0m 12 packages\r\n')).toBe('added 12 packages\n');
    expect(cleanOutput('\x1b]0;npm install\x07done')).toBe('done');
    expect(cleanOutput('[1/3] fetch\r[2/3] link\r[3/3] build\nnext')).toBe('[3/3] build\nnext');
    expect(cleanOutput('a\x08b\x00c')).toBe('abc');
    expect(cleanOutput('trailing\r')).toBe('trailing');
  });
  it('keeps the end of a long output and says how much was cut', () => {
    expect(keepEnd('short', 10)).toBe('short');
    const kept = keepEnd('x'.repeat(30) + 'END', 10);
    expect(kept.endsWith('xxxxxxxEND')).toBe(true);
    expect(kept).toContain('23 characters cut');
  });
});

describe('pod: exit status through the marker line', () => {
  it('finds the status after the output, and only for its own nonce', () => {
    const nonce = 'abc1';
    const out = `hello\nworld\n${exitMarker(nonce)}3>>\n`;
    expect(readExit(out, nonce)).toEqual({ output: 'hello\nworld', exitCode: 3 });
    expect(readExit(out, 'other')).toBeNull();
    expect(readExit(`${exitMarker(nonce)}x>>`, nonce)).toBeNull();
    expect(readExit('no marker', nonce)).toBeNull();
  });
  it('a script that prints a look-alike marker does not fool it (the real one is last)', () => {
    const nonce = 'n1';
    expect(readExit(`${exitMarker(nonce)}0>>\n${exitMarker(nonce)}2>>\n`, nonce)!.exitCode).toBe(2);
  });
  it('nonces differ', () => {
    const seen = new Set(Array.from({ length: 50 }, () => newNonce()));
    expect(seen.size).toBe(50);
  });
  it('the runner line runs the script in its folder with bash and reports its status (real bash)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'den-kit-runner-'));
    try {
      const script = join(dir, 'script.sh');
      writeFileSync(script, 'pwd\necho "to stderr" >&2\ncd /\nexit 7\n');
      const nonce = newNonce();
      const r = spawnSync('bash', ['-c', runnerLine(nonce), 'den-kit', dir, script], { encoding: 'utf8' });
      const found = readExit(cleanOutput(r.stdout), nonce);
      expect(found).toEqual({ output: dir, exitCode: 7 });
      // A missing folder falls back to home instead of failing before the script runs.
      writeFileSync(script, 'echo ran\n');
      const r2 = spawnSync('bash', ['-c', runnerLine(nonce), 'den-kit', join(dir, 'missing'), script], { encoding: 'utf8', env: { ...process.env, HOME: dir } });
      expect(readExit(cleanOutput(r2.stdout), nonce)).toEqual({ output: 'ran', exitCode: 0 });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('pod: project paths from the AI or the person', () => {
  const dir = '/home/user/work';
  it('takes relative paths and absolute ones inside the project', () => {
    expect(projectPath('src/parts/reels.ts', dir)).toEqual({ ok: true, path: 'src/parts/reels.ts' });
    expect(projectPath('./src/main.ts', dir)).toEqual({ ok: true, path: 'src/main.ts' });
    expect(projectPath('/home/user/work/AGENTS.md', dir)).toEqual({ ok: true, path: 'AGENTS.md' });
  });
  it('refuses paths outside it, odd paths and what the tools make', () => {
    for (const bad of ['/etc/passwd', '~/x', '../x', 'src/../../x', 'a//b', '', '   ', 3, 'node_modules/x/index.js', '.git/config', 'dist/index.html'])
      expect(projectPath(bad, dir).ok, String(bad)).toBe(false);
  });
});
