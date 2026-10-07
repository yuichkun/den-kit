// From a patch to its plugin window: the widgets on the panel, with their values,
// ranges and probes, ready for PluginWindow to draw.
import { defaultValue, type Catalog, type PortDef } from '../core/catalog.ts';
import type { Generated } from '../core/codegen.ts';
import type { PatchDocument, PatchNode } from '../core/schema.ts';
import { WIDGET_TYPES, type PluginSpec, type WidgetSpec, type WidgetType } from './spec.ts';

/** The values a control has (the XY pad has two); scopes, meters and the keyboard have none. */
const CONTROL_KEYS: Partial<Record<WidgetType, ReadonlyArray<'value' | 'x' | 'y'>>> = { 'ui.knob': ['value'], 'ui.slider': ['value'], 'ui.toggle': ['value'], 'ui.button': ['value'], 'ui.xy': ['x', 'y'] };

const isWidget = (n: PatchNode, catalog: Catalog) => (WIDGET_TYPES as readonly string[]).includes(n.type) && catalog.find(n.type)?.kind === 'widget';
/** Widgets on the plugin, in patch order (later ones draw on top). */
export function panelWidgets(doc: PatchDocument, catalog: Catalog): PatchNode[] {
  return Object.values(doc.nodes).filter(n => n.panel && isWidget(n, catalog));
}

function valuePort(n: PatchNode, catalog: Catalog, key: string): PortDef | undefined { return catalog.inputs(n).find(p => p.id === key); }
function currentValue(n: PatchNode, catalog: Catalog, key: string): number | boolean {
  const v = n.values[key];
  if (v !== undefined) return v;
  const port = valuePort(n, catalog, key);
  return port ? defaultValue(port) : 0;
}

export function widgetSpec(n: PatchNode, catalog: Catalog, generated: Pick<Generated, 'probes'>): WidgetSpec {
  const type = n.type as WidgetType;
  const config: WidgetSpec['config'] = {};
  if (type === 'ui.knob' || type === 'ui.slider') {
    const port = valuePort(n, catalog, 'value');
    config.min = port?.min ?? 0; config.max = port?.max ?? 1; config.scale = port?.scale ?? 'linear';
    config.unit = String(n.config.unit ?? ''); config.default = Number(port ? defaultValue(port) : config.min);
  }
  const values: WidgetSpec['values'] = {};
  for (const key of CONTROL_KEYS[type] ?? []) values[key] = currentValue(n, catalog, key);
  return { id: n.id, type, label: n.label ?? n.id, rect: { ...n.panel! }, config, values, probe: generated.probes.find(p => p.node === n.id)?.channel ?? -1 };
}

export function pluginSpec(doc: PatchDocument, catalog: Catalog, generated: Pick<Generated, 'probes'>): PluginSpec {
  return { width: doc.panel.width, height: doc.panel.height, theme: doc.panel.theme, widgets: panelWidgets(doc, catalog).map(n => widgetSpec(n, catalog, generated)) };
}
