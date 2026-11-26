// What den-kit says about the data it may send (src/host/analytics.ts), in the same
// words on the first-launch question (DataConsent.vue) and in Settings.
import type { DataChoice, DataKind } from '../host/analytics.ts';

export const DATA_KIND_TEXT: Record<DataKind, { title: string; detail: string }> = {
  usage: {
    title: 'Usage data',
    detail:
      'Which features you use and how far you get, with a random ID for this install. Never your works, code, sounds, images, AI conversations, files or sign-in details.',
  },
  crashes: {
    title: 'Crash reports',
    detail: 'What went wrong when den-kit crashes or hits an unexpected error. Sent to Sentry.',
  },
};

/** The kinds the host can send that the person has not answered about yet. */
export const unasked = (kinds: readonly DataKind[], choice: DataChoice): DataKind[] =>
  kinds.filter(kind => choice[kind] === undefined);
