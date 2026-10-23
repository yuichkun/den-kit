// What an agent working on a request may change. A sub-agent (an agent the
// request's AI started for part of it) claims a scope — the sound (the patch,
// or parts or modules of it), the screen (the plugin, or elements or an area of
// it), the screen project in the pod — and den-kit holds it to that scope on
// every edit: an edit is tried on a copy, the copy is compared with the live
// patch object by object, and anything outside the scope refuses the whole
// edit. While a sub-agent works, no other agent changes what it holds. The
// controls and their cables that existed when it claimed its scope are the
// seam: it keeps them (it places, styles and sets them, but does not remove or
// rewire them).
import { textFiles } from '../work/files.ts';
import { assetsOf } from '../work/ui.ts';
import type { Catalog } from '../work/catalog.ts';
import type { PatchDocument, PatchNode } from '../work/schema.ts';
import type { Rect } from '../work/ui.ts';

export interface Scope {
  sound?: 'all' | { parts?: string[]; nodes?: string[] };
  screen?: 'all' | { elements?: string[]; area?: Rect };
  project?: 'all';
}
/** What a sub-agent must keep: the controls (widget modules) and their cables when it claimed its scope. */
export interface Seam {
  controls: ReadonlySet<string>;
  cables: ReadonlySet<string>;
}
/** A sub-agent's hold: its scope, what it made itself (always its own), the seam. */
export interface Holding {
  scope: Scope;
  owned: ReadonlySet<string>;
  seam: Seam;
}

const MAX_LIST = 64;
const ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const ids = (value: unknown): string[] | null =>
  Array.isArray(value) &&
  value.length <= MAX_LIST &&
  value.every(v => typeof v === 'string' && ID.test(v))
    ? [...new Set(value as string[])]
    : null;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The scope as the agent wrote it, checked against the patch (unknown ids are refused, so a typo cannot hold nothing). */
export function parseScope(
  value: unknown,
  doc: PatchDocument,
): { scope: Scope } | { error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { error: 'scope must be an object with "sound", "screen" and/or "project".' };
  const v = value as Record<string, unknown>;
  const unknown = Object.keys(v).filter(k => !['sound', 'screen', 'project'].includes(k));
  if (unknown.length)
    return {
      error: `scope has unknown keys: ${unknown.join(', ')} (use "sound", "screen", "project").`,
    };
  const scope: Scope = {};
  if (v.sound !== undefined) {
    if (v.sound === 'all') scope.sound = 'all';
    else if (v.sound && typeof v.sound === 'object' && !Array.isArray(v.sound)) {
      const s = v.sound as Record<string, unknown>;
      const parts = s.parts === undefined ? undefined : ids(s.parts);
      const nodes = s.nodes === undefined ? undefined : ids(s.nodes);
      if (parts === null || nodes === null || (!parts?.length && !nodes?.length))
        return { error: 'scope.sound is "all", {"parts":[ids]} or {"nodes":[ids]}.' };
      const missingParts = (parts ?? []).filter(p => !doc.parts[p]);
      if (missingParts.length)
        return {
          error: `scope.sound names parts that do not exist: ${missingParts.join(', ')}. Parts: ${Object.keys(doc.parts).join(', ') || 'none'}.`,
        };
      const missingNodes = (nodes ?? []).filter(n => !doc.nodes[n]);
      if (missingNodes.length)
        return {
          error: `scope.sound names modules that do not exist: ${missingNodes.join(', ')}.`,
        };
      scope.sound = { ...(parts?.length ? { parts } : {}), ...(nodes?.length ? { nodes } : {}) };
    } else return { error: 'scope.sound is "all", {"parts":[ids]} or {"nodes":[ids]}.' };
  }
  if (v.screen !== undefined) {
    if (v.screen === 'all') scope.screen = 'all';
    else if (v.screen && typeof v.screen === 'object' && !Array.isArray(v.screen)) {
      const s = v.screen as Record<string, unknown>;
      const elements = s.elements === undefined ? undefined : ids(s.elements);
      let area: Rect | undefined;
      if (s.area !== undefined) {
        const a = s.area as Record<string, unknown> | null;
        if (
          !a ||
          !finite(a.x) ||
          !finite(a.y) ||
          !finite(a.w) ||
          !finite(a.h) ||
          a.w <= 0 ||
          a.h <= 0
        )
          return {
            error: 'scope.screen.area is {"x","y","w","h"} in the plugin\'s design pixels.',
          };
        area = { x: a.x, y: a.y, w: a.w, h: a.h };
      }
      if (elements === null || (!elements?.length && !area))
        return { error: 'scope.screen is "all", {"elements":[ids]} or {"area":{x,y,w,h}}.' };
      const missing = (elements ?? []).filter(
        e => !doc.ui.elements[e] && !doc.nodes[e]?.panel && !doc.ui.groups[e],
      );
      if (missing.length)
        return {
          error: `scope.screen names things that are not on the plugin: ${missing.join(', ')}.`,
        };
      // A group stands for its members.
      const expanded = (elements ?? []).flatMap(e =>
        doc.ui.groups[e] ? [e, ...doc.ui.groups[e]!] : [e],
      );
      scope.screen = {
        ...(expanded.length ? { elements: [...new Set(expanded)] } : {}),
        ...(area ? { area } : {}),
      };
    } else return { error: 'scope.screen is "all", {"elements":[ids]} or {"area":{x,y,w,h}}.' };
  }
  if (v.project !== undefined) {
    if (v.project !== 'all')
      return { error: 'scope.project is "all" (the whole screen project) or left out.' };
    scope.project = 'all';
  }
  if (!scope.sound && !scope.screen && !scope.project)
    return { error: 'scope is empty: give "sound", "screen" and/or "project".' };
  return { scope };
}

