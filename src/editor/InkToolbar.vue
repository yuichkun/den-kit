<script setup lang="ts">
// The sketch's tools (U8c), over the view while drawing: pen, marker, box,
// arrow, sticky note, text, eraser; four colours; undo the last mark, rub all
// out, keep marks after the AI is done; on the plugin, lay the sketch under it.
// Esc (or Done) puts the pen down; the marks stay for the next request.
import { computed } from 'vue';
import { useSession } from './context.ts';
import { MARK_COLORS, COLOR_NAMES, type SketchView } from '../ai/sketch.ts';
import type { InkTool } from './session.ts';

const props = defineProps<{ view: SketchView }>();
const emit = defineEmits<{ (e: 'underlay'): void }>();
const session = useSession();
const TOOLS: Array<{ tool: InkTool; icon: string; title: string }> = [
  { tool: 'pen', icon: '✎', title: 'Pen: draw, or circle things (loops go around them)' },
  { tool: 'marker', icon: '▰', title: 'Marker: a thick see-through stroke' },
  {
    tool: 'rect',
    icon: '▭',
    title: 'Box: drag a box (around things, or where something should go)',
  },
  {
    tool: 'arrow',
    icon: '→',
    title: 'Arrow: from one thing to another ("connect", "move this there")',
  },
  { tool: 'note', icon: '🗒', title: 'Sticky note: click, type, Enter' },
  { tool: 'text', icon: 'T', title: 'Text: click, type, Enter' },
  { tool: 'eraser', icon: '⌫', title: 'Eraser: click a mark to rub it out' },
];
const unsent = computed(() => session.unsentMarks(props.view).length);
const all = computed(() => session.marksHere(props.view).length);
</script>

<template>
  <div class="ink-bar" data-testid="ink-bar" @pointerdown.stop>
    <button
      v-for="t in TOOLS"
      :key="t.tool"
      type="button"
      class="tool"
      :class="{ on: session.inking.value === t.tool }"
      :data-tool="t.tool"
      :title="t.title"
      @click="session.inking.value = t.tool"
    >
      {{ t.icon }}
    </button>
    <span class="sep" />
    <button
      v-for="c in MARK_COLORS"
      :key="c"
      type="button"
      class="swatch"
      :class="{ on: session.inkColor.value === c }"
      :style="{ background: c }"
      :title="COLOR_NAMES[c]"
      :data-color="c"
      @click="session.inkColor.value = c"
    />
    <span class="sep" />
    <button
      type="button"
      class="tool"
      title="Take back the last mark (⌘Z while drawing)"
      :disabled="!unsent"
      data-testid="ink-undo"
      @click="session.undoMark(view)"
    >
      ↶
    </button>
    <button
      type="button"
      class="tool"
      title="Rub out the sketch"
      :disabled="!all"
      data-testid="ink-clear"
      @click="session.clearSketch(view)"
    >
      🗑
    </button>
    <button
      type="button"
      class="tool"
      :class="{ on: session.inkPinned.value }"
      title="Keep the marks after the AI is done with them"
      data-testid="ink-pin"
      @click="session.inkPinned.value = !session.inkPinned.value"
    >
      📌
    </button>
    <button
      v-if="view === 'plugin'"
      type="button"
      class="text-btn"
      title="Lay the sketch under the plugin as a picture to build on (it stays while you edit, never when playing)"
      :disabled="!all"
      data-testid="ink-underlay"
      @click="emit('underlay')"
    >
      Lay under
    </button>
    <label
      class="stylus"
      title="A stylus draws where it touches nothing on the view (on knobs and modules it works as usual)"
      ><input v-model="session.stylusDraws.value" type="checkbox" /> stylus draws</label
    >
    <span class="count">{{
      unsent
        ? `${unsent} mark${unsent === 1 ? ' goes' : 's go'} with your next request`
        : 'draw, then ask'
    }}</span>
    <button
      type="button"
      class="text-btn done"
      data-testid="ink-done"
      title="Put the pen down (Esc); the marks stay"
      @click="session.inking.value = null"
    >
      Done <kbd>Esc</kbd>
    </button>
  </div>
</template>

<style scoped>
.ink-bar {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: #1b1b1bf2;
  border: 1px solid #3a3a3a;
  border-radius: 10px;
  box-shadow: 0 6px 20px #000a;
  font-size: 13px;
  white-space: nowrap;
  max-width: calc(100% - 16px);
  overflow-x: auto;
}
.tool {
  background: transparent;
  border: 0;
  box-shadow: none;
  color: #cfcfcf;
  font-size: 16px;
  width: 30px;
  height: 28px;
  padding: 0;
  border-radius: 6px;
}
.tool.on {
  background: #3a3a3a;
  color: #fff;
}
.tool:disabled {
  opacity: 0.35;
}
.swatch {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid transparent;
  padding: 0;
  box-shadow: none;
}
.swatch.on {
  border-color: #fff;
}
.sep {
  width: 1px;
  height: 20px;
  background: #3a3a3a;
  margin: 0 4px;
}
.text-btn {
  font-size: 12px;
  padding: 3px 8px;
  background: #2c2c2c;
  border: 1px solid #444;
  color: #ddd;
  border-radius: 6px;
  box-shadow: none;
}
.text-btn:disabled {
  opacity: 0.4;
}
.stylus {
  color: #9a9a9a;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 6px;
}
.count {
  color: #9a9a9a;
  font-size: 12px;
  margin: 0 6px;
}
.done kbd {
  font-size: 10px;
  margin-left: 4px;
}
</style>
