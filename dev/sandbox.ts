// The Sandbox interface (src/host) in the development host: each work's origin is
// the AI bridge's server under the work's own host name (desktop/sandbox.ts, run by
// `vp run dev` and the e2e harness). The page opens and closes works through the
// bridge (POST /__kit/sandbox with the bridge's token). A browser cannot add the
// desktop app's secret header, and the work's contents stay in the page, so here
// the sandbox serves the dev server's pages and nothing else (no files, no code
// parts as last built); the rules in its responses are the same.
import type { Sandbox } from '../src/host/index.ts';

export function devSandbox(token: string, port: number): Sandbox {
  const origin = (work: string) => `http://${work}.localhost:${port}`;
  const send = async (body: Record<string, unknown>) => {
    const r = await fetch('/__kit/sandbox', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`The sandbox refused to ${String(body.op)} the work (${r.status}).`);
  };
  return {
    open: (work, settings) =>
      send({
        op: 'open',
        work,
        settings: {
          portal: settings.devServer,
          origins: settings.origins,
          devices: settings.devices,
        },
      }),
    close: work => void send({ op: 'close', work }).catch(() => undefined),
    origin,
    servesContents: false,
    fileUrl: () => null,
    onRefused: () => () => undefined,
  };
}