const rectText = (r: Rect) =>
  `x ${Math.round(r.x)}, y ${Math.round(r.y)}, ${Math.round(r.w)}×${Math.round(r.h)}`;
/** The scope in words (for the agents and the person). */
export function describeScope(scope: Scope): string {
  const parts: string[] = [];
  if (scope.sound === 'all') parts.push('the sound (the whole patch)');
  else if (scope.sound)
    parts.push(
      `the sound of ${[scope.sound.parts?.length ? `part${scope.sound.parts.length > 1 ? 's' : ''} ${scope.sound.parts.join(', ')}` : '', scope.sound.nodes?.length ? `module${scope.sound.nodes.length > 1 ? 's' : ''} ${scope.sound.nodes.join(', ')}` : ''].filter(Boolean).join(' and ')} (and what it adds)`,
    );
  if (scope.screen === 'all')
    parts.push(
      "the plugin screen (look, brief, size, every control's place and style, decorations)",
    );
  else if (scope.screen)
    parts.push(
      `on the plugin screen ${[scope.screen.elements?.length ? scope.screen.elements.join(', ') : '', scope.screen.area ? `the area ${rectText(scope.screen.area)}` : ''].filter(Boolean).join(' and ')} (and what it adds there)`,
    );
  if (scope.project) parts.push('the screen project in the pod');
  return parts.join('; ');
}
/** A few words for the person (the lane under the request). */
export function shortScope(scope: Scope): string {
  return [
    scope.sound ? (scope.sound === 'all' ? 'sound' : 'part of the sound') : '',
    scope.screen ? (scope.screen === 'all' ? 'screen' : 'part of the screen') : '',
    scope.project ? 'project' : '',
  ]
    .filter(Boolean)
    .join(' + ');
}

const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const within = (r: Rect, area: Rect) =>
  r.x >= area.x - 0.5 &&
  r.y >= area.y - 0.5 &&
  r.x + r.w <= area.x + area.w + 0.5 &&
  r.y + r.h <= area.y + area.h + 0.5;
const rectOf = (doc: PatchDocument, id: string): Rect | undefined =>
  doc.ui.elements[id]?.rect ?? doc.nodes[id]?.panel;

