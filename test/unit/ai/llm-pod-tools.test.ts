// The AI's pod tools (kit_bash, kit_read_file, kit_write_file) against a pod
// stand-in: what they report, what lands in the work (one step of the request),
// and what they say when there is no pod.
import { describe, expect, it } from 'vite-plus/test';
import { catalog } from '../../../src/blocks/index.ts';
import { starter } from '../../../src/core/starters.ts';
import { applyIntents, type Intent } from '../../../src/core/ops.ts';
import { LlmWorkspace, type PodAccess, type WorkspaceDeps } from '../../../src/ai/llm-workspace.ts';
import { KIT_TOOL_NAMES, developerInstructions, toolDeadlineMs } from '../../../src/ai/llm-spec.ts';
import { describePlugin, uiReference } from '../../../src/ai/plugin-tools.ts';
import { checkPlugin } from '../../../src/plugin/checks.ts';
import type { PartReport } from '../../../src/pod/pod-session.ts';

/** A pod whose files are a map; commands are scripted by the test. */
function fakePod(files: Record<string, string>, run: (command: string, files: Record<string, string>) => { output: string; exitCode: number | null; timedOut?: boolean } = () => ({ output: '', exitCode: 0 })) {
  const state = { files: { ...files }, base: { ...files }, commands: [] as string[], parts: {} as Record<string, PartReport>, off: null as null | { reason: string; fix?: string }, ensured: 0 };
  const pod: PodAccess = {
    unavailable: () => state.off,
    ensure: async () => { state.ensured++; },
    bash: async command => { state.commands.push(command); const r = run(command, state.files); return { exitCode: r.exitCode, output: r.output, timedOut: !!r.timedOut, ms: 12 }; },
    readFile: async path => state.files[path] ?? null,
    writeFile: async (path, text) => { state.files[path] = text; },
    collect: async () => {
      const out: Record<string, string | null> = {};
      for (const [p, t] of Object.entries(state.files)) if (state.base[p] !== t) out[p] = t;
      for (const p of Object.keys(state.base)) if (!(p in state.files)) out[p] = null;
      state.base = { ...state.files };
      return { files: out, skipped: [] };
    },
    projectDir: () => '/home/user/work',
    parts: () => state.parts,
    status: () => ({ state: 'ready', message: 'Ready.', portal: 'http://127.0.0.1:1/' }),
  };
  return { pod, state };
}

function workspace(pod?: PodAccess, doc = starter('bass', catalog)) {
  const landed: Array<{ intents: Intent[]; label: string }> = [];
  const live = { doc };
  const deps: WorkspaceDeps = {
    catalog, images: false,
    read: () => live.doc,
    land: (intents, label) => { try { live.doc = applyIntents(live.doc, intents, catalog).doc; landed.push({ intents, label }); return { ok: true }; } catch (error) { return { ok: false, message: (error as Error).message }; } },
    compile: async () => ({ ok: true, ms: 1 }),
    render: async () => { throw new Error('no'); },
    look: async d => ({ issues: checkPlugin(d, catalog), png: null, width: d.panel.width, height: d.panel.height, ms: 1 }),
    pod,
  };
  return { ws: new LlmWorkspace(deps), landed, live };
}

describe('pod tools: specs and instructions', () => {
  it('the tools exist and the instructions tell the model it has a shell and files in the pod', () => {
    for (const name of ['kit_bash', 'kit_read_file', 'kit_write_file']) expect(KIT_TOOL_NAMES.has(name)).toBe(true);
    const text = developerInstructions('…');
    expect(text).not.toMatch(/cannot run shell commands/);
    expect(text).toMatch(/kit_bash runs commands there/);
    expect(text).toMatch(/AGENTS\.md/);
    expect(uiReference('code')).toMatch(/src\/parts\/<name>\.ts/);
  });
  it('the bridge waits longer for the pod\'s tools: the pod may start first, and a command runs as long as it was given', () => {
    expect(toolDeadlineMs('kit_get_patch', {}, 90_000)).toBe(90_000);
    expect(toolDeadlineMs('kit_look', {}, 90_000)).toBe(90_000);
    expect(toolDeadlineMs('kit_bash', { command: 'ls' }, 90_000)).toBe(120_000 + 600_000);
    expect(toolDeadlineMs('kit_bash', { command: 'npm run build', timeout_s: 600 }, 90_000)).toBe(1_200_000);
    expect(toolDeadlineMs('kit_bash', { command: 'x', timeout_s: 'soon' }, 90_000)).toBe(720_000);
    expect(toolDeadlineMs('kit_write_file', {}, 90_000)).toBe(600_000);
    expect(toolDeadlineMs('kit_read_file', null, 300)).toBe(600_000);
  });
});

