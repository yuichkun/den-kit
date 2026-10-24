// The URLs the editor shows the work's pictures and fonts with: a path that holds
// other contents (the file removed and added again, that undone) shows those
// contents, and a font at that path is registered again under the path's family.
// A file den-kit ships comes only from den-kit's own origin.
import { resolveObjectURL } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { KitSession } from '../../../src/editor/session.ts';
import { AssetStore } from '../../../src/work/asset-store.ts';
import { assetFontFamily } from '../../../src/work/ui.ts';

afterEach(() => vi.unstubAllGlobals());

const session = () =>
  new KitSession({
    storage: null,
    createWorker: () =>
      ({
        postMessage() {},
        terminate() {},
        onmessage: null,
        onerror: null,
        onmessageerror: null,
      }) as never,
    engine: { setParam() {}, setAssets() {}, unload() {}, running: false } as never,
  });
const picture = (color: string) =>
  new File(
    [
      `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="${color}"/></svg>`,
    ],
    'logo.svg',
    { type: 'image/svg+xml' },
  );
const font = (last: number) =>
  new File([new Uint8Array([0x77, 0x4f, 0x46, 0x46, last])], 'title.woff', { type: 'font/woff' });
/** The bytes behind the URL the page shows a path with. */
async function shown(k: KitSession, path: string): Promise<Uint8Array | null> {
  const blob = resolveObjectURL(k.assetUrls.value[path] ?? '');
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}
const text = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes) : null);

describe("the URLs of the work's pictures and fonts", () => {
  it("shows a file den-kit ships from den-kit's own origin, and nothing for another host", async () => {
    const fetched = vi.fn(async () => new Response(new Uint8Array([1])));
    vi.stubGlobal('fetch', fetched);
    const store = new AssetStore(null);
    const meta = (url: string) => ({
      id: 'assets/a.png',
      name: 'a.png',
      mime: 'image/png',
      bytes: 1,
      url,
    });
    expect(await store.url(meta('/showcase/wood.jpg'))).toBe('/showcase/wood.jpg');
    expect(await store.url(meta('//attacker.example/probe.png'))).toBeNull();
    expect(await store.read(meta('//attacker.example/probe.png'))).toBeNull();
    expect(fetched).not.toHaveBeenCalled();
  });

  it('a path that holds other contents shows them, and the earlier ones again on undo', async () => {
    const k = session();
    expect((await k.addAssetFile(picture('red')))?.id).toBe('assets/logo.svg');
    expect(text(await shown(k, 'assets/logo.svg'))).toContain('red');
    expect(k.commit([{ op: 'removeAsset', id: 'assets/logo.svg' }]).ok).toBe(true);
    expect((await k.addAssetFile(picture('blue')))?.id).toBe('assets/logo.svg');
    expect(text(await shown(k, 'assets/logo.svg'))).toContain('blue');
    k.undo();
    k.undo();
    await k.syncAssets();
    expect(text(await shown(k, 'assets/logo.svg'))).toContain('red');
  });

  it("a font at a path that holds other contents is registered again, once, under the path's family", async () => {
    const k = session();
    const fonts = new Set<object>();
    vi.stubGlobal('document', { fonts });
    vi.stubGlobal(
      'FontFace',
      class {
        family: string;
        source: string;
        constructor(family: string, source: string) {
          this.family = family;
          this.source = source;
        }
        async load() {
          return this;
        }
      },
    );
    await k.addAssetFile(font(1));
    expect(k.commit([{ op: 'removeAsset', id: 'assets/title.woff' }]).ok).toBe(true);
    await k.addAssetFile(font(2));
    const url = k.assetUrls.value['assets/title.woff'];
    expect([...fonts]).toEqual([
      { family: assetFontFamily('assets/title.woff'), source: `url("${url}")` },
    ]);
    expect(await shown(k, 'assets/title.woff')).toEqual(
      new Uint8Array([0x77, 0x4f, 0x46, 0x46, 2]),
    );
  });
});
