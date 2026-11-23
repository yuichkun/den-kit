// The development host's share server (`vp run dev` starts it on 127.0.0.1:5182): links to
// works' playable builds, served as a service that publishes them would serve them. Each
// link serves its build at /w/<id>/ with the link's outside in the page's head: the Open
// Graph tags an app reads when it unfurls the link, and the outside's picture and clip. The
// link's inside (who it is for, the note) goes only to the page's own request for
// inside.json, which apps that unfurl links do not make. A stopped link serves nothing, and
// previews already pasted keep what they took. Links keep counts only (previews, opens,
// plays), nothing about who; they are kept in .share/ until it is deleted. /lab shows the
// links as chat apps would preview them, from what a small unfurler reads in each page
// (share-lab.html).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readZip, ZipError, type ZipEntry } from '../src/work/zip.ts';

type Reach = 'public' | 'link' | 'person';
type Outside = 'plain' | 'poster' | 'outer' | 'inner' | 'sound';
interface Face {
  outside: Outside;
  reach: Reach;
  title: string;
  line: string;
  from: string;
  kind: 'Instrument' | 'Effect';
  color: string;
  to: string;
  note: string;
}
interface Preview {
  url: string;
  site: string;
  title: string;
  description: string;
  image: string | null;
  color: string | null;
  video: { url: string; type: string } | null;
  card: string | null;
  type: string | null;
  robots: string | null;
}
interface Link {
  id: string;
  work: string;
  /** The work's name when the link was made: a window's work keeps its id across New…. */
  name: string;
  created: number;
  stopped: boolean;
  face: Face;
  image: Uint8Array | null;
  clip: { bytes: Uint8Array; type: string; seconds: number } | null;
  build: Map<string, Uint8Array>;
  counts: { previews: number; opens: number; plays: number };
  /** The link as it was pasted when it was made: what an app took, kept apart from the link. */
  pasted: {
    at: number;
    preview: Preview | null;
    image: Uint8Array | null;
    video: Uint8Array | null;
  } | null;
}

const OUTSIDES: readonly Outside[] = ['plain', 'poster', 'outer', 'inner', 'sound'];
const REACHES: readonly Reach[] = ['public', 'link', 'person'];
const LIMITS = {
  maxEntryBytes: 100 * 1024 * 1024,
  maxTotalBytes: 300 * 1024 * 1024,
  maxEntries: 2000,
};
/** How long an app reuses what it read for a link (Discord documents about 30 minutes). */
const CACHE_MS = 30 * 60 * 1000;
const BOT =
  /bot|facebookexternalhit|embedly|unfurl|preview|slack|discord|whatsapp|telegram|line-poker/i;
const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  wasm: 'application/wasm',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  webm: 'video/webm',
  mp4: 'video/mp4',
};
const typeOf = (path: string) =>
  TYPES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';
const clipName = (type: string) => (type.includes('mp4') ? 'clip.mp4' : 'clip.webm');
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const text = (value: unknown, most: number) =>
  typeof value === 'string' ? value.trim().slice(0, most) : '';

