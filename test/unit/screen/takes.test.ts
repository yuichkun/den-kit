// Playing a take on a screen, on a clock the test moves: its moves and notes go out at
// their times; a control the person grabs is left to them until they give it back,
// when it returns to where the take has it; keys in the person's hands silence the
// take's notes; played from the middle, the controls start where the take has them
// and the notes held there sound. And a take's steps in words, and when the person's
// control has got where the take's went, and what is off when it has not.
import { describe, expect, it } from 'vite-plus/test';
import {
  describeStep,
  reached,
  stepNotes,
  stepTargets,
  stillToDo,
} from '../../../src/screen/takes/take-steps.ts';
import { TakePlayback } from '../../../src/screen/takes/take-play.ts';
import type { WidgetSpec } from '../../../src/screen/spec.ts';
import { takeSteps, TAKE_FORMAT, type Take, type TakeValues } from '../../../src/work/takes.ts';

const take: Take = {
  format: TAKE_FORMAT,
  version: 1,
  name: 'Sweep',
  length: 3000,
  start: { cut: { value: 100 }, pad: { x: 0.5, y: 0.5 } },
  moves: [
    { t: 1000, control: 'cut', values: { value: 200 } },
    { t: 1100, control: 'cut', values: { value: 400 } },
    { t: 2000, control: 'pad', values: { x: 0.9, y: 0.1 } },
  ],
  notes: [
    { t: 500, note: 48, velocity: 90, length: 1000 },
    { t: 2500, note: 50, velocity: 70, length: 200 },
  ],
};

function playing() {
  let now = 0;
  const sent: string[] = [];
  const p = new TakePlayback(
    take,
    {
      move: (control: string, values: TakeValues) =>
        sent.push(`${control} ${JSON.stringify(values)}`),
      note: (note: number, on: boolean, velocity: number) =>
        sent.push(on ? `on ${note} ${velocity}` : `off ${note}`),
    },
    () => now,
  );
  const at = (t: number) => {
    now = t;
    p.tick();
  };
  return { p, sent, at };
}

describe('a take playing', () => {
  it('sends its moves and notes at their times, from where the controls start, and stops at its end', () => {
    const { p, sent, at } = playing();
    let ended = 0;
    p.onEnd = () => ended++;
    p.play(0);
    expect(sent.splice(0)).toEqual(['cut {"value":100}', 'pad {"x":0.5,"y":0.5}']);
    at(499);
    expect(sent).toEqual([]);
    at(1050);
    expect(sent.splice(0)).toEqual(['on 48 90', 'cut {"value":200}']);
    at(2600);
    expect(sent.splice(0)).toEqual([
      'cut {"value":400}',
      'off 48',
      'pad {"x":0.9,"y":0.1}',
      'on 50 70',
    ]);
    expect(p.isMoving('pad', 1000)).toBe(true);
    at(5000);
    expect(sent.splice(0)).toEqual(['off 50']);
    expect([p.playing, p.position, ended]).toEqual([false, 3000, 1]);
  });

  it('leaves a grabbed control to the person, and puts it back where the take has it when given back', () => {
    const { p, sent, at } = playing();
    p.play(0);
    p.grab('cut');
    sent.length = 0;
    at(1200);
    expect(sent.splice(0)).toEqual(['on 48 90']);
    p.giveBack('cut');
    expect(sent.splice(0)).toEqual(['cut {"value":400}']);
    // Played again from the start, a control in hand stays where the person has it.
    p.grab('pad');
    p.play(0);
    expect(sent.splice(0)).toEqual(['off 48', 'cut {"value":100}']);
  });

  it('is silent on the keys while the person plays them, and lets go of the notes it holds', () => {
    const { p, sent, at } = playing();
    p.play(0);
    at(600);
    sent.length = 0;
    p.setKeysInHand(true);
    expect(sent.splice(0)).toEqual(['off 48']);
    at(2700);
    expect(sent.filter(s => s.startsWith('on'))).toEqual([]);
  });

  it('played from the middle, starts the controls where the take has them and sounds the notes held there', () => {
    const { p, sent, at } = playing();
    p.playRange(1050, 1600);
    expect(sent.splice(0)).toEqual(['cut {"value":200}', 'pad {"x":0.5,"y":0.5}', 'on 48 90']);
    // The clock has moved 50 ms: the take is at 1100.
    at(50);
    expect(sent.splice(0)).toEqual(['cut {"value":400}']);
    at(1000);
    expect(sent.splice(0)).toEqual(['off 48']);
    expect([p.playing, p.position]).toEqual([false, 1600]);
    expect(p.valuesAt('pad', 2500)).toEqual({ x: 0.9, y: 0.1 });
    expect(p.valuesAt('cut', 0)).toEqual({ value: 100 });
  });

  it('pauses where it is, letting go of its notes, and goes on from there', () => {
    const { p, sent, at } = playing();
    p.play(0);
    at(700);
    p.pause();
    expect(sent.at(-1)).toBe('off 48');
    expect(p.position).toBe(700);
    sent.length = 0;
    at(5000);
    p.play();
    expect(sent.splice(0)).toEqual(['cut {"value":100}', 'pad {"x":0.5,"y":0.5}', 'on 48 90']);
    at(5000 + 400);
    expect(sent.splice(0)).toEqual(['cut {"value":200}', 'cut {"value":400}']);
  });
});