/** Why two scopes cannot be held at once (null: they can). */
export function scopesOverlap(a: Scope, b: Scope, doc: PatchDocument): string | null {
  if (a.project && b.project) return 'both hold the screen project (one holder at a time)';
  if (a.sound && b.sound) {
    if (a.sound === 'all' || b.sound === 'all') return 'both hold the sound';
    const nodesOf = (s: { parts?: string[]; nodes?: string[] }) =>
      new Set([
        ...(s.nodes ?? []),
        ...Object.values(doc.nodes)
          .filter(
            n =>
              (n.inside && s.parts?.includes(n.inside)) ||
              (n.type === 'kit.part' && n.part && s.parts?.includes(n.part)),
          )
          .map(n => n.id),
      ]);
    const shared = [...nodesOf(a.sound)].filter(id =>
      nodesOf(b.sound as { parts?: string[]; nodes?: string[] }).has(id),
    );
    const sharedParts = (a.sound.parts ?? []).filter(p =>
      (b.sound as { parts?: string[] }).parts?.includes(p),
    );
    if (sharedParts.length) return `both hold part ${sharedParts.join(', ')}`;
    if (shared.length) return `both hold ${shared.slice(0, 6).join(', ')}`;
  }
  if (a.screen && b.screen) {
    if (a.screen === 'all' || b.screen === 'all') return 'both hold the screen';
    const sa = a.screen,
      sb = b.screen;
    const shared = (sa.elements ?? []).filter(e => sb.elements?.includes(e));
    if (shared.length) return `both hold ${shared.slice(0, 6).join(', ')}`;
    if (sa.area && sb.area && intersects(sa.area, sb.area)) return 'their screen areas overlap';
    const inArea = (list: string[] | undefined, area: Rect | undefined) =>
      area
        ? (list ?? []).filter(id => {
            const r = rectOf(doc, id);
            return r && intersects(r, area);
          })
        : [];
    const crossing = [...inArea(sa.elements, sb.area), ...inArea(sb.elements, sa.area)];
    if (crossing.length) return `${crossing.slice(0, 6).join(', ')} lies in the other's area`;
  }
  return null;
}

/** The controls and their cables now: what sub-agents keep while they work. */
export function seamOf(doc: PatchDocument, catalog: Catalog): Seam {
  const controls = new Set(
    Object.values(doc.nodes)
      .filter(n => catalog.find(n.type)?.kind === 'widget')
      .map(n => n.id),
  );
  const cables = new Set(
    Object.values(doc.edges)
      .filter(e => controls.has(e.from.node))
      .map(e => e.id),
  );
  return { controls, cables };
}

// ---- what changed ---------------------------------------------------------------------------
export type Change =
  | {
      kind: 'node';
      id: string;
      op: 'add' | 'remove' | 'change';
      fields: string[];
      widget: boolean;
      node: PatchNode;
      rect?: Rect;
      rectBefore?: Rect;
    }
  | { kind: 'edge'; id: string; op: 'add' | 'remove'; from: string; to: string }
  | { kind: 'part'; id: string; op: 'add' | 'remove' | 'change' }
  | { kind: 'element'; id: string; op: 'add' | 'remove' | 'change'; rect?: Rect; rectBefore?: Rect }
  /** The stacking order moved: `ids` explains it, or `alt` does (moving A in front of B is also moving B behind A). */
  | { kind: 'order'; ids: string[]; alt?: string[] }
  | { kind: 'group'; id: string; members: string[] }
  | { kind: 'ui'; field: 'look' | 'brief' | 'underlay' | 'size' | 'theme' | 'network' }
  | { kind: 'assets'; ids: string[] }
  | { kind: 'project'; paths: string[] }
  | { kind: 'name' };

const NODE_FIELDS = [
  'type',
  'label',
  'pos',
  'config',
  'values',
  'panel',
  'code',
  'ports',
  'text',
  'style',
  'inside',
  'part',
  'iface',
  'count',
  'spread',
] as const;
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Ids whose place in the stacking order moved: the fewest that explain the new order, kept from the back and from the front. */
function moved(before: string[], after: string[]): string[][] {
  const both = new Set(before.filter(id => after.includes(id)));
  const a = before.filter(id => both.has(id)),
    b = after.filter(id => both.has(id));
  if (same(a, b)) return [];
  const fwd = keptOrder(a, b),
    back = keptOrder([...a].reverse(), [...b].reverse());
  return same([...fwd].sort(), [...back].sort()) ? [fwd] : [fwd, back];
}
function keptOrder(a: string[], b: string[]): string[] {
  // The longest run of ids that kept their relative order stays; the rest moved.
  const rank = new Map(a.map((id, i) => [id, i]));
  const seq = b.map(id => rank.get(id)!);
  const tails: number[] = [],
    prev: number[] = new Array(seq.length).fill(-1),
    at: number[] = [];
  seq.forEach((v, i) => {
    let lo = 0,
      hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[at[mid]!]! < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = at[lo - 1]!;
    tails[lo] = v;
    at[lo] = i;
  });
  const kept = new Set<number>();
  for (let i = at[tails.length - 1] ?? -1; i >= 0; i = prev[i]!) kept.add(i);
  return b.filter((_, i) => !kept.has(i));
}

