// The person's rough sketch (U8c), from the marks to the AI: marks belong where
// they were drawn (the plugin; the patch, or the part the person is inside);
// sending reads them (what each goes around, crosses or joins) and keeps them,
// dimmed, until the request ends; the LLM gets their words and pictures with the
// request or with what is added to it; members get the sketches on what they
// hold; pointing marks reach the LLM alongside the selection.
import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { AiRequests } from '../../../src/ai/requests.ts';
import { LlmController, type LlmTransport } from '../../../src/ai/llm.ts';
import type { WorkspaceDeps } from '../../../src/ai/llm-workspace.ts';
import { attachmentsOf } from '../../../src/ai/attachments.ts';
import { lineForAi, readSavedLines, savedLine } from '../../../src/ai/conversation.ts';
import { analyse } from '../../../src/core/analysis.ts';
import { controlFor } from '../../../src/plugin/controls.ts';
import type { SentSketch } from '../../../src/ai/sketch.ts';
import type { KitSession } from '../../../src/editor/session.ts';
import { takeSketch, targetsOn } from '../../../src/editor/sketch-send.ts';
import { testSession } from '../../helpers/test-session.ts';
import { FakeLlmTransport } from '../../helpers/fake-llm-transport.ts';

let session: KitSession, requests: AiRequests, t: FakeLlmTransport, llm: LlmController;
beforeEach(() => {
  session = testSession();
  session.loadStarter('bass');
  requests = new AiRequests(session);
  t = new FakeLlmTransport();
  llm = new LlmController(session, requests, t as unknown as LlmTransport, {
    stopGraceMs: 200,
    storage: null,
    deps: {
      compile: async () => ({ ok: true, ms: 300 }) as Awaited<ReturnType<WorkspaceDeps['compile']>>,
      render: async () => {
        const s = new Float32Array(9600).map((_, i) => Math.sin(i / 9) * 0.3);
        return { report: analyse([s, s], 48000), renderMs: 5 };
      },
      look: async () => ({ issues: [], png: null, width: 640, height: 360, ms: 1 }),
    },
  });
  session.llm = llm;
});
const RED = '#ff4d6d';
const settle = () => new Promise(r => setTimeout(r, 0));
const line = (id: string) => requests.history.value.find(o => o.id === id)!;
const PLUGIN =
  'The person sketched on the plugin (720×440 design pixels); the marks are numbered on the picture:\n① red box around knob1 (knob “Cutoff”) (x 10, y 90, 100×110)\n② yellow sticky note “bigger” on knob2 (knob “Resonance”) (x 130, y 120, 60×40)';
const PATCH =
  'The person sketched on the patch; the marks are numbered on the picture:\n① blue arrow from osc1 (Oscillator) to filter1 (Filter “Lowpass”)';
const PNG_P = 'data:image/png;base64,UExVR0lO',
  PNG_S = 'data:image/png;base64,UEFUQ0g=';

describe('marks belong where they were drawn', () => {
  it('the plugin is one place; the patch is the main patch or the part the person is inside, numbered there', () => {
    const a = session.addMark('patch', {
      kind: 'rect',
      color: RED,
      rect: { x: 0, y: 0, w: 50, h: 50 },
    });
    const b = session.addMark('plugin', {
      kind: 'pen',
      color: RED,
      points: [
        [0, 0],
        [10, 10],
      ],
      width: 3,
    });
    expect([a.n, b.n, a.where]).toEqual([1, 1, undefined]);
    session.partPath.value = ['use1'];
    const c = session.addMark('patch', { kind: 'arrow', color: RED, from: [0, 0], to: [40, 0] });
    expect([c.n, c.where]).toEqual([1, 'use1']);
    expect(session.marksHere('patch').map(m => m.id)).toEqual([c.id]);
    expect(session.unsentMarks('plugin').map(m => m.id)).toEqual([b.id]);
    expect(session.undoMark('patch')).toBe(true);
    expect(session.undoMark('patch')).toBe(false); // the main patch's mark is not here
    session.partPath.value = [];
    expect(session.marksHere('patch').map(m => m.id)).toEqual([a.id]);
  });
  it('sent marks stay until their request ends (pinned: they stay as new marks); another patch rubs everything out', () => {
    const a = session.addMark('plugin', {
      kind: 'rect',
      color: RED,
      rect: { x: 0, y: 0, w: 50, h: 50 },
    });
    session.markSent([a.id], 'rq1');
    expect(session.unsentMarks('plugin')).toEqual([]);
    expect(session.undoMark('plugin')).toBe(false); // sent: not taken back
    session.inkPinned.value = true;
    session.releaseSent('rq1');
    expect(session.unsentMarks('plugin').map(m => m.id)).toEqual([a.id]);
    session.inkPinned.value = false;
    // A request that did nothing with them (failed, stopped, not understood) gives them back as new marks.
    session.markSent([a.id], 'rq2');
    session.releaseSent('rq2', true);
    expect(session.unsentMarks('plugin').map(m => m.id)).toEqual([a.id]);
    session.markSent([a.id], 'rq3');
    session.releaseSent('rq3');
    expect(session.sketch.value.plugin).toEqual([]);
    session.addMark('patch', { kind: 'rect', color: RED, rect: { x: 0, y: 0, w: 50, h: 50 } });
    session.inking.value = 'pen';
    session.loadStarter('pad');
    expect([session.sketch.value.patch, session.inking.value]).toEqual([[], null]);
  });
});

