// The whole fast path against an in-process Jev (scripted fake brain): what is
// applied, what it is not sure about (never offered as choices: the LLM takes
// it, or one line says why), and that no failure ever damages the patch.
import { beforeEach, describe, expect, it } from 'vitest';
import { FastPath } from '../../../src/ai/fast-path.ts';
import { testSession, stubBridge, type StubBridge } from '../../helpers/fake-bridge.ts';
import { scriptedAnswerer, type Script } from '../../fakes/jev/scripted.ts';
import type { KitSession } from '../../../src/editor/session.ts';
import { clone } from '../../../src/core/schema.ts';

const script: Script = {
  'make it sound brighter and more alive': { route: 'adjust', aspect: 'brightness_up', amount: 'medium' },
  'put it in a big hall': { route: 'add_effect', fx: 'reverb' },
  'I need a squelchy acid line': { route: 'create', template: 'bass', aspect: 'resonance_up' },
  'write a granular codebox': { route: 'complex' },
  'もう少しだけ空間を広げて': { route: 'add_effect', fx: { choice: 'reverb', p: 0.65 } },
  'open it up a little': { route: { choice: 'adjust', p: 0.7 }, aspect: { choice: 'brightness_up', p: 0.7 }, amount: 'small' },
  'more of the effect': { route: 'adjust', aspect: 'mix_up', target: 'Reverb' },
};

let session: KitSession;
let stub: StubBridge;
let fast: FastPath;
beforeEach(() => {
  session = testSession();
  session.loadStarter('bass');
  stub = stubBridge(scriptedAnswerer(script));
  session.bridge = stub.bridge;
  fast = new FastPath(session);
});
const snapshot = () => JSON.stringify({ ...clone(session.doc.value), revision: 0 });

describe('lexicon path (no Jev)', () => {
  it('applies at once as one ai-fast transaction; ⌘Z (session.undo) restores the exact patch and clears the result line', async () => {
    const before = snapshot();
    const o = await fast.run('リリース長く');
    expect(o).toMatchObject({ status: 'applied', route: 'lexicon' });
    expect(stub.requests).toHaveLength(0);
    expect(session.history.peek()!.author).toMatchObject({ kind: 'ai-fast', handler: 'lexicon' });
    expect(session.doc.value.nodes.aenv1!.values.release).toBeGreaterThan(0.12);
    session.undo();
    expect(snapshot()).toBe(before);
    expect(fast.outcome.value).toBeNull();
  });

  it('undoing an older edit leaves the latest AI result line alone', async () => {
    session.commit([{ op: 'setValue', node: 'gain1', port: 'gain', value: 0.2 }]);
    await fast.run('brighter');
    session.undo();
    expect(fast.outcome.value).toBeNull();
    session.redo();
    await fast.run('リリース長く');
    session.commit([{ op: 'setValue', node: 'gain1', port: 'gain', value: 0.3 }]);
    session.undo(); // undoes the manual edit, not the AI one
    expect(fast.outcome.value?.status).toBe('applied');
  });

  it('a template replaces the patch in one undoable step, with slots applied', async () => {
    const o = await fast.run('明るいリードを作って');
    expect(o.status).toBe('applied');
    expect(session.doc.value.name).toBe('Lead');
    expect(session.doc.value.nodes.cut1!.values.hz).toBeGreaterThan(900);
    session.undo();
    expect(session.doc.value.name).toBe('Bass');
  });

  it('says why when nothing fits, without touching the patch or calling Jev', async () => {
    const before = snapshot();
    const o = await fast.run('もっと揺らして');
    expect(o.status).toBe('nothing');
    expect(o.message).toMatch(/no LFO/);
    await fast.run('レゾナンスを最大に');
    const again = await fast.run('レゾナンスを最大に');
    expect(again.message).toMatch(/Already at the maximum/);
    expect(stub.requests).toHaveLength(0);
    session.undo();
    expect(snapshot()).toBe(before);
  });

  it('an empty request does nothing', async () => {
    expect((await fast.run('   ')).status).toBe('nothing');
  });
});

