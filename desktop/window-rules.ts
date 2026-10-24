// What the sandbox's response headers cannot cover, set on the app and its window
// (docs/architecture.md, Sandbox): no DNS prefetching (a <link rel="dns-prefetch">
// looks names up whatever the CSP says), WebRTC only through the proxy (so no UDP
// at all), a proxy rule that sends every connection except den-kit's own hosts and
// the hosts the person allowed for the open works to a port that closes at once
// (WebRTC's TCP included), the sandbox's secret header on requests to the works'
// origins, frames that cannot navigate away from their work, and devices by the
// frame's work. A code part also makes no sound before the person touches it
// (autoplayPolicy, set where the window is made).
import type { App, Session, WebContents } from 'electron';
import {
  mayNavigate,
  proxyConfig,
  refusingPort,
  SECRET_HEADER,
  type SandboxServer,
} from './sandbox.ts';

/** Before the app is ready: the switches that hold for every page. */
export function beforeReady(app: App) {
  app.commandLine.appendSwitch('blink-settings', 'dnsPrefetchingEnabled=false');
}

export const AUTOPLAY_POLICY = 'document-user-activation-required';

export async function applyWindowRules(options: {
  session: Session;
  contents: WebContents;
  sandbox: SandboxServer;
  /** den-kit's own page. */
  appOrigin: string;
  /** The hosts den-kit's own page connects to directly (`*.` for subdomains). */
  direct: readonly string[];
  /** Whether a frame at `url` may use `name` (media types for media). */
  permitted(url: string, name: string, mainFrame: boolean, media: string[]): boolean;
}) {
  const { session, contents, sandbox } = options;
  const refuse = await refusingPort();
  const rules = () =>
    session.setProxy(proxyConfig(refuse.port, [...options.direct, ...sandbox.allowedHosts()]));
  await rules();
  const stop = sandbox.onChange(() => void rules());
  contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  session.webRequest.onBeforeSendHeaders(
    { urls: ['http://*.localhost/*', 'ws://*.localhost/*'] },
    (details, callback) =>
      callback({ requestHeaders: { ...details.requestHeaders, [SECRET_HEADER]: sandbox.secret } }),
  );
  contents.on('will-frame-navigate', event => {
    if (event.isMainFrame) return;
    const frame = event.frame;
    if (
      !frame ||
      !mayNavigate(sandbox, { url: frame.url, origin: frame.origin }, event.url, {
        origin: options.appOrigin,
        hosts: options.direct,
      })
    )
      event.preventDefault();
  });
  session.setPermissionCheckHandler(
    (wc, name, origin, details) =>
      wc === contents &&
      options.permitted(
        details.requestingUrl ?? origin,
        name,
        details.isMainFrame,
        details.mediaType && details.mediaType !== 'unknown' ? [details.mediaType] : [],
      ),
  );
  session.setPermissionRequestHandler((wc, name, callback, details) =>
    callback(
      wc === contents &&
        options.permitted(
          details.requestingUrl,
          name,
          details.isMainFrame,
          'mediaTypes' in details ? (details.mediaTypes ?? []) : [],
        ),
    ),
  );
  return {
    close() {
      stop();
      refuse.server.close();
    },
  };
}
