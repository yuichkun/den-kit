// The link between a part's page and den-kit (the page around it). den-kit
// opens this page in a frame on the plugin with ?part=<name>&el=<element id>
// &host=<its origin>, and they talk with postMessage only:
//   page → den-kit: hello (the part's settings), ready, set / end (moves), error,
//                   log, picture (a PNG of the part), asset? (a picture by id), key
//                   (keys the part does not use), missing (no such part)
//   den-kit → page: init, props, controls, frame (sound + values), look, size,
//                   mode, picture? (asks for one), asset (bytes)
import type { Audio, ControlValue, Kit, Part, PropSpecs, PropValues } from './index';
import { CONTROLS, type ControlId } from './controls';
import { picture } from './picture';

type Modules = Record<string, () => Promise<unknown>>;
interface Range { min: number; max: number; log: boolean; unit: string }
interface FrameMsg { t: number; level: number; peak: number; wave: Float32Array; spectrum: Float32Array; values: Record<string, ControlValue>; norms: Record<string, number>; acked: number }

const query = new URLSearchParams(location.search);
const partName = query.get('part') ?? '';
const elementId = query.get('el') ?? '';
const host = query.get('host') ?? '*';

function post(message: Record<string, unknown>, transfer: Transferable[] = []) {
  if (window.parent === window) return;
  window.parent.postMessage({ denkit: 1, el: elementId, ...message }, host, transfer);
}
const text = (v: unknown) => v instanceof Error ? `${v.name}: ${v.message}` : typeof v === 'string' ? v : (() => { try { return JSON.stringify(v); } catch { return String(v); } })();

// ---- errors and logs go to den-kit (the AI reads them; the box shows them) -----------------------
window.addEventListener('error', e => post({ type: 'error', message: e.error instanceof Error ? `${e.error.name}: ${e.error.message}` : e.message, stack: e.error instanceof Error ? e.error.stack : `${e.filename}:${e.lineno}:${e.colno}` }));
window.addEventListener('unhandledrejection', e => post({ type: 'error', message: `Unhandled rejection: ${text(e.reason)}`, stack: e.reason instanceof Error ? e.reason.stack : undefined }));
for (const level of ['error', 'warn', 'log', 'info'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => { original(...args); post({ type: 'log', level, text: args.map(text).join(' ').slice(0, 2000) }); };
}
if (import.meta.hot) {
  import.meta.hot.on('vite:error', payload => { const err = (payload as { err?: { message?: string; id?: string; loc?: { file?: string; line?: number; column?: number } } }).err; post({ type: 'error', message: `Build error: ${err?.message ?? 'unknown'}`, stack: err?.loc ? `${err.loc.file ?? err.id ?? ''}:${err.loc.line ?? ''}:${err.loc.column ?? ''}` : err?.id }); });
  import.meta.hot.on('vite:ws:disconnect', () => post({ type: 'hmr', state: 'disconnected' }));
  import.meta.hot.on('vite:ws:connect', () => post({ type: 'hmr', state: 'connected' }));
}

// Keys the part does not use go on to den-kit (⌘Z, the computer keyboard's notes, Space…), so clicking a
// part does not take the keyboard away. A part that uses a key calls preventDefault() on it.
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
for (const kind of ['keydown', 'keyup'] as const) {
  window.addEventListener(kind, e => {
    if (typing(e.target)) return;
    setTimeout(() => { if (!e.defaultPrevented) post({ type: 'key', kind, key: e.key, code: e.code, meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, repeat: e.repeat }); });
  });
}

// A WebGL canvas keeps its picture between frames, so den-kit can take a picture of it.
const getContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, options?: Record<string, unknown>) {
  if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') options = { preserveDrawingBuffer: true, ...options };
  return (getContext as (this: HTMLCanvasElement, type: string, options?: unknown) => RenderingContext | null).call(this, type, options);
} as typeof HTMLCanvasElement.prototype.getContext;

// ---- values --------------------------------------------------------------------------------------
const ranges: Record<string, Range> = {};
for (const [id, c] of Object.entries(CONTROLS) as Array<[string, { min?: number; max?: number; scale?: string; unit?: string }]>) ranges[id] = { min: c.min ?? 0, max: c.max ?? 1, log: c.scale === 'log', unit: c.unit ?? '' };
const values: Record<string, ControlValue> = {};
const norms: Record<string, number> = {};
const toUnit = (v: number, r: Range) => r.log ? Math.log(v / r.min) / Math.log(r.max / r.min) : (v - r.min) / (r.max - r.min || 1);
const fromUnit = (n: number, r: Range) => { const u = Math.min(1, Math.max(0, n)); return r.log ? r.min * Math.pow(r.max / r.min, u) : r.min + u * (r.max - r.min); };
/** What this page wrote that den-kit has not taken in yet (it keeps reading its own value until then). */
const pending = new Map<string, { value: ControlValue; write: number }>();
let writes = 0;
let gesture: string | null = null, loose: { key: string; timer?: ReturnType<typeof setTimeout> } | null = null, gestures = 0;

