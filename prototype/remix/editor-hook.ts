// The editor's side of the passing-on prototype. On den-kit's development host
// with ?remix and a passage after #p= in the address (dev/page.ts), it opens the
// version the person received, with the changes they made on the passage page,
// in place of the open work (one step that Undo takes back), and shows a panel:
// what they changed since, and the way back to the passage page with those
// changes as den-kit's operations on the version they received.
import { createApp, h } from 'vue';
import type { KitSession } from '../../src/editor/session.ts';
import { findWork } from '../../src/screen/showcase/index.ts';
import type { PatchDocument } from '../../src/work/schema.ts';
import EditorPanel from './EditorPanel.vue';
import { allowsInside } from './mock-store.ts';
import {
  applyChanges,
  buildVersions,
  decodePassage,
  passageText,
  type Passage,
} from './passage.ts';

/** The history step that opens the passed-on work: what the person changes comes after it. */
export const RECEIVED = 'Open a passed-on work';

export async function mountRemix(session: KitSession) {
  let problem = '';
  let passage: Passage | null = null;
  let received: PatchDocument | null = null;
  let receipt = '';
  const read = await decodePassage(passageText(location.hash));
  if (!read.ok) problem = read.error;
  else {
    const built = buildVersions(read.value, session.catalog);
    if (!built.ok) problem = built.error;
    else if (!allowsInside(read.value))
      problem = `${read.value.author.name} keeps the inside of this work as it is: its settings and phrases can still be passed on.`;
    else {
      passage = read.value;
      received = built.value.at(-1)!.doc;
      try {
        session.replace(applyChanges(received, passage.draft ?? [], session.catalog), RECEIVED);
        receipt = session.history.peek()?.id ?? '';
      } catch (error) {
        problem = `Your changes cannot be applied: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }
  const title = passage ? (findWork(passage.work)?.title ?? '') : '';
  const host = document.createElement('div');
  document.body.append(host);
  createApp({
    render: () => h(EditorPanel, { session, passage, received, receipt, problem, title }),
  }).mount(host);
}
