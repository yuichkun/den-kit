import { assetsOf } from '../../../src/work/ui.ts';
import { describe, expect, it } from 'vite-plus/test';
import { catalog } from '../../../src/sound/blocks/index.ts';
import {
  applyIntents,
  applyResolvedOps,
  invertAll,
  OpError,
  replaceOps,
  type Intent,
} from '../../../src/work/ops.ts';
import { History } from '../../../src/work/history.ts';
import { documentHash, parseDocument, serializeDocument } from '../../../src/work/persistence.ts';
import { PATCH_VERSION, emptyDocument, type PatchDocument } from '../../../src/work/schema.ts';
import { starter } from '../../../src/work/starters.ts';
import {
  isColor,
  sanitizeCss,
  stackOrder,
  withGroups,
  type AssetMeta,
} from '../../../src/work/ui.ts';
import { CONTROL_KINDS, DEFAULT_SKIN, SKINS, skinDef } from '../../../src/work/skins.ts';

const apply = (doc: PatchDocument, ...intents: Intent[]) => applyIntents(doc, intents, catalog);
const failure = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof OpError) return e;
    throw e;
  }
  throw new Error('expected OpError');
};
const wood: AssetMeta = {
  id: 'assets/wood.jpg',
  name: 'wood.jpg',
  mime: 'image/jpeg',
  hash: `sha256-${'a'.repeat(64)}`,
  bytes: 1000,
  width: 64,
  height: 64,
  source: { license: 'CC0' },
};
const font: AssetMeta = {
  id: 'assets/my.woff2',
  name: 'my.woff2',
  mime: 'font/woff2',
  bytes: 1000,
  hash: `sha256-${'b'.repeat(64)}`,
};
/** A patch with two knobs on the plugin, a toggle off it, and a picture. */
const base = () =>
  apply(
    emptyDocument('t', 't'),
    { op: 'addNode', node: { id: 'k1', type: 'ui.knob', panel: { x: 10, y: 10, w: 80, h: 90 } } },
    { op: 'addNode', node: { id: 'k2', type: 'ui.knob', panel: { x: 110, y: 10, w: 80, h: 90 } } },
    { op: 'addNode', node: { id: 'sw1', type: 'ui.toggle' } },
    { op: 'addAsset', asset: wood },
  ).doc;
const stack = (doc: PatchDocument) =>
  stackOrder(
    doc.ui,
    Object.values(doc.nodes)
      .filter(n => n.panel)
      .map(n => n.id),
  );
const undoes = (doc: PatchDocument, ...intents: Intent[]) => {
  const r = apply(doc, ...intents);
  expect({ ...applyResolvedOps(r.doc, invertAll(r.ops)), revision: 0 }).toEqual({
    ...doc,
    revision: 0,
  });
  return r;
};

