// An LLM request with members (U8), in the browser against a scripted bridge:
// the lead lands the seam and starts members; each member is told its part and
// what den-kit knows; edits land in one request (one ⌘Z for all) and stay in
// each AI's scope; the lead waits for reports, gets another turn if it ended
// its own early; Esc stops everyone, a lane's × one member; members off.
import { beforeEach, describe, expect, it } from 'vitest';
import { FastPath, type Outcome } from '../../../src/ai/fast-path.ts';
import { LlmController, type LlmTransport } from '../../../src/ai/llm.ts';
import type { WorkspaceDeps } from '../../../src/ai/llm-workspace.ts';
import { analyse } from '../../../src/core/analysis.ts';
import { clone } from '../../../src/core/schema.ts';
import type { KitSession } from '../../../src/editor/session.ts';
import { testSession, stubBridge } from '../../helpers/fake-bridge.ts';
import { FakeLlmTransport } from '../../helpers/fake-llm-transport.ts';
import { scriptedAnswerer } from '../../fakes/jev/scripted.ts';

let session: KitSession, fast: FastPath, t: FakeLlmTransport, llm: LlmController;
function setup(options: { stopGraceMs?: number; members?: 'auto' | 'off' } = {}) {
  session = testSession();
  session.loadStarter('bass');
  session.bridge = stubBridge(scriptedAnswerer({}), 'off').bridge;
  fast = new FastPath(session);
  t = new FakeLlmTransport();
  llm = new LlmController(session, fast, t as unknown as LlmTransport, {
    stopGraceMs: options.stopGraceMs ?? 200,
    storage: null,
    deps: {
      compile: async () => ({ ok: true, ms: 300 }) as Awaited<ReturnType<WorkspaceDeps['compile']>>,
      render: async () => { const s = new Float32Array(9600).map((_, i) => Math.sin(i / 9) * 0.3); return { report: analyse([s, s], 48000), renderMs: 5 }; },
      look: async () => ({ issues: [], png: null, width: 640, height: 360, ms: 1 }),
    },
  });
  if (options.members) llm.settings.members = options.members;
  session.llm = llm;
}
beforeEach(() => setup());
const line = (id: string) => fast.history.value.find(o => o.id === id)!;
const snapshot = () => { const d = clone(session.doc.value); const sort = <T,>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))); return JSON.stringify({ ...d, revision: 0, nodes: sort(d.nodes), edges: sort(d.edges) }); };
const SEAM = { ops: [
  { op: 'addControl', for: { node: 'cut1', port: 'hz' }, label: 'Cutoff', panel: { x: 24, y: 96, w: 84, h: 96 } },
  { op: 'addControl', for: { node: 'filter1', port: 'resonance' }, label: 'Resonance', panel: { x: 130, y: 96, w: 84, h: 96 } },
] };
const MEMBERS = { members: [
  { name: 'Sound', goal: 'A squelchy acid bass', why: 'The person wants it to bite', scope: { sound: 'all' }, done: 'kit_listen sounds right' },
  { name: 'Screen', goal: 'A black screen with neon green type', scope: { screen: 'all' }, done: 'kit_look finds nothing to fix', context: 'bare' },
] };
/** A lead that landed the seam and started two members. */
async function team(text = 'make an acid bass with a neon screen') {
  const o = llm.run(text);
  t.event(o.id, { kind: 'thread', thread: 'th-lead', fresh: false });
  expect((await t.call(o.id, 'l1', 'kit_apply_ops', SEAM)).success).toBe(true);
  const started = await t.call(o.id, 'l2', 'kit_delegate', MEMBERS);
  expect(started.success).toBe(true);
  return { o, m1: `${o.id}~m1`, m2: `${o.id}~m2`, started };
}

