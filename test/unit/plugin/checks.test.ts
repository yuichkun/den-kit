// The screen checks: the ten showcase works pass; a screen with each kind of
// mistake gets the matching problem, worded so the next edit can fix it.
import { describe, expect, it } from 'vite-plus/test';
import { catalog } from '../../../src/blocks/index.ts';
import { starter } from '../../../src/core/starters.ts';
import { applyIntents, type Intent } from '../../../src/core/ops.ts';
import { WORKS } from '../../../src/showcase/index.ts';
import { checkPlugin, contrastIssues, contrastRatio, luminance, textOverlaps, visualRect, type TextBox } from '../../../src/plugin/checks.ts';

describe('structural checks', () => {
  for (const w of WORKS) it(`${w.id}: nothing to fix`, () => { expect(checkPlugin(w.build(catalog), catalog)).toEqual([]); });

  it('code parts: a part the project does not have is a problem; a control a part reads is in use', () => {
    const doc = applyIntents(starter('bass', catalog), [
      { op: 'addNode', node: { id: 'kspin', type: 'ui.knob', label: 'Spin', panel: { x: 20, y: 20, w: 84, h: 96 } } },
      { op: 'setProjectFiles', files: { 'src/parts/reels.ts': "kit.norm('kspin')" } },
      { op: 'addElement', element: { id: 'code1', kind: 'code', part: 'reels', rect: { x: 200, y: 20, w: 200, h: 120 }, props: {} } },
      { op: 'addElement', element: { id: 'code2', kind: 'code', part: 'gone', rect: { x: 200, y: 160, w: 200, h: 120 }, props: {} } },
    ], catalog).doc;
    const issues = checkPlugin(doc, catalog);
    expect(issues.filter(i => i.code === 'code-missing')).toEqual([{ code: 'code-missing', ids: ['code2'], message: 'code2 shows the part "gone", but the project has no src/parts/gone.ts (parts: reels).', severity: 'error' }]);
    expect(issues.some(i => i.code === 'unwired' && i.ids.includes('kspin'))).toBe(false);
  });

  it('finds what is wrong with a careless screen', () => {
    const knob = (id: string, x: number, y: number, extra: Record<string, unknown> = {}): Intent[] => [
      { op: 'addNode', node: { id, type: 'ui.knob', label: id === 'k3' ? '' : `Knob ${id}`, panel: { x, y, w: 84, h: 96 }, config: { min: 0, max: 1, scale: 'linear', unit: '' }, ...extra } },
      ...(id === 'k4' ? [] : [{ op: 'connect', from: { node: id, port: 'out' }, to: { node: id === 'k1' ? 'filter1' : 'aenv1', port: ({ k1: 'resonance', k2: 'attack', k3: 'release', k5: 'decay' } as Record<string, string>)[id]! } } as Intent]),
    ];
    const doc = applyIntents(starter('bass', catalog), [
      ...knob('k1', 20, 20), ...knob('k2', 60, 40), ...knob('k3', 300, 20), ...knob('k4', 420, 20),
      ...knob('k5', 600, 300),
      { op: 'addElement', element: { id: 'img1', kind: 'shape', shape: 'rect', rect: { x: 290, y: 10, w: 110, h: 120 }, style: { fill: [{ kind: 'color', color: '#222222' }] } } },
      { op: 'addElement', element: { id: 'tiny', kind: 'text', text: 'small print', rect: { x: 20, y: 200, w: 200, h: 12 }, textStyle: { size: 7 } } },
      { op: 'addElement', element: { id: 'gone', kind: 'text', text: 'lost', rect: { x: 900, y: 20, w: 100, h: 20 } } },
      { op: 'addNode', node: { id: 'keys', type: 'ui.keyboard', panel: { x: 20, y: 260, w: 200, h: 60 } } },
    ], catalog).doc;
    const fx = applyIntents(starter('chorus', catalog), [{ op: 'addNode', node: { id: 'keys', type: 'ui.keyboard', panel: { x: 20, y: 20, w: 200, h: 60 } } }], catalog).doc;
    const issues = checkPlugin(doc, catalog);
    const find = (code: string, id: string) => issues.find(i => i.code === code && i.ids.includes(id));
    expect(find('overlap', 'k1')?.ids).toEqual(['k1', 'k2']);
    expect(find('covered', 'k3')?.message).toMatch(/img1 lies over k3 .* send it back \(\{"op":"arrange","ids":\["img1"\],"to":"back"\}\)/);
    expect(find('unlabelled', 'k3')).toBeDefined();
    expect(find('unwired', 'k4')?.message).toMatch(/drives nothing/);
    expect(find('cut', 'k5')?.severity).toBe('error');
    expect(find('outside', 'gone')?.severity).toBe('error');
    expect(find('tiny-text', 'tiny')?.severity).toBe('error');
    expect(find('unwired', 'k1')).toBeUndefined();
    expect(checkPlugin(fx, catalog).find(i => i.code === 'no-voice')?.message).toMatch(/no Voice In/);
    expect(checkPlugin(starter('bass', catalog), catalog)).toEqual([expect.objectContaining({ code: 'empty' })]);
  });

  it('a control a canvas moves is not unwired; a missing picture is reported', () => {
    const doc = applyIntents(starter('bass', catalog), [
      { op: 'addNode', node: { id: 'kq', type: 'ui.knob', label: 'Q', panel: { x: 20, y: 20, w: 84, h: 96 } } },
      { op: 'addElement', element: { kind: 'canvas', code: 'export default { draw() {}, pointer(e, f) { f.setNorm("kq", e.x / f.w); } };', rect: { x: 200, y: 20, w: 200, h: 100 } } },
    ], catalog).doc;
    expect(checkPlugin(doc, catalog)).toEqual([]);
    const broken = { ...doc, ui: { ...doc.ui, look: { ...doc.ui.look, background: [{ kind: 'image' as const, asset: 'nope-pic', fit: 'cover' as const }] } } };
    expect(checkPlugin(broken, catalog)).toEqual([expect.objectContaining({ code: 'missing-asset', message: expect.stringMatching(/"nope-pic" \(used by background\)/) })]);
  });

  it('a turned element is checked where it is drawn', () => {
    expect(visualRect({ x: -58, y: 262, w: 160, h: 22 }, -90)).toEqual({ x: 11, y: 193, w: 22, h: 160 });
  });

  it('measured: words on words, and words on a control', () => {
    const lines = [{ id: 'a', what: 'The title', rects: [{ x: 0, y: 0, w: 100, h: 20 }] }, { id: 'b', what: 'The subtitle', rects: [{ x: 10, y: 10, w: 100, h: 20 }] }, { id: 'c', what: 'A note', rects: [{ x: 0, y: 100, w: 50, h: 14 }] }];
    const issues = textOverlaps(lines, [{ id: 'k1', what: 'knob k1', rect: { x: 10, y: 95, w: 84, h: 96 } }]);
    expect(issues.map(i => i.ids)).toEqual([['a', 'b'], ['c', 'k1']]);
    expect(issues[1]!.message).toBe('A note is drawn over knob k1; move one of them.');
  });
});

