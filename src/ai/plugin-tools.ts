// The plugin's screen for the LLM: a readable account of what is on it, the
// reference for what it can ask for (look, fonts, skins, elements, custom
// parts, the bundled pictures), and the shorthands it may use in kit_apply_ops
// (addControl; bundled pictures by id). Pure functions over the patch; the
// workspace (llm-workspace.ts) calls them.
import type { Catalog } from '../core/catalog.ts';
import type { Transaction } from '../core/history.ts';
import { OpError, type Intent } from '../core/ops.ts';
import type { PatchDocument } from '../core/schema.ts';
import { CONTROL_KINDS, CONTROL_OF, DEFAULT_SKIN, SKINS, type ControlKind, type Skin } from '../core/skins.ts';
import { THEME_TOKENS } from '../core/themes.ts';
import { COLOR_TOKENS, ELEMENT_FIELDS, ELEMENT_KINDS, FONTS, FONT_TOKENS, LIMITS, TOKEN_DOC, isFontAsset, isImageAsset, stackOrder, type ColorToken, type Fill, type Look, type TokenName, type UiElement } from '../core/ui.ts';
import { PICTURE_DOC, SHOWCASE_ASSETS } from '../showcase/assets.ts';
import { WORKS, findWork, lookIntents } from '../showcase/index.ts';
import { ControlError, controlFor, type ControlType } from '../plugin/controls.ts';
import { formatValue } from '../plugin/format.ts';
import { PART_CURSORS } from '../plugin/part-api.ts';