describe('sending reads the marks', () => {
  it('a box around a control on the plugin points at it, like selecting it; a note does not', async () => {
    expect(
      session.commit(
        controlFor(session.doc.value, session.catalog, { node: 'cut1', port: 'hz' }).intents,
      ).ok,
    ).toBe(true);
    const [k] = targetsOn(session, 'plugin');
    expect(k).toBeDefined();
    const m = session.addMark('plugin', {
      kind: 'rect',
      color: RED,
      rect: { x: k!.box.x - 6, y: k!.box.y - 6, w: k!.box.w + 12, h: k!.box.h + 12 },
    });
    const taken = (await takeSketch(session, { pictures: false }))!;
    expect(taken.pointing).toEqual([k!.id]);
    expect(taken.sketch.ids).toEqual([m.id]);
    expect(taken.sketch.parts).toHaveLength(1);
    expect(taken.sketch.parts[0]).toMatchObject({ view: 'plugin', marks: 1 });
    expect(taken.sketch.parts[0]!.text).toMatch(
      /^The person sketched on the plugin \(\d+×\d+ design pixels\); the marks \(no picture: your model does not take pictures\):\n① red box around /,
    );
    expect(taken.sketch.parts[0]!.image).toBeUndefined();
    session.addMark('plugin', {
      kind: 'note',
      color: '#ffd166',
      rect: { x: 600, y: 10, w: 100, h: 50 },
      text: 'a waveform here',
    });
    const both = (await takeSketch(session, { pictures: false }))!;
    expect(both.pointing).toBeNull();
    expect(both.sketch.parts[0]!.text).toMatch(/② yellow sticky note “a waveform here”/);
  });
  it('on the patch, the modules where the view draws them; both views go together', async () => {
    session.patchBoxes = () => ({
      osc1: { x: 0, y: 0, w: 160, h: 100 },
      filter1: { x: 300, y: 0, w: 160, h: 120 },
    });
    session.addMark('patch', { kind: 'arrow', color: '#4cc9f0', from: [80, 50], to: [380, 60] });
    session.addMark('plugin', {
      kind: 'text',
      color: RED,
      rect: { x: 10, y: 10, w: 220, h: 40 },
      text: 'ACID',
    });
    const taken = (await takeSketch(session, { pictures: false }))!;
    expect(taken.sketch.parts.map(p => [p.view, p.marks])).toEqual([
      ['plugin', 1],
      ['patch', 1],
    ]);
    expect(taken.sketch.parts[1]!.text).toMatch(
      /\n① blue arrow from osc1 \([^)]+\) to filter1 \([^)]+\)$/,
    );
    expect(taken.about).toEqual(expect.arrayContaining(['osc1', 'filter1']));
    expect(
      await takeSketch((session.clearSketch('plugin'), session.clearSketch('patch'), session), {
        pictures: false,
      }),
    ).toBeNull();
  });
});

