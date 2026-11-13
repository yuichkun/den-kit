// A static host needs no special headers to recompile a playable build. The
// trusted player fetches its self-contained compiler, then an opaque sandboxed
// frame starts it as a Blob worker. That worker inherits the frame's CSP, which
// denies network requests and external scripts; codeboxes run only in the worker.
// A private port carries compile requests and results, never host capabilities.
import compilerUrl from 'virtual:player-compiler';
import { CompileClient, type WorkerLike } from '../sound/compile/compile-client.ts';
import type { CompileRequest, CompileResponse } from '../sound/compile/protocol.ts';
import { DEFAULT_COMPILE_TARGET } from '../sound/compile/target.ts';

// This script is fixed application code. The compiler and the patch arrive over a
// MessagePort, so neither can change the frame's markup, policy or bridge code.
const BRIDGE = `addEventListener('message', function connect(event) {
  if (event.source !== parent || typeof event.data !== 'string' || !event.ports[0]) return;
  removeEventListener('message', connect);
  const port = event.ports[0];
  const url = URL.createObjectURL(new Blob([event.data], { type: 'text/javascript' }));
  const worker = new Worker(url);
  worker.onmessage = event => {
    if (event.data.type === 'player-compiler-ready') {
      port.postMessage({ type: 'ready' });
      return;
    }
    if (event.data.type === 'player-compiler-error') {
      port.postMessage({ type: 'error', message: event.data.message });
      return;
    }
    const wasm = event.data.result?.wasm;
    port.postMessage({ type: 'result', data: event.data }, wasm ? [wasm] : []);
  };
  worker.onerror = event => {
    event.preventDefault();
    port.postMessage({ type: 'error', message: event.message });
  };
  worker.onmessageerror = () => port.postMessage({ type: 'error', message: 'The compile result could not be read.' });
  port.onmessage = event => worker.postMessage(event.data);
});`;

class PlayerWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  onmessageerror: WorkerLike['onmessageerror'] = null;
  private frame = document.createElement('iframe');
  private port = new MessageChannel();
  private pending: CompileRequest[] = [];
  private ready = false;
  private stopped = false;

  constructor(source: Promise<string>) {
    this.frame.hidden = true;
    this.frame.setAttribute('aria-hidden', 'true');
    this.frame.sandbox.add('allow-scripts');
    this.port.port1.onmessage = event => {
      if (this.stopped) return;
      const message = event.data as {
        type: 'ready' | 'result' | 'error';
        data: CompileResponse;
        message: string;
      };
      if (message.type === 'ready') {
        this.ready = true;
        for (const request of this.pending) this.port.port1.postMessage(request);
        this.pending = [];
      } else if (message.type === 'error') this.onerror?.({ message: message.message });
      else if (message.type === 'result') this.onmessage?.({ data: message.data });
    };
    void this.open(source).catch(error => {
      if (!this.stopped) this.onerror?.({ message: String(error) });
    });
  }

  private async open(source: Promise<string>) {
    const nonce = crypto.randomUUID();
    this.frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' blob: 'unsafe-eval' 'wasm-unsafe-eval'; worker-src blob:"><script nonce="${nonce}">${BRIDGE}</script>`;
    const loaded = new Promise<void>(resolve => {
      this.frame.onload = () => resolve();
    });
    document.body.append(this.frame);
    const [, code] = await Promise.all([loaded, source]);
    if (!this.stopped) this.frame.contentWindow!.postMessage(code, '*', [this.port.port2]);
  }

  postMessage(request: CompileRequest) {
    if (this.stopped) return;
    if (this.ready) this.port.port1.postMessage(request);
    else this.pending.push(request);
  }

  terminate() {
    this.stopped = true;
    this.pending = [];
    this.port.port1.close();
    this.port.port2.close();
    // Removing the frame also terminates its dedicated worker.
    this.frame.remove();
  }
}

/** Downloads finish before the compile watchdog starts; later targets reuse the bytes. */
export function playerCompiler(): Pick<CompileClient, 'prime' | 'compile' | 'dispose'> {
  let source: Promise<string> | undefined;
  let disposed = false;
  const controller = new AbortController();
  const client = new CompileClient({
    createWorker: () => new PlayerWorker(source!),
  });
  return {
    prime: artifact => client.prime(artifact),
    async compile(...args) {
      if (!disposed && !client.cached(args[0].hash, args[2] ?? DEFAULT_COMPILE_TARGET)) {
        source ??= fetch(compilerUrl, { signal: controller.signal }).then(response => {
          if (!response.ok) throw new Error('The playable build has no compiler. Export it again.');
          return response.text();
        });
        await source;
      }
      return client.compile(...args);
    },
    dispose() {
      disposed = true;
      controller.abort();
      client.dispose();
    },
  };
}