/** What `after` changed of `before`, object by object. */
export function changes(before: PatchDocument, after: PatchDocument, catalog: Catalog): Change[] {
  const out: Change[] = [];
  const widget = (n: PatchNode) => catalog.find(n.type)?.kind === 'widget';
  for (const id of new Set([...Object.keys(before.nodes), ...Object.keys(after.nodes)])) {
    const a = before.nodes[id],
      b = after.nodes[id];
    if (!a && b)
      out.push({
        kind: 'node',
        id,
        op: 'add',
        fields: [],
        widget: widget(b),
        node: b,
        rect: b.panel,
      });
    else if (a && !b)
      out.push({
        kind: 'node',
        id,
        op: 'remove',
        fields: [],
        widget: widget(a),
        node: a,
        rectBefore: a.panel,
      });
    else if (a && b) {
      const fields = NODE_FIELDS.filter(f => !same(a[f], b[f]));
      if (fields.length)
        out.push({
          kind: 'node',
          id,
          op: 'change',
          fields,
          widget: widget(b),
          node: b,
          rect: b.panel,
          rectBefore: a.panel,
        });
    }
  }
  for (const id of new Set([...Object.keys(before.edges), ...Object.keys(after.edges)])) {
    const a = before.edges[id],
      b = after.edges[id];
    if (a && b && same(a, b)) continue;
    if (a) out.push({ kind: 'edge', id, op: 'remove', from: a.from.node, to: a.to.node });
    if (b) out.push({ kind: 'edge', id, op: 'add', from: b.from.node, to: b.to.node });
  }
  for (const id of new Set([...Object.keys(before.parts), ...Object.keys(after.parts)])) {
    const a = before.parts[id],
      b = after.parts[id];
    if (!a && b) out.push({ kind: 'part', id, op: 'add' });
    else if (a && !b) out.push({ kind: 'part', id, op: 'remove' });
    else if (!same(a, b)) out.push({ kind: 'part', id, op: 'change' });
  }
  for (const id of new Set([
    ...Object.keys(before.ui.elements),
    ...Object.keys(after.ui.elements),
  ])) {
    const a = before.ui.elements[id],
      b = after.ui.elements[id];
    if (!a && b) out.push({ kind: 'element', id, op: 'add', rect: b.rect });
    else if (a && !b) out.push({ kind: 'element', id, op: 'remove', rectBefore: a.rect });
    else if (a && b && !same(a, b))
      out.push({ kind: 'element', id, op: 'change', rect: b.rect, rectBefore: a.rect });
  }
  const [reordered, alt] = moved(before.ui.order, after.ui.order);
  if (reordered) out.push({ kind: 'order', ids: reordered, ...(alt ? { alt } : {}) });
  for (const id of new Set([...Object.keys(before.ui.groups), ...Object.keys(after.ui.groups)])) {
    const a = before.ui.groups[id] ?? [],
      b = after.ui.groups[id] ?? [];
    if (!same(a, b)) out.push({ kind: 'group', id, members: [...new Set([...a, ...b])] });
  }
  if (!same(before.ui.look, after.ui.look)) out.push({ kind: 'ui', field: 'look' });
  if (!same(before.ui.brief, after.ui.brief)) out.push({ kind: 'ui', field: 'brief' });
  if (!same(before.ui.network, after.ui.network)) out.push({ kind: 'ui', field: 'network' });
  if (!same(before.ui.underlay, after.ui.underlay)) out.push({ kind: 'ui', field: 'underlay' });
  if (before.panel.width !== after.panel.width || before.panel.height !== after.panel.height)
    out.push({ kind: 'ui', field: 'size' });
  if (before.panel.theme !== after.panel.theme) out.push({ kind: 'ui', field: 'theme' });
  const assets = Object.keys(assetsOf(after.files))
    .filter(id => !same(assetsOf(before.files)[id], assetsOf(after.files)[id]))
    .concat(Object.keys(assetsOf(before.files)).filter(id => !assetsOf(after.files)[id]));
  if (assets.length) out.push({ kind: 'assets', ids: assets });
  const fa = textFiles(before.files),
    fb = textFiles(after.files);
  const paths = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].filter(p => fa[p] !== fb[p]);
  if (paths.length) out.push({ kind: 'project', paths });
  if (before.name !== after.name) out.push({ kind: 'name' });
  return out;
}

