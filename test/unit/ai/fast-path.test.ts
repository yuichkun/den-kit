// The whole fast path against an in-process Jev (scripted fake brain): what is
// applied, what becomes chips, and that no failure ever damages the patch.
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
  'もう少しだけ空間を広げて': { route: 'add_effect', fx: { choice: 'reverb', p: 0.7 } },
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
  it('applies at once as one ai-fast transaction; undo restores the exact patch', async () => {
    const before = snapshot();
    const o = await fast.run('リリース長く');
    expect(o).toMatchObject({ status: 'applied', route: 'lexicon' });
    expect(stub.requests).toHaveLength(0);
    expect(session.history.peek()!.author).toMatchObject({ kind: 'ai-fast', handler: 'lexicon' });
    expect(session.doc.value.nodes.aenv1!.values.release).toBeGreaterThan(0.12);
    fast.undo();
    expect(snapshot()).toBe(before);
    expect(fast.outcome.value).toMatchObject({ status: 'nothing', message: 'Undone.' });
  });

  it('A/B toggles between before and after while the edit is the latest step', async () => {
    await fast.run('brighter');
    const after = snapshot();
    fast.toggleAB();
    expect(fast.outcome.value!.ab).toBe('before');
    expect(session.doc.value.nodes.cut1!.values.hz).toBe(300);
    fast.toggleAB();
    expect(fast.outcome.value!.ab).toBe('after');
    expect(snapshot()).toBe(after);
    session.commit([{ op: 'setValue', node: 'gain1', port: 'gain', value: 0.2 }]);
    expect(fast.canAB).toBe(false);
    fast.toggleAB();
    expect(fast.outcome.value!.txId).toBeUndefined();
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

  it('route "complex" escalates (LLM arrives in CP2b) and changes nothing', async () => {
    const before = snapshot();
    const o = await fast.run('write a granular codebox');
    expect(o.status).toBe('escalate');
    expect(o.message).toMatch(/CP2b/);
    expect(snapshot()).toBe(before);
  });

  it('an unsure Jev (orders disagree) gives chips; a chip applies as one undo step', async () => {
    const before = snapshot();
    const o = await fast.run('make it pop somehow');
    expect(o.status).toBe('chips');
    expect(snapshot()).toBe(before);
    expect(o.chips.length).toBeGreaterThan(0);
    fast.applyChip(o.chips[0]!);
    expect(fast.outcome.value!.status).toBe('applied');
    expect(session.history.peek()!.author).toMatchObject({ kind: 'ai-fast', handler: 'chip' });
    session.undo();
    expect(snapshot()).toBe(before);
  });

  it('the Japanese threshold is stricter when Jev interpreted Japanese', async () => {
    expect((await fast.run('open it up a little')).status).toBe('applied');
    session.undo();
    const ja = await fast.run('もう少しだけ空間を広げて');
    expect(ja.status).toBe('chips');
    fast.settings.tauJa = 0.6;
    expect((await fast.run('もう少しだけ空間を広げて')).status).toBe('applied');
  });

  it('τ comes from the settings', async () => {
    fast.settings.tau = 0.9;
    expect((await fast.run('open it up a little')).status).toBe('chips');
  });

  it.each([
    ['timeout', { ok: false, error: { kind: 'timeout', message: 'Jev did not answer within 1500 ms.' }, ms: 1500 }],
    ['auth', { ok: false, error: { kind: 'auth', message: 'Jev rejected the API key (401).', status: 401 }, ms: 80 }],
    ['busy', { ok: false, error: { kind: 'busy', message: 'Jev is busy (529).', status: 529 }, ms: 90 }],
    ['malformed', { ok: false, error: { kind: 'malformed', message: 'Jev returned a body that is not JSON.' }, ms: 30 }],
    ['empty answers', { ok: true, response: { model: 'jev-1.13.0', answers: {} }, ms: 30 }],
    ['garbage answers', { ok: true, response: { model: 'jev-1.13.0', answers: { route: { type: 'choice', choice: 'adjust', probabilities: { adjust: NaN } }, aspect: 'x', direction: null } }, ms: 30 }],
  ] as const)('%s never changes the patch and offers the lexicon guess when there is one', async (_name, result) => {
    const before = snapshot();
    stub.next.push(result as never);
    const o = await fast.run('brighter like a trumpet');
    expect(['chips', 'nothing']).toContain(o.status);
    expect(snapshot()).toBe(before);
    if (o.status === 'chips') expect(o.chips[0]!.label).toMatch(/brighter/);
    stub.next.push(result as never);
    const none = await fast.run('something unrecognisable');
    expect(none.status).toBe('nothing');
    expect(snapshot()).toBe(before);
  });

  it('a patch edited while Jev thinks is never changed by the late answer (chips instead)', async () => {
    stub.during = () => { session.commit([{ op: 'setValue', node: 'gain1', port: 'gain', value: 0.3 }]); };
    const o = await fast.run('make it sound brighter and more alive');
    expect(o.status).toBe('chips');
    expect(o.message).toMatch(/changed while Jev/);
    expect(session.doc.value.nodes.cut1!.values.hz).toBe(300);
    expect(fast.traces.value[0]!.stale).toBe(true);
  });

  it('a selection change while Jev thinks also counts as stale', async () => {
    stub.during = () => { session.select(['filter1']); };
    expect((await fast.run('make it sound brighter and more alive')).status).toBe('chips');
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

  it('ambiguity without Jev becomes chips; Jev unsure also becomes chips', async () => {
    await fast.run('add reverb');
    await fast.run('add delay');
    fast.settings.useJev = false;
    const off = await fast.run('wetter');
    expect(off.status).toBe('chips');
    expect(off.chips.map(c => c.label).join(' ')).toMatch(/reverb1|delay1/);
    fast.settings.useJev = true;
    delete script.wetter;
    expect((await fast.run('wetter')).status).toBe('chips');
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
  it('Jev off: a partly understood request offers the lexicon part as a chip', async () => {
    const off = stubBridge(scriptedAnswerer({}), 'off');
    session.bridge = off.bridge;
    const o = await fast.run('brighter like a trumpet');
    expect(o.status).toBe('chips');
    expect(o.message).toMatch(/TYPESAFE_API_KEY/);
    expect(off.requests).toHaveLength(0);
  });
  it('a read-only tab never applies', async () => {
    session.readOnly.value = true;
    const o = await fast.run('brighter');
    expect(o.status).toBe('nothing');
    expect(o.message).toMatch(/read-only/);
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
      expect(['applied', 'chips', 'escalate', 'nothing']).toContain(o.status);
      expect(session.history.size - size).toBe(o.status === 'applied' ? 1 : 0);
      expect(validate(session.doc.value, session.catalog).issues.filter(x => x.severity === 'error')).toEqual([]);
      if (i % 25 === 0) session.loadStarter(i % 50 ? 'pad' : 'bass');
    }
  });
});
