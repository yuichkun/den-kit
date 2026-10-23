// The pod check: what working in the pod feels like, measured — the pod
// starting (and npm install, the dev server), the usual tools, TypeScript,
// ESLint, an npm install, a build, git, a code part loading from the dev server,
// and an edit reaching it. Run from the Project view (and once by itself the
// first time den-kit has a BrowserPod key). It changes nothing in the work: the
// part it loads is a scratch file of the pod's own (CHECK_PART), removed after.
import { ref } from 'vue';
import type { PodSession } from './pod-session.ts';
import type { PodRunResult } from '../host/workspace.ts';

export const CHECK_PART = '_den-kit-check';
export const CHECK_FILE = `src/parts/${CHECK_PART}.ts`;

export interface CheckStep {
  id: string;
  title: string;
  state: 'waiting' | 'running' | 'ok' | 'failed' | 'skipped';
  ms?: number;
  detail?: string;
}

const STEPS: Array<Pick<CheckStep, 'id' | 'title'>> = [
  { id: 'boot', title: 'Start the pod (boot, write the project, npm install, dev server)' },
  { id: 'tools', title: 'bash, git, Node, npm' },
  { id: 'check', title: 'TypeScript (npm run check)' },
  { id: 'lint', title: 'ESLint (npm run lint)' },
  { id: 'install', title: 'Install a package (npm install, not kept)' },
  { id: 'build', title: 'Build (npm run build)' },
  { id: 'git', title: 'git (status, log)' },
  { id: 'part', title: 'A code part loads from the dev server' },
  { id: 'edit', title: 'An edit reaches the part' },
];

const part = (word: string) =>
  `import { part } from '../kit';\n\n// den-kit's pod check (a scratch part; removed after the check).\nexport default part({ mount(root) { root.textContent = '${word}'; console.log('den-kit check: ${word}'); } });\n`;

export class PodCheck {
  readonly steps = ref<CheckStep[]>(STEPS.map(s => ({ ...s, state: 'waiting' })));
  readonly running = ref(false);
  readonly at = ref<number | null>(null);
  readonly totalMs = ref(0);

  private set(id: string, patch: Partial<CheckStep>) {
    this.steps.value = this.steps.value.map(s => (s.id === id ? { ...s, ...patch } : s));
  }

