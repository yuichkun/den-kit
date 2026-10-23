// One conversation per work, kept by the runtime: den-kit keeps only which
// conversation (the runtime's id) is the work's, in the host's storage, goes on
// with it after a reload, shows what was said earlier by reading it from the
// runtime, and tells the AI what the person did by hand since its last turn.
import { describe, expect, it } from 'vite-plus/test';
import { AiRequests, earlierLines } from '../../../src/ai/requests.ts';
import { LlmController, type LlmTransport } from '../../../src/ai/llm.ts';
import { handEditsSince } from '../../../src/ai/conversation.ts';
import { KitSession } from '../../../src/editor/session.ts';
import type { Host, Storage } from '../../../src/host/index.ts';
import type { ConversationLine } from '../../../src/host/ai.ts';
import type { Transaction } from '../../../src/work/history.ts';
import { FakeLlmTransport } from '../../helpers/fake-llm-transport.ts';

class HostStorage implements Storage {
  data = new Map<string, string>();
  async read(key: string) {
    return this.data.get(key) ?? null;
  }
  async write(key: string, value: string) {
    this.data.set(key, value);
  }
  async remove(key: string) {
    this.data.delete(key);
  }
  async keys(prefix: string) {
    return [...this.data.keys()].filter(k => k.startsWith(prefix));
  }
  async readContent() {
    return null;
  }
  async writeContent() {}
}
function session(storage: HostStorage, bridge?: FakeLlmTransport) {
  const s = new KitSession({
    storage: null,
    host: { storage, workspace: { kind: null, create: () => Promise.reject() } } as unknown as Host,
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
  if (bridge) s.bridge = bridge as unknown as KitSession['bridge'];
  return s;
}
const tick = () => new Promise(r => setTimeout(r, 0));

describe("a work's conversation", () => {
  it("is the runtime's: den-kit keeps only its id, by work, in the host's storage", async () => {
    const storage = new HostStorage();
    const t = new FakeLlmTransport();
    const s = session(storage, t);
    const requests = new AiRequests(s);
    const llm = new LlmController(s, requests, t as unknown as LlmTransport);
    const o = llm.run('make a bass');
    t.event(o.id, { kind: 'thread', thread: 'th-work', fresh: false });
    t.event(o.id, { kind: 'message', text: 'A bass it is.' });
    t.done(o.id);
    await tick();
    expect([...storage.data]).toEqual([[`den-kit:conversation:${s.doc.value.id}`, 'th-work']]);
    llm.dispose();
  });

  it('goes on after a reload: the next request continues it, and what was said shows again', async () => {
    const storage = new HostStorage();
    const first = session(storage);
    const work = first.doc.value;
    storage.data.set(`den-kit:conversation:${work.id}`, 'th-work');
    const said: ConversationLine[] = [
      { who: 'person', text: 'make a bass' },
      { who: 'ai', text: 'A bass it is.' },
      { who: 'person', text: 'darker' },
      { who: 'ai', text: 'Lowered the cutoff.' },
    ];
    const t = new FakeLlmTransport();
    t.conversations.set('th-work', said);
    // A new window opens the same work (as a reload does).
    const s = session(storage, t);
    s.replace(work, 'Restored autosave', false);
    const requests = new AiRequests(s);
    const llm = new LlmController(s, requests, t as unknown as LlmTransport);
    await tick();
    await tick();
    expect(s.conversation.value).toBe('th-work');
    expect(requests.earlier.value.map(o => [o.text, o.reply])).toEqual([
      ['make a bass', 'A bass it is.'],
      ['darker', 'Lowered the cutoff.'],
    ]);
    llm.run('brighter again');
    expect(t.last('llm.start')).toMatchObject({ thread: 'th-work', text: 'brighter again' });
    llm.dispose();
  });

  it('a fresh start (a starter loaded) talks afresh; an AI replacing the patch keeps it', async () => {
    const storage = new HostStorage();
    const t = new FakeLlmTransport();
    const s = session(storage, t);
    s.keepConversation('th-1');
    s.replace(s.doc.value, 'AI template', true, { kind: 'ai-llm', take: 'rq' });
    expect(s.conversation.value).toBe('th-1');
    s.loadStarter('pad');
    expect(s.conversation.value).toBeNull();
    await tick();
    expect([...storage.data.keys()]).toEqual([]);
  });

  it('a conversation read back pairs what the person said with what the AI said', () => {
    expect(
      earlierLines([
        { who: 'ai', text: 'stray' },
        { who: 'person', text: 'hi' },
        { who: 'ai', text: 'Hello.' },
        { who: 'ai', text: 'What shall we make?' },
        { who: 'person', text: 'a pad' },
      ]).map(o => [o.text, o.reply]),
    ).toEqual([
      ['hi', 'Hello.\nWhat shall we make?'],
      ['a pad', undefined],
    ]);
  });
});

describe('what the AI is told when a request goes on', () => {
  it("the person's own edits since its last turn, in a few words", () => {
    const tx = (label: string, at: number, kind: 'human' | 'ai-llm' = 'human'): Transaction =>
      ({
        id: label,
        label,
        at,
        author: kind === 'human' ? { kind } : { kind, take: 'rq' },
        ops: [],
      }) as unknown as Transaction;
    expect(
      handEditsSince(
        [
          tx('Panel Cutoff', 5),
          tx('Panel Cutoff', 20),
          tx('Panel Cutoff', 30),
          tx('Move', 40),
          tx('AI: edit', 50, 'ai-llm'),
        ],
        10,
      ),
    ).toBe('Panel Cutoff ×2, Move');
    expect(handEditsSince([tx('Move', 5)], 10)).toBeNull();
  });
});
