import { describe, expect, it } from 'vite-plus/test';
import { appPort } from '../../../desktop/renderer-server.ts';

describe('isolated desktop check ports', () => {
  it('keeps the installed app origin fixed even when a check port is present', () => {
    expect(appPort({ KIT_DESKTOP_CHECK_PORT: '6193' })).toBe(5247);
    expect(appPort({ KIT_DESKTOP_USER_DATA: '', KIT_DESKTOP_CHECK_PORT: '6193' })).toBe(5247);
  });

  it('allows a valid port only with an explicitly isolated profile', () => {
    expect(appPort({ KIT_DESKTOP_USER_DATA: '/tmp/isolated-den-kit-profile', KIT_DESKTOP_CHECK_PORT: '6193' })).toBe(6193);
  });

  it('uses the normal port when an isolated check has no valid requested port', () => {
    for (const port of [undefined, '', '0', '1023', '65536', '6193.5', 'unknown']) {
      expect(appPort({ KIT_DESKTOP_USER_DATA: '/tmp/isolated-den-kit-profile', KIT_DESKTOP_CHECK_PORT: port })).toBe(5247);
    }
  });
});
