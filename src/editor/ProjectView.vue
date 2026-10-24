<script setup lang="ts">
// The work's screen project and its pod: how the pod is doing (and how long
// its steps took), the project's files (edit one; ⌘S keeps it in the work, as
// an undo step), a terminal into the pod (the AI's commands show here too, with
// their output), and the pod check (what working in the pod feels like, measured).
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useSession } from './context.ts';
import { GENERATED_FILES, checkPath, isGenerated, textFiles } from '../work/files.ts';
import { kitFiles } from '../screen/kit-files.ts';
import { templateFiles, withTemplate } from '../workspace/template.ts';
import { PodCheck, secs } from '../workspace/pod-check.ts';
import CodeArea from './CodeArea.vue';
import NetworkPanel from './NetworkPanel.vue';
import { highlight, languageFor } from './highlight.ts';

const props = defineProps<{
  /** A file to open (from the inspector's "Open its file"). */ open?: string | null;
}>();
const session = useSession();
const pod = session.pod;
const check = podCheck();
const project = computed(() => {
  const files = textFiles(session.doc.value.files);
  return Object.keys(files).length ? { files } : undefined;
});
/** den-kit's own kit (the behaviors of its controls), shown as den-kit writes it. */
const kit = kitFiles();
/** The files: the work's (or the template's, while it has none) and the ones den-kit makes. */
const files = computed(() => {
  const own = project.value?.files ?? templateFiles();
  return [...Object.keys(own), ...GENERATED_FILES, ...Object.keys(kit)].sort(
    (a, b) => depth(a) - depth(b) || a.localeCompare(b),
  );
});
const depth = (p: string) => p.split('/').length;
const current = ref<string>(props.open ?? '');
const draft = ref('');
const dirty = computed(() => draft.value !== text(current.value));
const readOnly = computed(() => isGenerated(current.value));
function text(path: string): string {
  if (GENERATED_FILES.has(path)) return pod?.controls ?? '';
  if (isGenerated(path)) return kit[path] ?? '';
  return (project.value?.files ?? templateFiles())[path] ?? '';
}
function select(path: string) {
  if (dirty.value && !confirm(`Leave ${current.value} without keeping your changes?`)) return;
  current.value = path;
  draft.value = text(path);
}
watch(
  () => props.open,
  p => {
    if (p) select(p);
  },
);
watch(
  () => text(current.value),
  (now, before) => {
    if (draft.value === before) draft.value = now;
  },
);
onMounted(() => {
  if (!files.value.includes(current.value))
    current.value = files.value.find(f => f.startsWith('src/parts/')) ?? 'AGENTS.md';
  draft.value = text(current.value);
});
function keep() {
  if (readOnly.value || !dirty.value) return;
  const r = session.commit(
    [
      {
        op: 'setProjectFiles',
        files: withTemplate(session.doc.value.files, { [current.value]: draft.value }),
      },
    ],
    { label: `Edit ${current.value}` },
  );
  if (!r.ok) session.toast('warn', r.error.message);
}
const newPath = ref('');
function create() {
  const path = newPath.value.trim().replace(/^\.?\//, '');
  const bad = checkPath(path);
  if (bad) {
    session.toast('warn', bad);
    return;
  }
  if (files.value.includes(path)) {
    select(path);
    return;
  }
  const r = session.commit(
    [{ op: 'setProjectFiles', files: withTemplate(session.doc.value.files, { [path]: '' }) }],
    { label: `New file ${path}` },
  );
  if (r.ok) {
    newPath.value = '';
    current.value = path;
    draft.value = '';
  }
}
function remove() {
  if (readOnly.value || !project.value?.files[current.value]) return;
  if (!confirm(`Delete ${current.value} from the work? (⌘Z brings it back.)`)) return;
  session.commit([{ op: 'setProjectFiles', files: { [current.value]: null } }], {
    label: `Delete ${current.value}`,
  });
  current.value = files.value.find(f => f !== current.value) ?? 'AGENTS.md';
  draft.value = text(current.value);
}
function editorKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    keep();
  } else if (e.key === 'Tab') {
    e.preventDefault();
    const t = e.target as HTMLTextAreaElement;
    const a = t.selectionStart;
    draft.value = `${draft.value.slice(0, a)}  ${draft.value.slice(t.selectionEnd)}`;
    void nextTick(() => {
      t.selectionStart = t.selectionEnd = a + 2;
    });
  }
  e.stopPropagation();
}

