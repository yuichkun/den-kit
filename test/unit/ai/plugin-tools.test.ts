// The plugin screen for the LLM: what kit_get_plugin tells it, the reference by
// topic, and the shorthands kit_apply_ops accepts (addControl, bundled pictures
// by id), which become ordinary intents.
import { describe, expect, it } from 'vitest';
import { catalog } from '../../../src/blocks/index.ts';
import { starter } from '../../../src/core/starters.ts';
import { applyIntents, OpError } from '../../../src/core/ops.ts';
import { describePlugin, expandOps, uiReference, UI_TOPICS } from '../../../src/ai/plugin-tools.ts';
import { intersects } from '../../../src/plugin/edit.ts';
import { findWork } from '../../../src/showcase/index.ts';

describe('kit_get_plugin', () => {
  it('describes a work: size, look, everything back to front with exact fields, what each control drives', () => {
    const doc = findWork('space')!.build(catalog);
    const text = describePlugin(doc, catalog);
    expect(text).toContain('720×440 px');
    expect(text).toMatch(/Look tokens: bg #05040d, fg #e9e6ff, accent #8f7bff/);
    expect(text).toMatch(/Look background \(bottom first\): picture sc-starfield cover \| radial/);
    expect(text).toContain('knob ring (look: thickness 3, round true)');
    // Back to front: the part (the sky) first, the knobs last.
    const order = ['"id":"part1"', '"text":"NEBULA"', '"id":"ktime"', '"id":"ksky"'].map(s => text.indexOf(s));
    expect(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1]!))).toBe(true);
    expect(text).toMatch(/"id":"ktime","control":"knob","label":"Time","panel":\{"x":78,"y":308,"w":96,"h":104\},"skin":"ring \(own: thickness 3, ticks 0, round true, value \\"inside\\"\)"/);
    expect(text).toMatch(/"value":"420 ms","range":"80\.0 ms … 1\.40 s \(log\)","drives":\["→ echo1\.timeSeconds"\]/);
    expect(text).toContain('whole code: kit_get_plugin {\\"part\\":\\"part1\\"}');
    expect(text).toMatch(/Assets in this patch: sc-starfield \(picture 1600×1067: Night sky/);
    // One part's whole code on request.
    expect(describePlugin(doc, catalog, { part: 'part1' })).toContain('f.state.grains');
    expect(() => describePlugin(doc, catalog, { part: 'nope' })).toThrow(/Parts: part1/);
  });

  it('a plain patch: nothing on the plugin yet, theme tokens, controls kept off the plugin listed', () => {
    let doc = starter('bass', catalog);
    expect(describePlugin(doc, catalog)).toContain('(nothing yet)');
    expect(describePlugin(doc, catalog)).toContain('accent #ff9c1a (theme)');
    doc = applyIntents(doc, [{ op: 'addNode', node: { id: 'kq', type: 'ui.knob', label: 'Q', config: { min: 0.5, max: 8, scale: 'linear', unit: '' }, values: { value: 1 } } }, { op: 'connect', from: { node: 'kq', port: 'out' }, to: { node: 'filter1', port: 'resonance' } }], catalog).doc;
    expect(describePlugin(doc, catalog)).toMatch(/not on the plugin.*"id":"kq".*"drives":\["→ filter1\.resonance"\]/);
    expect(describePlugin(doc, catalog, { problems: ['text1 is hard to read'] })).toContain(' - text1 is hard to read');
  });
});

describe('kit_ui_reference', () => {
  it('has every topic, and skins narrow to one control kind', () => {
    for (const topic of UI_TOPICS) expect(uiReference(topic).length).toBeGreaterThan(200);
    expect(uiReference(undefined)).toContain('Topics');
    const knobs = uiReference('skins', 'knob');
    expect(knobs).toContain('chicken');
    expect(knobs).not.toContain('footswitch');
    expect(uiReference('skins')).toContain('footswitch');
    expect(uiReference('parts')).toMatch(/f\.setNorm\(id, 0\.\.1\)/);
    expect(uiReference('pictures')).toMatch(/sc-wood: Warm mid-brown wood grain/);
    expect(uiReference('fonts')).toContain('orbitron');
  });
});