describe('Jev path', () => {
  it('applies a confident answer and records a trace', async () => {
    const o = await fast.run('make it sound brighter and more alive');
    expect(o).toMatchObject({ status: 'applied', route: 'jev', jevMs: 42 });
    expect(stub.requests).toHaveLength(1);
    expect(Object.keys(stub.requests[0]!.questions)).toEqual(expect.arrayContaining(['route', 'route_rev', 'aspect', 'aspect_rev', 'amount', 'fx', 'template']));
    expect(JSON.stringify(stub.requests[0]!.state).length).toBeLessThan(300);
    const trace = stub.telemetry.find(t => t.kind === 'route')!;
    expect(trace).toMatchObject({ decision: 'apply', route: 'jev', applied: true });
    expect(fast.traces.value[0]!.jev!.answers!.route!.agree).toBe(true);
  });

  it('effects and templates via Jev', async () => {
    expect((await fast.run('put it in a big hall')).status).toBe('applied');
    expect(Object.values(session.doc.value.nodes).some(n => n.type === 'den.algorithmicReverb')).toBe(true);
    expect((await fast.run('I need a squelchy acid line')).status).toBe('applied');
    expect(session.doc.value.nodes.filter1!.values.resonance).toBeGreaterThan(0.707);
  });

  it('route "complex" needs the LLM; without one wired it says so and changes nothing (hand-off: llm.test.ts)', async () => {
    const before = snapshot();
    const o = await fast.run('write a granular codebox');
    expect(o.status).toBe('nothing');
    expect(o.message).toBe('This needs the LLM.');
    expect(snapshot()).toBe(before);
  });

  it('an unsure Jev (orders disagree) offers nothing to pick: one line, the patch untouched, the trace keeps what it weighed', async () => {
    const before = snapshot();
    const o = await fast.run('make it pop somehow');
    expect(o).toMatchObject({ status: 'nothing', message: expect.stringMatching(/Not sure what to change/) });
    expect(Object.keys(o)).not.toContain('chips');
    expect(snapshot()).toBe(before);
    expect(fast.traces.value[0]).toMatchObject({ decision: 'chips', applied: false });
    expect(fast.traces.value[0]!.alternatives!.length).toBeGreaterThan(0);
  });

  it('the Japanese threshold is stricter when Jev interpreted Japanese', async () => {
    expect((await fast.run('open it up a little')).status).toBe('applied');
    session.undo();
    const ja = await fast.run('もう少しだけ空間を広げて');
    expect(ja.status).toBe('nothing');
    fast.settings.tauJa = 0.6;
    expect((await fast.run('もう少しだけ空間を広げて')).status).toBe('applied');
  });

  it('τ comes from the settings', async () => {
    fast.settings.tau = 0.9;
    expect((await fast.run('open it up a little')).status).toBe('nothing');
  });

  it.each([
    ['timeout', { ok: false, error: { kind: 'timeout', message: 'Jev did not answer within 1500 ms.' }, ms: 1500 }],
    ['auth', { ok: false, error: { kind: 'auth', message: 'Jev rejected the API key (401).', status: 401 }, ms: 80 }],
    ['busy', { ok: false, error: { kind: 'busy', message: 'Jev is busy (529).', status: 529 }, ms: 90 }],
    ['malformed', { ok: false, error: { kind: 'malformed', message: 'Jev returned a body that is not JSON.' }, ms: 30 }],
    ['empty answers', { ok: true, response: { model: 'jev-1.13.0', answers: {} }, ms: 30 }],
    ['garbage answers', { ok: true, response: { model: 'jev-1.13.0', answers: { route: { type: 'choice', choice: 'adjust', probabilities: { adjust: NaN } }, aspect: 'x', direction: null } }, ms: 30 }],
  ] as const)('%s never changes the patch and offers nothing to pick', async (_name, result) => {
    const before = snapshot();
    stub.next.push(result as never);
    const o = await fast.run('brighter like a trumpet');
    expect(o.status).toBe('nothing');
    expect(snapshot()).toBe(before);
    stub.next.push(result as never);
    const none = await fast.run('something unrecognisable');
    expect(none.status).toBe('nothing');
    expect(snapshot()).toBe(before);
  });

  it('a patch edited while Jev thinks is never changed by the late answer: Jev is asked again about the patch as it is now', async () => {
    let edits = 0;
    stub.during = () => { if (edits++ === 0) session.commit([{ op: 'setValue', node: 'gain1', port: 'gain', value: 0.3 }]); };
    const o = await fast.run('make it sound brighter and more alive');
    expect(o.status).toBe('applied');
    expect(stub.requests).toHaveLength(2);
    expect(session.doc.value.nodes.gain1!.values.gain).toBe(0.3); // the user's edit stays
    expect(session.doc.value.nodes.cut1!.values.hz).toBeGreaterThan(300);
    expect(fast.traces.value[1]!.stale).toBe(true);
    expect(fast.history.value.filter(l => l.text === 'make it sound brighter and more alive')).toHaveLength(1);
  });

  it('a patch that keeps changing while Jev thinks is left alone, with one line (no LLM here)', async () => {
    stub.during = () => { session.commit([{ op: 'setValue', node: 'gain1', port: 'gain', value: 0.2 + Math.random() * 0.1 }]); };
    const o = await fast.run('make it sound brighter and more alive');
    expect(o).toMatchObject({ status: 'nothing', message: expect.stringMatching(/kept changing/) });
    expect(session.doc.value.nodes.cut1!.values.hz).toBe(300);
    expect(fast.busy.value).toBe(false);
  });

  it('a selection change while Jev thinks also counts as a change', async () => {
    let calls = 0;
    stub.during = () => { if (calls++ === 0) session.select(['filter1']); };
    expect((await fast.run('make it sound brighter and more alive')).status).toBe('applied');
    expect(stub.requests).toHaveLength(2);
  });

  it('a newer request supersedes the one in flight', async () => {
    stub.delayMs = 30;
    const first = fast.run('make it sound brighter and more alive');
    const second = fast.run('put it in a big hall');
    const [a, b] = await Promise.all([first, second]);
    expect(a.message).toMatch(/Superseded|Cancelled/);
    expect(b.status).toBe('applied');
    expect(session.doc.value.nodes.cut1!.values.hz).toBe(300);
  });

  it('an ambiguous knob from the lexicon asks Jev only the target question', async () => {
    await fast.run('add reverb');
    await fast.run('add delay');
    stub.requests.length = 0;
    script.wetter = { target: 'Reverb, knob mix' };
    const o = await fast.run('wetter');
    expect(Object.keys(stub.requests[0]!.questions)).toEqual(['target', 'target_rev']);
    expect(o).toMatchObject({ status: 'applied', route: 'jev-target' });
    expect(session.doc.value.nodes.reverb1!.values.mix).toBeGreaterThan(0.25);
  });

  it('which knob is unclear (no Jev, or Jev unsure): nothing to pick, nothing changed', async () => {
    await fast.run('add reverb');
    await fast.run('add delay');
    const before = snapshot();
    fast.settings.useJev = false;
    const off = await fast.run('wetter');
    expect(off.status).toBe('nothing');
    expect(fast.traces.value[0]!.alternatives!.join(' ')).toMatch(/Reverb.*Delay|Delay.*Reverb/);
    fast.settings.useJev = true;
    delete script.wetter;
    expect((await fast.run('wetter')).status).toBe('nothing');
    expect(snapshot()).toBe(before);
  });
});

