// The Shared prototype's made-up story (src/editor/shared/after-sharing.ts): the same story for
// the same work, made from the controls on its plugin; what each level and view can answer; a
// sent-back setting as edits of the work; the receiver's visit joining the story.
import { describe, expect, it } from 'vite-plus/test';
import { catalog } from '../../../src/sound/blocks/index.ts';
import { starter } from '../../../src/work/starters.ts';
import type { WidgetSpec, WidgetType } from '../../../src/screen/spec.ts';
import {
  DECISIONS,
  YOU,
  answer,
  makeStory,
  nobody,
  personRows,
  plugInMarks,
  position,
  storyControls,
  tally,
  truth,
  valueAt,
  valueText,
  settingIntents,
  withYou,
  type StoryControl,
} from '../../../src/editor/shared/after-sharing.ts';

const widget = (
  id: string,
  type: WidgetType,
  config: WidgetSpec['config'] = {},
  rect: WidgetSpec['rect'] = { x: 0, y: 0, w: 80, h: 80 },
): WidgetSpec => ({
  id,
  type,
  control: 'knob',
  label: id,
  rect,
  config,
  values: {},
  probe: -1,
  skin: { name: 'default' },
});
const WIDGETS = [
  widget('drive', 'ui.knob', { min: 0, max: 1, scale: 'linear', unit: '' }),
  widget('cutoff', 'ui.slider', { min: 20, max: 20000, scale: 'log', unit: 'Hz' }),
  widget('hiss', 'ui.toggle'),
  widget('pad', 'ui.xy'),
  widget('keys', 'ui.keyboard'),
  { ...widget('hidden', 'ui.knob', { min: 0, max: 1 }), rect: undefined },
];
const controls = storyControls(WIDGETS);
const everyLink = (story: ReturnType<typeof makeStory>) => new Set(story.links.map(l => l.id));

describe('the made-up story', () => {
  it('is made from the controls on the plugin that people can leave somewhere', () => {
    expect(controls.map(c => [c.id, c.kind, c.log])).toEqual([
      ['drive', 'range', false],
      ['cutoff', 'range', true],
      ['hiss', 'toggle', false],
      ['pad', 'xy', false],
    ]);
  });

  it('is the same for the same work, and another for another work', () => {
    expect(makeStory('public', 'patch-a', controls)).toEqual(
      makeStory('public', 'patch-a', controls),
    );
    expect(makeStory('public', 'patch-b', controls).visits).not.toEqual(
      makeStory('public', 'patch-a', controls).visits,
    );
  });

  it('keeps every value it leaves inside the control’s range', () => {
    const story = makeStory('public', 'patch-a', controls);
    for (const v of story.visits)
      for (const [id, values] of Object.entries(v.left)) {
        const c = controls.find(x => x.id === id)!;
        if (c.kind === 'range') {
          expect(values.value).toBeGreaterThanOrEqual(c.min);
          expect(values.value).toBeLessThanOrEqual(c.max);
        }
        if (c.kind === 'toggle') expect(typeof values.value).toBe('boolean');
        if (c.kind === 'xy')
          expect([values.x, values.y].every(n => Number(n) >= 0 && Number(n) <= 1)).toBe(true);
      }
  });

  it('counts machine previews apart, and a press of play only after an open', () => {
    const story = makeStory('public', 'patch-a', controls);
    const all = tally(story, everyLink(story));
    expect(all.previews.people).toBe(0);
    expect(all.opened.count).toBeGreaterThanOrEqual(all.played.count);
    expect(all.played.count).toBeGreaterThanOrEqual(all.listened.count);
    // People come back (more opens than people) and some on another device (more browsers than people).
    expect(all.opened.count).toBeGreaterThan(all.opened.people);
    expect(all.opened.browsers).toBeGreaterThan(all.opened.people);
  });

  it('has people leave the first range control at its top, and the browser level count each browser once', () => {
    const story = makeStory('public', 'patch-a', controls);
    const byPlay = plugInMarks(story, controls, 'links');
    const byBrowser = plugInMarks(story, controls, 'browsers');
    expect(byPlay.find(m => m.control.id === 'drive')!.end).toBe('top');
    for (const [i, m] of byBrowser.entries()) {
      expect(m.of).toBeLessThanOrEqual(byPlay[i]!.of);
      expect(m.moved).toBeLessThanOrEqual(m.of);
    }
  });

  it('gives each person their own link: the drummer’s reached three people, the studio never pressed play', () => {
    const story = makeStory('people', 'patch-a', controls);
    const rows = Object.fromEntries(personRows(story).map(r => [r.link.id, r]));
    expect(rows.engineer).toMatchObject({ people: 1, version: 2 });
    expect(rows.drummer).toMatchObject({ people: 3, browsers: 3, version: 1 });
    expect(rows.studio).toMatchObject({ opens: 1, plays: 0, people: 1 });
    expect(rows.engineer!.days.filter(n => n).length).toBeGreaterThan(
      rows.drummer!.days.filter(n => n).length,
    );
    expect(truth(story, 'links')).toMatch(
      /“For the drummer” was opened by 3 people\. Per link, that is \d+ opens/,
    );
  });
});

