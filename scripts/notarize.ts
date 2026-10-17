// electron-builder runs this after signing each macOS app (afterSign in electron-builder.yml): it notarizes the app with
// notarytool and staples the ticket. It replaces electron-builder's own notarization (mac.notarize: false). That one
// (@electron/notarize 2.5.0) staples only once, because its retry wrapper never asks for a retry, so a single dropped
// connection to Apple's ticket service (api.apple-cloudkit.com) failed a whole release.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { AfterPackContext } from 'electron-builder';

/** What a finished command left behind, shaped like spawnSync's result. */
export interface CommandResult { status: number | null; signal?: NodeJS.Signals | null; stdout?: string; stderr?: string; error?: Error }

/**
 * stapler exits with 68 whenever Apple's ticket service gives it no response, and both stapler and notarytool name
 * the NSURLErrorDomain error behind a dropped connection.
 */
export function isNetworkFailure({ status, stdout = '', stderr = '' }: CommandResult): boolean {
  return status !== 0 && (status === 68 || /NSURLErrorDomain|The network connection was lost/.test(`${stdout}\n${stderr}`));
}

/** The command's outcome and everything it printed: stapler explains failures on stdout, codesign and spctl on stderr. */
export function describeFailure(command: string, { status, signal, stdout, stderr, error }: CommandResult): string {
  const outcome = error ? `could not run (${error.message})` : status === null ? `was stopped by ${signal ?? 'a signal'}` : status === 0 ? 'exited with code 0' : `failed with exit code ${status}`;
  return `${command} ${outcome}.\nstdout:\n${stdout?.trimEnd() || '(empty)'}\nstderr:\n${stderr?.trimEnd() || '(empty)'}`;
}

/** The waits before each retry: a command that keeps losing its connection runs four times over about two minutes. */
export const NETWORK_RETRY_DELAYS = [15_000, 30_000, 60_000];

export interface RetryOptions {
  delays?: number[];
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

/**
 * Runs `attempt` again after each delay for as long as it fails with a network error. Returns what the command printed
 * once it succeeds, and otherwise throws with its complete output.
 */
export async function withNetworkRetries(command: string, attempt: () => CommandResult | Promise<CommandResult>, { delays = NETWORK_RETRY_DELAYS, sleep = pause, log = console.warn }: RetryOptions = {}): Promise<string> {
  let result = await attempt();
  let attempts = 1;
  while (isNetworkFailure(result) && attempts <= delays.length) {
    const delay = delays[attempts - 1];
    log(`${describeFailure(command, result)}\nThis looks like a network error; retrying in ${delay / 1000} s (attempt ${attempts + 1} of ${delays.length + 1}).`);
    await sleep(delay);
    result = await attempt();
    attempts += 1;
  }
  if (result.status !== 0 || result.error) throw new Error(`${describeFailure(command, result)}${attempts > 1 ? `\n${attempts} attempts failed; the earlier failures are printed above.` : ''}`);
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}
const pause = (ms: number) => new Promise<void>(done => setTimeout(done, ms));

/**
 * notarytool's sign-in options, read from the environment variables electron-builder's own notarization used.
 * Undefined when none are set: local and pull request builds are not notarized.
 */
export function notaryCredentials(env: NodeJS.ProcessEnv): string[] | undefined {
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID, APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER, APPLE_KEYCHAIN_PROFILE, APPLE_KEYCHAIN } = env;
  if (APPLE_ID || APPLE_APP_SPECIFIC_PASSWORD) {
    if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) throw new Error('Notarizing with an Apple ID needs APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID.');
    return ['--apple-id', APPLE_ID, '--password', APPLE_APP_SPECIFIC_PASSWORD, '--team-id', APPLE_TEAM_ID];
  }
  if (APPLE_API_KEY || APPLE_API_KEY_ID || APPLE_API_ISSUER) {
    if (!APPLE_API_KEY || !APPLE_API_KEY_ID || !APPLE_API_ISSUER) throw new Error('Notarizing with an App Store Connect API key needs APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER.');
    return ['--key', APPLE_API_KEY, '--key-id', APPLE_API_KEY_ID, '--issuer', APPLE_API_ISSUER];
  }
  if (APPLE_KEYCHAIN_PROFILE) return ['--keychain-profile', APPLE_KEYCHAIN_PROFILE, ...(APPLE_KEYCHAIN ? ['--keychain', APPLE_KEYCHAIN] : [])];
  return undefined;
}

export interface NotarizeOptions extends RetryOptions {
  run?: (command: string, args: string[], cwd?: string) => Promise<CommandResult>;
}

/** Uploads a signed app to Apple's notary service, waits for the verdict and staples the ticket to the app. */
export async function notarizeApp(app: string, credentials: string[], options: NotarizeOptions = {}) {
  const { run = runCommand, log = console.log } = options;
  const work = await mkdtemp(join(tmpdir(), 'den-kit-notarize-'));
  try {
    const zip = join(work, `${basename(app, '.app')}.zip`);
    const zipped = await run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', basename(app), zip], dirname(app));
    if (zipped.status !== 0) throw new Error(describeFailure(`ditto ${app}`, zipped));
    log(`Notarizing ${app}; Apple usually takes a few minutes.`);
    // Error messages name the commands without their arguments, which carry the credentials.
    const submitted = await run('xcrun', ['notarytool', 'submit', zip, ...credentials, '--wait', '--output-format', 'json']);
    const submission = parseSubmission(submitted.stdout);
    if (submitted.status !== 0 || submission?.status !== 'Accepted') {
      // Apple's log lists the problems behind an Invalid verdict.
      const details = submission?.id ? await run('xcrun', ['notarytool', 'log', submission.id, ...credentials]) : undefined;
      throw new Error([
        `Apple did not notarize ${app}${submission?.status ? ` (status: ${submission.status})` : ''}.`,
        describeFailure('xcrun notarytool submit', submitted),
        ...(details ? [describeFailure(`xcrun notarytool log ${submission?.id}`, details)] : []),
      ].join('\n'));
    }
    log(`Apple notarized ${basename(app)} (submission ${submission.id}).`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  await withNetworkRetries(`xcrun stapler staple -v ${app}`, () => run('xcrun', ['stapler', 'staple', '-v', app]), options);
  log(`Stapled the notarization ticket to ${app}.`);
}

function parseSubmission(stdout = ''): { id?: string; status?: string } | undefined {
  try { return JSON.parse(stdout); } catch { return undefined; }
}

function runCommand(command: string, args: string[], cwd?: string): Promise<CommandResult> {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', error => resolve({ status: null, stdout, stderr, error }));
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

/**
 * The afterSign hook. electron-builder passes only the context. Its documented contract for a hook module is a default
 * export; 26.17 also looks up an export named after the hook first, which the tests use.
 */
export async function afterSign(context: AfterPackContext, env: NodeJS.ProcessEnv = process.env, options: NotarizeOptions = {}) {
  if (context.electronPlatformName !== 'darwin') return;
  const credentials = notaryCredentials(env);
  if (!credentials) {
    console.log('Skipping notarization: no Apple notarization credentials are set (see RELEASE.md).');
    return;
  }
  await notarizeApp(join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`), credentials, options);
}
export default afterSign;
