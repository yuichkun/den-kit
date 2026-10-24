// The desktop app's Fetch: public addresses only (after DNS and at every redirect),
// and nothing over the size limit. Names are pointed at local servers here: the
// test's "public" name is one this check treats as public, everything else is real.
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { fetchPublic, isPublicAddress, type FetchNetwork } from '../../desktop/fetch.ts';

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise(r => s.close(r));
});
async function serve(handler: Parameters<typeof createServer>[1]): Promise<number> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return (server.address() as { port: number }).port;
}
/** public.test is this machine, counted as a public address; every other name is looked up for real. */
const network: FetchNetwork = {
  lookup: async host =>
    host === 'public.test' ? [{ address: '127.0.0.1', family: 4 }] : [{ address: host, family: 4 }],
  isPublic: address => address === '127.0.0.1' || isPublicAddress(address),
};

describe('desktop fetch', () => {
  it('tells public addresses from private, local and special ones', () => {
    for (const a of ['93.184.216.34', '2606:4700::6810:85e5', '8.8.8.8'])
      expect(isPublicAddress(a), a).toBe(true);
    for (const a of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      'not an address',
    ])
      expect(isPublicAddress(a), a).toBe(false);
  });

  it('refuses loopback and private addresses, also when a public server redirects there', async () => {
    const local = await serve((_req, res) => res.end('secret'));
    await expect(fetchPublic(`http://127.0.0.1:${local}/`, 1000)).rejects.toThrow(
      /private or local address/,
    );
    await expect(fetchPublic(`http://localhost:${local}/`, 1000)).rejects.toThrow(
      /private or local address/,
    );
    const redirecting = await serve((_req, res) =>
      res.writeHead(302, { location: `http://169.254.169.254/latest/meta-data/` }).end(),
    );
    await expect(fetchPublic(`http://public.test:${redirecting}/`, 1000, network)).rejects.toThrow(
      /169\.254\.169\.254.*private or local address/,
    );
    await expect(fetchPublic('file:///etc/passwd', 1000)).rejects.toThrow(/Only http and https/);
  });

  it('gets a public file with its type, follows redirects, and stops at the size limit', async () => {
    const port = await serve((req, res) => {
      if (req.url === '/moved') res.writeHead(301, { location: '/kick.wav' }).end();
      else if (req.url === '/kick.wav')
        res.writeHead(200, { 'content-type': 'audio/wav; codec=1' }).end(Buffer.alloc(100, 1));
      else if (req.url === '/big') res.writeHead(200).end(Buffer.alloc(5000));
      else {
        // No length given: the limit stops the body as it comes.
        res.writeHead(200);
        res.write(Buffer.alloc(3000));
        res.end(Buffer.alloc(3000));
      }
    });
    const got = await fetchPublic(`http://public.test:${port}/moved`, 1000, network);
    expect(got).toMatchObject({ type: 'audio/wav', url: `http://public.test:${port}/kick.wav` });
    expect(got.bytes.length).toBe(100);
    await expect(fetchPublic(`http://public.test:${port}/big`, 1000, network)).rejects.toThrow(
      /larger than 1000 bytes/,
    );
    await expect(fetchPublic(`http://public.test:${port}/streamed`, 4000, network)).rejects.toThrow(
      /larger than 4000 bytes/,
    );
  });
});
