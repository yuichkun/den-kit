<script setup lang="ts">
// A code part: a part of the work's screen project (src/parts/<name>.ts), shown
// in its own frame from the pod's dev server (src/workspace). den-kit and the part's
// page talk by postMessage only (pod-template/src/kit/runtime.ts is the other
// side): den-kit sends the part its settings, the look, its size and whether the
// plugin plays, and every frame the sound and the controls' values; the part
// sends back the controls it moves (one drag, or one burst of moves, is one ⌘Z
// step, as with a canvas), its errors and console lines (the AI reads them), and
// a picture of itself when den-kit looks at the plugin. A broken part shows its
// error in its box; the rest of the plugin keeps playing. The frame runs scripts
// on its own origin and nothing more (no popups, forms or leaving the frame), and
// may use only the devices the person allowed for this work. Messages count only
// from that frame's window and origin.
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { COLOR_TOKENS, FONT_TOKENS, tokenVar, type CodeElement } from '../work/ui.ts';
import { toUnit } from './format.ts';
import { TAP } from './meters.ts';
import { CODE_FRAMES, POD } from './code-frames.ts';
import type { AssetUrl } from './css.ts';
import type { WidgetSpec } from './spec.ts';

const props = defineProps<{
  element: CodeElement;
  controls: Record<string, WidgetSpec>;
  url: AssetUrl;
  /** The plugin plays: the part may take the mouse. */ play?: boolean;
  /** A look at the plugin (start screen, the AI's look): shown only if the pod is up already. */ preview?: boolean;
  /** The devices the person allowed this work's code parts (permission policy names: microphone, midi, …). */
  devices?: readonly string[];
}>();
/** The frame's permission policy: the allowed devices for its own origin, nothing else. */
const allow = computed(() =>
  (props.devices ?? pod?.devices?.value ?? []).map(d => `${d} 'src'`).join('; '),
);
const emit = defineEmits<{
  (e: 'set', id: string, values: Record<string, number | boolean>, gesture: string): void;
}>();
const pod = inject(POD, null);
const tap = inject(TAP, null);
const box = ref<HTMLElement | null>(null);
const frame = ref<HTMLIFrameElement | null>(null);
type State = 'off' | 'waiting' | 'loading' | 'ready' | 'missing' | 'error';
const state = ref<State>(pod?.available ? 'waiting' : 'off');
const error = ref<string | null>(null);
const interactive = ref(true);
/** Bumped to load the page again. */
const generation = ref(0);
let hello = 0,
  changedAt = 0,
  reloadTimer: ReturnType<typeof setTimeout> | null = null;
let raf = 0,
  lookAt = 0,
  look: Record<string, string> = {},
  acked = 0,
  pictures = 0;
const waits = new Map<number, (png: string | null) => void>();

const portal = computed(() => pod?.portal.value ?? null);
const origin = computed(() => {
  try {
    return portal.value ? new URL(portal.value).origin : null;
  } catch {
    return null;
  }
});
const src = computed(() => {
  if (!portal.value) return null;
  const u = new URL(portal.value);
  u.searchParams.set('part', props.element.part);
  u.searchParams.set('el', props.element.id);
  u.searchParams.set('host', location.origin);
  if (generation.value) u.searchParams.set('r', String(generation.value));
  return u.href;
});
const message = computed(() => {
  if (state.value === 'off')
    return `Code part "${props.element.part}": no pod (${pod?.message.value ?? 'not available'}).`;
  if (state.value === 'waiting')
    return `Code part "${props.element.part}": ${pod?.message.value || 'waiting for the pod…'}`;
  if (state.value === 'loading') return '';
  return error.value ?? '';
});

function post(message: Record<string, unknown>, transfer: Transferable[] = []) {
  const w = frame.value?.contentWindow;
  // Until the part's page says hello, the frame may still hold a blank page of another origin: nothing to send it yet.
  if (w && origin.value && hello) w.postMessage({ denkit: 1, ...message }, origin.value, transfer);
}
/** The controls as they are now (values, positions 0..1, ranges). */
function controls() {
  const values: Record<string, number | boolean | { x: number; y: number }> = {},
    norms: Record<string, number> = {},
    ranges: Record<string, { min: number; max: number; log: boolean; unit: string }> = {};
  for (const c of Object.values(props.controls)) {
    if (c.type === 'ui.xy') {
      values[c.id] = { x: Number(c.values.x ?? 0.5), y: Number(c.values.y ?? 0.5) };
      norms[c.id] = Number(c.values.x ?? 0.5);
      ranges[c.id] = { min: 0, max: 1, log: false, unit: '' };
      continue;
    }
    const v = c.values.value;
    if (v === undefined) continue;
    values[c.id] = v;
    const min = Number(c.config.min ?? 0),
      max = Number(c.config.max ?? 1),
      log = c.config.scale === 'log';
    ranges[c.id] = { min, max, log, unit: String(c.config.unit ?? '') };
    norms[c.id] = typeof v === 'boolean' ? (v ? 1 : 0) : toUnit(v, min, max, log);
  }
  return { values, norms, ranges };
}
function readLook(): Record<string, string> {
  if (!box.value) return look;
  const cs = getComputedStyle(box.value);
  return Object.fromEntries(
    [...COLOR_TOKENS, ...FONT_TOKENS].map(t => [t, cs.getPropertyValue(tokenVar(t)).trim()]),
  );
}
const size = () => ({ width: props.element.rect.w, height: props.element.rect.h });
const mode = () => (props.play ? 'play' : 'edit');
function report(patch: Parameters<NonNullable<typeof pod>['report']>[1]) {
  if (!props.preview) pod?.report(props.element.id, { part: props.element.part, ...patch });
}

