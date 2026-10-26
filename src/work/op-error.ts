// The error every refused edit throws: a code for programs, a message and a
// hint for people and the AI, and the index of the failing intent.
export class OpError extends Error {
  readonly index: number;
  readonly code: string;
  readonly hint?: string;
  constructor(message: string, index: number, code: string, hint?: string) {
    super(message);
    this.name = 'OpError';
    this.index = index;
    this.code = code;
    this.hint = hint;
  }
}

export function fail(code: string, message: string, hint?: string): never {
  throw new OpError(message, -1, code, hint);
}
