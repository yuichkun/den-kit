// Conversation persistence, historical request compatibility and LLM context.
import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { AiRequests, type Outcome } from '../../../src/ai/requests.ts';
import { LlmController, type LlmTransport } from '../../../src/ai/llm.ts';
import { attachmentsOf, describeAttachments } from '../../../src/ai/attachments.ts';
import {
  handEditsSince,
  lineForAi,
  readSavedLines,
  savedLine,
} from '../../../src/ai/conversation.ts';
import { KitSession, type StorageLike } from '../../../src/editor/session.ts';
import { catalog } from '../../../src/sound/blocks/index.ts';
import { applyIntents } from '../../../src/work/ops.ts';
import { starter } from '../../../src/work/starters.ts';
import type { Transaction } from '../../../src/work/history.ts';
import { FakeLlmTransport } from '../../helpers/fake-llm-transport.ts';

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  failWrites = false;
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}
const makeSession = (storage: StorageLike | null = null) =>
  new KitSession({
    storage,
    createWorker: () =>
      ({
        postMessage() {},
        terminate() {},
        onmessage: null,
        onerror: null,
        onmessageerror: null,
      }) as never,
    engine: { setParam() {}, setAssets() {}, unload() {}, running: false } as never,
  });
const historicalLine = (
  id: string,
  text: string,
  route: 'lexicon' | 'jev' | 'jev-target' = 'lexicon',
): Outcome => ({ id, text, status: 'applied', route, ms: 3, label: `Saved edit: ${text}` });

describe('what the LLM is told about the conversation', () => {
  it('one line per request, with the result, what it was about, and an undo', () => {
    expect(
      lineForAi({
        id: 'a',
        text: 'brighter',
        status: 'applied',
        route: 'lexicon',
        ms: 3,
        label: 'brightness up ×medium → filter1',
        undone: true,
        attached: [{ id: 'filter1', kind: 'module', label: 'Filter' }],
      }),
    ).toBe(
      '- earlier request: “brighter” [about: filter1] → brightness up ×medium → filter1 (then undone with ⌘Z)',
    );
    expect(
      lineForAi({
        id: 'b',
        text: 'explain',
        status: 'reply',
        route: 'llm',
        ms: 9,
        reply: 'An oscillator\ngoes into a filter.',
      }),
    ).toBe('- LLM request: “explain” → answered: An oscillator goes into a filter.');
    expect(
      lineForAi({
        id: 'c',
        text: '???',
        status: 'nothing',
        route: 'none',
        ms: 1,
        message: 'Not sure what to change.',
      }),
    ).toBe('- earlier request: “???” → nothing changed (Not sure what to change.)');
  });
  it("hand edits since a moment: the person's own, counted; loads and AI edits are not theirs", () => {
    const tx = (
      label: string,
      at: number,
      author: Transaction['author'] = { kind: 'human' },
      replaced = false,
    ): Transaction => ({ id: label + at, author, label, ops: [], at, baseRevision: 0, replaced });
    const entries = [
      tx('Move', 5),
      tx('Panel Cutoff', 20),
      tx('Panel Cutoff', 30),
      tx('AI: brighter', 40, { kind: 'ai-fast', handler: 'lexicon' }),
      tx('Start from Nebula', 50, { kind: 'human' }, true),
      tx('Connect lfo1 → filter1', 60),
    ];
    expect(handEditsSince(entries, 10)).toBe('Panel Cutoff ×2, Connect lfo1 → filter1');
    expect(handEditsSince(entries, 60)).toBeNull();
    expect(
      handEditsSince(
        Array.from({ length: 14 }, (_, i) => tx(`Edit ${i}`, 100 + i)),
        0,
        3,
      ),
    ).toBe('Edit 0, Edit 1, Edit 2 and 11 more');
  });
});