const clip = (s: string, n: number) => s.length > n ? `${s.slice(0, n)}… (${s.length} chars)` : s;
const rectText = (r: { x: number; y: number; w: number; h: number }) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`;
const isWidget = (doc: PatchDocument, catalog: Catalog, id: string) => { const n = doc.nodes[id]; return !!n && !!CONTROL_OF[n.type] && catalog.find(n.type)?.kind === 'widget'; };

function fillText(f: Fill): string {
  const extra = `${f.opacity !== undefined && f.opacity !== 1 ? ` opacity ${f.opacity}` : ''}${f.blend && f.blend !== 'normal' ? ` blend ${f.blend}` : ''}`;
  switch (f.kind) {
    case 'color': return `colour ${f.color}${extra}`;
    case 'linear': return `linear ${f.angle}° ${f.stops.map(s => `${s.color}@${s.at}`).join(' ')}${extra}`;
    case 'radial': return `radial at ${f.x},${f.y} ${f.stops.map(s => `${s.color}@${s.at}`).join(' ')}${extra}`;
    case 'image': return `picture ${f.asset} ${f.fit}${f.size ? ` ${f.size}px` : ''}${extra}`;
  }
}
function skinText(control: ControlKind, skin: Skin | undefined, from: string): string {
  const s = skin ?? { name: DEFAULT_SKIN[control] };
  const params = Object.entries(s.params ?? {}).map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(', ');
  return `${s.name} (${from}${params ? `: ${params}` : ''})`;
}

/**
 * Everything on the plugin, back to front, as one line each (exact fields as
 * JSON, so an edit can start from them), with the look, the controls kept off
 * the plugin, groups and assets. `part` returns one custom part's whole code.
 */
export function describePlugin(doc: PatchDocument, catalog: Catalog, options: { part?: string; problems?: string[]; handEdits?: string[] } = {}): string {
  if (options.part) {
    const el = doc.ui.elements[options.part];
    if (!el || el.kind !== 'part') throw new Error(`No custom part "${options.part}". Parts: ${Object.values(doc.ui.elements).filter(e => e.kind === 'part').map(e => e.id).join(', ') || 'none'}.`);
    return `Custom part ${el.id}${el.name ? ` "${el.name}"` : ''}, ${rectText(el.rect)}, props ${JSON.stringify(el.props)}:\n${el.code}`;
  }
  const base = THEME_TOKENS[doc.panel.theme] ?? THEME_TOKENS.graphite;
  const look = doc.ui.look;
  const lines: string[] = [];
  lines.push(`Plugin "${doc.name}": ${doc.panel.width}×${doc.panel.height} px (design pixels; it scales to the window). Base theme: ${doc.panel.theme}.`);
  lines.push(doc.ui.brief ? `Design brief (keep to it; change it with setBrief only when the direction changes):\n${doc.ui.brief}` : 'No design brief yet: before you design the screen, write one with {"op":"setBrief","brief":"…"} (the idea, palette, type and layout in 2–4 short lines).');
  if (options.handEdits?.length) lines.push(`Changed by the person's own hand (keep these unless the request is about them): ${options.handEdits.join('; ')}.`);
  if (doc.ui.underlay) lines.push(`Reference picture laid under the editor: ${doc.ui.underlay.asset} (the person's guide for the layout; look at it with kit_view_picture).`);
  const token = (t: TokenName) => `${t} ${look.tokens[t] ?? `${base[t]} (theme)`}`;
  lines.push(`Look tokens: ${COLOR_TOKENS.map(token).join(', ')}.`);
  lines.push(`Look fonts: ${FONT_TOKENS.map(token).join(', ')}.`);
  lines.push(`Look background (bottom first): ${look.background?.length ? look.background.map(fillText).join(' | ') : `none (the bg token)`}.`);
  const skins = CONTROL_KINDS.filter(k => look.skins[k]).map(k => `${k} ${skinText(k, look.skins[k], 'look')}`);
  lines.push(`Look skins: ${skins.length ? skins.join('; ') : 'none (built-in defaults)'}.${look.css ? ` Look CSS: ${clip(look.css, 400)}` : ''}`);
  const placed = Object.values(doc.nodes).filter(n => n.panel && isWidget(doc, catalog, n.id)).map(n => n.id);
  const order = stackOrder(doc.ui, placed);
  lines.push('', 'On the plugin, back to front:');
  if (!order.length) lines.push(' (nothing yet)');
  for (const id of order) {
    const el = doc.ui.elements[id];
    if (el) lines.push(` ${elementLine(el)}`);
    else lines.push(` ${widgetLine(doc, catalog, id)}`);
  }
  const off = Object.values(doc.nodes).filter(n => !n.panel && isWidget(doc, catalog, n.id) && !['ui.keyboard', 'ui.scope', 'ui.meter'].includes(n.type));
  if (off.length) lines.push('', `Controls in the patch but not on the plugin (put one on with setPanel; custom parts can move them with f.set): ${off.map(n => widgetLine(doc, catalog, n.id)).join(' · ')}`);
  const groups = Object.entries(doc.ui.groups);
  if (groups.length) lines.push('', `Groups (move together): ${groups.map(([g, m]) => `${g} = [${m.join(', ')}]`).join('; ')}`);
  const assets = Object.values(doc.assets);
  lines.push('', `Assets in this patch: ${assets.length ? assets.map(a => `${a.id} (${isFontAsset(a) ? 'font' : 'picture'}${a.width ? ` ${a.width}×${a.height}` : ''}${PICTURE_DOC[a.id] ? `: ${PICTURE_DOC[a.id]}` : a.source?.title ? `: ${a.source.title}` : ''})`).join('; ') : 'none'}. Bundled pictures can be used by id (kit_ui_reference "pictures").`);
  if (options.problems) lines.push('', options.problems.length ? `Problems found by the checks:\n${options.problems.map(p => ` - ${p}`).join('\n')}` : 'The checks found no problems.');
  return lines.join('\n');
}

function elementLine(el: UiElement): string {
  const shown: Record<string, unknown> = { ...el };
  if (el.kind === 'part') shown.code = `${clip(el.code.replace(/\s+/g, ' '), 160)} — whole code: kit_get_plugin {"part":"${el.id}"}${/\bpointer\s*\(/.test(el.code) ? '; it takes the mouse' : ''}`;
  if (el.kind === 'svg') shown.svg = clip(el.svg, 160);
  return JSON.stringify(shown);
}