// ---- terminal ---------------------------------------------------------------------------
const command = ref('');
const shell = ref<HTMLElement | null>(null);
const history: string[] = [];
let back = 0;
async function run() {
  const c = command.value.trim();
  if (!c || !pod) return;
  history.push(c);
  back = 0;
  command.value = '';
  try {
    const r = await pod.runForYou(c);
    if (r.changed.length)
      session.toast(
        'info',
        `Kept in the work: ${r.changed.slice(0, 4).join(', ')}${r.changed.length > 4 ? ` and ${r.changed.length - 4} more` : ''} (⌘Z takes it back).`,
      );
    if (r.skipped.length) session.toast('warn', `Not kept: ${r.skipped.slice(0, 3).join('; ')}`);
  } catch (error) {
    session.toast('error', error instanceof Error ? error.message : String(error));
  }
}
function shellKey(e: KeyboardEvent) {
  e.stopPropagation();
  if (e.key === 'Enter') {
    e.preventDefault();
    void run();
  } else if (e.key === 'ArrowUp' && history.length) {
    e.preventDefault();
    back = Math.min(history.length, back + 1);
    command.value = history[history.length - back] ?? '';
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    back = Math.max(0, back - 1);
    command.value = back ? (history[history.length - back] ?? '') : '';
  }
}
const log = computed(() => pod?.log.value ?? []);
watch(
  () => log.value.length,
  () =>
    void nextTick(() => {
      if (shell.value) shell.value.scrollTop = shell.value.scrollHeight;
    }),
);
const WHO: Record<string, string> = { ai: 'AI', you: 'you', 'den-kit': 'den-kit' };

// ---- project tools ---------------------------------------------------------------------
const state = computed(() => pod?.state.value ?? 'unavailable');
const STATE_LABEL = {
  off: 'Not started',
  unavailable: 'Unavailable',
  booting: 'Preparing',
  syncing: 'Preparing',
  installing: 'Preparing',
  starting: 'Starting',
  ready: 'Ready',
  failed: 'Needs attention',
};
const timings = computed(() => {
  const t = pod?.timings.value ?? {};
  return [
    t.bootMs !== undefined && `boot ${secs(t.bootMs)}`,
    t.syncMs !== undefined && `write ${secs(t.syncMs)}`,
    t.installMs !== undefined && `npm install ${secs(t.installMs)}`,
    t.devMs !== undefined && `dev server ${secs(t.devMs)}`,
  ]
    .filter(Boolean)
    .join(' · ');
});
function start() {
  (state.value === 'failed' || state.value === 'unavailable' ? pod?.retry() : pod?.ensure())?.catch(
    () => undefined,
  );
}
async function runCheck() {
  if (!pod) return;
  await check.run(pod, () => session.codeParts?.source.portal.value ?? null);
  const text = check.summary(pod.kind);
  pod.note(text.split('\n')[0]!);
  session.bridge?.telemetry({
    kind: 'pod-check',
    pod: pod.kind,
    ok: check.ok,
    totalMs: check.totalMs.value,
    steps: check.steps.value,
  });
  session.toast(
    check.ok ? 'info' : 'warn',
    `Project diagnostics: ${check.ok ? 'every step passed' : 'some steps failed'} in ${secs(check.totalMs.value)}.`,
  );
}
async function copySummary() {
  try {
    await navigator.clipboard.writeText(check.summary(pod?.kind ?? null));
    session.toast('info', 'Copied the diagnostic results.');
  } catch {
    session.toast('warn', 'Could not copy.');
  }
}
</script>

<script lang="ts">
// One check per page (it survives switching views).
let shared: PodCheck | null = null;
export function podCheck(): PodCheck {
  shared ??= new PodCheck();
  return shared;
}
</script>

