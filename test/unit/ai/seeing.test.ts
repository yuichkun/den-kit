// What the person is looking at: the line every LLM request carries, the
// crop of a shared tab's frame to one view, and kit_look as "seen" with and
// without a shared screen.
import { describe, expect, it } from 'vite-plus/test';
import { catalog } from '../../../src/sound/blocks/index.ts';
import { starter } from '../../../src/work/starters.ts';
import { cropRect, noteName, seeingText } from '../../../src/ai/seeing.ts';
import {
  LlmWorkspace,
  type SeenResult,
  type WorkspaceDeps,
} from '../../../src/ai/llm-workspace.ts';

describe('what the person is looking at, in one line', () => {
  const doc = starter('bass', catalog);
  it('the patch: zoom, what is in sight, what is selected, the notes held, whether the screen is shared', () => {
    const text = seeingText(
      { view: 'patch', edit: false, full: false, zoom: 0.85, inView: ['osc1', 'filter1', 'cut1'] },
      doc,
      catalog,
      { selection: ['filter1'], held: [48, 52, 55], shared: false },
    );
    expect(text).toBe(
      'The person is looking at the patch (zoom 85%; in sight: osc1, filter1, cut1); selected: filter1 “Lowpass”; holding C3 E3 G3; their screen is not shared with you.',
    );
  });
  it('the plugin: playing or editing, full screen, its scale; inside a part; shared', () => {
    expect(
      seeingText({ view: 'plugin', edit: false, full: true, scale: 1.25 }, doc, catalog, {
        selection: [],
        held: [],
        shared: true,
      }),
    ).toBe(
      'The person is looking at the plugin, playing it (full screen) at 125% of its design size; they let you see their screen (kit_look with as "seen" shows it as they see it).',
    );
    expect(
      seeingText({ view: 'plugin', edit: true, full: false }, doc, catalog, {
        selection: [],
        held: [],
        shared: false,
      }),
    ).toMatch(/^The person is looking at the plugin, editing it;/);
    expect(
      seeingText({ view: 'patch', edit: false, full: false, zoom: 1, inView: [] }, doc, catalog, {
        selection: [],
        held: [],
        inside: 'drop',
        shared: false,
      }),
    ).toMatch(
      /^The person is looking at the patch inside part drop \(zoom 100%; no module in sight\)/,
    );
    expect(
      seeingText({ view: 'project', edit: false, full: false }, doc, catalog, {
        selection: [],
        held: [],
        shared: false,
      }),
    ).toMatch(/the screen project \(files and terminal\)/);
  });
  it('names notes the usual way', () => {
    expect([60, 61, 69, 21, 127].map(noteName)).toEqual(['C4', 'C♯4', 'A4', 'A0', 'G9']);
  });
});

describe('a view cut out of the shared tab', () => {
  it('maps page pixels to the frame (which may be scaled) and keeps the picture at most maxSide', () => {
    // A 2× frame of a 1000×700 window; the plugin at (200, 100) 600×400.
    expect(
      cropRect(
        { width: 2000, height: 1400 },
        { width: 1000, height: 700 },
        { x: 200, y: 100, width: 600, height: 400 },
        1280,
      ),
    ).toEqual({ sx: 400, sy: 200, sw: 1200, sh: 800, dw: 1200, dh: 800 });
    expect(
      cropRect(
        { width: 2000, height: 1400 },
        { width: 1000, height: 700 },
        { x: 0, y: 0, width: 1000, height: 700 },
        1000,
      ),
    ).toEqual({ sx: 0, sy: 0, sw: 2000, sh: 1400, dw: 1000, dh: 700 });
  });
  it('clips what lies off the frame', () => {
    expect(
      cropRect(
        { width: 1000, height: 700 },
        { width: 1000, height: 700 },
        { x: -50, y: 650, width: 200, height: 200 },
      ),
    ).toEqual({ sx: 0, sy: 650, sw: 150, sh: 50, dw: 150, dh: 50 });
  });
});

describe('kit_look as "seen"', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  function ws(seen: SeenResult, images = true) {
    const doc = starter('bass', catalog);
    let designLooks = 0;
    const deps = {
      catalog,
      images,
      read: () => doc,
      compile: async () => ({ ok: true, ms: 1 }),
      render: async () => {
        throw new Error('no');
      },
      land: () => ({ ok: true }),
      look: async () => {
        designLooks++;
        return { issues: [], png: null, width: 640, height: 360, ms: 1 };
      },
      seen: async () => seen,
    } as unknown as WorkspaceDeps;
    return { w: new LlmWorkspace(deps), looks: () => designLooks };
  }
  it('with the screen shared: the picture of what they see, and what they look at', async () => {
    const { w } = ws({
      text: 'The person is looking at the plugin, playing it.',
      looking: 'plugin',
      picture: { data: png, mime: 'image/png', width: 800, height: 450, source: 'tab' },
    });
    const r = await w.call('kit_look', { as: 'seen' });
    expect(r.text).toBe(
      'What the person sees now (plugin, 800×450, from their shared tab). The person is looking at the plugin, playing it. The picture is attached.',
    );
    expect(r.imageDataUrl).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
    expect(w.steps).toEqual(['looked at what you see (plugin)']);
  });
  it('not shared, looking at the plugin: says so and looks at the plugin re-drawn instead', async () => {
    const { w, looks } = ws({
      text: 'The person is looking at the plugin, playing it.',
      looking: 'plugin',
      reason: 'The person has not shared their screen with you (they can, in the AI panel).',
    });
    const r = await w.call('kit_look', { as: 'seen' });
    expect(r.text).toMatch(
      /^The person has not shared their screen with you \(they can, in the AI panel\)\. The person is looking at the plugin, playing it\.\nInstead, the plugin re-drawn at its design size \(not their screen\):\nLooked at the plugin/,
    );
    expect(looks()).toBe(1);
  });
  it('not shared, looking at the patch: no picture, the patch in words instead', async () => {
    const { w, looks } = ws({
      text: 'The person is looking at the patch (zoom 90%).',
      looking: 'patch',
      reason: 'The person has not shared their screen with you (they can, in the AI panel).',
    });
    const r = await w.call('kit_look', { as: 'seen' });
    expect(r.text).toMatch(
      /There is no picture of the patch: read the patch with kit_get_patch\.$/,
    );
    expect(r.imageDataUrl).toBeUndefined();
    expect(looks()).toBe(0);
  });
  it('a model without pictures gets the words only', async () => {
    const { w } = ws(
      {
        text: 'The person is looking at the patch.',
        looking: 'patch',
        picture: { data: png, mime: 'image/png', width: 10, height: 10, source: 'shell' },
      },
      false,
    );
    const r = await w.call('kit_look', { as: 'seen' });
    expect(r.text).toMatch(
      /from den-kit's window\)\. .* Your model does not take pictures, so there is none\.$/,
    );
    expect(r.imageDataUrl).toBeUndefined();
  });
});
