// The behavior rules of src/behaviors/index.ts, one by one: input in, values and
// events out.
import { describe, expect, it } from 'vite-plus/test';
import {
  Button,
  Keyboard,
  Knob,
  Meter,
  PEAK_HOLD_MS,
  Slider,
  Switch,
  XYPad,
  keyAt,
  scopePoints,
  type BehaviorEvent,
} from '../../../src/behaviors/index.ts';

function record<V>(b: { events: { on(l: (e: BehaviorEvent<V>) => void): () => void } }) {
  const seen: Array<BehaviorEvent<V>> = [];
  b.events.on(e => seen.push(e));
  return {
    seen,
    values: () => seen.filter(e => e.type === 'value').map(e => (e as { value: V }).value),
    kinds: () => seen.map(e => e.type),
  };
}
const range = { min: 0, max: 100, default: 25 };
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('rule 1: a knob drags up and down, 200 px for its whole range, Shift ten times finer', () => {
  it('moves by the same amount wherever it is grabbed', () => {
    for (const grabbedAt of [0, 37, 180]) {
      const knob = new Knob(range, 50);
      knob.pointerDown({ x: 10, y: grabbedAt });
      knob.pointerMove({ x: 10, y: grabbedAt - 20 });
      near(knob.value, 60); // 20 px of 200 = 10% of 0–100
      knob.pointerUp();
    }
  });
  it('200 px is the whole range, and it stops at the ends', () => {
    const knob = new Knob(range, 0);
    knob.pointerDown({ x: 0, y: 300 });
    knob.pointerMove({ x: 0, y: 100 });
    near(knob.value, 100);
    knob.pointerMove({ x: 0, y: 0 });
    near(knob.value, 100);
  });
  it('Shift makes it ten times finer, and can be pressed in the middle of a drag', () => {
    const knob = new Knob(range, 50);
    knob.pointerDown({ x: 0, y: 100 });
    knob.pointerMove({ x: 0, y: 80 }); // +10
    knob.pointerMove({ x: 0, y: 60, shift: true }); // +1 from here
    near(knob.value, 61);
    knob.pointerMove({ x: 0, y: 40 }); // Shift released: +10 again
    near(knob.value, 71);
  });
  it('follows the range’s scale: a log knob moves evenly in octaves', () => {
    const knob = new Knob({ min: 20, max: 20480, scale: 'log' }, 20);
    knob.pointerDown({ x: 0, y: 200 });
    knob.pointerMove({ x: 0, y: 100 });
    near(knob.value, 640); // halfway in position, the geometric middle
  });
});

describe('rule 2: a double-click returns a knob or a slider to its default', () => {
  it('knob and slider', () => {
    const knob = new Knob(range, 80);
    knob.doubleClick();
    expect(knob.value).toBe(25);
    const slider = new Slider(range, { orientation: 'horizontal', length: 100 }, 80);
    const r = record(slider);
    slider.doubleClick();
    expect(slider.value).toBe(25);
    expect(r.kinds()).toEqual(['begin', 'value', 'end']);
  });
});

describe('rule 3: a wheel notch is 1% of the range, 0.1% with Shift', () => {
  it('knob', () => {
    const knob = new Knob(range, 50);
    knob.wheel({ up: true });
    near(knob.value, 51);
    knob.wheel({ up: false, shift: true });
    near(knob.value, 50.9);
  });
  it('slider', () => {
    const slider = new Slider(range, { orientation: 'vertical', length: 300 }, 50);
    slider.wheel({ up: false });
    near(slider.value, 49);
  });
});

describe('rule 4: arrows 1%, Shift+arrow and Page Up/Down 10%, Home and End the ends', () => {
  it('knob', () => {
    const knob = new Knob(range, 50);
    const steps: Array<[string, boolean, number]> = [
      ['ArrowUp', false, 51],
      ['ArrowRight', false, 52],
      ['ArrowDown', false, 51],
      ['ArrowLeft', false, 50],
      ['ArrowUp', true, 60],
      ['PageUp', false, 70],
      ['PageDown', false, 60],
      ['Home', false, 0],
      ['End', false, 100],
    ];
    for (const [key, shift, value] of steps) {
      expect(knob.keyDown({ key, shift })).toBe(true);
      near(knob.value, value);
    }
    expect(knob.keyDown({ key: 'a' })).toBe(false);
  });
  it('leaves keys pressed with Cmd, Ctrl or Alt to the app', () => {
    const knob = new Knob(range, 50);
    expect(knob.keyDown({ key: 'ArrowUp', command: true })).toBe(false);
    expect(knob.value).toBe(50);
    expect(new Switch().keyDown({ key: ' ', command: true })).toBe(false);
  });
  it('every control can be used from the keyboard', () => {
    expect(
      new Slider(range, { orientation: 'horizontal', length: 50 }).keyDown({ key: 'End' }),
    ).toBe(true);
    expect(
      new XYPad({ x: range, y: range }, { width: 10, height: 10 }).keyDown({ key: 'ArrowUp' }),
    ).toBe(true);
    expect(new Button().keyDown({ key: ' ' })).toBe(true);
    expect(new Switch().keyDown({ key: 'Enter' })).toBe(true);
    expect(new Keyboard({ low: 48, high: 72, width: 300, height: 80 }).keyDown({ key: 'a' })).toBe(
      true,
    );
  });
  it('says what it is to assistive technology', () => {
    expect(new Knob(range, 25).aria('Cutoff')).toMatchObject({
      role: 'slider',
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-valuenow': 25,
      tabindex: 0,
    });
    expect(new Switch(true).aria('Bypass')).toMatchObject({ role: 'switch', 'aria-checked': true });
  });
});

