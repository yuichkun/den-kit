// Days in the usage receiver: UTC dates, written YYYY-MM-DD, and how long it keeps events.

/**
 * Days the receiver keeps an event after the day it happened. The daily run counts each of these
 * days again (store.ts), so an event that arrives late still counts, and day 30 of the installs
 * that started 30 days before has 15 more days for its events to arrive.
 */
export const KEEP_DAYS = 45;

/** The UTC day of a time. */
export function dayOf(time: Date): string {
  return time.toISOString().slice(0, 10);
}

/** The day `n` days after `day`, or before it for a negative `n`. */
export function addDays(day: string, n: number): string {
  const time = new Date(`${day}T00:00:00Z`);
  time.setUTCDate(time.getUTCDate() + n);
  return dayOf(time);
}
