// Rough sketches for the AI (U8c): what each mark is about (loops and boxes go
// around things, strokes cross them, arrows join them, notes sit on them or in
// empty space), and the marks in words.
import { describe, expect, it } from 'vite-plus/test';
import { isLoop, markBox, markedThings, onlyPointing, patchTargets, pluginTargets, readMarks, sketchSummary, sketchText, type Mark, type Point, type Target } from '../../../src/ai/sketch.ts';
import { badgeAt, fit, wrapText } from '../../../src/editor/sketch-picture.ts';

const targets: Target[] = [
  { id: 'knob1', box: { x: 20, y: 100, w: 80, h: 90 }, label: 'knob1 (knob “Cutoff”)' },
  { id: 'knob2', box: { x: 120, y: 100, w: 80, h: 90 }, label: 'knob2 (knob “Resonance”)' },
  { id: 'title1', box: { x: 20, y: 10, w: 300, h: 50 }, label: 'title1 (text “ACID”)' },
];
const circle = (cx: number, cy: number, r: number, n = 24): Point[] => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos(i / n * 2 * Math.PI), cy + r * Math.sin(i / n * 2 * Math.PI)] as Point);
const mark = (m: Partial<Mark> & Pick<Mark, 'kind'>, n = 1): Mark => ({ id: `m${n}`, n, color: '#ff4d6d', ...m });

describe('what a mark is about', () => {
  it('a loop goes around the things mostly inside it', () => {
    const [r] = readMarks({ view: 'plugin', marks: [mark({ kind: 'pen', points: circle(110, 145, 110), width: 4 })] }, targets);
    expect(r!.encloses).toEqual(['knob1', 'knob2']);
    expect(r!.empty).toBe(false);
  });
  it('a stroke that does not close crosses what it passes over', () => {
    const [r] = readMarks({ view: 'plugin', marks: [mark({ kind: 'marker', points: [[30, 30], [100, 32], [180, 30]], width: 12 })] }, targets);
    expect(r!.encloses).toEqual([]);
    expect(r!.touches).toEqual(['title1']);
  });
  it('a box goes around what lies in it; a note on something is about it, one in empty space about the space', () => {
    const readings = readMarks({ view: 'plugin', marks: [
      mark({ kind: 'rect', rect: { x: 10, y: 90, w: 100, h: 110 } }, 1),
      mark({ kind: 'note', rect: { x: 130, y: 120, w: 60, h: 40 }, text: 'bigger' }, 2),
      mark({ kind: 'note', rect: { x: 400, y: 240, w: 200, h: 100 }, text: 'put a waveform here' }, 3),
    ] }, targets);
    expect(readings[0]).toMatchObject({ encloses: ['knob1'], touches: [] });
    expect(readings[1]).toMatchObject({ encloses: [], touches: ['knob2'], text: 'bigger' });
    expect(readings[2]).toMatchObject({ empty: true, text: 'put a waveform here' });
  });
  it('an arrow joins the things at its ends (or near them)', () => {
    const [r] = readMarks({ view: 'patch', marks: [mark({ kind: 'arrow', from: [60, 150], to: [215, 140] })] }, targets);
    expect(r).toMatchObject({ from: 'knob1', to: 'knob2' });
    const [far] = readMarks({ view: 'patch', marks: [mark({ kind: 'arrow', from: [600, 600], to: [700, 700] })] }, targets);
    expect(far).toMatchObject({ from: undefined, to: undefined, empty: true });
  });
  it('knows a loop from a line, and the box of each kind', () => {
    expect(isLoop(circle(0, 0, 50))).toBe(true);
    expect(isLoop([[0, 0], [10, 0], [20, 0], [30, 0], [40, 0], [50, 0], [60, 0], [70, 0], [80, 0]])).toBe(false);
    expect(markBox(mark({ kind: 'pen', points: [[10, 10], [30, 50]], width: 4 }))).toEqual({ x: 8, y: 8, w: 24, h: 44 });
    expect(markBox(mark({ kind: 'arrow', from: [50, 10], to: [10, 40] }))).toEqual({ x: 10, y: 10, w: 40, h: 30 });
  });
});

