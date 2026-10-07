// The conversation about the patch: one per opened patch, shared by the fast
// path and the LLM; kept with the autosave; "もっと" / "戻して" follow-ups; what
// the person attached (the selection) aims the request and reaches the LLM.
import { beforeEach, describe, expect, it } from 'vitest';
import { shallowRef } from 'vue';
import { FastPath, type Outcome } from '../../../src/ai/fast-path.ts';
import { LlmController, type LlmTransport } from '../../../src/ai/llm.ts';
import type { LlmInbound } from '../../../src/ai/bridge-client.ts';
import type { BridgeStatus, LlmEvent } from '../../../src/ai/protocol.ts';
import { attachmentsOf, describeAttachments } from '../../../src/ai/attachments.ts';
import { followUp, handEditsSince, lineForAi, readSavedLines, savedLine } from '../../../src/ai/conversation.ts';
import { KitSession, type StorageLike } from '../../../src/editor/session.ts';
import { catalog } from '../../../src/blocks/index.ts';
import { applyIntents } from '../../../src/core/ops.ts';
import { starter } from '../../../src/core/starters.ts';
import type { Transaction } from '../../../src/core/history.ts';
import { stubBridge } from '../../helpers/fake-bridge.ts';
import { scriptedAnswerer } from '../../fakes/jev/scripted.ts';

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  failWrites = false;
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.failWrites) throw new Error('QuotaExceededError'); this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}
const makeSession = (storage: StorageLike | null = null) => new KitSession({
  storage,
  createWorker: () => ({ postMessage() {}, terminate() {}, onmessage: null, onerror: null, onmessageerror: null }) as never,
  engine: { setParam() {}, unload() {}, running: false } as never,
});

class FakeTransport {
  online = true;
  readonly status = shallowRef<BridgeStatus>({ jev: { state: 'off' }, codex: { state: 'ok', images: false, model: 'm' } });
  sent: Array<Record<string, unknown>> = [];
  private listeners = new Set<(m: LlmInbound) => void>();
  get codexReady() { return this.online; }
  onLlm(l: (m: LlmInbound) => void) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  llmStart(id: string, text: string, instructions: string, thread?: string) { this.sent.push({ t: 'llm.start', id, text, instructions, thread }); return true; }
  llmSteer(id: string, target: string, text: string) { this.sent.push({ t: 'llm.steer', id, target, text }); return true; }
  llmStop(id: string) { this.sent.push({ t: 'llm.stop', id }); return true; }
  llmAnswer() { return true; }
  llmForget(thread: string) { this.sent.push({ t: 'llm.forget', thread }); return true; }
  toolResult() { return true; }
  telemetry() {}
  event(id: string, event: LlmEvent) { for (const l of this.listeners) l({ t: 'llm.event', id, event }); }
  done(id: string) { this.event(id, { kind: 'done', status: 'completed', ms: 1 }); }
  last(t: string) { return [...this.sent].reverse().find(m => m.t === t); }
}

describe('the words of a follow-up', () => {
  it.each([
    ['もっと', { kind: 'more', prefix: 'もっと' }], ['もう少し', { kind: 'more', prefix: 'もう少し' }], ['もうちょっと！', { kind: 'more', prefix: 'もう少し' }],
    ['さらに', { kind: 'more', prefix: 'もっと' }], ['more', { kind: 'more', prefix: '' }], ['a bit more please', { kind: 'more', prefix: '' }], ['again', { kind: 'more', prefix: '' }],
    ['戻して', { kind: 'undo' }], ['やっぱりやめて', { kind: 'undo' }], ['undo that', { kind: 'undo' }], ['take it back', { kind: 'undo' }],
  ])('%s', (text, expected) => { expect(followUp(text)).toEqual(expected); });
  it('a request with more words is not a follow-up', () => {
    for (const text of ['もっと明るく', 'more reverb', '戻してから明るく', 'undo the reverb and add delay', '']) expect(followUp(text)).toBeNull();
  });
});

