import { PodUnavailable } from '../../src/workspace/pod-io.ts';

/** An installed-app failure with an action the person can actually take. */
class ProjectToolsUnavailable extends PodUnavailable {}

/** Keep setup diagnostics in the console, without sending operator secrets to the UI. */
export function desktopProjectError(
  error: unknown,
  secrets: readonly string[] = [],
): PodUnavailable {
  if (error instanceof ProjectToolsUnavailable) return error;
  const detail = error instanceof Error ? error.message : String(error);
  let diagnostic = detail;
  for (const secret of secrets)
    if (secret) diagnostic = diagnostic.split(secret).join('[redacted]');
  console.warn('[den-kit] Project tools:', diagnostic);

  if (/device already opened|disk.*open.*another|another den-kit tab/i.test(detail)) {
    return new ProjectToolsUnavailable(
      'Project tools are already in use.',
      'Close any other den-kit windows, then reopen the app.',
    );
  }
  if (/npm install failed/i.test(detail)) {
    return new ProjectToolsUnavailable(
      'Project dependencies could not be installed.',
      'Check your internet connection and try again. If the problem continues, ask the AI to check the project dependencies, or inspect the terminal output.',
    );
  }
  if (/dev server|project preview/i.test(detail)) {
    return new ProjectToolsUnavailable(
      'The project preview could not start.',
      'Ask the AI to check the project, or inspect the terminal output.',
    );
  }
  const credentialFailure =
    /\b(?:401|403)\b|api[ _]?key.*(?:invalid|expired|missing|refused|rejected|unauthori[sz]ed|denied|problem)|(?:invalid|expired|missing|refused|rejected|unauthori[sz]ed)\s+(?:(?:api|access|auth(?:entication)?)\s+)?(?:key|token|credentials?)\b|\b(?:access|auth(?:entication)?)\s+token\b|\bauthentication\s+(?:failed|failure|error|required)\b|unavailable in this app build/i;
  if (credentialFailure.test(detail)) {
    return new ProjectToolsUnavailable(
      'Project tools are unavailable in this app build.',
      'Contact the app maintainer for an updated build.',
    );
  }
  if (
    /websocket connection failed|could not connect|unable to connect|failed to fetch|fetch failed|network.*(?:failed|error)|connection.*(?:refused|reset)/i.test(
      detail,
    )
  ) {
    return new ProjectToolsUnavailable(
      'Project tools could not connect.',
      'Check your internet connection and reopen den-kit. If the problem continues, contact the app maintainer.',
    );
  }
  if (/not started after|\btimeout\b|timed? out|too long/i.test(detail)) {
    return new ProjectToolsUnavailable(
      'Project tools are taking longer than expected.',
      'Check your internet connection and try again in a minute. If they still cannot start, reopen the app.',
    );
  }
  if (/cross-origin|browser is too old|resizable WebAssembly|Atomics\.waitAsync/i.test(detail)) {
    return new ProjectToolsUnavailable(
      'Project tools could not start in this app version.',
      'Update den-kit and try again. If the problem continues, contact the app maintainer.',
    );
  }
  return new ProjectToolsUnavailable(
    'Project tools could not start.',
    'Check your internet connection and reopen den-kit. If the problem continues, contact the app maintainer.',
  );
}