function widgetLine(doc: PatchDocument, catalog: Catalog, id: string): string {
  const n = doc.nodes[id]!;
  const control = CONTROL_OF[n.type]!;
  const out: Record<string, unknown> = { id, control, label: n.label ?? id };
  if (n.panel) out.panel = n.panel;
  out.skin = skinText(control, n.style?.skin ?? doc.ui.look.skins[control], n.style?.skin ? 'own' : doc.ui.look.skins[control] ? 'look' : 'default');
  const { skin: _skin, ...style } = n.style ?? {};
  if (Object.keys(style).length) out.style = style;
  if (n.type === 'ui.knob' || n.type === 'ui.slider') {
    const unit = String(n.config.unit ?? '');
    const min = Number(n.config.min ?? 0), max = Number(n.config.max ?? 1);
    out.value = formatValue(Number(n.values.value ?? min), unit);
    out.range = `${formatValue(min, unit)} … ${formatValue(max, unit)}${n.config.scale === 'log' ? ' (log)' : ''}`;
  } else if (n.type === 'ui.xy') out.value = { x: n.values.x, y: n.values.y };
  else if (n.type === 'ui.toggle' || n.type === 'ui.button') out.value = n.values.value ? 'on' : 'off';
  const drives = Object.values(doc.edges).filter(e => e.from.node === id).map(e => `${e.from.port === 'out' ? '' : `${e.from.port} `}→ ${e.to.node}.${e.to.port}`);
  if (drives.length) out.drives = drives;
  else if (['ui.knob', 'ui.slider', 'ui.toggle', 'ui.button', 'ui.xy'].includes(n.type)) out.drives = 'nothing (not wired)';
  return JSON.stringify(out);
}

// ---- reference ------------------------------------------------------------------------------
export const UI_TOPICS = ['look', 'fonts', 'skins', 'elements', 'parts', 'pictures', 'looks', 'layout'] as const;
export type UiTopic = typeof UI_TOPICS[number];

