// Source maps of a release for its crash reports (desktop/crash-reports.ts): the
// builds of the desktop app's page (vite.config.ts) and of its main process
// (scripts/build-desktop.ts) give each file a debug ID, by which Sentry finds the
// file's source map, and upload the source maps to the release's Sentry project, so
// that a report shows den-kit's own code. Only a build whose environment has
// DEN_KIT_SENTRY_AUTH_TOKEN, DEN_KIT_SENTRY_ORG and DEN_KIT_SENTRY_PROJECT uploads:
// den-kit's own names, so that Sentry settings someone keeps for other work never
// receive den-kit's files.
import { crashRelease } from '../desktop/crash-reports.ts';

/** The options of Sentry's build plugins for a build that uploads its source maps; null for a build that uploads none. */
export function sourceMapUpload(env: NodeJS.ProcessEnv, version: string) {
  const {
    DEN_KIT_SENTRY_AUTH_TOKEN: authToken,
    DEN_KIT_SENTRY_ORG: org,
    DEN_KIT_SENTRY_PROJECT: project,
  } = env;
  if (!authToken && !org && !project) return null;
  if (!authToken || !org || !project)
    throw new Error(
      'Uploading source maps to Sentry needs DEN_KIT_SENTRY_AUTH_TOKEN, DEN_KIT_SENTRY_ORG and DEN_KIT_SENTRY_PROJECT.',
    );
  // Sentry's CLI, which the plugins upload with, otherwise sends Sentry reports about itself.
  process.env.SENTRY_CLI_NO_TELEMETRY = '1';
  return {
    org,
    project,
    authToken,
    // The release the app's reports name; the app names it itself, so nothing is put in the files.
    release: { name: crashRelease(version), inject: false, setCommits: false, deploy: false },
    telemetry: false,
    // Stops the build, so that no release goes out whose reports cannot be read: Sentry's plugins
    // otherwise only log a failed upload.
    errorHandler: (error: Error) => {
      throw error;
    },
  } as const;
}
