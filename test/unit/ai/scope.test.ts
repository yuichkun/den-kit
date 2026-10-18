// Members' scopes (U8): what a member may change, what the lead may not change
// while members work, and the seam (the controls and their cables) nobody but
// the lead removes or rewires. Edits are written the way the LLM sends them.
import { describe, expect, it } from 'vite-plus/test';
import { catalog } from '../../../src/blocks/index.ts';
import { starter } from '../../../src/core/starters.ts';
import { applyIntents } from '../../../src/core/ops.ts';
import type { PatchDocument } from '../../../src/core/schema.ts';
import { expandOps } from '../../../src/ai/plugin-tools.ts';
import { changes, describeScope, heldByMembers, made, outside, parseScope, scopesOverlap, seamOf, shortScope, touched, type Holding, type Scope } from '../../../src/ai/scope.ts';

const edit = (doc: PatchDocument, ops: unknown[]) => applyIntents(doc, expandOps(doc, catalog, ops).intents, catalog).doc;
/** The bass starter with two controls on the plugin and a title. */
function base(): PatchDocument {
  return edit(starter('bass', catalog), [
    { op: 'addControl', for: { node: 'cut1', port: 'hz' }, label: 'Cutoff', panel: { x: 24, y: 96, w: 84, h: 96 } },
    { op: 'addControl', for: { node: 'filter1', port: 'resonance' }, label: 'Q', panel: { x: 400, y: 96, w: 84, h: 96 } },
    { op: 'addElement', element: { id: 'title1', kind: 'text', text: 'ACID', rect: { x: 24, y: 16, w: 200, h: 40 } } },
    { op: 'addElement', element: { id: 'plate1', kind: 'shape', shape: 'rect', rect: { x: 380, y: 80, w: 220, h: 140 } } },
  ]);
}
const controls = (doc: PatchDocument) => Object.values(doc.nodes).filter(n => n.type.startsWith('ui.')).map(n => n.id);
function hold(doc: PatchDocument, scope: Scope, owned: string[] = []): Holding { return { scope, owned: new Set(owned), seam: seamOf(doc, catalog) }; }
const scopeOf = (doc: PatchDocument, value: unknown) => { const r = parseScope(value, doc); if ('error' in r) throw new Error(r.error); return r.scope; };

describe('a scope as the lead writes it', () => {
  it('reads the forms and refuses unknown ids, empty scopes and bad areas', () => {
    const doc = base();
    expect(scopeOf(doc, { sound: 'all' })).toEqual({ sound: 'all' });
    expect(scopeOf(doc, { screen: { area: { x: 0, y: 0, w: 360, h: 240 } }, project: 'all' })).toEqual({ screen: { area: { x: 0, y: 0, w: 360, h: 240 } }, project: 'all' });
    expect(scopeOf(doc, { sound: { nodes: ['filter1', 'filter1', 'cut1'] } })).toEqual({ sound: { nodes: ['filter1', 'cut1'] } });
    expect(parseScope({ sound: { nodes: ['filtr1'] } }, doc)).toMatchObject({ error: expect.stringMatching(/do not exist: filtr1/) });
    expect(parseScope({ sound: { parts: ['drop'] } }, doc)).toMatchObject({ error: expect.stringMatching(/parts that do not exist: drop/) });
    expect(parseScope({ screen: { area: { x: 0, y: 0, w: 0, h: 10 } } }, doc)).toMatchObject({ error: expect.stringMatching(/area/) });
    expect(parseScope({ screen: { elements: ['ghost1'] } }, doc)).toMatchObject({ error: expect.stringMatching(/not on the plugin: ghost1/) });
    expect(parseScope({}, doc)).toMatchObject({ error: expect.stringMatching(/empty/) });
    expect(parseScope({ sound: 'all', colour: 'red' }, doc)).toMatchObject({ error: expect.stringMatching(/unknown keys: colour/) });
    expect(parseScope('all', doc)).toMatchObject({ error: expect.stringMatching(/object/) });
  });
  it('a group stands for its members', () => {
    let doc = base();
    doc = edit(doc, [{ op: 'group', ids: ['title1', 'plate1'] }]);
    const group = Object.keys(doc.ui.groups)[0]!;
    expect(scopeOf(doc, { screen: { elements: [group] } })).toEqual({ screen: { elements: [group, 'title1', 'plate1'] } });
  });
  it('says what it holds, in full and in a few words', () => {
    expect(describeScope({ sound: 'all', project: 'all' })).toBe('the sound (the whole patch); the screen project in the pod');
    expect(describeScope({ screen: { area: { x: 0, y: 0, w: 360, h: 200 } } })).toBe('on the plugin screen the area x 0, y 0, 360×200 (and what it adds there)');
    expect(shortScope({ sound: { nodes: ['a1'] }, screen: 'all' })).toBe('part of the sound + screen');
  });
});

