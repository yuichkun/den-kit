import { describe, expect, it, vi } from 'vite-plus/test';
import { openChatGPTSignIn } from '../../../desktop/sign-in.ts';

describe('opening ChatGPT sign-in', () => {
  it('keeps a valid login active after opening the browser', async () => {
    const account = {
      signIn: async () => 'https://auth.openai.com/oauth/authorize?state=test',
      cancelSignIn: vi.fn(async () => {}),
    };
    const open = vi.fn(async () => {});
    await openChatGPTSignIn(account, open);
    expect(open).toHaveBeenCalledWith(await account.signIn());
    expect(account.cancelSignIn).not.toHaveBeenCalled();
  });

  it.each(['https://unexpected.example/', 'https://auth.openai.com/', 'invalid-url'])(
    'cancels an unusable browser flow for %s',
    async url => {
      const account = { signIn: async () => url, cancelSignIn: vi.fn(async () => {}) };
      const open = vi.fn(async () => {
        throw new Error('Browser launch failed.');
      });
      await expect(openChatGPTSignIn(account, open)).rejects.toThrow('browser');
      expect(account.cancelSignIn).toHaveBeenCalledOnce();
      if (url !== 'https://auth.openai.com/') expect(open).not.toHaveBeenCalled();
    },
  );
});
