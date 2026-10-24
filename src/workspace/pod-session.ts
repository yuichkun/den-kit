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
import { ref, shallowRef, watch, type Ref } from 'vue';
import type { Author } from '../work/history.ts';
import type { OpError } from '../work/op-error.ts';
import type { Intent } from '../work/ops.ts';
import type { PatchDocument } from '../work/schema.ts';
import { WORK_LIMITS, checkPath, isGenerated, textFiles } from '../work/files.ts';

const byteLength = (text: string) => new TextEncoder().encode(text).length;
import { controlsSource, templateFiles } from './template.ts';
import { parameters } from '../work/parameters.ts';
import type { Catalog } from '../work/catalog.ts';
import { CHECK_FILE } from './pod-check.ts';
import type { PodFactory, PodHost, PodProcess, PodRunResult } from '../host/workspace.ts';
import { PodUnavailable, keepEnd } from './pod-io.ts';

/** What the workspace needs from the editing session: the work, and commit() for the files that changed. */
export interface WorkspaceSession {
  readonly doc: Readonly<Ref<PatchDocument>>;
  commit(
    intents: Intent[],
    options?: { author?: Author; label?: string },
  ): { ok: true } | { ok: false; error: OpError };
  /** What the work's blocks and controls are (its parameters go into the pod as src/kit/controls.ts). */
  readonly catalog: Catalog;
}

/** The pod as an AI's tools use it. */
export interface PodAccess {
  /** Why it cannot be used and what fixes that; null when it can. */
  unavailable(): { reason: string; fix?: string } | null;
  /** Started and in step with the work (the first call boots it: up to a few minutes on a fresh pod). */
  ensure(): Promise<void>;
  bash(command: string, timeoutMs: number): Promise<PodRunResult>;
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, text: string): Promise<void>;
  /** The project's files that differ from the work (null: deleted), and what was left out. */
  collect(): Promise<{ files: Record<string, string | null>; skipped: string[] }>;
  /** The project's folder in the pod. */
  projectDir(): string;
  /** The code parts on the plugin as they reported (element id → report). */
  parts(): Record<string, PartReport>;
  status(): { state: string; message: string; portal: string | null };
}

export type PodState =
  | 'off'
  | 'unavailable'
  | 'booting'
  | 'syncing'
  | 'installing'
  | 'starting'
  | 'ready'
  | 'failed';
export type PodWho = 'ai' | 'you' | 'den-kit';
export interface PodLogEntry {
  id: number;
  who: PodWho;
  command: string;
  output: string;
  exitCode: number | null;
  running: boolean;
  timedOut: boolean;
  ms: number;
  at: number;
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
export interface PodTimings {
  bootMs?: number;
  syncMs?: number;
  installMs?: number;
  devMs?: number;
}

export const DEV_PORT = 5173;
const COMMAND_TIMEOUT = 120_000;
const MAX_COMMAND_TIMEOUT = 600_000;
const FLUSH_TIMEOUT = 5000;
const LOG_LIMIT = 200;
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/** git with an identity and no signing (the pod has no config of its own). */
export const GIT =
  'git -c user.name=den-kit -c user.email=den-kit@localhost -c init.defaultBranch=main -c commit.gpgsign=false';
const LIST_FILES = `${GIT} ls-files -co --exclude-standard 2>/dev/null || find . -path ./node_modules -prune -o -path ./.git -prune -o -path ./dist -prune -o -type f -print`;
const binary = (text: string) => text.includes('\u0000') || text.includes('\uFFFD');
/** A change the parts' pages are made of (sources, the page, static files): parts reload unless the dev server did it. */
const shown = (path: string) =>
  path.startsWith('src/') || path.startsWith('public/') || path === 'index.html';
class ProjectRetryFailed extends PodUnavailable {
  constructor() {
    super('Project tools could not restart.', 'Close and reopen den-kit, then try again.');
  }
}

/** How den-kit installs packages: from the npm registry only, without running their install scripts. */
const NPM_INSTALL =
  'npm install --ignore-scripts --registry=https://registry.npmjs.org/ --no-audit --no-fund';

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
  /** A command or the AI wrote in the project after it was last read back. */
  private unread = false;
  private installedFor: string | null = null;
  private dev: PodProcess | null = null;
  private devStart: Promise<void> | null = null;
  /** The dev server stopped for an install (its end is not a crash). */
  private paused: PodProcess | null = null;
  /** The last install failed: its guidance stays when the dev server is ready again. */
  private installFailed = false;
  /** The dev server stopped soon after starting this many times in a row (den-kit stops restarting it at 3). */
  private crashes = 0;
  private disposed = false;
  private queue: Promise<unknown> = Promise.resolve();
  private syncQueued = false;
  private controlsText = '';
  /** The work this pod belongs to (its disk is that work's): set when it boots. */
  private work: string | null = null;
  /** den-kit's own kit files (the behaviors), written into the project as they are. */
  private readonly kit: Readonly<Record<string, string>>;
  private entries = 0;
  private stopWatch: (() => void) | null = null;
  private portalWatch: (() => void) | null = null;
  private readonly session: WorkspaceSession;

