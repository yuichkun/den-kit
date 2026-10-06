// In-process stand-ins for unit tests: a KitSession without audio or workers,
// and a bridge whose Jev answers come from the fake's scripted brain (with the
// same request validation as the fake Jev server).
import { shallowRef } from 'vue';
import { KitSession } from '../../src/editor/session.ts';
import type { BridgeClient } from '../../src/ai/bridge-client.ts';
import type { BridgeStatus, JevRequest, JevResult } from '../../src/ai/protocol.ts';
import { validateJevRequest, type Answerer } from '../fakes/jev/fake-jev.ts';

export function testSession() {
  return new KitSession({
    storage: null,
    createWorker: () => ({ postMessage() {}, terminate() {}, onmessage: null, onerror: null, onmessageerror: null }) as never,
    engine: { setParam() {}, unload() {}, running: false } as never,
  });
}

export interface StubBridge {
  bridge: BridgeClient;
  requests: JevRequest[];
  telemetry: Record<string, unknown>[];
  /** Replace the next answer(s): a result, or a function of the request. */
  next: Array<JevResult | ((r: JevRequest) => JevResult)>;
  /** Called while a request is "in flight" (to simulate edits during the wait). */
  during?: () => void;
  delayMs: number;
}

export function stubBridge(answerer: Answerer, status: BridgeStatus['jev']['state'] = 'ok'): StubBridge {
  const stub: StubBridge = { requests: [], telemetry: [], next: [], delayMs: 0, bridge: null as never };
  const statusRef = shallowRef<BridgeStatus>({ jev: { state: status }, codex: { state: 'off' } });
  stub.bridge = {
    online: true,
    get jevReady() { return statusRef.value.jev.state === 'ok' || statusRef.value.jev.state === 'unknown'; },
    status: statusRef,
    telemetry: (r: Record<string, unknown>) => { stub.telemetry.push(r); },
    async askJev(request: JevRequest, options: { signal?: AbortSignal } = {}): Promise<JevResult> {
      stub.requests.push(request);
      if (stub.delayMs) await new Promise(r => setTimeout(r, stub.delayMs));
      stub.during?.();
      if (options.signal?.aborted) return { ok: false, error: { kind: 'cancelled', message: 'Cancelled.' }, ms: 1 };
      const forced = stub.next.shift();
      if (forced) return typeof forced === 'function' ? forced(request) : forced;
      const body = { state: request.state, model: 'jev-1.13.0', questions: request.questions };
      const invalid = validateJevRequest(body);
      if (invalid) return { ok: false, error: { kind: 'invalid', message: invalid, status: 422 }, ms: 1 };
      const answers = Object.fromEntries(Object.entries(request.questions).map(([id, q]) => [id, answerer(id, q as never, request.state)]));
      return { ok: true, response: { model: 'jev-1.13.0', answers }, ms: 42 };
    },
  } as unknown as BridgeClient;
  return stub;
}
