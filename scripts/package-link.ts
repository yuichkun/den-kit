// Local prototype packaging only. The production packager never reads this staging tree.
import { build, Platform } from 'electron-builder';
import { LINK_EXECUTABLE } from './link-paths.ts';
if (process.platform !== 'darwin')
  throw new Error('Package the standalone Link prototype on macOS.');
await build({
  targets: Platform.MAC.createTarget('dir'),
  publish: 'never',
  config: {
    extends: './electron-builder.yml',
    appId: 'com.escentier.den-kit.link-prototype',
    productName: 'den-kit Link Prototype',
    executableName: LINK_EXECUTABLE,
    artifactName: 'den-kit-link-prototype-${version}-${arch}.${ext}',
    directories: { app: '.desktop-link-build/app', output: 'release-link' },
    extraResources: [
      { from: '.desktop-link-build/resources', to: '.' },
      { from: `.desktop-link-build/codex/${process.arch}`, to: 'codex' },
    ],
    afterSign: null,
    publish: null,
    mac: {
      identity: null,
      target: ['dir'],
      extendInfo: {
        CFBundleName: 'den-kit Link Prototype',
        CFBundleDisplayName: 'den-kit Link Prototype',
        NSLocalNetworkUsageDescription:
          'Connect with music apps on your network using Ableton Link to share tempo and beat timing.',
      },
    },
  },
});
