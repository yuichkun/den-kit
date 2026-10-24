// Where the open work's code parts run, and what they may use. With the host's
// sandbox, their frames load from the work's own origin, with the origins and
// devices the person allowed for that work: it passes requests through to the
// workspace's dev server while that runs, and otherwise serves the code parts as
// last built (when the work was exported or imported), if that build was made from
// the files the work has now. Without a sandbox, the frames load straight from the
// dev server. What the person allowed, and the last build, are kept in the host's
// storage by work, never in the work, so a work never arrives with network access
// already allowed.
import { computed, ref, shallowRef, watch } from 'vue';
import type { Allowed, Device, Host } from '../host/index.ts';
import type { CodePartSource } from '../screen/code-frames.ts';
import type { PodSession } from '../workspace/pod-session.ts';
import { isContent, typeOfPath, type WorkFile } from '../work/files.ts';
import { canonicalJson, hashString } from '../work/hash.ts';
import { networkOrigin } from '../work/ui.ts';
import type { KitSession } from './session.ts';

const KEY = 'den-kit:allowed:';
const BUILT_KEY = 'den-kit:built-parts:';
export const DEVICES: readonly Device[] = ['microphone', 'camera', 'midi'];
const NONE: Allowed = { origins: [], devices: [] };

function parse(text: string | null): Allowed {
  try {
    const v = JSON.parse(text ?? '') as Partial<Allowed>;
    return {
      origins: (Array.isArray(v.origins) ? v.origins : [])
        .map(o => networkOrigin(String(o)))
        .filter((o): o is string => !!o),
      devices: (Array.isArray(v.devices) ? v.devices : []).filter((d): d is Device =>
        DEVICES.includes(d as Device),
      ),
    };
  } catch {
    return NONE;
  }
}

/** The work's files the sandbox serves by path (stored contents; sources come from the dev server). */
function served(files: Record<string, WorkFile>) {
  const out: Record<string, { hash: string; type: string }> = {};
  for (const [path, f] of Object.entries(files))
    if (isContent(f) && f.hash) out[path] = { hash: f.hash, type: f.type };
  return out;
}

/** The code parts as last built: what they were built from, and their files as stored contents. */
interface Built {
  from: string;
  files: Record<string, { hash: string; type: string }>;
}
const WEB_TYPES: Record<string, string> = {
  html: 'text/html',
  js: 'text/javascript',
  mjs: 'text/javascript',
  css: 'text/css',
  wasm: 'application/wasm',
  map: 'application/json',
};
const builtType = (path: string) =>
  WEB_TYPES[path.split('.').at(-1)!.toLowerCase()] ?? typeOfPath(path).type;

function parseBuilt(text: string | null): Built | null {
  try {
    const v = JSON.parse(text ?? '') as Partial<Built>;
    if (typeof v.from !== 'string' || !v.files || typeof v.files !== 'object') return null;
    const files: Built['files'] = {};
    for (const [path, f] of Object.entries(v.files))
      if (typeof f?.hash === 'string' && typeof f.type === 'string')
        files[path] = { hash: f.hash, type: f.type };
    return { from: v.from, files };
  } catch {
    return null;
  }
}

export class CodeParts {
  /** What the person allowed for the open work's code parts. */
  readonly allowed = shallowRef<Allowed>(NONE);
  /** What the open work's code parts tried to reach and were refused (newest last). */
  readonly refused = shallowRef<Array<{ blocked: string; directive: string }>>([]);
  /** The open work's code parts as last built, or null. */
  readonly built = shallowRef<Built | null>(null);
  /** Where the frames come from (provided to the screen). */
  readonly source: CodePartSource;
  private readonly session: KitSession;
  private readonly pod: PodSession;
  private readonly host: Host;
  /** Times the frames switched between the dev server and the build (same address: they load again). */
  private readonly switches = ref(0);
  /** Bumped when the build is read or kept, so an older read does not land over a newer build. */
  private builtVersion = 0;

