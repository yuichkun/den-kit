// The desktop app's usage events on the wire (desktop/analytics.ts), to a local
// server standing in for the receiver: one JSON POST of the waiting events with only
// den-kit's own headers, no redirect followed, and the events kept when none arrive.
import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { DesktopAnalytics, postJson } from '../../desktop/analytics.ts';

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise(r => s.close(r));
});
async function serve(
  reply: (
    req: IncomingMessage,
    body: string,
  ) => { status: number; headers?: Record<string, string> },
) {
  const seen: Array<{
    method: string;
    url: string;
    headers: IncomingMessage['headers'];
    body: string;
  }> = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      const r = reply(req, body);
      res.writeHead(r.status, r.headers).end();
    });
  });
  servers.push(server);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return { seen, origin: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}

describe('usage events on the wire', () => {
  it('posts the waiting events as JSON with no cookies and no headers that tell about the person', async () => {
    const receiver = await serve(() => ({ status: 202 }));
    expect(
      await postJson(`${receiver.origin}/v1/usage`, '{"records":[]}', AbortSignal.timeout(5000)),
    ).toBe(202);
    const [request] = receiver.seen;
    expect(request).toMatchObject({ method: 'POST', url: '/v1/usage', body: '{"records":[]}' });
    expect(request!.headers['content-type']).toBe('application/json');
    expect(request!.headers['user-agent']).toBe('den-kit');
    expect(request!.headers.cookie).toBeUndefined();
    expect(request!.headers.referer).toBeUndefined();
  });

  it('does not follow a redirect', async () => {
    const elsewhere = await serve(() => ({ status: 202 }));
    const receiver = await serve(() => ({
      status: 307,
      headers: { location: `${elsewhere.origin}/collect` },
    }));
    await expect(
      postJson(`${receiver.origin}/v1/usage`, '{"records":[]}', AbortSignal.timeout(5000)),
    ).rejects.toThrow();
    expect(elsewhere.seen).toEqual([]);
  });

  it('sends what waits before quitting, and keeps it when the receiver cannot be reached', async () => {
    const receiver = await serve(() => ({ status: 202 }));
    const directory = mkdtempSync(join(tmpdir(), 'den-kit-analytics-'));
    let target = `${receiver.origin}/v1/usage`;
    const options = {
      directory,
      usageUrl: 'https://usage.example.com/v1/usage',
      contact: 'privacy@example.com',
      version: '1.0.0',
      os: 'macOS 26.2',
      arch: 'arm64',
      // The build's https address stands for the local server here.
      post: (_url: string, body: string, signal: AbortSignal) => postJson(target, body, signal),
    };
    const analytics = new DesktopAnalytics(options);
    analytics.choose({ usage: true });
    analytics.record('app_used');
    analytics.record('work_exported');
    await analytics.flush(5000);
    expect(receiver.seen).toHaveLength(1);
    expect(
      JSON.parse(receiver.seen[0]!.body).records.map((r: { event: string }) => r.event),
    ).toEqual(['app_used', 'work_exported']);

    target = 'http://127.0.0.1:9/v1/usage'; // nothing listens there
    analytics.record('ai_requested');
    await analytics.flush(5000);
    analytics.dispose();
    target = `${receiver.origin}/v1/usage`;
    const next = new DesktopAnalytics(options);
    await next.flush(5000);
    expect(
      JSON.parse(receiver.seen[1]!.body).records.map((r: { event: string }) => r.event),
    ).toEqual(['ai_requested']);
    next.dispose();
  });
});
