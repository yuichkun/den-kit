// A KitSession without audio or workers for isolated unit tests.
import { KitSession } from '../../src/editor/session.ts';

export function testSession() {
  return new KitSession({
    storage: null,
    createWorker: () =>
      ({
        postMessage() {},
        terminate() {},
        onmessage: null,
        onerror: null,
        onmessageerror: null,
      }) as never,
    engine: { setParam() {}, unload() {}, running: false } as never,
  });
}
