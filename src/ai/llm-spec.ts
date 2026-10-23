// What the LLM is told and which tools it gets. Dependency-free: the Node bridge
// registers these tools with Codex (dynamicTools) and the browser executes them
// against the live patch (src/ai/llm-workspace.ts).

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const portRef = {
  type: 'object',
  properties: { node: { type: 'string' }, port: { type: 'string' } },
  required: ['node', 'port'],
  additionalProperties: false,
};
const rect = {
  type: 'object',
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
    w: { type: 'number' },
    h: { type: 'number' },
  },
  required: ['x', 'y', 'w', 'h'],
  additionalProperties: false,
};

export const KIT_TOOLS: ToolSpec[] = [
  {
    name: 'kit_get_patch',
    description:
      'Read the patch as it is now: every module (id, type, label, settings, knob values, codebox code) and every cable, plus a readable summary and any problems. Call this first, and again whenever you are unsure of ids or an edit was refused (the user edits too).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'kit_list_blocks',
    description:
      'List the module types you can add (type, title, category, one-line summary). Optionally filter by category: voice, source, filter, envelope, modulation, fx, dynamics, math, io, ui, code.',
    inputSchema: {
      type: 'object',
      properties: { category: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'kit_describe_block',
    description:
      'Full description of one module type: its inputs (units, ranges, defaults, what an unconnected input does), outputs, construction settings and usage notes. Use it before wiring a type you have not used yet.',
    inputSchema: {
      type: 'object',
      properties: { type: { type: 'string' } },
      required: ['type'],
      additionalProperties: false,
    },
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
      'Parts (a piece of patch defined once and used in several places; kit_get_patch lists each part, its uses and what is inside):',
      '  {"op":"makePart","ids":["osc1","filter1"],"name":"Drop","id":"drop"}  (the modules move inside; cables across the edge become its inputs and outputs, their main knobs its parameters; one use, "drop1", takes their place and sounds the same)',
      '  {"op":"addNode","node":{"type":"kit.part","part":"drop","values":{"cutoff":2400}}}  (another use, with its own parameter values) · {"op":"setValue","node":"drop2","port":"cutoff","value":900}  (one use\'s parameter)',
      '  {"op":"addNode","node":{"type":"den.lfo","inside":"drop"}}  (a module inside the part: every use gets it; cables only join modules with the same "inside") · {"op":"addNode","node":{"type":"kit.partIn","inside":"drop","label":"trigger"}}  (a new input of the part; kit.partOut for an output)',
      '  {"op":"addParam","part":"drop","node":"lfo3","port":"rate","label":"Rate"}  (show a free knob inside on the part: each use sets its own) · {"op":"removeParam","part":"drop","id":"rate"}',
      '  A parameter can have its own knob range: "range":{"min":0,"max":1,"unit":"st","scale"?:"log"} on addParam, or {"op":"updatePart","part":"saw","ranges":{"detune":{"min":0,"max":1,"unit":"st"}}} (null = the inner knob\'s). Give one when the knob inside is a math block (its range is huge).',
      '  {"op":"updatePart","part":"drop","name":"Rain drop","doc":"One drop: a noise burst through a bandpass"} · {"op":"unpackPart","node":"drop2"}  (back to ordinary modules) · {"op":"detachPart","node":"drop2"}  (this use gets its own copy)',
      '  {"op":"placeMyPart","id":"rainDrop"}  (a part the person saved in My parts — kit_list_blocks lists them — comes into this patch with one use; then use it like any part)',
      "Faces (a part's own little screen; kit_get_patch says each part's face):",
      '  {"op":"putFace","node":"drop1","at":{"x":24,"y":96}}  (put the face of this use on the plugin: controls wired to its parameters plus decorations, grouped as "drop1Face"; putting it again replaces it in place; "at" optional)',
      '  {"op":"updatePart","part":"drop","face":{"width":220,"height":130,"controls":[{"param":"cutoff","type":"ui.knob","rect":{"x":12,"y":28,"w":84,"h":96},"label":"Tone"}],"elements":[{"kind":"text","text":"DROP","rect":{"x":12,"y":6,"w":196,"h":20}}]}}  (the part\'s own face: rects inside the face box; controls only for its parameters; text and lamps bind to a control by parameter id; null = the default face, its name over a knob per parameter). Then putFace each use to show it.',
      '  {"op":"makeScreenPart","ids":["shape3","text2","image1"],"name"?:"Logo"}  (decorations on the plugin become a part that is only a screen — no sound — so it can be kept in My parts and put on other plugins; they become its use\'s face)',
      'Copies (×N: one module or part running as several side by side; kit_get_patch shows "×N", the spreads and the estimated load):',
      '  {"op":"setCount","node":"drop1","count":24}  (24 copies; 1 = once. Its outputs become a thick cable, one signal per copy: into a node with the same count copy k feeds copy k; into a single input the copies are summed ×1/√N; a single cable goes to every copy. kit.splay spreads a thick cable across left and right)',
      '  {"op":"setSpread","node":"drop1","port":"cutoff","spread":{"kind":"random","amount":1.5,"seed":3}}  (how the copies differ on a knob, around its value — with a cable or a control into it, around what that brings (a frequency/log knob is multiplied, others offset): "range" evenly from −amount to +amount, "random" anywhere in that span, "harmonic" the knob × 1, 2, 3…, "each" {"values":[...]} one per copy; amount in octaves on a frequency (Hz) knob, else in the knob\'s unit; null = the same in every copy)',
      '  {"op":"addNode","node":{"type":"den.seededNoise","count":16,"spread":{...}}}  (count and spread can come with a new module) · kit.copy inside a part used ×N gives each copy its index, count, position (−1…+1) and a fixed random number',
      'Screen edits (the plugin the user plays; kit_get_plugin shows it, kit_ui_reference explains every field):',
      '  {"op":"addControl","for":{"node":"filter1","port":"cutoff"},"label":"Cutoff","panel":{"x":24,"y":96,"w":84,"h":96}}  (a knob for a module input, wired, with the input\'s range and unit; "type":"ui.slider"|"ui.toggle"|"ui.button"; leave out "panel" to use the first free space)',
      '  {"op":"setPanel","node":"knob1","panel":{"x":24,"y":96,"w":84,"h":96}}  (put an existing control on the plugin; null takes it off) · {"op":"setRect","id":"knob1","rect":{...}}  (move or resize a control or an element)',
      '  {"op":"setStyle","node":"knob1","style":{"skin":{"name":"cap","params":{"shape":"chicken"}},"textStyle":{"font":"oswald","size":12,"color":"fg"}}}  (replaces the control\'s whole style)',
      '  {"op":"setLook","look":{"tokens":{"accent":"#ff7a59"},"background":[{"kind":"image","asset":"assets/den-kit/wood.jpg","fit":"cover"}],"skins":{"knob":{"name":"ring"}}}}  (merges)',
      '  {"op":"addElement","element":{"kind":"text","text":"ACID","rect":{"x":24,"y":16,"w":300,"h":48},"textStyle":{"font":"oswald","size":40,"color":"fg"}}} · {"op":"updateElement","id":"text1","set":{"text":"ACID 303"}} · {"op":"removeElement","id":"text1"}',
      '  {"op":"arrange","ids":["shape1"],"to":"back"} · {"op":"group","ids":["text1","shape1"]} · {"op":"setPanelSize","width":720,"height":440}',
      '  {"op":"wearLook","work":"neon"}  (put a ready look on the plugin: kit_ui_reference "looks") · {"op":"setBrief","brief":"Warm 70s tape machine: brushed steel, cream type, amber lamps; a row of big knobs over the reels"}  (the design brief)',
      '  {"op":"addElement","element":{"kind":"code","part":"reels","rect":{"x":0,"y":0,"w":720,"h":200},"props":{"speed":1.5}}}  (a code part: src/parts/reels.ts of the screen project, written with kit_write_file or kit_bash; kit_ui_reference "code")',
      '  Bundled pictures (kit_ui_reference "pictures") are used by id and added to the patch when an edit uses them.',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        ops: {
          type: 'array',
          minItems: 1,
          maxItems: 96,
          items: {
            type: 'object',
            properties: {
              op: {
                type: 'string',
                enum: [
                  'addNode',
                  'removeNode',
                  'connect',
                  'disconnect',
                  'disconnectInput',
                  'setValue',
                  'setConfig',
                  'setLabel',
                  'move',
                  'setName',
                  'setText',
                  'setTheme',
                  'addControl',
                  'setPanel',
                  'setRect',
                  'setStyle',
                  'setLook',
                  'addElement',
                  'updateElement',
                  'removeElement',
                  'arrange',
                  'group',
                  'ungroup',
                  'setPanelSize',
                  'addAsset',
                  'wearLook',
                  'setBrief',
                  'makePart',
                  'unpackPart',
                  'detachPart',
                  'updatePart',
                  'addParam',
                  'removeParam',
                  'setCount',
                  'setSpread',
                  'placeMyPart',
                  'putFace',
                  'makeScreenPart',
                ],
              },
              node: {},
              id: { type: 'string' },
              from: portRef,
              to: {},
              replace: { type: 'boolean' },
              port: { type: 'string' },
              value: {},
              clamp: { type: 'boolean' },
              key: { type: 'string' },
              label: {},
              pos: {},
              name: { type: 'string' },
              text: { type: 'string' },
              theme: { type: 'string' },
              for: portRef,
              type: { type: 'string' },
              panel: {},
              rect: rect,
              style: {},
              look: {},
              element: { type: 'object' },
              set: { type: 'object' },
              ids: { type: 'array', items: { type: 'string' } },
              width: { type: 'number' },
              height: { type: 'number' },
              asset: { type: 'object' },
              work: { type: 'string' },
              brief: {},
              part: { type: 'string' },
              doc: {},
              labels: { type: 'object' },
              range: { type: 'object' },
              ranges: { type: 'object' },
              count: { type: 'number' },
              spread: {},
              at: { type: 'object' },
              face: {},
            },
            required: ['op'],
          },
        },
      },
      required: ['ops'],
      additionalProperties: false,
    },
  },
  {
    name: 'kit_write_codebox',
    description:
      'Write the code of a codebox module (add one first with kit_apply_ops, type "kit.codebox") and declare its ports. The code must default-export defineSubgraph from "@unworklet/core"; inputs and outputs are Node<"f32"> (signal) or Node<"bool"> (gate). Code that compiles lands at once; type errors and compile errors come back with line numbers in your code and nothing lands.',
    inputSchema: {
      type: 'object',
      properties: {
        node: { type: 'string' },
        code: { type: 'string' },
        inputs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: ['signal', 'gate'] },
            },
            required: ['id', 'type'],
            additionalProperties: false,
          },
        },
        outputs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: ['signal', 'gate'] },
            },
            required: ['id', 'type'],
            additionalProperties: false,
          },
        },
      },
      required: ['node', 'code', 'inputs', 'outputs'],
      additionalProperties: false,
    },
  },
  {
    name: 'kit_listen',
    description:
      'Render the patch offline with a short phrase and measure it: level, peaks, clipping, brightness over time, attack and release, stereo width, broken samples (and a spectrogram picture when your model accepts images). Phrases: "bass" (mono bass line), "chord" (held 4-note chord), "hits" (percussive notes); effect patches with an Audio In hear "chords", "drums" or "noise" instead.',
    inputSchema: {
      type: 'object',
      properties: {
        phrase: { type: 'string', enum: ['bass', 'chord', 'hits', 'chords', 'drums', 'noise'] },
        seconds: { type: 'number', minimum: 0.5, maximum: 8 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'kit_get_plugin',
    description:
      'Read the plugin screen as it is now: its size and look (colour and font tokens, background, default skins), everything on it back to front (controls with their skin, value, range and what they drive; decorations and code parts with their exact fields), controls kept off it, groups, assets and the screen project\'s parts. With "canvas": one canvas element\'s whole code.',
    inputSchema: {
      type: 'object',
      properties: { canvas: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'kit_ui_reference',
    description:
      'How to build the plugin screen, by topic: "look" (tokens, background fills, css), "fonts", "skins" (every control skin and its parameters; narrow with "control": knob, slider, toggle, button, xy, keyboard, scope, meter), "elements" (text, shape, image, svg, led, canvas, code; style and textStyle fields), "canvas" (drawing code, including taking the mouse to move controls), "code" (code parts: the screen project in the pod), "pictures" (bundled pictures by id), "looks" (ready looks from the showcase works), "layout" (what reads well). No topic: an overview.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: [
            'look',
            'fonts',
            'skins',
            'elements',
            'canvas',
            'code',
            'pictures',
            'looks',
            'layout',
          ],
        },
        control: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'kit_view_picture',
    description:
      'Look at a picture: one the person added (a reference photo, a sketch, the picture laid under the editor) or a bundled one, with its main colours (and the picture itself when your model accepts images). Use it when the person points at a picture ("like this photo", "follow my sketch").',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'kit_look',
    description:
      'Look at the plugin screen as it is drawn now (code parts included, as they draw): checks for things off or cut by the edge, controls on top of each other or hidden, text that does not fit or is too small, text too faint against what is behind it (measured on the pixels), controls that drive nothing or have no label, missing pictures, failing canvases and code parts (with their errors); with a picture of the screen when your model accepts images. Use it after screen edits, and fix what it finds. With as "seen": a picture of exactly what the person sees now, their current view as on their screen (only when they share it; "view" asks for the plugin, the patch or the whole window) — use it when they say "look", "this here", or sketched on the screen; without sharing you get the plugin re-drawn, or the patch in words.',
    inputSchema: {
      type: 'object',
      properties: {
        as: { type: 'string', enum: ['design', 'seen'] },
        view: { type: 'string', enum: ['plugin', 'patch', 'window'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'kit_bash',
    description: [
      "Run a bash command in the pod: a Linux environment inside the person's browser with bash, git, Node, npm and the usual tools, in the folder of the work's screen project (a Vite + TypeScript web project; read its AGENTS.md first). Use it as in any project: npm install a package, npm run check (TypeScript), npm run lint (ESLint), npm run build, git log / git diff, grep, sed, cat > file <<'EOF' … EOF.",
      'Returns the output (stdout and stderr; the end of a long one) and the exit status. Files the command changes in the project are kept in the work at once (one undo step with your request; node_modules, dist and .git stay in the pod). The dev server is already running (den-kit starts and restarts it): do not start one. No network beyond the npm registry and GitHub.',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeout_s: { type: 'number', minimum: 1, maximum: 600 },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
  {
    name: 'kit_read_file',
    description:
      'Read a file of the screen project (path relative to it, e.g. "AGENTS.md", "src/parts/reels.ts", "src/kit/index.ts"), whole or lines from_line..to_line.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        from_line: { type: 'number' },
        to_line: { type: 'number' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'kit_write_file',
    description:
      "Write a whole file of the screen project (path relative to it; folders are made). It is kept in the work at once, and code parts that use it reload on the plugin (the result says how they are doing). src/kit/controls.ts is made by den-kit from the patch: change the patch's controls instead.",
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'kit_finish',
    description:
      'Finish: give a one-sentence summary of what you changed, in the language the user wrote in. Your edits are already live; the user can undo the whole request with one ⌘Z. A member also reports to the lead: names (ids and names others rely on, e.g. "knob3 Drive → drive1.amount"), needs (what it needed outside its scope) and problems (what is left).',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        names: { type: 'array', items: { type: 'string' } },
        needs: { type: 'array', items: { type: 'string' } },
        problems: { type: 'array', items: { type: 'string' } },
      },
      required: ['summary'],
      additionalProperties: false,
    },
  },
];

const scopeSchema = {
  type: 'object',
  description:
    'What the member may change. "sound": "all" (the whole patch) or {"parts":["drop"]} (inside those parts) or {"nodes":["filter1","env2"]} (those modules and the ones it adds). "screen": "all" (the whole plugin screen: look, brief, size, every control\'s place and style, decorations) or {"elements":["text1","knob3"]} (those controls and decorations and the ones it adds) or {"area":{"x":0,"y":0,"w":360,"h":200}} (what lies in that part of the screen and what it adds there). "project": "all" (the screen project in the pod: kit_bash, kit_write_file; one holder at a time). Scopes of members working at the same time must not overlap; yours is what is left.',
  properties: { sound: {}, screen: {}, project: { type: 'string', enum: ['all'] } },
  additionalProperties: false,
};

/** Tools only a lead has: starting members, waiting for them, talking to them. */
export const LEAD_TOOLS: ToolSpec[] = [
  {
    name: 'kit_delegate',
    description:
      'Start members: other AIs like you (same model, same tools) that work on parts of this request at the same time as you, each in its own scope. It returns at once with their ids; then do your own part outside their scopes, or call kit_wait. Use it only for parts that are substantial and independent once the names they share are fixed (land those first). Give each a short name the person sees, the goal (the result), why (what the person cares about, one sentence), its scope and when it is done; not how to build it. den-kit gives each member the person\'s own words, the recent conversation, what the person attached or sketched and the current state of its scope. context: "brief" (default), "full" (this whole conversation as well: for many rounds of taste talk) or "bare" (only your brief: mechanical jobs).',
    inputSchema: {
      type: 'object',
      properties: {
        members: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              goal: { type: 'string' },
              why: { type: 'string' },
              scope: scopeSchema,
              done: { type: 'string' },
              notes: { type: 'string' },
              context: { type: 'string', enum: ['brief', 'full', 'bare'] },
            },
            required: ['name', 'goal', 'scope', 'done'],
            additionalProperties: false,
          },
        },
      },
      required: ['members'],
      additionalProperties: false,
    },
  },
  {
    name: 'kit_wait',
    description:
      'Wait for members: returns when the members named (default: all working ones) have finished, with their reports (summary, names, needs, problems, what landed, time, tokens), or after timeout_s (default 60, at most 60) with their progress so far, or at once when the person adds something to the request. Call it again to keep waiting.',
    inputSchema: {
      type: 'object',
      properties: {
        members: { type: 'array', items: { type: 'string' } },
        timeout_s: { type: 'number', minimum: 5, maximum: 60 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'kit_tell',
    description:
      'Add instructions to a member that is working (it reads them at its next step). "marks": numbers of the person\'s sketch marks to pass along with their picture.',
    inputSchema: {
      type: 'object',
      properties: {
        member: { type: 'string' },
        text: { type: 'string' },
        marks: { type: 'array', items: { type: 'number' } },
      },
      required: ['member', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'kit_stop_member',
    description:
      'Stop a member that is working (what it already changed stays; its scope comes back to you).',
    inputSchema: {
      type: 'object',
      properties: { member: { type: 'string' }, why: { type: 'string' } },
      required: ['member'],
      additionalProperties: false,
    },
  },
];
export const LEAD_TOOL_NAMES = new Set(LEAD_TOOLS.map(t => t.name));

/** Every kit_* tool den-kit runs (the lead's set). */
export const KIT_TOOL_NAMES = new Set([...KIT_TOOLS, ...LEAD_TOOLS].map(t => t.name));

/** The tools a conversation gets: a lead also starts members; alone or as a member, the rest. */
export function toolsFor(role: 'solo' | 'lead' | 'member' = 'solo'): ToolSpec[] {
  return role === 'lead' ? [...KIT_TOOLS, ...LEAD_TOOLS] : KIT_TOOLS;
}

/** The pod may have to start first (on BrowserPod: boot, npm install, the dev server — minutes the first time). */
const POD_START_MS = 10 * 60_000;
/**
 * How long the bridge waits for the editor to answer a tool call: `base` for den-kit's own tools; the pod's
 * tools may start the pod first, and a command runs as long as it was given (timeout_s, up to 600 s).
 */
export function toolDeadlineMs(tool: string, args: unknown, base: number): number {
  if (tool === 'kit_bash') {
    const t = (args as { timeout_s?: unknown } | null)?.timeout_s;
    const seconds =
      typeof t === 'number' && Number.isFinite(t) ? Math.min(600, Math.max(1, t)) : 120;
    return Math.max(base, seconds * 1000 + POD_START_MS);
  }
  if (tool === 'kit_read_file' || tool === 'kit_write_file') return Math.max(base, POD_START_MS);
  if (tool === 'kit_wait') {
    const t = (args as { timeout_s?: unknown } | null)?.timeout_s;
    const seconds = typeof t === 'number' && Number.isFinite(t) ? Math.min(60, Math.max(5, t)) : 60;
    return Math.max(base, seconds * 1000 + 15_000);
  }
  return base;
}

/** The rules the LLM works under; `blocks` is the catalogue summary from the browser. A lead and a member get their part of the rules too. */
export function developerInstructions(
  blocks: string,
  role: 'solo' | 'lead' | 'member' = 'solo',
): string {
  return `${baseInstructions(blocks)}${role === 'lead' ? LEAD_RULES : role === 'member' ? MEMBER_RULES : ''}`;
}

const LEAD_RULES = `

Working with members (you lead this request)
- You can hand parts of a request to members: other AIs like you (same model, same tools) that work at the same time as you, so the person gets the result sooner. Use kit_delegate only when the request has two or more substantial parts that can be built independently once the names they share are fixed: the sound and the screen of a new plugin, two separate sections of a screen, a code part beside den-kit controls. Do small edits, and work where every step depends on the last, yourself: a member takes a few seconds to start and you have to check its work.
- Fix the seam before you split: the controls both sides use (addControl, with labels and ranges), the signals a display shows, the names of parts. Land them first with kit_apply_ops; members read them and keep them.
- Give each member a short name the person sees ("Sound", "Screen", "Waveform"), the goal, why (what the person cares about, one sentence), its scope and when it is done. Not how to build it: it decides. den-kit already gives it the person's own words, the recent conversation, what they attached or sketched and the state of its scope; do not repeat those. context "brief" (default) is enough unless many rounds of taste talk matter ("full") or the job is mechanical ("bare").
- Scopes must not overlap. A member changes only its scope, and while it works you cannot change its scope either. Controls are shared: a screen member places and styles them, a sound member sets their values; the controls that existed when they started are yours (nobody else removes or rewires them). The screen project ("project") has one holder at a time.
- While members work, do your own part outside their scopes or wait with kit_wait (it returns when they finish, or after up to 60 s with their progress: call it again). kit_tell adds instructions to a working member; kit_stop_member stops one.
- When they are done, read their reports (what changed, names, what they need), fix the seam if needed, look (kit_look) and listen (kit_listen) once over the whole, then kit_finish. Members included, the request is one ⌘Z for the person.`;

const MEMBER_RULES = `

You are a member
- The lead AI split the person's request and gave you one part of it; other members may work on other parts at the same time. The first message says your part: the goal, why, your scope, when you are done, and what den-kit knows (the person's own words, the recent conversation, the state of your scope).
- Change only what is in your scope: an edit outside it is refused and nothing of it lands. You may read everything. Keep the names others rely on: the controls and parts that existed when you started stay as they are (do not remove, rename or rewire them).
- If you need something outside your scope (a new knob, a module, a file), do not work around it: put it in kit_finish "needs" and the lead adds it.
- Work as usual (check, listen, look), then end with kit_finish: summary (one sentence, the person's language), names (ids and names others rely on), needs and problems. Keep chat text short: the lead reads your report and the person sees your progress.
- You cannot start members yourself.`;

function baseInstructions(blocks: string): string {
  return `You edit a modular synthesizer patch in den-kit, a Bitwig-Grid-like environment whose patch compiles to an AudioWorklet. The user plays it live while you work.

How to work
- Use only the kit_* tools. Your shell and files are den-kit's pod (a Linux environment in the person's browser): kit_bash runs commands there, in the work's screen project; kit_read_file and kit_write_file read and write its files. The patch and the plugin's den-kit controls are edited with kit_apply_ops, not with files.
- Start with kit_get_patch. Edit with kit_apply_ops: every call is checked (validated and compiled) and, if it passes, lands on the live patch at once, so the user hears and sees each step. A call that fails lands nothing: fix the problems it reports and send it again. Keep each call a complete, working step (add a module and wire it in the same call).
- Prefer existing modules and knob values over new structure; keep the user's sound unless asked to replace it.
- When the sound matters (most requests), check it with kit_listen before you finish, and adjust if it is silent, clipping or obviously off.
- End with kit_finish and a one-sentence summary in the user's language. Keep any chat text short; the user mostly looks at the patch.
- Never ask the user to choose. If the request is ambiguous, take the most plausible reading, say it in one short sentence, and go on; the user will tell you if they meant something else.
- Questions about how something works: answer in a few sentences in the user's language (read the patch first); change nothing unless asked.
- The user may play and edit while you work. If an edit is refused because the patch changed, read it again. The whole request is one undo step for the user.
- Requests can start with [den-kit] notes: what happened since your last turn (saved requests, the person's own edits, things they undid) or, in a new conversation, what came before. Use them for follow-ups such as "more", "not that one" or "like before".
- When the person attached things (they point at them), the request is about those: change them rather than building something new, unless they clearly ask for something new.
- When the person is inside a part (a [den-kit] note says which), the request is about that part: work inside it unless they clearly ask for something else.
- A [den-kit] note says what the person is looking at (the view, what is in sight and selected, the notes they hold): "this", "here" and "what I see" mean that. When they share their screen, kit_look with as "seen" shows it to you as they see it.
- The person may sketch over the plugin or the patch: a [den-kit] note lists the numbered marks (what each goes around, crosses or joins, with its place) and the picture shows them. A loop or box around things points at them ("this"); an arrow joins or moves; a note or text in empty space says what goes there, at that place and about that size; rough strokes show a shape or layout. Read the words and the picture together; the marks are not part of the work: never copy them onto the plugin.

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

Parts (build small, listen, then reuse)
- A part is a piece of patch defined once and used in several places (kit.part nodes; each use has its own parameter values). Nodes inside a part have "inside": "<part id>"; kit_get_patch lists every part, its uses, inputs, parameters, outputs and what is inside.
- Work in parts when a sound has a repeated or self-contained piece (one rain drop, one voice of a unison, a drum, an effect chain): build it small, listen, make it a part (makePart, or build inside a part), then use it again with different parameter values instead of copying modules.
- Inside a part: add modules with "inside"; cables only join modules in the same place; its inputs and outputs are kit.partIn / kit.partOut nodes inside (their label names the port); show a free knob on the part with addParam. An edit inside changes every use; to change one use only, set its parameters (setValue on the use) or detachPart it first.
- Controls (ui.*), Voice In, Out and Audio In stay in the main patch: connect a control to a parameter or an input of the part.
- A part can have a face: its own screen (controls for its parameters and decorations). When a part should be played from the plugin, put its face on the plugin (putFace on the use) rather than adding its controls one by one; design the face once (updatePart face) and put it on every use. Decorations alone (a logo, a nameplate) can become a screen part (makeScreenPart), kept in My parts for other plugins.
- My parts are the person's own saved parts (kit_list_blocks lists them with their inputs, parameters and outputs). When one fits the request, place it (placeMyPart) rather than building the same thing again.

Copies (×N: many of the same)
- For many of the same thing (a supersaw's seven saws, rain's drops, a choir of voices, a bank of resonators) give the module or part a count (setCount) instead of adding copies by hand, and make the copies differ with spreads (setSpread), or inside a part with kit.copy (index, position, random). For a repeated multi-module sound: build one, listen, makePart, then setCount on the use.
- Copies of noise and random modules get their own seeds by themselves. A cable from copies is thick: a single input sums it ×1/√N; kit.splay spreads it across left and right. Copies inside a voice (after Voice In) are a voice stack: N per voice.
- Copies cost CPU: kit_get_patch says the estimated load. Keep it under about 60% of one core: a few dozen copies of a small part are fine, hundreds are not (and copies in a voice count once per voice). A patch too big to build is refused with a message saying what weighs most.

The plugin screen (what the user plays)
- The plugin is a window of fixed design size that scales to fit. Its controls are widget modules (ui.knob, ui.slider, ui.toggle, ui.button, ui.xy, ui.keyboard, ui.scope, ui.meter) with a "panel" rect; decorations are elements (text, shape, image, svg, led, canvas); the look holds the colour and font tokens, the background and the default skin of each control kind.
- Read it with kit_get_plugin; edit it with kit_apply_ops (screen edits are checked like any edit and land at once; they never recompile the sound). kit_ui_reference has the skins, fonts, element fields, canvas code and bundled pictures.
- After screen edits, look with kit_look and fix what it finds before you finish.
- Designing a screen: start from the design brief (kit_get_plugin shows it; with none yet, write one first with setBrief: the idea, palette, type and layout in 2-4 short lines) and keep to it on later requests. A ready look (wearLook) is a quick start. When the person points at a picture, look at it with kit_view_picture.
- What the person changed by hand (kit_get_plugin lists it) stays as they made it unless the request is about it.
- A control for a module input: addControl (wired, ranged and placed for you). Label every control; keep text at 11 px or more and readable against what is behind it; leave 16-24 px margins; line things up; nothing opaque over a control.
- Colours: use the tokens (bg, fg, accent, track, knob, pointer, muted, glow) so the screen survives a change of look; fixed colours only for things printed on a picture or a plate.
- Canvas elements draw with code; with a pointer handler they take the mouse and move controls (f.set), e.g. a curve whose points you drag.
- Keep what the user built unless asked to change it; change the screen only when the request is about it (or a new sound needs controls).

The screen project (code parts: when den-kit's own pieces are not enough)
- Each work can have a web project (Vite + TypeScript, ESLint, git) that lives in the pod; its code parts show on the plugin in their own box, fed with the controls' values and the sound, and can move controls (one drag is one undo step for the person). Use it when the screen needs what controls, skins, decorations and canvases do not do: a look of its own, 3D (three.js), motion and physics, a display of the sound, a control that behaves its own way, a whole custom screen.
- Before your first code part, read the project's AGENTS.md (kit_read_file "AGENTS.md"): the part API (src/kit/index.ts), how parts reach the controls (src/kit/controls.ts, made from the patch), and the rules. A work without a project gets one from den-kit's template on your first kit_bash or kit_write_file.
- Work as in any web project: write files, npm install what you need, run npm run check and npm run lint, fix what they report, and git diff to see your changes. Then put the part on the plugin with kit_apply_ops (addElement kind "code") and look with kit_look: it shows code parts as they draw and reports their errors.
- A control a code part reads or moves must exist in the patch (a knob wired to the input it stands for; it need not be on the plugin). Use the look's colours (the --dk-* CSS variables) so the part belongs to the plugin, and keep parts light (one animation loop through kit.frame).
- Everything you change in the project lands in the work at once and undoes with your request; node_modules, dist and .git stay in the pod.

Module types
${blocks}`;
}
