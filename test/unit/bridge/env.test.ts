import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvFile, maskSecret } from '../../../bridge/env.ts';

describe('kit/.env loading', () => {
  it('reads KEY=VALUE lines, strips quotes and export, ignores comments, and never overrides the environment', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kit-env-'));
    const file = join(dir, '.env');
    writeFileSync(file, '# comment\nTYPESAFE_API_KEY="abc def"\r\nexport KIT_JEV_BUDGET_MS=900\nEXISTING=from-file\nnot a line\n  # KEY=commented\nEMPTY=\n');
    const env: NodeJS.ProcessEnv = { EXISTING: 'from-env' };
    expect(loadEnvFile(file, env).sort()).toEqual(['EMPTY', 'KIT_JEV_BUDGET_MS', 'TYPESAFE_API_KEY']);
    expect(env).toEqual({ EXISTING: 'from-env', TYPESAFE_API_KEY: 'abc def', KIT_JEV_BUDGET_MS: '900', EMPTY: '' });
    expect(loadEnvFile(join(dir, 'missing'), env)).toEqual([]);
  });
  it('masks secrets (short ones reveal nothing)', () => {
    expect(maskSecret(undefined)).toBe('(not set)');
    expect(maskSecret('short')).toBe('5 chars');
    expect(maskSecret('ts_live_0123456789abcd')).toBe('22 chars, …abcd');
  });
});