/** A face as the editor sent it, with every field checked. */
function readFace(value: unknown): Face {
  const v = (value ?? {}) as Record<string, unknown>;
  const outside = OUTSIDES.includes(v.outside as Outside) ? (v.outside as Outside) : 'poster';
  const reach = REACHES.includes(v.reach as Reach) ? (v.reach as Reach) : 'link';
  const color =
    typeof v.color === 'string' && /^#[0-9a-f]{6}$/i.test(v.color) ? v.color : '#888888';
  return {
    outside,
    reach,
    title: text(v.title, 80) || 'Untitled',
    line: text(v.line, 160),
    from: text(v.from, 60),
    kind: v.kind === 'Effect' ? 'Effect' : 'Instrument',
    color,
    to: reach === 'person' ? text(v.to, 60) : '',
    note: text(v.note, 600),
  };
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/** The tags in a link's page head: what everyone where the link is pasted sees before opening it. */
export function outsideHead(
  face: Face,
  page: string,
  media: { image: boolean; clip: string | null; type: string },
): string {
  const tags: string[] = [];
  const meta = (key: 'name' | 'property', name: string, content: string) =>
    tags.push(`<meta ${key}="${name}" content="${escape(content)}" />`);
  if (face.reach !== 'public') meta('name', 'robots', 'noindex, nofollow');
  if (face.outside === 'plain') return [...tags, '<title>den-kit player</title>'].join('\n    ');
  const kind = face.kind.toLowerCase();
  const by = face.from ? ` by ${face.from}` : '';
  let title: string;
  let description: string;
  let alt: string;
  if (face.outside === 'outer') {
    title = face.title;
    description = `${face.from ? `From ${face.from}` : 'A gift'}: ${article(kind)} ${kind} to play. Open it to play.`;
    alt = `A wrapped ${kind}, ${face.title}${face.from ? `, from ${face.from}` : ''}.`;
  } else if (face.outside === 'inner') {
    title = face.from ? `Something from ${face.from}` : 'Something for you';
    description = 'Open it to see what it is.';
    alt = `Something wrapped${face.from ? ` from ${face.from}` : ''}.`;
  } else {
    title = face.title;
    description = [`${article(kind) === 'an' ? 'An' : 'A'} ${kind}${by}.`, face.line]
      .filter(Boolean)
      .join(' ');
    alt = `${face.title}, ${article(kind)} ${kind} made in den-kit${by}.`;
  }
  tags.push(`<title>${escape(title)} · den-kit</title>`);
  meta('name', 'description', description);
  meta('property', 'og:site_name', 'den-kit');
  // An app that plays a link's video in place asks the page to say it is a video (Discord: og:type video.*).
  meta('property', 'og:type', face.outside === 'sound' && media.clip ? 'video.other' : 'website');
  meta('property', 'og:url', page);
  meta('property', 'og:title', title);
  meta('property', 'og:description', description);
  if (media.image) {
    meta('property', 'og:image', `${page}outside.png`);
    meta('property', 'og:image:type', 'image/png');
    meta('property', 'og:image:width', '1200');
    meta('property', 'og:image:height', '630');
    meta('property', 'og:image:alt', alt);
  }
  if (face.outside === 'sound' && media.clip) {
    meta('property', 'og:video', `${page}${media.clip}`);
    meta('property', 'og:video:type', media.type);
    meta('property', 'og:video:width', '1200');
    meta('property', 'og:video:height', '630');
  }
  meta('name', 'twitter:card', media.image ? 'summary_large_image' : 'summary');
  meta('name', 'theme-color', face.color);
  return tags.join('\n    ');
}

/** What an app that unfurls links reads in a page: its title and Open Graph tags, without running it. */
export function readPreview(html: string, url: string): Preview {
  const head = html.slice(0, html.search(/<\/head>/i) + 1 || html.length);
  const tags = new Map<string, string>();
  for (const m of head.matchAll(/<meta\s+([^>]*?)\/?>/gi)) {
    const attrs = Object.fromEntries(
      [...m[1]!.matchAll(/([a-z:-]+)\s*=\s*"([^"]*)"/gi)].map(a => [a[1]!.toLowerCase(), a[2]!]),
    );
    const key = (attrs.property ?? attrs.name ?? '').toLowerCase();
    if (key && attrs.content !== undefined && !tags.has(key))
      tags.set(key, unescape(attrs.content));
  }
  const title = /<title>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const absolute = (value: string | undefined) => {
    if (!value) return null;
    try {
      return new URL(value, url).href;
    } catch {
      return null;
    }
  };
  const video = absolute(
    tags.get('og:video:secure_url') ?? tags.get('og:video:url') ?? tags.get('og:video'),
  );
  return {
    url,
    site: tags.get('og:site_name') ?? new URL(url).host,
    title:
      tags.get('og:title') ?? tags.get('twitter:title') ?? (title ? unescape(title.trim()) : url),
    description:
      tags.get('og:description') ??
      tags.get('twitter:description') ??
      tags.get('description') ??
      '',
    image: absolute(tags.get('og:image') ?? tags.get('twitter:image')),
    color: tags.get('theme-color') ?? null,
    video: video ? { url: video, type: tags.get('og:video:type') ?? '' } : null,
    card: tags.get('twitter:card') ?? null,
    type: tags.get('og:type') ?? null,
    robots: tags.get('robots') ?? null,
  };
}
function unescape(value: string) {
  return value.replace(
    /&(amp|lt|gt|quot|#39);/g,
    (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]!,
  );
}

const STOPPED_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Link stopped</title>
    <style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#ddd;font:16px system-ui,sans-serif}</style>
  </head>
  <body><p>The person who shared this link has stopped it.</p></body>
</html>`;

export class ShareServer {
  private readonly links = new Map<string, Link>();
  private readonly drafts = new Map<string, { image: Uint8Array | null; at: number }>();
  private readonly cache = new Map<string, { at: number; preview: Preview | null }>();
  private server: ReturnType<typeof createServer> | null = null;
  url = '';

  private readonly options: {
    port: number;
    /** The editor's origin: the only other page that may call /api/. */
    editor: string;
    /** Where links are kept between runs; null keeps them in memory only. */
    store: string | null;
    log?: (line: string) => void;
  };
  constructor(options: ShareServer['options']) {
    this.options = options;
  }

  async start(): Promise<string> {
    this.load();
    this.server = createServer((req, res) => {
      this.handle(req, res).catch(error => {
        this.options.log?.(`share: ${error instanceof Error ? error.message : String(error)}`);
        if (!res.headersSent) this.send(res, 500, 'text/plain', 'Something went wrong.');
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.options.port, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    this.url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : this.options.port}`;
    return this.url;
  }

  async close() {
    await new Promise<void>(resolve =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }

  private send(
    res: ServerResponse,
    status: number,
    type: string,
    body: string | Uint8Array,
    headers: Record<string, string> = {},
  ) {
    res.writeHead(status, {
      'content-type': type,
      // The editor's page is cross-origin isolated: it shows pictures from here.
      'cross-origin-resource-policy': 'cross-origin',
      ...headers,
    });
    res.end(body);
  }
  private json(res: ServerResponse, value: unknown, status = 200) {
    this.send(res, status, 'application/json', JSON.stringify(value), this.cors(res));
  }
  /** The CORS headers of each response (requests overlap: a link's paste reads the server while it is made). */
  private readonly corsOf = new WeakMap<ServerResponse, Record<string, string>>();
  private cors(res: ServerResponse) {
    return this.corsOf.get(res) ?? {};
  }

  private async body(req: IncomingMessage, most: number): Promise<Uint8Array> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > most) throw new ZipError('The upload is too large.');
      chunks.push(chunk as Buffer);
    }
    return new Uint8Array(Buffer.concat(chunks));
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', this.url);
    const path = url.pathname;
    const origin = req.headers.origin;
    this.corsOf.set(
      res,
      origin === this.options.editor
        ? { 'access-control-allow-origin': origin, vary: 'origin' }
        : {},
    );
    if (path.startsWith('/api/')) {
      // Only the editor and the lab call the API, and a call that changes something says it sends JSON or a ZIP,
      // which a page elsewhere cannot send without asking first (CORS).
      if (origin && origin !== this.options.editor && origin !== this.url)
        return this.json(res, { error: 'Not allowed.' }, 403);
      if (req.method === 'OPTIONS')
        return this.send(res, 204, 'text/plain', '', {
          ...this.cors(res),
          'access-control-allow-methods': 'GET, POST',
          'access-control-allow-headers': 'content-type',
        });
      if (
        req.method === 'POST' &&
        !/^application\/(json|zip)$/.test(req.headers['content-type'] ?? '')
      )
        return this.json(res, { error: 'Send JSON or a ZIP.' }, 415);
      return this.api(req, res, url);
    }
    if (path === '/favicon.ico') return this.send(res, 204, 'text/plain', '');
    if (path === '/' || path === '/lab') {
      const page = readFileSync(new URL('./share-lab.html', import.meta.url), 'utf8');
      return this.send(res, 200, TYPES.html!, page);
    }
    const match = /^\/w\/([a-z0-9]+)(\/.*)?$/.exec(path);
    if (!match) return this.send(res, 404, 'text/plain', 'Not found.');
    const link = this.links.get(match[1]!);
    if (!link) return this.send(res, 404, 'text/plain', 'Not found.');
    if (match[2] === undefined)
      return this.send(res, 301, 'text/plain', '', { location: `/w/${link.id}/` });
    if (link.stopped) return this.send(res, 410, TYPES.html!, STOPPED_PAGE);
    const file = decodeURIComponent(match[2].slice(1)) || 'index.html';
    const robots: Record<string, string> =
      link.face.reach === 'public' ? {} : { 'x-robots-tag': 'noindex, nofollow' };
    const bot = BOT.test(req.headers['user-agent'] ?? '');
    if (file === 'index.html') {
      if (bot) link.counts.previews++;
      this.save(link, null);
      return this.send(res, 200, TYPES.html!, this.page(link), {
        'cache-control': 'no-cache',
        ...robots,
      });
    }
    if (file === 'inside.json') {
      if (!bot) link.counts.opens++;
      this.save(link, null);
      const { face } = link;
      return this.send(
        res,
        200,
        'application/json',
        JSON.stringify({
          outside: face.outside,
          reach: face.reach,
          title: face.title,
          line: face.line,
          from: face.from,
          kind: face.kind,
          to: face.to,
          note: face.note,
          clip: link.clip ? clipName(link.clip.type) : null,
        }),
        { 'cache-control': 'no-store', ...robots },
      );
    }
    if (file === 'played' && req.method === 'POST') {
      link.counts.plays++;
      this.save(link, null);
      return this.send(res, 204, 'text/plain', '');
    }
    if (file === 'outside.png' && link.image)
      return this.send(res, 200, 'image/png', link.image, robots);
    if (link.clip && file === clipName(link.clip.type))
      return this.send(res, 200, link.clip.type, link.clip.bytes, robots);
    const bytes = link.build.get(file);
    if (!bytes) return this.send(res, 404, 'text/plain', 'Not found.');
    return this.send(res, 200, typeOf(file), bytes, robots);
  }

  /** The build's page with the link's outside in its head. */
  private page(link: Link): string {
    const html = new TextDecoder().decode(link.build.get('index.html') ?? new Uint8Array());
    const head = outsideHead(link.face, `${this.url}/w/${link.id}/`, {
      image: !!link.image,
      clip: link.clip ? clipName(link.clip.type) : null,
      type: link.clip?.type ?? '',
    });
    return html.replace(/<title>[\s\S]*?<\/title>/i, head);
  }

  private async api(req: IncomingMessage, res: ServerResponse, url: URL) {
    const path = url.pathname;
    if (req.method === 'POST' && path === '/api/links') {
      const upload = await this.body(req, LIMITS.maxTotalBytes);
      const made = this.read(upload);
      if ('error' in made) return this.json(res, made, 400);
      const id = randomBytes(6).toString('hex');
      const link: Link = {
        id,
        ...made,
        created: Date.now(),
        stopped: false,
        counts: { previews: 0, opens: 0, plays: 0 },
        pasted: null,
      };
      this.links.set(id, link);
      this.save(link, upload);
      this.options.log?.(
        `share: ${link.face.outside} link for ${link.face.reach} → ${this.url}/w/${id}/`,
      );
      // Pasted where the person shares it: what an app takes stays with that message.
      link.pasted = await this.paste(link);
      this.save(link, null);
      return this.json(res, this.describe(link));
    }
    if (req.method === 'POST' && path === '/api/preview') {
      const made = this.read(await this.body(req, 20 * 1024 * 1024), true);
      if ('error' in made) return this.json(res, made, 400);
      const id = randomBytes(6).toString('hex');
      this.drafts.set(id, { image: made.image, at: Date.now() });
      for (const [key, draft] of this.drafts)
        if (Date.now() - draft.at > 10 * 60 * 1000) this.drafts.delete(key);
      const page = `${this.url}/api/drafts/${id}/`;
      const head = outsideHead(made.face, page, {
        image: !!made.image,
        clip: made.clip ? clipName(made.clip.type) : null,
        type: made.clip?.type ?? '',
      });
      return this.json(res, readPreview(`<head>${head}</head>`, page));
    }
    const draft = /^\/api\/drafts\/([a-z0-9]+)\/outside\.png$/.exec(path);
    if (draft) {
      const image = this.drafts.get(draft[1]!)?.image;
      return image
        ? this.send(res, 200, 'image/png', image, this.cors(res))
        : this.json(res, { error: 'Not found.' }, 404);
    }
    if (req.method === 'GET' && path === '/api/links') {
      const work = url.searchParams.get('work');
      const name = url.searchParams.get('name');
      return this.json(
        res,
        [...this.links.values()]
          .filter(l => (!work || l.work === work) && (name === null || l.name === name))
          .map(l => this.describe(l))
          .reverse(),
      );
    }
    const stop = /^\/api\/links\/([a-z0-9]+)\/stop$/.exec(path);
    if (req.method === 'POST' && stop) {
      const link = this.links.get(stop[1]!);
      if (!link) return this.json(res, { error: 'Not found.' }, 404);
      link.stopped = true;
      this.save(link, null);
      this.options.log?.(`share: stopped ${this.url}/w/${link.id}/`);
      return this.json(res, this.describe(link));
    }
    if (req.method === 'GET' && path === '/api/unfurl') {
      const target = url.searchParams.get('url') ?? '';
      if (!target.startsWith(`${this.url}/w/`))
        return this.json(res, { error: 'The lab unfurls only its own links.' }, 400);
      return this.json(res, { preview: await this.unfurl(target, url.searchParams.has('fresh')) });
    }
    const pasted = /^\/api\/pasted\/([a-z0-9]+)\/(image|video)$/.exec(path);
    if (pasted) {
      const link = this.links.get(pasted[1]!);
      const bytes = pasted[2] === 'image' ? link?.pasted?.image : link?.pasted?.video;
      if (!link || !bytes) return this.json(res, { error: 'Not found.' }, 404);
      return this.send(
        res,
        200,
        pasted[2] === 'image' ? 'image/png' : (link.clip?.type ?? 'video/webm'),
        bytes,
        this.cors(res),
      );
    }
    return this.json(res, { error: 'Not found.' }, 404);
  }

  /** A link's upload: face.json, outside.png, the clip, and the playable build under build/. */
  private read(
    bytes: Uint8Array,
    faceOnly = false,
  ): Omit<Link, 'id' | 'created' | 'stopped' | 'counts' | 'pasted'> | { error: string } {
    let entries: ZipEntry[];
    try {
      entries = readZip(bytes, LIMITS);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
    const named = new Map(entries.map(e => [e.path, e.data]));
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(
        new TextDecoder().decode(named.get('face.json') ?? new Uint8Array()),
      ) as Record<string, unknown>;
    } catch {
      return { error: 'The link has no face.json.' };
    }
    const face = readFace(raw);
    const work = text(raw.work, 100);
    const name = text(raw.name, 100);
    const image = named.get('outside.png') ?? null;
    if (
      image &&
      !(image[0] === 0x89 && image[1] === 0x50 && image[2] === 0x4e && image[3] === 0x47)
    )
      return { error: 'outside.png is not a PNG.' };
    const clipEntry = entries.find(e => /^clip\.(webm|mp4)$/.test(e.path));
    const clip = clipEntry
      ? {
          bytes: clipEntry.data,
          type: clipEntry.path.endsWith('mp4') ? 'video/mp4' : 'video/webm',
          seconds: Number(raw.clipSeconds) || 0,
        }
      : null;
    const build = new Map<string, Uint8Array>();
    for (const e of entries) if (e.path.startsWith('build/')) build.set(e.path.slice(6), e.data);
    if (!faceOnly && !build.has('index.html')) return { error: 'The link has no playable build.' };
    if (face.outside !== 'plain' && !image) return { error: 'This outside needs its picture.' };
    if (face.outside === 'sound' && !clip && !faceOnly)
      return { error: 'The sound outside needs its clip.' };
    return { work, name, face, image, clip, build };
  }

  private describe(link: Link) {
    const { to, note, ...shown } = link.face;
    return {
      id: link.id,
      url: `${this.url}/w/${link.id}/`,
      work: link.work,
      name: link.name,
      face: { ...shown, to, note, hasClip: !!link.clip },
      created: link.created,
      stopped: link.stopped,
      counts: link.counts,
      pasted: link.pasted
        ? {
            at: link.pasted.at,
            preview: link.pasted.preview && {
              ...link.pasted.preview,
              image: link.pasted.image ? `${this.url}/api/pasted/${link.id}/image` : null,
              video:
                link.pasted.video && link.pasted.preview.video
                  ? { ...link.pasted.preview.video, url: `${this.url}/api/pasted/${link.id}/video` }
                  : null,
            },
          }
        : null,
    };
  }

  /** Read a link's page as an app that unfurls links does, reusing what it read for a while. */
  async unfurl(target: string, fresh = false): Promise<Preview | null> {
    const kept = this.cache.get(target);
    if (kept && !fresh && Date.now() - kept.at < CACHE_MS) return kept.preview;
    let preview: Preview | null = null;
    try {
      const res = await fetch(target, {
        headers: { 'user-agent': 'den-kit-lab-unfurl/1 (bot)' },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok && (res.headers.get('content-type') ?? '').startsWith('text/html'))
        preview = readPreview(await res.text(), res.url);
    } catch {
      preview = null;
    }
    this.cache.set(target, { at: Date.now(), preview });
    return preview;
  }

  /** What an app takes when the link is pasted: the preview, and copies of its picture and video. */
  private async paste(link: Link): Promise<Link['pasted']> {
    const preview = await this.unfurl(`${this.url}/w/${link.id}/`, true);
    const copy = async (url: string | null | undefined) => {
      if (!url) return null;
      try {
        const res = await fetch(url, {
          headers: { 'user-agent': 'den-kit-lab-unfurl/1 (bot)' },
          signal: AbortSignal.timeout(3000),
        });
        return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
      } catch {
        return null;
      }
    };
    return {
      at: Date.now(),
      preview,
      image: await copy(preview?.image),
      video: await copy(preview?.video?.url),
    };
  }

  /**
   * Keep a link in the store: its upload once, as the ZIP it came in (one file, so the editor's dev server, which
   * watches the repository, sees no page change), and its state on every change.
   */
  private save(link: Link, upload: Uint8Array | null) {
    const { store } = this.options;
    if (!store) return;
    const folder = join(store, link.id);
    mkdirSync(folder, { recursive: true });
    if (upload) writeFileSync(join(folder, 'upload.zip'), upload);
    if (link.pasted?.image) writeFileSync(join(folder, 'pasted.png'), link.pasted.image);
    if (link.pasted?.video) writeFileSync(join(folder, 'pasted.video'), link.pasted.video);
    writeFileSync(
      join(folder, 'link.json'),
      JSON.stringify({
        id: link.id,
        created: link.created,
        stopped: link.stopped,
        counts: link.counts,
        pasted: link.pasted ? { at: link.pasted.at, preview: link.pasted.preview } : null,
      }),
    );
  }

  private load() {
    const { store } = this.options;
    if (!store || !existsSync(store)) return;
    for (const id of readdirSync(store)) {
      const folder = join(store, id);
      const read = (name: string) =>
        existsSync(join(folder, name)) ? new Uint8Array(readFileSync(join(folder, name))) : null;
      try {
        const saved = JSON.parse(readFileSync(join(folder, 'link.json'), 'utf8')) as Pick<
          Link,
          'id' | 'created' | 'stopped' | 'counts'
        > & { pasted: { at: number; preview: Preview | null } | null };
        const made = this.read(read('upload.zip') ?? new Uint8Array());
        if ('error' in made) throw new Error(made.error);
        this.links.set(saved.id, {
          ...made,
          ...saved,
          pasted: saved.pasted
            ? { ...saved.pasted, image: read('pasted.png'), video: read('pasted.video') }
            : null,
        });
      } catch {
        this.options.log?.(`share: ${folder} could not be read and is left out.`);
      }
    }
  }
}
