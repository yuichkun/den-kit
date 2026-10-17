import type { CodexStatus } from '../ai/protocol.ts';
import type { DesktopInfo, UpdateStatus } from './api.ts';

export const signInPending = (login: DesktopInfo['login']) => ['starting', 'waiting', 'checking', 'canceling'].includes(login);

export function accountStatus(state: CodexStatus['state'], login: DesktopInfo['login'], signedIn = false): string {
  if (login === 'starting') return 'Starting sign-in…';
  if (login === 'waiting') return 'Waiting for sign-in';
  if (login === 'checking') return 'Confirming your account…';
  if (login === 'canceling') return 'Canceling sign-in…';
  switch (state) {
    case 'ok': return signedIn ? 'Signed in' : 'Not signed in';
    case 'login': return 'Not signed in';
    case 'starting': return 'Connecting to ChatGPT…';
    case 'off': return 'AI is turned off';
    case 'error': return 'Could not connect to ChatGPT. Try again.';
  }
}

/** Recovery stays available after every terminal state, including a failed refresh. */
export function accountActions(info: Pick<DesktopInfo, 'login' | 'codex' | 'chatGPTSignedIn' | 'aiBusy'>, busy: boolean) {
  const pending = signInPending(info.login);
  const available = info.codex.state === 'ok' || info.codex.state === 'login';
  return {
    locked: busy || pending || info.aiBusy || info.codex.state === 'starting',
    signIn: !pending && available && !info.chatGPTSignedIn,
    cancel: pending,
    signOut: !pending && available && info.chatGPTSignedIn,
    reconnect: !pending && (info.codex.state === 'error' || info.codex.state === 'off'),
  };
}

/** What the Updates section says and offers; null hides it (development and isolated checks). */
export function updatePresentation(update: UpdateStatus | undefined): { text: string; check: boolean; install: boolean } | null {
  switch (update?.state) {
    case undefined: case 'off': return null;
    case 'move': return { text: 'To receive updates, move den-kit to your Applications folder and open it from there.', check: false, install: false };
    case 'idle': return { text: 'den-kit checks for updates automatically.', check: true, install: false };
    case 'checking': return { text: 'Checking for updates…', check: false, install: false };
    case 'current': return { text: 'den-kit is up to date.', check: true, install: false };
    case 'downloading': return { text: `Downloading den-kit ${update.version}… ${update.percent}%`, check: false, install: false };
    case 'preparing': return { text: `Preparing den-kit ${update.version}…`, check: false, install: false };
    case 'ready': return { text: `den-kit ${update.version} is ready. It installs the next time you quit den-kit, or you can restart now.`, check: false, install: true };
    case 'error': return { text: update.message, check: true, install: false };
  }
}

export type SettingsAction = 'load' | 'settings' | 'sign-in' | 'sign-out' | 'usage' | 'reconnect' | 'update-check' | 'update-install';
export function settingsError(error: unknown, action: SettingsAction): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (action === 'settings') {
    if (/finish the current AI request/i.test(detail)) return 'Wait for the current AI request to finish, then save your settings.';
    if (/complete or cancel ChatGPT sign-in/i.test(detail)) return 'Complete or cancel sign-in before changing settings.';
    if (/invalid model|select a model/i.test(detail)) return 'Choose a model from the list.';
    if (/reasoning effort/i.test(detail)) return 'Choose a reasoning effort supported by this model.';
    return 'Settings could not be saved. Try again.';
  }
  if (action === 'sign-in') {
    if (/timed? out|timeout/i.test(detail)) return 'Sign-in timed out. Try signing in again.';
    if (/confirm|account.*read/i.test(detail)) return 'Your account could not be confirmed. Try signing in again.';
    if (/browser/i.test(detail)) return 'The sign-in page could not be opened. Try again.';
    return 'Sign-in could not be completed. Try again.';
  }
  if (action === 'sign-out') return 'Sign-out could not be completed. Try again.';
  if (action === 'usage') return 'The usage page could not be opened. Try again.';
  if (action === 'reconnect') return 'AI could not reconnect. Try again, or restart den-kit.';
  if (action === 'update-check') return 'Updates could not be checked. Try again later.';
  if (action === 'update-install') {
    if (/finish the current AI request/i.test(detail)) return 'Wait for the current AI request to finish, then restart.';
    return 'The update could not be installed now. It installs the next time you quit den-kit.';
  }
  return 'Settings are unavailable. Close this window and try again.';
}

export function effortLabel(value: string): string {
  if (value === 'xhigh') return 'Extra high';
  if (value === 'max') return 'Maximum';
  return value.charAt(0).toUpperCase() + value.slice(1);
}
