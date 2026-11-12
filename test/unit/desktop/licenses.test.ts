// The desktop app's license notices (scripts/licenses.ts) and the windows that show
// them (desktop/licenses.ts).
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { build } from 'vite-plus';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { BrowserWindow } from 'electron';
import type { Metafile } from 'esbuild';
import {
  BUNDLED_PACKAGES,
  CODEX_NOTICES,
  LICENSE_FILE,
  bundledPackages,
  desktopLicenses,
  homepageOf,
  licensesPage,
  metafilePackages,
  packageDir,
  packageNotice,
  type Notice,
} from '../../../scripts/licenses.ts';
import { NOTICES_WINDOW, NoticesWindows, linkTarget } from '../../../desktop/licenses.ts';

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'den-kit-licenses-'));
  roots.push(dir);
  return dir;
};
function write(root: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}
const pkg = (name: string, extra: object = {}) =>
  JSON.stringify({ name, version: '1.2.3', license: 'MIT', ...extra });

describe('which packages are bundled', () => {
  it('finds the package of a module or file under the last node_modules', () => {
    const root = '/repo';
    expect(packageDir('/repo/node_modules/vue/dist/vue.js', root)).toBe('node_modules/vue');
    expect(packageDir('/repo/node_modules/@vue/shared/dist/a.js?v=1', root)).toBe(
      'node_modules/@vue/shared',
    );
    expect(packageDir('node_modules/a/node_modules/semver/index.js', root)).toBe(
      'node_modules/a/node_modules/semver',
    );
    expect(packageDir('/repo/node_modules/@fontsource/inter/files/x.woff2#y', root)).toBe(
      'node_modules/@fontsource/inter',
    );
    for (const id of [
      '/repo/src/editor/App.vue',
      '\0virtual:kit-types',
      '\0vite/preload-helper.js',
      '/repo/node_modules/.cache/den-kit/codex/x',
      '/repo/node_modules/@scope',
    ])
      expect(packageDir(id, root), id).toBeNull();
  });

  it("counts the inputs that put code into an esbuild output, from the build's folder", () => {
    const metafile = {
      inputs: {},
      outputs: {
        'out.cjs': {
          inputs: {
            'node_modules/ws/index.js': { bytesInOutput: 10 },
            'node_modules/argparse/index.js': { bytesInOutput: 0 },
            'desktop/main.ts': { bytesInOutput: 5 },
          },
        },
      },
    } as unknown as Metafile;
    expect(metafilePackages(metafile, '/repo')).toEqual(['node_modules/ws']);
  });

  it("lists the packages of a Vite build's chunks, its workers and the files it emits", async () => {
    const root = temp();
    write(root, {
      'node_modules/chunk-pkg/package.json': pkg('chunk-pkg', { sideEffects: false }),
      'node_modules/chunk-pkg/index.js': 'export const a = () => "in a chunk";',
      'node_modules/@scope/worker-pkg/package.json': pkg('@scope/worker-pkg'),
      'node_modules/@scope/worker-pkg/index.js': 'export const b = () => "in a worker";',
      'node_modules/unused-pkg/package.json': pkg('unused-pkg', { sideEffects: false }),
      'node_modules/unused-pkg/index.js': 'export const c = () => "tree-shaken";',
      'node_modules/asset-pkg/font.woff2': 'not really a font',
      'worker.js': "import { b } from '@scope/worker-pkg'; postMessage(b());",
      'main.css': "@font-face { font-family: f; src: url('./node_modules/asset-pkg/font.woff2'); }",
      'main.js': [
        "import './main.css';",
        "import { a } from 'chunk-pkg';",
        "import { c } from 'unused-pkg';",
        "import Worker from './worker.js?worker';",
        'new Worker().onmessage = e => console.log(a(), e.data);',
      ].join('\n'),
      'index.html': '<script type="module" src="./main.js"></script>',
    });
    const packages = bundledPackages(root, ['typescript']);
    await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [packages.plugin()],
      worker: { format: 'es', plugins: () => [packages.worker()] },
      build: { outDir: join(root, 'dist'), assetsInlineLimit: 0 },
    });
    expect(JSON.parse(readFileSync(join(root, 'dist', BUNDLED_PACKAGES), 'utf8'))).toEqual([
      'node_modules/@scope/worker-pkg',
      'node_modules/asset-pkg',
      'node_modules/chunk-pkg',
      'node_modules/typescript',
    ]);
  });
});

