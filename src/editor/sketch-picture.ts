// The sketch as a picture. For the AI: the marks drawn over the view they
// were made on, numbered as on screen — the plugin re-drawn at its design size,
// the patch as the person sees it (a shared screen) or drawn plainly (modules as
// named boxes, cables as lines). Alone, without numbers: a picture to lay under
// the plugin and build on.
import { MAX_TOOL_IMAGE } from '../host/ai.ts';
import { markBox, type Box, type Mark, type Point, type Target } from '../ai/sketch.ts';

/** Where the view's coordinates land on the picture: picture = (view − origin) × k. */
export interface Placement {
  ox: number;
  oy: number;
  k: number;
}
export interface SketchPicture {
  dataUrl: string;
  width: number;
  height: number;
  how: 'redrawn' | 'tab' | 'shell' | 'schematic';
}
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const NOTE_PAPER = '#fff8d6';

/** Lines of text that fit `width` (breaking at spaces where it can, anywhere in words without them, like Japanese). */
export function wrapText(measure: (s: string) => number, text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const ch of paragraph) {
      if (!line || measure(line + ch) <= width) {
        line += ch;
        continue;
      }
      const space = line.lastIndexOf(' ');
      if (ch !== ' ' && space > 0) {
        out.push(line.slice(0, space));
        line = line.slice(space + 1) + ch;
      } else {
        out.push(line);
        line = ch === ' ' ? '' : ch;
      }
    }
    out.push(line);
  }
  return out;
}

/** Where a mark's number sits (as on screen): a box's corner, an arrow's start, a stroke's first point. */
export function badgeAt(m: Mark): Point {
  if (m.rect) return [m.rect.x, m.rect.y];
  if (m.from) return m.from;
  return m.points?.[0] ?? [0, 0];
}