// ---- who may change what ---------------------------------------------------------------------
interface Ctx {
  before: PatchDocument;
  after: PatchDocument;
  holding: Holding;
}
const nodeOf = (c: Ctx, id: string) => c.after.nodes[id] ?? c.before.nodes[id];
const isWidget = (c: Ctx, id: string, catalog: Catalog) => {
  const n = nodeOf(c, id);
  return !!n && catalog.find(n.type)?.kind === 'widget';
};

/** The module is in the holder's sound: the whole patch (not controls), or its parts and modules, or it made it. */
function soundHolds(c: Ctx, id: string, catalog: Catalog): boolean {
  const s = c.holding.scope.sound;
  if (!s) return false;
  if (c.holding.owned.has(id)) return true;
  const n = nodeOf(c, id);
  if (!n) return false;
  if (s === 'all') return !isWidget(c, id, catalog);
  return !!(
    s.nodes?.includes(id) ||
    (n.inside && s.parts?.includes(n.inside)) ||
    (n.type === 'kit.part' && n.part && s.parts?.includes(n.part))
  );
}
/** The control or decoration is in the holder's screen: the whole screen, its listed things, its area, or it made it. */
function screenHolds(c: Ctx, id: string, rects: Array<Rect | undefined>): boolean {
  const s = c.holding.scope.screen;
  if (!s) return false;
  if (s === 'all' || c.holding.owned.has(id) || s.elements?.includes(id)) return true;
  const known = rects.filter((r): r is Rect => !!r);
  return !!s.area && known.length > 0 && known.every(r => within(r, s.area!));
}

const named = (doc: PatchDocument, id: string) => {
  const n = doc.nodes[id];
  return n?.label ? `${id} “${n.label}”` : id;
};