function known(id: string): void {
  if (values[id] === undefined) throw new Error(`No control "${id}". Controls: ${Object.keys(values).join(', ') || 'none (add a knob, slider, switch or XY pad to the patch first)'}.`);
}
function write(id: string, value: ControlValue) {
  known(id);
  const current = values[id], r = ranges[id];
  let v: ControlValue;
  if (typeof current === 'object') {
    const p = value as { x?: unknown; y?: unknown };
    if (!p || typeof p !== 'object' || typeof p.x !== 'number' || typeof p.y !== 'number') throw new Error(`set('${id}', {x, y}): an XY pad takes x and y from 0 to 1.`);
    v = { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) };
    norms[id] = v.x;
  } else if (typeof current === 'boolean') {
    v = typeof value === 'boolean' ? value : Number(value) >= 0.5;
    norms[id] = v ? 1 : 0;
  } else {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`set('${id}', value): a number.`);
    v = r ? Math.min(r.max, Math.max(r.min, value)) : value;
    norms[id] = r ? toUnit(v, r) : 0;
  }
  values[id] = v;
  const n = ++writes;
  pending.set(id, { value: v, write: n });
  let key = gesture;
  if (!key) {
    // Moves outside begin()/end() that follow each other closely are one step.
    loose ??= { key: `loose-${++gestures}-${Date.now()}` };
    if (loose.timer) clearTimeout(loose.timer);
    const k = loose.key;
    loose.timer = setTimeout(() => { if (loose?.key === k) { post({ type: 'end', gesture: k }); loose = null; } }, 400);
    key = k;
  }
  post({ type: 'set', id, value: v, write: n, gesture: key });
}

