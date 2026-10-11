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
    await until(() => f.client.login.state === 'complete' && f.sent('account/read').length > reads);
    expect(f.client.chatGPTSignedIn).toBe(false);
    expect(f.client.ready).toBe(true);
    expect(f.client.stats.boots).toBe(boots);
    expect(f.violations()).toEqual([]);
  });

  it('cancels a pending sign-in without accepting its failure as a new login', async () => {
    const f = setup({ signedIn: false }); await f.client.start();
    await f.client.signIn(); await f.client.cancelSignIn();
    expect(f.client.login).toEqual({ state: 'idle', error: undefined });
    expect(f.client.ready).toBe(false);
    expect(f.sent('account/login/cancel')).toHaveLength(1);
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
