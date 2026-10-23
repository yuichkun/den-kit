// The host's Sandbox (src/host): the local server answers for each open work under
// its own host name, http://<work id>.localhost:<port> (Chromium sends *.localhost
// to this machine without DNS), and serves the work's code parts and assets there:
// while the person edits, it passes requests and WebSockets through to the
// workspace's dev server (BrowserPod's portal), and it serves the work's files by
// path from the host's storage. The desktop app runs it on its local server; the
// development host on the AI bridge's.
//
// The rules sit in this server's own responses, so nothing in the work's files
// (such as the dev server's settings) can change them: a CSP that lets the frame
// connect only to its own origin and the origins the person allowed for the work
// (and run nothing from elsewhere), COEP and CORP for den-kit's cross-origin
// isolated page, nosniff. What headers do not cover is set on the window
// (applySandbox): DNS prefetching off, WebRTC only through the proxy, a proxy rule
// that sends every connection except den-kit's own hosts and the open works'
// allowed ones to a port that closes at once, frames that cannot navigate away,
// devices by the frame's work, and no sound before the person touches it.
// In the desktop app, requests reach the sandbox only with a per-launch secret
// header the window adds (other programs and web pages do not have it); a browser
// cannot add one, so the development host's sandbox answers without it.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  request as httpRequest,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createServer, type Server } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';

export const SECRET_HEADER = 'x-den-kit-sandbox';
/** Where the browser sends CSP violations (the work tried to reach something it may not). */
export const REPORT_PATH = '/__den-kit/csp-report';
/** The work's files by path: /__den-kit/files/assets/kick.wav. */
export const FILES_PATH = '/__den-kit/files/';
/** What a work's code parts may use, as the person allowed it for that work. */
export const DEVICES = ['microphone', 'camera', 'midi'] as const;
export type Device = (typeof DEVICES)[number];
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_REPORT_BYTES = 64 * 1024;
const FORWARD = [
  'accept',
  'accept-language',
  'content-type',
  'content-length',
  'if-none-match',
  'if-modified-since',
  'range',
  'cache-control',
  'pragma',
];
const KEEP = [
  'content-type',
  'content-length',
  'content-encoding',
  'etag',
  'last-modified',
  'cache-control',
  'content-range',
  'accept-ranges',
  'vary',
];

export interface SandboxWork {
  /** The workspace's dev server while the person edits (its https origin), or null. */
  portal: string | null;
  /** Origins the person allowed for this work's code parts (https://api.example.com). */
  origins: string[];
  /** Devices the person allowed for them. */
  devices: Device[];
  /** The work's files: path → content hash and media type. */
  files: Record<string, { hash: string; type: string }>;
}

export interface SandboxOptions {
  /** The port of the server it runs on (0 until that server listens). */
  port: number;
  /** Refuse requests without the secret header (true unless the host is a browser). */
  requireSecret?: boolean;
  /** A content of the host's storage by hash. */
  content(hash: string): Uint8Array | null;
  /** A work's code part tried to reach what it may not (a CSP report). */
  refused(work: string, report: { blocked: string; directive: string }): void;
}

/** An origin a work may connect to: https or wss, a host, no path. */
export function validOrigin(origin: string): string | null {
  try {
    const u = new URL(origin);
    if (!['https:', 'wss:'].includes(u.protocol) || u.username || u.password) return null;
    if (u.pathname !== '/' || u.search || u.hash) return null;
    return u.origin === 'null' ? `${u.protocol}//${u.host}` : u.origin;
  } catch {
    return null;
  }
}

export class SandboxServer {
  readonly secret = randomBytes(32).toString('hex');
  private readonly works = new Map<string, SandboxWork>();
  private readonly listeners = new Set<() => void>();
  private readonly options: SandboxOptions;

  constructor(options: SandboxOptions) {
    this.options = { ...options };
  }

  /** The port it answers on, once its server listens. */
  get port() {
    return this.options.port;
  }
  set port(port: number) {
    this.options.port = port;
  }

  /** The work's origin: where its frames load from. */
  origin(work: string) {
    return `http://${work}.localhost:${this.options.port}`;
  }

  /** The open work a URL or origin belongs to, or null. */
  workOf(url: string): string | null {
    try {
      const u = new URL(url);
      const m = /^([^.]+)\.localhost$/.exec(u.hostname);
      if (u.protocol !== 'http:' || !m || Number(u.port) !== this.options.port) return null;
      return this.works.has(m[1]!) ? m[1]! : null;
    } catch {
      return null;
    }
  }

