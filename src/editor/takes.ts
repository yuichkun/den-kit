// Takes in the editor (src/work/takes.ts): recording one while the person plays the
// plugin, and playing the plugin without changing the work, which recording and the
// look at the work as the person it is handed to (TakeRoom.vue) both do.
//
// While a take records, the controls the person moves are the take's, not the
// work's: they show on a copy of the document and the sound follows them, and when
// the take stops the controls are back where the work has them. The take then lands
// as one operation that adds its file (setProjectFiles), so ⌘Z takes it back and the
// work file carries it. Every note played counts, from the plugin's keys, the
// keyboard bar, the computer keys or MIDI; control moves count when the person makes
// them on the plugin, not when a canvas or code part makes them.
import { ref, shallowRef, type ShallowRef } from 'vue';
import { currentValues } from '../sound/codegen.ts';
import { pluginSpec } from '../screen/build.ts';
import { toUnit } from '../screen/format.ts';
import { applyIntents, type Intent } from '../work/ops.ts';
import type { PatchDocument } from '../work/schema.ts';
import {
  serializeTake,
  simplifyMoves,
  takePathFor,
  takesOf,
  TAKE_FORMAT,
  TAKE_LIMITS,
  TAKE_VERSION,
  type Take,
  type TakeMove,
  type TakeNote,
  type TakeValues,
} from '../work/takes.ts';
import type { KitSession } from './session.ts';

/**
 * Controls moved without changing the work: a copy of the document shows them, and the
 * sound gets their values directly. `end` puts the sound back to the work's values.
 */
export class LocalPlay {
  readonly doc: ShallowRef<PatchDocument>;
  /** The sound's values this has changed, as it set them. */
  private readonly sent = new Map<string, number>();
  private readonly session: KitSession;
  constructor(session: KitSession) {
    this.session = session;
    this.doc = shallowRef(session.doc.value);
  }
  change(widget: string, values: Record<string, number | boolean>) {
    if (!this.doc.value.nodes[widget]) return;
    const intents: Intent[] = Object.entries(values).map(([port, value]) => ({
      op: 'setValue',
      node: widget,
      port,
      value,
      clamp: true,
    }));
    try {
      this.doc.value = applyIntents(this.doc.value, intents, this.session.catalog).doc;
    } catch {
      return;
    }
    const g = this.session.generated.value;
    const solo = this.session.solo.value;
    const next = currentValues(this.doc.value, this.session.catalog, g, solo ? { solo } : {});
    for (const [name, value] of Object.entries(next)) {
      const now = this.sent.get(name) ?? g.values[name];
      if (value === now) continue;
      this.session.engine.setParam(name, value);
      this.sent.set(name, value);
    }
  }
  end() {
    const values = this.session.generated.value.values;
    for (const [name, value] of this.sent)
      if (values[name] !== undefined && values[name] !== value)
        this.session.engine.setParam(name, values[name]);
    this.sent.clear();
  }
}

/** Controls with no value to record. */
const SILENT = new Set(['ui.keyboard', 'ui.scope', 'ui.meter']);
/** Quiet time kept before the first thing played and after the last. */
const LEAD = 300;

export class TakeRecorder {
  readonly active = ref(false);
  /** ms since recording started. */
  readonly elapsed = ref(0);
  /** What the plugin shows while recording (null: the work). */
  readonly doc = shallowRef<PatchDocument | null>(null);
  private local: LocalPlay | null = null;
  private startedAt = 0;
  private start: Record<string, TakeValues> = {};
  private ranges = new Map<string, { min: number; max: number; log: boolean } | 'xy'>();
  private moves: TakeMove[] = [];
  private notes: TakeNote[] = [];
  private held = new Map<number, { t: number; velocity: number }>();
  private stopListening: (() => void) | null = null;
  private timer = 0;
  private readonly session: KitSession;

  constructor(session: KitSession) {
    this.session = session;
  }

