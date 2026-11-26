// The Analytics interface (docs/architecture.md, Interfaces): what den-kit may send to improve itself,
// as the person chose. den-kit asks, counts its own use and hands each usage event over; the host
// keeps the choice and the install's random ID, and decides where the data goes. What each event
// means for the person, and what is never sent, is in docs/usage.md (Help improve den-kit).

/** The kinds of data a person may let den-kit send, in the order den-kit asks about them. */
export const DATA_KINDS = ['usage', 'crashes'] as const;
export type DataKind = (typeof DATA_KINDS)[number];
/** The person's answer for each kind they were asked about; a kind they were not asked about is missing. */
export type DataChoice = Partial<Record<DataKind, boolean>>;

/**
 * What den-kit counts of its own use. app_used, sound_played and work_edited count once a day, on
 * the first time that day (UTC); the others count each time (src/editor/usage.ts).
 */
export const USAGE_EVENTS = [
  'app_used',
  'sound_played',
  'work_edited',
  'ai_requested',
  'code_part_added',
  'work_exported',
] as const;
export type UsageEvent = (typeof USAGE_EVENTS)[number];

export interface Analytics {
  /** The kinds this host can send, in the order den-kit asks about them; never empty. */
  readonly kinds: readonly DataKind[];
  /** The email address where a person asks to see or delete the usage data sent with their ID; null without usage data. */
  readonly contact: string | null;
  choice(): Promise<DataChoice>;
  /** Keeps the person's answers; sending follows them at once, and turning usage data off drops the events waiting to be sent. */
  choose(choice: DataChoice): Promise<void>;
  /** The random ID sent with this install's usage data; null until the person first allows usage data. */
  installId(): Promise<string | null>;
  /** One usage event; the host sends it only while the person allows usage data. */
  record(event: UsageEvent): void;
}