describe('what the LLM is told about the conversation', () => {
  it('one line per request, with the result, what it was about, and an undo', () => {
    expect(lineForAi({ id: 'a', text: '明るく', status: 'applied', route: 'lexicon', ms: 3, label: 'brightness up ×medium → filter1', undone: true, attached: [{ id: 'filter1', kind: 'module', label: 'Filter' }] }))
      .toBe('- fast path: “明るく” [about: filter1] → brightness up ×medium → filter1 (then undone with ⌘Z)');
    expect(lineForAi({ id: 'b', text: 'explain', status: 'reply', route: 'llm', ms: 9, reply: 'An oscillator\ngoes into a filter.' })).toBe('- LLM request: “explain” → answered: An oscillator goes into a filter.');
    expect(lineForAi({ id: 'c', text: '???', status: 'nothing', route: 'none', ms: 1, message: 'Not sure what to change.' })).toBe('- fast path: “???” → nothing changed (Not sure what to change.)');
  });
  it('hand edits since a moment: the person\'s own, counted; loads and AI edits are not theirs', () => {
    const tx = (label: string, at: number, author: Transaction['author'] = { kind: 'human' }, replaced = false): Transaction => ({ id: label + at, author, label, ops: [], at, baseRevision: 0, replaced });
    const entries = [tx('Move', 5), tx('Panel Cutoff', 20), tx('Panel Cutoff', 30), tx('AI: brighter', 40, { kind: 'ai-fast', handler: 'lexicon' }), tx('Start from Nebula', 50, { kind: 'human' }, true), tx('Connect lfo1 → filter1', 60)];
    expect(handEditsSince(entries, 10)).toBe('Panel Cutoff ×2, Connect lfo1 → filter1');
    expect(handEditsSince(entries, 60)).toBeNull();
    expect(handEditsSince(Array.from({ length: 14 }, (_, i) => tx(`Edit ${i}`, 100 + i)), 0, 3)).toBe('Edit 0, Edit 1, Edit 2 and 11 more');
  });
});

describe('saving the conversation', () => {
  it('a line saved while it ran comes back stopped; malformed lines are left out', () => {
    const running: Outcome = { id: 'r1', text: 'wobble it', status: 'thinking', route: 'llm', ms: 900, live: true, activity: 'editing…', steps: ['+ lfo2'] };
    const saved = savedLine(running);
    expect(saved).toMatchObject({ status: 'stopped', message: 'Interrupted (the page was reloaded).' });
    expect(saved.live).toBeUndefined();
    expect(saved.activity).toBeUndefined();
    const read = readSavedLines([saved, null, 42, { id: 'x' }, { id: 'y', text: 'hi', status: 'exploded', route: 'llm' }, { id: 'z', text: 'ok', status: 'applied', route: 'lexicon', ms: 'NaN', label: 7, attached: [{ id: 'f', label: 'F', kind: 'module' }, { nope: 1 }] }]);
    expect(read.map(l => l.id)).toEqual(['r1', 'z']);
    expect(read[1]).toMatchObject({ ms: 0, attached: [{ id: 'f', label: 'F' }] });
    expect(read[1]!.label).toBeUndefined();
  });

  it('after a reload the conversation about the same patch goes on; another patch does not get it', async () => {
    const storage = new MemoryStorage();
    const first = makeSession(storage);
    first.restore('bass');
    const fast1 = new FastPath(first);
    await fast1.run('リリース長く');
    fast1.persist();
    first.saveNow();
    const conversation = first.conversation.value;
    // Reload: the same autosave, the same conversation, the same lines.
    const second = makeSession(storage);
    expect(second.restore('bass')).toBe(true);
    expect(second.conversation.value).toBe(conversation);
    const fast2 = new FastPath(second);
    expect(fast2.history.value.map(o => o.text)).toEqual(['リリース長く']);
    // A conversation saved for another patch is not this one's.
    storage.setItem('den-kit:conversation', JSON.stringify({ id: conversation, docId: 'someone-else', lines: [{ id: 'q', text: 'not mine', status: 'applied', route: 'lexicon', ms: 1 }] }));
    const third = makeSession(storage);
    third.restore('bass');
    expect(third.conversation.value).not.toBe(conversation);
    expect(new FastPath(third).history.value).toEqual([]);
  });

  it('broken or full storage loses the conversation, never the patch', async () => {
    const storage = new MemoryStorage();
    storage.setItem('den-kit:conversation', '{not json');
    const s = makeSession(storage);
    s.restore('bass');
    const fast = new FastPath(s);
    expect(fast.history.value).toEqual([]);
    storage.failWrites = true;
    const o = await fast.run('リリース長く');
    expect(o.status).toBe('applied');
    expect(() => fast.persist()).not.toThrow();
  });
});

