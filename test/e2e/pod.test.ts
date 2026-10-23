// U6: the AI's free environment. The (fake) model works in the pod like in any
// web project — reads the guide, writes a code part with bash, runs TypeScript
// and ESLint on it — and the part shows on the plugin from the pod's dev server,
// reads and moves a knob, and undoes with the request. The pod here is the test
// stand-in (this machine's bash, git, Node and npm behind BrowserPod's interface);
// the code parts' frames, the page's cross-origin isolation and the message
// protocol are the real ones.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Frame, Page } from 'playwright';
import { openKit, startHarness, waitCompiled, type Harness } from './harness.ts';

const kit = (page: Page, fn: (k: any) => unknown): Promise<any> =>
  page.evaluate(`(${fn.toString()})(window.__kit)`);
const snapshot = (page: Page) =>
  kit(page, k =>
    JSON.stringify({
      ui: k.doc.value.ui,
      nodes: Object.keys(k.doc.value.nodes).sort(),
      edges: Object.keys(k.doc.value.edges).sort(),
      files: k.doc.value.files,
    }),
  );

// Poll from Node so each asynchronous pod read finishes before checking its result.
async function waitForPodFile(
  page: Page,
  path: string,
  expected: string | null,
  { timeout = 20000, interval = 500 } = {},
) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const actual: string | null = await page.evaluate(
      path => (window as any).__kit.pod.readFile(path),
      path,
    );
    if (actual === expected || Date.now() >= deadline) {
      assert.equal(
        actual,
        expected,
        `Pod file ${path} did not reach the expected contents within ${timeout} ms`,
      );
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

async function ask(page: Page, text: string, timeout = 300000) {
  await page.keyboard.press('Control+k');
  await page.keyboard.type(text);
  await page.keyboard.press('Shift+Enter');
  await page.waitForFunction(
    t => {
      const o = (window as any).__kit.requests.history.value.at(-1);
      return o && o.text === t && !o.live && o.status !== 'thinking';
    },
    text,
    { timeout },
  );
  return kit(page, k => {
    const o = k.requests.history.value.at(-1);
    return { status: o.status, label: o.label, steps: o.steps, message: o.message };
  });
}
async function partFrame(page: Page, part: string, timeout = 60000): Promise<Frame> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const f = page.frames().find(fr => fr.url().includes(`part=${part}`));
    if (f) return f;
    await page.waitForTimeout(200);
  }
  throw new Error(`No frame for part ${part}`);
}

let h: Harness;
before(async () => {
  h = await startHarness({ codex: true, pod: true });
});
after(async () => {
  await h?.close();
});

