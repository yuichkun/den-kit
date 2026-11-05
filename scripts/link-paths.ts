// electron-builder uses executableName for both the Mac bundle and its binary.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const LINK_EXECUTABLE = 'den-kit-link-prototype';

export function packagedLinkApp(root: string, arch: NodeJS.Architecture = process.arch): string {
  return join(
    root,
    'release-link',
    arch === 'arm64' ? 'mac-arm64' : 'mac',
    `${LINK_EXECUTABLE}.app`,
  );
}

export function requirePackagedLinkApp(
  root: string,
  arch: NodeJS.Architecture = process.arch,
): string {
  const app = packagedLinkApp(root, arch);
  if (!existsSync(join(app, 'Contents', 'MacOS', LINK_EXECUTABLE)))
    throw new Error(
      `No packaged executable found in ${app}. Build it with vp run desktop:link:package`,
    );
  return app;
}
