// Real production renderer + bundled native Codex in Electron; no Vite and no global Codex.
import { _electron as electron } from 'playwright';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { packagedMacApp } from './desktop-paths.ts';
import { waitForShell } from './desktop-shell.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const appIndex = process.argv.indexOf('--app');
const appPath = appIndex < 0 ? undefined : process.argv[appIndex + 1];
if (
  appIndex >= 0 &&
  (!appPath ||
    appPath.startsWith('--') ||
    !existsSync(join(resolve(appPath), 'Contents/MacOS/den-kit')))
)
  throw new Error('--app requires the path of a built den-kit.app bundle.');
const packagedApp = appPath ? resolve(appPath) : packagedMacApp(root);
const profile = mkdtempSync(join(tmpdir(), 'den-kit-electron-check-'));
const real = process.argv.includes('--real');
const packaged = process.argv.includes('--packaged') || !!appPath;
const quick = process.argv.includes('--quick');
const skipAI = process.argv.includes('--skip-ai');
const aiPod = process.argv.includes('--ai-pod');
const imageIndex = process.argv.indexOf('--image');
const imagePath = imageIndex < 0 ? null : process.argv[imageIndex + 1];
if (imageIndex >= 0 && (!real || !imagePath || !existsSync(imagePath)))
  throw new Error(
    '--image requires --real and the path of a PNG explicitly approved for sending to ChatGPT.',
  );
