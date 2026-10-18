// A picture made small enough to hand over (to the AI), with its main colours:
// a reference photo or sketch the person gave says "make it look like this",
// and the palette says it in numbers too, for models that cannot see.

export interface PictureView {
  png: Uint8Array | null;
  width: number;
  height: number;
  palette: Array<{ color: string; share: number }>;
}

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/**
 * The main colours of some pixels (RGBA): split the colours into up to `count`
 * boxes, each time cutting the box with the widest spread of a channel in the
 * middle of that spread (so separate colours stay apart), and average each box.
 * Mostly transparent pixels do not count. Largest share first.
 */
export function palette(
  data: Uint8ClampedArray,
  count = 5,
): Array<{ color: string; share: number }> {
  const px: number[][] = [];
  for (let i = 0; i < data.length; i += 4)
    if (data[i + 3]! >= 128) px.push([data[i]!, data[i + 1]!, data[i + 2]!]);
  if (!px.length) return [];
  let boxes = [px];
  while (boxes.length < count) {
    // Split the box with the widest spread of any channel.
    let best = -1,
      bestSpread = 0,
      bestChannel = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 255,
          hi = 0;
        for (const p of box) {
          lo = Math.min(lo, p[c]!);
          hi = Math.max(hi, p[c]!);
        }
        if (hi - lo > bestSpread) {
          bestSpread = hi - lo;
          best = i;
          bestChannel = c;
        }
      }
    });
    if (best < 0 || bestSpread < 12) break;
    const box = boxes[best]!;
    let lo = 255,
      hi = 0;
    for (const p of box) {
      lo = Math.min(lo, p[bestChannel]!);
      hi = Math.max(hi, p[bestChannel]!);
    }
    const cut = (lo + hi) / 2;
    boxes = [
      ...boxes.slice(0, best),
      box.filter(p => p[bestChannel]! < cut),
      box.filter(p => p[bestChannel]! >= cut),
      ...boxes.slice(best + 1),
    ];
  }
  return boxes
    .map(box => {
      const sum = box.reduce((s, p) => [s[0]! + p[0]!, s[1]! + p[1]!, s[2]! + p[2]!], [0, 0, 0]);
      return {
        color: hex(sum[0]! / box.length, sum[1]! / box.length, sum[2]! / box.length),
        share: box.length / px.length,
      };
    })
    .sort((a, b) => b.share - a.share);
}

/** Load a picture from `url`; return it as a PNG at most `maxSide` pixels across, and its main colours. */
export async function viewPicture(url: string, maxSide = 768): Promise<PictureView> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const w = img.naturalWidth || 256,
    h = img.naturalHeight || 256;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const g = canvas.getContext('2d')!;
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  const small = document.createElement('canvas');
  small.width = 48;
  small.height = Math.max(1, Math.round((48 * h) / w));
  small.getContext('2d')!.drawImage(img, 0, 0, small.width, small.height);
  const colors = palette(
    small.getContext('2d')!.getImageData(0, 0, small.width, small.height).data,
  );
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  return {
    png: blob ? new Uint8Array(await blob.arrayBuffer()) : null,
    width: w,
    height: h,
    palette: colors,
  };
}