  constructor(session: KitSession, pod: PodSession, host: Host) {
    this.session = session;
    this.pod = pod;
    this.host = host;
    const sandbox = host.sandbox;
    const work = () => session.doc.value.id;
    // The build serves while there is no dev server, and only when made from what the work has now.
    const fromBuild = computed(
      () =>
        !!sandbox?.servesContents &&
        !pod.portal.value &&
        !!this.built.value &&
        this.built.value.from === this.builtFrom(),
    );
    this.source = {
      get available() {
        return pod.available || fromBuild.value;
      },
      portal: computed(() =>
        !pod.portal.value && !fromBuild.value
          ? null
          : sandbox
            ? `${sandbox.origin(work())}/`
            : pod.portal.value,
      ),
      state: pod.state,
      message: pod.message,
      reloads: computed(() => pod.reloads.value + this.switches.value),
      devices: computed(() => this.allowed.value.devices),
      ensure: () => pod.ensure(),
      report: (element, patch) => pod.report(element, patch),
      fileUrl: path => {
        const file = session.doc.value.files[path];
        return sandbox && isContent(file) && file.hash ? sandbox.fileUrl(work(), path) : null;
      },
    };
    watch(
      () => session.doc.value.id,
      id => {
        this.allowed.value = NONE;
        this.refused.value = [];
        this.built.value = null;
        void host.storage.read(`${KEY}${id}`).then(
          text => {
            if (work() === id) this.allowed.value = parse(text);
          },
          () => undefined,
        );
        const version = ++this.builtVersion;
        void host.storage.read(`${BUILT_KEY}${id}`).then(
          text => {
            if (work() === id && version === this.builtVersion) this.built.value = parseBuilt(text);
          },
          () => undefined,
        );
      },
      { immediate: true },
    );
    watch(
      () => (pod.portal.value ? 'dev server' : fromBuild.value ? 'build' : null),
      (now, before) => {
        if (now && before && now !== before) this.switches.value++;
      },
    );
    if (!sandbox) return;
    let open: string | null = null,
      sent = '';
    watch(
      () =>
        [
          work(),
          pod.portal.value,
          this.allowed.value,
          served(session.doc.value.files),
          sandbox.servesContents ? (this.built.value?.files ?? {}) : {},
        ] as const,
      ([id, devServer, allowed, files, build]) => {
        if (open && open !== id) sandbox.close(open);
        const settings = {
          devServer,
          origins: allowed.origins,
          devices: allowed.devices,
          files,
          build,
        };
        const key = JSON.stringify([id, settings]);
        if (open === id && key === sent) return;
        open = id;
        sent = key;
        sandbox.open(id, settings);
      },
      { immediate: true },
    );
    sandbox.onRefused(r => {
      if (r.work !== work()) return;
      this.refused.value = [
        ...this.refused.value,
        { blocked: r.blocked, directive: r.directive },
      ].slice(-20);
    });
  }

  /** What the code parts are built from now: the files the workspace gets, and the work's stored contents. */
  builtFrom(): string {
    return hashString(
      canonicalJson({
        files: Object.fromEntries(this.pod.wanted()),
        contents: served(this.session.doc.value.files),
      }),
    );
  }

  /** Keep the open work's code parts as built from `from` (builtFrom() when the build started). */
  async keep(files: Record<string, Uint8Array>, from: string): Promise<void> {
    const id = this.session.doc.value.id;
    this.builtVersion++;
    const built: Built = { from, files: {} };
    for (const [path, bytes] of Object.entries(files))
      built.files[path] = { hash: await this.session.assets.put(bytes), type: builtType(path) };
    await this.host.storage
      .write(`${BUILT_KEY}${id}`, JSON.stringify(built))
      .catch(() => undefined);
    if (this.session.doc.value.id === id) this.built.value = built;
  }

  /** Allow or stop allowing an origin, or a device, for the open work. */
  set(change: { origin: string; on: boolean } | { device: Device; on: boolean }) {
    const now = this.allowed.value;
    const next: Allowed =
      'origin' in change
        ? {
            ...now,
            origins: change.on
              ? [...new Set([...now.origins, change.origin])]
              : now.origins.filter(o => o !== change.origin),
          }
        : {
            ...now,
            devices: change.on
              ? [...new Set([...now.devices, change.device])]
              : now.devices.filter(d => d !== change.device),
          };
    this.allowed.value = next;
    void this.host.storage
      .write(`${KEY}${this.session.doc.value.id}`, JSON.stringify(next))
      .catch(() => undefined);
  }
}
