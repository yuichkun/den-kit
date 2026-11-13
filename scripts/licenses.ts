// The license notices the desktop app shows under Help → Licenses (desktop/licenses.ts):
// licenses.html in the app's resources lists den-kit's own license, every npm package
// the app bundles, the native Codex CLI and Electron, each with its license and notice
// files. The bundlers say which packages are bundled: bundledPackages() for the page
// and the player (bundled-packages.json in each build) and esbuild's metafile for the
// main process (scripts/build-desktop.ts).
//
// A package that includes no license text gets the standard text of the license its
// package.json names, from build/licenses (MIT.txt is SPDX's text without its copyright
// line, which such a package does not give); the build stops for any other license. The
// Codex CLI's npm package has neither LICENSE nor NOTICE, so build/licenses/codex holds
// openai/codex's from the tag rust-v<CODEX_NOTICES.version>, and the build stops for
// another Codex version until they are copied from that version's tag.
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { Metafile } from 'esbuild';
import type { Plugin } from 'vite-plus';

/** What each Vite build writes next to its files: the folders of the npm packages it bundles. */
export const BUNDLED_PACKAGES = 'bundled-packages.json';

/** openai/codex's LICENSE and NOTICE, from its tag rust-v<version>. */
export const CODEX_NOTICES = {
  version: '0.160.1',
  files: ['build/licenses/codex/LICENSE', 'build/licenses/codex/NOTICE'],
};

/** The standard texts of licenses that a package may name without including the text. */
const STANDARD_TEXTS: Record<string, string> = { MIT: 'build/licenses/MIT.txt' };

/** License and notice files, such as LICENSE, LICENSE-MIT, COPYING, NOTICE or ThirdPartyNoticeText.txt. */
export const LICENSE_FILE =
  /^(licen[cs]e|unlicense|copying|copyright|notice|third[-_]?party[-_]?notice)/i;

export interface Notice {
  name: string;
  version: string;
  license: string;
  /** Said before the texts, such as where a standard text comes from. */
  note?: string;
  links: { text: string; href: string }[];
  texts: { title: string; text: string }[];
}

interface PackageJson {
  name: string;
  version: string;
  license?: string | { type?: string };
  licenses?: { type?: string }[];
  author?: string | { name?: string };
  homepage?: string;
  repository?: string | { url?: string };
}