/** Why `holding` may not make this change (null: it may). */
function refusal(change: Change, c: Ctx, catalog: Catalog): string | null {
  const { scope, seam } = c.holding;
  switch (change.kind) {
    case 'node': {
      const id = change.id;
      if (change.widget) {
        if (change.op === 'add')
          return scope.screen &&
            (scope.screen === 'all' ||
              scope.screen.elements ||
              !change.rect ||
              within(change.rect, scope.screen.area!))
            ? null
            : `adding control ${id} needs the screen (or an area it lies in)`;
        if (change.op === 'remove')
          return seam.controls.has(id)
            ? `${named(c.before, id)} is a control the others rely on (only the agent the person asked removes it)`
            : screenHolds(c, id, [change.rectBefore])
              ? null
              : `${named(c.before, id)} is outside your screen`;
        for (const f of change.fields) {
          if (f === 'pos') continue;
          if (
            f === 'values' &&
            (scope.sound || screenHolds(c, id, [change.rect, change.rectBefore]))
          )
            continue;
          if (!screenHolds(c, id, [change.rect, change.rectBefore]))
            return `${named(c.after, id)}'s ${f === 'panel' ? 'place on the plugin' : f} is outside your scope`;
        }
        return null;
      }
      if (change.op === 'add') {
        const s = scope.sound;
        const n = change.node;
        const ok =
          s === 'all' ||
          (!!s &&
            (!!s.nodes ||
              (!!n.inside && !!s.parts?.includes(n.inside)) ||
              (n.type === 'kit.part' && !!n.part && !!s.parts?.includes(n.part))));
        return ok
          ? null
          : `adding module ${id}${n.inside ? ` inside part ${n.inside}` : ''} is outside your scope`;
      }
      if (change.op === 'change' && change.fields.every(f => f === 'pos')) return null; // moving modules around the patch view is free
      return soundHolds(c, id, catalog)
        ? null
        : `${named(change.op === 'remove' ? c.before : c.after, id)} is outside your scope`;
    }
    case 'edge': {
      const fromWidget = isWidget(c, change.from, catalog);
      if (change.op === 'remove' && seam.cables.has(change.id))
        return `the cable ${change.from} → ${change.to} carries a control the others rely on (only the agent the person asked rewires it)`;
      const target = soundHolds(c, change.to, catalog);
      const source = soundHolds(c, change.from, catalog);
      const control =
        fromWidget &&
        (c.holding.owned.has(change.from) ||
          screenHolds(c, change.from, [
            rectOf(c.after, change.from) ?? rectOf(c.before, change.from),
          ]));
      if (change.op === 'add')
        return target || control ? null : `a cable into ${change.to} is outside your scope`;
      return target || source || control
        ? null
        : `the cable ${change.from} → ${change.to} is outside your scope`;
    }
    case 'part': {
      const s = scope.sound;
      if (!s) return `part ${change.id} is the sound's`;
      if (
        change.op === 'add' ||
        s === 'all' ||
        c.holding.owned.has(change.id) ||
        s.parts?.includes(change.id)
      )
        return null;
      return `part ${change.id} is outside your scope`;
    }
    case 'element': {
      const s = scope.screen;
      if (change.op === 'add')
        return s && (s === 'all' || s.elements || within(change.rect!, s.area!))
          ? null
          : `adding ${change.id} there is outside your screen`;
      return screenHolds(c, change.id, [change.rect, change.rectBefore])
        ? null
        : `${change.id} is outside your screen`;
    }
    case 'order': {
      const outsideOf = (list: string[]) =>
        list.filter(id => !screenHolds(c, id, [rectOf(c.after, id), rectOf(c.before, id)]));
      const outside = outsideOf(change.ids);
      if (!outside.length || (change.alt && !outsideOf(change.alt).length)) return null;
      return `moving ${outside.slice(0, 4).join(', ')} in front or behind is outside your screen`;
    }
    case 'group': {
      if (c.holding.owned.has(change.id)) return null;
      const outside = change.members.filter(
        id => !screenHolds(c, id, [rectOf(c.after, id), rectOf(c.before, id)]),
      );
      return outside.length
        ? `group ${change.id} has ${outside.slice(0, 4).join(', ')} outside your screen`
        : null;
    }
    case 'ui':
      // The origins the code parts need go with the screen project as well as with the whole screen.
      if (change.field === 'network' && scope.project) return null;
      return scope.screen === 'all'
        ? null
        : `the ${change.field === 'size' ? 'plugin size' : change.field} belongs to the whole screen`;
    case 'assets':
      return scope.screen || scope.sound ? null : 'adding pictures needs the screen';
    case 'project':
      return scope.project ? null : 'the screen project is held by someone else';
    case 'name':
      return null;
  }
}

/** The changes from `before` to `after` that a sub-agent holding `holding` may not make, in words (empty: allowed). */
export function outside(
  before: PatchDocument,
  after: PatchDocument,
  catalog: Catalog,
  holding: Holding,
  list = changes(before, after, catalog),
): string[] {
  const c: Ctx = { before, after, holding };
  const reasons = list.map(change => refusal(change, c, catalog)).filter((r): r is string => !!r);
  return [...new Set(reasons)];
}

