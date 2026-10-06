// Jev (TypeSafe System One) HTTP client. Lives only in the bridge so the API key
// never reaches the browser. One attempt per request within a time budget; a
// busy reply is retried only if its retry-after fits in what is left.
import type { JevErrorKind, JevRequest, JevResponse, JevResult, JevStatus } from '../src/ai/protocol.ts';
import { isObject } from '../src/ai/protocol.ts';

export const JEV_MODEL = 'jev-1.13.0';
export const DEFAULT_JEV_BASE = 'https://api.typesafe.ai';
/** Rough token estimate (~4 chars/token); the API limits are 64k per request and 32k for state + longest question. */
export const estimateTokens = (value: unknown) => Math.ceil(JSON.stringify(value ?? '').length / 4);

export interface JevClientOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetch?: typeof fetch;
  defaultBudgetMs?: number;
  maxBudgetMs?: number;
}

export class JevClient {
  readonly status: JevStatus;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultBudgetMs: number;
  private readonly maxBudgetMs: number;
  constructor(options: JevClientOptions = {}) {
    this.apiKey = options.apiKey?.trim() || undefined;
    this.baseUrl = (options.baseUrl ?? DEFAULT_JEV_BASE).replace(/\/+$/, '');
    this.model = options.model ?? JEV_MODEL;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.defaultBudgetMs = options.defaultBudgetMs ?? 2500;
    this.maxBudgetMs = options.maxBudgetMs ?? 8000;
    this.status = this.apiKey ? { state: 'unknown', model: this.model, budgetMs: this.defaultBudgetMs } : { state: 'off', detail: 'TYPESAFE_API_KEY is not set (put it in kit/.env).' };
  }
  get enabled() { return !!this.apiKey && this.status.detail !== 'auth'; }

  async ask(request: JevRequest, options: { budgetMs?: number; signal?: AbortSignal } = {}): Promise<JevResult> {
    const started = performance.now();
    const ms = () => Math.round(performance.now() - started);
    const fail = (kind: JevErrorKind, message: string, extra: { status?: number; retryAfterMs?: number } = {}): JevResult => ({ ok: false, error: { kind, message, ...extra }, ms: ms() });
    if (!this.apiKey) return fail('off', 'Jev is off: TYPESAFE_API_KEY is not set.');
    if (this.status.state === 'error' && this.status.detail === 'auth') return fail('auth', 'Jev rejected the API key (401). Fix TYPESAFE_API_KEY and restart kit:dev.');
    const questions = Object.values(request.questions ?? {});
    if (!questions.length) return fail('invalid', 'No questions.');
    const total = estimateTokens({ state: request.state, questions: request.questions });
    const longest = Math.max(...questions.map(q => estimateTokens(q)));
    if (total > 60000 || estimateTokens(request.state) + longest > 30000) return fail('too-large', `Request too large for Jev (~${total} tokens).`);
    const budget = Math.min(this.maxBudgetMs, Math.max(100, options.budgetMs ?? this.defaultBudgetMs));
    const deadline = started + budget;
    const body = JSON.stringify({ state: request.state, model: this.model, questions: request.questions });
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      options.signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - performance.now()));
      try {
        const res = await this.fetchImpl(`${this.baseUrl}/v1/systemone`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` }, body, signal: controller.signal });
        const text = await res.text();
        if (res.status === 401) { this.setStatus({ state: 'error', detail: 'auth' }); return fail('auth', 'Jev rejected the API key (401).', { status: 401 }); }
        if (res.status === 422 || res.status === 400) return fail('invalid', `Jev refused the request (${res.status}): ${text.slice(0, 300)}`, { status: res.status });
        if (res.status === 429 || res.status === 529 || res.status === 503) {
          const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
          const wait = retryAfterMs ?? 150 * (attempt + 1);
          if (attempt === 0 && performance.now() + wait + 100 < deadline) { await sleep(wait, options.signal); continue; }
          return fail('busy', `Jev is busy (${res.status}).`, { status: res.status, retryAfterMs });
        }
        if (!res.ok) return fail('server', `Jev error ${res.status}: ${text.slice(0, 200)}`, { status: res.status });
        let data: unknown;
        try { data = JSON.parse(text); } catch { return fail('malformed', 'Jev returned a body that is not JSON.'); }
        if (!isObject(data) || !isObject(data.answers)) return fail('malformed', 'Jev response has no answers object.');
        const response: JevResponse = { model: String(data.model ?? ''), answers: data.answers, usage: isObject(data.usage) ? data.usage as JevResponse['usage'] : undefined };
        this.setStatus({ state: 'ok', model: response.model || this.model, lastMs: ms() });
        return { ok: true, response, ms: ms(), modelWarning: response.model && response.model !== this.model ? `Jev answered with ${response.model}, expected ${this.model}.` : undefined };
      } catch (error) {
        if (options.signal?.aborted) return fail('cancelled', 'Cancelled.');
        if (controller.signal.aborted) return fail('timeout', `Jev did not answer within ${budget} ms.`);
        this.setStatus({ state: 'error', detail: 'network' });
        return fail('network', `Could not reach Jev: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
      }
    }
    return fail('busy', 'Jev is busy.');
  }

  /** Warm the connection and learn whether the key works (non-blocking at startup). */
  async warmUp(): Promise<JevResult> {
    return this.ask({ state: 'warm-up', questions: { ok: { type: 'noul', instructions: 'Is this a warm-up request?' } } }, { budgetMs: 5000 });
  }

  private setStatus(next: Partial<JevStatus> & { state: JevStatus['state'] }) {
    Object.assign(this.status, { detail: undefined, budgetMs: this.defaultBudgetMs, ...next });
  }
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>(resolve => { const t = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true }); });
}
