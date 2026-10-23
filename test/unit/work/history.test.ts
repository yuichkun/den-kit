// Undo steps and conflicts between people and the AI, on the work alone: a drag
// is one step, an AI request (its sub-agents included) is one step even when
// the person edits in between, undo restores exactly what was there, and an AI
// operation on something the person changed after the AI read the work fails
// and says what changed.
import { describe, expect, it } from 'vite-plus/test';
import { catalog } from '../../../src/sound/blocks/index.ts';
import { History, commit, type Author } from '../../../src/work/history.ts';
import type { Intent } from '../../../src/work/ops.ts';
import { emptyDocument, type PatchDocument } from '../../../src/work/schema.ts';
import { applyIntents } from '../../../src/work/ops.ts';

const PERSON: Author = { kind: 'human' };
const lead: Author = { kind: 'ai-llm', take: 'rq1', trace: 'rq1' };
const member: Author = { kind: 'ai-llm', take: 'rq1', trace: 'rq1-m1' };

function work() {
  const doc = applyIntents(
    emptyDocument('t', 't'),
    [
      { op: 'addNode', node: { id: 'osc1', type: 'den.oscillator' } },
      { op: 'addNode', node: { id: 'filter1', type: 'den.filter' } },
      { op: 'addNode', node: { id: 'out1', type: 'kit.out' } },
    ],
    catalog,
  ).doc;
  const state = { doc, history: new History() };
  const edit = (
    intents: Intent[],
    author: Author,
    options: { group?: string; gesture?: string; seen?: number } = {},
  ) => {
    const r = commit(state.history, state.doc, intents, catalog, { author, ...options });
    if (r.ok) state.doc = r.doc;
    return r;
  };
  const undo = () => {
    const r = state.history.undo(state.doc);
    if (r && 'doc' in r) state.doc = r.doc;
    return r;
  };
  const redo = () => {
    const r = state.history.redo(state.doc);
    if (r) state.doc = r.doc;
    return r;
  };
  return { state, edit, undo, redo };
}
const value = (doc: PatchDocument, node: string, port: string) => doc.nodes[node]!.values[port];

describe('undo steps', () => {
  it('undo restores exactly what was there, and redo exactly what was done', () => {
    const w = work();
    const before = structuredClone(w.state.doc);
    w.edit(
      [
        { op: 'addNode', node: { id: 'gain1', type: 'kit.gain' } },
        {
          op: 'connect',
          from: { node: 'osc1', port: 'out' },
          to: { node: 'filter1', port: 'input' },
        },
        { op: 'setValue', node: 'filter1', port: 'cutoff', value: 400 },
      ],
      PERSON,
    );
    const after = structuredClone(w.state.doc);
    w.undo();
    expect({ ...w.state.doc, revision: 0 }).toEqual({ ...before, revision: 0 });
    w.redo();
    expect({ ...w.state.doc, revision: 0 }).toEqual({ ...after, revision: 0 });
  });

  it('a drag is one step', () => {
    const w = work();
    for (const v of [100, 200, 300, 400])
      w.edit([{ op: 'setValue', node: 'filter1', port: 'cutoff', value: v }], PERSON, {
        gesture: 'drag-1',
      });
    expect(w.state.history.size).toBe(1);
    const start = value(w.state.doc, 'filter1', 'cutoff');
    w.undo();
    expect(value(w.state.doc, 'filter1', 'cutoff')).not.toBe(start);
    expect(w.state.history.size).toBe(0);
  });

  it('an AI request is one step, its sub-agents included, even when the person edits in between', () => {
    const w = work();
    const before = structuredClone(w.state.doc);
    w.edit([{ op: 'setValue', node: 'filter1', port: 'cutoff', value: 900 }], lead, {
      group: 'rq1',
    });
    w.edit([{ op: 'setValue', node: 'osc1', port: 'frequency', value: 110 }], PERSON);
    w.edit([{ op: 'addNode', node: { id: 'gain1', type: 'kit.gain' } }], member, { group: 'rq1' });
    w.edit([{ op: 'setValue', node: 'filter1', port: 'resonance', value: 4 }], lead, {
      group: 'rq1',
    });
    // Two steps: the person's edit, and the whole request on top.
    expect(w.state.history.size).toBe(2);
    expect(w.state.history.peek()!.group).toBe('rq1');
    w.undo();
    expect(value(w.state.doc, 'filter1', 'cutoff')).toBe(value(before, 'filter1', 'cutoff'));
    expect(value(w.state.doc, 'filter1', 'resonance')).toBe(value(before, 'filter1', 'resonance'));
    expect(w.state.doc.nodes.gain1).toBeUndefined();
    // The person's own edit is still there: it is a step of its own.
    expect(value(w.state.doc, 'osc1', 'frequency')).toBe(110);
    w.undo();
    expect(value(w.state.doc, 'osc1', 'frequency')).toBe(value(before, 'osc1', 'frequency'));
  });

  it('undoing a request keeps what the person changed after the request touched it', () => {
    const w = work();
    w.edit([{ op: 'setValue', node: 'filter1', port: 'cutoff', value: 900 }], lead, {
      group: 'rq1',
    });
    w.edit([{ op: 'setValue', node: 'filter1', port: 'cutoff', value: 1234 }], PERSON);
    w.edit([{ op: 'setValue', node: 'filter1', port: 'resonance', value: 4 }], lead, {
      group: 'rq1',
    });
    const r = w.undo();
    expect(r && 'kept' in r ? r.kept.map(k => k.key) : null).toEqual(['node:filter1/value:cutoff']);
    expect(value(w.state.doc, 'filter1', 'cutoff')).toBe(1234);
  });

  it('an edit that was undone no longer stands: undoing the request after it restores everything', () => {
    const w = work();
    const start = value(w.state.doc, 'filter1', 'cutoff');
    w.edit([{ op: 'setValue', node: 'filter1', port: 'cutoff', value: 1500 }], lead, {
      group: 'rq1',
    });
    w.edit([{ op: 'setValue', node: 'filter1', port: 'cutoff', value: 444 }], PERSON);
    w.undo(); // the person's edit
    expect(value(w.state.doc, 'filter1', 'cutoff')).toBe(1500);
    const r = w.undo(); // the request
    expect(r && 'kept' in r ? r.kept : null).toEqual([]);
    expect(value(w.state.doc, 'filter1', 'cutoff')).toBe(start);
  });

  it('the AI is told when the person took its edit back', () => {
    const w = work();
    const read = w.state.doc.revision;
    w.edit([{ op: 'setValue', node: 'filter1', port: 'cutoff', value: 1500 }], lead, {
      group: 'rq1',
      seen: read,
    });
    w.undo(); // the person undoes the AI's edit
    const again = w.edit([{ op: 'setValue', node: 'filter1', port: 'cutoff', value: 1600 }], lead, {
      group: 'rq1',
      seen: read,
    });
    expect(again.ok).toBe(false);
  });

  it('a request that is over does not take later steps of another request', () => {
    const w = work();
    w.edit([{ op: 'setValue', node: 'filter1', port: 'cutoff', value: 900 }], lead, {
      group: 'rq1',
    });
    w.edit(
      [{ op: 'setValue', node: 'filter1', port: 'resonance', value: 3 }],
      { kind: 'ai-llm', take: 'rq2' },
      {
        group: 'rq2',
      },
    );
    expect(w.state.history.size).toBe(2);
  });
});

