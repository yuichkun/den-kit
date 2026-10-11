import type { CodexStatus } from '../ai/protocol.ts';

export function accountStatus(state: CodexStatus['state'], waiting = false, signedIn = false): string {
  if (waiting) return 'Waiting for sign-in';
  switch (state) {
    case 'ok': return signedIn ? 'Signed in' : 'Not signed in';
    case 'login': return 'Not signed in';
    case 'starting': return 'Connecting to ChatGPT…';
    case 'off': return 'AI is turned off';
    case 'error': return 'Could not connect to ChatGPT. Try again.';
  }
}

export type SettingsAction = 'load' | 'settings' | 'sign-in' | 'sign-out' | 'usage' | 'reconnect';
export function settingsError(error: unknown, action: SettingsAction): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (action === 'settings') {
    if (/finish the current AI request/i.test(detail)) return 'Wait for the current AI request to finish, then save your settings.';
    if (/complete or cancel ChatGPT sign-in/i.test(detail)) return 'Complete or cancel sign-in before changing settings.';
    if (/invalid model|select a model/i.test(detail)) return 'Choose a model from the list.';
    if (/reasoning effort/i.test(detail)) return 'Choose a reasoning effort supported by this model.';
    return 'Settings could not be saved. Try again.';
  }
  if (action === 'sign-in') return 'Sign-in could not be completed. Try again.';
  if (action === 'sign-out') return 'Sign-out could not be completed. Try again.';
  if (action === 'usage') return 'The usage page could not be opened. Try again.';
  if (action === 'reconnect') return 'AI could not reconnect. Try again, or restart den-kit.';
  return 'Settings are unavailable. Close this window and try again.';
}

export function effortLabel(value: string): string {
  if (value === 'xhigh') return 'Extra high';
  if (value === 'max') return 'Maximum';
  return value.charAt(0).toUpperCase() + value.slice(1);
}