describe('scopes held at the same time', () => {
  const doc = base();
  it('the sound and the screen do not overlap; two holders of one thing do', () => {
    expect(scopesOverlap({ sound: 'all' }, { screen: 'all' }, doc)).toBeNull();
    expect(scopesOverlap({ sound: 'all' }, { sound: { nodes: ['osc1'] } }, doc)).toBe('both hold the sound');
    expect(scopesOverlap({ sound: { nodes: ['osc1', 'filter1'] } }, { sound: { nodes: ['filter1'] } }, doc)).toBe('both hold filter1');
    expect(scopesOverlap({ sound: { nodes: ['osc1'] } }, { sound: { nodes: ['filter1'] } }, doc)).toBeNull();
    expect(scopesOverlap({ screen: 'all' }, { screen: { elements: ['title1'] } }, doc)).toBe('both hold the screen');
    expect(scopesOverlap({ project: 'all' }, { project: 'all', screen: 'all' }, doc)).toMatch(/screen project/);
  });
  it('screen areas and things in them', () => {
    const left = { screen: { area: { x: 0, y: 0, w: 300, h: 300 } } } as Scope;
    const right = { screen: { area: { x: 360, y: 0, w: 300, h: 300 } } } as Scope;
    expect(scopesOverlap(left, right, doc)).toBeNull();
    expect(scopesOverlap(left, { screen: { area: { x: 200, y: 0, w: 300, h: 300 } } }, doc)).toBe('their screen areas overlap');
    expect(scopesOverlap(right, { screen: { elements: ['title1'] } }, doc)).toBeNull();
    expect(scopesOverlap(left, { screen: { elements: ['title1'] } }, doc)).toBe('title1 lies in the other\'s area');
  });
});

describe('what a sound member may change', () => {
  const doc = base();
  const h = () => hold(doc, { sound: 'all' });
  it('modules, cables and knob values, the values of controls too', () => {
    const after = edit(doc, [
      { op: 'setValue', node: 'filter1', port: 'resonance', value: 2 },
      { op: 'addNode', node: { id: 'lfo2', type: 'den.lfo' } },
      { op: 'connect', from: { node: 'lfo2', port: 'out' }, to: { node: 'cut1', port: 'octaves' }, replace: true },
    ]);
    expect(outside(doc, after, catalog, h())).toEqual([]);
    const knob = controls(doc)[0]!;
    expect(outside(doc, edit(doc, [{ op: 'setValue', node: knob, port: 'value', value: 900 }]), catalog, h())).toEqual([]);
  });
  it('not the screen: the look, a control\'s place, decorations', () => {
    const knob = controls(doc)[0]!;
    expect(outside(doc, edit(doc, [{ op: 'setLook', look: { tokens: { accent: '#ff0000' } } }]), catalog, h())).toEqual(['the look belongs to the whole screen']);
    expect(outside(doc, edit(doc, [{ op: 'setRect', id: knob, rect: { x: 30, y: 96, w: 84, h: 96 } }]), catalog, h())).toEqual([`${knob} “Cutoff”'s place on the plugin is outside your scope`]);
    expect(outside(doc, edit(doc, [{ op: 'updateElement', id: 'title1', set: { text: 'ACID!' } }]), catalog, h())).toEqual(['title1 is outside your screen']);
  });
  it('not the seam: a control the others rely on, or its cable', () => {
    const knob = controls(doc)[0]!;
    // Removing the control takes its cable with it: both are the seam.
    expect(outside(doc, edit(doc, [{ op: 'removeNode', id: knob }]), catalog, h())).toEqual([`${knob} “Cutoff” is a control the others rely on (only the lead removes it)`, `the cable ${knob} → cut1 carries a control the others rely on (only the lead rewires it)`]);
    const reason = outside(doc, edit(doc, [{ op: 'disconnectInput', to: { node: 'cut1', port: 'hz' } }]), catalog, h());
    expect(reason).toEqual([`the cable ${knob} → cut1 carries a control the others rely on (only the lead rewires it)`]);
  });
  it('a member with some modules: those, what it adds and cables into them', () => {
    const narrow = hold(doc, { sound: { nodes: ['filter1'] } });
    expect(outside(doc, edit(doc, [{ op: 'setValue', node: 'filter1', port: 'resonance', value: 3 }]), catalog, narrow)).toEqual([]);
    expect(outside(doc, edit(doc, [{ op: 'setValue', node: 'aenv1', port: 'release', value: 0.5 }]), catalog, narrow)).toEqual(['aenv1 “Amp Env” is outside your scope']);
    const added = edit(doc, [{ op: 'addNode', node: { id: 'drive9', type: 'kit.mul' } }, { op: 'connect', from: { node: 'osc1', port: 'out' }, to: { node: 'drive9', port: 'a' } }]);
    // The new module is its own once it lands; until then, a cable into a module it does not hold is refused.
    expect(outside(doc, added, catalog, narrow)).toEqual(['a cable into drive9 is outside your scope']);
    expect(outside(doc, added, catalog, hold(doc, { sound: { nodes: ['filter1'] } }, ['drive9']))).toEqual([]);
  });
});

