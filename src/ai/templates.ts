// Presets for the manual starter menu: whole patches built from the
// den starters (CANDIDATE sound) plus a few value changes per preset, each with
// a first plugin screen (its name, knobs for its main parameters, a keyboard).
import type { Catalog } from '../core/catalog.ts';
import { applyIntents, type Intent } from '../core/ops.ts';
import { starter, type StarterId } from '../core/starters.ts';
import type { PatchDocument } from '../core/schema.ts';
import { controlFor } from '../plugin/controls.ts';
import { starterParameter } from './starter-parameters.ts';

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
  const doc = applyIntents(base, intents, catalog).doc;
  return applyIntents(doc, starterScreen(doc, catalog, info.title), catalog).doc;
}

/** The main things to play on a new sound, in this order, with the name its knob gets. */
const MAIN: ReadonlyArray<[string, string]> = [['brightness', 'Tone'], ['resonance', 'Resonance'], ['attack', 'Attack'], ['release', 'Release'], ['wobble', 'Wobble'], ['mix', 'Space'], ['volume', 'Level']];

/**
 * A first plugin screen for a new sound, so it can be played at once: its name,
 * a row of knobs for its main parameters (each wired to the module it turns),
 * and a keyboard when it is an instrument. Ordinary edits, like everything else.
 */
export function starterScreen(doc: PatchDocument, catalog: Catalog, title: string): Intent[] {
  const picked: Array<{ node: string; port: string; label: string }> = [];
  for (const [id, label] of MAIN) {
    if (picked.length >= 6) break;
    const target = starterParameter(doc, catalog, id);
    if (target && !picked.some(p => p.node === target.node && p.port === target.port)) picked.push({ node: target.node, port: target.port, label });
  }
  const instrument = Object.values(doc.nodes).some(n => n.type === 'kit.voiceIn');
  const knob = { w: 84, h: 96, gap: 12, x: 24, y: 80 };
  const width = Math.max(420, knob.x * 2 + picked.length * knob.w + Math.max(0, picked.length - 1) * knob.gap);
  const height = knob.y + knob.h + (instrument ? 24 + 64 : 0) + 24;
  const intents: Intent[] = [
    { op: 'setPanelSize', width, height },
    { op: 'addElement', element: { kind: 'text', name: 'Title', text: title, rect: { x: knob.x, y: 18, w: width - knob.x * 2, h: 44 }, textStyle: { size: 30, weight: 700, color: 'fg', align: 'left' } } },
  ];
  let taken = doc;
  picked.forEach((p, i) => {
    const made = controlFor(taken, catalog, { node: p.node, port: p.port, label: p.label, panel: { x: knob.x + i * (knob.w + knob.gap), y: knob.y, w: knob.w, h: knob.h } });
    intents.push(...made.intents);
    taken = applyIntents(taken, made.intents, catalog).doc;
  });
  if (instrument) intents.push({ op: 'addNode', node: { type: 'ui.keyboard', label: 'Keys', pos: { x: -320, y: 420 }, panel: { x: knob.x, y: knob.y + knob.h + 24, w: width - knob.x * 2, h: 64 }, style: { skin: { name: 'piano', params: { octaves: width >= 560 ? 3 : 2, start: 48 } } } } });
  return intents;
}
