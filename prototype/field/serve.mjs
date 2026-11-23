// Serves the prototype: the page that puts the places side by side (site/), and each
// work's playable build twice, from the work files export-works.mjs made:
//
//   /w/<id>/      the build with what make-media.mjs added (moment.json, card.png,
//                 clip.mp4) and link-preview tags in its page, so a chat or timeline
//                 that reads them shows the work's name, picture and clip
//   /plain/<id>/  the build as den-kit exports it: no tags, no moment, no picture
//
//   node prototype/field/serve.mjs [port] [host]
//
// Link previews need absolute addresses: the tags name this server as the request
// reached it (Host, or X-Forwarded-Host and X-Forwarded-Proto behind a tunnel).
// Phones need https: the player's sound (AudioWorklet) and the microphone run only in
// a secure context.
import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from '../../src/work/zip.ts';
import { qrSvg } from './qr.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'out');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

/** Each work's build files by path, its name and what kind of work it is. */
export function loadWorks() {
  const moments = JSON.parse(readFileSync(join(here, 'moments.json'), 'utf8'));
  const works = new Map();
  for (const id of Object.keys(moments)) {
    const file = join(OUT, 'works', `${id}.denkit`);
    if (!existsSync(file)) continue;
    const files = new Map();
    for (const e of readZip(new Uint8Array(readFileSync(file)), {
      maxEntryBytes: 1e9,
      maxTotalBytes: 4e9,
      maxEntries: 100000,
    }))
      if (e.path.startsWith('build/')) files.set(e.path.slice('build/'.length), e.data);
    const doc = JSON.parse(new TextDecoder().decode(files.get('build.json'))).document;
    const types = Object.values(doc.nodes).map(n => n.type);
    const kind = types.includes('kit.voiceIn')
      ? 'instrument'
      : types.includes('kit.audioIn')
        ? 'effect'
        : 'sound';
    works.set(id, { id, name: doc.name, kind, files, moment: moments[id] });
  }
  return works;
}

/** What make-media.mjs made for a work (its picture and clip), by file name. */
function media(id) {
  const folder = join(OUT, 'media', id);
  const found = new Map();
  if (existsSync(folder))
    for (const name of readdirSync(folder)) found.set(name, readFileSync(join(folder, name)));
  return found;
}

const escape = s =>
  String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The tags a chat or timeline reads to preview the link to a work's page. */