/** What the LLM can ask for on the plugin, by topic (skins can be narrowed to one control kind). */
export function uiReference(topic: string | undefined, control?: string, catalog?: Catalog): string {
  switch (topic) {
    case 'look': return [
      'The look: {"op":"setLook","look":{...}} merges into the current look (tokens and skins key by key, null removes one; background and css replace, null removes). "replace":true replaces the whole look.',
      'tokens (the colours and fonts every control and text uses; a colour anywhere may also name a token, e.g. "accent"):',
      ...[...COLOR_TOKENS, ...FONT_TOKENS].map(t => `  ${t}: ${TOKEN_DOC[t]}`),
      `background: a list of fills, bottom first (up to ${LIMITS.fills}):`,
      '  {"kind":"color","color":"#1b1d22"} · {"kind":"linear","angle":180,"stops":[{"color":"#000000","at":0},{"color":"#00000000","at":1}]} (angle: 180 = top to bottom)',
      '  {"kind":"radial","x":0.5,"y":0.4,"stops":[...]} · {"kind":"image","asset":"sc-wood","fit":"cover"|"contain"|"stretch"|"tile","size":256}',
      '  any fill: "opacity":0..1, "blend":"multiply"|"screen"|"overlay"|"soft-light"|…',
      'colours: a token name, #rgb/#rrggbb/#rrggbbaa, rgb()/hsl() or a CSS colour name.',
      `skins: the default skin per control kind, {"knob":{"name":"ring","params":{"thickness":4}}} (kit_ui_reference "skins").`,
      'css: plugin-wide CSS, scoped to the plugin; only url(asset:ID) can load anything. Use it rarely (the fields above cover most needs).',
      `Base themes (setTheme): ${Object.keys(THEME_TOKENS).join(', ')} — the look's tokens sit on top of the theme.`,
    ].join('\n');
    case 'fonts': return [
      'Fonts (textStyle.font, or the font tokens): a font token (font, labelFont, valueFont), one of these, or a font asset id:',
      ...Object.entries(FONTS).map(([id, f]) => `  ${id}: ${f.title} — ${f.doc}`),
    ].join('\n');
    case 'skins': {
      const kinds = control && (CONTROL_KINDS as readonly string[]).includes(control) ? [control as ControlKind] : CONTROL_KINDS;
      return [
        'Skins: how a control kind looks. Default per kind in the look (setLook skins), or per control: {"op":"setStyle","node":"knob1","style":{"skin":{"name":"cap","params":{"shape":"chicken"}}}}.',
        'A widget style is {skin, style (its box: fill, stroke, radius, shadows…), tokens (colour tokens for this control only), textStyle (label and value text)}. setStyle replaces the whole widget style (null removes it).',
        ...kinds.flatMap(k => [`${k} (${Object.entries(CONTROL_OF).filter(([, c]) => c === k).map(([t]) => t).join(', ')}):`, ...SKINS.filter(s => s.control === k).map(s => `  ${s.name}: ${s.doc} Params: ${s.params.map(p => `${p.id} (${p.kind}${p.options ? ` ${p.options.join('|')}` : ''}${p.min !== undefined ? ` ${p.min}..${p.max}` : ''}, default ${JSON.stringify(p.default)}) ${p.doc}`).join('; ') || 'none'}.`)]),
      ].join('\n');
    }
    case 'elements': return [
      'Elements: decorations on the plugin (they never catch the mouse, except custom parts that handle it). Add: {"op":"addElement","element":{"kind":"text",…,"rect":{"x":..,"y":..,"w":..,"h":..}}} (id optional). Change: {"op":"updateElement","id":"text1","set":{field: value}} — a field is replaced whole (send the whole textStyle or style); null removes an optional field. Move or resize anything (an element or a control): {"op":"setRect","id":"..","rect":{...}}.',
      ...ELEMENT_KINDS.map(k => `  ${k}: fields ${ELEMENT_FIELDS(k).join(', ')}`),
      '  text: "text" (\\n for lines); "bind":"knob1" shows that control\'s value ("{value}" in the text marks where).',
      '  shape: "shape":"rect"|"ellipse"|"line" (a line is drawn with style.stroke).',
      '  image: "asset" (a picture asset id), "fit":"cover"|"contain"|"stretch".',
      '  svg: "svg" markup starting with <svg> (no scripts run).',
      '  led: "bind" (a control id, or "@level" to light with the sound), "color", "threshold" 0..1.',
      '  part: "code" (a custom part, see kit_ui_reference "parts"), "props" (settings the code reads as f.props).',
      `style (every element): {"fill":[fills],"stroke":{"color","width","style":"solid"|"dashed"|"dotted"},"radius","opacity","shadows":[{"x","y","blur","spread","color","inset"}],"rotate","blend","blur"} (a glow is a shadow with no offset).`,
      'textStyle: {"font","size" (px),"weight" 100..900,"color","align":"left"|"center"|"right","valign":"top"|"middle"|"bottom","spacing" (em),"lineHeight","case":"none"|"upper"|"lower","italic","shadows":[{"x","y","blur","color"}],"stroke":{"color","width"}}.',
      'Stacking: {"op":"arrange","ids":[..],"to":"front"|"back"|"forward"|"backward"}. Groups: {"op":"group","ids":[..]} / {"op":"ungroup","id":"g1"}. Remove: {"op":"removeElement","id":".."}.',
      `Limits: ${LIMITS.elements} elements, text ${LIMITS.text} chars, svg ${LIMITS.svg} chars, part code ${LIMITS.code} chars.`,
    ].join('\n');
    case 'parts': return [
      'Custom parts: JavaScript that draws on a canvas every frame, in a worker (no page, no network). export default draw(ctx, f), or { setup(ctx, f), draw(ctx, f), pointer(e, f) }.',
      'f (each frame): f.w, f.h (its size in design px; the canvas is already scaled) · f.t, f.dt (seconds) · f.level, f.peak (the sound now, 0..1) · f.wave (256 samples) · f.spectrum (64 bands, 0..1, low to high)',
      '  f.value(id) (a control\'s value in its units), f.norm(id) (0..1), f.xy(id), f.on(id), f.range(id) → {min, max, log, unit} · f.color("accent") (the look\'s colours) · f.props (the element\'s props) · f.state (kept between frames; setup runs again after a resize)',
      'With pointer(e, f), the part takes the mouse while the plugin plays (not while editing): e.type is "down", "move", "up", "wheel", "double" or "leave"; e.x, e.y in the part; e.dx, e.dy (moves since the last event; wheel: about ±100 a notch); e.shift, e.alt, e.meta. f.pointer = {x, y, over, down, …} for drawing hover and press.',
      `  f.set(id, value) moves a control in its own units (clamped to its range; a switch takes true/false, an XY pad {x, y}); f.setNorm(id, 0..1) follows its scale (log for Hz). What one press (or one burst of wheel turns) writes is one undo step for the user. Controls need not be on the plugin: a part can be the face of controls kept off it. f.cursor(name): ${PART_CURSORS.join(', ')}.`,
      'Keep draw fast (it runs 60 times a second; a frame over 1.5 s stops the part). Clear the canvas yourself (ctx.clearRect(0, 0, f.w, f.h)). Use f.color(token) so the part follows the look. An error shows in the part with its line number.',
      'Example: export default { draw(ctx, f) { ctx.clearRect(0, 0, f.w, f.h); ctx.fillStyle = f.color("accent"); ctx.fillRect(0, f.h * (1 - f.norm("knob1")), f.w, f.h * f.norm("knob1")); }, pointer(e, f) { if (e.type === "down" || (e.type === "move" && f.pointer.down)) f.setNorm("knob1", 1 - e.y / f.h); } };',
    ].join('\n');
    case 'pictures': return [
      'Bundled pictures (use the id in a fill, an image element or a skin param; it is added to the patch when used):',
      ...Object.values(SHOWCASE_ASSETS).filter(isImageAsset).map(a => `  ${a.id}: ${PICTURE_DOC[a.id] ?? a.source?.title ?? a.name}${a.width ? ` ${a.width}×${a.height}` : ''}`),
      'Pictures the user added are in kit_get_plugin under Assets. You cannot fetch pictures from the web.',
    ].join('\n');
    case 'looks': return [
      'Ready looks from den-kit\'s showcase works. {"op":"wearLook","work":"neon"} puts one on the plugin (its base theme, colour and font tokens, background, default skins and CSS, with the pictures they use); the layout and the decorations stay, and follow the new colours where they use tokens. A good start; adjust from there.',
      ...WORKS.map(w => `  ${w.id}: ${w.title} — ${w.prompt}.${catalog ? ` ${lookSummary(w.build(catalog).ui.look)}` : ''}`),
    ].join('\n');
    case 'layout': return [
      'Layout that reads well:',
      '  Margins of 16–24 px from the plugin edge; line controls up (same y for a row, same size for the same kind) and keep even gaps (12–24 px).',
      '  Sizes that play well: knob 72–110 × 84–124 (with label and value), slider 40–60 × 140–220, switch 80–110 × 40–56, XY pad from 160 × 160.',
      '  Text: labels and values at least 11 px, a title 28–56 px; contrast of at least 4.5:1 with what is behind it (3:1 for large titles).',
      '  Nothing opaque over a control; a backdrop (a shape behind a row of controls) goes below them in the stack.',
      '  Every control labelled (its own label, or a text next to it); group what belongs together (a panel, a line, spacing).',
      '  Prefer tokens over fixed colours so the screen survives a change of look; use fixed colours for text printed on a picture or a plate.',
      '  Grow the plugin if it is crowded: {"op":"setPanelSize","width":720,"height":440}.',
    ].join('\n');
    default: return [
      `The plugin screen reference. Topics (kit_ui_reference {"topic": …}): ${UI_TOPICS.join(', ')} (skins also takes "control": ${CONTROL_KINDS.join(', ')}).`,
      'Controls on the plugin are widget modules (ui.knob, ui.slider, ui.toggle, ui.button, ui.xy, ui.keyboard, ui.scope, ui.meter) with a "panel" rect; decorations are elements (text, shape, image, svg, led, part); the look holds the colour and font tokens, the background and the default skins.',
      uiReference('layout'),
    ].join('\n');
  }
}

