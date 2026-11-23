// Who may read the counts (receiver/access.ts): a request with a token that Cloudflare Access
// signed for the page's application and that is valid now; every other token is turned away,
// and one that is not even a token is turned away before the team's keys are fetched.
import { describe, expect, it } from 'vite-plus/test';
import { admitted } from '../../../receiver/access.ts';
import { ACCESS, testAccess, withToken } from '../../helpers/access.ts';

const NOW = new Date('2026-12-10T08:00:00Z');
const SECONDS = NOW.getTime() / 1000;

describe('who may read the counts', () => {
  it('admits a token Access signed for the page, checked with the team’s keys', async () => {
    const access = await testAccess(NOW);
    expect(await admitted(withToken(await access.token()), ACCESS, NOW, access.keys)).toBe(true);
    expect(access.asked).toEqual([`${ACCESS.team}/cdn-cgi/access/certs`]);
    // The audience may also be one string, and the team's address may end with a slash.
    const single = await access.token({ aud: ACCESS.aud });
    expect(await admitted(withToken(single), ACCESS, NOW, access.keys)).toBe(true);
    const slash = { ...ACCESS, team: `${ACCESS.team}/` };
    expect(await admitted(withToken(await access.token()), slash, NOW, access.keys)).toBe(true);
    expect(access.asked.at(-1)).toBe(`${ACCESS.team}/cdn-cgi/access/certs`);
    // A token without nbf is valid from when it was made.
    const noStart = await access.token({ nbf: undefined });
    expect(await admitted(withToken(noStart), ACCESS, NOW, access.keys)).toBe(true);
  });

  it('turns away a token for another application or team, or not valid now', async () => {
    const access = await testAccess(NOW);
    for (const claims of [
      { aud: ['another-application'] },
      { aud: 'another-application' },
      { aud: undefined },
      { iss: 'https://another-team.cloudflareaccess.com' },
      { iss: undefined },
      { exp: SECONDS },
      { exp: SECONDS - 1 },
      { exp: undefined },
      { exp: String(SECONDS + 3600) },
      { nbf: SECONDS + 1 },
      { nbf: String(SECONDS - 60) },
    ]) {
      const token = await access.token(claims);
      expect(
        await admitted(withToken(token), ACCESS, NOW, access.keys),
        JSON.stringify(claims),
      ).toBe(false);
    }
  });

  it('turns away a token that the team’s keys did not sign, or that was changed', async () => {
    const access = await testAccess(NOW);
    const stranger = await access.token({}, {}, true);
    expect(await admitted(withToken(stranger), ACCESS, NOW, access.keys)).toBe(false);
    const unknownKey = await access.token({}, { kid: 'key-2' });
    expect(await admitted(withToken(unknownKey), ACCESS, NOW, access.keys)).toBe(false);
    const [head, body, signature] = (await access.token()).split('.');
    const [, other] = (await access.token({ email: 'someone-else@example.com' })).split('.');
    expect(
      await admitted(withToken(`${head}.${other}.${signature}`), ACCESS, NOW, access.keys),
    ).toBe(false);
    const flipped = `${signature.slice(0, 10)}${signature[10] === 'A' ? 'B' : 'A'}${signature.slice(11)}`;
    expect(await admitted(withToken(`${head}.${body}.${flipped}`), ACCESS, NOW, access.keys)).toBe(
      false,
    );
    expect(
      await admitted(withToken(`${head}.${body}.${signature}`), ACCESS, NOW, access.keys),
    ).toBe(true);
  });

  it('turns away what is not an RS256 token without fetching the keys', async () => {
    const access = await testAccess(NOW);
    const [, body] = (await access.token()).split('.');
    const unsigned = `${Buffer.from('{"alg":"none","kid":"key-1"}').toString('base64url')}.${body}.`;
    for (const token of [
      null,
      '',
      'not a token',
      'a.b',
      'a.b.c.d',
      '%%%.%%%.%%%',
      unsigned,
      await access.token({}, { alg: 'HS256' }),
      await access.token({}, { kid: undefined }),
      `${Buffer.from('[1]').toString('base64url')}.${body}.c2ln`,
    ])
      expect(await admitted(withToken(token), ACCESS, NOW, access.keys), String(token)).toBe(false);
    expect(access.asked).toEqual([]);
  });

  it('throws when the team’s keys cannot be fetched', async () => {
    const access = await testAccess(NOW);
    const failing = async () => {
      throw new Error('Cloudflare Access keys: 500');
    };
    await expect(admitted(withToken(await access.token()), ACCESS, NOW, failing)).rejects.toThrow(
      'Cloudflare Access keys: 500',
    );
  });
});