  constructor(
    session: WorkspaceSession,
    factory: PodFactory,
    kit: Readonly<Record<string, string>>,
  ) {
    this.session = session;
    this.factory = factory;
    this.kit = kit;
    if (!factory.kind) this.set('unavailable', factory.reason ?? 'No pod.', factory.fix);
  }

  get available(): boolean {
    return !!this.factory.kind;
  }
  get kind() {
    return this.host?.kind ?? this.factory.kind;
  }
  get booted(): boolean {
    return !!this.host;
  }
  /** Its first start takes minutes: start it as soon as den-kit first opens. */
  get startsEarly(): boolean {
    return !!this.factory.startEarly;
  }
  get retryable(): boolean {
    return (
      this.available &&
      (this.state.value === 'failed' || this.state.value === 'unavailable') &&
      !this.dev?.running
    );
  }

  /** Flush an existing pod's disk before its renderer closes; never boot or wait on its command queue. */
  async flush(): Promise<void> {
    const host = this.host;
    if (!host) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        host.run('sync', { cwd: host.home, timeoutMs: 2500 }).then(async r => {
          if (host.settleMs) await new Promise(settled => setTimeout(settled, host.settleMs));
          return r;
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Project storage synchronization failed.')),
            FLUSH_TIMEOUT,
          );
        }),
      ]);
      if (result.exitCode !== 0 || result.timedOut)
        throw new Error('Project storage synchronization failed.');
    } catch {
      throw new Error('Project storage synchronization failed.');
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** The pod, booted and in step with the work (the template stands in when the work has no project yet). */
  ensure(): Promise<PodHost> {
    if (!this.factory.kind)
      return Promise.reject(new PodUnavailable(this.factory.reason ?? 'No pod.', this.factory.fix));
    if (this.otherWork()) {
      const error = new PodUnavailable(
        'The project tools in this window belong to the work that started them.',
        "Reopen den-kit with this work open: it starts this work's own project tools.",
      );
      this.set('unavailable', error.message, error.fix);
      return Promise.reject(error);
    }
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
    this.retrying = recovery.finally(() => {
      this.retrying = null;
    });
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
      this.stopWatch ??= watch(
        () => this.session.doc.value,
        () => this.scheduleSync(),
      );
      return host;
    });
  }

  private failed(error: unknown): unknown {
    const reported =
      error instanceof ProjectRetryFailed ? error : (this.factory.explain?.(error) ?? error);
    this.set(
      this.host ? 'failed' : 'unavailable',
      reported instanceof Error ? reported.message : String(reported),
      reported instanceof PodUnavailable ? reported.fix : this.fix.value,
    );
    return reported;
  }

  /** The pod belongs to another work than the one open now (each work has its own disk). */
  private otherWork(): boolean {
    return this.work !== null && this.work !== this.session.doc.value.id;
  }

  private async boot(): Promise<PodHost> {
    const started = performance.now();
    if (!this.host) {
      this.set('booting', 'Preparing project tools…');
      const work = this.session.doc.value.id;
      this.host = await this.factory.create(work, text => {
        if (this.state.value === 'booting') this.message.value = text;
      });
      this.work = work;
      this.projectDir = `${this.host.home}/work`;
      this.portalWatch = this.host.onPortal(p => {
        if (p.port === DEV_PORT) {
          this.portal.value = p.url;
          if (this.state.value === 'starting') this.set('ready', 'Ready.');
        }
      });
      this.timings.value = {
        ...this.timings.value,
        bootMs: Math.round(performance.now() - started),
      };
    }
    const host = this.host;
    this.set('syncing', 'Preparing project files…');
    const synced = performance.now();
    await this.writeAll(true);
    await this.system(
      `[ -d .git ] || (${GIT} init -q && ${GIT} add -A && ${GIT} commit -qm 'den-kit: start' >/dev/null)`,
      'git init',
    );
    this.timings.value = { ...this.timings.value, syncMs: Math.round(performance.now() - synced) };
    await this.install(true);
    await this.restartDev();
    this.stopWatch ??= watch(
      () => this.session.doc.value,
      () => this.scheduleSync(),
    );
    return host;
  }

  private set(state: PodState, message: string, fix?: string) {
    this.state.value = state;
    this.message.value = message;
    this.fix.value = fix;
  }

  /** Work in order (file writes, installs and commands touch the same files). */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }
  /** One pending write of the document into the pod at a time (a knob drag changes the document many times). */
  private scheduleSync() {
    // Another work's files never go onto this work's disk.
    if (this.syncQueued || !this.host || this.otherWork()) return;
    this.syncQueued = true;
    void this.enqueue(async () => {
      this.syncQueued = false;
      await this.writeAll(false);
    }).catch(error =>
      this.note(
        `Writing into the pod failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  // ---- files ------------------------------------------------------------------------------------
  /** The document's files (or the template, while the work has no project) plus den-kit's generated ones. */
  wanted(doc: PatchDocument = this.session.doc.value): Map<string, string> {
    const own = textFiles(doc.files);
    const files = new Map(Object.entries(Object.keys(own).length ? own : templateFiles()));
    for (const [path, text] of Object.entries(this.kit)) files.set(path, text);
    files.set('src/kit/controls.ts', controlsSource(parameters(doc, this.session.catalog)));
    return files;
  }

  /** Write what changed in the document into the pod (everything on the first sync, removing what the work does not have). */
  private async writeAll(first: boolean) {
    const host = this.host;
    if (!host) return;
    const wanted = this.wanted();
    if (first) {
      const listed = await host.run(
        `mkdir -p ${q(this.projectDir)} && cd ${q(this.projectDir)} && find . -path ./node_modules -prune -o -path ./.git -prune -o -path ./dist -prune -o -type f -print`,
        { cwd: host.home, timeoutMs: 60_000 },
      );
      const stale = listed.output
        .split('\n')
        .map(l => l.trim().replace(/^\.\//, ''))
        .filter(p => p && !wanted.has(p) && !p.startsWith('assets/') && !checkPath(p));
      if (stale.length)
        await host.run(`rm -f -- ${stale.map(q).join(' ')}`, {
          cwd: this.projectDir,
          timeoutMs: 60_000,
        });
      this.known.clear();
    }
    let changed = false,
      packageChanged = false;
    for (const [path, text] of wanted) {
      if (this.known.get(path) === text) continue;
      await host.writeFile(`${this.projectDir}/${path}`, text);
      this.known.set(path, text);
      if (shown(path)) changed = true;
      if (path === 'package.json') packageChanged = true;
    }
    const gone = [...this.known.keys()].filter(p => !wanted.has(p));
    if (gone.length) {
      await host.run(`rm -f -- ${gone.map(q).join(' ')}`, {
        cwd: this.projectDir,
        timeoutMs: 60_000,
      });
      for (const p of gone) this.known.delete(p);
      if (gone.some(shown)) changed = true;
    }
    this.controlsText = wanted.get('src/kit/controls.ts') ?? '';
    if (!first && packageChanged) await this.install(false).catch(() => undefined);
    if (!first && changed) this.reloads.value++;
  }

  /**
   * Read the project back (after a command, or the AI's write): the files that
   * differ from the document (null for deleted ones), and what was left out and why.
   */
  async collect(): Promise<{ files: Record<string, string | null>; skipped: string[] }> {
    const host = this.host;
    if (!host) return { files: {}, skipped: [] };
    return this.enqueue(async () => {
      this.unread = false;
      const listed = await host.run(LIST_FILES, { cwd: this.projectDir, timeoutMs: 60_000 });
      // While the work has no sources, the pod holds the template: it all becomes the work's.
      const base = textFiles(this.session.doc.value.files);
      const files: Record<string, string | null> = {};
      const skipped: string[] = [];
      const seen = new Set<string>();
      for (const line of listed.output.split('\n')) {
        const path = line.trim().replace(/^\.\//, '');
        // Assets are the work's own files; commands do not change them (yet).
        if (!path || seen.has(path) || path === CHECK_FILE || path.startsWith('assets/')) continue;
        if (isGenerated(path)) {
          const made = this.generated(path);
          const text = await host.readFile(`${this.projectDir}/${path}`);
          if (text !== null && text !== made) {
            if (made === undefined)
              await host.run(`rm -f -- ${q(path)}`, { cwd: this.projectDir, timeoutMs: 10_000 });
            else await host.writeFile(`${this.projectDir}/${path}`, made);
            skipped.push(
              path === 'src/kit/controls.ts'
                ? `${path} (made by den-kit from the patch; your change was undone — change the patch's controls instead)`
                : `${path} (den-kit's own kit; your change was undone)`,
            );
          }
          continue;
        }
        const bad = checkPath(path);
        if (bad) {
          skipped.push(`${path} (${bad})`);
          continue;
        }
        const text = await host.readFile(`${this.projectDir}/${path}`);
        if (text === null) continue;
        if (binary(text)) {
          skipped.push(
            `${path} (not text: pictures and fonts go in den-kit's assets, kit.asset(id) reads them)`,
          );
          continue;
        }
        if (byteLength(text) > WORK_LIMITS.textBytes) {
          skipped.push(`${path} (over ${WORK_LIMITS.textBytes / 1024 / 1024} MB)`);
          continue;
        }
        seen.add(path);
        this.known.set(path, text);
        if (base[path] !== text) files[path] = text;
      }
      for (const path of Object.keys(base))
        if (!seen.has(path)) {
          files[path] = null;
          this.known.delete(path);
        }
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
    await this.enqueue(async () => {
      this.unread = true;
      await host.writeFile(`${this.projectDir}/${path}`, text);
    });
  }

  // ---- commands ---------------------------------------------------------------------------------
  /** Run a command in the project (the AI's and the person's), logged with its output. */
  async bash(
    command: string,
    options: { who: PodWho; timeoutMs?: number } = { who: 'you' },
  ): Promise<PodRunResult> {
    const host = await this.ensure();
    const timeoutMs = Math.min(
      MAX_COMMAND_TIMEOUT,
      Math.max(1000, options.timeoutMs ?? COMMAND_TIMEOUT),
    );
    const entry = this.begin(options.who, command);
    const result = await this.enqueue(() => {
      // den-kit's own commands put back what they change; others are read back after them.
      if (options.who !== 'den-kit') this.unread = true;
      return host.run(command, {
        cwd: this.projectDir,
        timeoutMs,
        onOutput: text => this.progress(entry, text),
      });
    });
    this.end(entry, result);
    // A command may have stopped the dev server, or fixed what kept it from starting: start it again.
    if (!this.dev?.running) {
      this.crashes = 0;
      await this.restartDev();
    }
    return result;
  }

  /** The person's command (Project ▸ Terminal): what it changed lands as one undo step of theirs. */
  async runForYou(
    command: string,
  ): Promise<{ result: PodRunResult; changed: string[]; skipped: string[] }> {
    const result = await this.bash(command, { who: 'you' });
    const { files, skipped } = await this.collect();
    const changed = Object.keys(files);
    if (changed.length) {
      const r = this.session.commit([{ op: 'setProjectFiles', files }], {
        author: { kind: 'human' },
        label: `Terminal: ${command.slice(0, 60)}`,
      });
      if (!r.ok) this.note(`The project's changes could not be kept: ${r.error.message}`);
    }
    return { result, changed, skipped };
  }

  /** den-kit's own steps (logged too, so the person can see what happened). */
  private async system(command: string, label: string, timeoutMs = 300_000): Promise<PodRunResult> {
    const host = this.host!;
    const entry = this.begin('den-kit', label);
    const result = await host.run(command, {
      cwd: this.projectDir,
      timeoutMs,
      onOutput: text => this.progress(entry, text),
    });
    this.end(entry, result);
    return result;
  }
  /**
   * The code parts of `doc` built for a playable build (npm run build in the project, in turn with the file
   * writes and commands): the built files by path; 'changed' when the project does not hold `doc`'s files (they
   * changed since, or what a command changed is not read back yet); null when there is no pod or the build
   * fails (the log shows why).
   */
  async buildParts(doc: PatchDocument): Promise<Record<string, Uint8Array> | 'changed' | null> {
    try {
      await this.ensure();
    } catch {
      return null;
    }
    const host = this.host!;
    return this.enqueue(async () => {
      const wanted = this.wanted(doc);
      if (
        this.unread ||
        wanted.size !== this.known.size ||
        [...wanted].some(([path, text]) => this.known.get(path) !== text)
      )
        return 'changed';
      // Relative addresses: the built pages work from any folder they are served from.
      const build = 'npm run build -- --base ./';
      if ((await this.system(build, `${build} (for the playable build)`)).exitCode !== 0)
        return null;
      // The pod reads files back as text: each built file goes as base64, one per line,
      // in den-kit's own folder of the pod's home (outside the project).
      const listing = `${host.home}/.den-kit/built-parts.txt`;
      const dump = await host.run(
        `mkdir -p "${host.home}/.den-kit" && cd dist && find . -type f | sort | while IFS= read -r f; do printf '%s\\t' "\${f#./}"; base64 < "$f" | tr -d '\\n'; printf '\\n'; done > "${listing}"`,
        { cwd: this.projectDir, timeoutMs: 120_000 },
      );
      const text = dump.exitCode === 0 ? await host.readFile(listing) : null;
      if (text === null) return null;
      const files: Record<string, Uint8Array> = {};
      for (const line of text.split('\n')) {
        const tab = line.indexOf('\t');
        if (tab <= 0) continue;
        const bytes = atob(line.slice(tab + 1));
        files[line.slice(0, tab)] = Uint8Array.from(bytes, c => c.charCodeAt(0));
      }
      return files;
    });
  }

  /** A line in the log from den-kit itself (no command). */
  note(text: string) {
    const entry = this.begin('den-kit', text);
    this.end(entry, { exitCode: null, output: '', timedOut: false, ms: 0 });
  }

  private begin(who: PodWho, command: string): PodLogEntry {
    const entry: PodLogEntry = {
      id: ++this.entries,
      who,
      command,
      output: '',
      exitCode: null,
      running: true,
      timedOut: false,
      ms: 0,
      at: Date.now(),
    };
    this.log.value = [...this.log.value, entry].slice(-LOG_LIMIT);
    return entry;
  }
  private progress(entry: PodLogEntry, text: string) {
    entry.output = keepEnd(entry.output + text, 40_000);
    this.log.value = this.log.value.map(e => (e.id === entry.id ? { ...entry } : e));
  }
  private end(entry: PodLogEntry, result: PodRunResult) {
    Object.assign(entry, {
      output: keepEnd(result.output, 40_000),
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      running: false,
      ms: result.ms,
    });
    this.log.value = this.log.value.map(e => (e.id === entry.id ? { ...entry } : e));
  }

  /** npm install when package.json is not what node_modules was installed for. */
  private async install(first: boolean) {
    const pkg = this.known.get('package.json') ?? '';
    if (!first && pkg === this.installedFor) return;
    const started = performance.now();
    const ready = this.state.value === 'ready';
    const paused = !first && !!this.dev?.running;
    this.set('installing', 'Installing project dependencies…');
    const r = await this.alone(() =>
      this.npm(
        `if cmp -s package.json node_modules/.den-kit-package.json 2>/dev/null; then echo 'packages are up to date'; else ${NPM_INSTALL} && cp package.json node_modules/.den-kit-package.json; fi`,
        'npm install',
        600_000,
      ),
    );
    this.timings.value = {
      ...this.timings.value,
      installMs: Math.round(performance.now() - started),
    };
    if (r.exitCode !== 0) {
      this.set(
        'failed',
        `Project dependency installation failed${r.timedOut ? ' (it took too long)' : ''}.`,
        'Check your internet connection, or ask the AI to check the project dependencies. The terminal has the error details.',
      );
      this.installFailed = true;
      throw new Error(`npm install failed:\n${r.output.slice(-2000)}`);
    }
    this.installFailed = false;
    this.installedFor = pkg;
    // A dev server stopped for the install is starting again, and says when it is ready.
    if (!paused && (ready || this.portal.value)) this.set('ready', 'Ready.');
  }

  /**
   * Run an install with nothing else running: everything in the pod stops while it
   * reaches the network (the dev server runs the work's own code, such as
   * vite.config.ts, and commands may have left processes in the background), and
   * the dev server starts again after.
   */
  private async alone<T>(install: () => Promise<T>): Promise<T> {
    const dev = this.dev?.running ? this.dev : null;
    if (dev) {
      this.paused = dev;
      this.portal.value = null;
      await dev.stop();
    }
    await this.host!.stopAll();
    try {
      return await install();
    } finally {
      if (dev) {
        this.paused = null;
        void this.restartDev();
      }
    }
  }

  /**
   * An install: the only time the pod reaches the internet. Only npm runs then,
   * from the npm registry, with packages' install scripts off; the network
   * closes again whatever happens.
   */
  private async npm(command: string, label: string, timeoutMs: number): Promise<PodRunResult> {
    const host = this.host!;
    host.network(true);
    try {
      return await this.system(command, label, timeoutMs);
    } finally {
      host.network(false);
    }
  }

  /** Install packages without keeping them in package.json (the pod check). */
  installPackages(specs: string): Promise<PodRunResult> {
    return this.enqueue(async () => {
      await this.ensure();
      return this.alone(() =>
        this.npm(`${NPM_INSTALL} --no-save ${specs}`, `npm install ${specs}`, 300_000),
      );
    });
  }

  /** Start the dev server unless it is starting already. */
  private restartDev(): Promise<void> {
    this.devStart ??= this.startDev()
      .catch(() => undefined)
      .finally(() => {
        this.devStart = null;
      });
    return this.devStart;
  }

  private async startDev() {
    const host = this.host!;
    const started = performance.now();
    this.set('starting', 'Starting the project preview…');
    this.portal.value = null;
    const env: Record<string, string> = { PORT: String(DEV_PORT) };
    // Where file watching does not see folders made after the server started: src/parts is made before it
    // starts, and the template's vite.config.ts looks for other new folders (KIT_WATCH_NEW_FOLDERS).
    if (host.watchMissesNewFolders) env.KIT_WATCH_NEW_FOLDERS = '1';
    this.devOutput.value = '';
    const entry = this.begin('den-kit', 'npm run dev');
    // exec: the script runs as npm, so stopping it stops the dev server too.
    const dev = host.start('dev', 'mkdir -p src/parts && exec npm run dev', {
      cwd: this.projectDir,
      env,
      onOutput: text => {
        this.devOutput.value = keepEnd(this.devOutput.value + text, 20_000);
      },
    });
    this.dev = dev;
    void dev.done.then(() => {
      this.end(entry, {
        exitCode: null,
        output: dev.output(),
        timedOut: false,
        ms: Math.round(performance.now() - started),
      });
      if (this.dev !== dev || this.disposed || this.paused === dev) return;
      // It stopped by itself (a crash, a broken config, a command that killed it): start it again, but not forever.
      this.crashes = performance.now() - started < 15_000 ? this.crashes + 1 : 0;
      if (this.crashes >= 3) {
        this.set(
          'failed',
          'The project preview keeps stopping.',
          'Ask the AI to check the project, or inspect the terminal output. Run a command after fixing the project to start the preview again.',
        );
        return;
      }
      this.set('starting', 'The project preview stopped; restarting…');
      void this.restartDev();
    });
    // Wait for its address (a portal); a pod takes a while on the first start.
    const deadline = Date.now() + 180_000;
    while (!this.portal.value && dev.running && Date.now() < deadline)
      await new Promise(r => setTimeout(r, 200));
    if (this.dev !== dev || this.disposed || this.paused === dev) return;
    this.timings.value = { ...this.timings.value, devMs: Math.round(performance.now() - started) };
    if (this.portal.value) {
      // After a failed install the preview runs again, and the install's guidance stays.
      if (!this.installFailed) this.set('ready', 'Ready.');
      this.progress(entry, `\n(dev server at ${this.portal.value})\n`);
    } else if (!dev.running)
      this.set(
        'failed',
        'The project preview stopped before it was ready.',
        'Ask the AI to check the project, or inspect the terminal output.',
      );
    else
      this.set(
        'failed',
        'The project preview did not become ready in time.',
        'Close and reopen den-kit, then try again.',
      );
  }

  /** Commit the project in the pod (one commit per AI request; nothing to commit is fine). */
  async commit(message: string) {
    const host = this.host;
    if (!host) return;
    await this.enqueue(() =>
      host.run(
        `${GIT} add -A && (${GIT} diff --cached --quiet || ${GIT} commit -qm ${q(message.replace(/\s+/g, ' ').slice(0, 200) || 'den-kit')})`,
        { cwd: this.projectDir, timeoutMs: 60_000 },
      ),
    );
  }

  /** What the AI's tools use (src/ai/llm-workspace.ts): the same pod, its commands logged as the AI's. */
  access(): PodAccess {
    return {
      unavailable: () =>
        this.available ? null : { reason: this.message.value || 'No pod.', fix: this.fix.value },
      ensure: async () => {
        await this.ensure();
      },
      bash: (command, timeoutMs) => this.bash(command, { who: 'ai', timeoutMs }),
      readFile: path => this.readFile(path),
      writeFile: (path, text) => this.writeFile(path, text),
      collect: () => this.collect(),
      projectDir: () => this.projectDir,
      parts: () => this.parts.value,
      status: () => ({
        state: this.state.value,
        message: this.message.value,
        portal: this.portal.value,
      }),
    };
  }

  /** The controls file den-kit generates (what parts can read and move). */
  get controls(): string {
    return this.controlsText || (this.wanted().get('src/kit/controls.ts') ?? '');
  }

  /** What den-kit writes at a path of its own (undefined: nothing, there). */
  generated(path: string): string | undefined {
    return path === 'src/kit/controls.ts' ? this.controls : this.kit[path];
  }

  /** A code part's news (PluginCode.vue): its state, settings, errors and console lines. */
  report(element: string, patch: Partial<PartReport> & { log?: string }) {
    const prev = this.parts.value[element] ?? {
      part: patch.part ?? '',
      state: 'loading' as const,
      logs: [],
    };
    const logs = patch.log ? [...prev.logs, patch.log].slice(-30) : prev.logs;
    const { log: _log, ...rest } = patch;
    this.parts.value = { ...this.parts.value, [element]: { ...prev, ...rest, logs } };
  }
  forget(element: string) {
    if (!(element in this.parts.value)) return;
    const { [element]: _gone, ...rest } = this.parts.value;
    this.parts.value = rest;
  }

  dispose() {
    this.disposed = true;
    this.stopWatch?.();
    this.portalWatch?.();
    this.host?.dispose?.();
  }
}