function onMessage(e: MessageEvent) {
  if (!frame.value || e.source !== frame.value.contentWindow || e.origin !== origin.value) return;
  const m = e.data as Record<string, unknown> & { denkit?: number; type?: string };
  if (!m || m.denkit !== 1) return;
  switch (m.type) {
    case 'hello': {
      hello = Date.now();
      acked = 0;
      interactive.value = m.interactive !== false;
      state.value = 'loading';
      error.value = null;
      report({
        state: 'loading',
        props: (m.props ?? {}) as Record<string, unknown>,
        interactive: interactive.value,
        error: undefined,
        at: hello,
      });
      look = readLook();
      post({
        type: 'init',
        props: props.element.props,
        look,
        size: size(),
        mode: mode(),
        ...controls(),
      });
      return;
    }
    case 'ready':
      state.value = 'ready';
      error.value = null;
      report({ state: 'ready', error: undefined });
      return;
    case 'missing': {
      const parts = Array.isArray(m.parts) ? (m.parts as string[]) : [];
      state.value = 'missing';
      error.value = `No part "${props.element.part}" (src/parts/${props.element.part}.ts).${parts.length ? ` Parts: ${parts.join(', ')}.` : ''}`;
      report({ state: 'missing', error: error.value });
      return;
    }
    case 'error': {
      const where =
        typeof m.stack === 'string'
          ? m.stack
              .split('\n')
              .find(l => /src\/|:\d+:\d+/.test(l))
              ?.trim()
          : undefined;
      error.value =
        `${String(m.message ?? 'Error')}${where ? `\n  at ${where.replace(/^at\s+/, '')}` : ''}`.slice(
          0,
          1500,
        );
      state.value = 'error';
      report({ state: 'error', error: error.value, log: `error: ${error.value}` });
      return;
    }
    case 'log':
      report({ log: `${String(m.level ?? 'log')}: ${String(m.text ?? '')}`.slice(0, 2000) });
      return;
    case 'set': {
      const write = Number(m.write) || 0;
      acked = Math.max(acked, write);
      const id = String(m.id ?? '');
      if (!props.play || !props.controls[id]) return;
      const v = m.value as number | boolean | { x: number; y: number };
      const values: Record<string, number | boolean> =
        typeof v === 'object' && v
          ? { x: Number(v.x), y: Number(v.y) }
          : { value: v as number | boolean };
      emit('set', id, values, `code-${props.element.id}-${String(m.gesture ?? 'move')}`);
      return;
    }
    case 'picture': {
      const done = waits.get(Number(m.seq));
      if (done) {
        waits.delete(Number(m.seq));
        done(typeof m.png === 'string' ? m.png : null);
      }
      return;
    }
    case 'key': {
      // A key pressed while the part has the focus, which it did not use: den-kit's shortcuts and keyboard get it.
      if (props.preview) return;
      const init: KeyboardEventInit = {
        key: String(m.key ?? ''),
        code: String(m.code ?? ''),
        metaKey: !!m.meta,
        ctrlKey: !!m.ctrl,
        shiftKey: !!m.shift,
        altKey: !!m.alt,
        repeat: !!m.repeat,
        bubbles: true,
        cancelable: true,
      };
      (box.value ?? window).dispatchEvent(
        new KeyboardEvent(m.kind === 'keyup' ? 'keyup' : 'keydown', init),
      );
      return;
    }
    case 'asset': {
      const req = m.req,
        id = String(m.id ?? '');
      // Served from the part's own origin, so ordinary loaders work with it; otherwise its bytes.
      const own = pod?.fileUrl?.(id);
      if (own) {
        post({ type: 'asset', req, url: own });
        return;
      }
      const url = props.url(id);
      if (!url) {
        post({ type: 'asset', req, bytes: null });
        return;
      }
      void fetch(url)
        .then(async r => {
          const bytes = await r.arrayBuffer();
          post({ type: 'asset', req, bytes, mime: r.headers.get('content-type') ?? '' }, [bytes]);
        })
        .catch(() => post({ type: 'asset', req, bytes: null }));
      return;
    }
  }
}