describe('the plugin screen: decorations', () => {
  it('adds text, shapes, pictures, SVG, LEDs and canvases on top, each undoable', () => {
    let doc = base();
    const r = undoes(
      doc,
      {
        op: 'addElement',
        element: {
          kind: 'shape',
          shape: 'rect',
          rect: { x: 0, y: 0, w: 300, h: 200 },
          style: {
            fill: [
              { kind: 'image', asset: 'assets/wood.jpg', fit: 'tile', size: 128 },
              {
                kind: 'linear',
                angle: 180,
                stops: [
                  { color: '#0000', at: 0 },
                  { color: 'rgba(0,0,0,.4)', at: 1 },
                ],
              },
            ],
            radius: 12,
            shadows: [{ x: 0, y: 4, blur: 12, spread: 0, color: '#0008', inset: false }],
          },
        },
      },
      {
        op: 'addElement',
        element: {
          kind: 'text',
          text: 'CUTOFF {value}',
          bind: 'k1',
          rect: { x: 10, y: 110, w: 80, h: 20 },
          textStyle: {
            font: 'cinzel',
            size: 14,
            color: 'accent',
            case: 'upper',
            shadows: [{ x: 0, y: 1, blur: 0, color: '#fff6' }],
          },
        },
      },
      {
        op: 'addElement',
        element: {
          kind: 'image',
          asset: 'assets/wood.jpg',
          fit: 'cover',
          rect: { x: 200, y: 10, w: 40, h: 40 },
        },
      },
      {
        op: 'addElement',
        element: {
          kind: 'svg',
          svg: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>',
          rect: { x: 250, y: 10, w: 20, h: 20 },
        },
      },
      {
        op: 'addElement',
        element: {
          kind: 'led',
          bind: 'sw1',
          rect: { x: 280, y: 10, w: 12, h: 12 },
          color: '#ff3b30',
        },
      },
      {
        op: 'addElement',
        element: {
          kind: 'canvas',
          code: 'export default (ctx, f) => { ctx.fillRect(0, 0, f.w * f.level, f.h); };',
          rect: { x: 10, y: 140, w: 280, h: 40 },
          props: { speed: 2 },
        },
      },
    );
    expect(r.created).toEqual(['shape1', 'text1', 'image1', 'svg1', 'led1', 'canvas1']);
    doc = r.doc;
    // New things go on top of what was there (the knobs keep their place below).
    expect(stack(doc)).toEqual([
      'k1',
      'k2',
      'shape1',
      'text1',
      'image1',
      'svg1',
      'led1',
      'canvas1',
    ]);
    expect(doc.ui.elements.led1).toMatchObject({ kind: 'led', bind: 'sw1', threshold: 0.5 });
    // Ids are shared with modules: a module cannot take an element's id and the other way round.
    expect(
      failure(() => apply(doc, { op: 'addNode', node: { id: 'text1', type: 'den.lfo' } })).code,
    ).toBe('duplicate-id');
    expect(
      failure(() =>
        apply(doc, {
          op: 'addElement',
          element: { kind: 'text', id: 'k1', text: 'x', rect: { x: 0, y: 0, w: 1, h: 1 } },
        }),
      ).code,
    ).toBe('duplicate-id');
    expect(apply(doc, { op: 'addNode', node: { type: 'den.lfo' } }).created).toEqual(['lfo1']);
  });

  it('refuses what cannot be drawn safely and names the choices; the document stays as it was', () => {
    const doc = base(),
      before = JSON.stringify(doc);
    const add = (element: Record<string, unknown>) =>
      failure(() =>
        apply(doc, {
          op: 'addElement',
          element: { rect: { x: 0, y: 0, w: 10, h: 10 }, ...element } as never,
        }),
      );
    expect(
      add({ kind: 'text', text: 'x', textStyle: { color: 'red; background: url(http://evil)' } })
        .code,
    ).toBe('bad-color');
    expect(add({ kind: 'shape', style: { fill: [{ kind: 'color', color: 'url(x)' }] } }).code).toBe(
      'bad-color',
    );
    expect(add({ kind: 'image', asset: 'assets/nope.png', fit: 'cover' })).toMatchObject({
      code: 'unknown-asset',
      hint: expect.stringContaining('wood'),
    });
    expect(add({ kind: 'text', text: 'x', textStyle: { font: 'papyrus' } })).toMatchObject({
      code: 'bad-font',
      hint: expect.stringContaining('caveat'),
    });
    expect(add({ kind: 'text', text: 'x', textStyle: { font: 'assets/wood.jpg' } }).code).toBe(
      'bad-asset',
    ); // a picture is not a font
    expect(add({ kind: 'svg', svg: '<script>alert(1)</script>' }).code).toBe('bad-svg');
    expect(add({ kind: 'canvas', code: 'function draw() {}' }).code).toBe('bad-code');
    expect(add({ kind: 'led', bind: 'ghost' }).code).toBe('unknown-node');
    expect(add({ kind: 'text', text: 'x', bind: '@level' }).code).toBe('bad-bind');
    expect(add({ kind: 'blob' })).toMatchObject({
      code: 'bad-value',
      message: expect.stringContaining('text, shape'),
    });
    expect(add({ kind: 'text', text: 'x', colour: 'red' })).toMatchObject({
      code: 'bad-element',
      hint: expect.stringContaining('textStyle'),
    });
    expect(
      failure(() =>
        apply(doc, {
          op: 'addElement',
          element: { kind: 'text', text: 'x', rect: { x: 0, y: 0, w: 0, h: 10 } },
        }),
      ).code,
    ).toBe('bad-rect');
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('colours: tokens, hex, rgb()/hsl() with plain numbers and CSS names; nothing else', () => {
    for (const c of [
      'accent',
      'bg',
      '#fff',
      '#ffffff80',
      'rgb(1, 2, 3)',
      'rgba(0,0,0,.5)',
      'hsl(200 50% 40% / .5)',
      'goldenrod',
      'transparent',
    ])
      expect(isColor(c), c).toBe(true);
    for (const c of [
      'url(x)',
      'red;',
      'var(--x)',
      'expression(alert(1))',
      'rgb(1,2,3);color:red',
      '',
      '#12345',
      'calc(1px)',
    ])
      expect(isColor(c), c).toBe(false);
  });

  it('updates fields, clears optional ones with null, and keeps kind-specific fields to their kind', () => {
    const doc = apply(base(), {
      op: 'addElement',
      element: {
        kind: 'text',
        text: 'Hi',
        rect: { x: 0, y: 0, w: 40, h: 20 },
        textStyle: { size: 12 },
      },
    }).doc;
    const r = undoes(doc, {
      op: 'updateElement',
      id: 'text1',
      set: { text: 'Hello', textStyle: null, locked: true },
    });
    expect(r.doc.ui.elements.text1).toEqual({
      id: 'text1',
      kind: 'text',
      text: 'Hello',
      rect: { x: 0, y: 0, w: 40, h: 20 },
      locked: true,
    });
    expect(r.ops.map(o => (o.op === 'setElement' ? o.field : o.op))).toEqual([
      'text',
      'textStyle',
      'locked',
    ]);
    expect(
      failure(() => apply(doc, { op: 'updateElement', id: 'text1', set: { shape: 'ellipse' } }))
        .code,
    ).toBe('bad-element');
    expect(
      failure(() => apply(doc, { op: 'updateElement', id: 'text1', set: { kind: 'shape' } })).code,
    ).toBe('bad-element');
    expect(failure(() => apply(doc, { op: 'updateElement', id: 'nope', set: {} })).code).toBe(
      'unknown-element',
    );
    expect(apply(doc, { op: 'updateElement', id: 'text1', set: { text: 'Hi' } }).ops).toEqual([]);
  });

  it('setRect moves and resizes decorations and widgets alike', () => {
    const doc = apply(base(), {
      op: 'addElement',
      element: { kind: 'shape', rect: { x: 0, y: 0, w: 40, h: 20 } },
    }).doc;
    const r = undoes(
      doc,
      { op: 'setRect', id: 'shape1', rect: { x: 5, y: 6, w: 7, h: 8 } },
      { op: 'setRect', id: 'k1', rect: { x: 1, y: 2, w: 60, h: 70 } },
    );
    expect(r.doc.ui.elements.shape1!.rect).toEqual({ x: 5, y: 6, w: 7, h: 8 });
    expect(r.doc.nodes.k1!.panel).toEqual({ x: 1, y: 2, w: 60, h: 70 });
    expect(
      failure(() => apply(doc, { op: 'setRect', id: 'ghost', rect: { x: 0, y: 0, w: 1, h: 1 } }))
        .code,
    ).toBe('unknown-id');
  });

  it('removing a decoration or a module, or taking a widget off the plugin, leaves the order and groups clean (and undo restores them)', () => {
    let doc = apply(
      base(),
      { op: 'addElement', element: { kind: 'shape', rect: { x: 0, y: 0, w: 40, h: 20 } } },
      {
        op: 'addElement',
        element: { kind: 'text', text: 'a', rect: { x: 0, y: 0, w: 40, h: 20 } },
      },
    ).doc;
    doc = apply(doc, { op: 'group', ids: ['k1', 'shape1', 'text1'] }).doc;
    expect(doc.ui.groups).toEqual({ group1: ['k1', 'shape1', 'text1'] });
    let r = undoes(doc, { op: 'removeElement', id: 'shape1' });
    expect(r.doc.ui.groups).toEqual({ group1: ['k1', 'text1'] });
    expect(r.doc.ui.order).not.toContain('shape1');
    r = undoes(r.doc, { op: 'removeNode', id: 'k1' }); // the group is down to one: it dissolves
    expect(r.doc.ui.groups).toEqual({});
    r = undoes(doc, { op: 'setPanel', node: 'k2', panel: null });
    expect(stack(r.doc)).not.toContain('k2');
  });
});

describe('the plugin screen: stacking and groups', () => {
  const four = () =>
    apply(
      base(),
      ...['a', 'b'].map(id => ({
        op: 'addElement' as const,
        element: { kind: 'shape' as const, id, rect: { x: 0, y: 0, w: 10, h: 10 } },
      })),
    ).doc;
  it('front, back, forward and backward move the selection past its neighbours, keeping its own order', () => {
    const doc = four();
    expect(stack(doc)).toEqual(['k1', 'k2', 'a', 'b']);
    expect(stack(undoes(doc, { op: 'arrange', ids: ['k1'], to: 'front' }).doc)).toEqual([
      'k2',
      'a',
      'b',
      'k1',
    ]);
    expect(stack(undoes(doc, { op: 'arrange', ids: ['b', 'a'], to: 'back' }).doc)).toEqual([
      'a',
      'b',
      'k1',
      'k2',
    ]);
    expect(stack(undoes(doc, { op: 'arrange', ids: ['k1', 'k2'], to: 'forward' }).doc)).toEqual([
      'a',
      'k1',
      'k2',
      'b',
    ]);
    expect(stack(undoes(doc, { op: 'arrange', ids: ['b'], to: 'backward' }).doc)).toEqual([
      'k1',
      'k2',
      'b',
      'a',
    ]);
    expect(apply(doc, { op: 'arrange', ids: ['b'], to: 'front' }).ops).toEqual([]);
    expect(failure(() => apply(doc, { op: 'arrange', ids: ['sw1'], to: 'front' })).code).toBe(
      'unknown-id',
    ); // not on the plugin
  });
  it('a widget placed later is drawn on top; an element added after that is above it', () => {
    let doc = four();
    doc = apply(doc, { op: 'setPanel', node: 'sw1', panel: { x: 0, y: 0, w: 40, h: 40 } }).doc;
    expect(stack(doc)).toEqual(['k1', 'k2', 'a', 'b', 'sw1']);
    doc = apply(doc, {
      op: 'addElement',
      element: { kind: 'shape', id: 'c', rect: { x: 0, y: 0, w: 10, h: 10 } },
    }).doc;
    expect(stack(doc)).toEqual(['k1', 'k2', 'a', 'b', 'sw1', 'c']);
  });
  it('groups: one group per thing, regrouping moves members, ungroup dissolves; selecting one means all', () => {
    let doc = four();
    doc = undoes(doc, { op: 'group', ids: ['a', 'b'] }).doc;
    doc = apply(doc, { op: 'group', ids: ['b', 'k1'], id: 'pair' }).doc;
    expect(doc.ui.groups).toEqual({ pair: ['b', 'k1'] }); // group1 lost b and dissolved
    expect(withGroups(doc.ui, ['k1']).sort()).toEqual(['b', 'k1']);
    expect(failure(() => apply(doc, { op: 'group', ids: ['a'] })).code).toBe('bad-intent');
    expect(failure(() => apply(doc, { op: 'group', ids: ['a', 'k2'], id: 'k1' })).code).toBe(
      'duplicate-id',
    );
    doc = undoes(doc, { op: 'ungroup', id: 'pair' }).doc;
    expect(doc.ui.groups).toEqual({});
  });
});

describe('the plugin screen: look, widget styles, size, assets, underlay', () => {
  it('setLook merges tokens and skins key by key, replaces background and css, and checks everything', () => {
    let doc = base();
    doc = undoes(doc, {
      op: 'setLook',
      look: {
        tokens: { accent: '#39ff14', bg: '#050505', valueFont: 'jetbrains-mono' },
        skins: { knob: { name: 'ring', params: { thickness: 8 } } },
      },
    }).doc;
    doc = undoes(doc, {
      op: 'setLook',
      look: {
        tokens: { bg: null, fg: 'white' },
        background: [{ kind: 'image', asset: 'assets/wood.jpg', fit: 'cover' }],
        css: 'dk-knob::part(label){letter-spacing:.2em}',
      },
    }).doc;
    expect(doc.ui.look).toEqual({
      tokens: { accent: '#39ff14', valueFont: 'jetbrains-mono', fg: 'white' },
      skins: { knob: { name: 'ring', params: { thickness: 8 } } },
      background: [{ kind: 'image', asset: 'assets/wood.jpg', fit: 'cover' }],
      css: 'dk-knob::part(label){letter-spacing:.2em}',
    });
    expect(
      failure(() => apply(doc, { op: 'setLook', look: { tokens: { shine: '#fff' } } })).hint,
    ).toContain('accent');
    expect(
      failure(() => apply(doc, { op: 'setLook', look: { skins: { knob: { name: 'wobbly' } } } }))
        .hint,
    ).toContain('ring');
    expect(
      failure(() =>
        apply(doc, {
          op: 'setLook',
          look: { skins: { knob: { name: 'ring', params: { glow: 1 } } } },
        }),
      ).hint,
    ).toContain('thickness');
    expect(
      failure(() =>
        apply(doc, {
          op: 'setLook',
          look: { skins: { knob: { name: 'image', params: { cap: 'assets/nope.png' } } } },
        }),
      ).code,
    ).toBe('unknown-asset');
    const replaced = undoes(doc, {
      op: 'setLook',
      look: { tokens: { accent: 'red' }, skins: {} },
      replace: true,
    }).doc;
    expect(replaced.ui.look).toEqual({ tokens: { accent: 'red' }, skins: {} });
    // A look change is not structural: it merges into one undo step while dragging a colour.
    const history = new History();
    let d = doc;
    for (const c of ['#100', '#200', '#300']) {
      const r = apply(d, { op: 'setLook', look: { tokens: { accent: c } } });
      history.record({
        id: c,
        author: { kind: 'human' },
        label: 'colour',
        ops: r.ops,
        at: 0,
        gesture: 'g',
        baseRevision: d.revision,
      });
      d = r.doc;
    }
    expect(history.size).toBe(1);
    const undone = history.undo(d);
    if (!undone || 'error' in undone) throw new Error('undo failed');
    expect(undone.doc.ui.look).toEqual(doc.ui.look);
  });
  it('widget styles: skin by control kind, colour tokens, a box and text; only on widgets', () => {
    const doc = base();
    const r = undoes(doc, {
      op: 'setStyle',
      node: 'k1',
      style: {
        skin: { name: 'cap', params: { shape: 'chicken', ticks: 11 } },
        tokens: { accent: 'gold' },
        style: { radius: 8, fill: [{ kind: 'color', color: '#222' }] },
        textStyle: { font: 'oswald', case: 'upper' },
      },
    });
    expect(r.doc.nodes.k1!.style!.skin).toEqual({
      name: 'cap',
      params: { shape: 'chicken', ticks: 11 },
    });
    expect(
      failure(() => apply(doc, { op: 'setStyle', node: 'sw1', style: { skin: { name: 'ring' } } }))
        .hint,
    ).toContain('footswitch'); // a toggle has no ring
    const lfo = apply(doc, { op: 'addNode', node: { id: 'l1', type: 'den.lfo' } }).doc;
    expect(failure(() => apply(lfo, { op: 'setStyle', node: 'l1', style: {} })).code).toBe(
      'not-widget',
    );
    expect(
      undoes(r.doc, { op: 'setStyle', node: 'k1', style: null }).doc.nodes.k1!.style,
    ).toBeUndefined();
    // Styles travel with a node (paste, AI): addNode checks them too.
    expect(
      failure(() =>
        apply(doc, { op: 'addNode', node: { type: 'ui.knob', style: { skin: { name: 'nope' } } } }),
      ).code,
    ).toBe('bad-skin');
  });
  it('the plugin size is clamped and undoable', () => {
    const r = undoes(base(), { op: 'setPanelSize', width: 360, height: 99999 });
    expect(r.doc.panel).toMatchObject({ width: 360, height: 4000 });
  });
  it('assets: checked, only den-kit paths as urls, and not removable while in use', () => {
    let doc = base();
    expect(
      failure(() =>
        apply(doc, {
          op: 'addAsset',
          asset: { ...wood, id: 'assets/x2.jpg', url: 'https://example.com/a.jpg' },
        }),
      ).code,
    ).toBe('bad-asset');
    expect(
      failure(() =>
        apply(doc, { op: 'addAsset', asset: { ...wood, id: 'assets/x3', mime: 'html' } }),
      ).code,
    ).toBe('bad-asset');
    expect(
      failure(() => apply(doc, { op: 'addAsset', asset: { ...wood, id: 'wood.jpg' } })).code,
    ).toBe('bad-asset'); // an asset lives under assets/
    expect(
      failure(() =>
        apply(doc, { op: 'addAsset', asset: { ...wood, id: 'assets/x4.jpg', bytes: 9e9 } }),
      ).code,
    ).toBe('too-large');
    expect(apply(doc, { op: 'addAsset', asset: wood }).ops).toEqual([]); // the same asset again is nothing
    doc = apply(
      doc,
      { op: 'addAsset', asset: font },
      {
        op: 'addElement',
        element: {
          kind: 'image',
          asset: 'assets/wood.jpg',
          fit: 'cover',
          rect: { x: 0, y: 0, w: 9, h: 9 },
        },
      },
      { op: 'setLook', look: { tokens: { font: 'assets/my.woff2' } } },
    ).doc;
    expect(
      failure(() => apply(doc, { op: 'removeAsset', id: 'assets/wood.jpg' })).message,
    ).toContain('image1');
    expect(
      failure(() => apply(doc, { op: 'removeAsset', id: 'assets/my.woff2' })).message,
    ).toContain('font token');
    const renamed = undoes(doc, {
      op: 'updateAsset',
      id: 'assets/wood.jpg',
      set: { name: 'Oak', source: { title: 'Oak', license: 'CC0', url: 'https://ambientcg.com' } },
    }).doc;
    // Renaming moves the file, and everything that showed it follows.
    expect(assetsOf(renamed.files)['assets/wood.jpg']).toBeUndefined();
    expect(assetsOf(renamed.files)['assets/Oak']).toMatchObject({
      name: 'Oak',
      source: { license: 'CC0' },
    });
    expect(Object.values(renamed.ui.elements).find(e => e.kind === 'image')).toMatchObject({
      asset: 'assets/Oak',
    });
    const freed = apply(doc, { op: 'removeElement', id: 'image1' }).doc;
    expect(
      assetsOf(undoes(freed, { op: 'removeAsset', id: 'assets/wood.jpg' }).doc.files)[
        'assets/wood.jpg'
      ],
    ).toBeUndefined();
  });
  it('the underlay is a picture asset with an opacity, shown only while editing', () => {
    const r = undoes(base(), {
      op: 'setUnderlay',
      underlay: { asset: 'assets/wood.jpg', opacity: 2, visible: true },
    });
    expect(r.doc.ui.underlay).toEqual({ asset: 'assets/wood.jpg', opacity: 1, visible: true });
    expect(
      failure(() =>
        apply(base(), {
          op: 'setUnderlay',
          underlay: { asset: 'nope', opacity: 0.4, visible: true },
        }),
      ).code,
    ).toBe('unknown-asset');
  });
});

describe('the plugin screen: saving and loading', () => {
  const rich = () =>
    apply(
      base(),
      {
        op: 'setLook',
        look: {
          tokens: { accent: '#ff9c1a', labelFont: 'oswald' },
          background: [
            {
              kind: 'radial',
              x: 0.5,
              y: 0.2,
              stops: [
                { color: '#333', at: 0 },
                { color: '#111', at: 1 },
              ],
            },
          ],
          skins: { knob: { name: 'cap' } },
        },
      },
      {
        op: 'setStyle',
        node: 'k2',
        style: { skin: { name: 'image', params: { cap: 'assets/wood.jpg' } } },
      },
      {
        op: 'addElement',
        element: { kind: 'text', text: 'den', rect: { x: 0, y: 0, w: 50, h: 20 } },
      },
      {
        op: 'addElement',
        element: { kind: 'led', bind: 'sw1', rect: { x: 0, y: 30, w: 10, h: 10 } },
      },
      { op: 'group', ids: ['text1', 'k1'] },
      { op: 'setUnderlay', underlay: { asset: 'assets/wood.jpg', opacity: 0.3, visible: false } },
      { op: 'setPanelSize', width: 420, height: 260 },
    ).doc;
  it('export → import keeps everything; the record names file contents by hash only', () => {
    const doc = rich();
    const parsed = parseDocument(serializeDocument(doc), catalog);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.report).toEqual([]);
    expect(documentHash(parsed.doc)).toBe(documentHash(doc));
    expect(JSON.parse(serializeDocument(doc)).files['assets/wood.jpg']).toEqual({
      hash: wood.hash,
      bytes: 1000,
      type: 'image/jpeg',
      width: 64,
      height: 64,
      source: { license: 'CC0' },
    });
  });
  it('an element kind den-kit does not have ("part", a canvas in an earlier preview) is left out of a file and refused in an edit, with the kinds there are', () => {
    const doc = apply(base(), {
      op: 'addElement',
      element: {
        kind: 'canvas',
        code: 'export default () => {};',
        rect: { x: 0, y: 0, w: 40, h: 40 },
      },
    }).doc;
    const old = JSON.parse(serializeDocument(doc));
    old.ui.elements.canvas1.kind = 'part';
    const parsed = parseDocument(JSON.stringify(old), catalog);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.doc.ui.elements.canvas1).toBeUndefined();
    expect(parsed.report).toEqual([
      expect.objectContaining({
        code: 'dropped-element',
        message: expect.stringMatching(/canvas/),
      }),
    ]);
    expect(() =>
      applyIntents(
        base(),
        [
          {
            op: 'addElement',
            element: {
              kind: 'part' as never,
              code: 'export default () => {};',
              rect: { x: 0, y: 0, w: 40, h: 40 },
            },
          },
        ],
        catalog,
      ),
    ).toThrow(/element kind must be one of .*canvas/);
  });
  it('documents of earlier previews are refused, not half-read', () => {
    const v1 = JSON.parse(serializeDocument(starter('bass', catalog)));
    delete v1.ui;
    v1.version = 1;
    expect(parseDocument(JSON.stringify(v1), catalog)).toMatchObject({ ok: false });
  });
  it('a document without a plugin screen loads with an empty one', () => {
    const v1 = JSON.parse(serializeDocument(starter('bass', catalog)));
    delete v1.ui;
    const parsed = parseDocument(JSON.stringify(v1), catalog);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.doc.version).toBe(PATCH_VERSION);
    expect(parsed.doc.ui).toEqual({
      look: { tokens: {}, skins: {} },
      elements: {},
      order: [],
      groups: {},
    });
    expect(assetsOf(parsed.doc.files)).toEqual({});
  });
  it('repairs what it can and reports the rest: bad elements, styles, assets, groups, data; missing pictures stay referenced', () => {
    const raw = JSON.parse(serializeDocument(rich()));
    raw.ui.elements.bad1 = {
      kind: 'text',
      text: 'x',
      rect: { x: 0, y: 0, w: 1, h: 1 },
      textStyle: { color: 'url(evil)' },
    };
    raw.ui.elements.k1 = { kind: 'text', text: 'clash', rect: { x: 0, y: 0, w: 1, h: 1 } }; // a module's id
    raw.ui.elements.img9 = {
      kind: 'image',
      asset: 'assets/gone.png',
      fit: 'cover',
      rect: { x: 0, y: 0, w: 1, h: 1 },
    };
    raw.ui.groups.g9 = ['text1', 'ghost'];
    raw.ui.order.push('ghost');
    raw.nodes.k1.style = { skin: { name: 'nope' } };
    raw.files['assets/evil.png'] = {
      type: 'image/png',
      bytes: 1,
      url: 'https://evil.example/x.png',
    };
    const parsed = parseDocument(JSON.stringify(raw), catalog);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.report.map(i => i.code).sort()).toEqual(
      [
        'dropped-file',
        'dropped-element',
        'dropped-element',
        'dropped-group',
        'dropped-style',
        'missing-reference',
      ].sort(),
    );
    expect(Object.keys(parsed.doc.ui.elements).sort()).toEqual(['img9', 'led1', 'text1']);
    expect(parsed.doc.ui.order).not.toContain('ghost');
    expect(parsed.doc.ui.groups).toEqual({ group1: ['text1', 'k1'] });
    expect(parsed.doc.nodes.k1!.style).toBeUndefined();
  });
  it('replacing the whole document (loading) is one undoable step that restores the plugin screen', () => {
    const before = rich(),
      after = starter('pad', catalog);
    const ops = replaceOps(before, after);
    const loaded = applyResolvedOps(before, ops);
    expect(documentHash({ ...loaded, revision: 0 })).toBe(documentHash({ ...after, revision: 0 }));
    expect(documentHash(applyResolvedOps(loaded, invertAll(ops)))).toBe(documentHash(before));
  });
});

