// Where the open work's code parts run, and what they may use. With the host's
// sandbox, their frames load from the work's own origin, which passes requests
// through to the workspace's dev server, with the origins and devices the person
// allowed for that work; without one, straight from the dev server. What the
// person allowed is kept in the host's storage by work, never in the work, so a
// work never arrives with network access already allowed.
import { computed, shallowRef, watch } from 'vue';
import type { Allowed, Device, Host } from '../host/index.ts';
import type { CodePartSource } from '../screen/code-frames.ts';
import type { PodSession } from '../workspace/pod-session.ts';
import { isContent, type WorkFile } from '../work/files.ts';
import { networkOrigin } from '../work/ui.ts';
import type { KitSession } from './session.ts';

const KEY = 'den-kit:allowed:';
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

export class CodeParts {
  /** What the person allowed for the open work's code parts. */
  readonly allowed = shallowRef<Allowed>(NONE);
  /** What the open work's code parts tried to reach and were refused (newest last). */
  readonly refused = shallowRef<Array<{ blocked: string; directive: string }>>([]);
  /** Where the frames come from (provided to the screen). */
  readonly source: CodePartSource;
  private readonly session: KitSession;
  private readonly host: Host;

  constructor(session: KitSession, pod: PodSession, host: Host) {
    this.session = session;
    this.host = host;
    const sandbox = host.sandbox;
    const work = () => session.doc.value.id;
    this.source = {
      get available() {
        return pod.available;
      },
      portal: computed(() =>
        !pod.portal.value ? null : sandbox ? `${sandbox.origin(work())}/` : pod.portal.value,
      ),
      state: pod.state,
      message: pod.message,
      reloads: pod.reloads,
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
        void host.storage.read(`${KEY}${id}`).then(
          text => {
            if (work() === id) this.allowed.value = parse(text);
          },
          () => undefined,
        );
      },
      { immediate: true },
    );
    if (!sandbox) return;
    let open: string | null = null,
      sent = '';
    watch(
      () =>
        [work(), pod.portal.value, this.allowed.value, served(session.doc.value.files)] as const,
      ([id, devServer, allowed, files]) => {
        if (open && open !== id) sandbox.close(open);
        const settings = { devServer, origins: allowed.origins, devices: allowed.devices, files };
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