describe('rule 5: a slider moves from where it is grabbed; a click never jumps', () => {
  it('a click anywhere on the track changes nothing', () => {
    const slider = new Slider(range, { orientation: 'horizontal', length: 200 }, 30);
    const r = record(slider);
    slider.pointerDown({ x: 190, y: 5 });
    slider.pointerUp();
    expect(slider.value).toBe(30);
    expect(r.values()).toEqual([]);
  });
  it('moves by as much as the pointer moves along the track', () => {
    const vertical = new Slider(range, { orientation: 'vertical', length: 200 }, 30);
    vertical.pointerDown({ x: 5, y: 150 });
    vertical.pointerMove({ x: 50, y: 110 }); // 40 px up of 200
    near(vertical.value, 50);
    const horizontal = new Slider(range, { orientation: 'horizontal', length: 400 }, 30);
    horizontal.pointerDown({ x: 10, y: 0 });
    horizontal.pointerMove({ x: 50, y: 0, shift: true }); // 40 px of 400 is 10%, Shift: 1%
    near(horizontal.value, 31);
  });
});

describe('rule 6: a button is on while pressed; a switch changes on each press; Space and Enter press both', () => {
  it('button', () => {
    const button = new Button();
    const r = record(button);
    button.pointerDown();
    expect(button.value).toBe(true);
    button.pointerUp();
    expect(button.value).toBe(false);
    button.keyDown({ key: 'Enter' });
    button.keyDown({ key: 'Enter', repeat: true });
    button.keyUp({ key: 'Enter' });
    expect(r.values()).toEqual([true, false, true, false]);
  });
  it('switch', () => {
    const sw = new Switch(false);
    const r = record(sw);
    sw.pointerDown();
    sw.keyDown({ key: ' ' });
    sw.keyDown({ key: ' ', repeat: true });
    sw.pointerDown();
    expect(r.values()).toEqual([true, false, true]);
  });
});

describe('rule 7: an XY pad jumps to the click and follows; the arrows move x and y', () => {
  it('jumps and follows (y up)', () => {
    const pad = new XYPad({ x: range, y: range }, { width: 200, height: 100 }, { x: 0, y: 0 });
    pad.pointerDown({ x: 50, y: 25 });
    near(pad.value.x, 25);
    near(pad.value.y, 75);
    pad.pointerMove({ x: 200, y: 100 });
    expect(pad.value).toEqual({ x: 100, y: 0 });
  });
  it('arrows', () => {
    const pad = new XYPad({ x: range, y: range }, { width: 200, height: 100 }, { x: 50, y: 50 });
    pad.keyDown({ key: 'ArrowRight' });
    pad.keyDown({ key: 'ArrowUp', shift: true });
    near(pad.value.x, 51);
    near(pad.value.y, 60);
  });
});