/** A picture of the part (a PNG data: URL), or null when it cannot give one in time. */
function picture(): Promise<string | null> {
  if (state.value !== 'ready') return Promise.resolve(null);
  const seq = ++pictures;
  return new Promise(resolve => {
    waits.set(seq, resolve);
    post({ type: 'picture', seq });
    setTimeout(() => {
      if (waits.delete(seq)) resolve(null);
    }, 4000);
  });
}

function tick(t: number) {
  raf = requestAnimationFrame(tick);
  if (state.value !== 'ready' && state.value !== 'loading') return;
  if (t - lookAt > 500) {
    lookAt = t;
    const next = readLook();
    if (JSON.stringify(next) !== JSON.stringify(look)) {
      look = next;
      post({ type: 'look', look });
    }
  }
  const wave = new Float32Array(256),
    spectrum = new Float32Array(64);
  const m = tap?.read(wave, spectrum) ?? { level: 0, peak: 0 };
  const c = controls();
  post(
    {
      type: 'frame',
      t: t / 1000,
      level: m.level,
      peak: m.peak,
      wave,
      spectrum,
      values: c.values,
      norms: c.norms,
      acked,
    },
    [wave.buffer, spectrum.buffer],
  );
}

function load() {
  const f = frame.value,
    s = src.value;
  if (!f || !s) return;
  hello = 0;
  state.value = 'loading';
  error.value = null;
  report({ state: 'loading', error: undefined });
  if (f.src !== s) f.src = s;
}

onMounted(() => {
  // A frame from another origin inside this cross-origin-isolated page: loaded without credentials (no COEP needed from it).
  frame.value?.setAttribute('credentialless', '');
  window.addEventListener('message', onMessage);
  if (frame.value) CODE_FRAMES.set(frame.value, picture);
  raf = requestAnimationFrame(tick);
  if (src.value) load();
  else if (pod?.available && !props.preview) pod.ensure().catch(() => undefined);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  window.removeEventListener('message', onMessage);
  if (reloadTimer) clearTimeout(reloadTimer);
  for (const done of waits.values()) done(null);
  waits.clear();
});
watch(src, () => load());
watch(
  () => pod?.state.value,
  s => {
    if (!portal.value && state.value !== 'off')
      state.value = s === 'unavailable' ? 'off' : 'waiting';
  },
);
watch(
  () => JSON.stringify(props.element.props),
  () => post({ type: 'props', props: props.element.props }),
);
watch(
  () => [props.element.rect.w, props.element.rect.h],
  () => post({ type: 'size', size: size() }),
);
watch(
  () => props.play,
  () => post({ type: 'mode', mode: mode() }),
);
watch(
  () => JSON.stringify(controls().ranges),
  () => post({ type: 'controls', ranges: controls().ranges }),
);
// The project changed: the dev server reloads the page itself when its live reload works; if it did not, den-kit does.
watch(
  () => pod?.reloads.value,
  () => {
    changedAt = Date.now();
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      if (hello < changedAt && src.value) {
        generation.value++;
      }
    }, 2500);
  },
);
defineExpose({ state, error });
</script>

<template>
  <div
    ref="box"
    class="code-box"
    :class="{ live: play && interactive && state === 'ready' }"
    data-code-part
    :data-code-state="state"
    :data-code-error="state === 'error' || state === 'missing' ? (error ?? undefined) : undefined"
  >
    <iframe
      ref="frame"
      class="page"
      title="code part"
      sandbox="allow-scripts allow-same-origin"
      :allow="allow"
      :class="{ shown: state === 'ready' || state === 'loading' }"
    />
    <div v-if="message" class="status" :class="state" data-testid="code-status">{{ message }}</div>
  </div>
</template>

<style scoped>
.code-box {
  position: absolute;
  inset: 0;
}
.page {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
  color-scheme: normal;
  pointer-events: none;
  visibility: hidden;
}
.page.shown {
  visibility: visible;
}
/* Only a part that takes the mouse catches it, and only while the plugin plays; otherwise the controls under it play. */
.code-box.live,
.code-box.live .page {
  pointer-events: auto;
}
.status {
  position: absolute;
  left: 4px;
  right: 4px;
  bottom: 4px;
  padding: 3px 6px;
  border-radius: 4px;
  background: #222c;
  color: #ddd;
  font:
    11px/1.3 ui-monospace,
    Menlo,
    monospace;
  white-space: pre-wrap;
  max-height: 70%;
  overflow: hidden;
}
.status.error,
.status.missing {
  background: #300c;
  color: #ffb3b3;
}
</style>