const widget = (over: Partial<WidgetSpec>): WidgetSpec => ({
  id: 'w',
  type: 'ui.knob',
  control: 'knob',
  label: 'CUTOFF',
  config: { min: 40, max: 4000, scale: 'log', unit: 'Hz' },
  values: { value: 100 },
  probe: -1,
  skin: { name: 'default', params: {} },
  ...over,
});
const controls = {
  cut: widget({ id: 'cut', label: 'CUTOFF' }),
  pad: widget({
    id: 'pad',
    type: 'ui.xy',
    control: 'xy',
    label: 'Tone',
    config: {},
    values: { x: 0.5, y: 0.5 },
  }),
};

describe("a take's steps in words", () => {
  it('say what to move, which way, from where to where and how fast, and the notes to play', () => {
    const words = takeSteps(take).map(s => describeStep(s, controls));
    expect(words).toEqual([
      { title: 'Hold C3 for 1.0 s', lines: [] },
      {
        title: 'Turn CUTOFF up, 100 Hz → 400 Hz, quickly',
        lines: ['The take plays the keys meanwhile: C3'],
      },
      { title: 'Drag Tone from the middle to the bottom right, quickly', lines: [] },
      { title: 'Play D3', lines: [] },
    ]);
  });

  it('say a chord, a run of notes, and a movement that goes around', () => {
    const chord = takeSteps({
      ...take,
      moves: [],
      notes: [48, 52, 55].map(note => ({ t: 0, note, velocity: 90, length: 2000 })),
    });
    expect(describeStep(chord[0]!, controls).title).toBe('Hold C3 E3 G3 together for 2.0 s');
    const run = takeSteps({
      ...take,
      moves: [],
      notes: [48, 50, 52].map((note, i) => ({ t: i * 200, note, velocity: 90, length: 150 })),
    });
    expect(describeStep(run[0]!, controls).title).toBe('Play C3 · D3 · E3');
    const around = takeSteps({
      ...take,
      notes: [],
      moves: [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => ({
        t: i * 100,
        control: 'pad',
        values: { x: 0.5 + 0.3 * Math.cos(i), y: 0.5 + 0.3 * Math.sin(i) },
      })),
    });
    expect(describeStep(around[0]!, controls).title).toMatch(/^Move Tone around, ending at /);
  });

  it('know which controls a step moves and where to, and which notes it leaves to the person', () => {
    const [hold, turn] = takeSteps(take);
    expect(stepNotes(hold!)).toEqual([48]);
    expect(stepNotes(turn!)).toEqual([]);
    expect(stepTargets(turn!)).toEqual(new Map([['cut', { value: 400 }]]));
  });
});

describe("whether the person's control got where the take's went", () => {
  it('counts near enough, along the control’s own scale', () => {
    const knob = (value: number) => widget({ values: { value } });
    expect(reached(knob(400), { value: 400 })).toBe(true);
    // 5% of the way along a log knob's travel is near; a quarter is not.
    expect(reached(knob(400 * (4000 / 40) ** 0.05), { value: 400 })).toBe(true);
    expect(reached(knob(400 * (4000 / 40) ** 0.25), { value: 400 })).toBe(false);
    const pad = (x: number, y: number) => ({ ...controls.pad, values: { x, y } });
    expect(reached(pad(0.85, 0.15), { x: 0.9, y: 0.1 })).toBe(true);
    expect(reached(pad(0.5, 0.5), { x: 0.9, y: 0.1 })).toBe(false);
    const sw = widget({ type: 'ui.toggle', control: 'toggle', values: { value: true } });
    expect(reached(sw, { value: 1 })).toBe(true);
    expect(reached(sw, { value: false })).toBe(false);
  });

  it('says what is still off when it did not', () => {
    expect(stillToDo(widget({ values: { value: 4000 } }), { value: 2400 }, true)).toBe(
      'CUTOFF is at 4.00 kHz: bring it down to 2.40 kHz.',
    );
    expect(stillToDo(controls.pad, { x: 0.9, y: 0.1 }, true)).toBe(
      'End Tone in the circle, at the bottom right.',
    );
    expect(stillToDo(controls.cut, { value: 400 }, false)).toBe('Now move CUTOFF too.');
  });
});
