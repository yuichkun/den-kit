// Exercise the desktop renderer with a native API stand-in and the real Vue UI.
// No Electron instance, external account, or BrowserPod service is used here.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { DesktopInfo } from '../../src/desktop/api.ts';
import { openKit, startAudio, startHarness, type Harness } from './harness.ts';

const info = (overrides: Partial<DesktopInfo> = {}): DesktopInfo => ({
  version: '0.1.0',
  settings: { model: '', effort: '', fork: true },
  models: [
    {
      id: 'gpt-6.1-sol',
      name: 'GPT-6.1-Codex',
      isDefault: true,
      efforts: ['low', 'medium', 'high'],
    },
    { id: 'gpt-6-luna', name: 'GPT-6-Luna', isDefault: false, efforts: ['low', 'medium'] },
  ],
  codex: { state: 'login', detail: 'Codex is not signed in.', fix: 'Run npm run codex:login.' },
  podConfigured: true,
  login: 'idle',
  aiBusy: false,
  chatGPTSignedIn: false,
  update: { state: 'off' },
  ...overrides,
});

function nativeAPI(token: string, initial: DesktopInfo): string {
  return `(() => {
    const fixture = window.__desktopTest = { info: ${JSON.stringify(initial)}, saved: [], calls: [], captures: [], holdCapture: false, finishCapture: null, captureResult: null };
    window.denKitShell = {
      runtime: { token: ${JSON.stringify(token)}, apiKey: null },
      info: async () => structuredClone(fixture.info),
      saveSettings: async settings => {
        fixture.saved.push(structuredClone(settings));
        fixture.info.settings = structuredClone(settings);
        return structuredClone(fixture.info);
      },
      signIn: async () => { fixture.calls.push('signIn'); fixture.info.login = 'waiting'; },
      cancelSignIn: async () => { fixture.calls.push('cancelSignIn'); fixture.info.login = 'idle'; },
      signOut: async () => { fixture.calls.push('signOut'); fixture.info.codex = { state: 'login' }; fixture.info.chatGPTSignedIn = false; },
      reconnectAI: async () => {
        fixture.calls.push('reconnectAI');
        fixture.info.codex = { state: 'ok', model: 'GPT-6.1-Sol' };
        return structuredClone(fixture.info);
      },
      openUsage: async () => { fixture.calls.push('openUsage'); },
      checkForUpdates: async () => {
        fixture.calls.push('checkForUpdates');
        fixture.info.update = { state: 'current' };
        return structuredClone(fixture.info);
      },
      installUpdate: async () => { fixture.calls.push('installUpdate'); },
      capturePage: async rect => {
        fixture.captures.push(structuredClone(rect));
        const canvas = document.createElement('canvas');
        canvas.width = rect.width; canvas.height = rect.height;
        const context = canvas.getContext('2d');
        context.fillStyle = '#202830'; context.fillRect(0, 0, canvas.width, canvas.height);
        const image = canvas.toDataURL('image/png');
        if (fixture.holdCapture) return new Promise(resolve => { fixture.finishCapture = () => resolve(image); });
        return image;
      },
    };
  })();`;
}

