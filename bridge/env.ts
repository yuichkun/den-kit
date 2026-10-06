// Minimal KEY=VALUE loader for kit/.env (never committed). Existing environment wins.
import { existsSync, readFileSync } from 'node:fs';

export function loadEnvFile(path: string, env: NodeJS.ProcessEnv = process.env): string[] {
  if (!existsSync(path)) return [];
  const loaded: string[] = [];
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    let value = m[2]!;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (env[m[1]!] === undefined) { env[m[1]!] = value; loaded.push(m[1]!); }
  }
  return loaded;
}

/** Show that a secret exists without revealing it. */
export const maskSecret = (secret: string | undefined) => !secret ? '(not set)' : secret.length < 16 ? `${secret.length} chars` : `${secret.length} chars, …${secret.slice(-4)}`;
