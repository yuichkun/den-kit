// What the LLM is told and which tools it gets. Dependency-free: the Node bridge
// registers these tools with Codex (dynamicTools) and the browser executes them
// against a draft copy of the patch (src/ai/llm-workspace.ts).

export interface ToolSpec { name: string; description: string; inputSchema: Record<string, unknown> }

const portRef = { type: 'object', properties: { node: { type: 'string' }, port: { type: 'string' } }, required: ['node', 'port'], additionalProperties: false };

export const KIT_TOOLS: ToolSpec[] = [
  {
    name: 'kit_get_patch',
    description: 'Read the current draft patch: every module (id, type, label, settings, knob values, codebox code) and every cable, plus a readable summary and any problems. Call this first, and again whenever you are unsure of ids.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'kit_list_blocks',
    description: 'List the module types you can add (type, title, category, one-line summary). Optionally filter by category: voice, source, filter, envelope, modulation, fx, dynamics, math, io, ui, code.',
    inputSchema: { type: 'object', properties: { category: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'kit_describe_block',
    description: 'Full description of one module type: its inputs (units, ranges, defaults, what an unconnected input does), outputs, construction settings and usage notes. Use it before wiring a type you have not used yet.',
    inputSchema: { type: 'object', properties: { type: { type: 'string' } }, required: ['type'], additionalProperties: false },
  },
  {
    name: 'kit_apply_ops',
    description: [
      'Apply a list of edits to the draft, all or nothing, then validate and compile it. Returns problems (with module ids and codebox line numbers) or OK.',
      'Edits (objects with "op"):',
      '  {"op":"addNode","node":{"id":"lfo2","type":"den.lfo","label":"Wobble","config":{...},"values":{"rate":3},"pos":{"x":0,"y":0}}}  (id optional; lowercase letters and digits)',
      '  {"op":"removeNode","id":"lfo2"}',
      '  {"op":"connect","from":{"node":"lfo2","port":"out"},"to":{"node":"cut1","port":"octaves"},"replace":true}  (an input takes one cable; replace swaps it)',
      '  {"op":"disconnectInput","to":{"node":"cut1","port":"octaves"}}',
      '  {"op":"setValue","node":"filter1","port":"resonance","value":2,"clamp":true}  (knob value of an unconnected input)',
      '  {"op":"setConfig","node":"osc1","key":"waveform","value":"sine"}  (construction setting; recompiles)',
      '  {"op":"setLabel","node":"lfo2","label":"Wobble"} · {"op":"move","node":"lfo2","pos":{"x":400,"y":200}} · {"op":"setName","name":"Acid bass"}',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        ops: { type: 'array', minItems: 1, maxItems: 64, items: { type: 'object', properties: { op: { type: 'string', enum: ['addNode', 'removeNode', 'connect', 'disconnect', 'disconnectInput', 'setValue', 'setConfig', 'setLabel', 'move', 'setName', 'setText', 'setTheme'] }, node: {}, id: { type: 'string' }, from: portRef, to: portRef, replace: { type: 'boolean' }, port: { type: 'string' }, value: {}, clamp: { type: 'boolean' }, key: { type: 'string' }, label: {}, pos: {}, name: { type: 'string' }, text: { type: 'string' }, theme: { type: 'string' } }, required: ['op'] } },
      },
      required: ['ops'],
      additionalProperties: false,
    },
  },
  {
    name: 'kit_write_codebox',
    description: 'Write the code of a codebox module (add one first with kit_apply_ops, type "kit.codebox") and declare its ports. The code must default-export defineSubgraph from "@unworklet/core"; inputs and outputs are Node<"f32"> (signal) or Node<"bool"> (gate). Type errors and compile errors come back with line numbers in your code.',
    inputSchema: {
      type: 'object',
      properties: {
        node: { type: 'string' },
        code: { type: 'string' },
        inputs: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, type: { type: 'string', enum: ['signal', 'gate'] } }, required: ['id', 'type'], additionalProperties: false } },
        outputs: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, type: { type: 'string', enum: ['signal', 'gate'] } }, required: ['id', 'type'], additionalProperties: false } },
      },
      required: ['node', 'code', 'inputs', 'outputs'],
      additionalProperties: false,
    },
  },
  {
    name: 'kit_listen',
    description: 'Render the draft offline with a short phrase and measure it: level, peaks, clipping, brightness over time, attack and release, stereo width, broken samples (and a spectrogram picture when your model accepts images). Phrases: "bass" (mono bass line), "chord" (held 4-note chord), "hits" (percussive notes); effect patches with an Audio In hear "chords", "drums" or "noise" instead.',
    inputSchema: { type: 'object', properties: { phrase: { type: 'string', enum: ['bass', 'chord', 'hits', 'chords', 'drums', 'noise'] }, seconds: { type: 'number', minimum: 0.5, maximum: 8 } }, additionalProperties: false },
  },
  {
    name: 'kit_finish',
    description: 'Finish: give a one-sentence summary of what you changed, in the language the user wrote in. Your draft is applied to the live patch when your turn ends (the user can undo it with ⌘Z).',
    inputSchema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'], additionalProperties: false },
  },
];

export const KIT_TOOL_NAMES = new Set(KIT_TOOLS.map(t => t.name));

/** The rules the LLM works under; `blocks` is the catalogue summary from the browser. */
export function developerInstructions(blocks: string): string {
  return `You edit a modular synthesizer patch in den-kit, a Bitwig-Grid-like environment whose patch compiles to an AudioWorklet. The user plays it live while you work.

How to work
- Use only the kit_* tools. You cannot run shell commands or read files; you do not need to.
- Start with kit_get_patch. Make small, deliberate edits with kit_apply_ops; it validates and compiles every time, so fix every problem it reports before going on.
- Prefer existing modules and knob values over new structure; keep the user's sound unless asked to replace it.
- When the sound matters (most requests), check it with kit_listen before you finish, and adjust if it is silent, clipping or obviously off.
- End with kit_finish and a one-sentence summary in the user's language. Keep any chat text short; the user mostly looks at the patch.
- Your edits go to a draft. When your turn ends the draft is applied to the live patch as one step (the user can undo it); if the user changed the same thing meanwhile, their change wins.

The patch model
- Cables carry a signal (one f32 per sample) or a gate (on/off). An input takes at most one cable; an unconnected input is a knob (its value in "values") or follows its default/binding.
- Units: Hz, seconds (s), dB, octaves, semitones, gain (linear), mix 0..1. Knob values must stay inside each input's range (kit_describe_block shows it).
- Voices: everything between Voice In (kit.voiceIn: pitch in Hz, gate, velocity, retrigger) and Voice Mix (kit.voiceMix) runs once per voice. Envelope gate/retrigger inputs follow the note automatically when unconnected. Connect the amp envelope's done output to Voice Mix done.
- Out (kit.out) is the stereo output; right falls back to left. Effect patches start from Audio In (kit.audioIn).
- Feedback loops must pass through History (kit.history, one-sample delay).
- Modulation helpers: kit.cutoffMod (base Hz + octaves), kit.pitchMod (Hz + semitones), kit.mul, kit.add, kit.scale, kit.mix, kit.gain.
- Codebox (kit.codebox): custom DSP in the unworklet core API, e.g.
  import { defineSubgraph, type Node } from '@unworklet/core';
  export default defineSubgraph(() => ({ tick(i: { in: Node<'f32'>; drive: Node<'f32'> }) { return { out: i.in.mul(i.drive).tanh() }; } }));
  Declare its ports with kit_write_codebox; inputs become knobs when unconnected.

Module types
${blocks}`;
}