describe('one conversation per opened patch', () => {
  let session: KitSession, fast: FastPath;
  beforeEach(() => {
    session = makeSession();
    session.loadStarter('bass');
    session.bridge = stubBridge(scriptedAnswerer({}), 'off').bridge;
    fast = new FastPath(session);
  });

  it('opening another patch folds the lines away as earlier; what the AI itself puts in place stays in the conversation', async () => {
    await fast.run('リリース長く');
    const conversation = session.conversation.value;
    await fast.run('パッド作って'); // a template replaces the patch, asked for in this conversation
    expect(session.conversation.value).toBe(conversation);
    expect(fast.history.value.map(o => o.text)).toEqual(['リリース長く', 'パッド作って']);
    session.loadStarter('bass'); // the person opens something else
    expect(session.conversation.value).not.toBe(conversation);
    expect(fast.history.value).toEqual([]);
    expect(fast.earlier.value.map(o => o.text)).toEqual(['リリース長く', 'パッド作って']);
  });

  it('"もっと" does the last fast change again; "もう少し" a little; it says what it repeated', async () => {
    const r0 = session.doc.value.nodes.aenv1!.values.release as number;
    await fast.run('リリース長く');
    const r1 = session.doc.value.nodes.aenv1!.values.release as number;
    const more = await fast.run('もっと');
    expect(more).toMatchObject({ status: 'applied', repeats: 'リリース長く' });
    const r2 = session.doc.value.nodes.aenv1!.values.release as number;
    expect(r1).toBeGreaterThan(r0);
    expect(r2).toBeGreaterThan(r1);
    const little = await fast.run('もう少し');
    expect(little).toMatchObject({ status: 'applied', repeats: 'リリース長く' });
    const r3 = session.doc.value.nodes.aenv1!.values.release as number;
    expect(r3).toBeGreaterThan(r2);
    expect(r3 / r2).toBeLessThan(r2 / r1); // "a little" is a smaller step (times are scaled, not added)
    // Each is its own undo step.
    session.undo();
    expect(session.doc.value.nodes.aenv1!.values.release).toBe(r2);
  });

  it('"もっと" with nothing to repeat is an ordinary request (it is not intercepted)', async () => {
    const o = await fast.run('もっと');
    expect(o.repeats).toBeUndefined();
    expect(o.status).not.toBe('applied');
  });

  it('"戻して" takes the last AI change back; the person\'s own edit is theirs to undo; nothing to undo is said', async () => {
    const opened = await fast.run('戻して'); // the last change is opening the starter: that was the person
    expect(opened).toMatchObject({ status: 'nothing', message: expect.stringMatching(/your own \(Load bass\)/) });
    session.history.clear();
    const nothing = await fast.run('戻して');
    expect(nothing).toMatchObject({ status: 'nothing', message: expect.stringMatching(/nothing to take back/) });
    const before = JSON.stringify(session.doc.value.nodes);
    await fast.run('リリース長く');
    const back = await fast.run('戻して');
    expect(back).toMatchObject({ status: 'applied', label: expect.stringMatching(/^took back: /) });
    expect(JSON.stringify(session.doc.value.nodes)).toBe(before);
    expect(fast.history.value.find(o => o.text === 'リリース長く')!.undone).toBe(true);
    session.commit([{ op: 'setValue', node: 'gain1', port: 'gain', value: 0.3 }], { label: 'Set gain' });
    const mine = await fast.run('undo');
    expect(mine).toMatchObject({ status: 'nothing', message: expect.stringMatching(/your own \(Set gain\); ⌘Z/) });
    expect(session.doc.value.nodes.gain1!.values.gain).toBe(0.3);
  });

  it('the request aims at what is attached, not at whatever else is selected or plausible', async () => {
    const doc = applyIntents(starter('bass', catalog), [
      { op: 'addNode', node: { id: 'filter9', type: 'den.filter', values: { cutoff: 500 } } },
      { op: 'connect', from: { node: 'filter1', port: 'out' }, to: { node: 'filter9', port: 'input' } },
    ], catalog).doc;
    session.replace(doc, 'two filters');
    session.select(['filter1']); // selected, but left out of the request
    const attached = attachmentsOf(session.doc.value, catalog, ['filter9']);
    const cut1 = session.doc.value.nodes.cut1!.values.hz;
    const o = await fast.run('明るく', { attached });
    expect(o.status).toBe('applied');
    expect(o.attached).toEqual([{ id: 'filter9', kind: 'module', label: 'Lowpass' }]);
    expect(session.doc.value.nodes.filter9!.values.cutoff).toBeGreaterThan(500);
    expect(session.doc.value.nodes.cut1!.values.hz).toBe(cut1);
  });
});