describe('without Jev', () => {
  it('no bridge: lexicon still works; the rest explains why', async () => {
    session.bridge = null;
    expect((await fast.run('brighter')).status).toBe('applied');
    const o = await fast.run('make it pop');
    expect(o.status).toBe('nothing');
    expect(o.message).toMatch(/AI offline/);
  });
  it('Jev off: a partly understood request is not half-done; the line says why', async () => {
    const off = stubBridge(scriptedAnswerer({}), 'off');
    session.bridge = off.bridge;
    const before = snapshot();
    const o = await fast.run('brighter like a trumpet');
    expect(o.status).toBe('nothing');
    expect(o.message).toMatch(/TYPESAFE_API_KEY/);
    expect(off.requests).toHaveLength(0);
    expect(snapshot()).toBe(before);
  });
});

describe('telemetry', () => {
  it('logs every request and undo of an AI edit', async () => {
    await fast.run('brighter');
    session.undo();
    expect(stub.telemetry.map(t => t.kind)).toEqual(['route', 'undo']);
    expect(stub.telemetry[1]!.trace).toBe(stub.telemetry[0]!.id);
  });
});

describe('fuzz: random Jev answers never break the patch', () => {
  it('300 random answer sets: the patch stays valid and only changes through one transaction', async () => {
    const { validate } = await import('../../../src/core/validate.ts');
    let seed = 7;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const junk = (keys: string[]): unknown => {
      const r = rand();
      if (r < 0.1) return undefined;
      if (r < 0.15) return 'nonsense';
      if (r < 0.2) return { type: 'choice', choice: 'not-a-key', probabilities: {} };
      const choice = keys[Math.floor(rand() * keys.length)]!;
      const probabilities = Object.fromEntries(keys.map(k => [k, r < 0.25 ? NaN : r < 0.3 ? -1 : rand()]));
      return { type: 'choice', choice, probabilities, confidence: r < 0.35 ? 'x' : rand() };
    };
    const texts = ['make it pop', 'something else', 'もっといい感じに', 'brighter like a trumpet', 'hmm'];
    for (let i = 0; i < 300; i++) {
      stub.next.push(request => ({ ok: true, response: { model: 'jev-1.13.0', answers: Object.fromEntries(Object.entries(request.questions).map(([id, q]) => [id, junk(Object.keys((q as { criteria: object }).criteria ?? {}))])) }, ms: 5 }));
      const size = session.history.size;
      const o = await fast.run(texts[i % texts.length]!);
      expect(['applied', 'nothing']).toContain(o.status);
      expect(session.history.size - size).toBe(o.status === 'applied' ? 1 : 0);
      expect(validate(session.doc.value, session.catalog).issues.filter(x => x.severity === 'error')).toEqual([]);
      if (i % 25 === 0) session.loadStarter(i % 50 ? 'pad' : 'bass');
    }
  });
});