describe('what a level and a view answer', () => {
  const decision = (id: string) => DECISIONS.find(d => d.id === id)!;
  it('answers a decision only where the view and the level it needs are both chosen', () => {
    expect(answer(decision('beyond'), 'numbers', 'browsers').state).toBe('here');
    expect(answer(decision('beyond'), 'returns', 'browsers').state).toBe('elsewhere');
    expect(answer(decision('beyond'), 'numbers', 'links')).toEqual({
      state: 'partly',
      text: 'More opens than you expect, but one person coming back looks the same.',
    });
    expect(answer(decision('page'), 'numbers', 'returns').state).toBe('no');
    expect(answer(decision('wants'), 'returns', 'returns').state).toBe('here');
  });
  it('has decisions for both ways of sharing', () => {
    expect(DECISIONS.filter(d => d.scene === 'public').length).toBeGreaterThan(2);
    expect(DECISIONS.filter(d => d.scene === 'people').length).toBeGreaterThan(2);
  });
});

describe('values and settings', () => {
  const range = (min: number, max: number, log = false): StoryControl => ({
    id: 'k',
    label: 'K',
    kind: 'range',
    min,
    max,
    log,
    unit: 's',
  });
  it('places values along a range, by ratio on a log range, and rounds them to the range', () => {
    expect(position(range(20, 20000, true), valueAt(range(20, 20000, true), 0.5))).toBeCloseTo(
      0.5,
      2,
    );
    expect(valueAt(range(0, 1), 0.333333)).toBe(0.333);
    expect(valueAt(range(0, 0.02), 0.5)).toBe(0.01);
    expect(valueText(range(0, 6), { value: 2.950410259 })).toBe('2.95 s');
  });
  it('turns a sent-back setting into edits of the controls the work still has', () => {
    const doc = starter('bass', catalog);
    const node = Object.keys(doc.nodes)[0]!;
    expect(
      settingIntents(doc, {
        id: 'r1',
        kind: 'setting',
        link: 'social',
        person: 1,
        day: 0,
        title: 'Darker',
        text: '',
        values: { [node]: { value: 0.4 }, gone: { value: 1 } },
      }),
    ).toEqual([{ op: 'setValue', node, port: 'value', value: 0.4, clamp: true }]);
  });
  it('adds the receiver’s visit, what they sent and the link they made to the story', () => {
    const story = makeStory('public', 'patch-a', controls);
    const before = tally(story, everyLink(story));
    const you = {
      ...nobody(),
      previews: 1,
      visits: [
        {
          link: 'social',
          person: YOU,
          browser: YOU,
          day: 13,
          played: true,
          seconds: 40,
          left: { drive: { value: 1 } },
          version: 1,
        },
      ],
      returns: [
        {
          id: 'you1',
          kind: 'note' as const,
          link: 'social',
          person: YOU,
          day: 13,
          title: 'Hi',
          text: '',
        },
      ],
      passed: {
        id: 'passed-you',
        name: 'Yours',
        from: 'social',
        by: { person: YOU, browser: YOU },
        previews: 0,
      },
    };
    const after = tally(withYou(story, you, 'social'), everyLink(withYou(story, you, 'social')));
    expect(after.previews.count).toBe(before.previews.count + 1);
    expect(after.opened.count).toBe(before.opened.count + 1);
    expect(after.listened.count).toBe(before.listened.count + 1);
    expect(after.moved.count).toBe(before.moved.count + 1);
    expect(after.passed.count).toBe(before.passed.count + 1);
    expect(after.sent.count).toBe(before.sent.count + 1);
  });
});