describe('a lead starts members', () => {
  it('each member gets its own conversation, the member rules and tools, its part and what den-kit knows', async () => {
    const { o, m1, m2, started } = await team();
    expect(started.text).toMatch(/^Started: m1 “Sound” \(the sound \(the whole patch\); context brief\); m2 “Screen” \(the plugin screen .*; context bare\)/);
    const lead = t.last('llm.start', o.id)!;
    expect(lead.role).toBe('lead');
    expect(String(lead.instructions)).toMatch(/Working with members \(you lead this request\)/);
    const s1 = t.last('llm.start', m1)!, s2 = t.last('llm.start', m2)!;
    expect(s1).toMatchObject({ role: 'member', thread: undefined });
    expect(String(s1.instructions)).toMatch(/You are a member/);
    expect(String(s1.instructions)).not.toMatch(/Working with members/);
    const text1 = String(s1.text);
    expect(text1).toMatch(/^\[den-kit\] You are a member of a team/);
    expect(text1).toContain('Your name: Sound (m1)');
    expect(text1).toContain('Why (what the person cares about): The person wants it to bite');
    expect(text1).toContain('Your scope (you may change only this): the sound (the whole patch)');
    expect(text1).toContain('Working at the same time: m2 “Screen” (the plugin screen');
    expect(String(s2.text)).toContain('Working at the same time: m1 “Sound” (the sound (the whole patch))');
    expect(text1).toContain('[den-kit] The person\'s request, in their own words: “make an acid bass with a neon screen”');
    expect(text1).toMatch(/Names everyone keeps:\nControls: knob1 Knob “Cutoff”[^\n]*→ cut1\.hz/);
    expect(text1).toContain('The patch now:');
    // "bare": its part and scope, not the conversation.
    const text2 = String(s2.text);
    expect(text2).not.toContain('in their own words');
    expect(text2).toContain('The plugin screen now:');
    // Lanes under the request.
    expect(line(o.id).agents!.map(a => [a.id, a.name, a.status, a.scope])).toEqual([['m1', 'Sound', 'working', 'sound'], ['m2', 'Screen', 'working', 'screen']]);
    expect(line(o.id).steps).toContain('members: Sound, Screen');
  });

  it('edits land in the one request and stay in each scope; one ⌘Z takes back all of it', async () => {
    const before = snapshot();
    const undoSteps = session.history.size;
    const { o, m1, m2 } = await team();
    const sound = await t.call(m1, 'a1', 'kit_apply_ops', { ops: [{ op: 'setValue', node: 'filter1', port: 'resonance', value: 3 }, { op: 'addNode', node: { id: 'lfo2', type: 'den.lfo' } }, { op: 'connect', from: { node: 'lfo2', port: 'out' }, to: { node: 'cut1', port: 'octaves' }, replace: true }] });
    expect(sound.success).toBe(true);
    const screen = await t.call(m2, 'b1', 'kit_apply_ops', { ops: [{ op: 'setLook', look: { tokens: { bg: '#000000', accent: '#39ff14' } } }, { op: 'addElement', element: { kind: 'text', text: 'ACID', rect: { x: 24, y: 16, w: 300, h: 48 } } }] });
    expect(screen.success).toBe(true);
    // Out of scope: nothing of it lands, and it says why.
    const wrong = await t.call(m2, 'b2', 'kit_apply_ops', { ops: [{ op: 'setValue', node: 'filter1', port: 'resonance', value: 1 }] });
    expect(wrong).toMatchObject({ success: false });
    expect(wrong.text).toMatch(/outside your scope: filter1 is outside your scope\. Your scope: the plugin screen/);
    expect(session.doc.value.nodes.filter1!.values.resonance).toBe(3);
    // The lead may not change what a member holds meanwhile.
    const lead = await t.call(o.id, 'l3', 'kit_apply_ops', { ops: [{ op: 'setValue', node: 'aenv1', port: 'release', value: 1 }] });
    expect(lead.text).toMatch(/It touches what a member holds: aenv1 is held by m1 “Sound” while it works/);
    // …nor finish before they report.
    expect((await t.call(o.id, 'l4', 'kit_finish', { summary: 'x' })).text).toMatch(/Members are still working \(m1 “Sound”, m2 “Screen”\)/);
    // Members finish with reports; the lead waits and reads them.
    await t.call(m1, 'a2', 'kit_finish', { summary: 'Squelchy bass', names: ['lfo2 wobbles cut1'], needs: ['a Drive knob on the screen'] });
    t.done(m1);
    await t.call(m2, 'b3', 'kit_look', {});
    await t.call(m2, 'b4', 'kit_finish', { summary: 'Neon screen' });
    t.done(m2);
    const waited = await t.call(o.id, 'l5', 'kit_wait', {});
    expect(waited.text).toMatch(/m1 “Sound” — done in [\d.]+ s\. 1 edit landed\.\n {2}Summary: Squelchy bass\n {2}Names: lfo2 wobbles cut1\n {2}Needs: a Drive knob on the screen/);
    expect(waited.text).toMatch(/m2 “Screen” — done in [\d.]+ s\. 1 edit landed, 1 refused \(outside its scope\)/);
    expect(waited.text).toMatch(/They have finished/);
    await t.call(o.id, 'l6', 'kit_look', {});
    expect((await t.call(o.id, 'l7', 'kit_finish', { summary: 'Acid bass with a neon screen' })).success).toBe(true);
    t.done(o.id);
    expect(line(o.id)).toMatchObject({ status: 'applied', label: 'Acid bass with a neon screen', live: false });
    expect(line(o.id).agents!.map(a => a.status)).toEqual(['done', 'done']);
    expect(session.history.size).toBe(undoSteps + 1); // the lead's and both members' edits: one undo step
    expect(llm.busy.value).toBe(false);
    session.undo();
    expect(snapshot()).toBe(before);
    // Telemetry: one record per member, and the request with its team.
    expect(t.telemetryRecords.filter(r => r.kind === 'llm-member').map(r => [r.member, r.status, r.landed, r.refused])).toEqual([['m1', 'done', 1, 0], ['m2', 'done', 1, 1]]);
    expect(t.telemetryRecords.find(r => r.kind === 'llm')).toMatchObject({ members: 2, role: 'lead', status: 'applied' });
    // Member conversations are let go.
    expect(t.all('llm.forget')).toEqual([]); // members never reported a thread here
  });

  it('refuses overlapping scopes, too many members, unknown ids and an empty brief', async () => {
    const o = llm.run('do two things');
    const overlap = await t.call(o.id, 'c1', 'kit_delegate', { members: [{ name: 'A', goal: 'x', scope: { sound: 'all' }, done: 'y' }, { name: 'B', goal: 'x', scope: { sound: { nodes: ['osc1'] } }, done: 'y' }] });
    expect(overlap.text).toMatch(/The scopes of “A” and “B” overlap \(both hold the sound\)\. Give each its own part; nothing was started/);
    expect(t.all('llm.start')).toHaveLength(1);
    const many = await t.call(o.id, 'c2', 'kit_delegate', { members: [1, 2, 3, 4].map(i => ({ name: `M${i}`, goal: 'x', scope: { screen: { area: { x: i * 100, y: 0, w: 50, h: 50 } } }, done: 'y' })) });
    expect(many.text).toMatch(/At most 3 members/);
    expect((await t.call(o.id, 'c3', 'kit_delegate', { members: [{ name: 'A', goal: 'x', scope: { sound: { nodes: ['nope1'] } }, done: 'y' }] })).text).toMatch(/do not exist: nope1/);
    expect((await t.call(o.id, 'c4', 'kit_delegate', { members: [{ name: 'A', scope: { sound: 'all' } }] })).text).toMatch(/needs a name, a goal and when it is done/);
    // A member started now is checked against the ones still working.
    expect((await t.call(o.id, 'c5', 'kit_delegate', { members: [{ name: 'A', goal: 'x', scope: { sound: 'all' }, done: 'y' }] })).success).toBe(true);
    expect((await t.call(o.id, 'c6', 'kit_delegate', { members: [{ name: 'B', goal: 'x', scope: { sound: { nodes: ['osc1'] } }, done: 'y' }] })).text).toMatch(/m1 “A” and “B” overlap/);
  });

  it('a member cannot start members, use the screen project it does not hold, or call the lead\'s tools', async () => {
    const { m1 } = await team();
    expect((await t.call(m1, 'x1', 'kit_delegate', MEMBERS)).text).toMatch(/Members cannot start or manage members/);
    expect((await t.call(m1, 'x2', 'kit_bash', { command: 'ls' })).text).toMatch(/The screen project is not in your scope/);
    expect((await t.call(m1, 'x3', 'kit_wait', {})).text).toMatch(/Members cannot/);
  });
});

