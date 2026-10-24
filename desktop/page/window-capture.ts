// Pictures of den-kit's own window, for the AI (the ScreenCapture interface).
// The main process takes them with webContents.capturePage, which needs no OS
// permission; the page asks for them through the preload bridge.
import type { PageRect, Picture, ScreenCapture } from '../../src/host/index.ts';

export function windowCapture(capturePage: (rect: PageRect) => Promise<string>): ScreenCapture {
  return {
    source: 'shell',
    unsupported: null,
    asking: null,
    title: on =>
      on
        ? 'AI can see the den-kit window. Click to stop sharing.'
        : 'Let AI see the den-kit window.',
    start: async () => true,
    stop() {},
    async picture(rect, maxSide, wanted) {
      const url = await capturePage(roundRect(rect));
      if (!wanted()) throw new Error('The screen is not shared.');
      return fromDataUrl(url, maxSide);
    },
    onEnded: () => () => {},
  };
}

const roundRect = (r: PageRect): PageRect => ({
  x: Math.round(r.x),
  y: Math.round(r.y),
  width: Math.max(1, Math.round(r.width)),
  height: Math.max(1, Math.round(r.height)),
});

async function fromDataUrl(url: string, maxSide: number): Promise<Picture> {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  try {
    const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * k)),
      h = Math.max(1, Math.round(bitmap.height * k));
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    return {
      data: new Uint8Array(await blob.arrayBuffer()),
      mime: 'image/jpeg',
      width: w,
      height: h,
      source: 'shell',
    };
  } finally {
    bitmap.close();
  }
}