describe('contrast against the pixels behind the text', () => {
  const picture = (fill: (x: number, y: number) => [number, number, number], width = 100, height = 40) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const [r, g, b] = fill(x, y); data.set([r, g, b, 255], (y * width + x) * 4); }
    return { data, width, height };
  };
  const box = (color: [number, number, number, number], extra: Partial<TextBox> = {}): TextBox => ({ id: 't1', what: 'The title', kind: 'text', rect: { x: 0, y: 0, w: 100, h: 40 }, color, size: 14, bold: false, ...extra });

  it('WCAG ratios', () => {
    expect(contrastRatio(luminance(255, 255, 255), luminance(0, 0, 0))).toBeCloseTo(21);
    expect(contrastRatio(luminance(118, 118, 118), luminance(255, 255, 255))).toBeCloseTo(4.54, 1);
  });

  it('light text on a dark background reads; on a light one it is hard to read; in between it is faint', () => {
    expect(contrastIssues([box([255, 255, 255, 1])], [{ bare: picture(() => [20, 20, 30]) }])).toEqual([]);
    const bad = contrastIssues([box([255, 255, 255, 1])], [{ bare: picture(() => [230, 230, 220]) }]);
    expect(bad).toEqual([expect.objectContaining({ severity: 'error', message: expect.stringMatching(/^The title is hard to read: contrast 1\.\d:1 against what is behind it \(at least 3:1\)/) })]);
    const faint = contrastIssues([box([255, 255, 255, 1])], [{ bare: picture(() => [128, 128, 128]) }]);
    expect(faint).toEqual([expect.objectContaining({ severity: 'warn', message: expect.stringMatching(/is faint: contrast 3\.9:1 .* \(4\.5:1 reads well\)/) })]);
    // Large text reads at 3:1.
    expect(contrastIssues([box([255, 255, 255, 1], { size: 30 })], [{ bare: picture(() => [128, 128, 128]) }])).toEqual([]);
  });

  it('only the background around the letters counts: a dark shadow under light letters on a bright picture helps', () => {
    // Letters: a white bar in the middle; behind them a dark shadow band; the rest of the box is bright.
    const letters = (x: number, y: number) => y >= 18 && y < 22 && x >= 10 && x < 90;
    const shadow = (x: number, y: number) => y >= 14 && y < 26 && x >= 6 && x < 94;
    const bare = picture((x, y) => shadow(x, y) ? [40, 30, 40] : [235, 235, 235]);
    const full = picture((x, y) => letters(x, y) ? [255, 255, 255] : shadow(x, y) ? [40, 30, 40] : [235, 235, 235]);
    expect(contrastIssues([box([255, 255, 255, 1])], [{ bare }])).toHaveLength(1);
    expect(contrastIssues([box([255, 255, 255, 1])], [{ bare, full }])).toEqual([]);
  });

  it('a glow belongs to the letters: neon text reads against the dark around its glow', () => {
    // Pink letters with a pink glow around them, on a dark wall.
    const letters = (x: number, y: number) => y >= 18 && y < 22 && x >= 10 && x < 90;
    const glow = (x: number, y: number) => y >= 12 && y < 28 && x >= 4 && x < 96;
    const dark: [number, number, number] = [12, 6, 24], pink: [number, number, number] = [255, 60, 172];
    const withGlow = picture((x, y) => glow(x, y) ? pink : dark);
    const without = picture(() => dark);
    const full = picture((x, y) => letters(x, y) ? [255, 210, 240] : glow(x, y) ? pink : dark);
    const neon = box([255, 210, 240, 1], { size: 40 });
    expect(contrastIssues([neon], [{ bare: withGlow, full }])).toHaveLength(1);
    expect(contrastIssues([neon], [{ bare: withGlow, full }, { bare: without, full }])).toEqual([]);
  });

  it('the brightest tenth of a busy background counts (white text over a photo with bright clouds)', () => {
    const clouds = picture(x => x < 80 ? [30, 30, 40] : [240, 240, 240]);
    expect(contrastIssues([box([255, 255, 255, 1])], [{ bare: clouds }])).toHaveLength(1);
  });

  it('faint labels of several controls are said once', () => {
    const grey = picture(() => [128, 128, 128], 400, 40);
    const labels = ['k1', 'k2', 'k3'].map((id, i) => box([255, 255, 255, 1], { id, what: `The label of ${id}`, kind: 'label', rect: { x: i * 100, y: 0, w: 90, h: 20 } }));
    const issues = contrastIssues(labels, [{ bare: grey }]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.ids).toEqual(['k1', 'k2', 'k3']);
    expect(issues[0]!.message).toMatch(/^The labels of k1, k2, k3 are faint: contrast 3\.9:1/);
  });
});