describe('the AI never overwrites a change it has not seen', () => {
  it('an operation on something the person changed after the AI read the work fails and says what changed', () => {
    const w = work();
    const read = w.state.doc.revision;
    w.edit([{ op: 'setValue', node: 'filter1', port: 'cutoff', value: 1234 }], PERSON);
    const before = structuredClone(w.state.doc);
    const r = w.edit([{ op: 'setValue', node: 'filter1', port: 'cutoff', value: 500 }], lead, {
      group: 'rq1',
      seen: read,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('conflict');
    expect(r.error.message).toMatch(/module filter1 \(cutoff\)/);
    expect(r.error.message).toMatch(/after you read/);
    expect(w.state.doc).toEqual(before);
  });

  it('a removed module counts as changed for anything on it', () => {
    const w = work();
    const read = w.state.doc.revision;
    w.edit([{ op: 'removeNode', id: 'osc1' }], PERSON);
    w.edit([{ op: 'addNode', node: { id: 'osc1', type: 'den.oscillator' } }], PERSON);
    const r = w.edit([{ op: 'setValue', node: 'osc1', port: 'frequency', value: 50 }], lead, {
      seen: read,
    });
    expect(r.ok).toBe(false);
  });

  it('what the person did not touch, the AI may change; and after reading again, anything', () => {
    const w = work();
    const read = w.state.doc.revision;
    w.edit([{ op: 'setValue', node: 'filter1', port: 'cutoff', value: 1234 }], PERSON);
    expect(
      w.edit([{ op: 'setValue', node: 'filter1', port: 'resonance', value: 2 }], lead, {
        seen: read,
      }).ok,
    ).toBe(true);
    expect(
      w.edit([{ op: 'setValue', node: 'filter1', port: 'cutoff', value: 500 }], lead, {
        seen: w.state.doc.revision,
      }).ok,
    ).toBe(true);
  });

  it("an agent's own earlier changes are not news to it", () => {
    const w = work();
    const read = w.state.doc.revision;
    w.edit([{ op: 'setValue', node: 'filter1', port: 'cutoff', value: 700 }], lead, { seen: read });
    expect(
      w.edit([{ op: 'setValue', node: 'filter1', port: 'cutoff', value: 800 }], lead, {
        seen: read,
      }).ok,
    ).toBe(true);
  });
});
