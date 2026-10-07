// The conversation about the patch being worked on: one per opened patch,
// shared by the fast path and the LLM. The prompt's lines are kept with the
// autosave (a reload goes on where it was); the LLM is told, with each request,
// what happened since its last turn (requests the fast path handled, the
// person's own edits) and, when its conversation is new, what came before.
import type { Transaction } from '../core/history.ts';
import type { Outcome, OutcomeStatus, RouteKind } from './fast-path.ts';

/** Lines kept per conversation (oldest drop first). */
export const SAVED_LINES = 40;
/** Earlier lines a new LLM conversation is given. */
export const RECAP_LINES = 12;

const STATUSES: ReadonlySet<OutcomeStatus> = new Set(['working', 'applied', 'nothing', 'thinking', 'reply', 'stopped', 'failed', 'merged']);
const ROUTES: ReadonlySet<RouteKind> = new Set(['lexicon', 'jev', 'jev-target', 'none', 'llm']);
const clip = (s: string, n: number) => s.length > n ? `${s.slice(0, n - 1)}…` : s;
const str = (v: unknown, n: number) => typeof v === 'string' ? v.slice(0, n) : undefined;

/** A line as it is saved: nothing that only made sense while it ran. */
export function savedLine(o: Outcome): Outcome {
  const running = o.live || o.status === 'working' || o.status === 'thinking';
  const line: Outcome = { ...o, live: undefined, activity: undefined };
  if (running) Object.assign(line, { status: 'stopped', message: 'Interrupted (the page was reloaded).' });
  return JSON.parse(JSON.stringify(line)) as Outcome;
}

/** Lines read back from storage; anything malformed is left out. */
export function readSavedLines(raw: readonly unknown[]): Outcome[] {
  const out: Outcome[] = [];
  for (const item of raw.slice(-SAVED_LINES)) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.text !== 'string' || !STATUSES.has(o.status as OutcomeStatus) || !ROUTES.has(o.route as RouteKind)) continue;
    const line: Outcome = { id: o.id.slice(0, 60), text: o.text.slice(0, 600), status: o.status as OutcomeStatus, route: o.route as RouteKind, ms: typeof o.ms === 'number' && Number.isFinite(o.ms) ? o.ms : 0 };
    for (const key of ['label', 'message', 'note', 'reply', 'fix', 'txId'] as const) { const v = str(o[key], key === 'reply' ? 2000 : 400); if (v) line[key] = v; }
    if (o.via === 'voice' || o.via === 'typed') line.via = o.via;
    if (o.undone === true) line.undone = true;
    if (o.screen === true) line.screen = true;
    if (Array.isArray(o.steps)) line.steps = o.steps.filter((s): s is string => typeof s === 'string').slice(-12).map(s => s.slice(0, 200));
    if (Array.isArray(o.attached)) line.attached = o.attached.filter((a): a is { id: string; kind: never; label: string } => !!a && typeof a === 'object' && typeof (a as { id?: unknown }).id === 'string' && typeof (a as { label?: unknown }).label === 'string').slice(0, 24);
    if (line.status === 'working' || line.status === 'thinking') Object.assign(line, { status: 'stopped', message: 'Interrupted (the page was reloaded).' });
    out.push(line);
  }
  return out;
}

/** One line of the conversation as the LLM reads it. */
export function lineForAi(o: Outcome): string {
  const who = o.route === 'llm' ? 'LLM request' : 'fast path';
  const result = o.status === 'applied' ? o.label ?? 'applied'
    : o.status === 'reply' ? `answered${o.reply ? `: ${clip(o.reply.replace(/\s+/g, ' '), 120)}` : ''}`
    : o.status === 'nothing' ? `nothing changed${o.message ? ` (${clip(o.message, 90)})` : ''}`
    : o.status === 'failed' ? `failed${o.message ? ` (${clip(o.message, 90)})` : ''}`
    : o.status === 'stopped' ? `stopped${o.label ? ` after: ${o.label}` : ''}`
    : o.status === 'merged' ? 'added to the running request'
    : o.status;
  const attached = o.attached?.length ? ` [about: ${o.attached.map(a => a.id).join(', ')}]` : '';
  return `- ${who}: “${clip(o.text, 140)}”${attached} → ${clip(result, 160)}${o.undone ? ' (then undone with ⌘Z)' : ''}`;
}

/**
 * The person's own edits after `since` (ms), in a few words: "Panel Cutoff ×3, Move,
 * Connect lfo1 → filter1". Undone edits are not in the history any more, so they
 * do not show; loads and AI edits are not theirs.
 */
export function handEditsSince(entries: readonly Transaction[], since: number, max = 10): string | null {
  const counts = new Map<string, number>();
  for (const tx of entries) {
    if (tx.at <= since || tx.author.kind !== 'human' || tx.replaced) continue;
    counts.set(tx.label, (counts.get(tx.label) ?? 0) + 1);
  }
  if (!counts.size) return null;
  const parts = [...counts].map(([label, n]) => `${clip(label, 60)}${n > 1 ? ` ×${n}` : ''}`);
  return parts.length > max ? `${parts.slice(0, max).join(', ')} and ${parts.length - max} more` : parts.join(', ');
}

/** "もっと" / "もう少し" / "more": do the last fast-path change again. "戻して" / "undo": take the last AI change back. */
export type FollowUp = { kind: 'more'; prefix: string } | { kind: 'undo' };
const MORE = /^(?:(もっと|さらに|更に|もうちょっと|もうちょい|もう少し|もうすこし)|(?:もう(?:一回|一度|1回)|again|more|a (?:little|bit) more|even more|a touch more))[!！。．.、,\s]*(?:お願い|please|して|やって)?[!！。．.\s]*$/i;
const UNDO = /^(?:戻して|元に戻して|もとに戻して|やっぱり(?:戻して|やめて|なし)|取り消して|undo(?: that)?|revert(?: that)?|take (?:it|that) back)[!！。．.\s]*$/i;
export function followUp(text: string): FollowUp | null {
  const t = text.trim();
  if (UNDO.test(t)) return { kind: 'undo' };
  const m = MORE.exec(t);
  if (m) return { kind: 'more', prefix: m[1] && /少し|すこし|ちょっと|ちょい/.test(m[1]) ? 'もう少し' : m[1] ? 'もっと' : '' };
  return null;
}
