// The plugin window as data: its design size, look and everything drawn on it,
// back to front. build.ts makes it from the patch; PluginWindow.vue draws it.
// Types only (and the widget type list): no DOM, no Vue.
import type { ControlKind, Skin } from '../work/skins.ts';
import type { AssetMeta, Fill, UiElement, Underlay, WidgetStyle } from '../work/ui.ts';
import type { NodeId } from '../work/schema.ts';

/** Which node outputs the meters and scopes read, in the order the sound probes them. */
export interface ProbeList {
  probes: Array<{ node: NodeId; channel: number }>;
}

export type WidgetType =
  | 'ui.knob'
  | 'ui.slider'
  | 'ui.toggle'
  | 'ui.button'
  | 'ui.xy'
  | 'ui.keyboard'
  | 'ui.scope'
  | 'ui.meter';
export const WIDGET_TYPES: readonly WidgetType[] = [
  'ui.knob',
  'ui.slider',
  'ui.toggle',
  'ui.button',
  'ui.xy',
  'ui.keyboard',
  'ui.scope',
  'ui.meter',
];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface WidgetSpec {
  id: string;
  type: WidgetType;
  control: ControlKind;
  label: string;
  /** Where it sits on the plugin (none: the control exists in the patch but is not on the plugin). */
  rect?: Rect;
  /** min / max / scale / unit / default for knobs and sliders. */
  config: Record<string, string | number | boolean>;
  /** `value` (or `x` / `y` for the XY pad). */
  values: Record<string, number | boolean>;
  /** Probe channel for scopes and meters (-1: the patch's output). */
  probe: number;
  /** The skin in effect (its own, the look's default for its kind, or the built-in default). */
  skin: Skin;
  style?: WidgetStyle;
}
export type PluginItem =
  | { kind: 'widget'; id: string; widget: WidgetSpec }
  | { kind: 'element'; id: string; element: UiElement };
export interface PluginSpec {
  width: number;
  height: number;
  theme: string;
  /** CSS custom properties of the look (tokens resolved over the base theme). */
  vars: Record<string, string>;
  /** Background layers; none: the bg token. */
  background: Fill[];
  /** The look's CSS (sanitised by the renderer). */
  css: string;
  /** Everything on the plugin, back to front. */
  items: PluginItem[];
  /** The widgets on the plugin, in patch order. */
  widgets: WidgetSpec[];
  /** Every widget node, on the plugin or not (text and lamps can show any of them). */
  controls: Record<string, WidgetSpec>;
  groups: Record<string, string[]>;
  underlay?: Underlay;
  assets: Record<string, AssetMeta>;
}