  /** Run every step (a failed one does not stop the rest, unless the pod did not start). */
  async run(pod: PodSession): Promise<CheckStep[]> {
    if (this.running.value) return this.steps.value;
    this.running.value = true;
    this.steps.value = STEPS.map(s => ({ ...s, state: 'waiting' }));
    const started = performance.now();
    try {
      const booted = await this.step('boot', async () => {
        await pod.ensure();
        const t = pod.timings.value;
        if (pod.state.value !== 'ready')
          throw new Error(`${pod.state.value}: ${pod.message.value}`);
        return [
          t.bootMs !== undefined && `boot ${secs(t.bootMs)}`,
          t.syncMs !== undefined && `write ${secs(t.syncMs)}`,
          t.installMs !== undefined && `npm install ${secs(t.installMs)}`,
          t.devMs !== undefined && `dev server ${secs(t.devMs)}`,
        ]
          .filter(Boolean)
          .join(' · ');
      });
      if (!booted) {
        for (const s of this.steps.value)
          if (s.state === 'waiting') this.set(s.id, { state: 'skipped' });
        return this.steps.value;
      }
      await this.command(
        pod,
        'tools',
        'bash --version | head -1; git --version; node --version; npm --version; uname -sm',
        r => r.output.split('\n').filter(Boolean).join(' · '),
      );
      await this.command(pod, 'check', 'npm run check', () => 'no errors');
      await this.command(pod, 'lint', 'npm run lint', () => 'no problems');
      await this.command(
        pod,
        'install',
        'npm install --no-save --no-audit --no-fund is-number@7.0.0 && test -d node_modules/is-number && echo installed',
        r =>
          r.output
            .split('\n')
            .filter(l => /added|up to date|installed/.test(l))
            .join(' · '),
      );
      await this.command(pod, 'build', 'npm run build', r =>
        r.output
          .split('\n')
          .filter(l => /built in|dist\//.test(l))
          .slice(-2)
          .join(' · '),
      );
      await this.command(
        pod,
        'git',
        'git status --short | wc -l | tr -d " "; git log --oneline | head -1',
        r => {
          const [n, last] = r.output.split('\n');
          return `${n} changed file(s) · last commit: ${last ?? '—'}`;
        },
      );
      await this.partSteps(pod);
    } finally {
      this.totalMs.value = Math.round(performance.now() - started);
      this.at.value = Date.now();
      this.running.value = false;
    }
    return this.steps.value;
  }

  get ok(): boolean {
    return this.steps.value.every(s => s.state === 'ok');
  }

  private async step(id: string, work: () => Promise<string>): Promise<boolean> {
    this.set(id, { state: 'running' });
    const t0 = performance.now();
    try {
      const detail = await work();
      this.set(id, { state: 'ok', ms: Math.round(performance.now() - t0), detail });
      return true;
    } catch (error) {
      this.set(id, {
        state: 'failed',
        ms: Math.round(performance.now() - t0),
        detail: (error instanceof Error ? error.message : String(error)).slice(0, 600),
      });
      return false;
    }
  }
  private command(
    pod: PodSession,
    id: string,
    command: string,
    detail: (r: PodRunResult) => string,
  ) {
    return this.step(id, async () => {
      const r = await pod.bash(command, { who: 'den-kit', timeoutMs: 300_000 });
      if (r.exitCode !== 0)
        throw new Error(
          `${r.timedOut ? 'took too long' : `exit ${r.exitCode}`}: ${r.output.slice(-500)}`,
        );
      return detail(r);
    });
  }

  /** Load a scratch part from the dev server in a hidden frame, then change it and wait for the change to show. */
  private async partSteps(pod: PodSession) {
    const portal = pod.portal.value;
    if (!portal) {
      this.set('part', { state: 'failed', detail: 'The dev server has no address.' });
      this.set('edit', { state: 'skipped' });
      return;
    }
    await pod.writeFile(CHECK_FILE, part('first'));
    const frame = document.createElement('iframe');
    frame.setAttribute('credentialless', '');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText =
      'position:fixed;left:-4000px;top:0;width:200px;height:100px;border:0;visibility:hidden';
    const origin = new URL(portal).origin;
    const url = new URL(portal);
    url.searchParams.set('part', CHECK_PART);
    url.searchParams.set('el', 'check');
    url.searchParams.set('host', location.origin);
    let onMessage: ((m: Record<string, unknown>) => void) | null = null;
    const listener = (e: MessageEvent) => {
      if (e.source === frame.contentWindow && e.origin === origin && e.data?.denkit === 1)
        onMessage?.(e.data as Record<string, unknown>);
    };
    window.addEventListener('message', listener);
    /** True when the page next says it is ready showing `word` (after hello → init); false after `ms` or an error. */
    const ready = (ms: number, word: string) =>
      new Promise<boolean>(resolve => {
        let shows = false;
        const timer = setTimeout(() => {
          onMessage = null;
          resolve(false);
        }, ms);
        onMessage = m => {
          if (m.type === 'hello') {
            shows = false;
            frame.contentWindow?.postMessage(
              {
                denkit: 1,
                type: 'init',
                props: {},
                look: {},
                size: { width: 200, height: 100 },
                mode: 'edit',
                ranges: {},
                values: {},
                norms: {},
              },
              origin,
            );
          } else if (m.type === 'log' && String(m.text) === `den-kit check: ${word}`) shows = true;
          // Ready with an older version (served before the change was seen): wait for the next load.
          else if (m.type === 'ready' && shows) {
            clearTimeout(timer);
            onMessage = null;
            resolve(true);
          } else if (m.type === 'error' || m.type === 'missing') {
            clearTimeout(timer);
            onMessage = null;
            resolve(false);
          }
        };
      });
    try {
      document.body.appendChild(frame);
      const first = this.step('part', async () => {
        const shown = ready(60_000, 'first');
        frame.src = url.href;
        if (!(await shown)) throw new Error('The part did not get ready within 60 s.');
        return `loaded and drawing (${new URL(portal).host})`;
      });
      if (!(await first)) {
        this.set('edit', { state: 'skipped' });
        return;
      }
      await this.step('edit', async () => {
        // (A pod's file times count whole seconds: a change in the same second as the file's last write can go
        // unnoticed by the dev server. An edit comes later than that; so does this one.)
        await new Promise(r => setTimeout(r, 1100));
        // The dev server reloads the page by itself when its live reload reaches it; if not, den-kit reloads parts itself.
        const shown = ready(8000, 'second');
        await pod.writeFile(CHECK_FILE, part('second'));
        if (await shown) return 'the dev server reloaded the part by itself';
        const again = ready(30_000, 'second');
        frame.src = `${url.href}&r=${Date.now()}`;
        if (!(await again))
          throw new Error(
            'The part still shows its old version after a reload: the dev server did not see the change.',
          );
        return 'live reload did not reach the part; reloading it (as den-kit does) showed the change';
      });
    } finally {
      window.removeEventListener('message', listener);
      frame.remove();
      await pod.bash(`rm -f ${CHECK_FILE}`, { who: 'den-kit' }).catch(() => undefined);
    }
  }

  /** The results as text (for the log and for pasting into a report). */
  summary(kind: string | null): string {
    const lines = this.steps.value.map(
      s =>
        `${s.state === 'ok' ? '✓' : s.state === 'failed' ? '✗' : '·'} ${s.title}${s.ms !== undefined ? ` — ${secs(s.ms)}` : ''}${s.detail ? ` (${s.detail})` : ''}`,
    );
    return `den-kit pod check (${kind ?? 'no pod'}, ${new Date(this.at.value ?? Date.now()).toISOString()}, ${secs(this.totalMs.value)} in all)\n${lines.join('\n')}`;
  }
}

export const secs = (ms: number) =>
  ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