  open(work: string, settings: SandboxWork) {
    if (!LABEL.test(work)) throw new Error('A work id is a host name label.');
    this.works.set(work, {
      portal: settings.portal ? new URL(settings.portal).origin : null,
      origins: [...new Set(settings.origins.map(validOrigin).filter((o): o is string => !!o))],
      devices: settings.devices.filter(d => (DEVICES as readonly string[]).includes(d)),
      files: settings.files,
    });
    for (const l of this.listeners) l();
  }

  close(work: string) {
    if (this.works.delete(work)) for (const l of this.listeners) l();
  }

  devices(work: string): Device[] {
    return this.works.get(work)?.devices ?? [];
  }

  /** The hosts the open works may connect to (they go around the refusing proxy). */
  allowedHosts(): string[] {
    return [
      ...new Set([...this.works.values()].flatMap(w => w.origins.map(o => new URL(o).hostname))),
    ];
  }

  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The rules, in every response for a work's origin. */
  headers(work: string): OutgoingHttpHeaders {
    // An allowed origin is its host, by https and wss (a CSP source of one scheme does not cover the other).
    const allowed = [
      ...new Set(
        (this.works.get(work)?.origins ?? []).flatMap(o => {
          const host = new URL(o).host;
          return [`https://${host}`, `wss://${host}`];
        }),
      ),
    ];
    return {
      'content-security-policy': [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "worker-src 'self' blob:",
        `connect-src 'self'${allowed.map(o => ` ${o}`).join('')}`,
        "img-src 'self' data: blob:",
        "media-src 'self' data: blob:",
        "font-src 'self' data:",
        "style-src 'self' 'unsafe-inline'",
        "frame-src 'none'",
        "form-action 'none'",
        "base-uri 'none'",
        "object-src 'none'",
        `report-uri ${REPORT_PATH}`,
      ].join('; '),
      'cross-origin-embedder-policy': 'require-corp',
      'cross-origin-resource-policy': 'cross-origin',
      'x-content-type-options': 'nosniff',
    };
  }

  /** The work a request is for, from its Host header: undefined when it is not for the sandbox at all. */
  private target(req: IncomingMessage): string | null | undefined {
    const m = /^([^.:]+)\.localhost:(\d+)$/.exec(req.headers.host ?? '');
    if (!m || Number(m[2]) !== this.options.port) return undefined;
    return this.works.has(m[1]!) ? m[1]! : null;
  }

  private trusted(req: IncomingMessage) {
    if (this.options.requireSecret === false) return true;
    const given = Buffer.from(String(req.headers[SECRET_HEADER] ?? ''));
    const secret = Buffer.from(this.secret);
    return given.length === secret.length && timingSafeEqual(given, secret);
  }

