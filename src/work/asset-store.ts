// The contents of the work's files that are not text, by their SHA-256. The
// record names a file's hash; the bytes live here, kept by the host's storage,
// so a saved work stays small and the same file added twice is kept once.
// Files shipped with den-kit are plain URLs. Without storage (tests) the bytes
// stay in memory for the session.
import { checkFile, sha256, typeOfPath } from './files.ts';
import { MAX_ASSET_BYTES, type AssetMeta } from './ui.ts';

/** Where contents are kept: the host's storage. */
export interface ContentStorage {
  readContent(hash: string): Promise<Uint8Array | null>;
  writeContent(hash: string, bytes: Uint8Array): Promise<void>;
}

async function imageSize(blob: Blob, mime: string): Promise<{ width?: number; height?: number }> {
  try {
    if (mime === 'image/svg+xml') {
      const text = await blob.text();
      const svg = /<svg[^>]*>/i.exec(text)?.[0] ?? '';
      const attr = (name: string) => Number(new RegExp(`\\s${name}="([0-9.]+)`).exec(svg)?.[1]);
      const box = /viewBox="[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)"/.exec(svg);
      const width = attr('width') || Number(box?.[1]),
        height = attr('height') || Number(box?.[2]);
      return width > 0 && height > 0
        ? { width: Math.round(width), height: Math.round(height) }
        : {};
    }
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return {};
  }
}

/** A file name the work can keep: plain characters, its extension kept. */
export function assetName(name: string): string {
  const clean = name
    .trim()
    .replace(/[^A-Za-z0-9_.@+ -]/g, '-')
    .replace(/^[.\s-]+/, '')
    .slice(-80);
  return clean || 'file';
}

/** `assets/<name>`, numbered when that path is taken. */
export function freeAssetPath(name: string, taken: (path: string) => boolean): string {
  const clean = assetName(name);
  const dot = clean.lastIndexOf('.');
  const stem = dot > 0 ? clean.slice(0, dot) : clean,
    ext = dot > 0 ? clean.slice(dot) : '';
  for (let n = 1; ; n++) {
    const path = `assets/${n === 1 ? clean : `${stem}-${n}${ext}`}`;
    if (!taken(path)) return path;
  }
}

export class AssetError extends Error {}

export class AssetStore {
  private readonly storage: ContentStorage | null;
  private memory = new Map<string, Uint8Array>();
  private urls = new Map<string, string>();

  constructor(storage: ContentStorage | null = null) {
    this.storage = storage;
  }

  /**
   * Keep a file's contents and describe it as an asset at a free path under
   * `assets/` (refused: too large, or not what its name says).
   */
  async add(file: Blob & { name?: string }, taken: (path: string) => boolean): Promise<AssetMeta> {
    if (file.size > MAX_ASSET_BYTES)
      throw new AssetError(
        `"${file.name ?? 'file'}" is larger than ${MAX_ASSET_BYTES / 1024 / 1024} MB.`,
      );
    const path = freeAssetPath(file.name ?? 'file', taken);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checked = await checkFile(path, bytes, sha256, { content: true });
    if (!checked.ok) throw new AssetError(checked.reason);
    const { type, as } = typeOfPath(path);
    const size = as === 'image' ? await imageSize(new Blob([bytes], { type }), type) : {};
    // A picture the browser cannot decode would only ever show as a gap: say so instead of keeping it.
    if (as === 'image' && type !== 'image/svg+xml' && !size.width)
      throw new AssetError(
        `"${file.name ?? 'file'}" could not be read as a picture (the file may be damaged).`,
      );
    const hash = await this.put(bytes);
    return {
      id: path,
      name: path.split('/').at(-1)!,
      mime: type,
      bytes: bytes.length,
      hash,
      ...size,
    };
  }

  /** Keep contents; returns their hash. */
  async put(bytes: Uint8Array): Promise<string> {
    const hash = await sha256(bytes);
    if (!this.memory.has(hash)) {
      // Kept by the host first: contents the host refused are not offered as kept.
      await this.storage?.writeContent(hash, bytes);
      this.memory.set(hash, bytes);
    }
    return hash;
  }

  /** Keep the contents a file carried as a data: URL (My parts); returns their hash. */
  async putDataUrl(dataUrl: string): Promise<string> {
    return this.put(new Uint8Array(await (await fetch(dataUrl)).arrayBuffer()));
  }

  /** The contents with this hash, or null when they are not here. */
  async bytes(hash: string): Promise<Uint8Array | null> {
    const known = this.memory.get(hash);
    if (known) return known;
    const read = await this.storage?.readContent(hash);
    if (read) this.memory.set(hash, read);
    return read ?? null;
  }

  /** The bytes of an asset: its stored contents, or the file den-kit ships. */
  async read(meta: AssetMeta): Promise<Uint8Array | null> {
    if (meta.hash) return this.bytes(meta.hash);
    if (!meta.url) return null;
    try {
      const r = await fetch(meta.url);
      return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
    } catch {
      return null;
    }
  }

  /** A URL the page can show the asset with; null when its contents are not here. */
  async url(meta: AssetMeta): Promise<string | null> {
    if (meta.url) return meta.url.startsWith('/') ? meta.url : `/${meta.url}`;
    if (!meta.hash) return null;
    const known = this.urls.get(meta.hash);
    if (known) return known;
    const bytes = await this.bytes(meta.hash);
    if (!bytes) return null;
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: meta.mime }));
    this.urls.set(meta.hash, url);
    return url;
  }

  /** The asset as a data: URL (to carry it inside a My parts file). */
  async dataUrl(meta: AssetMeta): Promise<string | null> {
    const bytes = await this.read(meta);
    if (!bytes) return null;
    const blob = new Blob([bytes as BlobPart], { type: meta.mime });
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  }
}
