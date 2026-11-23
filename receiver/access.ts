// Who may read the counts (dashboard.ts): a person that Cloudflare Access let in. Access adds a
// token it signed to each request it lets through, in the Cf-Access-Jwt-Assertion header; this
// checks the token against the team's public keys, as Cloudflare advises
// (https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/),
// so that the counts stay closed also when Access is not in front of the Worker.

export interface AccessSettings {
  /** The Access team's address: https://<team>.cloudflareaccess.com. */
  team: string;
  /** The Access application's audience (AUD) tag. */
  aud: string;
}

/** The team's public keys, as JSON Web Keys. */
export type FetchKeys = (url: string) => Promise<{ keys: Array<JsonWebKey & { kid?: string }> }>;

export const fetchKeys: FetchKeys = async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cloudflare Access keys: ${response.status}`);
  return (await response.json()) as Awaited<ReturnType<FetchKeys>>;
};

/**
 * Whether the request carries a token that Access signed for this application, valid at `now`.
 * Throws when the keys cannot be fetched.
 */
export async function admitted(
  request: Request,
  settings: AccessSettings,
  now: Date,
  keys: FetchKeys = fetchKeys,
): Promise<boolean> {
  const parts = request.headers.get('cf-access-jwt-assertion')?.split('.') ?? [];
  if (parts.length !== 3) return false;
  const [head, body, signature] = parts;
  const header = json(head);
  const claims = json(body);
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string' || !claims) return false;
  const team = settings.team.replace(/\/+$/, '');
  const audiences: unknown[] = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const seconds = now.getTime() / 1000;
  if (claims.iss !== team || !audiences.includes(settings.aud)) return false;
  if (typeof claims.exp !== 'number' || claims.exp <= seconds) return false;
  if (claims.nbf !== undefined && !(typeof claims.nbf === 'number' && claims.nbf <= seconds))
    return false;
  const jwk = (await keys(`${team}/cdn-cgi/access/certs`)).keys.find(k => k.kid === header.kid);
  if (!jwk) return false;
  try {
    const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
    const key = await crypto.subtle.importKey('jwk', jwk, algorithm, false, ['verify']);
    return await crypto.subtle.verify(
      algorithm,
      key,
      bytes(signature),
      new TextEncoder().encode(`${head}.${body}`),
    );
  } catch {
    return false;
  }
}

/** The bytes of base64url text. */
function bytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

/** The JSON object in base64url text, or null. */
function json(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes(text)));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