  begin() {
    if (this.active.value) return;
    const spec = pluginSpec(
      this.session.doc.value,
      this.session.catalog,
      this.session.generated.value,
    );
    this.start = {};
    this.ranges.clear();
    for (const w of spec.widgets) {
      if (SILENT.has(w.type) || !Object.keys(w.values).length) continue;
      this.start[w.id] = { ...w.values };
      if (w.type === 'ui.xy') this.ranges.set(w.id, 'xy');
      else if (w.type === 'ui.knob' || w.type === 'ui.slider')
        this.ranges.set(w.id, {
          min: Number(w.config.min ?? 0),
          max: Number(w.config.max ?? 1),
          log: w.config.scale === 'log',
        });
    }
    this.local = new LocalPlay(this.session);
    this.doc.value = this.local.doc.value;
    this.moves = [];
    this.notes = [];
    this.held.clear();
    this.startedAt = performance.now();
    this.elapsed.value = 0;
    this.stopListening = this.session.onNote((note, on, velocity) => this.note(note, on, velocity));
    this.timer = window.setInterval(() => {
      this.elapsed.value = performance.now() - this.startedAt;
      if (this.elapsed.value >= TAKE_LIMITS.ms - 1000) void this.stop();
    }, 200);
    this.active.value = true;
  }

  /** A control the person moved on the plugin while recording. */
  move(widget: string, values: Record<string, number | boolean>) {
    if (!this.local) return;
    this.local.change(widget, values);
    this.doc.value = this.local.doc.value;
    if (this.start[widget] && this.moves.length < TAKE_LIMITS.moves * 4)
      this.moves.push({
        t: performance.now() - this.startedAt,
        control: widget,
        values: { ...values },
      });
  }

  private note(note: number, on: boolean, velocity: number) {
    const t = performance.now() - this.startedAt;
    const open = this.held.get(note);
    if (open) {
      this.notes.push({
        t: open.t,
        note,
        velocity: open.velocity,
        length: Math.max(1, t - open.t),
      });
      this.held.delete(note);
    }
    if (on) this.held.set(note, { t, velocity });
  }

  /** Stop, and keep what was played as a take in the work. Returns the take's path, or null when nothing was played. */
  stop(): string | null {
    if (!this.active.value || !this.local) return null;
    const end = performance.now() - this.startedAt;
    for (const [note, open] of this.held)
      this.notes.push({
        t: open.t,
        note,
        velocity: open.velocity,
        length: Math.max(1, end - open.t),
      });
    this.held.clear();
    this.stopListening?.();
    this.stopListening = null;
    window.clearInterval(this.timer);
    this.local.end();
    this.local = null;
    this.doc.value = null;
    this.active.value = false;
    const moves = simplifyMoves(this.moves, (control, values) => {
      const r = this.ranges.get(control);
      if (r === 'xy') return [Number(values.x ?? 0), Number(values.y ?? 0)];
      return r ? [toUnit(Number(values.value), r.min, r.max, r.log)] : null;
    }).slice(0, TAKE_LIMITS.moves);
    const notes = this.notes.slice(0, TAKE_LIMITS.notes);
    if (!moves.length && !notes.length) {
      this.session.toast('info', 'Nothing was played, so no take was kept.');
      return null;
    }
    // The take starts a moment before the first thing played and ends a moment after the last.
    const first = Math.min(...moves.map(m => m.t), ...notes.map(n => n.t));
    const last = Math.max(...moves.map(m => m.t), ...notes.map(n => n.t + n.length));
    const shift = Math.max(0, first - LEAD);
    const name = `Take ${takesOf(this.session.doc.value.files).length + 1}`;
    const take: Take = {
      format: TAKE_FORMAT,
      version: TAKE_VERSION,
      name,
      length: Math.max(1, Math.round(Math.min(end, last + LEAD) - shift)),
      start: this.start,
      moves: moves.map(m => ({ ...m, t: Math.round(m.t - shift) })),
      notes: notes
        .map(n => ({ ...n, t: Math.round(n.t - shift), length: Math.round(n.length) }))
        .sort((a, b) => a.t - b.t || a.note - b.note),
    };
    const path = takePathFor(name, this.session.doc.value.files);
    const r = this.session.commit(
      [{ op: 'setProjectFiles', files: { [path]: serializeTake(take) } }],
      {
        label: `Record ${name}`,
      },
    );
    if (!r.ok) {
      this.session.toast('warn', `The take was not kept: ${r.error.message}`);
      return null;
    }
    this.session.toast(
      'info',
      `${name} is in the work (⌘Z takes it back). Try it as the person you hand the work to: Takes ▾.`,
    );
    return path;
  }

  /** Stop without keeping anything. */
  cancel() {
    if (!this.active.value) return;
    this.stopListening?.();
    this.stopListening = null;
    window.clearInterval(this.timer);
    this.local?.end();
    this.local = null;
    this.doc.value = null;
    this.active.value = false;
  }
}