describe('skins', () => {
  it('every skin parameter has one id, a default of its kind, and a doc line', () => {
    for (const def of SKINS) {
      const ids = def.params.map(p => p.id);
      expect(new Set(ids).size, `${def.control}.${def.name}`).toBe(ids.length);
      for (const p of def.params) {
        expect(p.doc.length, `${def.name}.${p.id}`).toBeGreaterThan(3);
        if (p.kind === 'color') expect(isColor(p.default), `${def.name}.${p.id}`).toBe(true);
        if (p.kind === 'enum') expect(p.options).toContain(p.default);
        if (p.kind === 'number') expect(p.default as number).toBeGreaterThanOrEqual(p.min!);
      }
    }
    for (const control of CONTROL_KINDS)
      expect(skinDef(control, DEFAULT_SKIN[control]), control).toBeDefined();
  });
});

describe('plugin CSS', () => {
  it("drops imports and every url() except the patch's own assets, and cannot close the style element", () => {
    const css =
      '@import url(https://x/y.css); .a{background:url(https://evil/p.png)} .b{background:url("asset:assets/wood.jpg")} .c{background:url(asset:gone)}/* x */</style><script>';
    const out = sanitizeCss(css, id =>
      id === 'assets/wood.jpg' ? 'blob:http://localhost/123' : null,
    );
    expect(out).not.toContain('@import');
    expect(out).not.toContain('evil');
    expect(out).toContain('url("blob:http://localhost/123")');
    expect(out).toContain('.c{background:none}');
    expect(out).not.toMatch(/<\/?style/i);
  });
});