describe('the lead and its members over time', () => {
  it('a lead that ends its turn while members work gets another turn with their reports and the person\'s additions', async () => {
    const { o, m1, m2 } = await team();
    t.event(o.id, { kind: 'message', text: 'They are on it.' });
    t.done(o.id); // the lead's turn ends early
    expect(line(o.id)).toMatchObject({ live: true, activity: 'waiting for Sound, Screen…' });
    expect(llm.busy.value).toBe(true);
    // The person adds something meanwhile: it waits for the lead's next turn.
    const added = llm.run('and make it louder');
    expect(added).toMatchObject({ status: 'merged' });
    await t.call(m1, 'a1', 'kit_finish', { summary: 'Bass done' });
    t.done(m1);
    expect(t.all('llm.start').filter(s => String(s.id).includes('~i'))).toHaveLength(0);
    t.done(m2, 'failed', { message: 'You have hit your usage limit.' });
    const next = t.last('llm.start', `${o.id}~i1`)!;
    expect(next).toMatchObject({ thread: 'th-lead', role: 'lead' });
    expect(String(next.text)).toMatch(/Your members have finished[\s\S]*m1 “Sound” — done[\s\S]*Summary: Bass done[\s\S]*m2 “Screen” — failed after [\d.]+ s: You have hit your usage limit[\s\S]*The person added meanwhile: “and make it louder”/);
    // The next turn runs on the same request: its edits are the same undo step.
    expect((await t.call(`${o.id}~i1`, 'l9', 'kit_apply_ops', { ops: [{ op: 'setValue', node: 'gain1', port: 'gain', value: 0.9 }] })).success).toBe(true);
    await t.call(`${o.id}~i1`, 'l10', 'kit_look', {});
    expect((await t.call(`${o.id}~i1`, 'l11', 'kit_finish', { summary: 'Done, louder' })).success).toBe(true);
    t.done(`${o.id}~i1`);
    expect(line(o.id)).toMatchObject({ status: 'applied', label: 'Done, louder', live: false });
    expect(line(o.id).agents!.map(a => a.status)).toEqual(['done', 'failed']);
  });

  it('kit_wait returns after its timeout with progress, and at once when the person adds something', async () => {
    const { o, m1 } = await team();
    await t.call(m1, 'a1', 'kit_apply_ops', { ops: [{ op: 'setValue', node: 'filter1', port: 'resonance', value: 2 }] });
    const waiting = t.pending(o.id, 'w1', 'kit_wait', { timeout_s: 60 });
    await new Promise(r => setTimeout(r, 20));
    llm.run('also brighter');
    const woke = await waiting;
    expect(woke.text).toMatch(/^The person added something to the request \(you will see it next\)\. m1 “Sound” — still working/);
    expect(t.last('llm.steer')).toMatchObject({ target: o.id });
    expect(woke.text).toMatch(/Still working: m1, m2/);
  });

  it('Esc stops everyone; what landed stays and ⌘Z takes it back', async () => {
    const { o, m1, m2 } = await team();
    await t.call(m1, 'a1', 'kit_apply_ops', { ops: [{ op: 'setValue', node: 'filter1', port: 'resonance', value: 2 }] });
    expect(llm.stop()).toBe(true);
    expect(t.all('llm.stop').map(s => s.id).sort()).toEqual([o.id, m1, m2].sort());
    t.done(m1, 'interrupted'); t.done(m2, 'interrupted'); t.done(o.id, 'interrupted');
    expect(line(o.id)).toMatchObject({ status: 'stopped', live: false, note: 'What it already changed stays; ⌘Z takes it back.' });
    expect(line(o.id).agents!.map(a => a.status)).toEqual(['stopped', 'stopped']);
    expect(llm.busy.value).toBe(false);
  });

  it('the person stops one member from its lane; the lead hears that the person stopped it', async () => {
    const { o, m2 } = await team();
    expect(llm.stopMember('m2')).toBe(true);
    expect(t.last('llm.stop')).toMatchObject({ id: m2 });
    t.done(m2, 'interrupted');
    const waited = await t.call(o.id, 'w1', 'kit_wait', { members: ['m2'] });
    expect(waited.text).toMatch(/m2 “Screen” — stopped by the person \(do not redo it unless they ask\)/);
    expect(line(o.id).steps).toContain(line(o.id).steps!.find(s => /Screen stopped by you/.test(s)));
  });

  it('the lead adds instructions to a working member, and stops one', async () => {
    const { o, m1 } = await team();
    expect((await t.call(o.id, 'l3', 'kit_tell', { member: 'm1', text: 'Keep the release short.' })).success).toBe(true);
    expect(t.last('llm.steer')).toMatchObject({ target: m1, text: '[den-kit] The lead adds: Keep the release short.' });
    expect((await t.call(o.id, 'l4', 'kit_stop_member', { member: 'm1' })).text).toMatch(/Stopping m1 “Sound”/);
    t.done(m1, 'interrupted');
    expect(line(o.id).agents![0]).toMatchObject({ id: 'm1', status: 'stopped' });
    expect((await t.call(o.id, 'l5', 'kit_tell', { member: 'm1', text: 'x' })).text).toMatch(/has already finished/);
  });

  it('a member the bridge lost (it restarted) fails; the lead goes on', async () => {
    const { o, m1 } = await team();
    t.emit({ t: 'welcome', running: [o.id, `${o.id}~m2`] });
    expect(line(o.id).agents![0]).toMatchObject({ id: 'm1', status: 'failed', message: 'The AI bridge restarted and lost this member.' });
    expect(llm.busy.value).toBe(true);
    void m1;
  });

  it('token counts show per member and add up on the request', async () => {
    const { o, m1, m2 } = await team();
    t.usage(m1, 12000, 800, 9000);
    expect(line(o.id).agents![0]!.tokens).toBe(12800);
    t.usage(m2, 3000, 200);
    t.usage(o.id, 5000, 500);
    t.done(m1); t.done(m2); t.done(o.id);
    expect(line(o.id).tokens).toBe(12800 + 3200 + 5500);
  });
});