  /** Serves a request for a work's origin; false when the request is not for the sandbox. */
  handle(req: IncomingMessage, res: ServerResponse): boolean {
    const work = this.target(req);
    if (work === undefined) return false;
    if (!this.trusted(req)) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden');
      return true;
    }
    if (work === null) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('no such work is open');
      return true;
    }
    const settings = this.works.get(work)!;
    const url = new URL(req.url ?? '/', 'http://sandbox');
    if (url.pathname === REPORT_PATH) {
      this.report(work, req, res);
      return true;
    }
    if (url.pathname.startsWith(FILES_PATH)) {
      this.file(
        work,
        settings,
        decodeURIComponent(url.pathname.slice(FILES_PATH.length)),
        req,
        res,
      );
      return true;
    }
    if (settings.portal) {
      this.relay(work, settings.portal, req, res);
      return true;
    }
    res
      .writeHead(404, { ...this.headers(work), 'content-type': 'text/plain' })
      .end('This code part runs while its workspace is open.');
    return true;
  }

  private report(work: string, req: IncomingMessage, res: ServerResponse) {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > MAX_REPORT_BYTES) req.destroy();
    });
    req.on('end', () => {
      res.writeHead(204).end();
      try {
        const parsed = JSON.parse(body) as unknown;
        const reports = (Array.isArray(parsed) ? parsed : [parsed]) as Array<Record<string, any>>;
        for (const r of reports) {
          const csp = (r['csp-report'] ?? r.body ?? r) as Record<string, unknown>;
          const blocked = String(csp['blocked-uri'] ?? csp.blockedURL ?? '');
          const directive = String(
            csp['effective-directive'] ?? csp.effectiveDirective ?? csp['violated-directive'] ?? '',
          );
          if (blocked) this.options.refused(work, { blocked, directive });
        }
      } catch {
        /* not a report */
      }
    });
  }

  private file(
    work: string,
    settings: SandboxWork,
    path: string,
    req: IncomingMessage,
    res: ServerResponse,
  ) {
    const entry = Object.hasOwn(settings.files, path) ? settings.files[path] : undefined;
    const bytes = entry ? this.options.content(entry.hash) : null;
    if (!entry || !bytes || !['GET', 'HEAD'].includes(req.method ?? '')) {
      res.writeHead(404, this.headers(work)).end();
      return;
    }
    res.writeHead(200, {
      ...this.headers(work),
      'content-type': entry.type || 'application/octet-stream',
      'content-length': bytes.length,
      'cache-control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : Buffer.from(bytes));
  }

  /** Passes a request through to the dev server; its headers are dropped for the sandbox's own. */
  private relay(work: string, portal: string, req: IncomingMessage, res: ServerResponse) {
    const target = new URL(req.url ?? '/', portal);
    const headers: OutgoingHttpHeaders = { host: target.host };
    for (const name of FORWARD)
      if (req.headers[name] !== undefined) headers[name] = req.headers[name];
    const upstream = (target.protocol === 'https:' ? httpsRequest : httpRequest)(
      target,
      { method: req.method, headers },
      answer => {
        const out: OutgoingHttpHeaders = { ...this.headers(work) };
        for (const name of KEEP)
          if (answer.headers[name] !== undefined) out[name] = answer.headers[name];
        const location = answer.headers.location;
        if (location) {
          const to = new URL(location, target);
          if (to.origin === target.origin) out.location = `${to.pathname}${to.search}${to.hash}`;
        }
        res.writeHead(answer.statusCode ?? 502, out);
        answer.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, this.headers(work));
      res.end();
    });
    req.pipe(upstream);
  }

  /** Passes a WebSocket (the dev server's live reload) through; false when it is not for the sandbox. */
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const work = this.target(req);
    if (work === undefined) return false;
    const portal = work ? this.works.get(work)?.portal : null;
    if (!this.trusted(req) || !portal) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return true;
    }
    const target = new URL(req.url ?? '/', portal);
    target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
    const protocols = String(req.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map(p => p.trim())
      .filter(Boolean);
    const upstream = new WebSocket(target, protocols, { origin: portal });
    const fail = () => {
      if (!socket.destroyed) socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    };
    upstream.once('error', fail);
    upstream.once('unexpected-response', fail);
    upstream.once('open', () => {
      const server = new WebSocketServer({
        noServer: true,
        handleProtocols: () => upstream.protocol || false,
      });
      server.handleUpgrade(req, socket, head, client => {
        const close = (ws: WebSocket, code: number, reason: Buffer) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          // Codes that cannot be sent (no status, abnormal closure) end it plainly.
          if (code === 1005 || code === 1006 || code < 1000) ws.close();
          else ws.close(code, reason);
        };
        upstream.on('message', (data, binary) => client.send(data, { binary }));
        client.on('message', (data, binary) => upstream.send(data, { binary }));
        upstream.on('close', (code, reason) => close(client, code, reason));
        client.on('close', (code, reason) => close(upstream, code, reason));
        upstream.on('error', () => client.terminate());
        client.on('error', () => upstream.terminate());
      });
    });
    return true;
  }
}

/** A port that accepts a connection and closes it at once: where the proxy rule sends what is not allowed. */
export async function refusingPort(): Promise<{ port: number; server: Server }> {
  const server = createServer(socket => socket.destroy());
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as { port: number }).port, server };
}

/** The proxy rules: den-kit's own hosts and the open works' allowed hosts connect directly, nothing else. */
export function proxyConfig(refusePort: number, direct: readonly string[]) {
  return {
    proxyRules: `http=127.0.0.1:${refusePort};https=127.0.0.1:${refusePort}`,
    proxyBypassRules: [...direct].join(','),
  };
}

/**
 * Whether a frame may go to `url`: a code part's frame only within its own work's origin; den-kit's own frames
 * to an open work, about:blank, den-kit's own origin or den-kit's own services.
 */
export function mayNavigate(
  sandbox: SandboxServer,
  from: { url: string; origin: string },
  url: string,
  own: { origin: string; hosts: readonly string[] },
): boolean {
  const current = sandbox.workOf(from.origin) ?? sandbox.workOf(from.url);
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  if (current) return target.origin === sandbox.origin(current);
  if (url === 'about:blank' || url === 'about:srcdoc') return true;
  if (sandbox.workOf(url)) return true;
  if (target.origin === own.origin) return true;
  return (
    target.protocol === 'https:' &&
    own.hosts.some(h =>
      h.startsWith('*.') ? target.hostname.endsWith(h.slice(1)) : target.hostname === h,
    )
  );
}