/** Draw marks on a picture. */
export function drawMarks(
  ctx: Ctx,
  marks: readonly Mark[],
  at: Placement,
  options: { numbers?: boolean } = {},
) {
  const P = ([x, y]: Point): Point => [(x - at.ox) * at.k, (y - at.oy) * at.k];
  const line = Math.max(2, 3 * at.k);
  for (const m of marks) {
    ctx.save();
    ctx.strokeStyle = m.color;
    ctx.fillStyle = m.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (m.points?.length) {
      ctx.globalAlpha = m.kind === 'marker' ? 0.45 : 1;
      ctx.lineWidth = Math.max(2, (m.width ?? 3) * at.k);
      ctx.beginPath();
      m.points.forEach((p, i) => {
        const [x, y] = P(p);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
    } else if (m.kind === 'rect' && m.rect) {
      const [x, y] = P([m.rect.x, m.rect.y]);
      ctx.lineWidth = line;
      ctx.strokeRect(x, y, m.rect.w * at.k, m.rect.h * at.k);
    } else if (m.kind === 'arrow' && m.from && m.to) {
      const [x0, y0] = P(m.from),
        [x1, y1] = P(m.to);
      ctx.lineWidth = line;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      const a = Math.atan2(y1 - y0, x1 - x0),
        s = Math.max(9, 14 * at.k);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - s * Math.cos(a + 0.45), y1 - s * Math.sin(a + 0.45));
      ctx.lineTo(x1 - s * Math.cos(a - 0.45), y1 - s * Math.sin(a - 0.45));
      ctx.closePath();
      ctx.fill();
    } else if ((m.kind === 'note' || m.kind === 'text') && m.rect) {
      const [x, y] = P([m.rect.x, m.rect.y]);
      const w = m.rect.w * at.k,
        h = m.rect.h * at.k;
      // Notes were made 180 (texts 220) view units wide at the zoom of the moment: their letters scale the same way.
      const size = Math.max(
        10,
        Math.min(28, (15 * at.k * m.rect.w) / (m.kind === 'note' ? 180 : 220)),
      );
      if (m.kind === 'note') {
        ctx.fillStyle = NOTE_PAPER;
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = m.color;
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
      }
      ctx.font = `${m.kind === 'text' ? 700 : 400} ${size}px Kalam, 'Comic Sans MS', system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = m.kind === 'note' ? '#1b1b1b' : m.color;
      if (m.kind === 'text') {
        ctx.shadowColor = '#000c';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetY = 1;
      }
      const pad = 6 * Math.max(0.5, at.k);
      const lines = wrapText(
        s => ctx.measureText(s).width,
        m.text ?? '',
        Math.max(10, w - 2 * pad),
      );
      lines.forEach((l, i) => {
        if (pad + (i + 1) * size * 1.25 <= h + size)
          ctx.fillText(l, x + pad, y + pad + i * size * 1.25);
      });
    }
    ctx.restore();
    if (options.numbers) {
      const [x, y] = P(badgeAt(m));
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.fillStyle = m.color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#000';
      ctx.stroke();
      ctx.fillStyle = '#000';
      ctx.font = '700 13px Lato, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(m.n), x, y + 0.5);
      ctx.restore();
    }
  }
}

const toDataUrl = async (blob: Blob) =>
  `data:${blob.type};base64,${base64(new Uint8Array(await blob.arrayBuffer()))}`;
function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The canvas as a data URL the AI takes: PNG when it is small enough, else JPEG, else smaller. */
async function encode(
  canvas: OffscreenCanvas,
): Promise<{ dataUrl: string; width: number; height: number }> {
  let c = canvas;
  for (let tries = 0; tries < 4; tries++) {
    const png = await toDataUrl(await c.convertToBlob({ type: 'image/png' }));
    if (png.length <= MAX_TOOL_IMAGE) return { dataUrl: png, width: c.width, height: c.height };
    const jpeg = await toDataUrl(await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 }));
    if (jpeg.length <= MAX_TOOL_IMAGE) return { dataUrl: jpeg, width: c.width, height: c.height };
    const smaller = new OffscreenCanvas(
      Math.max(1, Math.round(c.width * 0.7)),
      Math.max(1, Math.round(c.height * 0.7)),
    );
    smaller.getContext('2d')!.drawImage(c, 0, 0, smaller.width, smaller.height);
    c = smaller;
  }
  throw new Error('The sketch picture is too large.');
}

/** The plugin re-drawn (a PNG of it at its design size, or nothing when it is empty) with the numbered marks on it. */
export async function pluginPicture(
  base: { png: Uint8Array | null; width: number; height: number },
  design: { width: number; height: number; background: string },
  marks: readonly Mark[],
  maxSide = 1200,
): Promise<SketchPicture> {
  const k0 = Math.min(1, maxSide / Math.max(design.width, design.height));
  const width = base.png ? base.width : Math.round(design.width * k0),
    height = base.png ? base.height : Math.round(design.height * k0);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = design.background;
  ctx.fillRect(0, 0, width, height);
  if (base.png) {
    const bitmap = await createImageBitmap(new Blob([base.png as BlobPart], { type: 'image/png' }));
    try {
      ctx.drawImage(bitmap, 0, 0, width, height);
    } finally {
      bitmap.close();
    }
  }
  drawMarks(ctx, marks, { ox: 0, oy: 0, k: width / design.width }, { numbers: true });
  return { ...(await encode(canvas)), how: 'redrawn' };
}

/** The sketch alone at the plugin's design size, on nothing: a picture to lay under the plugin. */
export async function underlayPicture(
  design: { width: number; height: number },
  marks: readonly Mark[],
): Promise<Blob> {
  const canvas = new OffscreenCanvas(design.width, design.height);
  drawMarks(canvas.getContext('2d')!, marks, { ox: 0, oy: 0, k: 1 });
  return canvas.convertToBlob({ type: 'image/png' });
}

/** Where everything is, so the picture holds the modules and the marks with a margin around. */
export function fit(
  boxes: readonly Box[],
  maxSide: number,
  pad = 40,
): Placement & { width: number; height: number } {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  if (!Number.isFinite(x0)) {
    x0 = 0;
    y0 = 0;
    x1 = 400;
    y1 = 300;
  }
  x0 -= pad;
  y0 -= pad;
  x1 += pad;
  y1 += pad;
  const k = Math.min(1.25, maxSide / Math.max(x1 - x0, y1 - y0));
  return {
    ox: x0,
    oy: y0,
    k,
    width: Math.max(1, Math.round((x1 - x0) * k)),
    height: Math.max(1, Math.round((y1 - y0) * k)),
  };
}

/** The patch drawn plainly — modules as named boxes, cables as lines — with the numbered marks on it. */
export async function patchSchematic(
  modules: readonly Target[],
  cables: ReadonlyArray<{ from: string; to: string }>,
  marks: readonly Mark[],
  maxSide = 1280,
): Promise<SketchPicture> {
  const at = fit([...modules.map(t => t.box), ...marks.map(markBox)], maxSide);
  const canvas = new OffscreenCanvas(at.width, at.height);
  const ctx = canvas.getContext('2d')!;
  const P = (x: number, y: number): Point => [(x - at.ox) * at.k, (y - at.oy) * at.k];
  ctx.fillStyle = '#0e0e0e';
  ctx.fillRect(0, 0, at.width, at.height);
  const box = new Map(modules.map(t => [t.id, t.box]));
  ctx.strokeStyle = '#8a8a8a';
  ctx.lineWidth = Math.max(1.5, 2 * at.k);
  for (const c of cables) {
    const a = box.get(c.from),
      b = box.get(c.to);
    if (!a || !b) continue;
    const [x0, y0] = P(a.x + a.w, a.y + a.h / 2),
      [x1, y1] = P(b.x, b.y + b.h / 2);
    const bend = Math.max(30, Math.abs(x1 - x0) / 2);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(x0 + bend, y0, x1 - bend, y1, x1, y1);
    ctx.stroke();
  }
  const size = Math.max(10, Math.min(15, 13 * at.k));
  for (const t of modules) {
    const [x, y] = P(t.box.x, t.box.y),
      w = t.box.w * at.k,
      h = t.box.h * at.k;
    ctx.fillStyle = '#262626';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#5a5a5a';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = '#e6e6e6';
    ctx.font = `600 ${size}px Lato, system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    wrapText(s => ctx.measureText(s).width, t.label, Math.max(10, w - 12))
      .slice(0, 3)
      .forEach((l, i) => ctx.fillText(l, x + 6, y + 6 + i * size * 1.3));
    ctx.restore();
  }
  drawMarks(ctx, marks, at, { numbers: true });
  return { ...(await encode(canvas)), how: 'schematic' };
}
