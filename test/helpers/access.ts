// Tokens like those Cloudflare Access signs (receiver/access.ts), for the usage receiver's tests:
// a key pair of the test's own, its public key served as the team's keys, and tokens signed with
// its private key.
import type { AccessSettings, FetchKeys } from '../../receiver/access.ts';

export const ACCESS: AccessSettings = {
  team: 'https://den-kit-test.cloudflareaccess.com',
  aud: 'aud-of-the-page',
};

const RSA = {
  name: 'RSASSA-PKCS1-v1_5',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
};

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));

export interface TestAccess {
  /** The team's public keys, as Access serves them. */
  keys: FetchKeys;
  /** The addresses `keys` was asked for. */
  asked: string[];
  /**
   * A token with these claims and header, each added to or replacing those of a token Access
   * signs for the page at `now`; signed with the test's key, or with `other` another key's.
   */
  token(
    claims?: Record<string, unknown>,
    header?: Record<string, unknown>,
    other?: boolean,
  ): Promise<string>;
}

export async function testAccess(now: Date): Promise<TestAccess> {
  const [pair, stranger] = (await Promise.all([
    crypto.subtle.generateKey(RSA, true, ['sign', 'verify']),
    crypto.subtle.generateKey(RSA, true, ['sign', 'verify']),
  ])) as CryptoKeyPair[];
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'key-1' };
  const asked: string[] = [];
  const seconds = Math.floor(now.getTime() / 1000);
  return {
    asked,
    keys: async url => {
      asked.push(url);
      return { keys: [jwk] };
    },
    async token(claims = {}, header = {}, other = false) {
      const head = encode({ alg: 'RS256', kid: 'key-1', typ: 'JWT', ...header });
      const body = encode({
        iss: ACCESS.team,
        aud: [ACCESS.aud],
        email: 'someone@example.com',
        iat: seconds - 60,
        nbf: seconds - 60,
        exp: seconds + 3600,
        ...claims,
      });
      const signature = await crypto.subtle.sign(
        RSA,
        (other ? stranger : pair).privateKey,
        new TextEncoder().encode(`${head}.${body}`),
      );
      return `${head}.${body}.${base64url(new Uint8Array(signature))}`;
    },
  };
}

/** A request for the page that carries `token` as Access would. */
export const withToken = (token: string | null, init: RequestInit = {}) =>
  new Request('https://stats.den-kit.com/', {
    ...init,
    headers: token ? { 'cf-access-jwt-assertion': token } : {},
  });
