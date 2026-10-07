// How each kind of control can look: the skins the plugin renderer knows, with
// their parameters. One table serves the checks (ops, loading), the inspector,
// and later the AI's description of what it can ask for. Dependency-free.

export type ControlKind = 'knob' | 'slider' | 'toggle' | 'button' | 'xy' | 'keyboard' | 'scope' | 'meter';
export const CONTROL_KINDS: readonly ControlKind[] = ['knob', 'slider', 'toggle', 'button', 'xy', 'keyboard', 'scope', 'meter'];
/** Widget node type → control kind. */
export const CONTROL_OF: Readonly<Record<string, ControlKind>> = {
  'ui.knob': 'knob', 'ui.slider': 'slider', 'ui.toggle': 'toggle', 'ui.button': 'button', 'ui.xy': 'xy', 'ui.keyboard': 'keyboard', 'ui.scope': 'scope', 'ui.meter': 'meter',
};

export type SkinParamValue = string | number | boolean;
export interface SkinParamDef {
  id: string;
  kind: 'number' | 'color' | 'enum' | 'boolean' | 'asset' | 'text';
  default: SkinParamValue;
  min?: number;
  max?: number;
  options?: readonly string[];
  doc: string;
}
export interface SkinDef { control: ControlKind; name: string; title: string; doc: string; params: readonly SkinParamDef[] }
export interface Skin { name: string; params?: Record<string, SkinParamValue> }

const num = (id: string, def: number, min: number, max: number, doc: string): SkinParamDef => ({ id, kind: 'number', default: def, min, max, doc });
const color = (id: string, def: string, doc: string): SkinParamDef => ({ id, kind: 'color', default: def, doc });
const bool = (id: string, def: boolean, doc: string): SkinParamDef => ({ id, kind: 'boolean', default: def, doc });
const choice = (id: string, options: readonly string[], def: string, doc: string): SkinParamDef => ({ id, kind: 'enum', options, default: def, doc });
const asset = (id: string, doc: string): SkinParamDef => ({ id, kind: 'asset', default: '', doc });
const text = (id: string, def: string, doc: string): SkinParamDef => ({ id, kind: 'text', default: def, doc });

const label = choice('label', ['bottom', 'top', 'none'], 'bottom', 'Where the label goes.');
const value = choice('value', ['bottom', 'inside', 'none'], 'bottom', 'Where the value readout goes.');
const xyLabel = choice('label', ['corner', 'none'], 'corner', 'The label in the top-left corner, or none (e.g. when the axes are labelled on the plugin).');