describe('how much a member is told', () => {
  it('"full": it starts from a copy of the lead\'s conversation, or den-kit\'s account of it', async () => {
    const o = llm.run('a bass');
    t.event(o.id, { kind: 'thread', thread: 'th-lead', fresh: false });
    await t.call(o.id, 'c1', 'kit_delegate', { members: [{ name: 'Sound', goal: 'x', scope: { sound: 'all' }, done: 'y', context: 'full' }] });
    const start = t.last('llm.start', `${o.id}~m1`)!;
    expect(start.fork).toMatchObject({ thread: 'th-lead', fallback: expect.stringMatching(/^\[den-kit\] The whole conversation so far/) });
  });
  it('a fixed setting overrides what the lead chose', async () => {
    llm.settings.memberContext = 'bare';
    const o = llm.run('a bass');
    await t.call(o.id, 'c1', 'kit_delegate', { members: [{ name: 'Sound', goal: 'x', scope: { sound: 'all' }, done: 'y', context: 'full' }] });
    const start = t.last('llm.start', `${o.id}~m1`)!;
    expect(start.fork).toBeUndefined();
    expect(String(start.text)).not.toContain('in their own words');
  });
});

describe('members off', () => {
  it('the request runs alone: no lead tools, and kit_delegate says so', async () => {
    setup({ members: 'off' });
    const o = llm.run('a bass with a screen');
    const start = t.last('llm.start', o.id)!;
    expect(start.role).toBe('solo');
    expect(String(start.instructions)).not.toMatch(/Working with members/);
    expect((await t.call(o.id, 'c1', 'kit_delegate', MEMBERS)).text).toMatch(/Members are off for this request/);
  });
  it('turning members on or off starts a new conversation (its tools change)', async () => {
    const o = llm.run('explain');
    t.event(o.id, { kind: 'thread', thread: 'th1', fresh: false });
    t.done(o.id);
    llm.settings.members = 'off';
    await Promise.resolve();
    expect(t.last('llm.forget')).toMatchObject({ thread: 'th1' });
    const next: Outcome = llm.run('again');
    expect(t.last('llm.start', next.id)!.thread).toBeUndefined();
  });
});
