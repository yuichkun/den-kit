// The person's rough sketch, from the marks to the AI: marks belong where
// they were drawn (the plugin; the patch, or the part the person is inside);
// sending reads them (what each goes around, crosses or joins) and keeps them,
// dimmed, until the request ends; the LLM gets their words (in den-kit's notes)
// and pictures with the request or with what is added to it; pointing marks
// reach the LLM alongside the selection.
import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { AiRequests } from '../../../src/ai/requests.ts';
import { LlmController, type LlmTransport } from '../../../src/ai/llm.ts';
import type { WorkspaceDeps } from '../../../src/ai/llm-workspace.ts';
import { attachmentsOf } from '../../../src/ai/attachments.ts';
import { analyse } from '../../../src/sound/analysis.ts';
import { controlFor } from '../../../src/screen/controls.ts';
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
    expect(String(start.context)).toContain(`\n[den-kit] ${PLUGIN}`);
    expect(start.text).toBe('make this bigger');
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
    expect(String(steer.context)).toContain(`[den-kit] ${PATCH}`);
    expect(steer.text).toBe('and wire it like this');
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

describe('the prompt', () => {
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
    expect(String(start.context)).toContain('filter1 — Lowpass');
    expect(String(start.context)).toContain(PATCH);
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
    expect(String(start.context)).toContain(PLUGIN);
    expect(start.images).toEqual([PNG_P]);
    expect(session.sentMarks.value).toEqual({ [m.id]: o.id });
    t.done(o.id);
    await settle();
    expect(session.sketch.value.plugin).toEqual([]);
  });
});