describe('the LLM gets the sketch', () => {
  it('its words in the request and its pictures with it; the marks stay dimmed until the request ends', async () => {
    const m = session.addMark('plugin', {
      kind: 'rect',
      color: RED,
      rect: { x: 10, y: 90, w: 100, h: 110 },
    });
    const sketch: SentSketch = {
      parts: [{ view: 'plugin', marks: 1, text: PLUGIN, image: PNG_P }],
      ids: [m.id],
    };
    const o = llm.run('make this bigger', { sketch });
    const start = t.last('llm.start', o.id)!;
    expect(String(start.text)).toContain(`\n[den-kit] ${PLUGIN}`);
    expect(String(start.text)).toMatch(/\n\nmake this bigger$/);
    expect(start.images).toEqual([PNG_P]);
    expect(session.sentMarks.value).toEqual({ [m.id]: o.id });
    expect(line(o.id).sketch?.parts[0]?.marks).toBe(1);
    t.done(o.id);
    await settle();
    expect(session.sketch.value.plugin).toEqual([]);
    expect(session.sentMarks.value).toEqual({});
  });
  it('a sketch added while it runs goes with the added words, and its marks wait for the whole request', async () => {
    const o = llm.run('make an acid bass');
    const m = session.addMark('patch', {
      kind: 'arrow',
      color: '#4cc9f0',
      from: [0, 0],
      to: [300, 0],
    });
    const added = llm.run('and wire it like this', {
      sketch: { parts: [{ view: 'patch', marks: 1, text: PATCH, image: PNG_S }], ids: [m.id] },
    });
    const steer = t.last('llm.steer', added.id)!;
    expect(String(steer.text)).toContain(`[den-kit] ${PATCH}`);
    expect(steer.images).toEqual([PNG_S]);
    expect(session.sentMarks.value).toEqual({ [m.id]: o.id });
    t.event(added.id, { kind: 'steered', target: o.id });
    t.done(o.id);
    await settle();
    expect(session.sketch.value.patch).toEqual([]);
  });
  it('without the LLM the request fails and the marks are new again', () => {
    t.online = false;
    const m = session.addMark('plugin', {
      kind: 'rect',
      color: RED,
      rect: { x: 10, y: 90, w: 100, h: 110 },
    });
    const o = llm.run('make this bigger', {
      sketch: { parts: [{ view: 'plugin', marks: 1, text: PLUGIN }], ids: [m.id] },
    });
    expect(o.status).toBe('failed');
    expect(session.unsentMarks('plugin').map(x => x.id)).toEqual([m.id]);
  });
});

describe('members get the sketches on what they hold', () => {
  const SEAM = {
    ops: [
      {
        op: 'addControl',
        for: { node: 'cut1', port: 'hz' },
        label: 'Cutoff',
        panel: { x: 24, y: 96, w: 84, h: 96 },
      },
    ],
  };
  const MEMBERS = {
    members: [
      {
        name: 'Sound',
        goal: 'A squelchy acid bass',
        scope: { sound: { nodes: ['filter1', 'fenv1'] } },
        done: 'it bites',
      },
      { name: 'Screen', goal: 'A neon screen', scope: { screen: 'all' }, done: 'it glows' },
      {
        name: 'Bare',
        goal: 'A rounder oscillator',
        scope: { sound: { nodes: ['osc1'] } },
        done: 'done',
        context: 'bare',
      },
    ],
  };
  it('the sound member the patch sketch, the screen member the plugin sketch (words and picture); a bare brief neither', async () => {
    const sketch: SentSketch = {
      parts: [
        { view: 'plugin', marks: 2, text: PLUGIN, image: PNG_P },
        { view: 'patch', marks: 1, text: PATCH, image: PNG_S },
      ],
      ids: [],
    };
    const o = llm.run('acid with a neon screen', { sketch });
    expect(t.last('llm.start', o.id)!.images).toEqual([PNG_P, PNG_S]);
    expect((await t.call(o.id, 'l1', 'kit_apply_ops', SEAM)).success).toBe(true);
    const started = await t.call(o.id, 'l2', 'kit_delegate', MEMBERS);
    expect(started.text).toMatch(/^Started: /);
    const sound = t.last('llm.start', `${o.id}~m1`)!,
      screen = t.last('llm.start', `${o.id}~m2`)!,
      bare = t.last('llm.start', `${o.id}~m3`)!;
    expect(String(sound.text)).toContain(`[den-kit] The person's sketch: ${PATCH}`);
    expect(String(sound.text)).not.toContain('sketched on the plugin');
    expect(sound.images).toEqual([PNG_S]);
    expect(String(screen.text)).toContain(`[den-kit] The person's sketch: ${PLUGIN}`);
    expect(screen.images).toEqual([PNG_P]);
    expect(String(bare.text)).not.toContain('sketch');
    expect(bare.images).toBeUndefined();
    // The lead passes marks along: their lines and the picture they are on.
    expect(
      (await t.call(o.id, 'l3', 'kit_tell', { member: 'm1', text: 'see the note', marks: [2] }))
        .success,
    ).toBe(true);
    const told = t.last('llm.steer')!;
    expect(String(told.text)).toBe(
      `[den-kit] The lead adds: see the note\n[den-kit] ${PLUGIN.split('\n')[0]}\n${PLUGIN.split('\n')[2]}`,
    );
    expect(told.images).toEqual([PNG_P]);
    const none = await t.call(o.id, 'l4', 'kit_tell', {
      member: 'm1',
      text: 'and this',
      marks: [9],
    });
    expect(none).toMatchObject({ success: false, text: "No marks 9 in the person's sketch." });
  });
});

