import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AfterPackContext } from 'electron-builder';
import {
  afterSign,
  describeFailure,
  isNetworkFailure,
  notarizeApp,
  notaryCredentials,
  withNetworkRetries,
  type CommandResult,
} from '../../scripts/notarize.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
afterEach(() => {
  vi.restoreAllMocks();
});

// What stapler printed when the v0.1.1 release lost its connection to Apple's ticket service (shortened).
const dropped: CommandResult = {
  status: 68,
  stdout: [
    'Processing: /release/mac-arm64/den-kit.app',
    'Domain is api.apple-cloudkit.com',
    'Response is (null)',
    'error is Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost." UserInfo={NSLocalizedDescription=The network connection was lost.}',
    'Size of data is 0',
    "CloudKit's response is inconsistent with expections: (null)",
    'The staple and validate action failed! Error 68.',
  ].join('\n'),
  stderr: '',
};
// Apple has no ticket for an app it has not notarized.
const missing: CommandResult = {
  status: 65,
  stdout:
    'CloudKit query for den-kit.app (2/2/18030b8a) failed due to "Record not found".\nThe staple and validate action failed! Error 65.\n',
  stderr: '',
};
const ok = (stdout = ''): CommandResult => ({ status: 0, stdout, stderr: '' });

/** Returns the scripted results in order and records each wait instead of waiting. */
function script(...results: CommandResult[]) {
  const waits: number[] = [];
  const attempt = vi.fn(() => results.shift() ?? expect.fail('ran too often'));
  return {
    attempt,
    waits,
    options: {
      sleep: async (ms: number) => {
        waits.push(ms);
      },
      log: () => {},
    },
  };
}

// What `codesign -dv --verbose=2` reports on stderr for each kind of app.
const signatures: Record<string, CommandResult> = {
  developerId: {
    status: 0,
    stdout: '',
    stderr:
      'Signature size=8978\nAuthority=Developer ID Application: Escentier, LLC (TEAM123)\nAuthority=Developer ID Certification Authority\nAuthority=Apple Root CA\nTeamIdentifier=TEAM123\n',
  },
  adHoc: { status: 0, stdout: '', stderr: 'Signature=adhoc\nTeamIdentifier=not set\n' },
  unsigned: {
    status: 1,
    stdout: '',
    stderr: '/release/mac-arm64/den-kit.app: code object is not signed at all\n',
  },
};

/** Stands in for codesign, ditto, notarytool and stapler, recording every command. */
function tools({
  verdict = 'Accepted',
  staples = [ok('The staple and validate action worked!')],
  signature = signatures.developerId!,
}: { verdict?: string; staples?: CommandResult[]; signature?: CommandResult } = {}) {
  const commands: string[][] = [];
  const waits: number[] = [];
  const run = vi.fn(
    async (command: string, args: string[], _cwd?: string): Promise<CommandResult> => {
      commands.push([command, ...args]);
      if (command === 'codesign') return signature;
      if (command === 'ditto') return ok();
      if (args[0] === 'notarytool' && args[1] === 'submit')
        return ok(
          JSON.stringify({ id: 'submission-1', status: verdict, message: 'Processing complete' }),
        );
      if (args[0] === 'notarytool' && args[1] === 'log')
        return ok(
          '{"issues":[{"message":"The binary is not signed with a valid Developer ID certificate."}]}',
        );
      if (args[0] === 'stapler') return staples.shift() ?? expect.fail('stapled too often');
      return expect.fail(`unexpected command: ${command} ${args.join(' ')}`);
    },
  );
  return {
    commands,
    waits,
    run,
    options: {
      run,
      sleep: async (ms: number) => {
        waits.push(ms);
      },
      log: () => {},
    },
  };
}