describe('what a screen member may change', () => {
  const doc = base();
  const h = () => hold(doc, { screen: 'all' });
  it('the look, the brief, decorations, controls\' places and styles, new controls wired to the sound', () => {
    const knob = controls(doc)[0]!;
    const after = edit(doc, [
      { op: 'setLook', look: { tokens: { accent: '#3ad1ff' } } },
      { op: 'setBrief', brief: 'Neon acid box' },
      { op: 'setRect', id: knob, rect: { x: 30, y: 100, w: 90, h: 100 } },
      { op: 'addElement', element: { kind: 'text', text: 'v2', rect: { x: 300, y: 16, w: 60, h: 20 } } },
      { op: 'addControl', for: { node: 'aenv1', port: 'release' }, label: 'Release' },
      { op: 'arrange', ids: ['title1'], to: 'front' },
    ]);
    expect(outside(doc, after, catalog, h())).toEqual([]);
  });
  it('not the sound, and not the seam', () => {
    const knob = controls(doc)[0]!;
    expect(outside(doc, edit(doc, [{ op: 'setValue', node: 'filter1', port: 'resonance', value: 2 }]), catalog, h())).toEqual(['filter1 is outside your scope']);
    expect(outside(doc, edit(doc, [{ op: 'removeNode', id: knob }]), catalog, h())[0]).toBe(`${knob} “Cutoff” is a control the others rely on (only the lead removes it)`);
    expect(outside(doc, edit(doc, [{ op: 'setProjectFiles', files: { 'src/parts/x.ts': 'export {}' } }]), catalog, h())).toEqual(['the screen project is held by someone else']);
  });
  it('a member with an area: what lies in it and what it adds there, nothing that leaves it', () => {
    const area = hold(doc, { screen: { area: { x: 360, y: 60, w: 280, h: 200 } } });
    const q = controls(doc)[1]!;
    expect(outside(doc, edit(doc, [{ op: 'updateElement', id: 'plate1', set: { name: 'Plate' } }, { op: 'setRect', id: q, rect: { x: 410, y: 100, w: 84, h: 96 } }]), catalog, area)).toEqual([]);
    expect(outside(doc, edit(doc, [{ op: 'addElement', element: { kind: 'shape', shape: 'rect', rect: { x: 400, y: 200, w: 12, h: 12 } } }]), catalog, area)).toEqual([]);
    expect(outside(doc, edit(doc, [{ op: 'addElement', element: { id: 'far1', kind: 'shape', shape: 'rect', rect: { x: 10, y: 200, w: 12, h: 12 } } }]), catalog, area)).toEqual(['adding far1 there is outside your screen']);
    expect(outside(doc, edit(doc, [{ op: 'setRect', id: 'plate1', rect: { x: 100, y: 80, w: 220, h: 140 } }]), catalog, area)).toEqual(['plate1 is outside your screen']);
    expect(outside(doc, edit(doc, [{ op: 'updateElement', id: 'title1', set: { text: 'X' } }]), catalog, area)).toEqual(['title1 is outside your screen']);
    expect(outside(doc, edit(doc, [{ op: 'setLook', look: { tokens: { accent: '#ff0000' } } }]), catalog, area)).toEqual(['the look belongs to the whole screen']);
  });
  it('the stacking order: moving one thing to the front moves only it', () => {
    const after = edit(doc, [{ op: 'arrange', ids: ['title1'], to: 'front' }]);
    // Swapping neighbours has two explanations: title1 moved in front, or plate1 moved behind.
    expect(changes(doc, after, catalog)).toContainEqual({ kind: 'order', ids: ['plate1'], alt: ['title1'] });
    expect(outside(doc, after, catalog, hold(doc, { screen: { elements: ['title1'] } }))).toEqual([]);
    expect(outside(doc, after, catalog, hold(doc, { screen: { elements: ['plate1'] } }))).toEqual([]);
    expect(outside(doc, after, catalog, hold(doc, { screen: { elements: [controls(doc)[0]!] } }))).toEqual(['moving plate1 in front or behind is outside your screen']);
  });
});

