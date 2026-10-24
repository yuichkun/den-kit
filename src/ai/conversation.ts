// What the person did between the AI's turns, in a few words: the AI is told
// when a request goes on with the work's conversation.
import type { Transaction } from '../work/history.ts';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * The person's own edits after `since` (ms), in a few words: "Panel Cutoff ×3, Move,
 * Connect lfo1 → filter1", and what a code part or canvas moved, with its element
 * ("Panel Cutoff ×40 by reels1"). Undone edits are not in the history any more, so
 * they do not show; loads and AI edits are not theirs.
 */
export function handEditsSince(
  entries: readonly Transaction[],
  since: number,
  max = 10,
): string | null {
  const counts = new Map<string, number>();
  for (const tx of entries) {
    if (tx.at <= since || tx.replaced) continue;
    const label =
      tx.author.kind === 'human'
        ? tx.label
        : tx.author.kind === 'part'
          ? `${tx.label} by ${tx.author.element}`
          : null;
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  if (!counts.size) return null;
  const parts = [...counts].map(([label, n]) => `${clip(label, 60)}${n > 1 ? ` ×${n}` : ''}`);
  return parts.length > max
    ? `${parts.slice(0, max).join(', ')} and ${parts.length - max} more`
    : parts.join(', ');
}