describe('attachments', () => {
  it('modules, controls, things on the plugin and cables, by id; unknown ids are left out', () => {
    let doc = starter('pad', catalog);
    doc = applyIntents(doc, [
      { op: 'setLabel', node: 'filter1', label: 'Tone' },
      { op: 'addNode', node: { id: 'knob1', type: 'ui.knob', label: 'Cutoff' } },
      { op: 'addElement', element: { id: 'title1', kind: 'text', text: 'A very long title for the plugin', rect: { x: 0, y: 0, w: 200, h: 30 } } },
    ], catalog).doc;
    const knob = doc.nodes.knob1!;
    const edge = Object.values(doc.edges).find(e => e.from.node !== 'filter1' && e.to.node !== 'filter1')!;
    const list = attachmentsOf(doc, catalog, ['filter1', knob.id, 'title1', 'ghost'], [edge.id, 'e999']);
    expect(list.map(a => [a.id, a.kind])).toEqual([['filter1', 'module'], [knob.id, 'control'], ['title1', 'element'], [edge.id, 'cable']]);
    // A cable that touches an attached module comes with it (a box selection takes those too).
    const touching = Object.values(doc.edges).find(e => e.to.node === 'filter1' || e.from.node === 'filter1')!;
    expect(attachmentsOf(doc, catalog, ['filter1'], [touching.id]).map(a => a.id)).toEqual(['filter1']);
    expect(list[0]!.label).toBe('Lowpass “Tone”');
    expect(list[1]!.label).toBe('Knob “Cutoff”');
    expect(list[2]!.label).toBe('text “A very long title for t…”');
    expect(list[3]!.label).toBe(`${edge.from.node}.${edge.from.port} → ${edge.to.node}.${edge.to.port}`);
    expect(describeAttachments(list)).toMatch(/^filter1 — Lowpass “Tone”; knob1 — Knob “Cutoff” \(a control\); title1 — text “.*” on the plugin screen; e\w+ — cable /);
  });
});

describe('the LLM is told what happened', () => {
  let session: KitSession, fast: FastPath, t: FakeTransport, llm: LlmController;
  beforeEach(() => {
    session = makeSession();
    session.loadStarter('bass');
    session.bridge = stubBridge(scriptedAnswerer({}), 'off').bridge;
    fast = new FastPath(session);
    t = new FakeTransport();
    llm = new LlmController(session, fast, t as unknown as LlmTransport);
    session.llm = llm;
  });
  const startText = () => String(t.last('llm.start')!.text);

  it('a new conversation hears what came before; later turns hear only what is new, and the person\'s own edits', async () => {
    await fast.run('リリース長く');
    const first = llm.run('now add a wobble');
    expect(startText()).toMatch(/Earlier in this conversation[^\n]*:\n- fast path: “リリース長く” → [^\n]+\n/);
    t.event(first.id, { kind: 'thread', thread: 'th1', fresh: false });
    t.done(first.id);
    await new Promise(r => setTimeout(r, 5));
    await fast.run('明るく');
    session.commit([{ op: 'setValue', node: 'gain1', port: 'gain', value: 0.4 }], { label: 'Panel Gain' });
    llm.run('more of that');
    const text = startText();
    expect(t.last('llm.start')!.thread).toBe('th1');
    expect(text).toMatch(/Since your last turn:\n- fast path: “明るく” → /);
    expect(text).not.toMatch(/リリース長く/); // it saw that one already
    expect(text).not.toMatch(/now add a wobble/); // its own request
    expect(text).toMatch(/The person edited by hand since your last turn: Panel Gain\./);
    expect(text.endsWith('\n\nmore of that')).toBe(true);
  });

  it('what was attached reaches the LLM by id, also when it is added to a running request', () => {
    const attached = attachmentsOf(session.doc.value, catalog, ['filter1']);
    const o = llm.run('this one is too bright', { attached });
    expect(startText()).toMatch(/The person attached \(points at\) these: filter1 — Lowpass\. The request is about them/);
    expect(o.attached).toEqual(attached);
    llm.run('and that cable', { attached: attachmentsOf(session.doc.value, catalog, [], [Object.keys(session.doc.value.edges)[0]!]) });
    expect(String(t.last('llm.steer')!.text)).toMatch(/^\[den-kit\] The user adds, while you work:\n\[den-kit\] The person attached \(points at\) these: e\w+ — cable /);
  });

  it('opening another patch starts a new Codex conversation (and the old lines are not retold)', async () => {
    await fast.run('リリース長く');
    const o = llm.run('explain');
    t.event(o.id, { kind: 'thread', thread: 'th1', fresh: false });
    t.done(o.id);
    session.loadStarter('pad');
    llm.run('explain again');
    expect(t.last('llm.forget')).toEqual({ t: 'llm.forget', thread: 'th1' });
    expect(t.last('llm.start')!.thread).toBeUndefined();
    expect(startText()).not.toMatch(/リリース長く|Earlier in this conversation/);
  });

  it('a template the fast path put in place keeps the Codex conversation', async () => {
    const o = llm.run('explain');
    t.event(o.id, { kind: 'thread', thread: 'th1', fresh: false });
    t.done(o.id);
    await fast.run('パッド作って');
    llm.run('now make it darker');
    expect(t.last('llm.start')!.thread).toBe('th1');
    expect(startText()).toMatch(/Since your last turn:\n- fast path: “パッド作って” → /);
  });
});
