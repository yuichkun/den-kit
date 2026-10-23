// The host's Fetch (src/host): a file from a URL, for asset import. Only public
// addresses: every name is looked up first and the connection goes to the address
// that was checked (no second lookup that could answer differently), loopback,
// private, link-local and other special ranges are refused, and so is every
// redirect that leads there. The body stops at the size limit.
import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 30_000;

const SPECIAL = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  SPECIAL.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  SPECIAL.addSubnet(net, bits, 'ipv6');

/** Whether an address is a public one (not loopback, private, link-local, documentation, multicast…). */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (!family) return false;
  if (family === 6) {
    // IPv4 written as IPv6 (::ffff:10.0.0.1) is checked as IPv4.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return isPublicAddress(mapped[1]!);
    return !SPECIAL.check(address, 'ipv6');
  }
  return !SPECIAL.check(address, 'ipv4');
}

export class FetchRefused extends Error {}

type Address = { address: string; family: 4 | 6 };
/** How names are looked up and which addresses count as public (tests point names at local servers). */
export interface FetchNetwork {
  lookup(host: string): Promise<Address[]>;
  isPublic(address: string): boolean;
}
const SYSTEM: FetchNetwork = {
  lookup: host => lookup(host, { all: true, verbatim: true }) as Promise<Address[]>,
  isPublic: isPublicAddress,
};

/** The public address to connect to for `host`, or a refusal. */
async function publicAddress(host: string, network: FetchNetwork): Promise<Address> {
  const literal = host.replace(/^\[|\]$/g, '');
  const found = isIP(literal)
    ? [{ address: literal, family: isIP(literal) as 4 | 6 }]
    : await network.lookup(literal).catch(() => {
        throw new FetchRefused(`${host} could not be found.`);
      });
  if (!found.length) throw new FetchRefused(`${host} could not be found.`);
  // Every address the name has must be public: a name that also points inward is refused.
  const inward = found.find(a => !network.isPublic(a.address));
  if (inward)
    throw new FetchRefused(
      `${host} points to a private or local address (${inward.address}); only public addresses can be fetched.`,
    );
  return found[0]!;
}

function get(url: URL, to: Address): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method: 'GET',
        headers: { accept: '*/*', 'user-agent': 'den-kit' },
        // Connect to the checked address; TLS still checks the certificate against the name.
        lookup: (_host, options, callback) => {
          if ((options as { all?: boolean }).all)
            (callback as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [
              to,
            ]);
          else callback(null, to.address, to.family);
        },
        timeout: TIMEOUT_MS,
      },
      resolve,
    );
    request.on('timeout', () =>
      request.destroy(new FetchRefused('The server did not answer in time.')),
    );
    request.on('error', reject);
    request.end();
  });
}

/** A file from a public http(s) URL, up to `maxBytes`. */
export async function fetchPublic(
  address: string,
  maxBytes: number,
  network: FetchNetwork = SYSTEM,
): Promise<{ bytes: Uint8Array; type: string; url: string }> {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new FetchRefused('That is not a URL.');
  }
  for (let hop = 0; ; hop++) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
      throw new FetchRefused('Only http and https URLs can be fetched.');
    if (url.username || url.password)
      throw new FetchRefused('URLs with a user name or password cannot be fetched.');
    const response = await get(url, await publicAddress(url.hostname, network));
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume();
      if (hop >= MAX_REDIRECTS) throw new FetchRefused('Too many redirects.');
      url = new URL(response.headers.location, url);
      continue;
    }
    if (status < 200 || status >= 300) {
      response.resume();
      throw new FetchRefused(`The server answered ${status}.`);
    }
    const declared = Number(response.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      response.destroy();
      throw new FetchRefused(`The file is larger than ${maxBytes} bytes.`);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > maxBytes) {
        response.destroy();
        throw new FetchRefused(`The file is larger than ${maxBytes} bytes.`);
      }
      chunks.push(chunk);
    }
    return {
      bytes: new Uint8Array(Buffer.concat(chunks)),
      type: String(response.headers['content-type'] ?? '')
        .split(';')[0]!
        .trim(),
      url: url.href,
    };
  }
}
