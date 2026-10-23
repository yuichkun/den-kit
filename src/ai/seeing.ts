// What the person is looking at (U8b): which view, the plugin's mode, the
// patch view's zoom and the modules in sight, what is selected, the notes held.
// Every LLM request carries one short line of it, so "this", "here" and "what
// I see" mean the same to the AI as to the person; with screen sharing on, the
// AI can also see it as a picture (kit_look as "seen").
import type { Catalog } from '../work/catalog.ts';
import type { PatchDocument } from '../work/schema.ts';

export type SeenView = 'patch' | 'plugin' | 'code' | 'project';
export interface Seeing {
  view: SeenView;
  /** The plugin is being edited (not played). */
  edit: boolean;
  /** The plugin fills the screen. */
  full: boolean;
  /** The patch view's zoom, and the modules in sight (ids). */
  zoom?: number;
  inView?: string[];
  /** The plugin's scale on screen (1 = its design size). */
  scale?: number;
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
/** MIDI note 60 → "C4". */
export const noteName = (midi: number) =>
  `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

const named = (doc: PatchDocument, catalog: Catalog, id: string) => {
  const n = doc.nodes[id];
  if (n) return `${id} “${n.label ?? catalog.find(n.type)?.title ?? n.type}”`;
  const el = doc.ui.elements[id] as { kind: string; text?: string } | undefined;
  return el
    ? `${id} (${el.kind}${typeof el.text === 'string' ? ` “${el.text.slice(0, 24)}”` : ''})`
    : id;
};

/** One line for the LLM: what the person is looking at right now. */
export function seeingText(
  s: Seeing,
  doc: PatchDocument,
  catalog: Catalog,
  extra: {
    selection: readonly string[];
    held: readonly number[];
    inside?: string;
    shared: boolean;
  },
): string {
  const parts: string[] = [];
  if (s.view === 'plugin')
    parts.push(
      `the plugin, ${s.edit ? 'editing it' : 'playing it'}${s.full ? ' (full screen)' : ''}${s.scale ? ` at ${Math.round(s.scale * 100)}% of its design size` : ''}`,
    );
  else if (s.view === 'patch') {
    const where = extra.inside ? ` inside part ${extra.inside}` : '';
    const sight = s.inView
      ? s.inView.length
        ? `; in sight: ${s.inView.slice(0, 12).join(', ')}${s.inView.length > 12 ? ` and ${s.inView.length - 12} more` : ''}`
        : '; no module in sight'
      : '';
    parts.push(`the patch${where}${s.zoom ? ` (zoom ${Math.round(s.zoom * 100)}%${sight})` : ''}`);
  } else if (s.view === 'code') parts.push('the generated code');
  else parts.push('the screen project (files and terminal)');
  if (extra.selection.length)
    parts.push(
      `selected: ${extra.selection
        .slice(0, 8)
        .map(id => named(doc, catalog, id))
        .join(', ')}${extra.selection.length > 8 ? ` and ${extra.selection.length - 8} more` : ''}`,
    );
  if (extra.held.length) parts.push(`holding ${extra.held.slice(0, 8).map(noteName).join(' ')}`);
  parts.push(
    extra.shared
      ? 'they let you see their screen (kit_look with as "seen" shows it as they see it)'
      : 'their screen is not shared with you',
  );
  return `The person is looking at ${parts.join('; ')}.`;
}

/** Where a part of the page lies in a captured frame of the tab (which may be scaled), and the picture's size (at most maxSide). */
export function cropRect(
  frame: { width: number; height: number },
  viewport: { width: number; height: number },
  rect: { x: number; y: number; width: number; height: number },
  maxSide = 1280,
) {
  const kx = frame.width / Math.max(1, viewport.width),
    ky = frame.height / Math.max(1, viewport.height);
  const x0 = Math.max(0, Math.min(frame.width, rect.x * kx)),
    y0 = Math.max(0, Math.min(frame.height, rect.y * ky));
  const x1 = Math.max(x0, Math.min(frame.width, (rect.x + rect.width) * kx)),
    y1 = Math.max(y0, Math.min(frame.height, (rect.y + rect.height) * ky));
  const sw = Math.max(1, Math.round(x1 - x0)),
    sh = Math.max(1, Math.round(y1 - y0));
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  return {
    sx: Math.round(x0),
    sy: Math.round(y0),
    sw,
    sh,
    dw: Math.max(1, Math.round(sw * k)),
    dh: Math.max(1, Math.round(sh * k)),
  };
}
