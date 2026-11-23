// What the sketch's tabs share (Delivery.vue provides it): the author's side, the
// builds by version, the version in use, the recipient's state (or a reply's, read
// only, when the author opens one), the live sound, and the render of one step or
// one order-sheet file, so every tab makes the same sound from the same setting.
import type { ComputedRef, InjectionKey } from 'vue';
import type { LiveSound, RenderJob } from './audio.ts';
import type { Kept, RecipientState } from './record.ts';
import { applyCondition, variation, type Condition, type DeliverySpec } from './spec.ts';
import type { Build, Setting } from './sound.ts';

export interface DeliveryContext {
  work: string;
  spec: DeliverySpec;
  /** A version's build, loaded once. */
  build(version: string): Promise<Build>;
  /** The builds loaded so far, by version. */
  builds: Readonly<Record<string, Build>>;
  /** The build of the version in use. */
  active: ComputedRef<Build | null>;
  state: RecipientState;
  /** The author is reading a reply: nothing changes and nothing is saved. */
  readonly: boolean;
  live: LiveSound;
  keep(item: Pick<Kept, 'name' | 'setting' | 'from' | 'pos'>): void;
}

export const DELIVERY: InjectionKey<DeliveryContext> = Symbol('delivery');

/** One step of a setting, as the kept list and the compare list play it. */
export function stepJob(spec: DeliverySpec, build: Build, setting: Setting): RenderJob {
  return {
    build,
    setting,
    steps: [{ at: 0, note: spec.notes[0]!, velocity: 96, hold: 0.2 }],
    seconds: spec.length,
    preroll: 2,
  };
}

/** The order sheet's file `index` of a row under a condition, from its seed. */
export function fileJob(
  spec: DeliverySpec,
  build: Build,
  setting: Setting,
  condition: Condition,
  index: number,
  seed: number,
): RenderJob {
  const v = variation(
    build.controls,
    applyCondition(build.controls, setting, condition),
    spec.spread,
    condition.velocity,
    seed,
  );
  return {
    build,
    setting: v.setting,
    steps: [
      { at: 0, note: spec.notes[index % spec.notes.length]!, velocity: v.velocity, hold: 0.2 },
    ],
    seconds: spec.length,
    preroll: v.preroll,
  };
}
