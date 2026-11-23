// Edits of the work's art from its view: each goes to the session as ordinary operations (the
// same ones the AI sends), labelled with the surface they change, so the history and the AI's
// note about the person's own edits say "on the cover" or "on the icon". A key makes the edits of
// one drag or one field (while it is being dragged or typed in) one undo step.
import type { KitSession } from '../session.ts';
import type { Intent } from '../../work/ops.ts';

export type ArtCommit = (intents: Intent[], label: string, key?: string) => boolean;

export function artCommitter(session: KitSession): ArtCommit {
  let gesture = { key: '', id: '', at: 0 };
  return (intents, label, key) => {
    if (!intents.length) return true;
    let g: string | undefined;
    if (key) {
      const now = performance.now();
      if (gesture.key !== key || now - gesture.at > 1500)
        gesture = { key, id: `art-${key}-${Date.now()}`, at: now };
      gesture.at = now;
      g = gesture.id;
    }
    const r = session.commit(intents, { label, gesture: g });
    if (!r.ok) session.toast('warn', `${r.error.message}${r.error.hint ? ` ${r.error.hint}` : ''}`);
    return r.ok;
  };
}