describe('the prompt and the saved conversation', () => {
  it('a short prompt with a box reaches the LLM and keeps its marks until the request ends', async () => {
    const m = session.addMark('patch', {
      kind: 'rect',
      color: RED,
      rect: { x: 0, y: 0, w: 200, h: 200 },
    });
    const o = await requests.run('brighter', {
      attached: attachmentsOf(session.doc.value, session.catalog, ['filter1']),
      sketch: { parts: [{ view: 'patch', marks: 1, text: PATCH }], ids: [m.id] },
    });
    expect(o).toMatchObject({ status: 'thinking', route: 'llm' });
    expect(o.sketch?.parts[0]?.marks).toBe(1);
    const start = t.last('llm.start', o.id)!;
    expect(String(start.text)).toContain('filter1 — Lowpass');
    expect(String(start.text)).toContain(PATCH);
    expect(session.sentMarks.value).toEqual({ [m.id]: o.id });
    expect(session.sketch.value.patch.map(mark => mark.id)).toEqual([m.id]);
    t.done(o.id);
    await settle();
    expect(session.sketch.value.patch).toEqual([]);
  });
  it('a drawing request carries its picture to the LLM and keeps marks until completion', async () => {
    const m = session.addMark('plugin', {
      kind: 'rect',
      color: RED,
      rect: { x: 10, y: 90, w: 100, h: 110 },
    });
    const o = await requests.run('like my drawing please', {
      sketch: { parts: [{ view: 'plugin', marks: 1, text: PLUGIN, image: PNG_P }], ids: [m.id] },
    });
    expect(o.route).toBe('llm');
    const start = t.last('llm.start', o.id)!;
    expect(String(start.text)).toContain(PLUGIN);
    expect(start.images).toEqual([PNG_P]);
    expect(session.sentMarks.value).toEqual({ [m.id]: o.id });
    t.done(o.id);
    await settle();
    expect(session.sketch.value.plugin).toEqual([]);
  });
  it('a saved line keeps what the sketch was, not its words or picture; the LLM reads that it had one', () => {
    const saved = savedLine({
      id: 'rq1',
      text: 'make this bigger',
      status: 'applied',
      route: 'llm',
      ms: 10,
      label: 'bigger',
      sketch: { parts: [{ view: 'plugin', marks: 2, text: PLUGIN, image: PNG_P }], ids: ['mark1'] },
    });
    expect(saved.sketch).toEqual({ parts: [{ view: 'plugin', marks: 2 }] });
    const [back] = readSavedLines([
      {
        ...saved,
        sketch: {
          parts: [
            { view: 'plugin', marks: 2, text: 'x' },
            { view: 'bogus', marks: 1 },
          ],
        },
      },
    ]);
    expect(back!.sketch).toEqual({ parts: [{ view: 'plugin', marks: 2 }] });
    expect(lineForAi(back!)).toBe(
      '- LLM request: “make this bigger” [with a sketch: 2 marks on the plugin] → bigger',
    );
  });
});