describe('random plugin edits always undo exactly', () => {
  it('property: 4000 random edits of the plugin screen, each inverted back to the same document', () => {
    let seed = 7;
    const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
    const colors = ['accent', '#123', 'red', 'rgba(1,2,3,.5)', 'bogus'];
    let doc = base(),
      applied = 0;
    for (let step = 0; step < 4000; step++) {
      const ids = [...Object.keys(doc.ui.elements), 'k1', 'k2', 'sw1', 'ghost'];
      const rect = {
        x: rand() * 400,
        y: rand() * 300,
        w: 1 + rand() * 100,
        h: rand() < 0.05 ? 0 : 1 + rand() * 100,
      };
      const intent: Intent = pick([
        () => ({
          op: 'addElement',
          element: pick([
            { kind: 'shape', rect, style: { fill: [{ kind: 'color', color: pick(colors) }] } },
            { kind: 'text', text: 'x', rect, textStyle: { color: pick(colors) } },
            { kind: 'led', bind: pick(['sw1', 'k1', '@level', 'ghost']), rect },
            {
              kind: 'image',
              asset: pick(['assets/wood.jpg', 'assets/nope.png']),
              fit: 'cover',
              rect,
            },
          ]),
        }),
        () => ({ op: 'removeElement', id: pick(ids) }),
        () => ({
          op: 'updateElement',
          id: pick(ids),
          set: pick([
            { rect },
            { hidden: rand() < 0.5 },
            { style: { opacity: rand() } },
            { name: null },
          ]),
        }),
        () => ({ op: 'setRect', id: pick(ids), rect }),
        () => ({
          op: 'arrange',
          ids: [pick(ids)],
          to: pick(['front', 'back', 'forward', 'backward'] as const),
        }),
        () => ({ op: 'group', ids: [pick(ids), pick(ids), pick(ids)] }),
        () => ({ op: 'ungroup', id: pick([...Object.keys(doc.ui.groups), 'nope']) }),
        () => ({
          op: 'setLook',
          look: { tokens: { [pick(['accent', 'bg', 'fg'])]: rand() < 0.3 ? null : pick(colors) } },
        }),
        () => ({
          op: 'setStyle',
          node: pick(['k1', 'k2', 'sw1']),
          style: rand() < 0.3 ? null : { tokens: { accent: pick(colors) } },
        }),
        () => ({
          op: 'setPanel',
          node: pick(['k1', 'k2', 'sw1']),
          panel: rand() < 0.4 ? null : rect,
        }),
        () => ({ op: 'removeNode', id: pick(['k1', 'k2', 'sw1']) }),
        () => ({ op: 'setPanelSize', width: rand() * 2000, height: rand() * 2000 }),
      ] as Array<() => Intent>)();
      try {
        const r = applyIntents(doc, [intent], catalog);
        expect({ ...applyResolvedOps(r.doc, invertAll(r.ops)), revision: 0 }).toEqual({
          ...doc,
          revision: 0,
        });
        doc = r.doc;
        applied++;
        // Invariants: order and groups only name things that exist; nobody is in two groups.
        const present = new Set([...Object.keys(doc.nodes), ...Object.keys(doc.ui.elements)]);
        for (const id of doc.ui.order) expect(present.has(id)).toBe(true);
        const members = Object.values(doc.ui.groups).flat();
        expect(new Set(members).size).toBe(members.length);
        for (const id of members) expect(present.has(id)).toBe(true);
      } catch (error) {
        if (!(error instanceof OpError)) throw error;
      }
      if (
        !doc.nodes.k1 ||
        !doc.nodes.k2 ||
        !doc.nodes.sw1 ||
        Object.keys(doc.ui.elements).length > 60
      )
        doc = base();
    }
    expect(applied).toBeGreaterThan(1500);
  });
});
