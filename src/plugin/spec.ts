// The plugin window as data: its design size, theme and widgets. build.ts makes
// it from the patch; PluginWindow.vue draws it. Dependency-free.

export type WidgetType = 'ui.knob' | 'ui.slider' | 'ui.toggle' | 'ui.button' | 'ui.xy' | 'ui.keyboard' | 'ui.scope' | 'ui.meter';
export const WIDGET_TYPES: readonly WidgetType[] = ['ui.knob', 'ui.slider', 'ui.toggle', 'ui.button', 'ui.xy', 'ui.keyboard', 'ui.scope', 'ui.meter'];

export interface Rect { x: number; y: number; w: number; h: number }
export interface WidgetSpec {
  id: string;
  type: WidgetType;
  label: string;
  rect: Rect;
  /** min / max / scale / unit / default for knobs and sliders. */
  config: Record<string, string | number | boolean>;
  /** `value` (or `x` / `y` for the XY pad). */
  values: Record<string, number | boolean>;
  /** Probe channel for scopes and meters (-1: the patch's output). */
  probe: number;
}
export interface PluginSpec { width: number; height: number; theme: string; widgets: WidgetSpec[] }