describe('rule 8: the musical keyboard', () => {
  const layout = { low: 48, high: 72, width: 300, height: 100 };
  it('computer keys: A is C, W and E the black keys, Z and X the octave', () => {
    const kb = new Keyboard(layout, 60);
    const r = record(kb);
    kb.keyDown({ key: 'a' });
    kb.keyDown({ key: 'w' });
    kb.keyDown({ key: 'e' });
    expect(kb.notes).toEqual([60, 61, 63]);
    kb.keyUp({ key: 'a' });
    kb.keyUp({ key: 'w' });
    kb.keyUp({ key: 'e' });
    kb.keyDown({ key: 'x' });
    kb.keyDown({ key: 'a' });
    expect(kb.notes).toEqual([72]);
    kb.keyUp({ key: 'a' });
    kb.keyDown({ key: 'z' });
    kb.keyDown({ key: 'z' });
    kb.keyDown({ key: 'a' });
    expect(kb.notes).toEqual([48]);
    expect(
      r
        .values()
        .filter(v => v.velocity > 0)
        .map(v => v.note),
    ).toEqual([60, 61, 63, 72, 48]);
  });
  it('Cmd+Z is the app’s undo, not an octave down; a note still ends when its key comes up', () => {
    const kb = new Keyboard(layout, 60);
    expect(kb.keyDown({ key: 'z', command: true })).toBe(false);
    expect(kb.octaveStart).toBe(60);
    kb.keyDown({ key: 'a' });
    kb.keyUp({ key: 'a', command: true });
    expect(kb.notes).toEqual([]);
  });
  it('dragging across the keys plays each key it reaches', () => {
    const kb = new Keyboard(layout, 60);
    const r = record(kb);
    const y = 90; // low on the keys: white keys only
    kb.pointerDown({ x: 1, y });
    kb.pointerMove({ x: 2, y }); // same key
    kb.pointerMove({ x: 30, y }); // next white key
    kb.pointerUp();
    expect(r.values().map(v => [v.note, v.velocity > 0])).toEqual([
      [48, true],
      [48, false],
      [50, true],
      [50, false],
    ]);
    expect(r.kinds()[0]).toBe('begin');
    expect(r.kinds().at(-1)).toBe('end');
  });
  it('where a key is clicked sets how hard it plays: softer at the top', () => {
    const kb = new Keyboard(layout, 60);
    const r = record(kb);
    kb.pointerDown({ x: 1, y: 70 });
    kb.pointerUp();
    kb.pointerDown({ x: 1, y: 99 });
    kb.pointerUp();
    const [soft, hard] = r.values().filter(v => v.velocity > 0);
    expect(soft!.velocity).toBeLessThan(hard!.velocity);
    expect(hard!.velocity).toBeLessThanOrEqual(127);
  });
  it('each finger plays its own key, and pads say which note is where', () => {
    const pads = new Keyboard((x, y) => ({ note: x < 50 ? 36 : 38, velocity: y < 50 ? 40 : 120 }));
    const r = record(pads);
    pads.pointerDown({ x: 10, y: 10, pointer: 1 });
    pads.pointerDown({ x: 90, y: 90, pointer: 2 });
    expect(pads.notes).toEqual([36, 38]);
    pads.pointerUp({ pointer: 1 });
    expect(pads.notes).toEqual([38]);
    pads.pointerUp({ pointer: 2 });
    expect(r.values()).toEqual([
      { note: 36, velocity: 40 },
      { note: 38, velocity: 120 },
      { note: 36, velocity: 0 },
      { note: 38, velocity: 0 },
    ]);
    expect(r.kinds()).toEqual(['begin', 'value', 'value', 'value', 'value', 'end']);
  });
  it('black keys sit over the white ones, at the top only', () => {
    const w = layout.width / 15; // 15 white keys from C3 to C5
    expect(keyAt(layout, w - 2, 10)).toBe(49);
    expect(keyAt(layout, w - 2, 90)).toBe(48);
  });
});

describe('rule 9: scopes and meters only show; a meter holds its peak for a moment', () => {
  it('meter', () => {
    const meter = new Meter();
    meter.update(0.8, 0);
    expect(meter.update(0.1, PEAK_HOLD_MS - 1).peak).toBe(0.8);
    const later = meter.update(0.1, PEAK_HOLD_MS + 200).peak;
    expect(later).toBeLessThan(0.8);
    expect(later).toBeGreaterThan(0.1);
    expect(meter.update(Number.NaN, PEAK_HOLD_MS + 300).level).toBe(0);
  });
  it('scope', () => {
    expect(scopePoints([1, 0, -1, Number.NaN, 5], 40, 10)).toEqual([
      [0, 0],
      [10, 5],
      [20, 10],
      [30, 5],
      [40, 0],
    ]);
  });
});

describe('rule 10: every control sends begin, value and end; one drag is one gesture', () => {
  it('a drag is one begin and one end around its values', () => {
    const knob = new Knob(range, 50);
    const r = record(knob);
    knob.pointerDown({ x: 0, y: 100 });
    knob.pointerMove({ x: 0, y: 90 });
    knob.pointerMove({ x: 0, y: 80 });
    knob.pointerUp();
    expect(r.kinds()).toEqual(['begin', 'value', 'value', 'end']);
  });
  it('keys and notches are gestures of their own', () => {
    const slider = new Slider(range, { orientation: 'horizontal', length: 100 }, 50);
    const r = record(slider);
    slider.keyDown({ key: 'ArrowUp' });
    slider.wheel({ up: true });
    expect(r.kinds()).toEqual(['begin', 'value', 'end', 'begin', 'value', 'end']);
  });
  it('a value set elsewhere sends nothing', () => {
    const knob = new Knob(range, 50);
    const r = record(knob);
    knob.set(10);
    expect(knob.value).toBe(10);
    expect(r.seen).toEqual([]);
  });
});