export const SKINS: readonly SkinDef[] = [
  // ---- knobs ----
  { control: 'knob', name: 'classic', title: 'Classic', doc: 'A disc with a pointer over a value arc.', params: [
    color('cap', 'knob', 'Disc colour.'), color('pointer', 'pointer', 'Pointer colour.'), color('arc', 'accent', 'Value arc colour.'), color('track', 'track', 'Arc track colour.'), num('arcWidth', 3.5, 0, 10, 'Arc thickness.'), label, value] },
  { control: 'knob', name: 'ring', title: 'Ring', doc: 'No cap: a thick value ring, the value in the middle.', params: [
    color('arc', 'accent', 'Value ring colour.'), color('track', 'track', 'Ring track colour.'), num('thickness', 6, 1, 16, 'Ring thickness.'), num('ticks', 0, 0, 41, 'Tick marks around the ring.'), bool('round', true, 'Rounded ring ends.'), label, choice('value', ['inside', 'bottom', 'none'], 'inside', 'Where the value readout goes.')] },
  { control: 'knob', name: 'cap', title: 'Cap', doc: 'A skirted cap with a pointer line and a printed scale, like hardware.', params: [
    color('cap', 'knob', 'Cap colour.'), color('pointer', 'pointer', 'Pointer colour.'), color('scale', 'fg', 'Scale marks colour.'), num('ticks', 11, 0, 41, 'Scale marks.'), choice('shape', ['line', 'dot', 'chicken'], 'line', 'Pointer shape (chicken = chicken-head knob).'), bool('numbers', false, 'Print 0–10 around the scale.'), label, value] },
  { control: 'knob', name: 'dot', title: 'Dot', doc: 'A soft round button with a small dot that travels round it.', params: [
    color('cap', 'knob', 'Body colour.'), color('dot', 'accent', 'Dot colour.'), num('soft', 0.6, 0, 1, 'Softness of the shading.'), bool('ring', false, 'A thin value ring around it.'), label, value] },
  { control: 'knob', name: 'image', title: 'Image', doc: 'Your picture of a knob, turned with the value (e.g. a photo or drawing of a brass knob, pointer up).', params: [
    asset('cap', 'The picture that turns (pointer at 12 o\'clock).'), asset('base', 'A picture behind it that stays still (optional).'), num('from', -135, -360, 360, 'Angle at the minimum.'), num('to', 135, -360, 360, 'Angle at the maximum.'), num('size', 1, 0.2, 2, 'Size of the picture relative to the knob.'), label, value] },
  // ---- sliders ----
  { control: 'slider', name: 'bar', title: 'Bar', doc: 'A filled bar.', params: [color('fill', 'accent', 'Fill colour.'), color('track', 'track', 'Track colour.'), num('radius', 4, 0, 40, 'Corner radius.'), label, value] },
  { control: 'slider', name: 'fader', title: 'Fader', doc: 'A thin slot with a fader cap, like a mixing desk.', params: [color('cap', 'knob', 'Cap colour.'), color('line', 'pointer', 'Line across the cap.'), color('slot', 'track', 'Slot colour.'), num('capSize', 0.18, 0.05, 0.5, 'Cap length (fraction of the travel).'), num('ticks', 9, 0, 41, 'Scale marks beside the slot.'), label, value] },
  { control: 'slider', name: 'image', title: 'Image', doc: 'Your pictures: a track and a thumb that slides along it.', params: [asset('track', 'The track picture.'), asset('thumb', 'The thumb picture.'), num('thumbSize', 0.2, 0.05, 1, 'Thumb length (fraction of the travel).'), label, value] },
  // ---- toggles and buttons ----
  { control: 'toggle', name: 'button', title: 'Button', doc: 'A labelled button that lights when on.', params: [color('on', 'accent', 'Colour when on.'), num('radius', 6, 0, 100, 'Corner radius.')] },
  { control: 'toggle', name: 'footswitch', title: 'Footswitch', doc: 'A round metal stomp switch; press to toggle.', params: [color('metal', '#c9ccd1', 'Metal colour.'), bool('led', true, 'An LED above the switch.'), color('ledColor', '#ff3b30', 'LED colour.'), label] },
  { control: 'toggle', name: 'switch', title: 'Switch', doc: 'A small lever or slide switch with ON/OFF printed beside it.', params: [choice('style', ['lever', 'slide'], 'lever', 'Lever (toggle switch) or slide.'), color('on', 'accent', 'Colour when on.'), text('onText', 'ON', 'Text for on.'), text('offText', 'OFF', 'Text for off.'), label] },
  { control: 'toggle', name: 'image', title: 'Image', doc: 'Two pictures: off and on.', params: [asset('off', 'Picture when off.'), asset('on', 'Picture when on.')] },
  { control: 'button', name: 'button', title: 'Button', doc: 'A labelled button that lights while held.', params: [color('on', 'accent', 'Colour while held.'), num('radius', 6, 0, 100, 'Corner radius.')] },
  { control: 'button', name: 'footswitch', title: 'Footswitch', doc: 'A round metal stomp switch, on while held.', params: [color('metal', '#c9ccd1', 'Metal colour.'), bool('led', false, 'An LED above the switch.'), color('ledColor', '#ff3b30', 'LED colour.'), label] },
  { control: 'button', name: 'image', title: 'Image', doc: 'Two pictures: up and held.', params: [asset('off', 'Picture when up.'), asset('on', 'Picture while held.')] },
  // ---- XY ----
  { control: 'xy', name: 'pad', title: 'Pad', doc: 'A flat pad with a dot.', params: [color('dot', 'accent', 'Dot colour.'), color('surface', 'track', 'Pad colour.'), num('radius', 6, 0, 200, 'Corner radius.'), bool('grid', false, 'Grid lines.'), xyLabel] },
  { control: 'xy', name: 'glow', title: 'Glow', doc: 'A glowing dot with a fading trail, over whatever is behind (the pad itself is clear).', params: [color('dot', 'accent', 'Dot and trail colour.'), num('size', 18, 4, 80, 'Dot size.'), num('trail', 24, 0, 120, 'Trail length (frames).'), num('glow', 18, 0, 80, 'Glow radius.'), bool('crosshair', false, 'Lines through the dot.'), bool('grid', false, 'Grid lines.'), xyLabel] },
  // ---- keyboard ----
  { control: 'keyboard', name: 'piano', title: 'Piano', doc: 'Black and white keys.', params: [num('octaves', 2, 1, 8, 'Octaves shown.'), num('start', 48, 0, 108, 'Lowest note (MIDI).'), color('lit', 'accent', 'Colour of held keys.')] },
  { control: 'keyboard', name: 'pads', title: 'Pads', doc: 'Big square pads, one note each, in a grid.', params: [num('count', 8, 1, 32, 'Number of pads.'), num('columns', 4, 1, 16, 'Pads per row.'), num('start', 48, 0, 120, 'Note of the first pad (MIDI).'), choice('scale', ['chromatic', 'major', 'minor', 'pentatonic', 'same'], 'major', 'Notes the pads step through (same = all the start note).'), choice('colors', ['rainbow', 'accent', 'pastel', 'mono', 'outline'], 'rainbow', 'Pad colours (outline: lines in the accent colour, filled while held).'), num('radius', 14, 0, 100, 'Corner radius.'), num('gap', 10, 0, 60, 'Gap between pads.'), text('labels', '', 'Pad labels, comma separated (empty: note names).')] },
  // ---- scope ----
  { control: 'scope', name: 'line', title: 'Line', doc: 'A plain waveform line.', params: [color('line', 'accent', 'Line colour.'), color('surface', 'track', 'Background colour.'), num('width', 1.5, 0.5, 6, 'Line width.')] },
  { control: 'scope', name: 'phosphor', title: 'Phosphor', doc: 'A glowing trace on a graticule, like a bench oscilloscope.', params: [color('line', '#7dff9a', 'Trace colour.'), color('surface', '#05140b', 'Screen colour.'), bool('grid', true, 'Graticule.'), num('glow', 10, 0, 40, 'Glow.'), num('persistence', 0.6, 0, 0.95, 'How long old traces linger.')] },
  // ---- meter ----
  { control: 'meter', name: 'bar', title: 'Bar', doc: 'A level bar.', params: [color('fill', 'accent', 'Bar colour.'), color('surface', 'track', 'Background colour.'), bool('scale', false, 'dB marks.')] },
  { control: 'meter', name: 'needle', title: 'Needle (VU)', doc: 'A needle on a printed VU scale (0 VU = −18 dBFS) with VU ballistics.', params: [color('face', '#f3e6c4', 'Face colour.'), color('ink', '#2a2116', 'Scale and text colour.'), color('needle', '#1b1b1b', 'Needle colour.'), color('red', '#c0392b', 'Red zone colour.'), text('caption', 'VU', 'Text on the face.'), asset('image', 'A picture for the face (optional; drawn under the needle).'), bool('lamp', false, 'A warm backlight glow.')] },
  { control: 'meter', name: 'led', title: 'LED ladder', doc: 'Segments that light up green, yellow, red.', params: [num('segments', 12, 4, 40, 'Number of segments.'), color('low', '#3ddc84', 'Low colour.'), color('mid', '#ffd60a', 'Middle colour.'), color('high', '#ff3b30', 'Top colour.'), color('off', 'track', 'Unlit colour.')] },
];

export const DEFAULT_SKIN: Readonly<Record<ControlKind, string>> = { knob: 'classic', slider: 'bar', toggle: 'button', button: 'button', xy: 'pad', keyboard: 'piano', scope: 'line', meter: 'bar' };

export function skinDef(control: ControlKind, name: string): SkinDef | undefined { return SKINS.find(s => s.control === control && s.name === name); }
export function skinsFor(control: ControlKind): SkinDef[] { return SKINS.filter(s => s.control === control); }

/** Every parameter of a skin with defaults filled in. */
export function skinParams(control: ControlKind, skin: Skin | undefined): { def: SkinDef; params: Record<string, SkinParamValue> } {
  const def = (skin && skinDef(control, skin.name)) ?? skinDef(control, DEFAULT_SKIN[control])!;
  const params: Record<string, SkinParamValue> = {};
  for (const p of def.params) params[p.id] = skin?.name === def.name && skin.params && Object.hasOwn(skin.params, p.id) ? skin.params[p.id]! : p.default;
  return { def, params };
}
