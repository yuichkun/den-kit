import { join } from 'node:path';

/** Default electron-builder --dir --mac output for the host architecture. */
export function packagedMacApp(root: string, arch: NodeJS.Architecture = process.arch): string {
  return join(root, 'release', arch === 'arm64' ? 'mac-arm64' : 'mac', 'den-kit.app');
}
