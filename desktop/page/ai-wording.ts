// What app users read about the AI: what they can do to recover, never service
// details or developer commands.
import type { AIWording, CodexStatus, LlmError } from '../../src/host/ai.ts';

/** Desktop recovery instructions, separate from service diagnostics. */
export function aiUnavailable(online: boolean, state?: CodexStatus['state']): string {
  if (!online)
    return 'The AI connection was lost. Click the AI status to reconnect, then send your request again.';
  if (state === 'login') return 'Sign in with ChatGPT in Settings to send an AI request.';
  if (state === 'starting') return 'AI is starting. Try again in a moment.';
  return 'AI is unavailable. Click the AI status to reconnect, then try again.';
}

/** Translate failures into actions a person can take without terminal setup. */
export function aiFailure(error?: LlmError): string {
  const code = error?.code ?? '';
  const message = error?.message ?? '';
  if (code === 'connection-timeout' || code === 'response-timeout')
    return 'ChatGPT did not respond. Check your internet connection and send your request again. If it keeps failing, quit and reopen den-kit.';
  if (code === 'login') {
    return 'Sign in with ChatGPT in Settings, then send your request again.';
  }
  if (
    /(?:not signed in|unauthorized|authentication|sign[- ]in|token expired|\b401\b)/i.test(message)
  ) {
    return 'Open Settings. Sign out if you are signed in, then sign in with ChatGPT and send your request again.';
  }
  if (code === 'starting') return 'AI is starting. Try again in a moment.';
  if (code === 'busy' || code === 'duplicate')
    return 'AI is still working. Wait for it to finish or press Esc to stop it.';
  if (/rate.?limit|usage.?limit|quota|too many requests|\b429\b/i.test(message)) {
    return 'Your ChatGPT usage limit was reached. Check your usage in Settings and try again when it resets.';
  }
  if (
    code === 'crashed' ||
    code === 'closed' ||
    /(?:bridge|connection|network|timed? out|timeout|disconnected|restart)/i.test(message)
  ) {
    return 'The AI connection was interrupted. Try sending your request again. If it keeps failing, restart den-kit.';
  }
  return 'AI could not complete this request. Try sending it again. If it keeps failing, restart den-kit.';
}

/** The desktop app's wording: what a person can do in the app, without terminal setup. */
export const desktopWording: AIWording = {
  technical: false,
  unavailable: (online, status) => aiUnavailable(online, status?.state),
  failure: error => ({ message: aiFailure(error) }),
  stopped: () => 'Stopped.',
  activity: what => (what === 'blocked' ? 'Skipped an unsupported AI action.' : null),
  retrying: () => 'Connection lost. Retrying ChatGPT…',
  skippedQuestion: null,
};