// ---- shorthands in kit_apply_ops ----------------------------------------------------------------
const libraryIds = new Set(Object.keys(SHOWCASE_ASSETS));
function strings(v: unknown, out: Set<string>) {
  if (typeof v === 'string') { if (libraryIds.has(v)) out.add(v); return; }
  if (Array.isArray(v)) { for (const x of v) strings(x, out); return; }
  if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
}

/**
 * Turn the LLM's shorthands into ordinary intents: addControl (a control for a
 * module input, ranged and placed like the inspector does) and bundled pictures
 * (by id, added to the patch when an edit uses one). `origin[i]` is the index
 * of the LLM's op that intent i came from (for error messages).
 */
export function expandOps(doc: PatchDocument, catalog: Catalog, ops: unknown[]): { intents: Intent[]; origin: number[]; notes: string[] } {
  const intents: Intent[] = [], origin: number[] = [], notes: string[] = [];
  const ids = new Set<string>(), rects: { x: number; y: number; w: number; h: number }[] = [];
  const added = new Set<string>();
  const addAsset = (id: string, at: number) => {
    if (doc.assets[id] || added.has(id) || !SHOWCASE_ASSETS[id]) return;
    added.add(id);
    intents.push({ op: 'addAsset', asset: SHOWCASE_ASSETS[id]! }); origin.push(at);
  };
  ops.forEach((raw, at) => {
    const op = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    if (op.op === 'addControl') {
      const target = (op.for && typeof op.for === 'object' ? op.for : {}) as { node?: unknown; port?: unknown };
      try {
        const made = controlFor(doc, catalog, { node: String(target.node ?? ''), port: String(target.port ?? ''), type: op.type as ControlType | undefined, label: typeof op.label === 'string' ? op.label : undefined, panel: op.panel as never, style: op.style as never, id: typeof op.id === 'string' ? op.id : undefined }, { ids, rects });
        ids.add(made.id); rects.push(made.panel);
        if (!made.placed) notes.push(`${made.id} went into the bottom-right corner: the plugin has no free space for it (grow it with setPanelSize, or give a panel rect).`);
        for (const i of made.intents) { intents.push(i); origin.push(at); }
      } catch (error) {
        if (error instanceof ControlError) throw new OpError(error.message, at, 'bad-control', 'addControl is {"op":"addControl","for":{"node":"filter1","port":"cutoff"},"type"?:"ui.knob"|"ui.slider"|"ui.toggle"|"ui.button","label"?,"panel"?,"style"?,"id"?}.');
        throw error;
      }
      return;
    }
    if (op.op === 'wearLook') {
      const work = findWork(String(op.work ?? ''));
      if (!work) throw new OpError(`No look "${String(op.work ?? '')}".`, at, 'bad-look', `Looks: ${WORKS.map(w => w.id).join(', ')} (kit_ui_reference "looks").`);
      for (const i of lookIntents(doc, work.build(catalog))) { intents.push(i); origin.push(at); }
      return;
    }
    if (op.op === 'addAsset' && op.asset && typeof op.asset === 'object') {
      const id = String((op.asset as { id?: unknown }).id ?? '');
      if (SHOWCASE_ASSETS[id] && Object.keys(op.asset).every(k => k === 'id' || k === 'name')) { addAsset(id, at); return; }
    }
    const used = new Set<string>();
    strings(op, used);
    for (const id of used) addAsset(id, at);
    intents.push(op as unknown as Intent); origin.push(at);
  });
  return { intents, origin, notes };
}

