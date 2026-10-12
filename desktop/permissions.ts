import { APP_ORIGIN } from './renderer-server.ts';

export function allowedPermission(url: string, name: string, mainFrame: boolean): boolean {
  if (!mainFrame) return false;
  try { return new URL(url).origin === APP_ORIGIN && ['media', 'midi', 'persistent-storage', 'clipboard-sanitized-write', 'fullscreen'].includes(name); }
  catch { return false; }
}