describe('kit_apply_ops shorthands', () => {
  it('addControl: a knob wired to the input, with its range and unit, in free space; two in a row do not overlap', () => {
    const doc = starter('bass', catalog);
    const { intents, origin } = expandOps(doc, catalog, [
      { op: 'addControl', for: { node: 'filter1', port: 'resonance' }, label: 'Res' },
      { op: 'addControl', for: { node: 'aenv1', port: 'release' } },
      { op: 'addControl', for: { node: 'aenv1', port: 'gate' } },
    ]);
    expect(origin).toEqual([0, 0, 1, 1, 2, 2]);
    const after = applyIntents(doc, intents, catalog).doc;
    const k1 = after.nodes.knob1!, k2 = after.nodes.knob2!, t1 = after.nodes.toggle1!;
    expect([k1.type, k1.label, k1.config.min, k1.config.max]).toEqual(['ui.knob', 'Res', catalog.input(doc.nodes.filter1!, 'resonance')!.min, catalog.input(doc.nodes.filter1!, 'resonance')!.max]);
    expect(k1.values.value).toBeCloseTo(0.707);
    expect(k2.config.unit).toBe('s');
    expect(t1.type).toBe('ui.toggle');
    expect(Object.values(after.edges).some(e => e.from.node === 'knob1' && e.to.node === 'filter1' && e.to.port === 'resonance')).toBe(true);
    expect(intersects(k1.panel!, k2.panel!)).toBe(false);
    expect(intersects(k2.panel!, t1.panel!)).toBe(false);
    expect(k1.panel!.x).toBeGreaterThanOrEqual(16);
  });

  it('addControl refuses what cannot work, saying what to do', () => {
    const doc = starter('bass', catalog);
    const fail = (op: Record<string, unknown>) => { try { expandOps(doc, catalog, [{ op: 'setName', name: 'x' }, op]); } catch (e) { return e as OpError; } return null; };
    expect(fail({ op: 'addControl', for: { node: 'filter1', port: 'nope' } })?.message).toMatch(/no input "nope"\. Inputs: input, cutoff, resonance/);
    expect(fail({ op: 'addControl', for: { node: 'filter1', port: 'nope' } })?.index).toBe(1);
    expect(fail({ op: 'addControl', for: { node: 'filter1', port: 'input' } })?.message).toMatch(/audio input/);
    expect(fail({ op: 'addControl', for: { node: 'aenv1', port: 'gate' }, type: 'ui.knob' })?.message).toMatch(/on\/off: use ui\.toggle/);
    expect(fail({ op: 'addControl', for: { node: 'ghost', port: 'x' } })?.hint).toMatch(/"op":"addControl","for"/);
  });

  it('bundled pictures by id: added to the patch once, before the edit that uses them', () => {
    const doc = starter('bass', catalog);
    const { intents, origin } = expandOps(doc, catalog, [
      { op: 'setLook', look: { background: [{ kind: 'image', asset: 'sc-wood', fit: 'cover' }] } },
      { op: 'addAsset', asset: { id: 'sc-brass' } },
      { op: 'addElement', element: { kind: 'image', asset: 'sc-wood', fit: 'cover', rect: { x: 0, y: 0, w: 10, h: 10 } } },
    ]);
    expect(intents.map(i => i.op)).toEqual(['addAsset', 'setLook', 'addAsset', 'addElement']);
    expect(origin).toEqual([0, 0, 1, 2]);
    const after = applyIntents(doc, intents, catalog).doc;
    expect(Object.keys(after.assets).sort()).toEqual(['sc-brass', 'sc-wood']);
    expect(after.assets['sc-wood']!.url).toBe('/showcase/wood.jpg');
    // Already in the patch: nothing added again.
    expect(expandOps(after, catalog, [{ op: 'setLook', look: { background: [{ kind: 'image', asset: 'sc-wood', fit: 'tile' }] } }]).intents.map(i => i.op)).toEqual(['setLook']);
  });
});