describe('network failures', () => {
  it('recognizes stapler losing its connection to Apple', () => {
    expect(isNetworkFailure(dropped)).toBe(true);
    // stapler exits with 68 whenever it gets no usable response, whichever error it prints.
    expect(
      isNetworkFailure({
        status: 68,
        stdout:
          'error is Error Domain=NSPOSIXErrorDomain Code=1 "Operation not permitted"\nThe validate action failed! Error 68.\n',
      }),
    ).toBe(true);
    expect(
      isNetworkFailure({
        status: 1,
        stderr: 'Error: Error Domain=NSURLErrorDomain Code=-1001 "The request timed out."',
      }),
    ).toBe(true);
    expect(isNetworkFailure({ status: 1, stdout: 'The network connection was lost.' })).toBe(true);
  });

  it('treats every other outcome as final', () => {
    expect(isNetworkFailure(missing)).toBe(false);
    expect(isNetworkFailure(ok('error is Error Domain=NSURLErrorDomain Code=-1005'))).toBe(false);
    expect(isNetworkFailure({ status: null, error: new Error('spawn xcrun ENOENT') })).toBe(false);
    expect(isNetworkFailure({ status: null, signal: 'SIGTERM' })).toBe(false);
  });
});

describe('failure reports', () => {
  it('include both stdout and stderr', () => {
    expect(
      describeFailure('xcrun stapler validate -v den-kit.app', {
        status: 68,
        stdout: 'The validate action failed! Error 68.\n',
        stderr: 'warning\n',
      }),
    ).toBe(
      'xcrun stapler validate -v den-kit.app failed with exit code 68.\nstdout:\nThe validate action failed! Error 68.\nstderr:\nwarning',
    );
    expect(
      describeFailure('codesign -dv den-kit.app', {
        status: 1,
        stdout: '',
        stderr: 'code object is not signed at all',
      }),
    ).toBe(
      'codesign -dv den-kit.app failed with exit code 1.\nstdout:\n(empty)\nstderr:\ncode object is not signed at all',
    );
  });

  it('say why a command did not finish', () => {
    expect(
      describeFailure('xcrun stapler validate', {
        status: null,
        error: new Error('spawnSync xcrun ENOENT'),
      }),
    ).toMatch(/^xcrun stapler validate could not run \(spawnSync xcrun ENOENT\)\./);
    expect(describeFailure('xcrun stapler validate', { status: null, signal: 'SIGKILL' })).toMatch(
      /^xcrun stapler validate was stopped by SIGKILL\./,
    );
  });
});

