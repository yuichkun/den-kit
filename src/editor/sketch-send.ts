// What goes with a request from the person's sketch (U8c): for each view with
// marks not sent yet, the marks in words (what each goes around, crosses or
// joins, from where the things are drawn) and a picture of them on the view;
// and, when the marks only go around things, those things, like a selection.
import { dataUrl } from '../ai/llm-workspace.ts';
import { markedThings, onlyPointing, patchTargets, pluginTargets, readMarks, sketchText, type Box, type Mark, type SentSketch, type SketchPart, type SketchView, type Target } from '../ai/sketch.ts';
import { patchSchematic, pluginPicture, type SketchPicture } from './sketch-picture.ts';
import type { KitSession } from './session.ts';

export interface TakenSketch {
  sketch: SentSketch;
  /** The things the marks go around, when that is all they do (they point, like a selection); null otherwise. */
  pointing: string[] | null;
  /** Everything the marks are about. */
  about: string[];
}

/** The things marks can be about on a view, with where they are. */
export function targetsOn(session: KitSession, view: SketchView): Target[] {
  const doc = session.doc.value;
  if (view === 'plugin') return pluginTargets(doc, type => session.catalog.find(type)?.kind === 'widget');
  const here = Object.values(doc.nodes).filter(n => n.inside === session.scope.value);
  // The patch view knows the boxes it draws; without it, where the modules sit (at their usual size).
  const boxes: Record<string, Box> = session.patchBoxes?.() ?? Object.fromEntries(here.map(n => [n.id, { x: n.pos.x, y: n.pos.y, w: 160, h: 100 }]));
  return patchTargets(here, boxes, type => session.catalog.find(type)?.title ?? type);
}

/** A picture of the marks on the view: the plugin re-drawn; the patch as the person sees it (shared screen) or drawn plainly. */
async function pictureOf(session: KitSession, view: SketchView, marks: readonly Mark[], targets: readonly Target[]): Promise<SketchPicture | null> {
  const doc = session.doc.value;
  if (view === 'plugin') {
    const look = await session.look({ picture: true });
    return pluginPicture(look, { width: doc.panel.width, height: doc.panel.height, background: '#1e1e1e' }, marks);
  }
  const rect = session.screen.source ? session.viewRect('patch') : null;
  if (rect) {
    try {
      const p = await session.screen.picture(rect, 1280);
      return { dataUrl: dataUrl(p.data, p.mime), width: p.width, height: p.height, how: p.source };
    } catch { /* drawn plainly instead */ }
  }
  const ids = new Set(targets.map(t => t.id));
  const cables = Object.values(doc.edges).filter(e => ids.has(e.from.node) && ids.has(e.to.node)).map(e => ({ from: e.from.node, to: e.to.node }));
  return patchSchematic(targets, cables, marks);
}

/** The sketch to send with a request now (null when there are no new marks). Pictures only when the model takes them. */
export async function takeSketch(session: KitSession, options: { pictures: boolean }): Promise<TakenSketch | null> {
  const parts: SketchPart[] = [];
  const ids: string[] = [];
  const about = new Set<string>();
  let pointing: Set<string> | null = new Set();
  for (const view of ['plugin', 'patch'] as const) {
    const marks = session.unsentMarks(view);
    if (!marks.length) continue;
    const targets = targetsOn(session, view);
    const readings = readMarks({ view, marks }, targets);
    let picture: SketchPicture | null = null;
    if (options.pictures) {
      try { picture = await pictureOf(session, view, marks, targets); }
      catch { picture = null; }
    }
    const doc = session.doc.value;
    const how = !picture ? false : picture.how === 'redrawn' ? 'the plugin re-drawn at its design size' : picture.how === 'schematic' ? 'the patch drawn plainly: modules as named boxes, cables as lines' : 'the patch as the person sees it';
    const text = sketchText({ view, marks }, readings, targets, view === 'plugin' ? { width: doc.panel.width, height: doc.panel.height } : undefined, how);
    parts.push({ view, marks: marks.length, text, ...(picture ? { image: picture.dataUrl } : {}) });
    ids.push(...marks.map(m => m.id));
    for (const id of markedThings(readings)) about.add(id);
    if (pointing && onlyPointing(readings)) for (const r of readings) for (const id of r.encloses) pointing.add(id);
    else pointing = null;
  }
  if (!parts.length) return null;
  return { sketch: { parts, ids }, pointing: pointing && pointing.size ? [...pointing] : null, about: [...about] };
}