describe('a package notice', () => {
  it('takes license and notice files, but no other file', () => {
    for (const name of [
      'LICENSE',
      'LICENSE.md',
      'license.txt',
      'LICENCE',
      'LICENSE-MIT',
      'LICENSE-APACHE',
      'COPYING',
      'NOTICE',
      'NOTICE.md',
      'UNLICENSE',
      'ThirdPartyNoticeText.txt',
    ])
      expect(name).toMatch(LICENSE_FILE);
    for (const name of ['README.md', 'package.json', 'licensing.md', 'AUTHORS.md'])
      expect(name).not.toMatch(LICENSE_FILE);
  });

  it("reads the package's license and notice files, with its version and homepage", () => {
    const root = temp();
    write(root, {
      'node_modules/a/package.json': pkg('a', {
        license: 'Apache-2.0',
        repository: { type: 'git', url: 'git+https://github.com/someone/a.git' },
      }),
      'node_modules/a/NOTICE': 'Notice of a',
      'node_modules/a/LICENSE': 'License of a',
      'node_modules/a/README.md': 'Not a license',
    });
    expect(packageNotice('node_modules/a', root)).toEqual({
      name: 'a',
      version: '1.2.3',
      license: 'Apache-2.0',
      links: [{ text: 'https://github.com/someone/a', href: 'https://github.com/someone/a' }],
      texts: [
        { title: 'LICENSE', text: 'License of a' },
        { title: 'NOTICE', text: 'Notice of a' },
      ],
    });
  });

  it('gives the standard text of the license a package names when it includes no text', () => {
    const root = temp();
    write(root, {
      'build/licenses/MIT.txt': 'The MIT License text',
      'node_modules/b/package.json': pkg('b', { author: 'Some One <one@example.com>' }),
    });
    const notice = packageNotice('node_modules/b', root);
    expect(notice.note).toBe(
      'The package includes no license text. Its package.json names the MIT license and Some One as its author; this is the standard text of that license.',
    );
    expect(notice.texts).toEqual([{ title: 'MIT license', text: 'The MIT License text' }]);
  });

  it('stops the build for a package with no license text and no standard text for its license', () => {
    const root = temp();
    write(root, { 'node_modules/c/package.json': pkg('c', { license: 'ISC' }) });
    expect(() => packageNotice('node_modules/c', root)).toThrow(
      /c 1\.2\.3 \(node_modules\/c\) includes no license text.*\(ISC\)/,
    );
  });

  it('shows a license kept in a file as a pointer to that file', () => {
    const root = temp();
    write(root, {
      'node_modules/d/package.json': pkg('d', { license: 'SEE LICENSE IN LICENSE.txt' }),
      'node_modules/d/LICENSE.txt': 'All rights reserved.',
    });
    expect(packageNotice('node_modules/d', root).license).toBe('See LICENSE.txt');
  });

  it('links to a homepage or repository over https only', () => {
    expect(homepageOf({ homepage: 'https://example.com/a' })).toBe('https://example.com/a');
    expect(homepageOf({ repository: 'develar/lazy-val' })).toBe(
      'https://github.com/develar/lazy-val',
    );
    expect(homepageOf({ repository: 'github:someone/a' })).toBe('https://github.com/someone/a');
    expect(homepageOf({ repository: { url: 'git://github.com/someone/a.git' } })).toBe(
      'https://github.com/someone/a',
    );
    expect(homepageOf({ repository: { url: 'ssh://git@github.com/someone/a.git' } })).toBe(
      'https://github.com/someone/a',
    );
    expect(homepageOf({ homepage: 'http://example.com' })).toBeUndefined();
    expect(homepageOf({})).toBeUndefined();
  });
});

describe('the licenses page', () => {
  const notice = (name: string, version = '1.0.0', text = `License of ${name}`): Notice => ({
    name,
    version,
    license: 'MIT',
    links: [],
    texts: [{ title: 'LICENSE', text }],
  });

  it('lists den-kit first and the rest by name, once each, each linked to its section', () => {
    const page = licensesPage(notice('den-kit'), [
      notice('zeta'),
      notice('@scope/beta'),
      notice('Alpha'),
      notice('zeta'),
    ]);
    const rows = [...page.matchAll(/<tr><td><a href="#([^"]+)">([^<]+)<\/a>/g)];
    expect(rows.map(r => r[2])).toEqual(['den-kit', 'Alpha', '@scope/beta', 'zeta']);
    for (const [, id] of rows) expect(page).toContain(`<section id="${id}">`);
    expect(new Set(rows.map(r => r[1])).size).toBe(rows.length);
  });

  it('escapes what the packages say', () => {
    const page = licensesPage(notice('den-kit'), [
      {
        ...notice('<b>evil</b>', '1.0.0', '</pre><script>alert(1)</script>'),
        links: [{ text: 'x', href: '" onclick="alert(1)' }],
      },
    ]);
    expect(page).not.toContain('<script>');
    expect(page).not.toContain('<b>evil</b>');
    expect(page).not.toContain('" onclick=');
    expect(page).toContain('&#60;/pre&#62;&#60;script&#62;');
  });

  it('allows no scripts or loads from anywhere', () => {
    expect(licensesPage(notice('den-kit'), [])).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
    );
  });
});

