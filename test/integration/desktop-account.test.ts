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
    expect(f.client.status.fix).toBe('Open Settings.');
    const url = await f.client.signIn();
    expect(new URL(url).hostname).toBe('auth.openai.com');
    expect(f.client.login.state).toBe('waiting');
    await until(() => f.client.ready);
    expect(f.client.login.state).toBe('complete');
    expect(f.client.models.map(m => m.id)).toContain('gpt-6.1-sol');
    await f.client.signOut();
    expect(f.client.status.state).toBe('login');
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