describe('the pod: a free environment for the AI', () => {
  it(
    'the AI writes a code part with bash, checks it with tsc and ESLint, puts it on the plugin; it reads and moves the knob; one ⌘Z takes it all back',
    { timeout: 420000 },
    async () => {
      const { page, errors } = await openKit(h);
      await waitCompiled(page);
      await page.waitForFunction(() => (window as any).__kit.bridge.codexReady, null, {
        timeout: 30000,
      });
      const before = await snapshot(page);
      const line = await ask(page, 'make a code part');
      assert.equal(line.status, 'applied', JSON.stringify(line));
      assert.equal(
        line.label,
        'Created a meter code part and placed it on the plugin',
        JSON.stringify(line),
      );
      assert.ok(
        line.steps.some((s: string) => /^ran `npm run check && npm run lint`$/.test(s)),
        line.steps.join(' | '),
      );
      // What the command changed is said once: the files kept in the work.
      assert.ok(
        line.steps.some((s: string) =>
          /^ran `mkdir -p src\/parts && cat > src\/parts\/meter\.ts …` · kept \d+ files in the work ✓$/.test(
            s,
          ),
        ),
        line.steps.join(' | '),
      );
      // The work keeps the project (the template, the part); node_modules and dist stay in the pod.
      const doc = await kit(page, k => k.doc.value);
      assert.match(doc.files['src/parts/meter.ts'].text, /kit\.norm\('knob1'\)/);
      assert.ok(
        doc.files['package.json'] && doc.files['AGENTS.md'] && doc.files['src/kit/index.ts'],
      );
      assert.ok(
        !Object.keys(doc.files).some(
          (p: string) => /^(node_modules|dist|\.git)\//.test(p) || p === 'src/kit/controls.ts',
        ),
      );
      assert.deepEqual(
        { kind: doc.ui.elements.meter1.kind, part: doc.ui.elements.meter1.part },
        { kind: 'code', part: 'meter' },
      );
      // What the model got back: the guide, real tool output with exit statuses, the look with the part drawn.
      const replies = JSON.stringify(h.codex!.replies());
      assert.match(replies, /## Code parts/);
      assert.match(replies, /\[exit 0/);
      assert.doesNotMatch(replies, /code part meter1[^"]*fails/);
      // The pod's git has the request as a commit.
      await page.waitForFunction(() => (window as any).__kit.pod.log.value.length > 0);
      const gitLog = await kit(
        page,
        async k => (await k.pod.bash('git log --oneline', { who: 'den-kit' })).output,
      );
      assert.match(gitLog, /den-kit AI: Created a meter code part and placed it on the plugin/);

      // On the plugin: the part's page from the pod's dev server, drawing the knob.
      await page.click('[data-testid=ai-show-plugin]');
      await page.waitForSelector('[data-element=meter1] [data-code-state=ready]', {
        timeout: 60000,
      });
      const frame = await partFrame(page, 'meter');
      const height = () => frame.evaluate(() => document.getElementById('meter-bar')!.style.height);
      const norm = () =>
        kit(page, k => {
          const n = k.doc.value.nodes.knob1;
          const v = n.values.value,
            min = n.config.min,
            max = n.config.max;
          return Math.log(v / min) / Math.log(max / min);
        });
      const initialHeight = `${Math.round((await norm()) * 100)}%`;
      // The ready message precedes the first animation frame that draws the controls.
      await frame.waitForFunction(
        h => document.getElementById('meter-bar')?.style.height === h,
        initialHeight,
      );
      assert.equal(await height(), initialHeight);
      // The knob moves (the person turns it): the part follows.
      await kit(page, k =>
        k.commit([{ op: 'setValue', node: 'knob1', port: 'value', value: 200 }], { label: 'turn' }),
      );
      await frame.waitForFunction(
        h => document.getElementById('meter-bar')!.style.height === h,
        `${Math.round((await norm()) * 100)}%`,
      );
      // A click on the part sets the knob (near the top: near the top of its range), as one undo step.
      const valueBefore = await kit(page, k => k.doc.value.nodes.knob1.values.value);
      await frame.click('#root', { position: { x: 30, y: 8 } });
      await page.waitForFunction(
        v => (window as any).__kit.doc.value.nodes.knob1.values.value !== v,
        valueBefore,
        { timeout: 10000 },
      );
      assert.ok((await norm()) > 0.9, `norm ${await norm()}`);
      // ⌘Z pressed while the part has the focus reaches den-kit: the click is undone.
      await page.keyboard.press('Control+z');
      await page.waitForFunction(
        v => (window as any).__kit.doc.value.nodes.knob1.values.value === v,
        valueBefore,
        { timeout: 10000 },
      );
      // Undo the turn, then the whole AI request: the project, the part and the knob go.
      await kit(page, k => {
        k.undo();
        k.undo();
      });
      assert.equal(await snapshot(page), before);
      // The pod follows the work: the part's file is gone from it too.
      await waitForPodFile(page, 'src/parts/meter.ts', null);
      assert.deepEqual(errors, []);
      assert.deepEqual(h.codex!.violations(), []);
      await page.close();
    },
  );

  it(
    'a code part notifies its subscribers for external moves, its own set and setNorm, without repeating the host acknowledgment',
    { timeout: 120000 },
    async () => {
      const { page, errors } = await openKit(h);
      await waitCompiled(page);
      const created = await kit(page, k => {
        // den-kit's own files (the controls list, the kit's behaviors) are not kept in the work.
        const files = Object.fromEntries(
          [...k.pod.wanted()].filter(
            ([p]) => !p.startsWith('src/kit/behaviors/') && p !== 'src/kit/controls.ts',
          ),
        );
        const result = k.commit([
          {
            op: 'addNode',
            node: {
              id: 'watchknob',
              type: 'ui.knob',
              config: { min: 0, max: 100, scale: 'linear' },
              values: { value: 10 },
            },
          },
          {
            op: 'setProjectFiles',
            files: {
              ...files,
              'src/parts/subscribed.ts': `import { part } from '../kit';
export default part({ mount(root, kit) {
  const display = root.appendChild(document.createElement('output'));
  display.id = 'subscribed-value';
  let calls = 0;
  const update = () => { display.textContent = String(kit.value('watchknob')); display.dataset.norm = String(kit.norm('watchknob')); display.dataset.calls = String(++calls); };
  update();
  const stop = kit.on('watchknob', update);
  const set = root.appendChild(document.createElement('button')); set.id = 'self-set'; set.textContent = 'set'; set.onclick = () => kit.set('watchknob', 120);
  const norm = root.appendChild(document.createElement('button')); norm.id = 'self-norm'; norm.textContent = 'norm'; norm.onclick = () => kit.setNorm('watchknob', 0.5);
  return stop;
} });\n`,
            },
          },
          {
            op: 'addElement',
            element: {
              id: 'subscribe1',
              kind: 'code',
              part: 'subscribed',
              rect: { x: 20, y: 20, w: 240, h: 100 },
              props: {},
            },
          },
        ]);
        return { ok: result.ok, error: result.error?.message };
      });
      assert.equal(created.ok, true, JSON.stringify(created.error));
      await page.click('[data-testid=view-plugin]');
      await page.waitForSelector('[data-element=subscribe1] [data-code-state=ready]', {
        timeout: 60000,
      });
      const f = await partFrame(page, 'subscribed');
      const displayed = async (value: number, norm: number, calls: number) => {
        await f.waitForFunction(
          v => document.getElementById('subscribed-value')?.textContent === String(v),
          value,
          { timeout: 5000 },
        );
        assert.equal(await f.locator('#subscribed-value').getAttribute('data-norm'), String(norm));
        assert.equal(
          await f.locator('#subscribed-value').getAttribute('data-calls'),
          String(calls),
        );
      };
      await displayed(10, 0.1, 1);
      await kit(page, k =>
        k.commit([{ op: 'setValue', node: 'watchknob', port: 'value', value: 30 }]),
      );
      await displayed(30, 0.3, 2);
      await f.click('#self-set');
      await page.waitForFunction(
        () => (window as any).__kit.doc.value.nodes.watchknob.values.value === 100,
      );
      await displayed(100, 1, 3);
      await f.click('#self-set');
      await page.waitForTimeout(300);
      await displayed(100, 1, 3);
      await f.click('#self-norm');
      await page.waitForFunction(
        () => (window as any).__kit.doc.value.nodes.watchknob.values.value === 50,
      );
      await displayed(50, 0.5, 4);
      await page.waitForTimeout(300);
      await displayed(50, 0.5, 4);
      assert.deepEqual(errors, []);
      await page.close();
    },
  );

  it(
    "a code part's own knob uses den-kit's knob behavior: same drag and keys, one drag one undo step; messages from anywhere but its frame are ignored",
    { timeout: 120000 },
    async () => {
      const { page, errors } = await openKit(h);
      await waitCompiled(page);
      const created = await kit(page, k => {
        const files = Object.fromEntries(
          [...k.pod.wanted()].filter(
            ([p]) => !p.startsWith('src/kit/behaviors/') && p !== 'src/kit/controls.ts',
          ),
        );
        const result = k.commit([
          {
            op: 'addNode',
            node: {
              id: 'ownknob',
              type: 'ui.knob',
              config: { min: 0, max: 100, scale: 'linear' },
              values: { value: 50 },
            },
          },
          {
            op: 'setProjectFiles',
            files: {
              ...files,
              'src/parts/own.ts': `import { CONTROLS, behaviors, part } from '../kit';
export default part({ mount(root, kit) {
  const pad = root.appendChild(document.createElement('div'));
  pad.id = 'own-knob';
  Object.assign(pad.style, { position: 'absolute', inset: '0' });
  const knob = behaviors.createKnob(CONTROLS.ownknob);
  const unbind = kit.bind(knob, 'ownknob');
  const unlisten = behaviors.listen(pad, knob);
  return () => { unbind(); unlisten(); };
} });\n`,
            },
          },
          {
            op: 'addElement',
            element: {
              id: 'own1',
              kind: 'code',
              part: 'own',
              rect: { x: 20, y: 20, w: 240, h: 240 },
              props: {},
            },
          },
        ]);
        return { ok: result.ok, error: result.error?.message };
      });
      assert.equal(created.ok, true, JSON.stringify(created.error));
      // The kit the part imports carries den-kit's behaviors, and the part type-checks against it.
      const check = await kit(page, k => k.pod.bash('npm run check', { who: 'ai' }));
      assert.equal(check.exitCode, 0, check.output);
      await page.click('[data-testid=view-plugin]');
      await page.waitForSelector('[data-element=own1] [data-code-state=ready]', { timeout: 60000 });
      const f = await partFrame(page, 'own');
      const value = () => kit(page, k => k.doc.value.nodes.ownknob.values.value);
      const steps = () => kit(page, k => k.history.size);
      const before = await steps();
      // Rule 1: 200 px of drag is the whole range, so 40 px up is 20 of 0–100, wherever it was grabbed.
      // The plugin is drawn scaled to fit: 40 of the part's pixels are 40 × scale on screen.
      const pad = await f.locator('#own-knob').boundingBox();
      assert.ok(pad);
      const scale = pad.height / 240;
      const x = pad.x + pad.width / 2,
        y = pad.y + pad.height * 0.7;
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (const dy of [10, 20, 30, 40]) await page.mouse.move(x, y - dy * scale);
      await page.mouse.up();
      const near = (v: number) =>
        page.waitForFunction(
          v => Math.abs((window as any).__kit.doc.value.nodes.ownknob.values.value - v) < 0.5,
          v,
        );
      await near(70);
      assert.equal(await steps(), before + 1, 'one drag is one undo step');
      // Rule 4: the arrow keys move 1% of the range.
      await f.focus('#own-knob');
      await page.keyboard.press('ArrowUp');
      await near(71);
      await kit(page, k => k.undo());
      await kit(page, k => k.undo());
      assert.equal(await value(), 50);
      // A message that does not come from the part's frame, or not from its origin, is ignored.
      await page.evaluate(() => {
        const forged = { denkit: 1, type: 'set', id: 'ownknob', value: 5, gesture: 'forged' };
        window.postMessage(forged, '*');
        const other = document.body.appendChild(document.createElement('iframe'));
        other.srcdoc = `<script>parent.postMessage(${JSON.stringify(forged)}, '*')</script>`;
      });
      await page.waitForTimeout(500);
      assert.equal(await value(), 50);
      assert.deepEqual(errors, []);
      await page.close();
    },
  );

  it(
    'a broken part: the plugin shows its error, the AI sees it in kit_look, fixes the file, and the part runs',
    { timeout: 300000 },
    async () => {
      const { page, errors } = await openKit(h);
      await waitCompiled(page);
      await page.waitForFunction(() => (window as any).__kit.bridge.codexReady, null, {
        timeout: 30000,
      });
      const line = await ask(page, 'fix the broken part');
      assert.equal(line.status, 'applied', JSON.stringify(line));
      assert.equal(line.label, 'Fixed the broken part', JSON.stringify(line));
      const looks = h
        .codex!.replies()
        .filter(r => /Looked at the plugin/.test(JSON.stringify(r)))
        .map(r => JSON.stringify(r));
      assert.match(
        looks.at(-2)!,
        /The code part oops1 fails: mount: Error: oops: the canvas is missing/,
      );
      assert.doesNotMatch(looks.at(-1)!, /oops1 fails/);
      await page.click('[data-testid=ai-show-plugin]');
      await page.waitForSelector('[data-element=oops1] [data-code-state=ready]', {
        timeout: 60000,
      });
      const frame = await partFrame(page, 'oops');
      assert.equal(
        await frame.evaluate(() => document.getElementById('root')!.textContent),
        'fixed',
      );
      assert.deepEqual(errors, []);
      await page.close();
    },
  );

  it(
    'by hand: Insert ▸ Code part shows the starter from the pod; its settings come from the part; the terminal runs commands into the work',
    { timeout: 300000 },
    async () => {
      const { page, errors } = await openKit(h);
      await waitCompiled(page);
      await page.click('[data-testid=view-plugin]');
      await page.waitForSelector('[data-testid=plugin-view]');
      await page.keyboard.press('Control+KeyE');
      await page.waitForSelector('[data-testid=plugin-edit].active');
      await page.keyboard.press('Shift+Space');
      await page.waitForSelector('[data-testid=insert-menu]');
      await page.keyboard.type('code part');
      await page.keyboard.press('Enter');
      const id = await kit(
        page,
        k => Object.values<any>(k.doc.value.ui.elements).find(e => e.kind === 'code')?.id,
      );
      assert.ok(id);
      assert.equal(
        await kit(page, k => typeof k.doc.value.files['src/parts/wave.ts']?.text),
        'string',
      );
      await page.waitForSelector(`[data-element=${id}] [data-code-state=ready]`, {
        timeout: 120000,
      });
      // The inspector shows the setting the part declares (its colour).
      await page.waitForSelector('[data-testid=code-part-state]');
      await page.waitForSelector('[data-prop=color]', { timeout: 20000 });
      // The person's own command: what it changes lands as their undo step.
      const r = await kit(page, async k => {
        const out = await k.pod.runForYou(
          "sed 's/Colour/Color/' src/parts/wave.ts > src/parts/wave.ts.tmp && mv src/parts/wave.ts.tmp src/parts/wave.ts && grep -c Color src/parts/wave.ts",
        );
        return { exit: out.result.exitCode, output: out.result.output, changed: out.changed };
      });
      assert.deepEqual(r, { exit: 0, output: '1', changed: ['src/parts/wave.ts'] });
      assert.match(
        await kit(page, k => k.doc.value.files['src/parts/wave.ts'].text),
        /label: 'Color'/,
      );
      assert.equal(
        await kit(page, k => k.history.peek()?.label),
        "Terminal: sed 's/Colour/Color/' src/parts/wave.ts > src/parts/wave.ts.tmp && mv src/parts/wave.ts.tmp src/parts/wave.ts && grep -c Color src/parts/wave.ts".slice(
          0,
          70,
        ),
      );
      // ⌘Z: the edit goes, then the part and its project.
      await kit(page, k => {
        k.undo();
        k.undo();
      });
      assert.deepEqual(await kit(page, k => k.doc.value.files), {});
      assert.deepEqual(errors, []);
      await page.close();
    },
  );
});

describe('the Project view', () => {
  it(
    "starts the pod, runs the person's commands into the work, keeps an edited file with ⌘S, and the pod check passes every step",
    { timeout: 420000 },
    async () => {
      const { page, errors } = await openKit(h);
      await waitCompiled(page);
      await page.click('[data-testid=view-project]');
      await page.waitForSelector('[data-testid=project-view]');
      // It takes the whole workspace (the module sidebar steps aside).
      const box = (await page.locator('[data-testid=project-view]').boundingBox())!;
      assert.ok(box.width > 900, `width ${box.width}`);
      // A new page: its pod starts when asked (or when the work needs it).
      await page.click('[data-testid=pod-start]');
      await page.waitForFunction(() => (window as any).__kit.pod.state.value === 'ready', null, {
        timeout: 180000,
      });
      await page.fill('[data-testid=pod-command]', 'echo hello > note.txt && cat note.txt');
      await page.press('[data-testid=pod-command]', 'Enter');
      await page.waitForFunction(
        () => (window as any).__kit.doc.value.files['note.txt']?.text === 'hello\n',
        null,
        { timeout: 30000 },
      );
      const entry = await kit(page, k => {
        const e = k.pod.log.value.filter((x: any) => x.who === 'you').at(-1);
        return { command: e.command, exitCode: e.exitCode, output: e.output };
      });
      assert.deepEqual(entry, {
        command: 'echo hello > note.txt && cat note.txt',
        exitCode: 0,
        output: 'hello',
      });
      assert.ok(
        await kit(page, k => !!k.doc.value.files['package.json']),
        "the template became the work's",
      );
      // Edit the file in den-kit: ⌘S keeps it in the work, and the pod gets it.
      await page.click('[data-file="note.txt"]');
      await page.fill('[data-testid=file-text]', 'hello again\n');
      await page.press('[data-testid=file-text]', 'Control+s');
      await page.waitForFunction(
        () => (window as any).__kit.doc.value.files['note.txt']?.text === 'hello again\n',
      );
      await waitForPodFile(page, 'note.txt', 'hello again\n', { interval: 300 });
      // Code is coloured by its kind of file (a text file is not).
      assert.equal(await page.locator('[data-testid=project-view] .paint span').count(), 0);
      await page.click('[data-file="src/main.ts"]');
      await page.waitForSelector('[data-testid=project-view] .paint .hljs-keyword');
      // Diagnostics stay out of the ordinary workspace; expand them to run every check.
      assert.equal(
        await page.locator('[data-testid=project-diagnostics]').getAttribute('open'),
        null,
      );
      assert.equal(await page.locator('[data-testid=pod-check]').isVisible(), false);
      await page.locator('[data-testid=project-diagnostics] summary').click();
      await page.click('[data-testid=pod-check]');
      await page.waitForFunction(
        () =>
          !document.querySelector('[data-testid=pod-check]')?.hasAttribute('disabled') &&
          document.querySelectorAll(
            '[data-testid=pod-check-panel] .step.ok, [data-testid=pod-check-panel] .step.failed, [data-testid=pod-check-panel] .step.skipped',
          ).length === 9,
        null,
        { timeout: 300000 },
      );
      const steps = await page.$$eval('[data-testid=pod-check-panel] .step', els =>
        els.map(e => `${(e as HTMLElement).dataset.step}:${e.className.replace('step ', '')}`),
      );
      assert.deepEqual(
        steps,
        [
          'boot:ok',
          'tools:ok',
          'check:ok',
          'lint:ok',
          'install:ok',
          'build:ok',
          'git:ok',
          'part:ok',
          'edit:ok',
        ],
        await page.locator('[data-testid=pod-check-panel]').innerText(),
      );
      // The check changed nothing in the work (its scratch part stayed in the pod and is gone).
      assert.equal(
        await kit(page, k =>
          Object.keys(k.doc.value.files).some((p: string) => p.includes('_den-kit-check')),
        ),
        false,
      );
      assert.equal(
        await kit(page, async k => await k.pod.readFile('src/parts/_den-kit-check.ts')),
        null,
      );
      assert.deepEqual(errors, []);
      await page.close();
    },
  );
});

describe('without a pod (no BrowserPod key)', () => {
  let bare: Harness;
  before(async () => {
    bare = await startHarness({ bridge: false });
  });
  after(async () => {
    await bare?.close();
  });
  it(
    'a code part says the pod is off and how to turn it on; nothing else breaks',
    { timeout: 120000 },
    async () => {
      const { page, errors } = await openKit(bare);
      await waitCompiled(page);
      assert.equal(await kit(page, k => k.pod.state.value), 'unavailable');
      assert.match(await kit(page, k => k.pod.fix.value), /BROWSERPOD_API_KEY/);
      await kit(page, k =>
        k.commit(
          [
            { op: 'setProjectFiles', files: { 'src/parts/x.ts': 'export default 1;' } },
            {
              op: 'addElement',
              element: {
                id: 'code1',
                kind: 'code',
                part: 'x',
                rect: { x: 10, y: 10, w: 200, h: 100 },
                props: {},
              },
            },
          ],
          { label: 'add' },
        ),
      );
      await page.click('[data-testid=view-plugin]');
      await page.waitForSelector('[data-element=code1] [data-code-state=off]');
      assert.match(
        await page.locator('[data-element=code1] [data-testid=code-status]').innerText(),
        /Code part "x": no pod .*Project tools are not configured/,
      );
      // Browser developers get setup instructions in Project rather than in each code-part frame.
      await page.click('[data-testid=view-project]');
      assert.match(
        await page.locator('[data-testid=pod-fix]').innerText(),
        /BROWSERPOD_API_KEY=.*\.env.*restart `vp run dev`/s,
      );
      assert.equal((await waitCompiled(page)).status, 'ok');
      assert.deepEqual(errors, []);
      await page.close();
    },
  );
});
