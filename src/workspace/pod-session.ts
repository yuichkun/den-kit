// The work's pod: boots it when the work first needs it (the AI's first command,
// a code part to show, the Project drawer), keeps its copy of the screen project,
// the work's assets included so code can import them, in step with the document
// (an undo, an edit in den-kit or another work loaded is written into the pod),
// installs packages when package.json changes, keeps
// the dev server running and knows its address (the portal), runs commands for
// the AI and the person (logged, with their output), and reads the project back
// after a command so what changed lands in the document as one step (and undoes
// with it): text files as they are, assets once they pass the checks a file added
// by hand passes. What a command did to an asset that does not land is put back.
//
// The document is the record; the pod is the workbench. node_modules, .git and
// dist live only in the pod.
import { ref, shallowRef, watch, type Ref } from 'vue';
import type { Author } from '../work/history.ts';
import type { OpError } from '../work/op-error.ts';
import type { Intent } from '../work/ops.ts';
import type { PatchDocument } from '../work/schema.ts';
import {
  ASSETS,
  WORK_LIMITS,
  checkPath,
  fileTooLarge,
  isGenerated,
  isTextPath,
  overLimits,
  sha256,
  textFiles,
  type FileSource,
  type WorkFile,
} from '../work/files.ts';
import { usesOfAsset } from '../work/asset-uses.ts';
import { assetFile, assetSource, assetsOf, type AssetMeta } from '../work/ui.ts';

const byteLength = (text: string) => new TextEncoder().encode(text).length;
import { controlsSource, templateFiles } from './template.ts';
import { parameters } from '../work/parameters.ts';
import type { Catalog } from '../work/catalog.ts';
import { CHECK_FILE } from './pod-check.ts';
import type { PodFactory, PodHost, PodProcess, PodRunResult } from '../host/workspace.ts';
import { PodUnavailable, keepEnd } from './pod-io.ts';

/** What the workspace needs from the editing session: the work, its assets' contents, and commit() for what changed. */
export interface WorkspaceSession {
  readonly doc: Readonly<Ref<PatchDocument>>;
  readonly assets: {
    /** The contents of one of the work's assets (written into the pod too). */
    read(asset: AssetMeta): Promise<Uint8Array | null>;
    /** Check contents a command made for an asset at `path`, as a file added by hand is checked, and keep them: the asset they make (throws why not). */
    keep(path: string, bytes: Uint8Array): Promise<AssetMeta>;
  };
  /** The paths of the assets the work's sound reads, as its patch is now. */
  soundAssets(): string[];
  commit(
    intents: Intent[],
    options?: { author?: Author; label?: string },
  ): { ok: true } | { ok: false; error: OpError };
  /** What the work's blocks and controls are (its parameters go into the pod as src/kit/controls.ts). */
  readonly catalog: Catalog;
}

