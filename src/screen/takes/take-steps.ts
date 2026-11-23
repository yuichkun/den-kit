// A take's steps (src/work/takes.ts) in words, for the person who follows them: what
// to move, which way, from where to where and how fast, and which notes to play; and
// whether the person's control has got where the take's went, and what is off if not.
import type { TakeGesture, TakeNote, TakeStep, TakeValues } from '../../work/takes.ts';
import { formatValue, noteName, toUnit } from '../format.ts';
import type { WidgetSpec } from '../spec.ts';

export interface StepText {
  title: string;
  lines: string[];
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const pace = (ms: number) => (ms < 300 ? 'quickly' : `over ${seconds(ms)}`);
const num = (v: number | boolean | undefined) => (typeof v === 'number' ? v : v ? 1 : 0);

function ranged(w: WidgetSpec) {
  const min = Number(w.config.min ?? 0),
    max = Number(w.config.max ?? 1);
  return { min, max, log: w.config.scale === 'log', unit: String(w.config.unit ?? '') };
}
/** Where on an XY pad a point is, in words. */
function zone(x: number, y: number) {
  const v = y > 0.67 ? 'top' : y < 0.33 ? 'bottom' : '';
  const h = x < 0.33 ? 'left' : x > 0.67 ? 'right' : '';
  const z = `${v} ${h}`.trim();
  return z ? `the ${z}` : 'the middle';
}

function gestureText(g: TakeGesture, w: WidgetSpec): string {
  const ms = g.to - g.from;
  if (w.type === 'ui.xy') {
    const a = g.before ?? g.moves[0]!.values,
      b = g.after;
    const [ax, ay, bx, by] = [num(a.x), num(a.y), num(b.x), num(b.y)];
    let path = 0;
    let last = { x: ax, y: ay };
    for (const m of g.moves) {
      const p = { x: num(m.values.x ?? last.x), y: num(m.values.y ?? last.y) };
      path += Math.hypot(p.x - last.x, p.y - last.y);
      last = p;
    }
    const straight = Math.hypot(bx - ax, by - ay);
    if (path > 0.25 && path > straight * 2.2)
      return `Move ${w.label} around, ending at ${zone(bx, by)}, ${pace(ms)}`;
    return `Drag ${w.label} from ${zone(ax, ay)} to ${zone(bx, by)}, ${pace(ms)}`;
  }
  if (w.type === 'ui.toggle' || w.type === 'ui.button') {
    if (w.type === 'ui.button') return `Press ${w.label}`;
    return `Switch ${w.label} ${num(g.after.value) ? 'on' : 'off'}`;
  }
  const r = ranged(w);
  const from = num((g.before ?? g.moves[0]!.values).value),
    to = num(g.after.value);
  const verb = w.type === 'ui.slider' ? 'Slide' : 'Turn';
  const way = to > from ? 'up' : to < from ? 'down' : 'and back';
  return `${verb} ${w.label} ${way}, ${formatValue(from, r.unit)} → ${formatValue(to, r.unit)}, ${pace(ms)}`;
}

/** Notes started within this of each other are played together. */
const TOGETHER = 80;
/** The notes' names, the first few when there are many. */
function names(notes: readonly TakeNote[], most: number) {
  const list = notes.slice(0, most).map(n => noteName(n.note));
  return notes.length > most ? `${list.join(' · ')} … (${notes.length} notes)` : list.join(' · ');
}
function notesText(notes: readonly TakeNote[]): string {
  if (!notes.length) return '';
  const together = notes.every(n => n.t - notes[0]!.t <= TOGETHER);
  const held = Math.min(...notes.map(n => n.length));
  if (together && notes.length > 1)
    return `Hold ${notes.map(n => noteName(n.note)).join(' ')} together${held >= 1000 ? ` for ${seconds(held)}` : ''}`;
  if (notes.length === 1)
    return held >= 1000
      ? `Hold ${noteName(notes[0]!.note)} for ${seconds(held)}`
      : `Play ${noteName(notes[0]!.note)}`;
  return `Play ${names(notes, 16)}`;
}

/** A step in words: its title, and a line for each thing it asks when it asks several. */
export function describeStep(
  step: TakeStep,
  controls: Readonly<Record<string, WidgetSpec>>,
): StepText {
  const moves = step.gestures.flatMap(g => {
    const w = controls[g.control];
    return w ? [{ g, w, text: gestureText(g, w) }] : [];
  });
  if (!moves.length) return { title: notesText(step.notes) || 'Listen', lines: [] };
  const lines = moves.length > 1 ? moves.map(m => m.text) : [];
  if (step.notes.length) lines.push(`The take plays the keys meanwhile: ${names(step.notes, 6)}`);
  const labels = [...new Set(moves.map(m => m.w.label))];
  return {
    title: moves.length === 1 ? moves[0]!.text : `Move ${labels.join(' and ')} together`,
    lines,
  };
}

/** Each control a step moves, with where it ends up. */
export function stepTargets(step: TakeStep): Map<string, TakeValues> {
  const out = new Map<string, TakeValues>();
  for (const g of step.gestures) out.set(g.control, { ...out.get(g.control), ...g.after });
  return out;
}
/** The notes a step asks the person to play (a step that also moves controls leaves its notes to the take). */
export function stepNotes(step: TakeStep): number[] {
  return step.gestures.length ? [] : [...new Set(step.notes.map(n => n.note))];
}

/** The control is where the take's went, near enough to count. */
export function reached(w: WidgetSpec, target: TakeValues): boolean {
  if (w.type === 'ui.xy')
    return (
      Math.hypot(
        num(w.values.x) - num(target.x ?? w.values.x),
        num(w.values.y) - num(target.y ?? w.values.y),
      ) <= 0.12
    );
  if (w.type === 'ui.toggle' || w.type === 'ui.button')
    return !!num(w.values.value) === !!num(target.value);
  const r = ranged(w);
  return (
    Math.abs(
      toUnit(num(w.values.value), r.min, r.max, r.log) -
        toUnit(num(target.value), r.min, r.max, r.log),
    ) <= 0.06
  );
}

/** What is left for the control to be where the take's went, in words (`touched`: the person has moved it). */
export function stillToDo(w: WidgetSpec, target: TakeValues, touched: boolean): string {
  if (!touched) return `Now move ${w.label} too.`;
  if (w.type === 'ui.xy')
    return `End ${w.label} in the circle, at ${zone(num(target.x ?? w.values.x), num(target.y ?? w.values.y))}.`;
  if (w.type === 'ui.button') return `Press ${w.label}.`;
  if (w.type === 'ui.toggle') return `Switch ${w.label} ${num(target.value) ? 'on' : 'off'}.`;
  const r = ranged(w);
  const now = num(w.values.value),
    to = num(target.value);
  return `${w.label} is at ${formatValue(now, r.unit)}: bring it ${now > to ? 'down' : 'up'} to ${formatValue(to, r.unit)}.`;
}
