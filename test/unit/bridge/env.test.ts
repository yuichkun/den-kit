import { describe, expect, it } from 'vite-plus/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvFile, maskSecret } from '../../../bridge/env.ts';
import { codexEnv } from '../../../bridge/codex/process.ts';

describe('.env loading', () => {
  it('reads KEY=VALUE lines, strips quotes and export, ignores comments, and never overrides the environment', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kit-env-'));
    const file = join(dir, '.env');
    writeFileSync(
      file,
      '# comment\nTYPESAFE_API_KEY="abc def"\r\nexport KIT_JEV_BUDGET_MS=900\nEXISTING=from-file\nnot a line\n  # KEY=commented\nEMPTY=\n',
    );
    const env: NodeJS.ProcessEnv = { EXISTING: 'from-env' };
    expect(loadEnvFile(file, env).sort()).toEqual([
      'EMPTY',
      'KIT_JEV_BUDGET_MS',
      'TYPESAFE_API_KEY',
    ]);
    expect(env).toEqual({
      EXISTING: 'from-env',
      TYPESAFE_API_KEY: 'abc def',
      KIT_JEV_BUDGET_MS: '900',
      EMPTY: '',
    });
    expect(loadEnvFile(join(dir, 'missing'), env)).toEqual([]);
  });
  it('masks secrets (short ones reveal nothing)', () => {
    expect(maskSecret(undefined)).toBe('(not set)');
    expect(maskSecret('short')).toBe('5 chars');
    expect(maskSecret('ts_live_0123456789abcd')).toBe('22 chars, …abcd');
  });
  it("Codex never gets den-kit's secrets (Jev's key, the pod's key, the bridge token)", () => {
    const env = codexEnv('/h', {
      PATH: '/bin',
      TYPESAFE_API_KEY: 'a',
      BROWSERPOD_API_KEY: 'b',
      KIT_BRIDGE_TOKEN: 'c',
      HTTPS_PROXY: 'http://p',
    });
    expect(env).toEqual({ PATH: '/bin', HTTPS_PROXY: 'http://p', CODEX_HOME: '/h' });
  });
});
