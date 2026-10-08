// Scripted turns for the fake app-server, written against the bass starter
// (ids voice1, osc1, fenv1, fdepth1, cut1, filter1, aenv1, vca1, vel1, mix1,
// gain1, out1). They drive den-kit's real tools in the browser or the bridge
// tests; what the tools answer decides what the script does next, like a model.
import type { Scenario } from './fake-codex.ts';

const BOX_BROKEN = "import { defineSubgraph, type Node } from '@unworklet/core';\nexport default defineSubgraph(() => ({ tick(i: { in: Node<'f32'>; bits: Node<'f32'> }) { return { out: i.in.mul( } } }));";
const BOX_FIXED = "import { defineSubgraph, type Node } from '@unworklet/core';\n// a crude bitcrusher: quantise to 2^bits steps\nexport default defineSubgraph(() => ({ tick(i: { in: Node<'f32'>; bits: Node<'f32'> }) { const steps = i.bits.clamp(1, 16).mul(0.6931472).exp(); return { out: i.in.mul(steps).add(0.5).floor().div(steps) }; } }));";

// A code part written the way a model would in the pod: TypeScript that reads a knob and moves it.
const METER_PART = `import { part } from '../kit';

// A bar that shows the cutoff knob; a click sets it (one undo step).
export default part({
  props: { color: { type: 'color', default: 'accent', label: 'Colour' } },
  mount(root, kit) {
    const bar = root.appendChild(document.createElement('div'));
    bar.id = 'meter-bar';
    Object.assign(bar.style, { position: 'absolute', left: '0', bottom: '0', width: '100%', background: \`var(--dk-\${kit.props.color})\` });
    root.addEventListener('pointerdown', e => { kit.begin(); kit.setNorm('knob1', 1 - e.offsetY / kit.size.height); kit.end(); });
    return kit.frame(() => { bar.style.height = \`\${Math.round(kit.norm('knob1') * 100)}%\`; });
  },
});
`;