describe('the marks in words', () => {
  it('one numbered line per mark, with what it is about', () => {
    const sketch = { view: 'plugin' as const, marks: [
      mark({ kind: 'pen', points: circle(110, 145, 110), width: 4 }, 1),
      mark({ kind: 'note', rect: { x: 400, y: 240, w: 200, h: 100 }, text: 'put a waveform here', color: '#ffd166' }, 2),
      mark({ kind: 'arrow', from: [60, 150], to: [215, 140], color: '#4cc9f0' }, 3),
    ] };
    const text = sketchText(sketch, readMarks(sketch, targets), targets, { width: 720, height: 440 });
    expect(text).toBe([
      'The person sketched on the plugin (720×440 design pixels); the marks are numbered on the picture:',
      '① red pen loop around knob1 (knob “Cutoff”), knob2 (knob “Resonance”); also touching title1 (text “ACID”) (x -2, y 33, 224×224)',
      '② yellow sticky note “put a waveform here” in empty space (x 400, y 240, 200×100)',
      '③ blue arrow from knob1 (knob “Cutoff”) to knob2 (knob “Resonance”)',
    ].join('\n'));
  });
  it('only loops and boxes around things identify a selection without additional instructions', () => {
    expect(onlyPointing(readMarks({ view: 'plugin', marks: [mark({ kind: 'rect', rect: { x: 10, y: 90, w: 100, h: 110 } })] }, targets))).toBe(true);
    expect(onlyPointing(readMarks({ view: 'plugin', marks: [mark({ kind: 'note', rect: { x: 10, y: 90, w: 100, h: 110 }, text: 'x' })] }, targets))).toBe(false);
    expect(onlyPointing([])).toBe(false);
  });
  it('the plugin\'s controls and decorations are what marks can be about', () => {
    const list = pluginTargets({ nodes: { k1: { id: 'k1', type: 'ui.knob', label: 'Cutoff', panel: { x: 0, y: 0, w: 10, h: 10 } }, osc1: { id: 'osc1', type: 'den.oscillator' } }, ui: { elements: { t1: { id: 't1', kind: 'text', rect: { x: 0, y: 0, w: 5, h: 5 }, text: 'Hi' } } } }, t => t.startsWith('ui.'));
    expect(list.map(t => t.label)).toEqual(['k1 (knob “Cutoff”)', 't1 (text “Hi”)']);
  });
});

describe('the sketch, sent', () => {
  it('without a picture, the words say so', () => {
    const sketch = { view: 'patch' as const, marks: [mark({ kind: 'rect', rect: { x: 10, y: 90, w: 100, h: 110 } })] };
    expect(sketchText(sketch, readMarks(sketch, targets), targets, undefined, false)).toMatch(/^The person sketched on the patch; the marks \(no picture: your model does not take pictures\):\n① red box around knob1/);
  });
  it('the modules of the patch are what marks there can be about; everything a sketch is about', () => {
    const list = patchTargets([{ id: 'filter1', type: 'den.filter', label: 'Lowpass' }, { id: 'osc1', type: 'den.oscillator' }, { id: 'gone', type: 'den.lfo' }], { filter1: { x: 0, y: 0, w: 160, h: 100 }, osc1: { x: 200, y: 0, w: 160, h: 100 } }, t => t === 'den.filter' ? 'Filter' : 'Oscillator');
    expect(list.map(t => t.label)).toEqual(['filter1 (Filter “Lowpass”)', 'osc1 (Oscillator)']);
    const readings = readMarks({ view: 'plugin', marks: [mark({ kind: 'rect', rect: { x: 10, y: 90, w: 100, h: 110 } }, 1), mark({ kind: 'arrow', from: [60, 150], to: [160, 30] }, 2)] }, targets);
    expect(markedThings(readings)).toEqual(['knob1', 'title1']);
  });
  it('says how many marks went where', () => {
    expect(sketchSummary([{ view: 'plugin', marks: 3 }])).toBe('3 marks on the plugin');
    expect(sketchSummary([{ view: 'plugin', marks: 1 }, { view: 'patch', marks: 2 }])).toBe('a mark on the plugin and 2 on the patch');
  });
});

describe('the sketch, drawn for the AI', () => {
  it('wraps notes at spaces, and anywhere in words without them', () => {
    const w = (s: string) => s.length * 10;
    expect(wrapText(w, 'put a waveform here', 80)).toEqual(['put a', 'waveform', 'here']);
    expect(wrapText(w, 'waveform☕', 40)).toEqual(['wave', 'form', '☕']);
    expect(wrapText(w, 'two\nlines', 200)).toEqual(['two', 'lines']);
  });
  it('numbers sit where they sit on screen; the picture holds the modules and marks with a margin', () => {
    expect(badgeAt(mark({ kind: 'note', rect: { x: 5, y: 6, w: 10, h: 10 } }))).toEqual([5, 6]);
    expect(badgeAt(mark({ kind: 'arrow', from: [1, 2], to: [3, 4] }))).toEqual([1, 2]);
    expect(badgeAt(mark({ kind: 'pen', points: [[7, 8], [9, 9]] }))).toEqual([7, 8]);
    const at = fit([{ x: 100, y: 100, w: 200, h: 100 }, { x: -60, y: 300, w: 20, h: 20 }], 1000);
    expect(at).toEqual({ ox: -100, oy: 60, k: 1.25, width: 550, height: 375 });
    expect(fit([{ x: 0, y: 0, w: 4000, h: 1000 }], 1280).k).toBeCloseTo(1280 / 4080);
  });
});