describe('the lead while members work', () => {
  const doc = base();
  const members = [
    { id: 'm1', name: 'Sound', holding: hold(doc, { sound: 'all' }) },
    { id: 'm2', name: 'Screen', holding: hold(doc, { screen: { area: { x: 360, y: 60, w: 280, h: 200 } } }) },
  ];
  it('may not change what a member holds', () => {
    expect(heldByMembers(doc, edit(doc, [{ op: 'setValue', node: 'filter1', port: 'resonance', value: 2 }]), catalog, members)).toEqual(['filter1 is held by m1 “Sound” while it works']);
    expect(heldByMembers(doc, edit(doc, [{ op: 'updateElement', id: 'plate1', set: { name: 'Back plate' } }]), catalog, members)).toEqual(['plate1 is held by m2 “Screen” while it works']);
    expect(heldByMembers(doc, edit(doc, [{ op: 'addElement', element: { kind: 'shape', shape: 'rect', rect: { x: 400, y: 100, w: 10, h: 10 } } }]), catalog, members)).toHaveLength(1);
  });
  it('may change the rest, move modules around, set controls\' values and rename the work', () => {
    const knob = controls(doc)[0]!;
    const after = edit(doc, [
      { op: 'updateElement', id: 'title1', set: { text: 'ACID 303' } },
      { op: 'move', node: 'filter1', pos: { x: 900, y: 300 } },
      { op: 'setValue', node: knob, port: 'value', value: 1200 },
      { op: 'setName', name: 'Acid' },
      { op: 'addElement', element: { kind: 'shape', shape: 'rect', rect: { x: 40, y: 220, w: 10, h: 10 } } },
    ]);
    expect(heldByMembers(doc, after, catalog, members)).toEqual([]);
  });
  it('the screen project, held by a member, is not the lead\'s meanwhile', () => {
    const withProject = [{ id: 'm3', name: 'Code', holding: hold(doc, { project: 'all' }) }];
    expect(heldByMembers(doc, edit(doc, [{ op: 'setProjectFiles', files: { 'src/parts/x.ts': 'export {}' } }]), catalog, withProject)).toEqual(['the screen project is held by m3 “Code” while it works']);
  });
});

describe('who made and touched what', () => {
  it('lists new ids and the things an edit touched', () => {
    const doc = base();
    const after = edit(doc, [{ op: 'addNode', node: { id: 'lfo2', type: 'den.lfo' } }, { op: 'connect', from: { node: 'lfo2', port: 'out' }, to: { node: 'cut1', port: 'octaves' }, replace: true }, { op: 'updateElement', id: 'title1', set: { text: 'B' } }]);
    const list = changes(doc, after, catalog);
    expect(made(list)).toEqual(['lfo2']);
    expect(touched(list).sort()).toEqual(['cut1', 'lfo2', 'title1']);
  });
});