const scenarios: Scenario[] = [
  // Members first: their text quotes the person's request, which other scenarios would match.
  {
    name: 'team-sound',
    match: /Your name: Sound \(m1\)/,
    async run(t) {
      await t.think();
      await t.sleep(300); // long enough for the person to see both lanes working
      await t.call('kit_apply_ops', { ops: [
        { op: 'setValue', node: 'filter1', port: 'resonance', value: 3 },
        { op: 'addNode', node: { id: 'lfo2', type: 'den.lfo', values: { rate: 4 } } },
        { op: 'connect', from: { node: 'lfo2', port: 'out' }, to: { node: 'cut1', port: 'octaves' }, replace: true },
      ] });
      const wrong = await t.call('kit_apply_ops', { ops: [{ op: 'setLook', look: { tokens: { accent: '#ff0000' } } }] });
      await t.call('kit_listen', { phrase: 'bass', seconds: 1 });
      t.usage(8000, 600, 6000);
      await t.call('kit_finish', { summary: 'Squelchy bass', names: ['lfo2 wobbles cut1'], needs: [], problems: wrong.success ? ['an edit outside my scope was not refused'] : [] });
    },
  },
  {
    name: 'team-screen',
    match: /Your name: Screen \(m2\)/,
    async run(t) {
      await t.think();
      await t.call('kit_apply_ops', { ops: [
        { op: 'setLook', look: { tokens: { bg: '#000000', fg: '#39ff14', accent: '#39ff14' } } },
        { op: 'addElement', element: { kind: 'text', text: 'ACID', rect: { x: 40, y: 24, w: 300, h: 56 }, textStyle: { font: 'orbitron', size: 40, color: 'accent' } } },
      ] });
      await t.sleep(400);
      await t.call('kit_look', {});
      t.usage(3000, 300);
      await t.call('kit_finish', { summary: 'Neon screen' });
    },
  },
  {
    // U8b: the model asks to see what the person sees.
    name: 'see',
    match: /what do you see/i,
    async run(t) {
      await t.think();
      const r = await t.call('kit_look', { as: 'seen' });
      await t.say(`${r.images ? 'picture' : 'no picture'}: ${r.text.slice(0, 400)}`);
    },
  },
  {
    name: 'member-start',
    match: /\[den-kit\] You are a member/,
    async run(t) {
      // A member says whether it started from a copy of the lead's conversation and what its first text began with.
      await t.say(`forked=${t.forkedFrom ? 'yes' : 'no'}; begins: ${t.text.slice(0, 60).replace(/\n/g, ' ')}`);
    },
  },
  {
    // The pod: the model reads the guide, writes a code part with bash, checks it with tsc and ESLint, puts it on the plugin, looks.
    name: 'code-part',
    match: /コード部品|a code part/i,
    async run(t) {
      await t.think();
      const plugin = await t.call('kit_get_plugin', {});
      if (!/No screen project yet/.test(plugin.text)) { await t.say('Expected no screen project yet.'); return; }
      const guide = await t.call('kit_read_file', { path: 'AGENTS.md' });
      if (!guide.success || !/## Code parts/.test(guide.text)) { await t.say(`No guide: ${guide.text.slice(0, 300)}`); return { status: 'failed', message: 'scenario: no AGENTS.md', info: 'other' }; }
      await t.call('kit_apply_ops', { ops: [{ op: 'addControl', for: { node: 'cut1', port: 'hz' }, label: 'Cutoff' }] });
      const wrote = await t.call('kit_bash', { command: `mkdir -p src/parts && cat > src/parts/meter.ts <<'EOF'\n${METER_PART}EOF\ngit status --short` });
      if (!/meter\.ts/.test(wrote.text)) { await t.say(`Writing failed: ${wrote.text.slice(0, 300)}`); return { status: 'failed', message: 'scenario: write failed', info: 'other' }; }
      const checked = await t.call('kit_bash', { command: 'npm run check && npm run lint', timeout_s: 180 });
      if (!/\[exit 0/.test(checked.text)) { await t.say(`Checks failed: ${checked.text.slice(-600)}`); return { status: 'failed', message: 'scenario: checks failed', info: 'other' }; }
      const placed = await t.call('kit_apply_ops', { ops: [{ op: 'addElement', element: { id: 'meter1', kind: 'code', part: 'meter', rect: { x: 400, y: 40, w: 60, h: 160 }, props: { color: 'accent' } } }] });
      if (!placed.success) { await t.say(`Placing failed: ${placed.text.slice(0, 300)}`); return { status: 'failed', message: 'scenario: place failed', info: 'other' }; }
      const seen = await t.call('kit_look', {});
      await t.call('kit_finish', { summary: /code part meter1[^\n]*fails/.test(seen.text) ? `コード部品が動いていません: ${seen.text.slice(0, 200)}` : 'コード部品「meter」を作ってプラグインに置きました' });
      await t.say('Done.');
    },
  },
  {
    // A broken code part: the model sees the error from the plugin, fixes the file, and the part runs.
    name: 'code-part-fix',
    match: /壊れた部品|broken part/i,
    async run(t) {
      await t.think();
      await t.call('kit_write_file', { path: 'src/parts/oops.ts', content: "import { part } from '../kit';\nexport default part({ mount(root) { throw new Error('oops: the canvas is missing'); } });\n" });
      await t.call('kit_apply_ops', { ops: [{ op: 'addElement', element: { id: 'oops1', kind: 'code', part: 'oops', rect: { x: 20, y: 20, w: 120, h: 80 }, props: {} } }] });
      const first = await t.call('kit_look', {});
      if (!/oops: the canvas is missing/.test(first.text)) { await t.say(`The look did not report the error: ${first.text.slice(0, 400)}`); return { status: 'failed', message: 'scenario: no error seen', info: 'other' }; }
      await t.call('kit_write_file', { path: 'src/parts/oops.ts', content: "import { part } from '../kit';\nexport default part({ mount(root) { root.textContent = 'fixed'; } });\n" });
      const second = await t.call('kit_look', {});
      await t.call('kit_finish', { summary: /oops1[^\n]*fails/.test(second.text) ? 'まだ壊れています' : '壊れた部品を直しました' });
      await t.say('Done.');
    },
  },
  {
    // npm run kit:doctor -- --deep
    name: 'doctor-ping',
    match: /connectivity check/i,
    async run(t) {
      await t.think();
      const r = await t.call('kit_ping', {});
      await t.say(r.text.includes('pong') ? 'pong' : 'no pong');
    },
  },
  {
    name: 'wobble',
    match: /wobble|揺らして/i,
    async run(t) {
      await t.think();
      const patch = await t.call('kit_get_patch', {});
      if (!patch.text.includes('"cut1"')) { await t.say('I could not find the cutoff modulator.'); return; }
      const edit = await t.call('kit_apply_ops', { ops: [
        { op: 'addNode', node: { id: 'lfo2', type: 'den.lfo', label: 'Wobble', values: { rate: 5 } } },
        { op: 'addNode', node: { id: 'wob1', type: 'kit.mul', values: { b: 1.5 } } },
        { op: 'addNode', node: { id: 'sum2', type: 'kit.add' } },
        { op: 'connect', from: { node: 'lfo2', port: 'out' }, to: { node: 'wob1', port: 'a' } },
        { op: 'connect', from: { node: 'fdepth1', port: 'out' }, to: { node: 'sum2', port: 'a' } },
        { op: 'connect', from: { node: 'wob1', port: 'out' }, to: { node: 'sum2', port: 'b' } },
        { op: 'connect', from: { node: 'sum2', port: 'out' }, to: { node: 'cut1', port: 'octaves' }, replace: true },
      ] });
      if (!/Compiled OK/.test(edit.text)) { await t.say(`The edit did not compile: ${edit.text.slice(0, 200)}`); return; }
      const heard = await t.call('kit_listen', { phrase: 'bass', seconds: 2 });
      await t.call('kit_finish', { summary: t.text.match(/[ぁ-んァ-ン一-龯]/) ? 'LFOでカットオフを揺らしました' : `Added an LFO that wobbles the cutoff${heard.success ? ' (checked by listening)' : ''}.` });
      await t.say('Done.');
    },
  },
  {
    // A screen built the way a model would: read, brief, edit, look, fix what the look found, look again.
    name: 'screen',
    match: /画面を作って|design (?:the|a) (?:plugin )?screen/i,
    async run(t) {
      await t.think();
      const plugin = await t.call('kit_get_plugin', {});
      if (!/No design brief yet/.test(plugin.text)) { await t.say('Expected no brief yet.'); return; }
      await t.call('kit_ui_reference', { topic: 'skins', control: 'knob' });
      await t.call('kit_apply_ops', { ops: [{ op: 'setBrief', brief: 'Night-drive bass: deep blue, neon cyan accents, Orbitron type; the name on top, a row of big knobs.' }] });
      // A first pass with two mistakes in it: two knobs on top of each other, and a subtitle too dark to read.
      const first = await t.call('kit_apply_ops', { ops: [
        { op: 'setPanelSize', width: 640, height: 300 },
        { op: 'setLook', look: { tokens: { bg: '#0b1020', fg: '#e6f1ff', accent: '#3ad1ff', muted: '#8aa0c0', font: 'orbitron', labelFont: 'orbitron', valueFont: 'orbitron' }, background: [{ kind: 'radial', x: 0.5, y: 0.2, stops: [{ color: '#1b2a55', at: 0 }, { color: '#0b1020', at: 1 }] }], skins: { knob: { name: 'ring', params: { thickness: 5 } } } } },
        { op: 'addElement', element: { kind: 'text', text: 'NIGHT BASS', rect: { x: 24, y: 18, w: 592, h: 48 }, textStyle: { size: 34, weight: 700, color: 'fg', align: 'left', spacing: 0.2 } } },
        { op: 'addElement', element: { kind: 'text', text: 'a bass for driving at night', rect: { x: 26, y: 66, w: 400, h: 20 }, textStyle: { size: 12, color: '#1c2640', align: 'left' } } },
        { op: 'addControl', for: { node: 'cut1', port: 'hz' }, label: 'Cutoff', panel: { x: 24, y: 110, w: 96, h: 110 } },
        { op: 'addControl', for: { node: 'filter1', port: 'resonance' }, label: 'Resonance', panel: { x: 70, y: 110, w: 96, h: 110 } },
        { op: 'addControl', for: { node: 'aenv1', port: 'release' }, label: 'Release', panel: { x: 248, y: 110, w: 96, h: 110 } },
      ] });
      if (!first.success) { await t.say(`The edit failed: ${first.text.slice(0, 300)}`); return; }
      const seen = await t.call('kit_look', {});
      const fixes: Array<Record<string, unknown>> = [];
      if (/knob1 \("Cutoff"\) and knob2 \("Resonance"\) overlap/.test(seen.text)) fixes.push({ op: 'setRect', id: 'knob2', rect: { x: 136, y: 110, w: 96, h: 110 } });
      if (/text2 .*hard to read/.test(seen.text)) fixes.push({ op: 'updateElement', id: 'text2', set: { textStyle: { size: 12, color: 'muted', align: 'left' } } });
      if (fixes.length) await t.call('kit_apply_ops', { ops: fixes });
      const again = await t.call('kit_look', {});
      await t.call('kit_finish', { summary: /found nothing to fix/.test(again.text) ? `夜のドライブ風の画面を作りました（チェックで ${fixes.length} 件直しました）` : `Made a screen; still to fix: ${again.text.slice(0, 160)}` });
      await t.say('Done.');
    },
  },
  {
    // Parts the way a model would use them: make the core of the sound a part, use it again with its own setting, listen.
    name: 'parts',
    match: /パーツにして.*重ね|make .* a part and layer/i,
    async run(t) {
      await t.think();
      const patch = await t.call('kit_get_patch', {});
      if (!patch.text.includes('"osc1"')) { await t.say('I could not find the oscillator.'); return; }
      const made = await t.call('kit_apply_ops', { ops: [{ op: 'makePart', ids: ['osc1', 'filter1'], name: 'Core', id: 'core' }] });
      if (!/new ids: core1/.test(made.text)) { await t.say(`Making the part failed: ${made.text.slice(0, 300)}`); return { status: 'failed', message: 'scenario: makePart failed', info: 'other' }; }
      const layered = await t.call('kit_apply_ops', { ops: [
        { op: 'addNode', node: { id: 'core2', type: 'kit.part', part: 'core', values: { resonance: 4 } } },
        { op: 'addNode', node: { id: 'layer1', type: 'kit.add', label: 'Layers' } },
        { op: 'connect', from: { node: 'voice1', port: 'pitch' }, to: { node: 'core2', port: 'frequency' } },
        { op: 'connect', from: { node: 'cut1', port: 'out' }, to: { node: 'core2', port: 'cutoff' } },
        { op: 'connect', from: { node: 'core1', port: 'out' }, to: { node: 'layer1', port: 'a' } },
        { op: 'connect', from: { node: 'core2', port: 'out' }, to: { node: 'layer1', port: 'b' } },
        { op: 'connect', from: { node: 'layer1', port: 'out' }, to: { node: 'vca1', port: 'a' }, replace: true },
        { op: 'updatePart', part: 'core', doc: 'The oscillator through the filter.' },
      ] });
      if (!/Compiled OK/.test(layered.text)) { await t.say(`Layering failed: ${layered.text.slice(0, 300)}`); return { status: 'failed', message: 'scenario: layering failed', info: 'other' }; }
      const heard = await t.call('kit_listen', { phrase: 'bass', seconds: 1.5 });
      await t.call('kit_finish', { summary: !heard.success || /"silent":true/.test(heard.text) ? '重ねましたが、音が出ていません' : 'パーツ「Core」にして、もう1つ重ねました' });
      await t.say('Done.');
    },
  },
  {
    name: 'stacks',
    match: /スーパーソー|supersaw/i,
    async run(t) {
      await t.think();
      const patch = await t.call('kit_get_patch', {});
      if (!patch.text.includes('"osc1"') || !patch.text.includes('"voice1"')) { await t.say('I could not find the oscillator.'); return; }
      // Seven saws per voice, each detuned a little: copies of a pitch shift and of the oscillator, joined copy to copy.
      const stacked = await t.call('kit_apply_ops', { ops: [
        { op: 'addNode', node: { id: 'detune1', type: 'kit.pitchMod', label: 'Detune', count: 7, spread: { semitones: { kind: 'range', amount: 0.15 } } } },
        { op: 'setCount', node: 'osc1', count: 7 },
        { op: 'setConfig', node: 'osc1', key: 'waveform', value: 'saw' },
        { op: 'connect', from: { node: 'voice1', port: 'pitch' }, to: { node: 'detune1', port: 'hz' } },
        { op: 'connect', from: { node: 'detune1', port: 'out' }, to: { node: 'osc1', port: 'frequency' }, replace: true },
      ] });
      if (!/Compiled OK/.test(stacked.text)) { await t.say(`Stacking failed: ${stacked.text.slice(0, 300)}`); return { status: 'failed', message: 'scenario: stacking failed', info: 'other' }; }
      const patched = await t.call('kit_get_patch', {});
      const heard = await t.call('kit_listen', { phrase: 'bass', seconds: 1.5 });
      const silent = !heard.success || /"silent":true/.test(heard.text);
      await t.call('kit_finish', { summary: silent ? '重ねましたが、音が出ていません' : /×7/.test(patched.text) ? 'ノコギリ波を7本重ねて、少しずつずらしました' : '重ねたはずが ×7 が見えません' });
      await t.say('Done.');
    },
  },
  {
    name: 'explain',
    match: /how does|explain|説明|仕組み/i,
    async run(t) {
      const patch = await t.call('kit_get_patch', {});
      await t.say(patch.success ? 'An oscillator goes through a filter whose cutoff follows an envelope, then an amp envelope.' : 'I could not read the patch.');
    },
  },
  {
    name: 'codebox',
    match: /bitcrush|codebox|コードボックス/i,
    async run(t) {
      await t.call('kit_get_patch', {});
      await t.call('kit_apply_ops', { ops: [
        { op: 'addNode', node: { id: 'crush1', type: 'kit.codebox', label: 'Crusher' } },
        { op: 'connect', from: { node: 'gain1', port: 'out' }, to: { node: 'crush1', port: 'in' } },
        { op: 'connect', from: { node: 'crush1', port: 'out' }, to: { node: 'out1', port: 'left' }, replace: true },
      ] });
      const ports = { inputs: [{ id: 'in', type: 'signal' }, { id: 'bits', type: 'signal' }], outputs: [{ id: 'out', type: 'signal' }] };
      const broken = await t.call('kit_write_codebox', { node: 'crush1', code: BOX_BROKEN, ...ports });
      if (!/not compile|error/i.test(broken.text)) { await t.say('Expected a compile error.'); return { status: 'failed', message: 'scenario: no compile error reported', info: 'other' }; }
      const fixed = await t.call('kit_write_codebox', { node: 'crush1', code: BOX_FIXED, ...ports });
      if (!/Compiled OK/.test(fixed.text)) { await t.say(`Still broken: ${fixed.text.slice(0, 300)}`); return; }
      await t.call('kit_apply_ops', { ops: [{ op: 'setValue', node: 'crush1', port: 'bits', value: 4 }] });
      await t.call('kit_listen', { phrase: 'bass', seconds: 1.5 });
      await t.call('kit_finish', { summary: 'Added a 4-bit crusher codebox after the gain.' });
    },
  },
  {
    name: 'slow',
    match: /slow|ゆっくり/i,
    async run(t) {
      await t.call('kit_get_patch', {});
      await t.think();
      const steer = await t.waitForSteer(15000);
      if (t.interrupted) return;
      const hz = steer && /dark|暗/i.test(steer) ? 150 : 700;
      await t.call('kit_apply_ops', { ops: [{ op: 'setValue', node: 'cut1', port: 'hz', value: hz }] });
      await t.call('kit_finish', { summary: steer ? `Took “${steer}” into account: base cutoff ${hz} Hz.` : `Base cutoff ${hz} Hz.` });
    },
  },
  {
    name: 'conflict',
    match: /delay and open/i,
    async run(t) {
      await t.call('kit_apply_ops', { ops: [{ op: 'setValue', node: 'cut1', port: 'hz', value: 1500 }, { op: 'setValue', node: 'gain1', port: 'gain', value: 0.2 }] });
      await t.sleep(Number(process.env.FAKE_CODEX_CONFLICT_MS ?? 1500));
      await t.call('kit_finish', { summary: 'Opened the filter and raised the level.' });
    },
  },
  { name: 'usage', match: /usage limit/i, async run(t) { await t.think(); return { status: 'failed', message: 'You have hit your usage limit.', info: 'usageLimitExceeded' }; } },
  { name: 'unauthorized', match: /unauthori[sz]ed/i, async run() { return { status: 'failed', message: '401 Unauthorized', info: 'unauthorized' }; } },
  {
    name: 'retry',
    match: /flaky network/i,
    async run(t) {
      t.error({ responseStreamDisconnected: { httpStatusCode: null } }, 'Reconnecting... 2/5', true);
      await t.sleep(20);
      await t.say('Recovered.');
    },
  },
  {
    name: 'approval',
    match: /run a shell command/i,
    async run(t) {
      const command = await t.request('item/commandExecution/requestApproval', { kind: 'command', itemId: 'x1', startedAtMs: Date.now(), environmentId: null, command: 'rm -rf /' }) as { decision?: unknown };
      const file = await t.request('item/fileChange/requestApproval', { itemId: 'x2', startedAtMs: Date.now() }) as { decision?: unknown };
      const perms = await t.request('item/permissions/requestApproval', { itemId: 'x3', environmentId: null, startedAtMs: Date.now(), cwd: '/', reason: null, permissions: {} }) as { scope?: unknown };
      const mcp = await t.request('mcpServer/elicitation/request', { serverName: 'x', message: 'x' }) as { action?: unknown };
      const legacy = await t.request('execCommandApproval', { conversationId: t.threadId, callId: 'c', command: ['ls'], cwd: '/' }) as { decision?: unknown };
      const time = await t.request('currentTime/read', {}) as { currentTimeAt?: number };
      const unknown = await t.request('attestation/generate', {});
      await t.say(JSON.stringify({ command: command?.decision, file: file?.decision, perms: perms?.scope, mcp: mcp?.action, legacy: legacy?.decision, time: typeof time?.currentTimeAt, unknown: unknown === undefined ? 'error' : 'answered' }));
    },
  },
  {
    name: 'question',
    match: /ask me with codex/i,
    async run(t) {
      const answer = await t.request('item/tool/requestUserInput', { itemId: 'q1', isBlocking: true, autoResolutionMs: null, questions: [{ id: 'size', header: 'Size', question: 'How big?', isOther: false, isSecret: false, options: [{ label: 'Small', description: '' }, { label: 'Large', description: '' }] }] }) as { answers?: Record<string, { answers: string[] }> } | undefined;
      await t.say(`You chose ${answer?.answers?.size?.answers?.[0] ?? 'nothing'}.`);
    },
  },
  {
    name: 'question-auto',
    match: /optional question/i,
    async run(t) {
      const answer = await t.request('item/tool/requestUserInput', { itemId: 'q2', isBlocking: false, autoResolutionMs: 50, questions: [{ id: 'x', header: 'X', question: 'Anything?', isOther: true, isSecret: false, options: null }] }) as { answers?: Record<string, unknown> } | undefined;
      await t.say(`auto: ${JSON.stringify(answer?.answers ?? null)}`);
    },
  },
  { name: 'crash', match: /crash now/i, async run(t) { await t.call('kit_get_patch', {}); t.crash(9); } },
  {
    name: 'garbage',
    match: /garbage/i,
    async run(t) {
      t.raw('not json at all\n');
      t.raw('{"broken":\n');
      t.raw('\n');
      await t.say('Still here.');
    },
  },
  {
    name: 'unknown-tool',
    match: /unknown tool/i,
    async run(t) {
      const r = await t.call('kit_rm_rf', {});
      await t.say(r.success ? 'ran it' : `refused: ${r.text.slice(0, 80)}`);
    },
  },
  {
    name: 'hang-tool',
    match: /hang forever/i,
    async run(t) { await t.call('kit_get_patch', {}); await t.sleep(60000); },
  },
  {
    name: 'rate',
    match: /rate limits/i,
    async run(t) { t.rateLimits(87, 1_900_000_000); await t.say('ok'); },
  },
  // ---- U8: members, pictures, token counts ------------------------------------------------
  {
    name: 'tokens',
    match: /count my tokens/i,
    async run(t) { t.usage(1200, 300, 900, 120); await t.say('counted'); t.usage(400, 100, 350, 20); },
  },
  {
    name: 'pictures',
    match: /look at my sketch/i,
    async run(t) {
      await t.say(`pictures: ${t.images.length}`);
      const more = await t.waitForSteer(3000);
      await t.say(`after "${more ?? ''}": pictures ${t.images.length}`);
    },
  },
  // A team (U8): the lead lands the seam, starts a sound member and a screen member, waits for their reports,
  // looks once and finishes. Each member works in its own scope (an edit outside it is refused).
  {
    name: 'team-lead',
    match: /acid team/i,
    async run(t) {
      await t.think();
      await t.call('kit_get_patch', {});
      const seam = await t.call('kit_apply_ops', { ops: [
        { op: 'addControl', for: { node: 'cut1', port: 'hz' }, label: 'Cutoff', panel: { x: 40, y: 120, w: 96, h: 110 } },
        { op: 'addControl', for: { node: 'filter1', port: 'resonance' }, label: 'Resonance', panel: { x: 160, y: 120, w: 96, h: 110 } },
      ] });
      if (!seam.success) { await t.say(`seam failed: ${seam.text.slice(0, 200)}`); return { status: 'failed', message: 'scenario: seam failed', info: 'other' }; }
      const started = await t.call('kit_delegate', { members: [
        { name: 'Sound', goal: 'A squelchy acid bass', why: 'The person wants it to bite', scope: { sound: 'all' }, done: 'kit_listen says it is not silent' },
        { name: 'Screen', goal: 'A black screen with neon green type', why: 'Neon, 303 style', scope: { screen: 'all' }, done: 'kit_look finds nothing serious' },
      ] });
      if (!started.success) { await t.say(`delegate failed: ${started.text.slice(0, 300)}`); return { status: 'failed', message: 'scenario: delegate failed', info: 'other' }; }
      t.usage(6000, 400, 2000);
      let waited = await t.call('kit_wait', {});
      for (let i = 0; i < 6 && /Still working/.test(waited.text); i++) waited = await t.call('kit_wait', {});
      await t.call('kit_look', {});
      await t.call('kit_finish', { summary: /m1 “Sound” — done[\s\S]*m2 “Screen” — done/.test(waited.text) ? 'アシッドベースとネオンの画面を作りました' : `members did not both finish: ${waited.text.slice(0, 200)}` });
      await t.say('Done.');
    },
  },
  {
    name: 'late-call',
    match: /stop me/i,
    async run(t) {
      await t.call('kit_get_patch', {});
      for (let i = 0; i < 100 && !t.interrupted; i++) await t.sleep(20);
      // A tool call that races the interrupt: den-kit must refuse it.
      const r = await t.call('kit_apply_ops', { ops: [{ op: 'setValue', node: 'cut1', port: 'hz', value: 50 }] });
      void r;
    },
  },
];

export default scenarios;
