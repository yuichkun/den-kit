// The stand-in for a server in this prototype: the works people shared as their
// authors, whether each author lets people change the inside, and what came back
// to them. It is kept in this browser's localStorage only, so a link opened in
// another browser plays and can be passed on, but its author's inbox and choices
// are not there. Other tabs of this browser see changes as they happen.
import { ref } from 'vue';

const KEY = 'den-kit:prototype:remix';

export interface SharedWork {
  /** The passage's id. */
  id: string;
  /** The example work. */
  work: string;
  author: string;
  allowInside: boolean;
  at: number;
}

export interface Returned {
  id: string;
  /** The passage it belongs to. */
  passage: string;
  by: string;
  /** Who passed it on before them. */
  via: string[];
  words: string;
  /** The link text of the passage with this person's hop last. */
  link: string;
  /** What it carries: settings, a phrase, a change inside. */
  carries: string[];
  at: number;
  /** The author took it off the work's list. */
  hidden?: boolean;
}

interface Store {
  works: Record<string, SharedWork>;
  returned: Returned[];
}

function read(): Store {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const data = raw ? (JSON.parse(raw) as Partial<Store>) : {};
    return {
      works: data.works && typeof data.works === 'object' ? data.works : {},
      returned: Array.isArray(data.returned) ? data.returned : [],
    };
  } catch {
    return { works: {}, returned: [] };
  }
}

/** What this browser holds; follows other tabs. */
export const store = ref<Store>(read());
if (typeof window !== 'undefined')
  window.addEventListener('storage', e => {
    if (e.key === KEY) store.value = read();
  });

function write(change: (s: Store) => void) {
  const next = read();
  change(next);
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not kept (a private window): this tab still shows it.
  }
  store.value = next;
}

export function shareWork(work: SharedWork) {
  write(s => {
    s.works[work.id] = work;
  });
}

export function setAllowInside(id: string, allow: boolean) {
  write(s => {
    const w = s.works[id];
    if (w) w.allowInside = allow;
  });
}

export function sendBack(item: Returned) {
  write(s => {
    s.returned.push(item);
  });
}

export function setHidden(id: string, hidden: boolean) {
  write(s => {
    const item = s.returned.find(r => r.id === id);
    if (item) item.hidden = hidden;
  });
}

/** Whether the inside may be changed: the author's choice now when this browser has it, else the link's. */
export function allowsInside(passage: { id: string; author: { allowInside: boolean } }): boolean {
  return store.value.works[passage.id]?.allowInside ?? passage.author.allowInside;
}

/** What came back to a work and is on its list, newest first. */
export function returnedTo(passage: string): Returned[] {
  return store.value.returned
    .filter(r => r.passage === passage && !r.hidden)
    .sort((a, b) => b.at - a.at);
}