/** "+ text "NEBULA"", "look", "ktime on the plugin" — a short account of a screen edit. */
export function describeUiOp(op: Intent): string | null {
  switch (op.op) {
    case 'addElement': { const e = op.element as Record<string, unknown>; return `+ ${op.element.kind}${typeof e.text === 'string' ? ` “${e.text.length > 24 ? `${e.text.slice(0, 23)}…` : e.text}”` : typeof e.name === 'string' ? ` ${e.name}` : ''}`; }
    case 'updateElement': return `${op.id}: ${Object.keys(op.set).join(', ')}`;
    case 'removeElement': return `− ${op.id}`;
    case 'setRect': return `place ${op.id}`;
    case 'setPanel': return op.panel ? `${op.node} on the plugin` : `${op.node} off the plugin`;
    case 'setStyle': return `style ${op.node}`;
    case 'setLook': return `look: ${Object.keys(op.look).join(', ')}`;
    case 'setPanelSize': return `size ${op.width}×${op.height}`;
    case 'arrange': return `${op.to}: ${op.ids.join(', ')}`;
    case 'group': return `group ${op.ids.join(', ')}`;
    case 'ungroup': return `ungroup ${op.id}`;
    case 'addAsset': return `+ picture ${op.asset.id}`;
    case 'removeAsset': return `− asset ${op.id}`;
    case 'setUnderlay': return 'reference picture';
    case 'setBrief': return 'design brief';
    case 'setTheme': return `theme ${op.theme}`;
    default: return null;
  }
}

