// A picture of the work's icon or cover as it is drawn, for the AI: the surface is drawn
// off-screen at its design size (as ArtSurface draws it in the editor, without the rounded
// square lists put an icon in) and captured like the plugin (capture.ts).
import { createApp, h, nextTick } from 'vue';
import { ART_SIZE, type ArtSurfaceName } from '../work/art.ts';
import type { PatchDocument } from '../work/schema.ts';
import { assetFontFamily, assetsOf, isFontAsset } from '../work/ui.ts';
import { capture, pngBytes } from './capture.ts';
import ArtSurface from './ArtSurface.vue';

export interface ArtPicture {
  png: Uint8Array;
  width: number;
  height: number;
}

const frames = (n: number) =>
  new Promise<void>(resolve => {
    const step = (k: number) => (k <= 0 ? resolve() : requestAnimationFrame(() => step(k - 1)));
    step(n);
  });

/** The icon or the cover as drawn now, at most `maxSide` pixels on its longest side. */
export async function lookAtArt(
  doc: PatchDocument,
  on: ArtSurfaceName,
  options: { assetUrls: Readonly<Record<string, string>>; maxSide?: number },
): Promise<ArtPicture> {
  const { width, height } = ART_SIZE[on];
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-30000px;top:0;width:${width}px;height:${height}px;pointer-events:none;overflow:hidden`;
  document.body.appendChild(host);
  const app = createApp({
    render: () => h(ArtSurface, { doc, on, size: width, assetUrls: options.assetUrls }),
  });
  app.mount(host);
  try {
    await nextTick();
    await document.fonts.ready;
    await Promise.all(
      [...host.querySelectorAll('img')].map(img =>
        img.complete ? null : img.decode().catch(() => null),
      ),
    );
    await frames(2);
    const root = host.querySelector<HTMLElement>(`[data-art=${on}]`);
    if (!root) throw new Error(`The ${on} did not draw.`);
    const fontUrls = Object.fromEntries(
      Object.values(assetsOf(doc.files))
        .filter(isFontAsset)
        .flatMap(a =>
          options.assetUrls[a.id] ? [[assetFontFamily(a.id), options.assetUrls[a.id]!]] : [],
        ),
    );
    const scale = Math.min(1, (options.maxSide ?? 1200) / Math.max(width, height));
    const shot = await capture(root, { width, height, scale, fontUrls });
    return { png: await pngBytes(shot.canvas), width: shot.width, height: shot.height };
  } finally {
    app.unmount();
    host.remove();
  }
}
