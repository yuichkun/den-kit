// Templates for "make a bass" style requests: whole patches built from the
// den starters (CANDIDATE sound) plus a few value changes per preset. Slots
// (brighter, longer release, …) are applied afterwards as ordinary intents.
import type { Catalog } from '../core/catalog.ts';
import { applyIntents, type Intent } from '../core/ops.ts';
import { starter, type StarterId } from '../core/starters.ts';
import type { PatchDocument } from '../core/schema.ts';

export const TEMPLATES = ['bass', 'pad', 'lead', 'pluck', 'keys', 'perc'] as const;
export type TemplateId = typeof TEMPLATES[number];

export const TEMPLATE_INFO: Record<TemplateId, { title: string; doc: string; base: StarterId; tweaks: Intent[] }> = {
  bass: { title: 'Bass', doc: 'mono bass synth', base: 'bass', tweaks: [] },
  pad: { title: 'Pad', doc: 'slow, soft polyphonic pad / strings', base: 'pad', tweaks: [] },
  perc: { title: 'Percussion', doc: 'drum / kick / percussive hit', base: 'percussion', tweaks: [] },
  lead: {
    title: 'Lead', doc: 'mono lead synth for melodies', base: 'bass',
    tweaks: [
      v('cut1', 'hz', 900), v('fdepth1', 'b', 2.5), v('fenv1', 'decay', 0.35), v('fenv1', 'sustain', 0.35),
      v('aenv1', 'attack', 0.01), v('aenv1', 'sustain', 0.85), v('aenv1', 'release', 0.25), v('filter1', 'resonance', 1.2), v('gain1', 'gain', 0.1),
    ],
  },
  pluck: {
    title: 'Pluck', doc: 'short plucked polyphonic notes', base: 'pad',
    tweaks: [
      v('aenv1', 'attack', 0.002), v('aenv1', 'decay', 0.35), v('aenv1', 'sustain', 0), v('aenv1', 'release', 0.25),
      v('fenv1', 'attack', 0.001), v('fenv1', 'decay', 0.25), v('fenv1', 'sustain', 0), v('fenv1', 'release', 0.2),
      v('fdepth1', 'b', 2.5), v('cut1', 'hz', 500), v('flfo1', 'b', 0), v('trem1', 'depth', 0), v('gain1', 'gain', 0.06),
    ],
  },
  keys: {
    title: 'Keys', doc: 'electric-piano-like polyphonic keys', base: 'pad',
    tweaks: [
      v('aenv1', 'attack', 0.005), v('aenv1', 'decay', 0.9), v('aenv1', 'sustain', 0.35), v('aenv1', 'release', 0.45),
      v('fenv1', 'attack', 0.005), v('fenv1', 'decay', 0.6), v('fenv1', 'sustain', 0.2), v('fenv1', 'release', 0.4),
      v('fdepth1', 'b', 1.6), v('cut1', 'hz', 700), v('flfo1', 'b', 0.05), v('trem1', 'depth', 0.15), v('gain1', 'gain', 0.06),
    ],
  },
};

function v(node: string, port: string, value: number): Intent { return { op: 'setValue', node, port, value }; }

export function buildTemplate(id: TemplateId, catalog: Catalog): PatchDocument {
  const info = TEMPLATE_INFO[id];
  const base = starter(info.base, catalog);
  const intents: Intent[] = [...info.tweaks, { op: 'setName', name: info.title }];
  return applyIntents(base, intents, catalog).doc;
}
