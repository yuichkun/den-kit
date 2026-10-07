// What the LLM is told and which tools it gets. Dependency-free: the Node bridge
// registers these tools with Codex (dynamicTools) and the browser executes them
// against the live patch (src/ai/llm-workspace.ts).

export interface ToolSpec { name: string; description: string; inputSchema: Record<string, unknown> }

const portRef = { type: 'object', properties: { node: { type: 'string' }, port: { type: 'string' } }, required: ['node', 'port'], additionalProperties: false };
const rect = { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } }, required: ['x', 'y', 'w', 'h'], additionalProperties: false };

export const KIT_TOOLS: ToolSpec[] = [
  {
    name: 'kit_get_patch',
    description: 'Read the patch as it is now: every module (id, type, label, settings, knob values, codebox code) and every cable, plus a readable summary and any problems. Call this first, and again whenever you are unsure of ids or an edit was refused (the user edits too).',
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
      'Apply a list of edits, all or nothing. They are tried on a copy first; if the result validates and compiles they land on the live patch at once (the user hears and sees them), otherwise nothing lands and you get the problems (with module ids and codebox line numbers). Put edits that depend on each other in one call (add a module and wire it).',
      'Edits (objects with "op"):',
      '  {"op":"addNode","node":{"id":"lfo2","type":"den.lfo","label":"Wobble","config":{...},"values":{"rate":3}}}  (id optional: lowercase letters and digits; leave out "pos": den-kit places new modules next to what they connect to)',
      '  {"op":"removeNode","id":"lfo2"}',
      '  {"op":"connect","from":{"node":"lfo2","port":"out"},"to":{"node":"cut1","port":"octaves"},"replace":true}  (an input takes one cable; replace swaps it)',
      '  {"op":"disconnectInput","to":{"node":"cut1","port":"octaves"}}',
      '  {"op":"setValue","node":"filter1","port":"resonance","value":2,"clamp":true}  (knob value of an unconnected input)',
      '  {"op":"setConfig","node":"osc1","key":"waveform","value":"sine"}  (construction setting; recompiles)',
      '  {"op":"setLabel","node":"lfo2","label":"Wobble"} · {"op":"move","node":"lfo2","pos":{"x":400,"y":200}} · {"op":"setName","name":"Acid bass"}',
      'Screen edits (the plugin the user plays; kit_get_plugin shows it, kit_ui_reference explains every field):',
      '  {"op":"addControl","for":{"node":"filter1","port":"cutoff"},"label":"Cutoff","panel":{"x":24,"y":96,"w":84,"h":96}}  (a knob for a module input, wired, with the input\'s range and unit; "type":"ui.slider"|"ui.toggle"|"ui.button"; leave out "panel" to use the first free space)',
      '  {"op":"setPanel","node":"knob1","panel":{"x":24,"y":96,"w":84,"h":96}}  (put an existing control on the plugin; null takes it off) · {"op":"setRect","id":"knob1","rect":{...}}  (move or resize a control or an element)',
      '  {"op":"setStyle","node":"knob1","style":{"skin":{"name":"cap","params":{"shape":"chicken"}},"textStyle":{"font":"oswald","size":12,"color":"fg"}}}  (replaces the control\'s whole style)',
      '  {"op":"setLook","look":{"tokens":{"accent":"#ff7a59"},"background":[{"kind":"image","asset":"sc-wood","fit":"cover"}],"skins":{"knob":{"name":"ring"}}}}  (merges)',
      '  {"op":"addElement","element":{"kind":"text","text":"ACID","rect":{"x":24,"y":16,"w":300,"h":48},"textStyle":{"font":"oswald","size":40,"color":"fg"}}} · {"op":"updateElement","id":"text1","set":{"text":"ACID 303"}} · {"op":"removeElement","id":"text1"}',
      '  {"op":"arrange","ids":["shape1"],"to":"back"} · {"op":"group","ids":["text1","shape1"]} · {"op":"setPanelSize","width":720,"height":440}',
      '  {"op":"wearLook","work":"neon"}  (put a ready look on the plugin: kit_ui_reference "looks") · {"op":"setBrief","brief":"Warm 70s tape machine: brushed steel, cream type, amber lamps; a row of big knobs over the reels"}  (the design brief)',
      '  Bundled pictures (kit_ui_reference "pictures") are used by id and added to the patch when an edit uses them.',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        ops: { type: 'array', minItems: 1, maxItems: 96, items: { type: 'object', properties: {
          op: { type: 'string', enum: ['addNode', 'removeNode', 'connect', 'disconnect', 'disconnectInput', 'setValue', 'setConfig', 'setLabel', 'move', 'setName', 'setText', 'setTheme', 'addControl', 'setPanel', 'setRect', 'setStyle', 'setLook', 'addElement', 'updateElement', 'removeElement', 'arrange', 'group', 'ungroup', 'setPanelSize', 'addAsset', 'wearLook', 'setBrief'] },
          node: {}, id: { type: 'string' }, from: portRef, to: {}, replace: { type: 'boolean' }, port: { type: 'string' }, value: {}, clamp: { type: 'boolean' }, key: { type: 'string' }, label: {}, pos: {}, name: { type: 'string' }, text: { type: 'string' }, theme: { type: 'string' },
          for: portRef, type: { type: 'string' }, panel: {}, rect: rect, style: {}, look: {}, element: { type: 'object' }, set: { type: 'object' }, ids: { type: 'array', items: { type: 'string' } }, width: { type: 'number' }, height: { type: 'number' }, asset: { type: 'object' }, work: { type: 'string' }, brief: {},
        }, required: ['op'] } },
      },
      required: ['ops'],
      additionalProperties: false,
    },
  },
  {
    name: 'kit_write_codebox',
    description: 'Write the code of a codebox module (add one first with kit_apply_ops, type "kit.codebox") and declare its ports. The code must default-export defineSubgraph from "@unworklet/core"; inputs and outputs are Node<"f32"> (signal) or Node<"bool"> (gate). Code that compiles lands at once; type errors and compile errors come back with line numbers in your code and nothing lands.',
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
    description: 'Render the patch offline with a short phrase and measure it: level, peaks, clipping, brightness over time, attack and release, stereo width, broken samples (and a spectrogram picture when your model accepts images). Phrases: "bass" (mono bass line), "chord" (held 4-note chord), "hits" (percussive notes); effect patches with an Audio In hear "chords", "drums" or "noise" instead.',
    inputSchema: { type: 'object', properties: { phrase: { type: 'string', enum: ['bass', 'chord', 'hits', 'chords', 'drums', 'noise'] }, seconds: { type: 'number', minimum: 0.5, maximum: 8 } }, additionalProperties: false },
  },
  {
    name: 'kit_get_plugin',
    description: 'Read the plugin screen as it is now: its size and look (colour and font tokens, background, default skins), everything on it back to front (controls with their skin, value, range and what they drive; decorations with their exact fields), controls kept off it, groups and assets. With "part": one custom part\'s whole code.',
    inputSchema: { type: 'object', properties: { part: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'kit_ui_reference',
    description: 'How to build the plugin screen, by topic: "look" (tokens, background fills, css), "fonts", "skins" (every control skin and its parameters; narrow with "control": knob, slider, toggle, button, xy, keyboard, scope, meter), "elements" (text, shape, image, svg, led, part; style and textStyle fields), "parts" (custom canvas code, including taking the mouse to move controls), "pictures" (bundled pictures by id), "looks" (ready looks from the showcase works), "layout" (what reads well). No topic: an overview.',
    inputSchema: { type: 'object', properties: { topic: { type: 'string', enum: ['look', 'fonts', 'skins', 'elements', 'parts', 'pictures', 'looks', 'layout'] }, control: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'kit_view_picture',
    description: 'Look at a picture: one the person added (a reference photo, a sketch, the picture laid under the editor) or a bundled one, with its main colours (and the picture itself when your model accepts images). Use it when the person points at a picture ("like this photo", "follow my sketch").',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'kit_look',
    description: 'Look at the plugin screen as it is drawn now: checks for things off or cut by the edge, controls on top of each other or hidden, text that does not fit or is too small, text too faint against what is behind it (measured on the pixels), controls that drive nothing or have no label, missing pictures and failing custom parts; with a picture of the screen when your model accepts images. Use it after screen edits, and fix what it finds.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'kit_finish',
    description: 'Finish: give a one-sentence summary of what you changed, in the language the user wrote in. Your edits are already live; the user can undo the whole request with one ⌘Z.',
    inputSchema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'], additionalProperties: false },
  },
];

export const KIT_TOOL_NAMES = new Set(KIT_TOOLS.map(t => t.name));

/** The rules the LLM works under; `blocks` is the catalogue summary from the browser. */
export function developerInstructions(blocks: string): string {
  return `You edit a modular synthesizer patch in den-kit, a Bitwig-Grid-like environment whose patch compiles to an AudioWorklet. The user plays it live while you work.

How to work
- Use only the kit_* tools. You cannot run shell commands or read files; you do not need to.
- Start with kit_get_patch. Edit with kit_apply_ops: every call is checked (validated and compiled) and, if it passes, lands on the live patch at once, so the user hears and sees each step. A call that fails lands nothing: fix the problems it reports and send it again. Keep each call a complete, working step (add a module and wire it in the same call).
- Prefer existing modules and knob values over new structure; keep the user's sound unless asked to replace it.
- When the sound matters (most requests), check it with kit_listen before you finish, and adjust if it is silent, clipping or obviously off.
- End with kit_finish and a one-sentence summary in the user's language. Keep any chat text short; the user mostly looks at the patch.
- Never ask the user to choose. If the request is ambiguous, take the most plausible reading, say it in one short sentence, and go on; the user will tell you if they meant something else.
- Questions about how something works: answer in a few sentences in the user's language (read the patch first); change nothing unless asked.
- The user may play and edit while you work. If an edit is refused because the patch changed, read it again. The whole request is one undo step for the user.
- Requests can start with [den-kit] notes: what happened since your last turn (requests the fast path handled, the person's own edits, things they undid) or, in a new conversation, what came before. Use them for follow-ups such as "more", "not that one" or "like before".
- When the person attached things (they point at them), the request is about those: change them rather than building something new, unless they clearly ask for something new.

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

The plugin screen (what the user plays)
- The plugin is a window of fixed design size that scales to fit. Its controls are widget modules (ui.knob, ui.slider, ui.toggle, ui.button, ui.xy, ui.keyboard, ui.scope, ui.meter) with a "panel" rect; decorations are elements (text, shape, image, svg, led, custom part); the look holds the colour and font tokens, the background and the default skin of each control kind.
- Read it with kit_get_plugin; edit it with kit_apply_ops (screen edits are checked like any edit and land at once; they never recompile the sound). kit_ui_reference has the skins, fonts, element fields, custom parts and bundled pictures.
- After screen edits, look with kit_look and fix what it finds before you finish.
- Designing a screen: start from the design brief (kit_get_plugin shows it; with none yet, write one first with setBrief: the idea, palette, type and layout in 2-4 short lines) and keep to it on later requests. A ready look (wearLook) is a quick start. When the person points at a picture, look at it with kit_view_picture.
- What the person changed by hand (kit_get_plugin lists it) stays as they made it unless the request is about it.
- A control for a module input: addControl (wired, ranged and placed for you). Label every control; keep text at 11 px or more and readable against what is behind it; leave 16-24 px margins; line things up; nothing opaque over a control.
- Colours: use the tokens (bg, fg, accent, track, knob, pointer, muted, glow) so the screen survives a change of look; fixed colours only for things printed on a picture or a plate.
- Custom parts draw with canvas code; with a pointer handler they take the mouse and move controls (f.set), e.g. a curve whose points you drag.
- Keep what the user built unless asked to change it; change the screen only when the request is about it (or a new sound needs controls).

Module types
${blocks}`;
}