describe('saving the conversation', () => {
  it('a line saved while it ran comes back stopped; malformed lines are left out', () => {
    const running: Outcome = {
      id: 'r1',
      text: 'wobble it',
      status: 'thinking',
      route: 'llm',
      ms: 900,
      live: true,
      activity: 'editing…',
      steps: ['+ lfo2'],
    };
    const saved = savedLine(running);
    expect(saved).toMatchObject({
      status: 'stopped',
      message: 'Interrupted (the page was reloaded).',
    });
    expect(saved.live).toBeUndefined();
    expect(saved.activity).toBeUndefined();
    const read = readSavedLines([
      saved,
      null,
      42,
      { id: 'x' },
      { id: 'y', text: 'hi', status: 'exploded', route: 'llm' },
      {
        id: 'z',
        text: 'ok',
        status: 'applied',
        route: 'lexicon',
        ms: 'NaN',
        label: 7,
        attached: [{ id: 'f', label: 'F', kind: 'module' }, { nope: 1 }],
      },
    ]);
    expect(read.map(l => l.id)).toEqual(['r1', 'z']);
    expect(read[1]).toMatchObject({ ms: 0, attached: [{ id: 'f', label: 'F' }] });
    expect(read[1]!.label).toBeUndefined();
  });

  it('saved lexicon and Jev lines reload with their patch; another patch does not inherit them', () => {
    const storage = new MemoryStorage();
    const first = makeSession(storage);
    first.restore('bass');
    const requests1 = new AiRequests(first);
    const oldLines = [
      historicalLine('lex', 'longer release'),
      historicalLine('jev', 'open the tone', 'jev'),
      historicalLine('target', 'this filter', 'jev-target'),
    ];
    for (const line of oldLines) requests1.upsert(line);
    requests1.persist();
    first.saveNow();
    const conversation = first.conversation.value;
    const second = makeSession(storage);
    expect(second.restore('bass')).toBe(true);
    expect(second.conversation.value).toBe(conversation);
    expect(new AiRequests(second).history.value).toEqual(oldLines);
    storage.setItem(
      'den-kit:conversation',
      JSON.stringify({ id: conversation, docId: 'someone-else', lines: oldLines }),
    );
    const third = makeSession(storage);
    third.restore('bass');
    expect(third.conversation.value).not.toBe(conversation);
    expect(new AiRequests(third).history.value).toEqual([]);
  });

  it('saving the patch immediately flushes the latest conversation without waiting for debounce', () => {
    const storage = new MemoryStorage();
    const first = makeSession(storage);
    first.restore('bass');
    first.requests = new AiRequests(first);
    const earlier = historicalLine('old', 'longer release');
    first.requests.upsert(earlier);
    const latest = first.requests.run('brighter');
    expect(first.loadConversation()).toBeNull();
    first.saveNow();

    const second = makeSession(storage);
    expect(second.restore('bass')).toBe(true);
    expect(second.conversation.value).toBe(first.conversation.value);
    second.requests = new AiRequests(second);
    expect(second.requests.history.value).toEqual([earlier, savedLine(latest)]);
  });

  it('broken or full storage cannot change the patch or throw when saving a failed request', () => {
    const storage = new MemoryStorage();
    storage.setItem('den-kit:conversation', '{not json');
    const session = makeSession(storage);
    session.restore('bass');
    const requests = new AiRequests(session);
    const before = JSON.stringify(session.doc.value);
    expect(requests.history.value).toEqual([]);
    storage.failWrites = true;
    expect(requests.run('longer release').status).toBe('failed');
    expect(() => requests.persist()).not.toThrow();
    expect(JSON.stringify(session.doc.value)).toBe(before);
  });
});

describe('conversation lifecycle and historical edits', () => {
  let session: KitSession, requests: AiRequests;
  beforeEach(() => {
    session = makeSession();
    session.loadStarter('bass');
    requests = new AiRequests(session);
  });

  it('an AI-authored replacement keeps the conversation; opening a patch folds its lines into earlier', () => {
    requests.upsert(historicalLine('old', 'longer release'));
    const conversation = session.conversation.value;
    session.replace(starter('pad', catalog), 'AI patch', true, { kind: 'ai-llm', take: 'rq-new' });
    requests.upsert({ id: 'rq-new', text: 'build a pad', status: 'applied', route: 'llm', ms: 10 });
    expect(session.conversation.value).toBe(conversation);
    expect(requests.history.value.map(o => o.text)).toEqual(['longer release', 'build a pad']);
    session.loadStarter('bass');
    expect(session.conversation.value).not.toBe(conversation);
    expect(requests.history.value).toEqual([]);
    expect(requests.earlier.value.map(o => o.text)).toEqual(['longer release', 'build a pad']);
  });

  it.each(['lexicon', 'jev'] as const)(
    'undo and redo of a historical %s edit update its conversation line',
    handler => {
      const before = session.doc.value.nodes.gain1!.values.gain;
      expect(
        session.commit([{ op: 'setValue', node: 'gain1', port: 'gain', value: 0.3 }], {
          author: { kind: 'ai-fast', handler },
          label: 'Saved AI edit',
        }).ok,
      ).toBe(true);
      const txId = session.history.peek()!.id;
      requests.upsert({ ...historicalLine('saved', 'make it quieter', handler), txId });
      session.undo();
      expect(session.doc.value.nodes.gain1!.values.gain).toBe(before);
      expect(requests.history.value[0]!.undone).toBe(true);
      expect(requests.outcome.value).toBeNull();
      session.redo();
      expect(session.doc.value.nodes.gain1!.values.gain).toBe(0.3);
      expect(requests.history.value[0]!.undone).toBe(false);
    },
  );
});

