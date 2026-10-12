// The work's pod: boots it when the work first needs it (the AI's first command,
// a code part to show, the Project drawer), keeps its copy of the screen project
// in step with the document (an undo, an edit in den-kit or another work loaded
// is written into the pod), installs packages when package.json changes, keeps
// the dev server running and knows its address (the portal), runs commands for
// the AI and the person (logged, with their output), and reads the project back
// after a command so what changed lands in the document (and undoes with it).
//
// The document is the record; the pod is the workbench. node_modules, .git and
// dist live only in the pod.
import { ref, shallowRef, watch } from 'vue';
import type { KitSession } from '../editor/session.ts';
import { pluginSpec } from '../plugin/build.ts';
import { GENERATED_FILES, PROJECT_LIMITS, byteLength, checkProjectPath } from '../core/project.ts';
import { controlsSource, templateFiles } from './template.ts';
import { CHECK_FILE } from './pod-check.ts';
import { PodUnavailable, keepEnd, type PodHost, type PodProcess, type PodRunResult } from './host.ts';
import type { PodAccess } from '../ai/llm-workspace.ts';
import { desktopProjectError } from './user-errors.ts';

export type PodState = 'off' | 'unavailable' | 'booting' | 'syncing' | 'installing' | 'starting' | 'ready' | 'failed';
export type PodWho = 'ai' | 'you' | 'den-kit';
export interface PodLogEntry { id: number; who: PodWho; command: string; output: string; exitCode: number | null; running: boolean; timedOut: boolean; ms: number; at: number }
export interface PodFactory {
  /** Which pod this is (null: none can be made; `reason` and `fix` say why). */
  kind: 'browserpod' | 'fake' | null;
  audience?: 'desktop' | 'developer';
  /** Make the pod; `progress` says what it is doing (starting BrowserPod takes a while the first time). */
  create(progress?: (text: string) => void): Promise<PodHost>;
  reason?: string;
  fix?: string;
}
/** What a code part on the plugin reported about itself (PluginCode.vue). */
export interface PartReport {
  part: string;
  state: 'loading' | 'ready' | 'missing' | 'error';
  /** Its settings as the part declares them (the inspector shows them). */
  props?: Record<string, unknown>;
  interactive?: boolean;
  error?: string;
  /** Its last console lines and errors (newest last). */
  logs: string[];
  /** When it last (re)loaded (ms since epoch). */
  at?: number;
}
/** How long the steps took (the Project drawer and the pod check show them). */
export interface PodTimings { bootMs?: number; syncMs?: number; installMs?: number; devMs?: number }

export const DEV_PORT = 5173;
const COMMAND_TIMEOUT = 120_000;
const MAX_COMMAND_TIMEOUT = 600_000;
const FLUSH_TIMEOUT = 5000;
const LOG_LIMIT = 200;
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/** git with an identity and no signing (the pod has no config of its own). */
export const GIT = 'git -c user.name=den-kit -c user.email=den-kit@localhost -c init.defaultBranch=main -c commit.gpgsign=false';
const LIST_FILES = `${GIT} ls-files -co --exclude-standard 2>/dev/null || find . -path ./node_modules -prune -o -path ./.git -prune -o -path ./dist -prune -o -type f -print`;
const binary = (text: string) => text.includes('\u0000') || text.includes('\uFFFD');
/** A change the parts' pages are made of (sources, the page, static files): parts reload unless the dev server did it. */
const shown = (path: string) => path.startsWith('src/') || path.startsWith('public/') || path === 'index.html';
class ProjectRetryFailed extends PodUnavailable {
  constructor() { super('Project tools could not restart.', 'Close and reopen den-kit, then try again.'); }
}

