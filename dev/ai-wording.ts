// The development host's wording for AI requests: what developers need, the
// runtime's own messages, and the commands that fix the setup.
import type { AIWording } from '../src/host/ai.ts';

export const developerWording: AIWording = {
  technical: true,
  unavailable(online, c) {
    if (!online) return 'The LLM is not available: the AI bridge is not connected.';
    if (!c || c.state === 'off') return `The LLM is off${c?.detail ? `: ${c.detail}` : '.'}`;
    if (c.state === 'login')
      return `The LLM is not available: Codex is not signed in. ${c.fix ?? 'Run `vp run codex:login`.'}`;
    if (c.state === 'starting') return 'The LLM is still starting; try again in a moment.';
    return `The LLM is not available: ${c.detail ?? 'Codex reported an error'}.${c.fix ? ` ${c.fix}` : ''}`;
  },
  failure: error => ({ message: error?.message ?? 'The LLM request failed.', fix: error?.fix }),
  stopped: error => (error?.message ? `Stopped: ${error.message}` : 'Stopped.'),
  activity: (what, detail) =>
    what === 'blocked'
      ? `blocked ${detail ?? 'a request'} (den-kit allows only its own tools)`
      : `${what}${detail ? `: ${detail}` : ''}`,
  retrying: message => `reconnecting to the model… (${message})`,
  skippedQuestion: 'skipped a question (it decides itself)',
};
