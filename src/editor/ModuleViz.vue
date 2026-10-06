<script setup lang="ts">
// Small live drawings on the module face (Grid modules show their shape): ADSR
// graph with handles, oscillator/LFO waveforms, filter response, drive curve,
// delay taps, compressor curve. They follow the current knob values.
import { computed } from 'vue';
import type { PatchNode } from '../core/schema.ts';

const props = withDefaults(defineProps<{ node: PatchNode; color: string; width?: number; height?: number }>(), { width: 76, height: 40 });
const W = computed(() => props.width), H = computed(() => props.height);
const v = (k: string, d = 0) => { const x = props.node.values[k]; return typeof x === 'number' ? x : typeof x === 'boolean' ? Number(x) : d; };
const pts = (list: Array<[number, number]>) => list.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
const sample = (f: (t: number) => number, n = 64, pad = 3) => pts(Array.from({ length: n + 1 }, (_, i) => { const t = i / n; return [pad + t * (W.value - 2 * pad), H.value / 2 - f(t) * (H.value / 2 - pad)]; }));

const shape = computed<{ path: string; dashed?: string; dots?: Array<[number, number]>; fill?: string } | null>(() => {
  const n = props.node, w = W.value, h = H.value, pad = 3;
  switch (n.type) {
    case 'den.envelope': case 'den.curvedAdsr': {
      const a = v('attack', 0.01), d = v('decay', 0.2), s = Math.min(1, Math.max(0, v('sustain', 0.7))), r = v('release', 0.3);
      const hold = Math.max(0.15, (a + d + r) * 0.35), total = a + d + hold + r || 1;
      const X = (t: number) => pad + t / total * (w - 2 * pad), Y = (l: number) => h - pad - l * (h - 2 * pad);
      const p0: [number, number] = [X(0), Y(0)], p1: [number, number] = [X(a), Y(1)], p2: [number, number] = [X(a + d), Y(s)], p3: [number, number] = [X(a + d + hold), Y(s)], p4: [number, number] = [X(total), Y(0)];
      return { path: pts([p0, p1, p2]) + ' ' + pts([p3, p4]).replace(/^M/, 'M'), dashed: pts([p2, p3]), dots: [p1, p2, p3, p4] };
    }
    case 'den.oscillator': return { path: n.config.waveform === 'sine' ? sample(t => Math.sin(t * Math.PI * 2)) : pts([[pad, h - pad], [w / 2, pad], [w / 2, h - pad], [w - pad, pad]]) };
    case 'den.virtualAnalogSource': {
      if (n.config.waveform === 'triangle') return { path: sample(t => 1 - 4 * Math.abs(((t + 0.25) % 1) - 0.5)) };
      const duty = Math.min(0.95, Math.max(0.05, v('duty', 0.5))), x = (t: number) => pad + t * (w - 2 * pad);
      return { path: pts([[x(0), h - pad], [x(0), pad], [x(duty / 2), pad], [x(duty / 2), h - pad], [x(0.5), h - pad], [x(0.5), pad], [x(0.5 + duty / 2), pad], [x(0.5 + duty / 2), h - pad], [x(1), h - pad]]) };
    }
    case 'den.frequencyModulation': { const k = Math.min(6, v('deviationHz', 0) / Math.max(1, v('modulatorHz', 440)) * 3); return { path: sample(t => Math.sin(t * Math.PI * 4 + k * Math.sin(t * Math.PI * 8)), 96) }; }
    case 'den.seededNoise': { let seed = 7; return { path: sample(() => { seed = (seed * 48271) % 2147483647; return seed / 1073741823 - 1; }, 40) }; }
    case 'den.lfo': return { path: sample(t => Math.sin(t * Math.PI * 2)) };
    case 'den.musicalLfo': {
      const wf = n.config.waveform;
      return { path: sample(t => wf === 'saw' ? 2 * t - 1 : wf === 'square' ? (t < 0.5 ? 1 : -1) : wf === 'triangle' ? 1 - 4 * Math.abs(((t + 0.25) % 1) - 0.5) : Math.sin(t * Math.PI * 2), 96) };
    }
    case 'den.randomModulator': case 'den.sampleAndHold': { const steps = [0.2, -0.6, 0.7, -0.1, 0.5, -0.8]; return { path: pts(steps.flatMap((s, i) => [[pad + i / steps.length * (w - 2 * pad), h / 2 - s * (h / 2 - pad)], [pad + (i + 1) / steps.length * (w - 2 * pad), h / 2 - s * (h / 2 - pad)]] as Array<[number, number]>)) }; }
    case 'den.filter': case 'den.stateVariableFilter': case 'den.characterFilter': case 'kit.cutoffMod': {
      const fc = n.type === 'den.characterFilter' ? v('poleHz', 1000) : n.type === 'den.stateVariableFilter' ? v('cutoffHz', 1000) : n.type === 'kit.cutoffMod' ? v('hz', 1000) : v('cutoff', 1200);
      const q = n.type === 'den.characterFilter' ? 0.5 + v('resonance', 0.2) * 8 : n.type === 'den.stateVariableFilter' ? v('q', 0.707) : n.type === 'kit.cutoffMod' ? 0.707 : v('resonance', 0.707);
      const poles = n.type === 'den.characterFilter' ? 4 : 2;
      const resp = (t: number) => { const f = 20 * 1000 ** t, x = f / Math.max(20, fc); const mag = 1 / Math.sqrt((1 - x * x) ** 2 + (x / q) ** 2); const db = 20 * Math.log10(mag) * (poles / 2); return Math.max(-1, Math.min(1, db / 24)); };
      const path = pts(Array.from({ length: 65 }, (_, i) => { const t = i / 64; return [pad + t * (w - 2 * pad), h * 0.45 - resp(t) * h * 0.45] as [number, number]; }));
      return { path, fill: `${path} L${w - pad} ${h - pad} L${pad} ${h - pad} Z` };
    }
    case 'den.biquadEq': {
      const fc = v('cutoffHz', 1000), g = v('gainDb', 0) / 24, mode = n.config.mode;
      return { path: sample(t => { const x = Math.log(20 * 1000 ** t / fc); return mode === 'lowShelf' ? g / (1 + Math.exp(3 * x)) : mode === 'highShelf' ? g / (1 + Math.exp(-3 * x)) : g * Math.exp(-x * x * v('q', 0.707)); }) };
    }
    case 'den.drive': case 'kit.tanh': {
      const k = n.type === 'kit.tanh' ? v('drive', 1) : v('gain', 2), curve = n.config.curve ?? 'soft';
      const f = (x: number) => { const y = x * k; return curve === 'hard' ? Math.max(-1, Math.min(1, y)) : curve === 'fold' ? Math.sin(y * Math.PI / 2) : curve === 'asymmetric' ? (y > 0 ? Math.tanh(y) : Math.tanh(y * 0.5)) : Math.tanh(y); };
      return { path: pts(Array.from({ length: 49 }, (_, i) => { const x = i / 24 - 1; return [w / 2 + x * (w / 2 - pad) * 0.7, h / 2 - f(x) * (h / 2 - pad)] as [number, number]; })), dashed: pts([[pad, h / 2], [w - pad, h / 2]]) };
    }
    case 'den.delayFx': case 'den.pingPongDelay': {
      const fb = Math.min(0.95, Math.abs(v('feedback', 0.4))), bars: string[] = [];
      for (let k = 0; k < 6; k++) { const level = k === 0 ? 1 : fb ** k, x = pad + 4 + k * (w - 2 * pad - 8) / 5; bars.push(`M${x} ${h - pad} L${x} ${h - pad - level * (h - 2 * pad)}`); }
      return { path: bars.join(' ') };
    }
    case 'den.algorithmicReverb': { let seed = 3; const decay = Number(n.config.decaySeconds ?? 1.5); return { path: sample(t => { seed = (seed * 48271) % 2147483647; return (seed / 1073741823 - 1) * Math.exp(-t * 6 / decay); }, 90) }; }
    case 'den.flanger': case 'den.phaser': return { path: sample(t => Math.sin(t * Math.PI * 2 * 1.5) * 0.4 + Math.sin(t * Math.PI * 14) * 0.35, 96) };
    case 'den.dynamics': {
      const th = v('thresholdDb', -18), ratio = Math.max(1, v('ratio', 4)), X = (db: number) => pad + (db + 60) / 60 * (w - 2 * pad), Y = (db: number) => h - pad - (db + 60) / 60 * (h - 2 * pad);
      return { path: pts([[X(-60), Y(-60)], [X(th), Y(th)], [X(0), Y(th + (0 - th) / ratio)]]), dashed: pts([[X(-60), Y(-60)], [X(0), Y(0)]]) };
    }
    case 'kit.tremolo': return { path: sample(t => Math.sin(t * Math.PI * 12) * (1 - v('depth', 0) * (0.5 - 0.5 * Math.sin(t * Math.PI * 2))), 120) };
    case 'kit.voiceMix': return { path: `M${w / 2 - 9} ${pad + 4} L${w / 2 + 9} ${pad + 4} L${w / 2 - 3} ${h / 2} L${w / 2 + 9} ${h - pad - 4} L${w / 2 - 9} ${h - pad - 4} Z` };
    case 'kit.out': case 'kit.audioIn': return { path: sample(t => Math.sin(t * Math.PI * 9) * Math.exp(-t * 3) * (t < 0.04 ? t * 25 : 1), 90) };
    default: return null;
  }
});
</script>

<template>
  <svg v-if="shape" class="module-viz" :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`">
    <line v-for="k in 3" :key="k" :x1="2" :x2="W - 2" :y1="(H / 4) * k" :y2="(H / 4) * k" class="grid" />
    <path v-if="shape.fill" :d="shape.fill" :fill="color" opacity="0.18" />
    <path v-if="shape.dashed" :d="shape.dashed" :stroke="color" stroke-width="1.5" fill="none" stroke-dasharray="4 3" />
    <path :d="shape.path" :stroke="color" stroke-width="1.8" fill="none" stroke-linejoin="round" />
    <circle v-for="(d, k) in shape.dots ?? []" :key="k" :cx="d[0]" :cy="d[1]" r="3" :fill="k === (shape.dots?.length ?? 0) - 1 ? '#fff' : color" />
  </svg>
</template>

<style scoped>
.module-viz { display: block; overflow: visible; }
.grid { stroke: #ffffff10; stroke-width: 1; }
</style>
