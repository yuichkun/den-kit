import { describe, expect, it } from 'vitest';
import { settingsError, updatePresentation } from '../../../src/desktop/presentation.ts';

describe('update presentation', () => {
  it('hides updates where they do not apply', () => {
    expect(updatePresentation(undefined)).toBeNull();
    expect(updatePresentation({ state: 'off' })).toBeNull();
  });

  it('offers a restart only for a staged update and a check only when one can start', () => {
    expect(updatePresentation({ state: 'ready', version: '0.2.0' })).toEqual({ text: 'den-kit 0.2.0 is ready. It installs the next time you quit den-kit, or you can restart now.', check: false, install: true });
    expect(updatePresentation({ state: 'preparing', version: '0.2.0' })).toMatchObject({ check: false, install: false });
    expect(updatePresentation({ state: 'downloading', version: '0.2.0', percent: 12 })).toMatchObject({ text: 'Downloading den-kit 0.2.0… 12%', check: false, install: false });
    expect(updatePresentation({ state: 'current' })).toMatchObject({ check: true, install: false });
    expect(updatePresentation({ state: 'error', message: 'den-kit could not check for updates. It will try again later.' })).toMatchObject({ check: true });
    expect(updatePresentation({ state: 'move' })).toMatchObject({ check: false, install: false });
  });

  it('turns restart failures into a next step', () => {
    expect(settingsError(new Error('Finish the current AI request before restarting.'), 'update-install')).toBe('Wait for the current AI request to finish, then restart.');
    expect(settingsError(new Error('quitAndInstall failed'), 'update-install')).toBe('The update could not be installed now. It installs the next time you quit den-kit.');
    expect(settingsError(new Error('timeout'), 'update-check')).toBe('Updates could not be checked. Try again later.');
  });
});
