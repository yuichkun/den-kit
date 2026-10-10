import { expect, it } from 'vitest';
import { allowedPermission } from '../../../desktop/permissions.ts';

it('accepts Electron URL-shaped origins only for the trusted main frame and necessary permissions', () => {
  expect(allowedPermission('http://127.0.0.1:5247/', 'midi', true)).toBe(true);
  expect(allowedPermission('http://127.0.0.1:5247', 'media', true)).toBe(true);
  expect(allowedPermission('http://127.0.0.1:5247/', 'media', false)).toBe(false);
  expect(allowedPermission('http://127.0.0.1:5247.evil.test/', 'media', true)).toBe(false);
  expect(allowedPermission('https://browserportal.io', 'media', true)).toBe(false);
  expect(allowedPermission('http://127.0.0.1:5247/', 'midiSysex', true)).toBe(false);
  expect(allowedPermission('http://127.0.0.1:5247/', 'display-capture', true)).toBe(false);
  expect(allowedPermission('not a URL', 'media', true)).toBe(false);
});