/** The npm package a module or file comes from: its folder under the last node_modules, relative to root. */
export function packageDir(id: string, root: string): string | null {
  const parts = resolve(root, id.replace(/^\0/, '').replace(/[?#].*$/, '')).split(sep);
  const at = parts.lastIndexOf('node_modules');
  const name = parts[at + 1];
  if (at < 0 || !name || name.startsWith('.')) return null;
  const end = name.startsWith('@') ? at + 3 : at + 2;
  return end > parts.length ? null : relative(root, parts.slice(0, end).join(sep));
}

type Bundle = Record<
  string,
  { type: 'chunk'; moduleIds: string[] } | { type: 'asset'; originalFileNames: string[] }
>;

/**
 * Writes bundled-packages.json into a Vite build: the packages its chunks, its workers' chunks and
 * the files it emits come from. `worker()` goes in the build's worker plugins, and `embedded` names
 * the packages whose files a plugin puts into the build as text.
 */
export function bundledPackages(root: string, embedded: readonly string[] = []) {
  const found = new Set(embedded.map(name => join('node_modules', name)));
  // Vite names modules by their real paths.
  const base = realpathSync(root);
  const collect = (bundle: Bundle) => {
    for (const item of Object.values(bundle))
      for (const id of item.type === 'chunk' ? item.moduleIds : item.originalFileNames) {
        const dir = packageDir(id, base);
        if (dir) found.add(dir);
      }
  };
  return {
    /** Inputs bundled separately as text, such as the player's self-contained compiler. */
    addFiles(ids: readonly string[]) {
      for (const id of ids) {
        const dir = packageDir(id, base);
        if (dir) found.add(dir);
      }
    },
    plugin: (): Plugin => ({
      name: 'den-kit-bundled-packages',
      apply: 'build',
      // A worker is bundled before the build that imports it ends, so its packages are in `found`.
      generateBundle(_, bundle) {
        collect(bundle);
        this.emitFile({
          type: 'asset',
          fileName: BUNDLED_PACKAGES,
          source: `${JSON.stringify([...found].sort(), null, 2)}\n`,
        });
      },
    }),
    worker: (): Plugin => ({
      name: 'den-kit-bundled-packages-worker',
      apply: 'build',
      generateBundle(_, bundle) {
        collect(bundle);
      },
    }),
  };
}

const read = (path: string) => readFileSync(path, 'utf8');

function licenseOf(pkg: PackageJson): string {
  const license =
    typeof pkg.license === 'string'
      ? pkg.license
      : (pkg.license?.type ?? pkg.licenses?.map(l => l.type).join(' OR '));
  if (!license) return 'Unknown';
  const file = /^SEE LICENSE IN (.+)$/i.exec(license);
  return file ? `See ${file[1]}` : license;
}

function authorOf(pkg: PackageJson): string | undefined {
  const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name;
  return author?.replace(/\s*[<(].*$/, '').trim() || undefined;
}

/** Where to find the package: its homepage or repository, as an https address. */
export function homepageOf(pkg: Pick<PackageJson, 'homepage' | 'repository'>): string | undefined {
  const url =
    pkg.homepage ?? (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url);
  if (!url) return undefined;
  if (/^(github:)?[\w.-]+\/[\w.-]+$/.test(url))
    return `https://github.com/${url.replace(/^github:/, '')}`;
  const https = url
    .replace(/^git\+/, '')
    .replace(/^(git|ssh):\/\/(git@)?/, 'https://')
    .replace(/\.git(#.*)?$/, '');
  return https.startsWith('https://') ? https : undefined;
}

/** The license and notice files in a folder, read; with `deep`, in its subfolders too. */
function licenseTexts(folder: string, deep = false, under = ''): Notice['texts'] {
  return readdirSync(join(folder, under))
    .sort()
    .flatMap(name => {
      const path = join(under, name);
      if (statSync(join(folder, path)).isDirectory())
        return deep ? licenseTexts(folder, deep, path) : [];
      const inLicenses = under.split(sep).at(-1)?.toLowerCase() === 'licenses';
      return LICENSE_FILE.test(name) || (deep && inLicenses)
        ? [{ title: path, text: read(join(folder, path)) }]
        : [];
    });
}

/** A package's notice: its license and notice files, or the standard text of the license it names. */
export function packageNotice(dir: string, root: string): Notice {
  const pkg = JSON.parse(read(join(root, dir, 'package.json'))) as PackageJson;
  const homepage = homepageOf(pkg);
  const notice: Notice = {
    name: pkg.name,
    version: pkg.version,
    license: licenseOf(pkg),
    links: homepage ? [{ text: homepage, href: homepage }] : [],
    texts: licenseTexts(join(root, dir)),
  };
  if (notice.texts.length) return notice;
  const standard = STANDARD_TEXTS[notice.license];
  if (!standard)
    throw new Error(
      `${pkg.name} ${pkg.version} (${dir}) includes no license text, and build/licenses has no standard text of its license (${notice.license}). Add the text there and to STANDARD_TEXTS in scripts/licenses.ts before den-kit ships the package.`,
    );
  const author = authorOf(pkg);
  return {
    ...notice,
    note: `The package includes no license text. Its package.json names the ${notice.license} license${author ? ` and ${author} as its author` : ''}; this is the standard text of that license.`,
    texts: [{ title: `${notice.license} license`, text: read(join(root, standard)) }],
  };
}

/** The packages a build's esbuild metafile bundles: the inputs that put code into an output. */
export function metafilePackages(metafile: Metafile, root: string): string[] {
  return Object.values(metafile.outputs).flatMap(output =>
    Object.entries(output.inputs).flatMap(([input, { bytesInOutput }]) => {
      const dir = bytesInOutput > 0 ? packageDir(input, root) : null;
      return dir ? [dir] : [];
    }),
  );
}

const escape = (text: string) => text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const sortName = (name: string) => name.replace(/^@/, '').toLowerCase();

/** The page that lists every notice, den-kit's own first and the rest by name. */
export function licensesPage(own: Notice, notices: Notice[]): string {
  const unique = new Map<string, Notice>();
  for (const n of notices)
    unique.set(`${n.name}@${n.version}`, unique.get(`${n.name}@${n.version}`) ?? n);
  const all = [
    own,
    ...[...unique.values()].sort(
      (a, b) =>
        sortName(a.name).localeCompare(sortName(b.name)) || a.version.localeCompare(b.version),
    ),
  ];
  // Unique by their place in the list.
  const ids = all.map((n, i) =>
    `${`${n.name}-${n.version}`.replace(/[^a-z0-9]+/gi, '-').replace(/^-/, '')}-${i}`.toLowerCase(),
  );
  const rows = all
    .map(
      (n, i) =>
        `<tr><td><a href="#${ids[i]}">${escape(n.name)}</a></td><td>${escape(n.version)}</td><td>${escape(n.license)}</td></tr>`,
    )
    .join('\n');
  const sections = all
    .map(
      (n, i) => `<section id="${ids[i]}">
<h2>${escape(n.name)} <span class="version">${escape(n.version)}</span></h2>
<p class="license">${escape(n.license)}</p>
${n.note ? `<p>${escape(n.note)}</p>\n` : ''}${n.links.map(l => `<p><a href="${escape(l.href)}">${escape(l.text)}</a></p>\n`).join('')}${n.texts.map(t => `<h3>${escape(t.title)}</h3>\n<pre>${escape(t.text.trimEnd())}</pre>`).join('\n')}
</section>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Licenses</title>
<style>
body { font: 13px/1.5 -apple-system, system-ui, sans-serif; max-width: 760px; margin: 0 auto; padding: 8px 24px 48px; }
h1 { font-size: 20px; }
h2 { font-size: 15px; margin: 40px 0 0; }
h3 { font-size: 12px; margin: 16px 0 4px; }
.version, .license { font-weight: normal; opacity: 0.7; }
.license { margin: 0; }
table { border-collapse: collapse; }
td, th { padding: 2px 16px 2px 0; text-align: left; vertical-align: top; }
pre { font: 11px/1.45 ui-monospace, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
</style>
</head>
<body>
<h1>Licenses</h1>
<p>den-kit is available under either the MIT License or the Apache License 2.0, at your option. It includes the software below, which keeps its own license.</p>
<table>
<thead><tr><th>Software</th><th>Version</th><th>License</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
${sections}
</body>
</html>
`;
}

/** The desktop app's licenses.html. */
export function desktopLicenses(options: {
  root: string;
  /** The page's and the player's bundled-packages.json. */
  builds: string[];
  /** The packages esbuild bundled into the main process and the preload script. */
  metafiles: Metafile[];
  /** The staged native Codex CLI: its version, and its folder for each architecture. */
  codex: { version: string; folders: string[] };
}): string {
  const { root, codex } = options;
  if (codex.version !== CODEX_NOTICES.version)
    throw new Error(
      `build/licenses/codex holds the LICENSE and NOTICE of Codex ${CODEX_NOTICES.version}, but den-kit bundles Codex ${codex.version}. Copy both files from https://github.com/openai/codex/tree/rust-v${codex.version} and set CODEX_NOTICES.version in scripts/licenses.ts.`,
    );
  const dirs = new Set([
    ...options.builds.flatMap(file => JSON.parse(read(file)) as string[]),
    ...options.metafiles.flatMap(metafile => metafilePackages(metafile, root)),
  ]);
  // The notices that come with the native CLI, such as its voice libraries'; the same for every architecture.
  const [packaged, ...others] = codex.folders.map(folder => licenseTexts(folder, true));
  if (!packaged || others.some(o => JSON.stringify(o) !== JSON.stringify(packaged)))
    throw new Error('The staged Codex CLIs do not come with the same notices.');
  const pkg = JSON.parse(read(join(root, 'package.json'))) as PackageJson;
  const electron = JSON.parse(
    read(join(root, 'node_modules/electron/package.json')),
  ) as PackageJson;
  return licensesPage(
    {
      name: 'den-kit',
      version: pkg.version,
      license: licenseOf(pkg),
      links: [],
      texts: ['LICENSE-MIT', 'LICENSE-APACHE'].map(title => ({
        title,
        text: read(join(root, title)),
      })),
    },
    [
      ...[...dirs].map(dir => packageNotice(dir, root)),
      {
        name: 'Codex CLI',
        version: codex.version,
        license: 'Apache-2.0',
        note: packaged.length
          ? 'Notices for the software that comes with the Codex CLI follow its own, each named by its path in den-kit.app/Contents/Resources/codex.'
          : undefined,
        links: [
          { text: 'https://github.com/openai/codex', href: 'https://github.com/openai/codex' },
        ],
        texts: [
          ...CODEX_NOTICES.files.map(file => ({
            title: file.split('/').at(-1)!,
            text: read(join(root, file)),
          })),
          ...packaged,
        ],
      },
      {
        name: 'Electron',
        version: electron.version,
        license: licenseOf(electron),
        links: [
          { text: 'https://www.electronjs.org', href: 'https://www.electronjs.org' },
          {
            text: 'Licenses of Chromium, Node.js and the other software Electron includes',
            href: 'LICENSES.chromium.html',
          },
        ],
        texts: [{ title: 'LICENSE', text: read(join(root, 'node_modules/electron/LICENSE')) }],
      },
    ],
  );
}