describe('attachments', () => {
  it('modules, controls, things on the plugin and cables, by id; unknown ids are left out', () => {
    let doc = starter('pad', catalog);
    doc = applyIntents(
      doc,
      [
        { op: 'setLabel', node: 'filter1', label: 'Tone' },
        { op: 'addNode', node: { id: 'knob1', type: 'ui.knob', label: 'Cutoff' } },
        {
          op: 'addElement',
          element: {
            id: 'title1',
            kind: 'text',
            text: 'A very long title for the plugin',
            rect: { x: 0, y: 0, w: 200, h: 30 },
          },
        },
      ],
      catalog,
    ).doc;
    const knob = doc.nodes.knob1!;
    const edge = Object.values(doc.edges).find(
      e => e.from.node !== 'filter1' && e.to.node !== 'filter1',
    )!;
    const list = attachmentsOf(
      doc,
      catalog,
      ['filter1', knob.id, 'title1', 'ghost'],
      [edge.id, 'e999'],
    );
    expect(list.map(a => [a.id, a.kind])).toEqual([
      ['filter1', 'module'],
      [knob.id, 'control'],
      ['title1', 'element'],
      [edge.id, 'cable'],
    ]);
    // A cable that touches an attached module comes with it (a box selection takes those too).
    const touching = Object.values(doc.edges).find(
      e => e.to.node === 'filter1' || e.from.node === 'filter1',
    )!;
    expect(attachmentsOf(doc, catalog, ['filter1'], [touching.id]).map(a => a.id)).toEqual([
      'filter1',
    ]);
    expect(list[0]!.label).toBe('Lowpass “Tone”');
    expect(list[1]!.label).toBe('Knob “Cutoff”');
    expect(list[2]!.label).toBe('text “A very long title for t…”');
    expect(list[3]!.label).toBe(
      `${edge.from.node}.${edge.from.port} → ${edge.to.node}.${edge.to.port}`,
    );
    expect(describeAttachments(list)).toMatch(
      /^filter1 — Lowpass “Tone”; knob1 — Knob “Cutoff” \(a control\); title1 — text “.*” on the plugin screen; e\w+ — cable /,
    );
  });
});

describe('the LLM is told what happened', () => {
  let session: KitSession, requests: AiRequests, transport: FakeLlmTransport, llm: LlmController;
  beforeEach(() => {
    session = makeSession();
    session.loadStarter('bass');
    requests = new AiRequests(session);
    transport = new FakeLlmTransport();
    llm = new LlmController(session, requests, transport as unknown as LlmTransport);
    session.llm = llm;
  });
  const startText = () => String(transport.last('llm.start')!.text);

  it('a new conversation includes historical lines; later turns include only new history and hand edits', async () => {
    requests.upsert(historicalLine('old-lex', 'longer release'));
    const first = requests.run('now add a wobble');
    expect(startText()).toMatch(
      /Earlier in this conversation[^\n]*:\n- earlier request: “longer release” → [^\n]+\n/,
    );
    transport.event(first.id, { kind: 'thread', thread: 'th1', fresh: false });
    transport.done(first.id);
    await new Promise(r => setTimeout(r, 5));
    requests.upsert(historicalLine('old-jev', 'brighter', 'jev'));
    session.commit([{ op: 'setValue', node: 'gain1', port: 'gain', value: 0.4 }], {
      label: 'Panel Gain',
    });
    requests.run('more of that');
    const text = startText();
    expect(transport.last('llm.start')!.thread).toBe('th1');
    expect(text).toMatch(/Since your last turn:\n- earlier request: “brighter” → /);
    expect(text).not.toMatch(/longer release|now add a wobble/);
    expect(text).toMatch(/The person edited by hand since your last turn: Panel Gain\./);
    expect(text.endsWith('\n\nmore of that')).toBe(true);
  });

  it('a short prompt carries attachments to the LLM by id, including when added to a running request', () => {
    const before = JSON.stringify(session.doc.value);
    const attached = attachmentsOf(session.doc.value, catalog, ['filter1']);
    const o = requests.run('brighter', { attached });
    expect(startText()).toMatch(
      /The person attached \(points at\) these: filter1 — Lowpass\. The request is about them/,
    );
    expect(o.attached).toEqual(attached);
    requests.run('and that cable', {
      attached: attachmentsOf(
        session.doc.value,
        catalog,
        [],
        [Object.keys(session.doc.value.edges)[0]!],
      ),
    });
    expect(String(transport.last('llm.steer')!.text)).toMatch(
      /^\[den-kit\] The user adds, while you work:\n\[den-kit\] The person attached \(points at\) these: e\w+ — cable /,
    );
    expect(JSON.stringify(session.doc.value)).toBe(before);
  });

  it('opening a patch starts a new Codex conversation and does not retell historical lines', () => {
    requests.upsert(historicalLine('old-lex', 'longer release'));
    const o = requests.run('explain');
    transport.event(o.id, { kind: 'thread', thread: 'th1', fresh: false });
    transport.done(o.id);
    session.loadStarter('pad');
    requests.run('explain again');
    expect(transport.last('llm.forget')).toEqual({ t: 'llm.forget', thread: 'th1' });
    expect(transport.last('llm.start')!.thread).toBeUndefined();
    expect(startText()).not.toMatch(/longer release|Earlier in this conversation/);
  });

  it('a completed short prompt continues the same Codex thread', () => {
    const first = requests.run('brighter');
    transport.event(first.id, { kind: 'thread', thread: 'th1', fresh: false });
    transport.done(first.id);
    requests.run('now make it darker');
    expect(transport.last('llm.start')!.thread).toBe('th1');
    expect(startText()).not.toMatch(/earlier request: “brighter”/);
    expect(startText().endsWith('\n\nnow make it darker')).toBe(true);
  });
});