describe('desktop interface', () => {
  let h: Harness;
  before(async () => {
    h = await startHarness({ codex: { signedIn: false } });
  });
  after(async () => {
    await h?.close();
  });

  it('shows sign-in states honestly, keeps connection plumbing out of settings, and offers no voice input', async () => {
    const { page, errors } = await openKit(h, {
      start: false,
      initScript: nativeAPI(h.bridge!.token, info()),
    });
    try {
      assert.doesNotMatch(
        await page.locator('[data-testid=start-overlay]').innerText(),
        /hold and talk|voice|microphone/i,
      );
      assert.equal(await page.locator('[data-testid=ai-mic]').count(), 0);
      assert.equal(await page.locator('[data-testid=ai-voice-lang]').count(), 0);
      await startAudio(page);
      await page.click('[data-testid=desktop-settings-open]');
      const dialog = page.locator('[data-testid=desktop-settings]');
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid=desktop-account]')
          ?.textContent?.includes('Not signed in'),
      );
      assert.equal(await page.locator('[data-testid=desktop-sign-out]').count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Manage usage' }).count(), 0);
      assert.doesNotMatch(
        await dialog.innerText(),
        /BrowserPod|Escentier|Codex is|Starting Codex|Codex crashed|\bLLM\b|copy the conversation|fork|npm run|API key/i,
      );
      assert.equal(
        await page.locator('[data-testid=desktop-model] option[value="gpt-6.1-sol"]').textContent(),
        'GPT-6.1-Codex',
      );
      assert.equal(await dialog.locator('input[type=checkbox]').count(), 0);

      await page.click('[data-testid=desktop-sign-in]');
      await page.getByRole('button', { name: 'Cancel sign-in' }).waitFor();
      assert.match(
        await page.locator('[data-testid=desktop-account]').innerText(),
        /Waiting for sign-in/,
      );
      assert.equal(await page.locator('[data-testid=desktop-model]').isDisabled(), true);
      assert.equal(await page.locator('[data-testid=desktop-settings-save]').isDisabled(), true);
      await page.getByRole('button', { name: 'Cancel sign-in' }).click();
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid=desktop-account]')
          ?.textContent?.includes('Not signed in'),
      );
      assert.deepEqual(await page.evaluate(() => (window as any).__desktopTest.calls), [
        'signIn',
        'cancelSignIn',
      ]);

      await page.evaluate(() => {
        (window as any).__desktopTest.info.codex = {
          state: 'starting',
          detail: 'Starting Codex app-server…',
        };
      });
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid=desktop-account]')
          ?.textContent?.includes('Connecting to ChatGPT'),
      );
      assert.equal(await page.locator('[data-testid=desktop-sign-out]').count(), 0);
      await page.evaluate(() => {
        (window as any).__desktopTest.info.codex = {
          state: 'error',
          detail: 'Codex crashed at /private/auth.json.',
          fix: 'Run npm ci in .desktop-build.',
        };
      });
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid=desktop-account]')
          ?.textContent?.includes('Could not connect to ChatGPT'),
      );
      assert.doesNotMatch(
        await dialog.innerText(),
        /Codex crashed|\/private\/auth|npm ci|\.desktop-build/,
      );
      assert.equal(await page.locator('[data-testid=desktop-sign-in]').count(), 0);
      assert.equal(await page.locator('[data-testid=desktop-reconnect]').isEnabled(), true);
      await page.click('[data-testid=desktop-reconnect]');
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid=desktop-account]')
          ?.textContent?.includes('Not signed in'),
      );
      assert.deepEqual(await page.evaluate(() => (window as any).__desktopTest.calls), [
        'signIn',
        'cancelSignIn',
        'reconnectAI',
      ]);
      assert.equal(await page.locator('[data-testid=desktop-sign-in]').isVisible(), true);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('saves chosen model and effort without resetting an existing conversation setting', async () => {
    const { page, errors } = await openKit(h, {
      initScript: nativeAPI(
        h.bridge!.token,
        info({ codex: { state: 'ok', plan: 'plus', model: 'GPT-6.1-Sol' }, chatGPTSignedIn: true }),
      ),
    });
    try {
      await page.click('[data-testid=desktop-settings-open]');
      await page.waitForFunction(() =>
        document.querySelector('[data-testid=desktop-account]')?.textContent?.includes('Signed in'),
      );
      assert.equal(await page.locator('[data-testid=desktop-sign-in]').count(), 0);
      await page.selectOption('[data-testid=desktop-model]', 'gpt-6-luna');
      await page.selectOption('[data-testid=desktop-effort]', 'low');
      await page.click('[data-testid=desktop-settings-save]');
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid=desktop-settings] .actions [role=status]')
          ?.textContent?.includes('Saved'),
      );
      assert.deepEqual(await page.evaluate(() => (window as any).__desktopTest.saved), [
        { model: 'gpt-6-luna', effort: 'low', fork: true },
      ]);
      await page.getByRole('button', { name: 'Close settings' }).click();
      await page.click('[data-testid=desktop-settings-open]');
      await page.waitForFunction(
        () =>
          (document.querySelector('[data-testid=desktop-model]') as HTMLSelectElement)?.value ===
          'gpt-6-luna',
      );
      assert.equal(await page.locator('[data-testid=desktop-effort]').inputValue(), 'low');
      assert.doesNotMatch(
        await page.locator('[data-testid=desktop-settings]').innerText(),
        /BrowserPod|Escentier|copy the conversation|fork/i,
      );
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('does not call a ready transport a signed-in ChatGPT account or offer account actions for it', async () => {
    const { page, errors } = await openKit(h, {
      initScript: nativeAPI(
        h.bridge!.token,
        info({ codex: { state: 'ok', plan: 'plus' }, chatGPTSignedIn: false }),
      ),
    });
    try {
      await page.click('[data-testid=desktop-settings-open]');
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid=desktop-account]')
          ?.textContent?.includes('Not signed in'),
      );
      assert.equal(await page.locator('[data-testid=desktop-sign-in]').isVisible(), true);
      assert.equal(await page.locator('[data-testid=desktop-sign-out]').count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Manage usage' }).count(), 0);
      assert.doesNotMatch(
        await page.locator('[data-testid=desktop-account]').innerText(),
        /plus|Signed in/,
      );
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('reconnects a failed AI connection without signing out or starting authentication again', async () => {
    const { page, errors } = await openKit(h, {
      initScript: nativeAPI(
        h.bridge!.token,
        info({
          codex: { state: 'error', detail: 'Codex app-server disconnected' },
          chatGPTSignedIn: true,
        }),
      ),
    });
    try {
      await page.click('[data-testid=desktop-settings-open]');
      await page.locator('[data-testid=desktop-reconnect]').waitFor();
      assert.equal(await page.locator('[data-testid=desktop-sign-in]').count(), 0);
      assert.equal(await page.locator('[data-testid=desktop-sign-out]').count(), 0);
      await page.click('[data-testid=desktop-reconnect]');
      await page.waitForFunction(() =>
        document.querySelector('[data-testid=desktop-account]')?.textContent?.includes('Signed in'),
      );
      assert.equal(await page.locator('[data-testid=desktop-sign-out]').isVisible(), true);
      assert.deepEqual(await page.evaluate(() => (window as any).__desktopTest.calls), [
        'reconnectAI',
      ]);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('prevents settings changes during an AI request and enables them after it ends', async () => {
    const { page } = await openKit(h, {
      initScript: nativeAPI(h.bridge!.token, info({ codex: { state: 'ok' }, aiBusy: true })),
    });
    try {
      await page.click('[data-testid=desktop-settings-open]');
      await page.locator('[data-testid=desktop-model]').waitFor();
      for (const id of ['desktop-model', 'desktop-effort', 'desktop-settings-save'])
        assert.equal(await page.locator(`[data-testid=${id}]`).isDisabled(), true, id);
      await page.evaluate(() => {
        (window as any).__desktopTest.info.aiBusy = false;
      });
      await page.waitForFunction(
        () =>
          !(document.querySelector('[data-testid=desktop-settings-save]') as HTMLButtonElement)
            ?.disabled,
      );
      for (const id of ['desktop-model', 'desktop-effort', 'desktop-settings-save'])
        assert.equal(await page.locator(`[data-testid=${id}]`).isEnabled(), true, id);
      assert.deepEqual(await page.evaluate(() => (window as any).__desktopTest.saved), []);
    } finally {
      await page.close();
    }
  });

  it('routes a sign-in-required request to actionable desktop settings without terminal instructions', async () => {
    const { page, errors } = await openKit(h, { initScript: nativeAPI(h.bridge!.token, info()) });
    try {
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid=ai-status-codex]')?.getAttribute('data-state') ===
          'login',
      );
      assert.match(
        await page.locator('[data-testid=ai-status-codex]').innerText(),
        /ChatGPT: sign in/,
      );
      assert.doesNotMatch(
        (await page.locator('[data-testid=ai-status-codex]').getAttribute('title')) ?? '',
        /Codex|npm run|\.env|app-server/,
      );
      await page.fill('[data-testid=ai-input]', 'add reverb');
      await page.press('[data-testid=ai-input]', 'Enter');
      await page.waitForFunction(
        () => (window as any).__kit.requests.history.value.at(-1)?.status === 'failed',
      );
      assert.match(
        await page.locator('[data-testid=ai-panel]').innerText(),
        /Sign in with ChatGPT in Settings/,
      );
      assert.doesNotMatch(
        await page.locator('[data-testid=ai-panel]').innerText(),
        /Codex|\bLLM\b|npm run|\.env|app-server/,
      );
      await page.click('[data-testid=ai-status-codex]');
      await page.locator('[data-testid=desktop-settings]').waitFor();
      assert.equal(await page.locator('[data-testid=desktop-sign-in]').isVisible(), true);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('shares the app window only after the eye is enabled and discards a capture stopped in flight', async () => {
    const { page, errors } = await openKit(h, { initScript: nativeAPI(h.bridge!.token, info()) });
    try {
      const requestsBefore = h.codex!.sent('turn/start').length;
      const sharing = () =>
        page.evaluate(() => ({
          state: (window as any).__kit.screen.state.value,
          source: (window as any).__kit.screen.source,
          captures: (window as any).__desktopTest.captures.length,
        }));
      const tryPicture = () =>
        page.evaluate(async () => {
          try {
            await (window as any).__kit.screen.picture({ x: 0, y: 0, width: 80, height: 60 });
            return 'captured';
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        });
      assert.deepEqual(await sharing(), { state: 'off', source: null, captures: 0 });
      assert.equal(
        await page.locator('[data-testid=ai-screen]').getAttribute('aria-pressed'),
        'false',
      );
      assert.match(await tryPicture(), /not shared/i);
      assert.equal(
        (await sharing()).captures,
        0,
        'An off screen must not call the native capture API.',
      );

      await page.click('[data-testid=ai-screen]');
      assert.equal(
        await page.locator('[data-testid=ai-screen]').getAttribute('aria-pressed'),
        'true',
      );
      assert.deepEqual(await sharing(), { state: 'on', source: 'shell', captures: 0 });
      const picture = await page.evaluate(async () => {
        const image = await (window as any).__kit.screen.picture({
          x: 0,
          y: 0,
          width: 80,
          height: 60,
        });
        return {
          source: image.source,
          width: image.width,
          height: image.height,
          bytes: image.data.length,
        };
      });
      assert.equal(picture.source, 'shell');
      assert.equal(picture.width, 80);
      assert.equal(picture.height, 60);
      assert.ok(picture.bytes > 0);
      assert.deepEqual(await page.evaluate(() => (window as any).__desktopTest.captures), [
        { x: 0, y: 0, width: 80, height: 60 },
      ]);
      await page.click('[data-testid=ai-screen]');
      assert.deepEqual(await sharing(), { state: 'off', source: null, captures: 1 });
      assert.match(await tryPicture(), /not shared/i);
      assert.equal((await sharing()).captures, 1);

      await page.click('[data-testid=ai-screen]');
      await page.evaluate(() => {
        const fixture = (window as any).__desktopTest;
        fixture.holdCapture = true;
        void (window as any).__kit.screen.picture({ x: 0, y: 0, width: 80, height: 60 }).then(
          () => {
            fixture.captureResult = 'captured';
          },
          (error: unknown) => {
            fixture.captureResult = error instanceof Error ? error.message : String(error);
          },
        );
      });
      await page.waitForFunction(
        () => typeof (window as any).__desktopTest.finishCapture === 'function',
      );
      await page.click('[data-testid=ai-screen]');
      await page.evaluate(() => (window as any).__desktopTest.finishCapture());
      await page.waitForFunction(() => (window as any).__desktopTest.captureResult !== null);
      assert.match(
        await page.evaluate(() => (window as any).__desktopTest.captureResult),
        /not shared|stopped/i,
      );
      assert.deepEqual(await sharing(), { state: 'off', source: null, captures: 2 });
      assert.equal(
        h.codex!.sent('turn/start').length,
        requestsBefore,
        'Toggling screen sharing must not send an AI request.',
      );
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('shows update progress, offers a restart only for a staged update and never during an AI request', async () => {
    const { page, errors } = await openKit(h, {
      initScript: nativeAPI(
        h.bridge!.token,
        info({ codex: { state: 'ok' }, update: { state: 'idle' } }),
      ),
    });
    try {
      assert.equal(await page.locator('[data-testid=desktop-update-ready]').count(), 0);
      await page.click('[data-testid=desktop-settings-open]');
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid=desktop-update]')
          ?.textContent?.includes('checks for updates automatically'),
      );
      await page.click('[data-testid=desktop-update-check]');
      await page.waitForFunction(() =>
        document.querySelector('[data-testid=desktop-update]')?.textContent?.includes('up to date'),
      );
      assert.equal(await page.locator('[data-testid=desktop-update-install]').count(), 0);

      await page.evaluate(() => {
        (window as any).__desktopTest.info.update = {
          state: 'downloading',
          version: '0.2.0',
          percent: 40,
        };
      });
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid=desktop-update]')
          ?.textContent?.includes('Downloading den-kit 0.2.0… 40%'),
      );
      assert.equal(await page.locator('[data-testid=desktop-update-install]').count(), 0);
      assert.equal(await page.locator('[data-testid=desktop-update-check]').count(), 0);

      // The toolbar learns about a staged update from the native event, not by polling.
      await page.getByRole('button', { name: 'Close settings' }).click();
      await page.evaluate(() => {
        (window as any).__desktopTest.info.update = { state: 'ready', version: '0.2.0' };
        window.dispatchEvent(new Event('den-kit:update'));
      });
      await page.locator('[data-testid=desktop-update-ready]').waitFor();
      await page.click('[data-testid=desktop-update-ready]');
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid=desktop-update]')
          ?.textContent?.includes('den-kit 0.2.0 is ready'),
      );
      assert.match(
        await page.locator('[data-testid=desktop-settings]').innerText(),
        /Your work is saved before den-kit restarts/,
      );

      await page.evaluate(() => {
        (window as any).__desktopTest.info.aiBusy = true;
      });
      await page.waitForFunction(
        () =>
          (document.querySelector('[data-testid=desktop-update-install]') as HTMLButtonElement)
            ?.disabled,
      );
      await page.evaluate(() => {
        (window as any).__desktopTest.info.aiBusy = false;
      });
      await page.waitForFunction(
        () =>
          !(document.querySelector('[data-testid=desktop-update-install]') as HTMLButtonElement)
            ?.disabled,
      );
      await page.click('[data-testid=desktop-update-install]');
      await page.waitForFunction(() =>
        (window as any).__desktopTest.calls.includes('installUpdate'),
      );
      assert.deepEqual(await page.evaluate(() => (window as any).__desktopTest.calls), [
        'checkForUpdates',
        'installUpdate',
      ]);
      assert.doesNotMatch(
        await page.locator('[data-testid=desktop-settings]').innerText(),
        /GitHub|Squirrel|latest-mac|zip|Escentier/i,
      );
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('asks for the Applications folder instead of offering update checks that cannot install', async () => {
    const { page, errors } = await openKit(h, {
      initScript: nativeAPI(h.bridge!.token, info({ update: { state: 'move' } })),
    });
    try {
      await page.click('[data-testid=desktop-settings-open]');
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid=desktop-update]')
          ?.textContent?.includes('Applications folder'),
      );
      assert.equal(await page.locator('[data-testid=desktop-update-check]').count(), 0);
      assert.equal(await page.locator('[data-testid=desktop-update-install]').count(), 0);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('offers reopening instead of a retry after a live preview startup timeout', async () => {
    const { page, errors } = await openKit(h, { initScript: nativeAPI(h.bridge!.token, info()) });
    try {
      await page.evaluate(() => {
        const pod = (window as any).__kit.pod;
        pod.factory.kind = 'fake';
        pod.host = { kind: 'fake' };
        pod.dev = {
          name: 'dev',
          running: true,
          done: new Promise(() => undefined),
          output: () => '',
        };
        pod.state.value = 'failed';
        pod.message.value = 'The project preview did not become ready in time.';
        pod.fix.value = 'Close and reopen den-kit, then try again.';
      });
      await page.click('[data-testid=view-project]');
      await page.locator('[data-testid=project-view]').waitFor();
      assert.equal(await page.locator('[data-testid=pod-start]').count(), 0);
      assert.match(
        await page.locator('[data-testid=pod-fix]').innerText(),
        /Close and reopen den-kit/,
      );
      assert.equal(await page.evaluate(() => (window as any).__kit.pod.dev.running), true);
      assert.equal(
        await page.locator('[data-testid=project-diagnostics]').getAttribute('open'),
        null,
      );
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
});