describe("the desktop app's licenses", () => {
  /** A repository with den-kit's own files, a bundled package, Electron and a staged Codex. */
  function project(codexNotice = 'GStreamer notice') {
    const root = temp();
    write(root, {
      'package.json': JSON.stringify({ version: '9.9.9', license: 'MIT OR Apache-2.0' }),
      'LICENSE-MIT': 'MIT text of den-kit',
      'LICENSE-APACHE': 'Apache text of den-kit',
      'node_modules/electron/package.json': pkg('electron', { version: '44.0.0' }),
      'node_modules/electron/LICENSE': 'Electron license',
      'node_modules/page-pkg/package.json': pkg('page-pkg'),
      'node_modules/page-pkg/LICENSE': 'page-pkg license',
      'node_modules/main-pkg/package.json': pkg('main-pkg'),
      'node_modules/main-pkg/LICENSE': 'main-pkg license',
      'dist/bundled-packages.json': JSON.stringify(['node_modules/page-pkg']),
      'build/licenses/codex/LICENSE': 'Codex license',
      'build/licenses/codex/NOTICE': 'Codex notice',
      'codex/arm64/bin/codex': 'binary',
      'codex/arm64/codex-resources/voice/NOTICE.md': 'GStreamer notice',
      'codex/arm64/codex-resources/voice/licenses/LGPL-2.1.txt': 'LGPL',
      'codex/x64/bin/codex': 'binary',
      'codex/x64/codex-resources/voice/NOTICE.md': codexNotice,
      'codex/x64/codex-resources/voice/licenses/LGPL-2.1.txt': 'LGPL',
    });
    const metafile = {
      inputs: {},
      outputs: { 'main.cjs': { inputs: { 'node_modules/main-pkg/x.js': { bytesInOutput: 1 } } } },
    } as unknown as Metafile;
    return {
      root,
      builds: [join(root, 'dist/bundled-packages.json')],
      metafiles: [metafile],
      codex: {
        version: CODEX_NOTICES.version,
        folders: [join(root, 'codex/arm64'), join(root, 'codex/x64')],
      },
    };
  }

  it('lists den-kit, the bundled packages, the Codex CLI with what comes with it, and Electron', () => {
    const page = desktopLicenses(project());
    const rows = [...page.matchAll(/<tr><td><a href="#[^"]+">([^<]+)<\/a><\/td><td>([^<]+)/g)];
    expect(rows.map(r => `${r[1]} ${r[2]}`)).toEqual([
      'den-kit 9.9.9',
      `Codex CLI ${CODEX_NOTICES.version}`,
      'Electron 44.0.0',
      'main-pkg 1.2.3',
      'page-pkg 1.2.3',
    ]);
    for (const text of [
      'MIT text of den-kit',
      'Apache text of den-kit',
      'Codex license',
      'Codex notice',
      '<h3>codex-resources/voice/NOTICE.md</h3>',
      '<h3>codex-resources/voice/licenses/LGPL-2.1.txt</h3>',
      'Electron license',
      '<a href="LICENSES.chromium.html">',
      'main-pkg license',
      'page-pkg license',
    ])
      expect(page).toContain(text);
    expect(page).not.toContain('<h3>bin/codex</h3>');
  });

  it("stops when the Codex CLI's notices are for another version, or differ between architectures", () => {
    expect(() =>
      desktopLicenses({ ...project(), codex: { ...project().codex, version: '0.0.1' } }),
    ).toThrow(/Codex 0\.0\.1.*rust-v0\.0\.1/);
    expect(() => desktopLicenses(project('another notice'))).toThrow(/same notices/);
  });

  it("keeps openai/codex's LICENSE and NOTICE for the Codex CLI den-kit bundles", () => {
    const installed = JSON.parse(
      readFileSync(join(repo, 'node_modules/@openai/codex/package.json'), 'utf8'),
    ) as { version: string };
    expect(CODEX_NOTICES.version).toBe(installed.version);
    for (const file of CODEX_NOTICES.files)
      expect(readFileSync(join(repo, file), 'utf8')).toContain('OpenAI');
  });
});

describe('the notices windows', () => {
  const pages = ['/app/Resources/licenses.html', '/app/Resources/LICENSES.chromium.html'];

  it('follow a link to one of the pages, to a website, or nowhere', () => {
    expect(linkTarget('https://example.com/a', pages)).toEqual({
      website: 'https://example.com/a',
    });
    expect(linkTarget('http://example.com/', pages)).toEqual({ website: 'http://example.com/' });
    expect(linkTarget(`${pathToFileURL(pages[1]!).href}#x`, pages)).toEqual({ page: pages[1] });
    for (const url of [
      'file:///app/Resources/operator.json',
      'javascript:alert(1)',
      'mailto:someone@example.com',
      'chrome://credits',
      'not a URL',
    ])
      expect(linkTarget(url, pages), url).toBeNull();
  });

  class FakeWindow {
    static made: FakeWindow[] = [];
    events = new Map<string, () => void>();
    navigate?: (event: { preventDefault(): void }, url: string) => void;
    opening?: (details: { url: string }) => { action: string };
    loaded = '';
    shown = 0;
    focused = 0;
    destroyed = false;
    minimized = false;
    webContents = {
      on: (_: 'will-navigate', listener: FakeWindow['navigate']) => {
        this.navigate = listener;
      },
      setWindowOpenHandler: (handler: FakeWindow['opening']) => {
        this.opening = handler;
      },
    };
    options: unknown;
    constructor(options: unknown) {
      this.options = options;
      FakeWindow.made.push(this);
    }
    on(event: string, listener: () => void) {
      this.events.set(event, listener);
      return this;
    }
    once(event: string, listener: () => void) {
      return this.on(event, listener);
    }
    loadFile(path: string) {
      this.loaded = path;
      return Promise.resolve();
    }
    show() {
      this.shown++;
    }
    focus() {
      this.focused++;
    }
    restore() {
      this.minimized = false;
    }
    isMinimized() {
      return this.minimized;
    }
    isDestroyed() {
      return this.destroyed;
    }
  }
  function windows() {
    FakeWindow.made = [];
    const openExternal = vi.fn();
    const notices = new NoticesWindows(
      { window: options => new FakeWindow(options) as unknown as BrowserWindow, openExternal },
      pages,
    );
    return { notices, openExternal, made: FakeWindow.made };
  }

  it('show a page in a window without JavaScript, once it is drawn', () => {
    const { notices, made } = windows();
    notices.show(pages[0]!);
    const [window] = made;
    expect(window!.options).toBe(NOTICES_WINDOW);
    expect(NOTICES_WINDOW.webPreferences).toMatchObject({
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    });
    expect(window!.loaded).toBe(pages[0]);
    expect(window!.shown).toBe(0);
    window!.events.get('ready-to-show')!();
    expect(window!.shown).toBe(1);
  });

  it('bring back the window a page is open in, and open it again once closed', () => {
    const { notices, made } = windows();
    notices.show(pages[0]!);
    made[0]!.minimized = true;
    notices.show(pages[0]!);
    expect(made).toHaveLength(1);
    expect(made[0]!).toMatchObject({ minimized: false, shown: 1, focused: 1 });
    made[0]!.events.get('closed')!();
    notices.show(pages[0]!);
    expect(made).toHaveLength(2);
  });

  it('never leave their page: websites open in the browser, and the other page in its own window', () => {
    const { notices, openExternal, made } = windows();
    notices.show(pages[0]!);
    const window = made[0]!;
    const preventDefault = vi.fn();
    window.navigate!({ preventDefault }, 'https://github.com/openai/codex');
    expect(openExternal).toHaveBeenCalledWith('https://github.com/openai/codex');
    window.navigate!({ preventDefault }, pathToFileURL(pages[1]!).href);
    expect(made.map(w => w.loaded)).toEqual(pages);
    window.navigate!({ preventDefault }, 'file:///etc/passwd');
    expect(made).toHaveLength(2);
    expect(preventDefault).toHaveBeenCalledTimes(3);
    expect(window.opening!({ url: 'https://example.com/' })).toEqual({ action: 'deny' });
    expect(openExternal).toHaveBeenLastCalledWith('https://example.com/');
  });
});