describe('pod tools', () => {
  it('kit_bash runs in the project, reports output and exit status, and keeps changed files in the work as one step', async () => {
    const { pod, state } = fakePod({ 'package.json': '{}' }, (command, files) => {
      if (command.startsWith('cat > src/parts/meter.ts')) { files['src/parts/meter.ts'] = 'export default 1;\n'; return { output: '', exitCode: 0 }; }
      if (command === 'npm run check') return { output: 'src/parts/meter.ts(1,1): error TS2322: nope', exitCode: 2 };
      return { output: 'ok', exitCode: 0 };
    });
    const { ws, landed, live } = workspace(pod);
    const r1 = await ws.call('kit_bash', { command: "cat > src/parts/meter.ts <<'EOF'\nexport default 1;\nEOF" });
    expect(r1.success).toBe(true);
    expect(r1.text).toMatch(/\[exit 0/);
    expect(r1.text).toMatch(/Kept in the work: src\/parts\/meter\.ts \(new\)/);
    expect(landed).toHaveLength(1);
    expect(landed[0]!.intents[0]).toMatchObject({ op: 'setProjectFiles' });
    expect(live.doc.project?.files['src/parts/meter.ts']).toBe('export default 1;\n');
    expect(ws.projectTouched).toBe(true);
    const r2 = await ws.call('kit_bash', { command: 'npm run check' });
    expect(r2.text).toContain('error TS2322');
    expect(r2.text).toMatch(/\[exit 2/);
    expect(landed).toHaveLength(1);
    expect(state.commands).toEqual(["cat > src/parts/meter.ts <<'EOF'\nexport default 1;\nEOF", 'npm run check']);
  });
  it('a command that runs too long says so', async () => {
    const { pod } = fakePod({}, () => ({ output: 'partial', exitCode: null, timedOut: true }));
    const { ws } = workspace(pod);
    const r = await ws.call('kit_bash', { command: 'npm run dev', timeout_s: 5 });
    expect(r.text).toMatch(/stopped after 5 s/);
  });
  it('kit_read_file reads whole files or lines, inside the project only', async () => {
    const { pod } = fakePod({ 'AGENTS.md': 'one\ntwo\nthree\nfour' });
    const { ws } = workspace(pod);
    expect((await ws.call('kit_read_file', { path: 'AGENTS.md' })).text).toBe('AGENTS.md (4 lines):\none\ntwo\nthree\nfour');
    expect((await ws.call('kit_read_file', { path: '/home/user/work/AGENTS.md', from_line: 2, to_line: 3 })).text).toBe('AGENTS.md (4 lines; lines 2–3):\ntwo\nthree');
    expect((await ws.call('kit_read_file', { path: 'nope.ts' })).success).toBe(false);
    for (const bad of ['/etc/passwd', '../x', 'node_modules/vite/package.json']) expect((await ws.call('kit_read_file', { path: bad })).success, bad).toBe(false);
  });
  it('kit_write_file writes and keeps it; the generated controls file is refused', async () => {
    const { pod, state } = fakePod({});
    const { ws, live } = workspace(pod);
    const r = await ws.call('kit_write_file', { path: 'src/parts/dial.ts', content: 'export default 2;\n' });
    expect(r.success).toBe(true);
    expect(state.files['src/parts/dial.ts']).toBe('export default 2;\n');
    expect(live.doc.project?.files['src/parts/dial.ts']).toBe('export default 2;\n');
    expect((await ws.call('kit_write_file', { path: 'src/kit/controls.ts', content: 'x' })).success).toBe(false);
    expect((await ws.call('kit_write_file', { path: 'a.ts' })).success).toBe(false);
  });
  it('reports how the code parts on the plugin are doing', async () => {
    const { pod, state } = fakePod({ 'src/parts/meter.ts': 'x' });
    let doc = applyIntents(starter('bass', catalog), [{ op: 'setProjectFiles', files: { 'src/parts/meter.ts': 'x' } }, { op: 'addElement', element: { id: 'code1', kind: 'code', part: 'meter', rect: { x: 0, y: 0, w: 100, h: 80 }, props: {} } }], catalog).doc;
    state.parts.code1 = { part: 'meter', state: 'error', error: 'TypeError: kit.vale is not a function', logs: [] };
    const { ws } = workspace(pod, doc);
    const r = await ws.call('kit_bash', { command: 'true' });
    expect(r.text).toContain('Code parts on the plugin: code1 (part "meter"): error — TypeError: kit.vale is not a function');
    doc = ws['deps'].read();
    expect(describePlugin(doc, catalog, { parts: state.parts })).toMatch(/"kind":"code".*"part":"meter".* — error: TypeError/);
    expect(describePlugin(doc, catalog)).toMatch(/Screen project \(in the pod; kit_bash, kit_read_file, kit_write_file\): 1 files; code parts it offers: meter \(src\/parts\/meter\.ts\)/);
  });
  it('without a pod (no key), the tools say why and how to fix it, and change nothing', async () => {
    const { pod, state } = fakePod({});
    state.off = { reason: 'The pod (BrowserPod) is off: no API key.', fix: 'Put BROWSERPOD_API_KEY=… in .env' };
    const { ws, landed } = workspace(pod);
    const r = await ws.call('kit_bash', { command: 'ls' });
    expect(r.success).toBe(false);
    expect(r.text).toMatch(/no API key.*BROWSERPOD_API_KEY/);
    expect(state.commands).toEqual([]);
    expect(landed).toEqual([]);
    const none = workspace(undefined);
    expect((await none.ws.call('kit_write_file', { path: 'a.ts', content: '' })).text).toMatch(/no pod/);
    expect(describePlugin(starter('bass', catalog), catalog)).toMatch(/No screen project yet/);
  });
  it('a pod that fails to start is reported with its state', async () => {
    const { pod } = fakePod({});
    pod.ensure = async () => { throw new Error('npm install failed'); };
    const { ws } = workspace(pod);
    const r = await ws.call('kit_bash', { command: 'ls' });
    expect(r.success).toBe(false);
    expect(r.text).toMatch(/The pod did not start: npm install failed/);
  });
});
