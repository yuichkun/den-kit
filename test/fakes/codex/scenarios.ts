// Scripted turns for the fake app-server, written against the bass starter
// (ids voice1, osc1, fenv1, fdepth1, cut1, filter1, aenv1, vca1, vel1, mix1,
// gain1, out1). They drive den-kit's real tools in the browser or the bridge
// tests; what the tools answer decides what the script does next, like a model.
import type { Scenario } from './fake-codex.ts';

const BOX_BROKEN = "import { defineSubgraph, type Node } from '@unworklet/core';\nexport default defineSubgraph(() => ({ tick(i: { in: Node<'f32'>; bits: Node<'f32'> }) { return { out: i.in.mul( } } }));";
const BOX_FIXED = "import { defineSubgraph, type Node } from '@unworklet/core';\n// a crude bitcrusher: quantise to 2^bits steps\nexport default defineSubgraph(() => ({ tick(i: { in: Node<'f32'>; bits: Node<'f32'> }) { const steps = i.bits.clamp(1, 16).mul(0.6931472).exp(); return { out: i.in.mul(steps).add(0.5).floor().div(steps) }; } }));";

const scenarios: Scenario[] = [
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
    name: 'explain',
    match: /how does|explain|説明|仕組み/i,
    async run(t) {
      const patch = await t.call('kit_get_patch', {});
      await t.say(patch.success ? 'An oscillator goes through a filter whose cutoff follows an envelope, then an amp envelope.' : 'I could not read the patch.');
    },
  },
  {
    name: 'ask',
    match: /different|変えて/i,
    async run(t) {
      await t.call('kit_get_patch', {});
      await t.call('kit_ask', { question: 'Which direction?', options: ['Brighter', 'Darker'] });
      await t.say('Which direction?');
    },
  },
  {
    name: 'brighter-or-darker',
    // den-kit puts a context line before the user's words; the answer is the last line.
    match: /(?:^|\n)(Brighter|Darker)$/,
    async run(t) {
      const word = /(Brighter|Darker)$/.exec(t.text)![1]!;
      const hz = word === 'Brighter' ? 900 : 120;
      await t.call('kit_apply_ops', { ops: [{ op: 'setValue', node: 'cut1', port: 'hz', value: hz }] });
      await t.call('kit_finish', { summary: `${word}: filter base ${hz} Hz.` });
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
      if (!/does not compile|error/i.test(broken.text)) { await t.say('Expected a compile error.'); return { status: 'failed', message: 'scenario: no compile error reported', info: 'other' }; }
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
