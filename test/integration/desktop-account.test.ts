import { afterEach, describe, expect, it } from 'vitest';
import { fakeCodex, type FakeCodex } from '../helpers/fake-codex.ts';

const fakes: FakeCodex[] = [];
afterEach(async () => { while (fakes.length) await fakes.pop()!.cleanup(); });
const until = async (fn: () => boolean) => { const end = Date.now() + 5000; while (!fn()) { if (Date.now() > end) throw new Error('Account did not settle.'); await new Promise(r => setTimeout(r, 10)); } };
function setup(options: Parameters<typeof fakeCodex>[0] = {}) { const f = fakeCodex(options); fakes.push(f); return f; }

describe('desktop ChatGPT account', () => {
  it('completes the browser sign-in, becomes ready, then signs out', async () => {
    const f = setup({ signedIn: false, env: { FAKE_CODEX_LOGIN: 'success' }, client: { loginInstruction: 'Open Settings.' } });
    await f.client.start();
    expect(f.client.status.state).toBe('login');
    expect(f.client.chatGPTSignedIn).toBe(false);
    expect(f.client.status.fix).toBe('Open Settings.');
    const url = await f.client.signIn();
    expect(new URL(url).hostname).toBe('auth.openai.com');
    expect(f.client.login.state).toBe('waiting');
    await until(() => f.client.ready);
    expect(f.client.chatGPTSignedIn).toBe(true);
    expect(f.client.login.state).toBe('complete');
    expect(f.client.models.map(m => m.id)).toContain('gpt-6.1-sol');
    await f.client.signOut();
    expect(f.client.status.state).toBe('login');
    expect(f.client.chatGPTSignedIn).toBe(false);
    expect(f.violations()).toEqual([]);
  });

  it('distinguishes a ChatGPT account from API-key and unauthenticated transports even when ready', async () => {
    const chatGPT = setup();
    await chatGPT.client.start();
    expect(chatGPT.client.ready).toBe(true);
    expect(chatGPT.client.chatGPTSignedIn).toBe(true);

    const apiKey = setup({ env: { FAKE_CODEX_AUTH: 'apiKey' } });
    await apiKey.client.start();
    expect(apiKey.client.ready).toBe(true);
    // Plan metadata in a rate-limit response must not change the actual account type.
    await until(() => apiKey.client.status.plan === 'plus');
    expect(apiKey.client.chatGPTSignedIn).toBe(false);

    const noAuth = setup({ signedIn: false, env: { FAKE_CODEX_AUTH: 'no-auth' } });
    await noAuth.client.start();
    expect(noAuth.client.ready).toBe(true);
    expect(noAuth.client.chatGPTSignedIn).toBe(false);

    const signedOut = setup({ signedIn: false });
    await signedOut.client.start();
    expect(signedOut.client.status.state).toBe('login');
    expect(signedOut.client.chatGPTSignedIn).toBe(false);
    for (const f of [chatGPT, apiKey, noAuth, signedOut]) expect(f.violations()).toEqual([]);
  });

  it('refreshes the actual account after sign-in on a ready unauthenticated transport without restarting it', async () => {
    const f = setup({ signedIn: false, env: { FAKE_CODEX_AUTH: 'no-auth', FAKE_CODEX_LOGIN: 'success' } });
    await f.client.start();
    expect(f.client.ready).toBe(true);
    expect(f.client.chatGPTSignedIn).toBe(false);
    const reads = f.sent('account/read').length;
    const boots = f.client.stats.boots;
    await f.client.signIn();
    await until(() => f.client.login.state === 'complete' && f.client.chatGPTSignedIn);
    expect(f.client.status.plan).toBe('plus');
    expect(f.client.ready).toBe(true);
    expect(f.sent('account/read').length).toBeGreaterThan(reads);
    expect(f.client.stats.boots).toBe(boots);
    expect(f.violations()).toEqual([]);
  });

  it('rereads an account notification without trusting its ChatGPT label over an API-key account response', async () => {
    const f = setup({ env: { FAKE_CODEX_AUTH: 'apiKey', FAKE_CODEX_LOGIN: 'success' } });
    await f.client.start();
    const reads = f.sent('account/read').length;
    const boots = f.client.stats.boots;
    await f.client.signIn();
    await until(() => f.client.login.state === 'error' && f.sent('account/read').length > reads);
    expect(f.client.chatGPTSignedIn).toBe(false);
    expect(f.client.ready).toBe(true);
    expect(f.client.stats.boots).toBe(boots);
    expect(f.violations()).toEqual([]);
  });

  it.each(['completed-only', 'completed-before-save', 'updated-first', 'file-first', 'silent', 'early-completion'])('confirms %s sign-in without restarting the OAuth process', async login => {
    const f = setup({ signedIn: false, env: { FAKE_CODEX_LOGIN: login } });
    await f.client.start();
    const models = f.sent('model/list').length;
    await f.client.signIn();
    await until(() => f.client.login.state === 'complete');
    expect(f.client.chatGPTSignedIn).toBe(true);
    expect(f.client.ready).toBe(true);
    expect(f.client.status.state).toBe('ok');
    expect(f.sent('model/list').length).toBeGreaterThan(models);
    expect(f.client.stats.boots).toBe(1);
    expect(f.violations()).toEqual([]);
  });

  it('keeps checking until the account read completes instead of reporting success from OAuth alone', async () => {
    const f = setup({ signedIn: false, env: { FAKE_CODEX_LOGIN: 'completed-only', FAKE_CODEX_CONFIRM: 'delay' } });
    await f.client.start(); await f.client.signIn();
    await until(() => f.client.login.state === 'checking');
    expect(f.client.chatGPTSignedIn).toBe(false);
    expect(f.client.ready).toBe(false);
    await until(() => f.client.login.state === 'complete');
    expect(f.client.chatGPTSignedIn).toBe(true);
    expect(f.client.ready).toBe(true);
  });

  it.each(['hang', 'error'])('ends a failed account confirmation (%s) with a recoverable error', async confirm => {
    const f = setup({ signedIn: false, env: { FAKE_CODEX_LOGIN: 'completed-only', FAKE_CODEX_CONFIRM: confirm }, client: { timeouts: { requestMs: 200 } } });
    await f.client.start(); await f.client.signIn();
    await until(() => f.client.login.state === 'error');
    expect(f.client.login.error).toMatch(/could not be confirmed/);
    expect(f.client.ready).toBe(false);
    await until(() => f.sent('account/login/cancel').length === 1);
    await f.client.retry();
    expect(f.client.ready).toBe(true);
    expect(f.client.chatGPTSignedIn).toBe(true);
    expect(f.client.login.state).toBe('complete');
  });

  it('keeps the OAuth attempt alive after a failed poll before browser completion', async () => {
    const f = setup({ signedIn: false, env: { FAKE_CODEX_LOGIN: 'completed-only', FAKE_CODEX_LOGIN_DELAY_MS: '300', FAKE_CODEX_PRELOGIN_READ_FAILURE: '1' } });
    await f.client.start(); await f.client.signIn();
    await until(() => f.sent('account/read').length >= 3);
    expect(f.client.login.state).toBe('waiting');
    expect(f.sent('account/login/cancel')).toHaveLength(0);
    await until(() => f.client.login.state === 'complete');
    expect(f.client.ready).toBe(true);
    expect(f.client.chatGPTSignedIn).toBe(true);
    expect(f.client.stats.boots).toBe(1);
  });

  it('still cancels at the overall deadline when pre-completion polls keep failing', async () => {
    const f = setup({ signedIn: false, env: { FAKE_CODEX_PRELOGIN_READ_FAILURE: '1' }, client: { loginTimeoutMs: 200 } });
    await f.client.start(); await f.client.signIn();
    await until(() => f.client.login.state === 'error');
    expect(f.client.login.error).toMatch(/timed out/);
    await until(() => f.sent('account/login/cancel').length === 1);
    await f.client.signIn();
    expect(f.client.login.state).toBe('waiting');
    await f.client.cancelSignIn();
  });

  it.each(['ok', 'error'])('performs the queued confirmation (%s) after an older poll fails', async confirmation => {
    const f = setup({ signedIn: false, env: { FAKE_CODEX_LOGIN: 'completed-only', FAKE_CODEX_LOGIN_DELAY_MS: '150', FAKE_CODEX_PRELOGIN_READ_FAILURE: 'late', FAKE_CODEX_CONFIRM: confirmation } });
    await f.client.start(); await f.client.signIn();
    await until(() => f.client.login.state === 'checking');
    expect(f.sent('account/login/cancel')).toHaveLength(0);
    await until(() => f.client.login.state === (confirmation === 'ok' ? 'complete' : 'error'));
    expect(f.client.ready).toBe(confirmation === 'ok');
    expect(f.sent('account/read').length).toBeGreaterThanOrEqual(3);
    if (confirmation === 'ok') expect(f.sent('account/login/cancel')).toHaveLength(0);
    else await until(() => f.sent('account/login/cancel').length === 1);
    expect(f.client.stats.boots).toBe(1);
  });

  it.each(['normal', 'delay'])('rechecks a recovered account even when cancellation acknowledgement is %s', async cancel => {
    const f = setup({ signedIn: false, env: { FAKE_CODEX_LOGIN: 'completed-only', FAKE_CODEX_CONFIRM: 'error-once', FAKE_CODEX_CANCEL: cancel } });
    await f.client.start(); await f.client.signIn();
    await until(() => f.sent('account/login/cancel').length === 1);
    await until(() => f.client.ready);
    expect(f.client.chatGPTSignedIn).toBe(true);
    expect(f.client.login).toEqual({ state: 'complete', error: undefined });
    expect(f.client.stats.boots).toBe(1);
  });

  it.each(['ok', 'error'])('honors an account update queued during a failing confirmation (%s)', async result => {
    const f = setup({ signedIn: false, env: { FAKE_CODEX_LOGIN: 'completed-only', FAKE_CODEX_CONFIRM: `overlap-${result}` } });
    await f.client.start(); await f.client.signIn();
    await until(() => f.client.login.state === (result === 'ok' ? 'complete' : 'error'));
    // Boot, pre-completion poll, failed confirmation, and notification-triggered confirmation.
    expect(f.sent('account/read').length).toBeGreaterThanOrEqual(4);
    expect(f.client.ready).toBe(result === 'ok');
    if (result === 'ok') {
      expect(f.sent('account/login/cancel')).toHaveLength(0);
      expect(f.client.login.error).toBeUndefined();
    } else await until(() => f.sent('account/login/cancel').length === 1);
    expect(f.client.stats.boots).toBe(1);
  });

  it('expires an unfinished browser sign-in and allows another attempt', async () => {
    const f = setup({ signedIn: false, client: { loginTimeoutMs: 160 } });
    await f.client.start(); await f.client.signIn();
    await until(() => f.client.login.state === 'error');
    expect(f.client.login.error).toMatch(/timed out/);
    expect(f.client.status.state).toBe('login');
    await until(() => f.sent('account/login/cancel').length === 1);
    await f.client.signIn();
    expect(f.client.login.state).toBe('waiting');
    await f.client.cancelSignIn();
  });

  it('reports a failed browser sign-in without leaving settings locked', async () => {
    const f = setup({ signedIn: false, env: { FAKE_CODEX_LOGIN: 'failure' } });
    await f.client.start(); await f.client.signIn();
    await until(() => f.client.login.state === 'error');
    expect(f.client.login.error).toMatch(/declined/);
    expect(f.client.ready).toBe(false);
    await f.client.configure({ model: '', effort: '', fork: false });
    expect(f.client.status.state).toBe('login');
  });

  it('clears the waiting state after the OAuth process crashes', async () => {
    const f = setup({ signedIn: false, env: { FAKE_CODEX_LOGIN: 'crash' } });
    await f.client.start(); await f.client.signIn();
    await until(() => f.client.stats.boots === 2 && f.client.status.state === 'login');
    expect(f.client.login.state).toBe('error');
    expect(f.client.login.error).toMatch(/interrupted/);
    expect(f.client.chatGPTSignedIn).toBe(false);
    await f.client.signIn();
    expect(f.client.login.state).toBe('waiting');
    await f.client.cancelSignIn();
  });

  it('cancels while obtaining the login URL and ignores its late failure', async () => {
    const f = setup({ signedIn: false, env: { FAKE_CODEX_LOGIN: 'hang-start' }, client: { timeouts: { requestMs: 160 } } });
    await f.client.start();
    const signingIn = f.client.signIn().catch(error => error as Error);
    await until(() => f.client.login.state === 'starting');
    await f.client.cancelSignIn();
    expect(await signingIn).toBeInstanceOf(Error);
    expect(f.client.login.state).toBe('idle');
    expect(f.client.chatGPTSignedIn).toBe(false);
  });

  it('ignores an old login completion after canceling and starting another sign-in', async () => {
    const f = setup({ signedIn: false, env: { FAKE_CODEX_LATE_LOGIN: '1' }, client: { loginTimeoutMs: 1000 } });
    await f.client.start(); await f.client.signIn(); await f.client.cancelSignIn(); await f.client.signIn();
    await new Promise(r => setTimeout(r, 180));
    expect(f.client.login.state).toBe('waiting');
    expect(f.client.chatGPTSignedIn).toBe(false);
    await f.client.cancelSignIn();
  });

  it('ignores a pending account read after cancellation', async () => {
    const f = setup({ signedIn: false, env: { FAKE_CODEX_LOGIN: 'completed-only', FAKE_CODEX_CONFIRM: 'delay' } });
    await f.client.start(); await f.client.signIn();
    await until(() => f.client.login.state === 'checking');
    await f.client.cancelSignIn();
    await new Promise(r => setTimeout(r, 200));
    expect(f.client.login.state).toBe('idle');
    expect(f.client.chatGPTSignedIn).toBe(false);
  });

  it('shares overlapping restarts and waits for the replacement process to initialize', async () => {
    const f = setup({ env: { FAKE_CODEX_STARTUP_MS: '60' } });
    await f.client.start();
    await Promise.all([f.client.retry(), f.client.retry(), f.client.start()]);
    expect(f.client.ready).toBe(true);
    expect(f.client.stats.boots).toBe(2);
    expect(f.sent('initialize')).toHaveLength(2);
    expect(f.violations()).toEqual([]);
  });

  it('cancels a pending sign-in without accepting its failure as a new login', async () => {
    const f = setup({ signedIn: false }); await f.client.start();
    await f.client.signIn(); await f.client.cancelSignIn();
    expect(f.client.login).toEqual({ state: 'idle', error: undefined });
    expect(f.client.ready).toBe(false);
    expect(f.sent('account/login/cancel')).toHaveLength(1);
  });

  it.each(['error', 'hang'])('ends the OAuth process after cancellation fails (%s) before allowing a new sign-in', async fault => {
    const f = setup({ signedIn: false, env: { FAKE_CODEX_CANCEL: fault }, client: { timeouts: { requestMs: 200 } } });
    await f.client.start(); await f.client.signIn();
    const cancel = f.client.cancelSignIn();
    expect(f.client.login.state).toBe('canceling');
    const next = f.client.signIn();
    expect(f.sent('account/login/start')).toHaveLength(1);
    await cancel; await next;
    expect(f.client.stats.boots).toBe(2);
    expect(f.sent('account/login/start')).toHaveLength(2);
    expect(f.client.login.state).toBe('waiting');
    expect(f.client.chatGPTSignedIn).toBe(false);
  });

  it('also stops an expired OAuth flow when its cancellation request hangs', async () => {
    const f = setup({ signedIn: false, env: { FAKE_CODEX_CANCEL: 'hang' }, client: { loginTimeoutMs: 100, timeouts: { requestMs: 200 } } });
    await f.client.start(); await f.client.signIn();
    await until(() => f.client.stats.boots === 2 && f.client.login.state === 'error');
    expect(f.client.status.state).toBe('login');
    expect(f.client.chatGPTSignedIn).toBe(false);
    expect(f.client.login.error).toMatch(/timed out/);
  });

  it('removes credentials saved while cancellation was hanging before allowing another sign-in', async () => {
    const f = setup({ signedIn: false, env: { FAKE_CODEX_LOGIN: 'success', FAKE_CODEX_CANCEL: 'hang' }, client: { timeouts: { requestMs: 200 } } });
    await f.client.start(); await f.client.signIn();
    const statuses: string[] = [];
    f.client.onStatus(status => statuses.push(status.state));
    await f.client.cancelSignIn();
    expect(f.sent('account/logout')).toHaveLength(1);
    expect(f.client.chatGPTSignedIn).toBe(false);
    expect(f.client.status.state).toBe('login');
    expect(statuses).not.toContain('ok');
    await f.client.retry();
    expect(f.client.chatGPTSignedIn).toBe(false);
    expect(f.client.status.state).toBe('login');
    await f.client.signIn();
    expect(f.client.login.state).toBe('waiting');
  });

  it('also unwinds a completed account when canceled during confirmation', async () => {
    const f = setup({ signedIn: false, env: { FAKE_CODEX_LOGIN: 'completed-only', FAKE_CODEX_CONFIRM: 'delay' } });
    await f.client.start(); await f.client.signIn();
    await until(() => f.client.login.state === 'checking');
    await f.client.cancelSignIn();
    expect(f.sent('account/logout')).toHaveLength(1);
    expect(f.client.chatGPTSignedIn).toBe(false);
    expect(f.client.ready).toBe(false);
    expect(f.client.login.state).toBe('idle');
  });

  it('does not make a canceled account usable if clearing its credentials fails', async () => {
    const f = setup({ signedIn: false, env: { FAKE_CODEX_LOGIN: 'success', FAKE_CODEX_CANCEL: 'hang', FAKE_CODEX_LOGOUT: 'error' }, client: { timeouts: { requestMs: 200 } } });
    await f.client.start(); await f.client.signIn();
    await f.client.cancelSignIn();
    expect(f.client.ready).toBe(false);
    expect(f.client.login.state).toBe('error');
    expect(f.client.login.error).toMatch(/cancellation could not be completed/);
    await expect(f.client.signIn()).rejects.toThrow('finish canceling');
    await f.client.stop();
    // Reopening the app must finish the cancellation before adopting credentials.
    const reopened = setup({ signedIn: false, client: { home: { path: f.home, isolated: true } } });
    await reopened.client.start();
    expect(reopened.sent('account/logout')).toHaveLength(1);
    expect(reopened.client.chatGPTSignedIn).toBe(false);
    expect(reopened.client.status.state).toBe('login');
  });

  it('requires explicit sign-out before starting a different ChatGPT login', async () => {
    const f = setup(); await f.client.start();
    await expect(f.client.signIn()).rejects.toThrow('Sign out before');
    expect(f.sent('account/login/start')).toHaveLength(0);
  });

  it('honors explicit cancellation that joins cleanup started by a confirmation error', async () => {
    const f = setup({ signedIn: false, env: { FAKE_CODEX_LOGIN: 'completed-only', FAKE_CODEX_CONFIRM: 'error-once', FAKE_CODEX_CANCEL: 'delay' } });
    await f.client.start(); await f.client.signIn();
    await until(() => f.sent('account/login/cancel').length === 1);
    expect(f.client.login.state).toBe('canceling');
    const statuses: string[] = [];
    f.client.onStatus(status => statuses.push(status.state));
    await f.client.cancelSignIn();
    expect(f.client.login.state).toBe('idle');
    expect(f.client.chatGPTSignedIn).toBe(false);
    expect(f.client.status.state).toBe('login');
    expect(statuses).not.toContain('ok');
    expect(f.sent('account/logout')).toHaveLength(1);
    await f.client.retry();
    expect(f.client.chatGPTSignedIn).toBe(false);
  });

  it('keeps repeated explicit cancellation idempotent while the replacement process finishes booting', async () => {
    const f = setup({ signedIn: false, env: { FAKE_CODEX_MODELS_DELAY_MS: '150' } });
    await f.client.start(); await f.client.signIn();
    const canceled = f.client.cancelSignIn();
    await until(() => f.sent('model/list').length === 2);
    await Promise.all([canceled, f.client.cancelSignIn()]);
    expect(f.client.stats.boots).toBe(2);
    expect(f.client.login.state).toBe('idle');
    expect(f.client.status.state).toBe('login');
    expect(f.client.chatGPTSignedIn).toBe(false);
  });

  it('keeps an in-progress sign-in alive when settings are requested', async () => {
    const f = setup({ signedIn: false }); await f.client.start(); await f.client.signIn();
    await expect(f.client.configure({ model: '', effort: '', fork: false })).rejects.toThrow('Complete or cancel');
    expect(f.client.login.state).toBe('waiting'); expect(f.sent('initialize')).toHaveLength(1);
  });

  it('changes model, effort and conversation-copy settings for the next request', async () => {
    const f = setup(); await f.client.start();
    await f.client.configure({ model: 'gpt-6-luna', effort: 'low', fork: true });
    expect(f.client.status.model).toBe('GPT-6-Luna');
    expect(f.client.ready).toBe(true);
  });
});