/** Lands operations on the work as one step, or says why it cannot. */
export type Land = (intents: Intent[]) => { ok: true } | { ok: false; message: string };
/** How a file of the project changed. */
export type FileChange = 'changed' | 'new' | 'deleted';
/** What reading the project back did: how each file changed (kept in the work unless refused), what was left out and why. */
export interface ReadBack {
  changes: Record<string, FileChange>;
  skipped: string[];
  /** Why the changes could not be kept: the work is as it was. */
  refused?: string;
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
  /** Read the project back and keep what changed in the work through `land`, as one step. */
  keepChanges(land: Land): Promise<ReadBack>;
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
/** den-kit's own git index of the stored assets as it wrote them: what a command changed or removed shows against it. */
const ASSET_INDEX = '.git/den-kit-assets';
const ASSET_MARK = '--den-kit-assets--';
/** Where an asset a command made comes from, as the work records it. */
const MADE_IN_PROJECT: FileSource = { title: 'Made by a command in the project' };
const binary = (text: string) => text.includes('\u0000') || text.includes('\uFFFD');
/** A reason without its full stop, to go on with what den-kit did. */
const unstop = (reason: string) => reason.replace(/\.$/, '');
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
  /** The work's assets in the pod as den-kit last wrote them (path → what their contents are). */
  private knownAssets = new Map<string, string>();
  /** The project is a git repository. */
  private repository = false;
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
    this.repository =
      (await this.system(`[ -d .git ] || ${GIT} init -q`, 'git init')).exitCode === 0;
    await this.excludeAssets();
    await this.indexAssets([...this.knownAssets.keys()], [], true);
    await this.system(
      `${GIT} rev-parse -q --verify HEAD >/dev/null || { ${GIT} add -A && ${GIT} commit -qm 'den-kit: start' >/dev/null; }`,
      'git commit',
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
    const doc = this.session.doc.value;
    const wanted = this.wanted(doc);
    const assets = assetsOf(doc.files);
    if (first) {
      const listed = await host.run(
        `mkdir -p ${q(this.projectDir)} && cd ${q(this.projectDir)} && find . -path ./node_modules -prune -o -path ./.git -prune -o -path ./dist -prune -o -type f -print`,
        { cwd: host.home, timeoutMs: 60_000 },
      );
      const stale = listed.output
        .split('\n')
        .map(l => l.trim().replace(/^\.\//, ''))
        .filter(p => p && !wanted.has(p) && !assets[p] && !checkPath(p));
      if (stale.length)
        await host.run(`rm -f -- ${stale.map(q).join(' ')}`, {
          cwd: this.projectDir,
          timeoutMs: 60_000,
        });
      this.known.clear();
      this.knownAssets.clear();
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
    const assetsBefore = [...this.knownAssets.keys()].sort().join('\n');
    const written: string[] = [];
    for (const asset of Object.values(assets)) {
      if (this.knownAssets.get(asset.id) === assetSource(asset)) continue;
      // Contents that are not here are written with the next change.
      const bytes = await this.session.assets.read(asset);
      if (!bytes) continue;
      await host.writeFile(`${this.projectDir}/${asset.id}`, bytes);
      this.knownAssets.set(asset.id, assetSource(asset));
      written.push(asset.id);
    }
    const goneAssets = [...this.knownAssets.keys()].filter(p => !assets[p]);
    // A text file that took an asset's path was written above: it stays.
    const removed = goneAssets.filter(p => !wanted.has(p));
    if (removed.length)
      await host.run(`rm -f -- ${removed.map(q).join(' ')}`, {
        cwd: this.projectDir,
        timeoutMs: 60_000,
      });
    for (const p of goneAssets) this.knownAssets.delete(p);
    if ([...this.knownAssets.keys()].sort().join('\n') !== assetsBefore) await this.excludeAssets();
    // On the first sync the index is made again after git init (boot).
    if (!first) await this.indexAssets(written, goneAssets);
    this.controlsText = wanted.get('src/kit/controls.ts') ?? '';
    if (!first && packageChanged) await this.install(false).catch(() => undefined);
    if (!first && changed) this.reloads.value++;
  }

  /**
   * Read the project back (after a command, or the AI's write) and keep what changed in the work with `land`, as one
   * step: text files as they are, and the assets a command changed, made under assets/ or removed once they pass
   * the checks a file added by hand passes. What a command did to an asset that does not land is put back, so the
   * project's assets stay the work's.
   */
  async keepChanges(land: Land): Promise<ReadBack> {
    if (!this.host) return { changes: {}, skipped: [] };
    return this.enqueue(async () => {
      this.unread = false;
      const doc = this.session.doc.value;
      const { files, assets, skipped } = await this.readBack(doc);
      const base = textFiles(doc.files);
      const stored = assetsOf(doc.files);
      const changes: Record<string, FileChange> = {};
      const intents: Intent[] = [];
      if (Object.keys(files).length) intents.push({ op: 'setProjectFiles', files });
      for (const [path, text] of Object.entries(files))
        changes[path] = text === null ? 'deleted' : path in base ? 'changed' : 'new';
      for (const [path, asset] of assets) {
        changes[path] = !asset ? 'deleted' : stored[path] ? 'changed' : 'new';
        if (!asset) intents.push({ op: 'removeAsset', id: path });
        else if (stored[path])
          intents.push({
            op: 'replaceAsset',
            id: path,
            contents: {
              hash: asset.hash!,
              bytes: asset.bytes,
              width: asset.width,
              height: asset.height,
            },
          });
        else {
          const source = await this.sourceOf(asset, stored);
          intents.push({ op: 'addAsset', asset: { ...asset, ...(source ? { source } : {}) } });
        }
      }
      if (Object.keys(files).some(shown)) this.reloads.value++;
      if (!intents.length) return { changes, skipped };
      const landed = land(intents);
      if (!landed.ok) {
        await this.putBack([...assets.keys()]);
        return { changes, skipped, refused: landed.message };
      }
      // The project holds the work's assets as den-kit would have written them.
      const before = [...this.knownAssets.keys()].sort().join('\n');
      for (const [path, asset] of assets)
        if (asset) this.knownAssets.set(path, assetSource(asset));
        else this.knownAssets.delete(path);
      if ([...this.knownAssets.keys()].sort().join('\n') !== before) await this.excludeAssets();
      await this.indexAssets(
        [...assets].filter(([, a]) => a).map(([p]) => p),
        [...assets].filter(([, a]) => !a).map(([p]) => p),
      );
      return { changes, skipped };
    });
  }

  /**
   * What differs between the project and `doc`: text files (null for deleted ones), checked assets (their new
   * contents, null for removed ones), and what was left out and why. What a command did to an asset that is left
   * out is put back here.
   */
  private async readBack(doc: PatchDocument): Promise<{
    files: Record<string, string | null>;
    assets: Map<string, AssetMeta | null>;
    skipped: string[];
  }> {
    const host = this.host!;
    // While the work has no sources, the pod holds the template: it all becomes the work's.
    const base = textFiles(doc.files);
    const stored = assetsOf(doc.files);
    const files: Record<string, string | null> = {};
    const assets = new Map<string, AssetMeta | null>();
    const skipped: string[] = [];
    // Stored assets a command changed or removed: a removed one goes unless something uses it.
    const { changed, removed } = await this.storedChanges(doc);
    const restore: string[] = [];
    for (const path of removed) {
      const uses = usesOfAsset(doc, path);
      if (!uses.length) {
        assets.set(path, null);
        continue;
      }
      restore.push(path);
      skipped.push(
        `${path} (used by ${uses.join(', ')}, so den-kit put it back: change those first)`,
      );
    }
    const listed = await host.run(LIST_FILES, { cwd: this.projectDir, timeoutMs: 60_000 });
    const made: string[] = [];
    const gone: string[] = [];
    const seen = new Set<string>();
    for (const line of listed.output.split('\n')) {
      const path = line.trim().replace(/^\.\//, '');
      // The work's stored assets were read through den-kit's index above.
      if (
        !path ||
        seen.has(path) ||
        path === CHECK_FILE ||
        stored[path] ||
        this.knownAssets.has(path)
      )
        continue;
      if (isGenerated(path)) {
        const own = this.generated(path);
        const text = await host.readFile(`${this.projectDir}/${path}`);
        if (text !== null && text !== own) {
          if (own === undefined)
            await host.run(`rm -f -- ${q(path)}`, { cwd: this.projectDir, timeoutMs: 10_000 });
          else await host.writeFile(`${this.projectDir}/${path}`, own);
          skipped.push(
            path === 'src/kit/controls.ts'
              ? `${path} (made by den-kit from the patch; your change was undone — change the patch's controls instead)`
              : `${path} (den-kit's own kit; your change was undone)`,
          );
        }
        continue;
      }
      // A file under assets/ whose name is not a text file's is a new asset.
      const fresh = path.startsWith(ASSETS) && !isTextPath(path) && !(path in base);
      const bad = checkPath(path);
      if (bad) {
        if (fresh) gone.push(path);
        skipped.push(
          fresh
            ? `${path} (${unstop(bad)} — den-kit took it out of the project)`
            : `${path} (${bad})`,
        );
        continue;
      }
      if (fresh) {
        made.push(path);
        continue;
      }
      if (!isTextPath(path)) {
        // Kept as it is in the work, when the work has it as text (a work file made elsewhere).
        seen.add(path);
        if (path in base && (await host.readFile(`${this.projectDir}/${path}`)) === base[path])
          continue;
        skipped.push(
          `${path} (outside assets/, den-kit keeps only text files, with names such as .ts, .js, .json or .md: rename it, or put a picture, sound or other asset under assets/)`,
        );
        continue;
      }
      const text = await host.readFile(`${this.projectDir}/${path}`);
      if (text === null) continue;
      if (binary(text)) {
        skipped.push(
          `${path} (not text, though its name is a text file's: pictures, fonts and sounds go under assets/, named by their kind, such as .png or .wav)`,
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
    // The changed and new assets' contents, checked as a file added by hand is and kept. Their sizes come first:
    // a file is read, one at a time, only while the work stays within its limits with it.
    const sizes = await this.sizes([...changed, ...made]);
    const next: Record<string, WorkFile> = { ...doc.files };
    for (const [path, text] of Object.entries(files))
      if (text === null) delete next[path];
      else next[path] = { text };
    for (const path of removed) if (assets.has(path)) delete next[path];
    const keep = async (path: string, read?: Uint8Array | null): Promise<AssetMeta | string> => {
      const size = sizes.get(path);
      if (size === undefined) return `${path} could not be read.`;
      const large = fileTooLarge(path, size);
      if (large) return large;
      // Counted as new contents until they are read.
      const was = next[path];
      const back = () => {
        if (was) next[path] = was;
        else delete next[path];
      };
      next[path] = { hash: `unread:${path}`, bytes: size, type: 'application/octet-stream' };
      const over = overLimits(next);
      if (over) {
        back();
        return over;
      }
      const bytes = read === undefined ? await this.readBytes(path) : read;
      if (!bytes) {
        back();
        return `${path} could not be read.`;
      }
      try {
        const asset = await this.session.assets.keep(path, bytes);
        next[path] = assetFile(asset);
        return asset;
      } catch (error) {
        back();
        return error instanceof Error ? error.message : String(error);
      }
    };
    // A changed one the sound plays stays as it is: the sound changes on the patch, by reading another file.
    const sounding = new Set(changed.length ? this.session.soundAssets() : []);
    const unchanged: string[] = [];
    for (const path of changed) {
      // As large as before: perhaps the same contents again (a file touched or written over), and nothing to keep.
      const read = sizes.get(path) === stored[path]!.bytes ? await this.readBytes(path) : undefined;
      if (read && (await sha256(read)) === stored[path]!.hash) {
        unchanged.push(path);
        continue;
      }
      if (sounding.has(path)) {
        const uses = usesOfAsset(doc, path);
        restore.push(path);
        skipped.push(
          `${path} (the sound plays it, so den-kit put it back: save the new contents under another name and point ${uses.length ? uses.join(' and ') : 'what plays it'} at that file)`,
        );
        continue;
      }
      const asset = await keep(path, read);
      if (typeof asset !== 'string') assets.set(path, asset);
      else {
        restore.push(path);
        skipped.push(`${path} (${unstop(asset)} — den-kit put the work's version back)`);
      }
    }
    for (const path of made) {
      const asset = await keep(path);
      if (typeof asset === 'string') {
        gone.push(path);
        skipped.push(`${path} (${unstop(asset)} — den-kit took it out of the project)`);
      } else assets.set(path, asset);
    }
    await this.putBack([...restore, ...gone]);
    await this.indexAssets(unchanged, []);
    return { files, assets, skipped };
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
    const { changes, skipped, refused } = await this.keepChanges(intents => {
      const r = this.session.commit(intents, {
        author: { kind: 'human' },
        label: `Terminal: ${command.slice(0, 60)}`,
      });
      return r.ok ? r : { ok: false, message: r.error.message };
    });
    const changed = Object.keys(changes);
    if (!refused) return { result, changed, skipped };
    this.note(`The project's changes could not be kept: ${refused}`);
    return { result, changed: [], skipped: [`${changed.join(', ')} (${refused})`, ...skipped] };
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
      if (!this.holds(doc)) return 'changed';
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

  /** The pod's git leaves out the work's stored assets that den-kit wrote (text files under assets/ stay in). */
  private async excludeAssets() {
    // Not before git init: a .git folder made here would keep it from running.
    if (!this.repository) return;
    const lines = [...this.knownAssets.keys()].sort().map(p => `/${p.replace(/[\\*?[]/g, '\\$&')}`);
    await this.host!.writeFile(
      `${this.projectDir}/.git/info/exclude`,
      `# The work's stored assets: den-kit writes them from the work.\n${lines.map(l => `${l}\n`).join('')}`,
    );
  }

  /** Note in den-kit's own index the stored assets it wrote, and drop the ones it took out (`fresh`: make the index again). */
  private async indexAssets(written: readonly string[], removed: readonly string[], fresh = false) {
    if (!this.repository) return;
    const git = `GIT_INDEX_FILE=${q(`${this.projectDir}/${ASSET_INDEX}`)} ${GIT}`;
    const steps: string[] = [];
    if (fresh) steps.push(`rm -f ${q(ASSET_INDEX)}`);
    if (written.length)
      steps.push(`${git} update-index --add --info-only -- ${written.map(q).join(' ')}`);
    if (removed.length)
      steps.push(`${git} update-index --force-remove -- ${removed.map(q).join(' ')}`);
    if (steps.length)
      await this.host!.run(steps.join(' && '), { cwd: this.projectDir, timeoutMs: 120_000 });
  }

  /**
   * The stored assets a command changed or removed since den-kit wrote them (den-kit's index), of those the work
   * still has as den-kit wrote them (one the work has changed since is written with the next sync). Those the
   * index does not hold are put back, to be sure.
   */
  private async storedChanges(
    doc: PatchDocument,
  ): Promise<{ changed: string[]; removed: string[] }> {
    if (!this.knownAssets.size) return { changed: [], removed: [] };
    let indexed = new Set<string>(),
      modified = new Set<string>(),
      deleted = new Set<string>();
    if (this.repository) {
      const git = `GIT_INDEX_FILE=${q(`${this.projectDir}/${ASSET_INDEX}`)} ${GIT}`;
      const r = await this.host!.run(
        `${git} ls-files && echo ${ASSET_MARK} && ${git} ls-files -m && echo ${ASSET_MARK} && ${git} ls-files -d`,
        { cwd: this.projectDir, timeoutMs: 60_000 },
      );
      // The output comes trimmed: the lists are told apart by the marks between them.
      const lists: string[][] = [[]];
      for (const line of r.output.split('\n').map(l => l.trim()))
        if (line === ASSET_MARK) lists.push([]);
        else if (line) lists.at(-1)!.push(line);
      if (r.exitCode === 0 && lists.length === 3)
        [indexed, modified, deleted] = lists.map(list => new Set(list)) as [
          Set<string>,
          Set<string>,
          Set<string>,
        ];
    }
    const assets = assetsOf(doc.files);
    const changed: string[] = [],
      removed: string[] = [],
      unheld: string[] = [];
    for (const [path, source] of this.knownAssets) {
      const asset = assets[path];
      if (!asset || assetSource(asset) !== source) continue;
      if (!indexed.has(path)) unheld.push(path);
      else if (deleted.has(path)) removed.push(path);
      else if (modified.has(path)) changed.push(path);
    }
    await this.putBack(unheld);
    return { changed, removed };
  }

  /**
   * Put the work's version of these assets back in the project, and take out what a command made at a path where
   * the work has nothing (what a command did to them is not kept). One the work changed since den-kit wrote it
   * is left to the next sync.
   */
  private async putBack(paths: readonly string[]) {
    if (!paths.length) return;
    const host = this.host!;
    const assets = assetsOf(this.session.doc.value.files);
    const written: string[] = [],
      gone: string[] = [];
    for (const path of paths) {
      const asset = assets[path],
        known = this.knownAssets.get(path);
      if (!asset) {
        if (known === undefined && !(path in this.session.doc.value.files)) gone.push(path);
        continue;
      }
      if (known === undefined || assetSource(asset) !== known) continue;
      const bytes = await this.session.assets.read(asset);
      if (!bytes) {
        // Not here: written with the next change, and the project does not hold the work until then.
        this.knownAssets.delete(path);
        continue;
      }
      await host.writeFile(`${this.projectDir}/${path}`, bytes);
      written.push(path);
    }
    if (gone.length)
      await host.run(`rm -f -- ${gone.map(q).join(' ')}`, {
        cwd: this.projectDir,
        timeoutMs: 60_000,
      });
    await this.indexAssets(written, []);
  }

  /**
   * Where an asset a command made comes from: a copy of one of the work's assets (or one moved) comes from where
   * that one came from (none, if it records none); anything else, from a command in the project.
   */
  private async sourceOf(
    asset: AssetMeta,
    stored: Readonly<Record<string, AssetMeta>>,
  ): Promise<FileSource | undefined> {
    for (const other of Object.values(stored)) {
      // A file den-kit ships has no hash in the work: its contents tell.
      const same = other.hash
        ? other.hash === asset.hash
        : other.bytes === asset.bytes &&
          (await sha256((await this.session.assets.read(other)) ?? new Uint8Array())) ===
            asset.hash;
      if (same) return other.source;
    }
    return MADE_IN_PROJECT;
  }

  /**
   * Run a command whose output goes to a file in den-kit's own folder of the pod's home (outside the project), and
   * read that file back: command output comes trimmed, and only its end when it is long.
   */
  private async through(command: (out: string) => string): Promise<string | null> {
    const host = this.host!;
    const out = `${host.home}/.den-kit/read-back.txt`;
    const r = await host.run(`mkdir -p "${host.home}/.den-kit" && ${command(`"${out}"`)}`, {
      cwd: this.projectDir,
      timeoutMs: 120_000,
    });
    const text = r.exitCode === 0 ? await host.readFile(out) : null;
    await host.run(`rm -f "${out}"`, { cwd: this.projectDir, timeoutMs: 10_000 });
    return text;
  }

  /** The sizes in bytes of files of the project (one that is not there is left out). */
  private async sizes(paths: readonly string[]): Promise<Map<string, number>> {
    const sizes = new Map<string, number>();
    if (!paths.length) return sizes;
    const text = await this.through(
      out =>
        `for f in ${paths.map(q).join(' ')}; do [ -f "$f" ] && printf '%s\\t%s\\n' "$f" "$(wc -c < "$f" | tr -d ' ')"; done > ${out}; true`,
    );
    for (const line of text?.split('\n') ?? []) {
      const [path, size] = line.split('\t');
      if (path && size && /^\d+$/.test(size)) sizes.set(path, Number(size));
    }
    return sizes;
  }

  /** A file of the project as bytes (the pod reads files back as text: it comes as base64), or null. */
  private async readBytes(path: string): Promise<Uint8Array | null> {
    const text = await this.through(
      out => `set -o pipefail; [ -f ${q(path)} ] && base64 < ${q(path)} | tr -d '\\n' > ${out}`,
    );
    return text === null ? null : Uint8Array.from(atob(text.trim()), c => c.charCodeAt(0));
  }

  /** The project holds `doc`'s files: what den-kit last wrote or read back is theirs, and no command's changes wait to be read. */
  private holds(doc: PatchDocument): boolean {
    const wanted = this.wanted(doc);
    const assets = Object.values(assetsOf(doc.files));
    return (
      !this.unread &&
      wanted.size === this.known.size &&
      [...wanted].every(([path, text]) => this.known.get(path) === text) &&
      assets.length === this.knownAssets.size &&
      assets.every(a => this.knownAssets.get(a.id) === assetSource(a))
    );
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
    let r: PodRunResult;
    try {
      r = await this.alone(() =>
        this.npm(
          `if cmp -s package.json node_modules/.den-kit-package.json 2>/dev/null; then echo 'packages are up to date'; else ${NPM_INSTALL} && cp package.json node_modules/.den-kit-package.json; fi`,
          'npm install',
          600_000,
        ),
      );
    } catch (error) {
      this.set(
        'failed',
        `Project dependencies were not installed. ${error instanceof Error ? error.message : String(error)}`,
        'Close and reopen den-kit, then try again.',
      );
      this.installFailed = true;
      throw error;
    }
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
    try {
      // When that cannot be made sure, nothing is installed and the network stays closed.
      await this.host!.stopAll();
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
      keepChanges: land => this.keepChanges(land),
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
