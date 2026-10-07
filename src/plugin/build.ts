// From a patch to its plugin window: the look resolved to CSS variables, and
// the widgets (with their values, ranges, probes and skins) and decorations in
// stacking order, ready for PluginWindow to draw.
import { defaultValue, type Catalog, type PortDef } from '../core/catalog.ts';
import type { Generated } from '../core/codegen.ts';
import type { PatchDocument, PatchNode } from '../core/schema.ts';
import { CONTROL_OF, DEFAULT_SKIN } from '../core/skins.ts';
import { THEME_TOKENS } from '../core/themes.ts';
import { COLOR_TOKENS, FONT_TOKENS, cssColor, fontStack, stackOrder, tokenVar, type ColorToken, type FontToken } from '../core/ui.ts';
import { WIDGET_TYPES, type PluginItem, type PluginSpec, type WidgetSpec, type WidgetType } from './spec.ts';

/** The values a control has (the XY pad has two); scopes, meters and the keyboard have none. */
const CONTROL_KEYS: Partial<Record<WidgetType, ReadonlyArray<'value' | 'x' | 'y'>>> = { 'ui.knob': ['value'], 'ui.slider': ['value'], 'ui.toggle': ['value'], 'ui.button': ['value'], 'ui.xy': ['x', 'y'] };

const isWidget = (n: PatchNode, catalog: Catalog) => (WIDGET_TYPES as readonly string[]).includes(n.type) && catalog.find(n.type)?.kind === 'widget';
/** Widgets on the plugin, in patch order. */
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

export function widgetSpec(n: PatchNode, catalog: Catalog, generated: Pick<Generated, 'probes'>, doc?: Pick<PatchDocument, 'ui'>): WidgetSpec {
  const type = n.type as WidgetType, control = CONTROL_OF[type]!;
  const config: WidgetSpec['config'] = {};
  if (type === 'ui.knob' || type === 'ui.slider') {
    const port = valuePort(n, catalog, 'value');
    config.min = port?.min ?? 0; config.max = port?.max ?? 1; config.scale = port?.scale ?? 'linear';
    config.unit = String(n.config.unit ?? ''); config.default = Number(port ? defaultValue(port) : config.min);
  }
  const values: WidgetSpec['values'] = {};
  for (const key of CONTROL_KEYS[type] ?? []) values[key] = currentValue(n, catalog, key);
  const spec: WidgetSpec = { id: n.id, type, control, label: n.label ?? n.id, config, values, probe: generated.probes.find(p => p.node === n.id)?.channel ?? -1, skin: n.style?.skin ?? doc?.ui.look.skins[control] ?? { name: DEFAULT_SKIN[control] } };
  if (n.panel) spec.rect = { ...n.panel };
  if (n.style) spec.style = n.style;
  return spec;
}

/** The look's tokens over the base theme, as CSS custom properties. */
export function lookVars(doc: Pick<PatchDocument, 'panel' | 'ui'>): Record<string, string> {
  const base = THEME_TOKENS[doc.panel.theme] ?? THEME_TOKENS.graphite;
  const tokens = { ...base, ...doc.ui.look.tokens };
  const vars: Record<string, string> = {};
  for (const t of COLOR_TOKENS) vars[tokenVar(t)] = cssColor(tokens[t as ColorToken]!);
  for (const t of FONT_TOKENS) vars[tokenVar(t)] = fontStack(tokens[t as FontToken] === t ? undefined : tokens[t as FontToken]);
  return vars;
}

export function pluginSpec(doc: PatchDocument, catalog: Catalog, generated: Pick<Generated, 'probes'>): PluginSpec {
  const controls: PluginSpec['controls'] = {};
  for (const n of Object.values(doc.nodes)) if (isWidget(n, catalog)) controls[n.id] = widgetSpec(n, catalog, generated, doc);
  const placed = panelWidgets(doc, catalog);
  const items: PluginItem[] = [];
  for (const id of stackOrder(doc.ui, placed.map(n => n.id))) {
    const element = doc.ui.elements[id];
    if (element) { if (!element.hidden) items.push({ kind: 'element', id, element }); }
    else if (controls[id]?.rect) items.push({ kind: 'widget', id, widget: controls[id]! });
  }
  return {
    width: doc.panel.width, height: doc.panel.height, theme: doc.panel.theme,
    vars: lookVars(doc), background: doc.ui.look.background ?? [], css: doc.ui.look.css ?? '',
    items, widgets: placed.map(n => controls[n.id]!), controls, groups: doc.ui.groups, underlay: doc.ui.underlay, assets: doc.assets,
  };
}
