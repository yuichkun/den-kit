import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { readSettings, validatedSettings, writeSettings } from '../../../desktop/settings.ts';

describe('desktop settings', () => {
  it('persists only the chosen settings and rejects malformed values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'den-kit-settings-'));
    try {
      const value = { model: 'gpt-6.1-sol', effort: 'high', fork: true };
      writeSettings(dir, value);
      expect(readSettings(dir)).toEqual(value);
      expect(Object.keys(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')))).toEqual(['model', 'effort', 'fork']);
      expect(() => validatedSettings({ ...value, effort: 'invented' })).toThrow();
      expect(() => validatedSettings({ ...value, model: '../../other' })).toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