/** A look in a line: its colours, fonts, background and skins. */
function lookSummary(look: Look): string {
  const t = look.tokens;
  const colors = COLOR_TOKENS.filter(k => t[k]).map(k => `${k} ${t[k]}`).join(', ');
  const fonts = [...new Set(FONT_TOKENS.map(k => t[k]).filter(Boolean))].join('/');
  const bg = look.background?.length ? look.background.map(fillText).join(' | ') : 'plain';
  const skins = Object.entries(look.skins).map(([k, v]) => `${k} ${v!.name}`).join(', ');
  return `Colours: ${colors}. Fonts: ${fonts || 'theme'}. Background: ${bg}.${skins ? ` Skins: ${skins}.` : ''}`;
}

/**
 * What the person changed on the screen by hand since the patch was loaded
 * (newest last): the AI is told, so it keeps those choices unless asked.
 */
export function handEdits(entries: readonly Transaction[], doc: PatchDocument, catalog: Catalog): string[] {
  const start = entries.map(t => !!t.replaced).lastIndexOf(true) + 1;
  const things = new Map<string, Set<string>>();
  const note = (id: string, what: string) => { if (!things.has(id)) things.set(id, new Set()); things.get(id)!.add(what); };
  for (const tx of entries.slice(start)) {
    if (tx.author.kind !== 'human') continue;
    for (const op of tx.ops) {
      if (op.op === 'addElement') note(op.element.id, 'added it');
      else if (op.op === 'setElement') note(op.id, op.field === 'rect' ? 'place' : op.field);
      else if (op.op === 'addNode' && op.node.panel && isWidget({ ...doc, nodes: { ...doc.nodes, [op.node.id]: op.node } }, catalog, op.node.id)) note(op.node.id, 'added it');
      else if (op.op === 'setField' && ['panel', 'style', 'label'].includes(op.field) && isWidget(doc, catalog, op.node)) note(op.node, op.field === 'panel' ? 'place' : op.field);
      else if (op.op === 'setSize') note('the plugin', 'size');
      else if (op.op === 'setUi' && op.field === 'look') {
        const from = (op.from ?? { tokens: {}, skins: {} }) as Look, to = (op.to ?? { tokens: {}, skins: {} }) as Look;
        for (const k of new Set([...Object.keys(from.tokens), ...Object.keys(to.tokens)])) if (from.tokens[k as TokenName] !== to.tokens[k as TokenName]) note('the look', `${k} token`);
        if (JSON.stringify(from.background) !== JSON.stringify(to.background)) note('the look', 'background');
        for (const k of new Set([...Object.keys(from.skins), ...Object.keys(to.skins)])) if (JSON.stringify(from.skins[k as ControlKind]) !== JSON.stringify(to.skins[k as ControlKind])) note('the look', `${k} skin`);
        if (from.css !== to.css) note('the look', 'css');
      } else if (op.op === 'setUi' && op.field === 'brief') note('the design brief', 'text');
    }
  }
  return [...things].filter(([id]) => id.startsWith('the ') || doc.ui.elements[id] || doc.nodes[id]).map(([id, what]) => `${id} (${[...what].join(', ')})`);
}

/** Did the plugin screen change between two versions of the patch (its look, decorations, size, or a control on it)? */
export function screenChanged(before: PatchDocument, after: PatchDocument, catalog: Catalog): boolean {
  if ((before.ui !== after.ui || before.panel !== after.panel) && JSON.stringify([before.ui, before.panel]) !== JSON.stringify([after.ui, after.panel])) return true;
  const face = (doc: PatchDocument) => JSON.stringify(Object.values(doc.nodes).filter(n => n.panel && isWidget(doc, catalog, n.id)).map(n => [n.id, n.panel, n.style, n.label, n.config]));
  return face(before) !== face(after);
}

/** The colour tokens in effect (theme + look). */
export function effectiveColors(doc: PatchDocument): Record<ColorToken, string> {
  const base = THEME_TOKENS[doc.panel.theme] ?? THEME_TOKENS.graphite;
  return Object.fromEntries(COLOR_TOKENS.map(t => [t, doc.ui.look.tokens[t] ?? base[t]])) as Record<ColorToken, string>;
}