export class PodSession {
  readonly state = ref<PodState>('off');
  readonly message = ref('');
  readonly fix = ref<string | undefined>(undefined);
  /** The dev server's address (code parts load from it). */
  readonly portal = ref<string | null>(null);
  readonly log = shallowRef<PodLogEntry[]>([]);
  /** The end of what the dev server printed. */
  readonly devOutput = ref('');
  readonly parts = shallowRef<Record<string, PartReport>>({});
  /** Bumped when the project's files changed (parts reload unless the dev server already reloaded them). */
  readonly reloads = ref(0);
  readonly timings = ref<PodTimings>({});
  projectDir = '';
  readonly factory: PodFactory;
  private host: PodHost | null = null;
  private booting: Promise<PodHost> | null = null;
  private retrying: Promise<PodHost> | null = null;
  /** The pod's files as den-kit last wrote or read them (path → text). */
  private known = new Map<string, string>();
  private installedFor: string | null = null;
  private dev: PodProcess | null = null;
  private devStart: Promise<void> | null = null;
  /** The dev server stopped soon after starting this many times in a row (den-kit stops restarting it at 3). */
  private crashes = 0;
  private disposed = false;
  private queue: Promise<unknown> = Promise.resolve();
  private syncQueued = false;
  private controlsText = '';
  private entries = 0;
  private stopWatch: (() => void) | null = null;
  private portalWatch: (() => void) | null = null;
  private readonly session: KitSession;

  constructor(session: KitSession, factory: PodFactory) {
    this.session = session; this.factory = factory;
    if (!factory.kind) this.set('unavailable', factory.reason ?? 'No pod.', factory.fix);
  }

  get available(): boolean { return !!this.factory.kind; }
  get kind() { return this.host?.kind ?? this.factory.kind; }
  get booted(): boolean { return !!this.host; }
  get retryable(): boolean { return this.available && (this.state.value === 'failed' || this.state.value === 'unavailable') && !this.dev?.running; }

