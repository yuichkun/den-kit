// What the prototype's views share: one den-kit session that plays the version a
// person hears (compiled and played as in the editor, but saving nothing and
// using no workspace), and the addresses of the page and of den-kit's editor.
import { KitSession } from '../../src/editor/session.ts';
import { encodePassage, type Passage } from './passage.ts';

/** Plays one version at a time; nothing it holds is saved. */
export const kit = new KitSession({ storage: null, host: null });

/** This page's address for a passage. */
export async function passageLink(passage: Passage): Promise<string> {
  return `${location.origin}/prototype/remix/#p=${await encodePassage(passage)}`;
}

/** den-kit's editor on the development server, opening a passage to change its inside. */
export async function editorLink(passage: Passage): Promise<string> {
  return `${location.origin}/?remix&noStart#p=${await encodePassage(passage)}`;
}

export const when = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
