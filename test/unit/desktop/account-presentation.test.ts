import { describe, expect, it } from 'vite-plus/test';
import {
  accountActions,
  accountStatus,
  settingsError,
} from '../../../src/editor/settings-presentation.ts';
import type { AIAccountInfo } from '../../../src/host/ai.ts';

const account = (
  login: AIAccountInfo['login'],
  state: AIAccountInfo['codex']['state'],
  signedIn = false,
) => ({ login, codex: { state }, signedIn, aiBusy: false });

describe('ChatGPT account presentation', () => {
  it.each(['starting', 'waiting', 'checking', 'canceling'] as const)(
    'offers cancellation and locks settings during %s',
    login => {
      expect(accountActions(account(login, 'login'), false)).toMatchObject({
        cancel: true,
        locked: true,
        signIn: false,
        signOut: false,
        reconnect: false,
      });
      expect(accountStatus('login', login)).toMatch(/Starting|Waiting|Confirming|Canceling/);
    },
  );

  it('unlocks a failed sign-in, including a failed account check with an existing account', () => {
    expect(accountActions(account('error', 'login'), false)).toMatchObject({
      locked: false,
      signIn: true,
      cancel: false,
    });
    expect(accountActions(account('error', 'error', true), false)).toMatchObject({
      reconnect: true,
      cancel: false,
    });
    expect(accountActions(account('complete', 'ok', true), false)).toMatchObject({
      signOut: true,
      locked: false,
      signIn: false,
      cancel: false,
    });
    expect(accountStatus('ok', 'complete', true)).toBe('Signed in');
  });

  it('keeps settings locked during startup or an AI request', () => {
    expect(accountActions(account('idle', 'starting'), false).locked).toBe(true);
    expect(accountActions({ ...account('complete', 'ok', true), aiBusy: true }, false).locked).toBe(
      true,
    );
  });

  it.each([
    ['Sign-in timed out', 'Sign-in timed out. Try signing in again.'],
    ['Could not confirm account', 'Your account could not be confirmed. Try signing in again.'],
    ['The browser could not open', 'The sign-in page could not be opened. Try again.'],
  ])('gives actionable recovery for %s', (error, message) => {
    expect(settingsError(error, 'sign-in')).toBe(message);
  });
});
