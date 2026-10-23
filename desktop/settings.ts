import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { DesktopSettings } from './page/api.ts';

export const DEFAULT_SETTINGS: DesktopSettings = { model: '', effort: '' };
export function validatedSettings(value: unknown): DesktopSettings {
  if (!value || typeof value !== 'object') throw new Error('Invalid settings.');
  const s = value as Partial<DesktopSettings>;
  if (typeof s.model !== 'string' || s.model.length > 120 || !/^[\w.:-]*$/.test(s.model))
    throw new Error('Invalid model.');
  if (
    typeof s.effort !== 'string' ||
    !['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(s.effort)
  )
    throw new Error('Invalid reasoning effort.');
  return { model: s.model, effort: s.effort };
}
export function readSettings(directory: string): DesktopSettings {
  try {
    return validatedSettings(JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8')));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
export function writeSettings(directory: string, settings: DesktopSettings) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, 'settings.json');
  writeFileSync(`${file}.tmp`, JSON.stringify(validatedSettings(settings), null, 2), {
    mode: 0o600,
  });
  renameSync(`${file}.tmp`, file);
}