if (aiPod && (!real || quick)) throw new Error('--ai-pod requires --real without --quick.');
const operator = JSON.parse(
  readFileSync(
    packaged
      ? join(packagedApp, 'Contents/Resources/operator.json')
      : join(root, '.desktop-build/resources/operator.json'),
    'utf8',
  ),
);
let imageCheck: { sha256: string; bytes: number; reply: string; ms: number } | undefined;
let aiPodCheck: { status: string; reply?: string; ms: number; checks: string[] } | undefined;
let podDiskCheck: { persistent: boolean; rebootMs: number; packagesReused: boolean } | undefined;
const diskMarker = randomUUID();
if (real && existsSync(join(root, '.codex-home/auth.json'))) {
  mkdirSync(join(profile, 'codex'), { mode: 0o700 });
  copyFileSync(join(root, '.codex-home/auth.json'), join(profile, 'codex/auth.json'));
  chmodSync(join(profile, 'codex/auth.json'), 0o600);
}
// Keep one isolated origin across restarts without claiming the installed app's port.
const checkPort = await new Promise<number>((resolvePort, reject) => {
  const server = createServer();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const port = (server.address() as { port: number }).port;
    server.close(error => (error ? reject(error) : resolvePort(port)));
  });
});
const launch = () =>
  electron.launch({
    ...(packaged ? { executablePath: join(packagedApp, 'Contents/MacOS/den-kit') } : {}),
    args: [
      ...(packaged ? [] : [join(root, '.desktop-build/app')]),
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
    cwd: root,
    env: {
      ...process.env,
      KIT_DESKTOP_USER_DATA: profile,
      KIT_DESKTOP_CHECK_PORT: String(checkPort),
    },
    timeout: 60000,
  });
let app = await launch().catch(error => {
  rmSync(join(profile, 'codex/auth.json'), { force: true });
  throw error;
});
const errors: string[] = [];
app.process().stderr?.on('data', data => {
  const line = String(data);
  if (/Uncaught|ERR_FAILED/.test(line)) errors.push(line.slice(0, 1000));
});
try {
  let page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => !!(window as unknown as { __kit?: unknown }).__kit, undefined, {
    timeout: 60000,
  });
  await waitForShell(page, info => ['login', 'ok', 'error'].includes(info.codex.state));
  assert.deepEqual(
    await page.evaluate(() => {
      const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession })
        .__kit;
      return { state: k.screen.state.value, source: k.screen.source };
    }),
    { state: 'off', source: null },
  );
  await page.waitForTimeout(3000);
  const facts = await page.evaluate(async () => {
    const info = await window.denKitShell!.info();
    return {
      origin: location.origin,
      isolated: crossOriginIsolated,
      secure: isSecureContext,
      node: typeof (window as unknown as { require?: unknown }).require,
      codex: info.codex.state,
      models: info.models.length,
      podConfigured: info.podConfigured,
      speechRecognition: typeof (window as unknown as { webkitSpeechRecognition?: unknown })
        .webkitSpeechRecognition,
    };
  });
  console.log(JSON.stringify({ profile, facts }));
  console.log(
    JSON.stringify({ account: (await page.evaluate(() => window.denKitShell!.info())).codex }),
  );
  assert.equal(facts.origin, `http://127.0.0.1:${checkPort}`);
  assert.equal(facts.isolated, true);
  assert.equal(facts.secure, true);
  assert.equal(facts.node, 'undefined');
  assert.equal(facts.podConfigured, true);
  assert.equal(
    await page.evaluate(key => window.denKitShell!.runtime.apiKey === key, operator.browserPodKey),
    true,
  );
  console.log(JSON.stringify({ podKeyMatchesBundle: true }));
  console.log(
    JSON.stringify(
      await app.evaluate(({ app }) => ({
        packaged: app.isPackaged,
        data: app.getPath('userData'),
        version: app.getVersion(),
      })),
    ),
  );
  const menuRoles = await app.evaluate(({ Menu }) => {
    const roles = (items: Electron.MenuItem[]): string[] =>
      items.flatMap(item => [item.role ?? '', ...roles(item.submenu?.items ?? [])]);
    return roles(Menu.getApplicationMenu()?.items ?? []);
  });
  assert.equal(
    menuRoles.includes('toggledevtools'),
    false,
    'The ordinary app menu must not expose developer tools.',
  );
  await page.keyboard.press('Escape');
  if (await page.locator('[data-testid=start-overlay]').count())
    await page.click('[data-testid=start-overlay]');
  await page.click('[data-testid=desktop-settings-open]');
  await page.waitForSelector('[data-testid=desktop-account], [data-testid=desktop-sign-in]');
  assert.doesNotMatch(
    await page.locator('[data-testid=desktop-settings]').innerText(),
    /BrowserPod|Escentier|Codex is|Starting Codex|app-server|codex:login|\bLLM\b|copy the conversation|fork|API key/i,
  );
  assert.equal(
    await page.locator('[data-testid=desktop-settings] input[type=checkbox]').count(),
    0,
  );
  await page.screenshot({ path: join(profile, 'settings.png') });
  if (!real) {
    assert.match(await page.locator('[data-testid=desktop-account]').innerText(), /Not signed in/);
    assert.equal(await page.locator('[data-testid=desktop-sign-out]').count(), 0);
    // Exercise the real native OAuth start/cancel without opening or submitting an external browser form.
    await app.evaluate(({ shell }) => {
      shell.openExternal = async (url: string) => {
        (globalThis as unknown as { signInHost: string }).signInHost = new URL(url).hostname;
      };
    });
    await page.click('[data-testid=desktop-sign-in]');
    await page.getByRole('button', { name: 'Cancel sign-in' }).waitFor();
    assert.equal(
      await app.evaluate(() => (globalThis as unknown as { signInHost: string }).signInHost),
      'auth.openai.com',
    );
    await page.getByRole('button', { name: 'Cancel sign-in' }).click();
    // Cancellation settles asynchronously and may restart Codex: wait until sign-in is offered again.
    await page.locator('[data-testid=desktop-sign-in]').waitFor({ timeout: 60000 });
    await waitForShell(page, info => info.login === 'idle' && info.codex.state === 'login', {
      timeout: 30000,
    });
    console.log(JSON.stringify({ nativeSignIn: 'started and canceled' }));
  }
  // Seed a previously saved advanced setting, then save only the ordinary settings through the UI.
  await page.evaluate(() =>
    window.denKitShell!.saveSettings({ model: '', effort: '', fork: true }),
  );
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.click('[data-testid=desktop-settings-open]');
  await waitForShell(page, info => !info.aiBusy);
  await page.waitForFunction(
    () =>
      !(document.querySelector('[data-testid=desktop-settings-save]') as HTMLButtonElement)
        ?.disabled,
  );
  await page.click('[data-testid=desktop-settings-save]');
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid=desktop-settings] .actions [role=status]')
      ?.textContent?.includes('Saved'),
  );
  assert.equal((await page.evaluate(() => window.denKitShell!.info())).settings.fork, true);
  await page.getByRole('button', { name: 'Close settings' }).click();
  const offCapture = () =>
    page.evaluate(async () => {
      const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession })
        .__kit;
      try {
        await k.screen.picture({ x: 0, y: 0, width: 400, height: 300 });
        return 'captured';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
  assert.match(await offCapture(), /not shared/i);
  const historyBeforeCapture = await page.evaluate(
    () =>
      (window as unknown as { __kit: import('../src/editor/session.ts').KitSession }).__kit
        .requests!.history.value.length,
  );
  await page.click('[data-testid=ai-screen]');
  assert.equal(await page.locator('[data-testid=ai-screen]').getAttribute('aria-pressed'), 'true');
  const picture = await page.evaluate(async () => {
    const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession }).__kit;
    const image = await k.screen.picture({ x: 0, y: 0, width: 400, height: 300 });
    return {
      source: image.source,
      width: image.width,
      height: image.height,
      bytes: image.data.length,
    };
  });
  assert.equal(picture.source, 'shell');
  assert.equal(picture.width, 400);
  assert.equal(picture.height, 300);
  assert.ok(picture.bytes > 0);
  await page.click('[data-testid=ai-screen]');
  assert.equal(await page.locator('[data-testid=ai-screen]').getAttribute('aria-pressed'), 'false');
  assert.deepEqual(
    await page.evaluate(() => {
      const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession })
        .__kit;
      return {
        state: k.screen.state.value,
        source: k.screen.source,
        requests: k.requests!.history.value.length,
      };
    }),
    { state: 'off', source: null, requests: historyBeforeCapture },
  );
  assert.match(await offCapture(), /not shared/i);
  console.log(
    JSON.stringify({ capturePage: picture, sharing: 'explicitly enabled and stopped', errors }),
  );
  assert.equal(await page.locator('[data-testid=ai-mic]').count(), 0);
  assert.equal(await page.locator('[data-testid=ai-voice-lang]').count(), 0);
  assert.equal(
    await page.locator('[data-testid=ai-input]').getAttribute('placeholder'),
    'Ask anything',
  );
  const voice = 'voice input controls are absent in the desktop app';
  console.log(JSON.stringify({ voice }));
  if (imagePath) {
    const png = readFileSync(imagePath);
    assert.equal(
      png.subarray(0, 8).toString('hex'),
      '89504e470d0a1a0a',
      'The approved image must be a PNG.',
    );
    await page.waitForFunction(
      () =>
        (window as unknown as { __kit: import('../src/editor/session.ts').KitSession }).__kit.llm!
          .ready,
    );
    const before = await page.evaluate(() =>
      JSON.stringify(
        (window as unknown as { __kit: import('../src/editor/session.ts').KitSession }).__kit.doc
          .value,
      ),
    );
    const requestId = await page.evaluate(
      image => {
        const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession })
          .__kit;
        k.llm!.settings.members = 'off';
        return k.requests!.run(
          'Read the attached test screenshot. What number is displayed on the small rectangular light-grey button in the plugin canvas? Answer only with the number. Use the supplied image; do not inspect or edit the current work or delegate.',
          {
            sketch: {
              parts: [
                {
                  view: 'plugin',
                  marks: 0,
                  text: 'Attached screenshot from an isolated Electron test profile.',
                  image,
                },
              ],
            },
          },
        ).id;
      },
      `data:image/png;base64,${png.toString('base64')}`,
    );
    await page.waitForFunction(
      id => {
        const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession })
          .__kit;
        return k.requests!.history.value.some(
          o => o.id === id && !o.live && !['thinking', 'working'].includes(o.status),
        );
      },
      requestId,
      { timeout: 180000 },
    );
    const result = await page.evaluate(id => {
      const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession })
        .__kit;
      const o = k.requests!.history.value.find(o => o.id === id)!;
      return {
        status: o.status,
        reply: o.reply ?? '',
        ms: o.ms,
        document: JSON.stringify(k.doc.value),
      };
    }, requestId);
    assert.notEqual(result.status, 'failed');
    assert.match(result.reply, /^200[.\s]*$/);
    assert.equal(result.document, before, 'Reading an image must not edit the work.');
    imageCheck = {
      sha256: createHash('sha256').update(png).digest('hex'),
      bytes: png.length,
      reply: result.reply,
      ms: result.ms,
    };
    console.log(JSON.stringify({ imageCheck }));
  }
  if (real && !skipAI) {
    await waitForShell(page, info => info.codex.state === 'ok');
    await page.waitForFunction(
      () =>
        (window as unknown as { __kit: import('../src/editor/session.ts').KitSession }).__kit.llm!
          .ready,
    );
    const before = await page.evaluate(() =>
      Object.keys(
        (window as unknown as { __kit: import('../src/editor/session.ts').KitSession }).__kit.doc
          .value.nodes,
      ),
    );
    const requestId = await page.evaluate(() => {
      const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession })
        .__kit;
      return k.requests!.run('Add one comment: Electron verified.').id;
    });
    await page.waitForFunction(
      id => {
        const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession })
          .__kit;
        return k.requests!.history.value.some(
          o => o.id === id && !o.live && !['thinking', 'working'].includes(o.status),
        );
      },
      requestId,
      { timeout: 120000 },
    );
    const edit = await page.evaluate(id => {
      const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession })
        .__kit;
      return {
        outcome: k.requests!.history.value.find(o => o.id === id),
        nodes: Object.values(k.doc.value.nodes).filter(n => n.type === 'kit.comment'),
      };
    }, requestId);
    console.log(JSON.stringify({ aiEdit: edit }));
    assert.ok(edit.nodes.some(n => JSON.stringify(n).includes('Electron verified')));
    await page.evaluate(() =>
      (window as unknown as { __kit: import('../src/editor/session.ts').KitSession }).__kit.undo(),
    );
    assert.deepEqual(
      await page.evaluate(() =>
        Object.keys(
          (window as unknown as { __kit: import('../src/editor/session.ts').KitSession }).__kit.doc
            .value.nodes,
        ),
      ),
      before,
    );
    console.log(JSON.stringify({ aiUndo: 'passed' }));
  }
  if (real && !quick) {
    await page.keyboard.press('Escape');
    if (await page.locator('[data-testid=start-overlay]').count())
      await page.click('[data-testid=start-overlay]');
    const audio = await page.evaluate(async () => {
      const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession })
        .__kit;
      k.engine.setVolume(0);
      await k.ensureAudio();
      return { state: k.engineState.value, sampleRate: k.engine.ctx?.sampleRate };
    });
    console.log(JSON.stringify({ audio }));
    const signal = await page.evaluate(async () => {
      const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession })
        .__kit;
      k.engine.noteOn(60);
      const data = new Float32Array(2048);
      let peak = 0;
      const end = performance.now() + 300;
      while (performance.now() < end) {
        k.engine.rawAnalyser!.getFloatTimeDomainData(data);
        for (const v of data) peak = Math.max(peak, Math.abs(v));
        await new Promise(r => setTimeout(r, 15));
      }
      k.engine.noteOff(60);
      return peak;
    });
    assert.ok(signal > 0.001);
    console.log(JSON.stringify({ audioSignal: signal, audibleOutputMuted: true }));
    await page.click('[data-testid=view-project]');
    assert.equal(
      await page.locator('[data-testid=project-diagnostics]').getAttribute('open'),
      null,
    );
    assert.equal(await page.locator('[data-testid=pod-check]').isVisible(), false);
    assert.doesNotMatch(
      await page.locator('[data-testid=project-view] .head').innerText(),
      /BrowserPod|Escentier|API key|npm install|dev server/,
    );
    await page.locator('[data-testid=project-diagnostics] summary').click();
    await page.click('[data-testid=pod-check]');
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(5000);
      const progress = await page.evaluate(() => {
        const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession })
          .__kit;
        return {
          state: k.pod!.state.value,
          message: k.pod!.message.value,
          log: k.pod!.log.value.slice(-1).map(l => l.output.slice(-200)),
        };
      });
      console.log(JSON.stringify({ pod: progress }));
      if (!(await page.locator('[data-testid=pod-check]').isDisabled())) break;
    }
    const check = await page.locator('[data-testid=pod-check-panel]').innerText();
    console.log(JSON.stringify({ podCheck: check }));
    assert.match(check, /Every step passed/);
    const previewBeforeReopen = await page.evaluate(async marker => {
      const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession })
        .__kit;
      const pod = k.pod!;
      const current = (pod as unknown as { dev: import('../src/host/workspace.ts').PodProcess })
        .dev;
      if (!current.running)
        throw new Error('The recovery check requires a running isolated preview.');
      const host = await pod.ensure();
      // Close immediately after a fresh write so the app's actual shutdown must flush the disk.
      const written = await host.run(`printf %s '${marker}' > .den-kit-electron-check`, {
        cwd: host.home,
      });
      if (written.exitCode !== 0)
        throw new Error('The isolated recovery disk marker could not be saved.');
      const disk = await host.run('cat .den-kit-electron-check', { cwd: host.home });
      const before = {
        document: JSON.stringify(k.doc.value),
        requests: k.requests!.history.value.length,
        disk: { exitCode: disk.exitCode, output: disk.output.trim(), timedOut: disk.timedOut },
      };
      // Simulate a preview startup timeout on the isolated running process.
      pod.state.value = 'failed';
      pod.message.value = 'The project preview did not become ready in time.';
      pod.fix.value = 'Close and reopen den-kit, then try again.';
      return before;
    }, diskMarker);
    console.log(JSON.stringify({ recoveryMarkerBeforeClose: previewBeforeReopen.disk }));
    assert.equal(previewBeforeReopen.disk.exitCode, 0);
    assert.equal(previewBeforeReopen.disk.output, diskMarker);
    assert.equal(await page.locator('[data-testid=pod-start]').count(), 0);
    assert.match(
      await page.locator('[data-testid=pod-fix]').innerText(),
      /Close and reopen den-kit/,
    );
    await app.close();
    app = await launch();
    app.process().stderr?.on('data', data => {
      const line = String(data);
      if (/Uncaught|ERR_FAILED/.test(line)) errors.push(line.slice(0, 1000));
    });
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(
      () => !!(window as unknown as { __kit?: unknown }).__kit,
      undefined,
      { timeout: 60000 },
    );
    assert.deepEqual(
      await page.evaluate(() => {
        const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession })
          .__kit;
        return { state: k.screen.state.value, source: k.screen.source };
      }),
      { state: 'off', source: null },
    );
    await page.evaluate(() =>
      (
        window as unknown as { __kit: import('../src/editor/session.ts').KitSession }
      ).__kit.engine.setVolume(0),
    );
    if (await page.locator('[data-testid=start-overlay]').count())
      await page.click('[data-testid=start-overlay]');
    const previewAfterReopen = await page.evaluate(async marker => {
      const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession })
        .__kit;
      const host = await k.pod!.ensure();
      const disk = await host.run('cat .den-kit-electron-check', { cwd: host.home });
      return {
        document: JSON.stringify(k.doc.value),
        requests: k.requests!.history.value.length,
        ready: k.pod!.state.value === 'ready',
        persistent: disk.exitCode === 0 && disk.output.trim() === marker,
        disk: { exitCode: disk.exitCode, output: disk.output.trim(), timedOut: disk.timedOut },
        packagesReused: k.pod!.log.value.some(
          entry =>
            entry.command === 'npm install' && entry.output.includes('packages are up to date'),
        ),
      };
    }, diskMarker);
    console.log(
      JSON.stringify({
        recoveryAfterReopen: {
          ready: previewAfterReopen.ready,
          disk: previewAfterReopen.disk,
          markerMatches: previewAfterReopen.persistent,
          packagesReused: previewAfterReopen.packagesReused,
          workMatches:
            JSON.stringify(JSON.parse(previewAfterReopen.document)) ===
            JSON.stringify(JSON.parse(previewBeforeReopen.document)),
          requests: previewAfterReopen.requests,
        },
      }),
    );
    assert.deepEqual(
      JSON.parse(previewAfterReopen.document),
      JSON.parse(previewBeforeReopen.document),
    );
    assert.equal(previewAfterReopen.requests, previewBeforeReopen.requests);
    assert.equal(previewAfterReopen.ready, true);
    assert.equal(previewAfterReopen.persistent, true);
    assert.equal(previewAfterReopen.packagesReused, true);
    console.log(
      JSON.stringify({
        projectRecovery:
          'reopened the isolated app; work and installed packages were preserved, and screen sharing stayed off',
      }),
    );
    await page.click('[data-testid=view-patch]');
    await page.evaluate(() =>
      (window as unknown as { __kit: import('../src/editor/session.ts').KitSession }).__kit.select([
        'cut1',
      ]),
    );
    await page.click('[data-expose=hz]');
    const knob = await page.evaluate(
      () =>
        Object.values(
          (window as unknown as { __kit: import('../src/editor/session.ts').KitSession }).__kit.doc
            .value.nodes,
        ).find(n => n.type === 'ui.knob')!.id,
    );
    await page.click('[data-testid=view-plugin]');
    await page.keyboard.press('Meta+KeyE');
    await page.keyboard.press('Shift+Space');
    await page.waitForSelector('[data-testid=insert-menu]');
    await page.keyboard.type('code part');
    await page.keyboard.press('Enter');
    const partId = await page.evaluate(
      () =>
        Object.values(
          (window as unknown as { __kit: import('../src/editor/session.ts').KitSession }).__kit.doc
            .value.ui.elements,
        ).find(e => e.kind === 'code')?.id,
    );
    assert.ok(partId);
    await page.waitForSelector(`[data-element=${partId}] [data-code-state=ready]`, {
      timeout: 60000,
    });
    const frame = page
      .frames()
      .find(f => f.url().includes('browserportal.io') && f.url().includes('part=wave'))!;
    assert.ok(frame);
    const powers = await frame.evaluate(() => ({
      node: typeof (window as unknown as { require?: unknown }).require,
      shell: typeof window.denKitShell,
    }));
    assert.deepEqual(powers, { node: 'undefined', shell: 'undefined' });
    console.log(JSON.stringify({ codePart: 'ready', iframeIsolation: powers }));
    const code = `import { part } from '../kit';\nexport default part({mount(root, kit){const button = root.appendChild(document.createElement('button')); button.id = 'desktop-knob'; button.onclick = () => kit.set('${knob}', 200); const update = () => {button.dataset.mode = kit.mode; button.textContent = String(kit.value('${knob}'));}; update(); const value = kit.on('${knob}', update); const mode = kit.onMode(update); return () => {value(); mode();};}});\n`;
    await page.evaluate(async code => {
      const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession })
        .__kit;
      const result = await k.pod!.runForYou(
        "cat > src/parts/wave.ts <<'DEN_KIT_CHECK'\n" + code + 'DEN_KIT_CHECK\n',
      );
      if (result.result.exitCode !== 0) throw new Error('Code part edit failed.');
    }, code);
    await frame.waitForSelector('#desktop-knob');
    await page.evaluate(knob => {
      const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession })
        .__kit;
      k.commit([{ op: 'setValue', node: knob, port: 'value', value: 600 }]);
    }, knob);
    await frame.waitForFunction(
      () => document.getElementById('desktop-knob')?.textContent === '600',
    );
    await page.click('[data-testid=plugin-play]');
    await frame.waitForFunction(
      () => document.getElementById('desktop-knob')?.dataset.mode === 'play',
    );
    await frame.click('#desktop-knob');
    await page.waitForFunction(
      knob =>
        Math.abs(
          Number(
            (window as unknown as { __kit: import('../src/editor/session.ts').KitSession }).__kit
              .doc.value.nodes[knob]!.values.value,
          ) - 200,
        ) < 0.01,
      knob,
    );
    await frame.waitForFunction(
      () => document.getElementById('desktop-knob')?.textContent === '200',
    );
    console.log(JSON.stringify({ codePartKnob: 'both directions passed' }));
    await page.screenshot({ path: join(profile, 'pod-check.png') });
    if (aiPod) {
      const beforeNodes = await page.evaluate(() =>
        JSON.stringify(
          (window as unknown as { __kit: import('../src/editor/session.ts').KitSession }).__kit.doc
            .value.nodes,
        ),
      );
      const requestId = await page.evaluate(knob => {
        const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession })
          .__kit;
        k.llm!.settings.members = 'off';
        return k.requests!.run(
          `Create one code part named electron-check beside the existing wave part. Its only button has id electron-ai-button, displays AI pod followed by the current value of knob ${knob}, and on click sets that knob to 750. Use the pod tools, run TypeScript, ESLint and the production build and fix errors. Add it at x360 y180 width180 height60. Do not change other files, elements or the sound, and do not delegate. Finish once it is live.`,
        ).id;
      }, knob);
      await page.waitForFunction(
        id => {
          const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession })
            .__kit;
          return k.requests!.history.value.some(
            o => o.id === id && !o.live && !['thinking', 'working'].includes(o.status),
          );
        },
        requestId,
        { timeout: 300000 },
      );
      const made = await page.evaluate(id => {
        const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession })
          .__kit;
        const o = k.requests!.history.value.find(o => o.id === id)!;
        return {
          status: o.status,
          reply: o.reply,
          ms: o.ms,
          nodes: JSON.stringify(k.doc.value.nodes),
          part: Object.values(k.doc.value.ui.elements).find(
            e => e.kind === 'code' && e.part === 'electron-check',
          ),
          file: !!k.doc.value.files['src/parts/electron-check.ts'],
          checks: k
            .pod!.log.value.filter(l => l.who === 'ai' && l.exitCode === 0)
            .map(l => l.command),
        };
      }, requestId);
      assert.equal(made.status, 'applied');
      assert.equal(made.nodes, beforeNodes);
      assert.ok(made.file);
      assert.ok(made.part);
      for (const task of ['check', 'lint', 'build'])
        assert.ok(
          made.checks.some(c => c.includes(`npm run ${task}`)),
          `AI must run npm run ${task} successfully.`,
        );
      await page.waitForSelector(`[data-element=${made.part.id}] [data-code-state=ready]`, {
        timeout: 60000,
      });
      const aiFrame = page
        .frames()
        .find(
          f => f.url().includes('browserportal.io') && f.url().includes('part=electron-check'),
        )!;
      assert.ok(aiFrame);
      await aiFrame.waitForFunction(() =>
        /AI pod.*200/.test(document.getElementById('electron-ai-button')?.textContent ?? ''),
      );
      await aiFrame.click('#electron-ai-button');
      await page.waitForFunction(
        knob =>
          Number(
            (window as unknown as { __kit: import('../src/editor/session.ts').KitSession }).__kit
              .doc.value.nodes[knob]!.values.value,
          ) === 750,
        knob,
      );
      await aiFrame.waitForFunction(() =>
        /AI pod.*750/.test(document.getElementById('electron-ai-button')?.textContent ?? ''),
      );
      await frame.waitForFunction(
        () => document.getElementById('desktop-knob')?.textContent === '750',
      );
      aiPodCheck = { status: made.status, reply: made.reply, ms: made.ms, checks: made.checks };
      console.log(JSON.stringify({ aiPodCheck, codePartClick: 'passed' }));
      await page.screenshot({ path: join(profile, 'ai-pod-check.png') });
    }
    const markerWritten = await page.evaluate(async marker => {
      const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession })
        .__kit;
      const host = await k.pod!.ensure();
      return (await host.run(`printf %s '${marker}' > .den-kit-electron-check`, { cwd: host.home }))
        .exitCode;
    }, diskMarker);
    assert.equal(markerWritten, 0);
  }
  const permissions = await page.evaluate(async () => ({
    midi: await navigator.permissions.query({ name: 'midi' as PermissionName }).then(r => r.state),
    persistent: await navigator.storage.persist(),
  }));
  assert.equal(permissions.midi, 'granted');
  assert.equal(permissions.persistent, true);
  console.log(JSON.stringify({ permissions }));
  const asset = await page.evaluate(async () => {
    const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession }).__kit;
    return k.addAssetFile(
      new File(
        [
          '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="orange"/></svg>',
        ],
        'electron-check.svg',
        { type: 'image/svg+xml' },
      ),
    );
  });
  assert.ok(asset);
  const saved = await page.evaluate(() => {
    const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession }).__kit;
    k.doc.value = { ...k.doc.value, name: 'Electron persistence check' };
    k.requests!.upsert({
      id: 'native-close-check',
      text: 'Keep this conversation on native close',
      route: 'llm',
      status: 'reply',
      reply: 'Saved without waiting for the debounce.',
      ms: 0,
    });
    return k.doc.value.id;
  });
  // Closing the native window must flush even a change made before the autosave debounce.
  const closed = app.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.close();
  });
  await closed;
  app = await launch();
  const reopened = await app.firstWindow();
  await reopened.waitForFunction(() => !!(window as unknown as { __kit?: unknown }).__kit);
  const restored = await reopened.evaluate(async () => {
    const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession }).__kit;
    return {
      settings: (await window.denKitShell!.info()).settings,
      doc: k.doc.value,
      conversation: k.requests!.history.value,
    };
  });
  assert.equal(restored.settings.fork, true);
  assert.equal(restored.doc.name, 'Electron persistence check');
  assert.equal(restored.doc.id, saved);
  assert.ok(
    restored.conversation.some(
      o => o.id === 'native-close-check' && o.reply === 'Saved without waiting for the debounce.',
    ),
  );
  assert.ok(restored.doc.files[asset.id]);
  assert.ok(
    await reopened.evaluate(async id => {
      const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession })
        .__kit;
      const file = k.doc.value.files[id] as { hash?: string; bytes: number; type: string };
      return (
        await k.assets.dataUrl({
          id,
          name: id,
          mime: file.type,
          bytes: file.bytes,
          hash: file.hash,
        })
      )?.startsWith('data:image/svg+xml');
    }, asset.id),
  );
  if (real && !quick) {
    podDiskCheck = await reopened.evaluate(async marker => {
      const k = (window as unknown as { __kit: import('../src/editor/session.ts').KitSession })
        .__kit;
      const start = performance.now();
      const host = await k.pod!.ensure();
      const read = await host.run('cat .den-kit-electron-check', { cwd: host.home });
      return {
        persistent: read.exitCode === 0 && read.output.trim() === marker,
        rebootMs: Math.round(performance.now() - start),
        packagesReused: k.pod!.log.value.some(
          l => l.command === 'npm install' && l.output.includes('packages are up to date'),
        ),
      };
    }, diskMarker);
    assert.equal(podDiskCheck.persistent, true);
    assert.equal(podDiskCheck.packagesReused, true);
    console.log(JSON.stringify({ podDiskCheck }));
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ persistence: 'passed' }));
  writeFileSync(
    join(profile, 'report.json'),
    JSON.stringify(
      {
        facts,
        podKeyMatchesBundle: true,
        voice,
        imageCheck,
        aiPodCheck,
        podDiskCheck,
        persistence: true,
        real,
        packaged,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  try {
    await app.close();
  } finally {
    rmSync(join(profile, 'codex/auth.json'), { force: true });
  }
}