/** Changes everyone may make while sub-agents work: moving modules in the patch view, control values, the name, pictures. */
function shared(change: Change): boolean {
  if (change.kind === 'name' || change.kind === 'assets') return true;
  if (change.kind === 'node' && change.op === 'change')
    return change.fields.every(f => f === 'pos' || (f === 'values' && change.widget));
  return false;
}
/** Whether this change touches what a sub-agent holds (what no other agent may change meanwhile). */
function claimed(change: Change, c: Ctx, catalog: Catalog): boolean {
  if (shared(change)) return false;
  const { scope } = c.holding;
  switch (change.kind) {
    case 'node':
      if (change.op === 'add') {
        if (change.widget)
          return (
            scope.screen === 'all' ||
            (!!scope.screen &&
              typeof scope.screen === 'object' &&
              !!scope.screen.area &&
              !!change.rect &&
              intersects(change.rect, scope.screen.area))
          );
        const n = change.node;
        return (
          scope.sound === 'all' ||
          (!!scope.sound &&
            typeof scope.sound === 'object' &&
            ((!!n.inside && !!scope.sound.parts?.includes(n.inside)) ||
              (n.type === 'kit.part' && !!n.part && !!scope.sound.parts?.includes(n.part))))
        );
      }
      if (!change.widget) return soundHolds(c, change.id, catalog);
      if (change.op === 'remove') return screenHolds(c, change.id, [change.rectBefore]);
      return (
        screenHolds(c, change.id, [change.rect, change.rectBefore]) &&
        !change.fields.every(f => f === 'values' || f === 'pos')
      );
    case 'edge':
      return (
        soundHolds(c, change.to, catalog) ||
        (change.op === 'remove' && soundHolds(c, change.from, catalog))
      );
    case 'part':
      return (
        scope.sound === 'all' ||
        c.holding.owned.has(change.id) ||
        (!!scope.sound &&
          typeof scope.sound === 'object' &&
          !!scope.sound.parts?.includes(change.id))
      );
    case 'element':
      if (change.op === 'add')
        return (
          scope.screen === 'all' ||
          (!!scope.screen &&
            typeof scope.screen === 'object' &&
            !!scope.screen.area &&
            intersects(change.rect!, scope.screen.area))
        );
      return screenHolds(c, change.id, [change.rect, change.rectBefore]);
    case 'order': {
      const held = (list: string[]) =>
        list.some(id => screenHolds(c, id, [rectOf(c.after, id), rectOf(c.before, id)]));
      return held(change.ids) && (!change.alt || held(change.alt));
    }
    case 'group':
      return (
        c.holding.owned.has(change.id) ||
        change.members.some(id => screenHolds(c, id, [rectOf(c.after, id), rectOf(c.before, id)]))
      );
    case 'ui':
      return scope.screen === 'all' || (change.field === 'network' && !!scope.project);
    case 'project':
      return !!scope.project;
    default:
      return false;
  }
}

/** What an agent may not change while these other agents hold their scopes, in words (empty: allowed). */
export function heldByOthers(
  before: PatchDocument,
  after: PatchDocument,
  catalog: Catalog,
  others: ReadonlyArray<{ name: string; holding: Holding }>,
  list = changes(before, after, catalog),
): string[] {
  const reasons: string[] = [];
  for (const change of list) {
    for (const m of others) {
      if (claimed(change, { before, after, holding: m.holding }, catalog)) {
        reasons.push(`${describeChange(change)} is held by “${m.name}” while it works`);
        break;
      }
    }
  }
  return [...new Set(reasons)];
}

/** The ids a change made (they become the maker's own). */
export function made(list: readonly Change[]): string[] {
  return list.flatMap(c =>
    (c.kind === 'node' || c.kind === 'element' || c.kind === 'part') && c.op === 'add'
      ? [c.id]
      : c.kind === 'group'
        ? [c.id]
        : [],
  );
}
/** The ids a change touched (the person sees who works where). */
export function touched(list: readonly Change[]): string[] {
  return [
    ...new Set(
      list.flatMap(c =>
        c.kind === 'node' || c.kind === 'element'
          ? [c.id]
          : c.kind === 'edge'
            ? [c.to]
            : c.kind === 'order'
              ? c.ids
              : c.kind === 'group'
                ? c.members
                : [],
      ),
    ),
  ];
}

function describeChange(c: Change): string {
  switch (c.kind) {
    case 'node':
      return c.op === 'add' ? `adding ${c.id}` : c.op === 'remove' ? `removing ${c.id}` : `${c.id}`;
    case 'edge':
      return `the cable into ${c.to}`;
    case 'part':
      return `part ${c.id}`;
    case 'element':
      return c.op === 'add' ? `adding ${c.id}` : `${c.id}`;
    case 'order':
      return 'the stacking order';
    case 'group':
      return `group ${c.id}`;
    case 'ui':
      return `the ${c.field === 'size' ? 'plugin size' : c.field}`;
    case 'assets':
      return 'pictures';
    case 'project':
      return 'the screen project';
    case 'name':
      return 'the name';
  }
}
