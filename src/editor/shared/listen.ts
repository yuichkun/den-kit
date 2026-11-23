// The Shared prototype: hearing a sent-back setting in the author's own work. Its values go in as
// one edit, labeled with the setting's name, which ⌘Z takes back.
import { ref } from 'vue';
import { useSession } from '../context.ts';
import { settingIntents, type Returned } from './after-sharing.ts';

export function useListen() {
  const session = useSession();
  /** The setting last put into the work. */
  const heard = ref<string | null>(null);
  function listen(r: Returned) {
    const intents = settingIntents(session.doc.value, r);
    if (!intents.length) {
      session.toast('warn', `“${r.title}” holds no control this work still has.`);
      return;
    }
    const done = session.commit(intents, { label: `Sent-back setting “${r.title}”` });
    if (!done.ok) {
      session.toast('warn', done.error.message);
      return;
    }
    heard.value = r.id;
    session.toast('info', `Your work now plays “${r.title}”. ⌘Z takes it back.`);
  }
  return { heard, listen };
}
