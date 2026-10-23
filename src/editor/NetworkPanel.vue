<script setup lang="ts">
// What the open work's code parts may use on this computer: the origins they may
// connect to and the devices they may use. The work lists the origins it needs,
// each with a reason (the AI can add to the list); the person allows them here.
// What is allowed is kept by the host for this work only, never in the work.
import { computed, ref } from 'vue';
import { useSession } from './context.ts';
import { DEVICES } from './code-parts.ts';
import { networkOrigin } from '../work/ui.ts';
import type { Device } from '../host/index.ts';

const session = useSession();
const parts = session.codeParts;
const allowed = computed(() => parts?.allowed.value ?? { origins: [], devices: [] });
const needs = computed(() => session.doc.value.ui.network ?? []);
/** Allowed by hand, not in the work's list. */
const extra = computed(() =>
  allowed.value.origins.filter(o => !needs.value.some(n => n.origin === o)),
);
/** What the code parts tried to reach and were refused, by origin (https and wss only can be allowed). */
const refused = computed(() => {
  const seen = new Map<string, string>();
  for (const r of parts?.refused.value ?? []) {
    let origin: string | null = null;
    try {
      origin = networkOrigin(new URL(r.blocked).origin);
    } catch {
      origin = null;
    }
    if (origin && !allowed.value.origins.includes(origin)) seen.set(origin, r.directive);
  }
  return [...seen].map(([origin, directive]) => ({ origin, directive }));
});
const typed = ref('');
const problem = ref('');
const DEVICE_LABEL: Record<Device, string> = {
  microphone: 'Microphone',
  camera: 'Camera',
  midi: 'MIDI',
};

function allow(origin: string, on: boolean) {
  parts?.set({ origin, on });
}
function add() {
  const origin = networkOrigin(typed.value);
  if (!origin) {
    problem.value = 'An origin is https://host (or wss://host), with a port if it needs one.';
    return;
  }
  problem.value = '';
  typed.value = '';
  allow(origin, true);
}
</script>

<template>
  <details v-if="parts" class="network" data-testid="network-panel">
    <summary>Network and devices for code parts</summary>
    <div class="body">
      <p class="muted small">
        Code parts reach only their own address and what you allow here, for this work on this
        computer.
      </p>
      <ul v-if="needs.length" class="list">
        <li v-for="n in needs" :key="n.origin" :data-origin="n.origin">
          <label
            ><input
              type="checkbox"
              :checked="allowed.origins.includes(n.origin)"
              @change="allow(n.origin, ($event.target as HTMLInputElement).checked)"
            />
            <code>{{ n.origin }}</code></label
          >
          <span class="muted small">{{ n.reason }}</span>
        </li>
      </ul>
      <ul v-if="extra.length" class="list">
        <li v-for="o in extra" :key="o" :data-origin="o">
          <code>{{ o }}</code>
          <button class="small" @click="allow(o, false)">Remove</button>
        </li>
      </ul>
      <div v-if="refused.length" class="refused" data-testid="network-refused">
        <span class="muted small">Refused just now:</span>
        <span v-for="r in refused" :key="r.origin" class="item">
          <code>{{ r.origin }}</code>
          <button class="small" @click="allow(r.origin, true)">Allow</button>
        </span>
      </div>
      <div class="add">
        <input
          v-model="typed"
          type="text"
          placeholder="https://api.example.com"
          spellcheck="false"
          data-testid="network-origin"
          @keydown.stop
          @keydown.enter="add"
        /><button class="small" data-testid="network-allow" @click="add">Allow</button>
        <span v-if="problem" class="small problem">{{ problem }}</span>
      </div>
      <div class="devices">
        <label v-for="d in DEVICES" :key="d"
          ><input
            type="checkbox"
            :checked="allowed.devices.includes(d)"
            :data-device="d"
            @change="parts?.set({ device: d, on: ($event.target as HTMLInputElement).checked })"
          />
          {{ DEVICE_LABEL[d] }}</label
        >
      </div>
    </div>
  </details>
</template>

<style scoped>
.network {
  border-top: 1px solid var(--line, #2a2f36);
  padding: 6px 12px;
}
.network summary {
  cursor: pointer;
  font-size: 13px;
}
.body {
  display: grid;
  gap: 8px;
  padding: 6px 0;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}
.list li {
  display: flex;
  gap: 8px;
  align-items: baseline;
  flex-wrap: wrap;
}
.refused,
.add,
.devices {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.add input {
  min-width: 260px;
}
.problem {
  color: #e57373;
}
</style>