  /** Flush an existing pod's disk before its renderer closes; never boot or wait on its command queue. */
  async flush(): Promise<void> {
    const host = this.host;
    if (!host) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        host.run('sync', { cwd: host.home, timeoutMs: 2500 }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Project storage synchronization failed.')), FLUSH_TIMEOUT); }),
      ]);
      if (result.exitCode !== 0 || result.timedOut) throw new Error('Project storage synchronization failed.');
    } catch { throw new Error('Project storage synchronization failed.'); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }

  /** The pod, booted and in step with the work (the template stands in when the work has no project yet). */
  ensure(): Promise<PodHost> {
    if (!this.factory.kind) return Promise.reject(new PodUnavailable(this.factory.reason ?? 'No pod.', this.factory.fix));
    if (!this.booting) {
      const attempt = this.boot().catch(error => {
        if (this.booting === attempt) this.booting = null;
        throw this.failed(error);
      });
      this.booting = attempt;
    }
    return this.booting;
  }

  /** Explicit recovery: keep the pod and work, but replace the failed preview process. */
  retry(): Promise<PodHost> {
    if (!this.factory.kind) return this.ensure();
    if (this.retrying) return this.retrying;
    if (this.dev?.running) return Promise.reject(new ProjectRetryFailed());
    const previous = this.booting;
    const recovery = this.recover(previous).catch(error => {
      // A still-running process must not be duplicated by a later ordinary ensure().
      this.booting = this.host ? Promise.resolve(this.host) : null;
      throw this.failed(error);
    });
    this.retrying = recovery.finally(() => { this.retrying = null; });
    this.booting = this.retrying;
    return this.retrying;
  }

  private async recover(previous: Promise<PodHost> | null): Promise<PodHost> {
    await previous?.catch(() => undefined);
    if (!this.host) return this.boot();
    return this.enqueue(async () => {
      const host = this.host!;
      if (this.dev?.running) throw new ProjectRetryFailed();
      await this.devStart;
      if (this.dev?.running) throw new ProjectRetryFailed();
      this.crashes = 0;
      this.set('starting', 'Restarting project tools…');
      this.portal.value = null;
      this.dev = null;
      await this.writeAll(false);
      await this.install(true);
      await this.restartDev();
      this.stopWatch ??= watch(() => this.session.doc.value, () => this.scheduleSync());
      return host;
    });
  }

  private failed(error: unknown): unknown {
    const reported = error instanceof ProjectRetryFailed ? error : this.factory.audience === 'desktop' ? desktopProjectError(error) : error;
    this.set(this.host ? 'failed' : 'unavailable', reported instanceof Error ? reported.message : String(reported), reported instanceof PodUnavailable ? reported.fix : this.fix.value);
    return reported;
  }

  private async boot(): Promise<PodHost> {
    const started = performance.now();
    if (!this.host) {
      this.set('booting', 'Preparing project tools…');
      this.host = await this.factory.create(text => { if (this.state.value === 'booting') this.message.value = text; });
      this.projectDir = `${this.host.home}/work`;
      this.portalWatch = this.host.onPortal(p => { if (p.port === DEV_PORT) { this.portal.value = p.url; if (this.state.value === 'starting') this.set('ready', 'Ready.'); } });
      this.timings.value = { ...this.timings.value, bootMs: Math.round(performance.now() - started) };
    }
    const host = this.host;
    this.set('syncing', 'Preparing project files…');
    const synced = performance.now();
    await this.writeAll(true);
    await this.system(`[ -d .git ] || (${GIT} init -q && ${GIT} add -A && ${GIT} commit -qm 'den-kit: start' >/dev/null)`, 'git init');
    this.timings.value = { ...this.timings.value, syncMs: Math.round(performance.now() - synced) };
    await this.install(true);
    await this.restartDev();
    this.stopWatch ??= watch(() => this.session.doc.value, () => this.scheduleSync());
    return host;
  }

  private set(state: PodState, message: string, fix?: string) { this.state.value = state; this.message.value = message; this.fix.value = fix; }

  /** Work in order (file writes, installs and commands touch the same files). */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }
  /** One pending write of the document into the pod at a time (a knob drag changes the document many times). */
  private scheduleSync() {
    if (this.syncQueued || !this.host) return;
    this.syncQueued = true;
    void this.enqueue(async () => { this.syncQueued = false; await this.writeAll(false); }).catch(error => this.note(`Writing into the pod failed: ${error instanceof Error ? error.message : String(error)}`));
  }

  // ---- files ------------------------------------------------------------------------------------
  /** The document's files (or the template, while the work has no project) plus den-kit's generated ones. */
  wanted(): Map<string, string> {
    const doc = this.session.doc.value;
    const files = new Map(Object.entries(doc.project?.files ?? templateFiles()));
    files.set('src/kit/controls.ts', controlsSource(pluginSpec(doc, this.session.catalog, { probes: [] }).controls));
    return files;
  }

  /** Write what changed in the document into the pod (everything on the first sync, removing what the work does not have). */
  private async writeAll(first: boolean) {
    const host = this.host; if (!host) return;
    const wanted = this.wanted();
    if (first) {
      const listed = await host.run(`mkdir -p ${q(this.projectDir)} && cd ${q(this.projectDir)} && find . -path ./node_modules -prune -o -path ./.git -prune -o -path ./dist -prune -o -type f -print`, { cwd: host.home, timeoutMs: 60_000 });
      const stale = listed.output.split('\n').map(l => l.trim().replace(/^\.\//, '')).filter(p => p && !wanted.has(p) && !checkProjectPath(p));
      if (stale.length) await host.run(`rm -f -- ${stale.map(q).join(' ')}`, { cwd: this.projectDir, timeoutMs: 60_000 });
      this.known.clear();
    }
    let changed = false, packageChanged = false;
    for (const [path, text] of wanted) {
      if (this.known.get(path) === text) continue;
      await host.writeFile(`${this.projectDir}/${path}`, text);
      this.known.set(path, text);
      if (shown(path)) changed = true;
      if (path === 'package.json') packageChanged = true;
    }
    const gone = [...this.known.keys()].filter(p => !wanted.has(p));
    if (gone.length) { await host.run(`rm -f -- ${gone.map(q).join(' ')}`, { cwd: this.projectDir, timeoutMs: 60_000 }); for (const p of gone) this.known.delete(p); if (gone.some(shown)) changed = true; }
    this.controlsText = wanted.get('src/kit/controls.ts') ?? '';
    if (!first && packageChanged) await this.install(false).catch(() => undefined);
    if (!first && changed) this.reloads.value++;
  }

  /**
   * Read the project back (after a command, or the AI's write): the files that
   * differ from the document (null for deleted ones), and what was left out and why.
   */
  async collect(): Promise<{ files: Record<string, string | null>; skipped: string[] }> {
    const host = this.host; if (!host) return { files: {}, skipped: [] };
    return this.enqueue(async () => {
      const listed = await host.run(LIST_FILES, { cwd: this.projectDir, timeoutMs: 60_000 });
      const current = this.session.doc.value.project?.files ?? {};
      // While the work has no project, the pod holds the template: it all becomes the work's.
      const base = this.session.doc.value.project ? current : {};
      const files: Record<string, string | null> = {};
      const skipped: string[] = [];
      const seen = new Set<string>();
      for (const line of listed.output.split('\n')) {
        const path = line.trim().replace(/^\.\//, '');
        if (!path || seen.has(path) || path === CHECK_FILE) continue;
        if (GENERATED_FILES.has(path)) {
          const text = await host.readFile(`${this.projectDir}/${path}`);
          if (text !== null && text !== this.controlsText) { await host.writeFile(`${this.projectDir}/${path}`, this.controlsText); skipped.push(`${path} (made by den-kit from the patch; your change was undone — change the patch's controls instead)`); }
          continue;
        }
        const bad = checkProjectPath(path);
        if (bad) { skipped.push(`${path} (${bad})`); continue; }
        const text = await host.readFile(`${this.projectDir}/${path}`);
        if (text === null) continue;
        if (binary(text)) { skipped.push(`${path} (not text: pictures and fonts go in den-kit's assets, kit.asset(id) reads them)`); continue; }
        if (byteLength(text) > PROJECT_LIMITS.fileBytes) { skipped.push(`${path} (over ${PROJECT_LIMITS.fileBytes / 1024} KB)`); continue; }
        seen.add(path);
        this.known.set(path, text);
        if (base[path] !== text) files[path] = text;
      }
      for (const path of Object.keys(base)) if (!seen.has(path)) { files[path] = null; this.known.delete(path); }
      if (Object.keys(files).some(shown)) this.reloads.value++;
      return { files, skipped };
    });
  }

  async readFile(path: string): Promise<string | null> {
    const host = await this.ensure();
    return this.enqueue(() => host.readFile(`${this.projectDir}/${path}`));
  }
  async writeFile(path: string, text: string): Promise<void> {
    const host = await this.ensure();
    await this.enqueue(async () => { await host.writeFile(`${this.projectDir}/${path}`, text); });
  }

  // ---- commands ---------------------------------------------------------------------------------
  /** Run a command in the project (the AI's and the person's), logged with its output. */
  async bash(command: string, options: { who: PodWho; timeoutMs?: number } = { who: 'you' }): Promise<PodRunResult> {
    const host = await this.ensure();
    const timeoutMs = Math.min(MAX_COMMAND_TIMEOUT, Math.max(1000, options.timeoutMs ?? COMMAND_TIMEOUT));
    const entry = this.begin(options.who, command);
    const result = await this.enqueue(() => host.run(command, { cwd: this.projectDir, timeoutMs, onOutput: text => this.progress(entry, text) }));
    this.end(entry, result);
    // A command may have stopped the dev server, or fixed what kept it from starting: start it again.
    if (!this.dev?.running) { this.crashes = 0; await this.restartDev(); }
    return result;
  }

  /** The person's command (Project ▸ Terminal): what it changed lands as one undo step of theirs. */
  async runForYou(command: string): Promise<{ result: PodRunResult; changed: string[]; skipped: string[] }> {
    const result = await this.bash(command, { who: 'you' });
    const { files, skipped } = await this.collect();
    const changed = Object.keys(files);
    if (changed.length) {
      const r = this.session.commit([{ op: 'setProjectFiles', files }], { author: { kind: 'human' }, label: `Terminal: ${command.slice(0, 60)}` });
      if (!r.ok) this.note(`The project's changes could not be kept: ${r.error.message}`);
    }
    return { result, changed, skipped };
  }

  /** den-kit's own steps (logged too, so the person can see what happened). */
  private async system(command: string, label: string, timeoutMs = 300_000): Promise<PodRunResult> {
    const host = this.host!;
    const entry = this.begin('den-kit', label);
    const result = await host.run(command, { cwd: this.projectDir, timeoutMs, onOutput: text => this.progress(entry, text) });
    this.end(entry, result);
    return result;
  }
  /** A line in the log from den-kit itself (no command). */
  note(text: string) {
    const entry = this.begin('den-kit', text);
    this.end(entry, { exitCode: null, output: '', timedOut: false, ms: 0 });
  }

  private begin(who: PodWho, command: string): PodLogEntry {
    const entry: PodLogEntry = { id: ++this.entries, who, command, output: '', exitCode: null, running: true, timedOut: false, ms: 0, at: Date.now() };
    this.log.value = [...this.log.value, entry].slice(-LOG_LIMIT);
    return entry;
  }
  private progress(entry: PodLogEntry, text: string) {
    entry.output = keepEnd(entry.output + text, 40_000);
    this.log.value = this.log.value.map(e => e.id === entry.id ? { ...entry } : e);
  }
  private end(entry: PodLogEntry, result: PodRunResult) {
    Object.assign(entry, { output: keepEnd(result.output, 40_000), exitCode: result.exitCode, timedOut: result.timedOut, running: false, ms: result.ms });
    this.log.value = this.log.value.map(e => e.id === entry.id ? { ...entry } : e);
  }

  /** npm install when package.json is not what node_modules was installed for. */
  private async install(first: boolean) {
    const pkg = this.known.get('package.json') ?? '';
    if (!first && pkg === this.installedFor) return;
    const started = performance.now();
    const ready = this.state.value === 'ready';
    this.set('installing', 'Installing project dependencies…');
    const r = await this.system(`if cmp -s package.json node_modules/.den-kit-package.json 2>/dev/null; then echo 'packages are up to date'; else npm install --no-audit --no-fund && cp package.json node_modules/.den-kit-package.json; fi`, 'npm install', 600_000);
    this.timings.value = { ...this.timings.value, installMs: Math.round(performance.now() - started) };
    if (r.exitCode !== 0) {
      this.set('failed', `Project dependency installation failed${r.timedOut ? ' (it took too long)' : ''}.`, 'Check your internet connection, or ask the AI to check the project dependencies. The terminal has the error details.');
      throw new Error(`npm install failed:\n${r.output.slice(-2000)}`);
    }
    this.installedFor = pkg;
    if (ready || this.portal.value) this.set('ready', 'Ready.');
  }

  /** Start the dev server unless it is starting already. */
  private restartDev(): Promise<void> {
    this.devStart ??= this.startDev().catch(() => undefined).finally(() => { this.devStart = null; });
    return this.devStart;
  }

  private async startDev() {
    const host = this.host!;
    const started = performance.now();
    this.set('starting', 'Starting the project preview…');
    this.portal.value = null;
    const env: Record<string, string> = { PORT: String(DEV_PORT) };
    // BrowserPod forwards the server through an https portal: the page's live-reload socket goes to port 443 there.
    // Its file watching does not see folders made after the server started: src/parts is made before it starts,
    // and the template's vite.config.ts looks for other new folders (KIT_WATCH_NEW_FOLDERS).
    if (host.kind === 'browserpod') Object.assign(env, { KIT_HMR_CLIENT_PORT: '443', KIT_WATCH_NEW_FOLDERS: '1' });
    this.devOutput.value = '';
    const entry = this.begin('den-kit', 'npm run dev');
    const dev = host.start('dev', 'mkdir -p src/parts && npm run dev', { cwd: this.projectDir, env, onOutput: text => { this.devOutput.value = keepEnd(this.devOutput.value + text, 20_000); } });
    this.dev = dev;
    void dev.done.then(() => {
      this.end(entry, { exitCode: null, output: dev.output(), timedOut: false, ms: Math.round(performance.now() - started) });
      if (this.dev !== dev || this.disposed) return;
      // It stopped by itself (a crash, a broken config, a command that killed it): start it again, but not forever.
      this.crashes = performance.now() - started < 15_000 ? this.crashes + 1 : 0;
      if (this.crashes >= 3) { this.set('failed', 'The project preview keeps stopping.', 'Ask the AI to check the project, or inspect the terminal output. Run a command after fixing the project to start the preview again.'); return; }
      this.set('starting', 'The project preview stopped; restarting…');
      void this.restartDev();
    });
    // Wait for its address (a portal); a pod takes a while on the first start.
    const deadline = Date.now() + 180_000;
    while (!this.portal.value && dev.running && Date.now() < deadline) await new Promise(r => setTimeout(r, 200));
    if (this.dev !== dev || this.disposed) return;
    this.timings.value = { ...this.timings.value, devMs: Math.round(performance.now() - started) };
    if (this.portal.value) { this.set('ready', 'Ready.'); this.progress(entry, `\n(dev server at ${this.portal.value})\n`); }
    else if (!dev.running) this.set('failed', 'The project preview stopped before it was ready.', 'Ask the AI to check the project, or inspect the terminal output.');
    else this.set('failed', 'The project preview did not become ready in time.', 'Close and reopen den-kit, then try again.');
  }

  /** Commit the project in the pod (one commit per AI request; nothing to commit is fine). */
  async commit(message: string) {
    const host = this.host; if (!host) return;
    await this.enqueue(() => host.run(`${GIT} add -A && (${GIT} diff --cached --quiet || ${GIT} commit -qm ${q(message.replace(/\s+/g, ' ').slice(0, 200) || 'den-kit')})`, { cwd: this.projectDir, timeoutMs: 60_000 }));
  }

  /** What the AI's tools use (src/ai/llm-workspace.ts): the same pod, its commands logged as the AI's. */
  access(): PodAccess {
    return {
      unavailable: () => this.available ? null : { reason: this.message.value || 'No pod.', fix: this.fix.value },
      ensure: async () => { await this.ensure(); },
      bash: (command, timeoutMs) => this.bash(command, { who: 'ai', timeoutMs }),
      readFile: path => this.readFile(path),
      writeFile: (path, text) => this.writeFile(path, text),
      collect: () => this.collect(),
      projectDir: () => this.projectDir,
      parts: () => this.parts.value,
      status: () => ({ state: this.state.value, message: this.message.value, portal: this.portal.value }),
    };
  }

  /** The controls file den-kit generates (what parts can read and move). */
  get controls(): string { return this.controlsText || (this.wanted().get('src/kit/controls.ts') ?? ''); }

  /** A code part's news (PluginCode.vue): its state, settings, errors and console lines. */
  report(element: string, patch: Partial<PartReport> & { log?: string }) {
    const prev = this.parts.value[element] ?? { part: patch.part ?? '', state: 'loading' as const, logs: [] };
    const logs = patch.log ? [...prev.logs, patch.log].slice(-30) : prev.logs;
    const { log: _log, ...rest } = patch;
    this.parts.value = { ...this.parts.value, [element]: { ...prev, ...rest, logs } };
  }
  forget(element: string) {
    if (!(element in this.parts.value)) return;
    const { [element]: _gone, ...rest } = this.parts.value;
    this.parts.value = rest;
  }

  dispose() { this.disposed = true; this.stopWatch?.(); this.portalWatch?.(); this.host?.dispose?.(); }
}