<template>
  <div class="project-view" data-testid="project-view">
    <div class="head">
      <span class="dot" :class="state" />
      <b>Project tools</b>
      <span class="state" data-testid="pod-state" :data-state="state">{{
        STATE_LABEL[state]
      }}</span>
      <span class="message" data-testid="pod-message">{{ pod?.message.value }}</span>
      <span v-if="pod?.fix.value" class="fix" data-testid="pod-fix">{{ pod.fix.value }}</span>
      <span class="spacer" />
      <button
        v-if="
          pod?.available &&
          (state === 'failed' || state === 'unavailable' ? pod.retryable : !pod.booted)
        "
        class="small"
        data-testid="pod-start"
        @click="start"
      >
        {{
          state === 'failed' || state === 'unavailable'
            ? 'Retry project tools'
            : 'Start project tools'
        }}
      </button>
    </div>
    <div class="cols">
      <div class="files" data-testid="project-files">
        <div class="muted small note">
          {{
            project
              ? `${Object.keys(project.files).length} files in the work`
              : 'Starter project files. Your changes are saved with this work.'
          }}
        </div>
        <button
          v-for="f in files"
          :key="f"
          type="button"
          class="file"
          :class="{ current: f === current, made: GENERATED_FILES.has(f) }"
          :data-file="f"
          @click="select(f)"
        >
          {{ f }}
        </button>
        <div class="new">
          <input
            v-model="newPath"
            type="text"
            placeholder="src/parts/new.ts"
            spellcheck="false"
            @keydown.stop
            @keydown.enter="create"
          /><button class="small" @click="create">New</button>
        </div>
      </div>
      <div class="editor">
        <div class="bar">
          <b>{{ current }}</b>
          <span v-if="readOnly" class="muted small"
            >made by den-kit from the patch (read only)</span
          >
          <span v-else-if="dirty" class="muted small">changed — ⌘S keeps it in the work</span>
          <span class="spacer" />
          <button
            v-if="!readOnly"
            class="small primary"
            :disabled="!dirty"
            data-testid="file-keep"
            @click="keep"
          >
            Keep <kbd>⌘S</kbd>
          </button>
          <button
            v-if="!readOnly && project?.files[current] !== undefined"
            class="small"
            @click="remove"
          >
            Delete
          </button>
        </div>
        <CodeArea
          v-model="draft"
          class="code"
          :language="languageFor(current)"
          :readonly="readOnly"
          data-testid="file-text"
          @keydown="editorKey"
        />
      </div>
    </div>
    <NetworkPanel />
    <details class="diagnostics" data-testid="project-diagnostics">
      <summary>Diagnostics</summary>
      <div class="diagnostic-body">
        <div class="diagnostic-tools">
          <p class="muted small">
            Run technical checks when troubleshooting project tools. These checks do not change your
            work.
          </p>
          <p v-if="timings" class="muted small">{{ timings }}</p>
          <p v-if="pod?.portal.value">
            <a class="small" :href="pod.portal.value" target="_blank" rel="noreferrer"
              >Project preview endpoint ↗</a
            >
          </p>
          <button
            v-if="pod?.available"
            class="small"
            data-testid="pod-check"
            :disabled="check.running.value"
            @click="runCheck"
          >
            {{ check.running.value ? 'Checking…' : 'Run diagnostics' }}
          </button>
        </div>
        <div class="check" data-testid="pod-check-panel">
          <h3>Diagnostic results</h3>
          <div
            v-for="s in check.steps.value"
            :key="s.id"
            class="step"
            :class="s.state"
            :data-step="s.id"
          >
            <span class="mark">{{
              s.state === 'ok'
                ? '✓'
                : s.state === 'failed'
                  ? '✗'
                  : s.state === 'running'
                    ? '…'
                    : '·'
            }}</span>
            <span class="title">{{ s.title }}</span>
            <span v-if="s.ms !== undefined" class="ms">{{ secs(s.ms) }}</span>
            <div v-if="s.detail" class="detail">{{ s.detail }}</div>
          </div>
          <div v-if="check.at.value" class="muted small">
            {{ check.ok ? 'Every step passed' : 'Some steps failed' }} ·
            {{ secs(check.totalMs.value) }} in all
            <button class="small" @click="copySummary">Copy</button>
          </div>
        </div>
      </div>
    </details>
    <div class="terminal">
      <div ref="shell" class="lines" data-testid="pod-log">
        <div
          v-for="e in log"
          :key="e.id"
          class="entry"
          :class="[e.who, { failed: !e.running && e.exitCode !== 0 && e.exitCode !== null }]"
          :data-entry="e.id"
        >
          <!-- prettier-ignore -->
          <div class="cmd"><span class="who">{{ WHO[e.who] }}</span> <span class="prompt">$</span> <span class="c" v-html="highlight(e.command, 'bash')" /> <span class="exit">{{ e.running ? '…' : e.timedOut ? 'stopped (too long)' : e.exitCode === null ? '' : `exit ${e.exitCode}` }}{{ e.running || !e.ms ? '' : ` · ${secs(e.ms)}` }}</span></div>
          <pre v-if="e.output" class="out">{{
            e.output.length > 6000 ? `…${e.output.slice(-6000)}` : e.output
          }}</pre>
        </div>
        <div v-if="!log.length" class="muted small">
          Project commands run by you, the AI and den-kit appear here with their output.
        </div>
      </div>
      <div class="input">
        <span class="prompt">{{ pod?.projectDir || '~/work' }} $</span
        ><input
          v-model="command"
          type="text"
          spellcheck="false"
          autocomplete="off"
          :disabled="!pod?.available"
          data-testid="pod-command"
          placeholder="npm run check · git log · ls src/parts"
          @keydown="shellKey"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.project-view {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto 38%;
  background: var(--gray-3);
  color: var(--gray-17);
}
.head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--gray-6);
  font-size: 13px;
  flex-wrap: wrap;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--gray-10);
}
.dot.ready {
  background: var(--green);
}
.dot.failed {
  background: var(--red-soft);
}
.dot.unavailable,
.dot.off {
  background: var(--gray-10);
}
.dot.booting,
.dot.syncing,
.dot.installing,
.dot.starting {
  background: var(--orange-light);
  animation: blink 1s infinite;
}
@keyframes blink {
  50% {
    opacity: 0.35;
  }
}
.state {
  color: var(--gray-14);
}
.message {
  color: var(--gray-16);
}
.fix {
  color: var(--sand);
}
.spacer {
  flex: 1;
}
.cols {
  display: grid;
  grid-template-columns: 230px 1fr;
  min-height: 0;
}
.files {
  border-right: 1px solid var(--gray-6);
  overflow: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.note {
  padding: 4px;
}
.file {
  text-align: left;
  background: transparent;
  box-shadow: none;
  padding: 3px 6px;
  font:
    12px ui-monospace,
    Menlo,
    monospace;
  color: var(--gray-16);
  border-radius: 4px;
}
.file.current {
  background: var(--orange-dark);
  color: var(--gray-19);
}
.file.made {
  color: var(--gray-12);
  font-style: italic;
}
.new {
  display: flex;
  gap: 4px;
  margin-top: 8px;
}
.new input {
  flex: 1;
  min-width: 0;
  font:
    12px ui-monospace,
    Menlo,
    monospace;
}
.editor {
  display: grid;
  grid-template-rows: auto 1fr;
  min-width: 0;
  min-height: 0;
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--gray-5);
  font-size: 12.5px;
}
.code {
  --code-bg: var(--gray-2);
  --code-fg: var(--gray-18);
  --code-font: 12.5px/1.45 ui-monospace, Menlo, monospace;
  --code-pad: 10px 12px;
}
.diagnostics {
  border-top: 1px solid var(--gray-6);
}
.diagnostics summary {
  padding: 7px 12px;
  color: var(--gray-14);
  font-size: 12.5px;
  cursor: pointer;
}
.diagnostic-body {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) 2fr;
  max-height: 240px;
  overflow: auto;
  border-top: 1px solid var(--gray-5);
}
.diagnostic-tools {
  padding: 8px 12px;
}
.diagnostic-tools p {
  margin: 0 0 8px;
}
.check {
  border-left: 1px solid var(--gray-6);
  padding: 8px 10px;
  font-size: 12.5px;
}
.check h3 {
  margin: 0 0 4px;
  font-size: 13px;
}
.step {
  display: grid;
  grid-template-columns: 14px 1fr auto;
  gap: 4px;
  padding: 4px 0;
  border-bottom: 1px solid var(--gray-4);
}
.step .mark {
  color: var(--gray-12);
}
.step.ok .mark {
  color: var(--green);
}
.step.failed .mark {
  color: var(--red-soft);
}
.step.running .mark {
  color: var(--orange-light);
}
.step .ms {
  color: var(--gray-14);
  font-variant-numeric: tabular-nums;
}
.step .detail {
  grid-column: 2 / 4;
  color: var(--gray-12);
  font-size: 11.5px;
  white-space: pre-wrap;
  word-break: break-word;
}
.terminal {
  display: grid;
  grid-template-rows: 1fr auto;
  border-top: 1px solid var(--gray-6);
  min-height: 0;
  background: var(--gray-1);
}
.lines {
  overflow: auto;
  padding: 6px 10px;
  font:
    12px/1.4 ui-monospace,
    Menlo,
    monospace;
}
.entry {
  margin-bottom: 6px;
}
.cmd {
  color: var(--gray-18);
}
.who {
  display: inline-block;
  min-width: 54px;
  color: var(--blue-deep);
}
.entry.ai .who {
  color: var(--orange-light);
}
.entry.you .who {
  color: var(--green);
}
.prompt {
  color: var(--gray-11);
}
.exit {
  color: var(--gray-12);
  margin-left: 6px;
}
.entry.failed .exit {
  color: var(--red-soft);
}
.out {
  margin: 2px 0 0 60px;
  color: var(--gray-15);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 260px;
  overflow: auto;
}
.input {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-top: 1px solid var(--gray-5);
  font:
    12.5px ui-monospace,
    Menlo,
    monospace;
}
.input input {
  flex: 1;
  font: inherit;
  background: var(--gray-1);
}
</style>
