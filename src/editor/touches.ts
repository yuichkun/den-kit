// Who is working where (U8): when an LLM request has members, what an AI just
// changed is outlined in its colour with its name for a moment, in the patch
// and on the plugin, so the person sees the team at work.
import { computed, onBeforeUnmount, ref, watch, type ComputedRef } from 'vue';
import { TOUCH_MS } from '../ai/llm.ts';
import type { KitSession } from './session.ts';

export interface TouchMark { color: string; name: string }

/** Ids changed by an AI in the last moment, with the AI's colour and name. */
export function useTouches(session: KitSession): ComputedRef<Map<string, TouchMark>> {
  const now = ref(performance.now());
  let timer: ReturnType<typeof setInterval> | null = null;
  const list = computed(() => session.llm?.touches.value ?? []);
  const fresh = computed(() => {
    const map = new Map<string, TouchMark>();
    for (const t of list.value) if (now.value - t.at < TOUCH_MS) for (const id of t.ids) map.set(id, { color: t.color, name: t.name });
    return map;
  });
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
  watch(list, touches => {
    now.value = performance.now();
    if (!touches.length || timer) return;
    timer = setInterval(() => { now.value = performance.now(); if (!fresh.value.size) stop(); }, 200);
  });
  onBeforeUnmount(stop);
  return fresh;
}
