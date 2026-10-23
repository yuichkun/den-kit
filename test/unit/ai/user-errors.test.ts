import { describe, expect, it } from 'vite-plus/test';
import { aiFailure, aiUnavailable } from '../../../desktop/page/ai-wording.ts';

describe('installed-app AI recovery', () => {
  it.each(['connection-timeout', 'response-timeout'])(
    'explains %s without exposing service diagnostics',
    code => {
      const message = aiFailure({
        code,
        message: 'Connection refused at a private proxy endpoint',
      });
      expect(message).toMatch(/Check your internet connection/);
      expect(message).toMatch(/send your request again/);
      expect(message).not.toMatch(/proxy|endpoint/);
    },
  );
  it('offers Settings for sign-in and reconnecting for a lost connection', () => {
    expect(aiUnavailable(true, 'login')).toMatch(/Sign in with ChatGPT in Settings/);
    expect(aiUnavailable(false, 'login')).toMatch(/AI status to reconnect/);
  });

  it('keeps backend details and terminal instructions out of request failures', () => {
    const backend = 'Codex crashed reading /private/auth.json; token=private-key; run npm ci';
    for (const code of ['login', 'crashed', 'unknown']) {
      const message = aiFailure({ code, message: backend, fix: 'Set KIT_CODEX_BIN in .env.' });
      expect(message).not.toMatch(/Codex|auth\.json|private-key|npm ci|KIT_CODEX_BIN|\.env/);
      expect(message).toMatch(/Settings|request again|sending it again|reconnect/);
    }
  });

  it('uses account usage recovery for a limit failure instead of asking for installation', () => {
    const message = aiFailure({ code: 'failed', message: 'HTTP 429: usage limit reached' });
    expect(message).toMatch(/ChatGPT usage limit/);
    expect(message).toMatch(/Settings/);
    expect(message).not.toMatch(/restart|terminal|npm/);
  });

  it('can recover an expired account even when Settings still shows it as signed in', () => {
    for (const detail of ['HTTP 401 Unauthorized', 'ChatGPT refresh token expired']) {
      const message = aiFailure({
        code: 'request',
        message: `${detail}; token=private-key; run npm ci`,
        fix: 'Set KIT_CODEX_BIN in .env.',
      });
      expect(message).toMatch(/Open Settings/);
      expect(message).toMatch(/Sign out if you are signed in, then sign in with ChatGPT/);
      expect(message).toMatch(/send your request again/);
      expect(message).not.toMatch(/401|Unauthorized|token|private-key|npm ci|KIT_CODEX_BIN|\.env/);
    }
    const signedOut = aiFailure({ code: 'login', message: 'Codex is not signed in.' });
    expect(signedOut).toMatch(/Sign in with ChatGPT in Settings/);
    expect(signedOut).not.toMatch(/Sign out/);
  });
});