export function previewTags(work, base, made) {
  const page = `${base}/w/${work.id}/`;
  const what =
    work.kind === 'effect' ? 'An effect' : work.kind === 'instrument' ? 'An instrument' : 'A sound';
  const description = `${what} made with den-kit. Tap to play it in your browser, no app needed.`;
  const tags = [
    `<title>${escape(work.name)} · play it in your browser</title>`,
    `<meta name="description" content="${escape(description)}">`,
    `<meta property="og:site_name" content="den-kit">`,
    `<meta property="og:url" content="${page}">`,
    `<meta property="og:title" content="${escape(work.name)}">`,
    `<meta property="og:description" content="${escape(description)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ];
  if (made.has('card.png'))
    tags.push(
      `<meta property="og:image" content="${page}card.png">`,
      `<meta property="og:image:width" content="1200">`,
      `<meta property="og:image:height" content="630">`,
      `<meta property="og:image:alt" content="${escape(`The screen of ${work.name}`)}">`,
    );
  if (made.has('clip.mp4'))
    tags.push(
      `<meta property="og:type" content="video.other">`,
      `<meta property="og:video" content="${page}clip.mp4">`,
      `<meta property="og:video:type" content="video/mp4">`,
      `<meta property="og:video:width" content="1280">`,
      `<meta property="og:video:height" content="720">`,
    );
  else tags.push(`<meta property="og:type" content="website">`);
  return tags.join('\n    ');
}

/** The address this server was reached at, as the browser or a tunnel names it. */
function baseOf(req) {
  const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost';
  const proto = req.headers['x-forwarded-proto'] ?? 'http';
  return `${String(proto).split(',')[0]}://${String(host).split(',')[0]}`;
}

export function handler(works) {
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = decodeURIComponent(url.pathname);
    const send = (status, type, body, headers = {}) => {
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (path === '/works.json') {
      const list = [...works.values()].map(({ id, name, kind, moment }) => ({
        id,
        name,
        kind,
        source: moment.source,
        media: [...media(id).keys()],
      }));
      return send(200, TYPES['.json'], JSON.stringify(list));
    }
    if (path === '/qr.svg') return send(200, TYPES['.svg'], qrSvg(url.searchParams.get('u') ?? ''));
    // The player's own font (Lato, in every build), for the pages here.
    const font = /^\/font\/(400|700)\.woff2$/.exec(path);
    if (font) {
      for (const work of works.values())
        for (const [file, data] of work.files)
          if (file.startsWith(`assets/lato-latin-${font[1]}-normal-`) && file.endsWith('.woff2'))
            return sendFile(req, res, data, TYPES['.woff2']);
      return send(404, 'text/plain', 'No font.');
    }
    const built = /^\/(w|plain)\/([^/]+)\/(.*)$/.exec(path);
    if (built) {
      const [, how, id, rest] = built;
      const work = works.get(id);
      if (!work) return send(404, 'text/plain', 'No such work.');
      const file = rest || 'index.html';
      const made = how === 'w' ? media(id) : new Map();
      if (how === 'w' && file === 'moment.json')
        return send(200, TYPES['.json'], JSON.stringify(work.moment));
      if (made.has(file)) return sendFile(req, res, made.get(file), TYPES[extname(file)]);
      const data = work.files.get(file);
      if (!data) return send(404, 'text/plain', 'Not in the build.');
      if (file === 'index.html' && how === 'w') {
        const html = new TextDecoder()
          .decode(data)
          .replace(/<title>[^<]*<\/title>/, previewTags(work, baseOf(req), made));
        return send(200, TYPES['.html'], html);
      }
      return sendFile(req, res, data, TYPES[extname(file)] ?? 'application/octet-stream');
    }
    if (/^\/w\/[^/]+$|^\/plain\/[^/]+$/.test(path))
      return send(301, 'text/plain', '', { location: `${path}/${url.search}` });
    // The page that puts the places side by side.
    const site = join(here, 'site');
    const target = normalize(join(site, path === '/' ? 'index.html' : path));
    if (!target.startsWith(site) || !existsSync(target) || !statSync(target).isFile())
      return send(404, 'text/plain', 'Not found.');
    return send(200, TYPES[extname(target)] ?? 'application/octet-stream', readFileSync(target));
  };
}

/** A file, in the ranges a video player asks for. */
function sendFile(req, res, data, type) {
  const bytes = Buffer.from(data);
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  const headers = { 'content-type': type, 'cache-control': 'no-store', 'accept-ranges': 'bytes' };
  if (range) {
    const start = range[1] ? Number(range[1]) : bytes.length - Number(range[2]);
    const end =
      range[1] && range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${bytes.length}` });
    return res.end(req.method === 'HEAD' ? undefined : bytes.subarray(start, end + 1));
  }
  res.writeHead(200, { ...headers, 'content-length': bytes.length });
  res.end(req.method === 'HEAD' ? undefined : bytes);
}

export function serve(port, host = '127.0.0.1') {
  const works = loadWorks();
  const server = createServer(handler(works));
  return new Promise(resolve => server.listen(port, host, () => resolve({ server, works })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [port = '7100', host = '127.0.0.1'] = process.argv.slice(2);
  const { works } = await serve(Number(port), host);
  if (!works.size) console.log('No work files yet: run export-works.mjs first.');
  console.log(`The places, side by side: http://${host}:${port}/`);
  for (const w of works.values())
    console.log(`  ${w.name} (${w.kind}): /w/${w.id}/   today: /plain/${w.id}/?plain`);
}