// ---- the part ------------------------------------------------------------------------------------
export function boot(modules: Modules) {
  const root = document.getElementById('root')!;
  const file = modules[`./parts/${partName}.ts`] ?? modules[`./parts/${partName}.tsx`];
  const names = Object.keys(modules).map(k => k.replace(/^\.\/parts\/|\.tsx?$/g, ''));
  if (!file) { post({ type: 'missing', part: partName, parts: names }); root.textContent = `No part "${partName}" (src/parts/${partName}.ts).`; return; }

  let def: Part | null = null;
  let props: Record<string, unknown> = {};
  let look: Record<string, string> = {};
  let size = { width: 100, height: 100 };
  let mode: 'play' | 'edit' = 'play';
  const audio: Audio = { level: 0, peak: 0, wave: new Float32Array(256), spectrum: new Float32Array(64) };
  const listeners = { props: new Set<(p: never) => void>(), look: new Set<(l: Record<string, string>) => void>(), size: new Set<(s: { width: number; height: number }) => void>(), mode: new Set<(m: 'play' | 'edit') => void>(), frame: new Set<(dt: number, t: number) => void>() };
  const watchers = new Map<string, Set<(v: ControlValue) => void>>();
  const notify = (id: string, before: ControlValue | undefined, value: ControlValue) => {
    if (JSON.stringify(before) === JSON.stringify(value)) return;
    for (const listener of watchers.get(id) ?? []) {
      try { listener(value); } catch (error) { post({ type: 'error', message: `on('${id}'): ${text(error)}` }); }
    }
  };
  const move = (id: ControlId, value: ControlValue) => {
    const before = values[id];
    write(id, value);
    // write() updates our local cache, so the host's later acknowledgment is not a new change.
    notify(id, before, values[id]);
  };
  const assets = new Map<string, Promise<string | null>>();
  const assetWaits = new Map<number, (url: string | null) => void>();
  let assetReqs = 0, lastT = 0, mounted = false, unmount: void | (() => void);

  const withDefaults = (spec: PropSpecs | undefined, given: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [k, s] of Object.entries(spec ?? {})) {
      const g = given[k];
      out[k] = s.type === 'number' ? (typeof g === 'number' ? g : s.default) : s.type === 'boolean' ? (typeof g === 'boolean' ? g : s.default) : (typeof g === 'string' ? g : s.default);
    }
    return out;
  };
  const applyLook = (l: Record<string, string>) => { for (const [k, v] of Object.entries(l)) document.documentElement.style.setProperty(`--dk-${k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`, v); };

  const kit: Kit = {
    get props() { return props as PropValues<PropSpecs>; },
    onProps: l => { listeners.props.add(l as never); return () => listeners.props.delete(l as never); },
    value: <T extends ControlValue>(id: ControlId) => { known(id); return values[id] as T; },
    norm: (id: ControlId) => { known(id); return norms[id] ?? 0; },
    on: (id: ControlId, l) => { let set = watchers.get(id); if (!set) { set = new Set(); watchers.set(id, set); } set.add(l); return () => set!.delete(l); },
    set: move,
    setNorm: (id: ControlId, n: number) => { known(id); const r = ranges[id]; const cur = values[id]; move(id, typeof cur === 'number' && r ? fromUnit(n, r) : typeof cur === 'boolean' ? n >= 0.5 : { x: n, y: (cur as { y: number }).y }); },
    begin: () => { if (gesture) post({ type: 'end', gesture }); gesture = `drag-${++gestures}-${Date.now()}`; },
    end: () => { if (gesture) post({ type: 'end', gesture }); gesture = null; },
    audio,
    frame: l => { listeners.frame.add(l); return () => listeners.frame.delete(l); },
    get look() { return look; },
    onLook: l => { listeners.look.add(l); return () => listeners.look.delete(l); },
    get size() { return size; },
    onResize: l => { listeners.size.add(l); return () => listeners.size.delete(l); },
    get mode() { return mode; },
    onMode: l => { listeners.mode.add(l); return () => listeners.mode.delete(l); },
    asset: (id: string) => {
      let p = assets.get(id);
      if (!p) { const req = ++assetReqs; p = new Promise(resolve => { assetWaits.set(req, resolve); post({ type: 'asset', req, id }); }); assets.set(id, p); }
      return p;
    },
  };

  function mount() {
    if (mounted || !def) return;
    mounted = true;
    try { unmount = def.mount(root, kit as Kit<never>); post({ type: 'ready' }); }
    catch (error) { post({ type: 'error', message: `mount: ${text(error)}`, stack: error instanceof Error ? error.stack : undefined }); }
  }

  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window.parent || (host !== '*' && e.origin !== host)) return;
    const m = e.data as { denkit?: number; type?: string } & Record<string, unknown>;
    if (!m || m.denkit !== 1) return;
    switch (m.type) {
      case 'init': {
        props = withDefaults(def?.props, (m.props ?? {}) as Record<string, unknown>);
        look = (m.look ?? {}) as Record<string, string>; applyLook(look);
        size = (m.size ?? size) as typeof size;
        mode = m.mode === 'edit' ? 'edit' : 'play';
        Object.assign(ranges, (m.ranges ?? {}) as Record<string, Range>);
        Object.assign(values, (m.values ?? {}) as Record<string, ControlValue>);
        Object.assign(norms, (m.norms ?? {}) as Record<string, number>);
        mount();
        return;
      }
      case 'props': props = withDefaults(def?.props, (m.props ?? {}) as Record<string, unknown>); for (const l of listeners.props) l(props as never); return;
      case 'look': look = (m.look ?? {}) as Record<string, string>; applyLook(look); for (const l of listeners.look) l(look); return;
      case 'size': size = m.size as typeof size; for (const l of listeners.size) l(size); return;
      case 'mode': mode = m.mode === 'edit' ? 'edit' : 'play'; for (const l of listeners.mode) l(mode); return;
      case 'controls': Object.assign(ranges, (m.ranges ?? {}) as Record<string, Range>); return;
      case 'frame': {
        const f = m as unknown as FrameMsg;
        audio.level = f.level; audio.peak = f.peak;
        if (f.wave?.length === audio.wave.length) audio.wave.set(f.wave);
        if (f.spectrum?.length === audio.spectrum.length) audio.spectrum.set(f.spectrum);
        for (const [id, p] of pending) if (p.write <= f.acked || f.values[id] === undefined) pending.delete(id);
        for (const [id, v] of Object.entries(f.values)) {
          if (pending.has(id)) continue;
          const before = values[id];
          values[id] = v; norms[id] = f.norms[id] ?? 0;
          notify(id, before, v);
        }
        const dt = lastT ? Math.min(0.1, Math.max(0, f.t - lastT)) : 1 / 60;
        lastT = f.t;
        for (const l of listeners.frame) { try { l(dt, f.t); } catch (error) { post({ type: 'error', message: `frame: ${text(error)}`, stack: error instanceof Error ? error.stack : undefined }); listeners.frame.delete(l); } }
        return;
      }
      case 'picture': {
        const seq = m.seq;
        picture(root, size).then(png => post({ type: 'picture', seq, png }), error => post({ type: 'picture', seq, png: null, error: text(error) }));
        return;
      }
      case 'asset': {
        const done = assetWaits.get(Number(m.req)); if (!done) return;
        assetWaits.delete(Number(m.req));
        done(m.bytes instanceof ArrayBuffer ? URL.createObjectURL(new Blob([m.bytes], { type: String(m.mime ?? '') })) : null);
        return;
      }
    }
  });

  file().then(mod => {
    const d = (mod as { default?: Part }).default;
    if (!d || typeof d.mount !== 'function') { post({ type: 'error', message: `src/parts/${partName}.ts must \`export default part({ mount(root, kit) { … } })\`.` }); return; }
    def = d;
    post({ type: 'hello', part: partName, props: d.props ?? {}, interactive: d.interactive !== false });
  }, error => post({ type: 'error', message: `Loading src/parts/${partName}.ts: ${text(error)}`, stack: error instanceof Error ? error.stack : undefined }));

  window.addEventListener('pagehide', () => { try { if (typeof unmount === 'function') unmount(); } catch { /* leaving anyway */ } });
}
