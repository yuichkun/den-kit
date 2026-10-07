// Pictures and fonts a plugin uses. The patch keeps their descriptions; the
// bytes live here, in the browser's IndexedDB, keyed by asset id (a content
// hash), so the autosave stays small and the same picture added twice is stored
// once. Assets that ship with den-kit (the showcase) are plain URLs. Without
// IndexedDB (private windows, tests) the bytes stay in memory for the session.
import { FONT_MIMES, IMAGE_MIMES, MAX_ASSET_BYTES, type AssetMeta } from '../core/ui.ts';

const DB = 'den-kit-assets', STORE = 'blobs';
const BY_EXTENSION: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };

/** The asset id for these bytes: "a" and 15 hex digits of their SHA-256. */
export async function assetIdFor(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `a${[...digest].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 15)}`;
}

/** The type of a dropped file, from its name when the browser does not say (fonts usually). */
export function mimeOf(file: { name?: string; type?: string }): string | null {
  const known = [...IMAGE_MIMES, ...FONT_MIMES] as readonly string[];
  if (file.type && known.includes(file.type)) return file.type;
  const ext = /\.([a-z0-9]+)$/i.exec(file.name ?? '')?.[1]?.toLowerCase();
  return ext ? BY_EXTENSION[ext] ?? null : null;
}

async function imageSize(blob: Blob, mime: string): Promise<{ width?: number; height?: number }> {
  try {
    if (mime === 'image/svg+xml') {
      const text = await blob.text();
      const svg = /<svg[^>]*>/i.exec(text)?.[0] ?? '';
      const attr = (name: string) => Number(new RegExp(`\\s${name}="([0-9.]+)`).exec(svg)?.[1]);
      const box = /viewBox="[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)"/.exec(svg);
      const width = attr('width') || Number(box?.[1]), height = attr('height') || Number(box?.[2]);
      return width > 0 && height > 0 ? { width: Math.round(width), height: Math.round(height) } : {};
    }
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch { return {}; }
}

export class AssetError extends Error {}

export class AssetStore {
  private db: Promise<IDBDatabase | null>;
  private memory = new Map<string, Blob>();
  private urls = new Map<string, string>();

  constructor(factory: IDBFactory | null = globalThis.indexedDB ?? null) {
    this.db = !factory ? Promise.resolve(null) : new Promise(resolve => {
      try {
        const open = factory.open(DB, 1);
        open.onupgradeneeded = () => { open.result.createObjectStore(STORE); };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => resolve(null);
        open.onblocked = () => resolve(null);
      } catch { resolve(null); }
    });
  }

  private async tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
    const db = await this.db; if (!db) return undefined;
    return new Promise(resolve => {
      try {
        const request = run(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(undefined);
      } catch { resolve(undefined); }
    });
  }

  /** Keep a file's bytes and describe it as an asset (refused: not a picture or font, too large). */
  async add(file: Blob & { name?: string }): Promise<AssetMeta> {
    const mime = mimeOf(file);
    if (!mime) throw new AssetError(`"${file.name ?? 'file'}" is not a picture (PNG, JPEG, WebP, GIF, SVG) or a font (WOFF2, WOFF, TTF, OTF).`);
    if (file.size > MAX_ASSET_BYTES) throw new AssetError(`"${file.name ?? 'file'}" is larger than ${MAX_ASSET_BYTES / 1024 / 1024} MB.`);
    const bytes = await file.arrayBuffer();
    const id = await assetIdFor(bytes);
    const blob = new Blob([bytes], { type: mime });
    const size = mime.startsWith('image/') ? await imageSize(blob, mime) : {};
    // A picture the browser cannot decode would only ever show as a gap: say so instead of keeping it.
    if (mime.startsWith('image/') && mime !== 'image/svg+xml' && !size.width) throw new AssetError(`"${file.name ?? 'file'}" could not be read as a picture (the file may be damaged).`);
    await this.put(id, blob);
    const name = (file.name ?? id).slice(0, 120);
    return { id, name, mime, bytes: bytes.byteLength, ...size };
  }

  async put(id: string, blob: Blob) {
    this.memory.set(id, blob);
    await this.tx('readwrite', s => s.put(blob, id));
  }

  /** Store the bytes an imported patch carried (data: URLs). */
  async putDataUrl(id: string, dataUrl: string) {
    const blob = await (await fetch(dataUrl)).blob();
    await this.put(id, blob);
  }

  async get(id: string): Promise<Blob | null> {
    return this.memory.get(id) ?? (await this.tx<Blob>('readonly', s => s.get(id) as IDBRequest<Blob>)) ?? null;
  }

  /** A URL the page can show the asset with; null when its bytes are not here. */
  async url(meta: AssetMeta): Promise<string | null> {
    if (meta.url) return meta.url.startsWith('/') ? meta.url : `/${meta.url}`;
    const known = this.urls.get(meta.id); if (known) return known;
    const blob = await this.get(meta.id); if (!blob) return null;
    const url = URL.createObjectURL(blob);
    this.urls.set(meta.id, url);
    return url;
  }

  /** The asset as a data: URL (to carry it inside an exported patch). */
  async dataUrl(meta: AssetMeta): Promise<string | null> {
    let blob: Blob | null;
    if (meta.url) { try { const r = await fetch(await this.url(meta) ?? ''); blob = r.ok ? await r.blob() : null; } catch { blob = null; } }
    else blob = await this.get(meta.id);
    if (!blob) return null;
    const typed = blob.type === meta.mime ? blob : new Blob([blob], { type: meta.mime });
    return new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => resolve(null); reader.readAsDataURL(typed); });
  }
}
