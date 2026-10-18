import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { desktopProjectError } from '../../../src/pod/user-errors.ts';

afterEach(() => vi.restoreAllMocks());

describe('installed-app project recovery', () => {
  it('routes missing bundled credentials to the maintainer and redacts the operator key in diagnostics', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const key = 'operator-secret-for-this-test';
    const error = desktopProjectError(new Error(`BrowserPod API key ${key} was refused; set BROWSERPOD_API_KEY in .env.`), [key]);
    expect(`${error.message} ${error.fix}`).toMatch(/app build.*app maintainer/s);
    expect(`${error.message} ${error.fix}`).not.toMatch(/BrowserPod|API key|BROWSERPOD_API_KEY|\.env|operator-secret/);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(key);
    expect(JSON.stringify(warn.mock.calls)).toContain('[redacted]');
  });

  it('offers an app update for an incompatible runtime, without browser setup instructions', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = desktopProjectError(new Error('This browser is too old for BrowserPod (Atomics.waitAsync is missing). Update Chrome.'));
    expect(error.fix).toMatch(/Update den-kit/);
    expect(`${error.message} ${error.fix}`).not.toMatch(/BrowserPod|Chrome|Atomics|browser/);
  });

  it('keeps a preview syntax error actionable in the project instead of diagnosing bundled credentials', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = desktopProjectError(new Error('dev server failed: Unexpected token export'));
    expect(error.message).toMatch(/project preview/i);
    expect(error.fix).toMatch(/AI.*project.*terminal/s);
    expect(`${error.message} ${error.fix}`).not.toMatch(/app build|maintainer|credential/);
  });

  it('treats a package registry authorization failure as a dependency installation problem', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = desktopProjectError(new Error('npm install failed: HTTP 401 unauthorized'));
    expect(error.message).toMatch(/Project dependencies/);
    expect(error.fix).toMatch(/project dependencies/);
    expect(`${error.message} ${error.fix}`).not.toMatch(/app build|updated build|maintainer/);
  });

  it('does not mistake a generic JavaScript token error for an authentication token failure', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = desktopProjectError(new Error('SyntaxError: Unexpected token export'));
    expect(error.fix).toMatch(/internet connection.*reopen den-kit/s);
    expect(`${error.message} ${error.fix}`).not.toMatch(/app build|updated build|credential|access token/);
  });

  it('routes explicit service authorization failures to an updated app build', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const detail of ['BrowserPod connection rejected: HTTP 401', 'BrowserPod connection denied: HTTP 403', 'Expired access token']) {
      const error = desktopProjectError(new Error(detail));
      expect(error.message, detail).toMatch(/unavailable in this app build/);
      expect(error.fix, detail).toMatch(/app maintainer.*updated build/s);
    }
  });

  it('offers network recovery for an ambiguous SDK transport failure instead of assuming its key is invalid', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = desktopProjectError(new Error('BrowserPod could not connect: WebSocket connection failed; check your API key'));
    expect(error.message).toMatch(/could not connect/);
    expect(error.fix).toMatch(/internet connection.*reopen den-kit/s);
    expect(`${error.message} ${error.fix}`).not.toMatch(/app build|updated build|API key|BrowserPod/);
  });

  it('does not remap an already translated failure or duplicate its diagnostic', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = desktopProjectError(new Error('Device already opened in another den-kit tab'));
    expect(desktopProjectError(error)).toBe(error);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error.fix).toMatch(/Close any other den-kit windows/);
  });
});