describe('network retries', () => {
  it('retries a dropped connection with backoff and returns the output of the first success', async () => {
    const { attempt, waits, options } = script(
      dropped,
      dropped,
      ok('The staple and validate action worked!'),
    );
    await expect(withNetworkRetries('xcrun stapler staple', attempt, options)).resolves.toBe(
      'The staple and validate action worked!',
    );
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([15_000, 30_000]);
  });

  it('gives up after four attempts and reports everything stapler printed', async () => {
    const { attempt, waits, options } = script(dropped, dropped, dropped, dropped);
    const error = await withNetworkRetries('xcrun stapler staple', attempt, options).catch(
      (error: Error) => error,
    );
    expect(attempt).toHaveBeenCalledTimes(4);
    expect(waits).toEqual([15_000, 30_000, 60_000]);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      `xcrun stapler staple failed with exit code 68.\nstdout:\n${dropped.stdout}\nstderr:\n(empty)\n4 attempts failed; the earlier failures are printed above.`,
    );
  });

  it('stops at a failure that is not a network error', async () => {
    const retried = script(dropped, missing);
    await expect(
      withNetworkRetries('xcrun stapler staple', retried.attempt, retried.options),
    ).rejects.toThrow('Record not found');
    expect(retried.waits).toEqual([15_000]);
    const once = script(missing);
    await expect(
      withNetworkRetries('xcrun stapler validate', once.attempt, once.options),
    ).rejects.toThrow(
      /^xcrun stapler validate failed with exit code 65\.\nstdout:\nCloudKit query/,
    );
    expect(once.attempt).toHaveBeenCalledTimes(1);
    expect(once.waits).toEqual([]);
  });

  it('prints each failure before retrying it', async () => {
    const messages: string[] = [];
    const { attempt, options } = script(dropped, ok());
    await withNetworkRetries('xcrun stapler validate -v den-kit.app', attempt, {
      ...options,
      log: message => {
        messages.push(message);
      },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(dropped.stdout);
    expect(messages[0]).toMatch(/retrying in 15 s \(attempt 2 of 4\)\.$/);
  });
});

describe('notarization credentials', () => {
  const apiKey = {
    APPLE_API_KEY: '/runner/AuthKey.p8',
    APPLE_API_KEY_ID: 'KEY123',
    APPLE_API_ISSUER: 'issuer-id',
  };
  const appleId = {
    APPLE_ID: 'maintainer@example.com',
    APPLE_APP_SPECIFIC_PASSWORD: 'app-specific-password',
    APPLE_TEAM_ID: 'TEAM123',
  };

  it('reads an App Store Connect API key, an Apple ID or a notarytool keychain profile', () => {
    expect(notaryCredentials(apiKey)).toEqual([
      '--key',
      '/runner/AuthKey.p8',
      '--key-id',
      'KEY123',
      '--issuer',
      'issuer-id',
    ]);
    expect(notaryCredentials(appleId)).toEqual([
      '--apple-id',
      'maintainer@example.com',
      '--password',
      'app-specific-password',
      '--team-id',
      'TEAM123',
    ]);
    expect(notaryCredentials({ APPLE_KEYCHAIN_PROFILE: 'den-kit' })).toEqual([
      '--keychain-profile',
      'den-kit',
    ]);
    expect(
      notaryCredentials({ APPLE_KEYCHAIN_PROFILE: 'den-kit', APPLE_KEYCHAIN: '/ci.keychain-db' }),
    ).toEqual(['--keychain-profile', 'den-kit', '--keychain', '/ci.keychain-db']);
  });

  it('prefers an Apple ID like electron-builder and ignores unset GitHub secrets, which arrive empty', () => {
    expect(notaryCredentials({ ...apiKey, ...appleId })?.[0]).toBe('--apple-id');
    expect(
      notaryCredentials({
        ...apiKey,
        APPLE_ID: '',
        APPLE_APP_SPECIFIC_PASSWORD: '',
        APPLE_TEAM_ID: '',
      })?.[0],
    ).toBe('--key');
  });

  it('skips notarization without credentials', () => {
    expect(notaryCredentials({})).toBeUndefined();
    expect(
      notaryCredentials({
        APPLE_ID: '',
        APPLE_API_KEY: '',
        APPLE_API_KEY_ID: '',
        APPLE_API_ISSUER: '',
        APPLE_TEAM_ID: 'TEAM123',
      }),
    ).toBeUndefined();
  });

  it.each([
    [
      { APPLE_ID: 'maintainer@example.com', APPLE_APP_SPECIFIC_PASSWORD: 'app-specific-password' },
      'APPLE_TEAM_ID',
    ],
    [
      { APPLE_APP_SPECIFIC_PASSWORD: 'app-specific-password', APPLE_TEAM_ID: 'TEAM123' },
      'APPLE_ID',
    ],
    [{ APPLE_API_KEY_ID: 'KEY123', APPLE_API_ISSUER: 'issuer-id' }, 'APPLE_API_KEY'],
  ])('refuses an incomplete set: %o', (env, name) => {
    expect(() => notaryCredentials(env)).toThrow(name);
  });
});

describe('notarizing an app', () => {
  const app = '/release/mac-arm64/den-kit.app';
  const credentials = [
    '--apple-id',
    'maintainer@example.com',
    '--password',
    'app-specific-password',
    '--team-id',
    'TEAM123',
  ];

  it('uploads the signed app, waits for Apple and staples the ticket despite a dropped connection', async () => {
    const { commands, waits, run, options } = tools({
      staples: [dropped, ok('The staple and validate action worked!')],
    });
    await notarizeApp(app, credentials, options);
    const zip = commands[0]!.at(-1)!;
    expect(zip).toMatch(/\/den-kit-notarize-[^/]+\/den-kit\.zip$/);
    expect(commands).toEqual([
      ['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', 'den-kit.app', zip],
      ['xcrun', 'notarytool', 'submit', zip, ...credentials, '--wait', '--output-format', 'json'],
      ['xcrun', 'stapler', 'staple', '-v', app],
      ['xcrun', 'stapler', 'staple', '-v', app],
    ]);
    expect(run.mock.calls[0]![2]).toBe('/release/mac-arm64');
    expect(waits).toEqual([15_000]);
  });

  it("reports Apple's log when the app is not accepted, without the credentials", async () => {
    const { commands, options } = tools({ verdict: 'Invalid' });
    const error = await notarizeApp(app, credentials, options).catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toMatch(
      /^Apple did not notarize \/release\/mac-arm64\/den-kit\.app \(status: Invalid\)\.\nxcrun notarytool submit exited with code 0\./,
    );
    expect(message).toContain('The binary is not signed with a valid Developer ID certificate.');
    expect(message).not.toContain('app-specific-password');
    expect(commands.at(-1)).toEqual(['xcrun', 'notarytool', 'log', 'submission-1', ...credentials]);
    expect(commands.some(command => command[1] === 'stapler')).toBe(false);
  });

  it("fails with stapler's output when the connection keeps dropping", async () => {
    const { waits, options } = tools({ staples: [dropped, dropped, dropped, dropped] });
    await expect(notarizeApp(app, credentials, options)).rejects.toThrow(
      /Error 68\.\nstderr:\n\(empty\)\n4 attempts failed/,
    );
    expect(waits).toEqual([15_000, 30_000, 60_000]);
  });
});

describe('afterSign hook', () => {
  const context = (electronPlatformName = 'darwin') =>
    ({
      electronPlatformName,
      appOutDir: '/release/mac-arm64',
      packager: { appInfo: { productFilename: 'den-kit' } },
    }) as unknown as AfterPackContext;
  const env = {
    APPLE_API_KEY: '/runner/AuthKey.p8',
    APPLE_API_KEY_ID: 'KEY123',
    APPLE_API_ISSUER: 'issuer-id',
  };

  it('notarizes and staples the app electron-builder just signed', async () => {
    const { commands, options } = tools();
    await afterSign(context(), env, options);
    expect(commands.map(command => command.slice(0, 3))).toEqual([
      ['codesign', '-dv', '--verbose=2'],
      ['ditto', '-c', '-k'],
      ['xcrun', 'notarytool', 'submit'],
      ['xcrun', 'stapler', 'staple'],
    ]);
    expect(commands[0]).toEqual([
      'codesign',
      '-dv',
      '--verbose=2',
      '/release/mac-arm64/den-kit.app',
    ]);
    expect(commands.at(-1)).toEqual([
      'xcrun',
      'stapler',
      'staple',
      '-v',
      '/release/mac-arm64/den-kit.app',
    ]);
  });

  // electron-builder runs the hook after unsigned builds too (identity: null, or no identity in the keychain). Without
  // a Developer ID signature, Apple would reject the app, so a maintainer with credentials in their shell could not
  // make a quick unsigned package.
  it.each([
    ['ad-hoc', signatures.adHoc!],
    ['unsigned', signatures.unsigned!],
  ])('leaves an %s app alone', async (_, signature) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { commands, options } = tools({ signature });
    await afterSign(context(), env, options);
    expect(commands.map(command => command[0])).toEqual(['codesign']);
    expect(log).toHaveBeenCalledWith(
      'Skipping notarization: /release/mac-arm64/den-kit.app is not signed with a Developer ID Application identity.',
    );
  });

  // electron-builder documents a default export for hook modules, and 26.17 looks up the export named after the hook
  // first. Check both through electron-builder's own loader, so the hook keeps loading if a later electron-builder
  // follows only its documentation.
  it('is the function electron-builder loads from electron-builder.yml', async () => {
    const configured = /^afterSign:\s*(\S+)$/m.exec(
      readFileSync(join(root, 'electron-builder.yml'), 'utf8'),
    )?.[1];
    expect(configured).toBe('./scripts/notarize.ts');
    // electron-builder's own loader, found from electron-builder the way its CLI finds it.
    const builder = createRequire(createRequire(import.meta.url).resolve('electron-builder'));
    const { resolveFunction } = builder('app-builder-lib/out/util/resolve.js') as {
      resolveFunction: (type: string, path: string, name: string, root: string) => Promise<unknown>;
    };
    // For a name the module does not export, the loader falls back to the default export.
    for (const name of ['afterSign', 'anotherHook']) {
      const hook = await resolveFunction('module', join(root, configured!), name, root);
      expect(hook).toBeTypeOf('function');
      expect((hook as () => unknown).name).toBe('afterSign');
    }
  });

  it('skips builds without credentials and Mac App Store builds', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { commands, options } = tools();
    await afterSign(context(), {}, options);
    await afterSign(context('mas'), env, options);
    expect(commands).toEqual([]);
  });
});
