// Playing the plugin: a control moved on the plugin (by hand, or by a canvas or
// code part, which is then its author) becomes a commit like any other edit. One
// drag, one press on a canvas, is one gesture, so one ⌘Z takes it back.
import type { KitSession } from './session.ts';

export function controlWriter(session: KitSession) {
  const gestures = new Map<string, string>();
  return (
    id: string,
    values: Record<string, number | boolean>,
    end: boolean,
    gesture?: string,
    by?: string,
  ) => {
    const n = session.doc.value.nodes[id];
    if (!n) return;
    // A canvas names its gesture (one press may move several controls); a widget's gesture is its own.
    const key = gesture ?? gestures.get(id) ?? `panel-${id}-${Date.now()}`;
    if (!gesture) gestures.set(id, key);
    const r = session.commit(
      Object.entries(values).map(([port, value]) => ({
        op: 'setValue' as const,
        node: id,
        port,
        value,
        clamp: true,
      })),
      {
        gesture: key,
        label: `Panel ${n.label ?? n.id}`,
        author: by ? { kind: 'part', element: by } : undefined,
      },
    );
    if (!r.ok) session.toast('warn', r.error.message);
    if (end && !gesture) gestures.delete(id);
  };
}
