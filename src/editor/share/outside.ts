// The pictures on a link's outside (Host.publish), drawn in the work's own colors and font:
// a poster of the work's plugin screen with its name, kind and author, or a wrapping that
// shows its name and who it is from (outer) or only who it is from (inner), as a gift's
// wrapping shows its paper label outside or keeps it inside. 1200 × 630, the size apps that
// unfurl links show without cropping it much.
import { lookVars } from '../../screen/build.ts';
import type { PatchDocument } from '../../work/schema.ts';

export const OUTSIDE_SIZE = { width: 1200, height: 630 } as const;

export interface OutsideWords {
  title: string;
  from: string;
  kind: 'Instrument' | 'Effect';
  line: string;
}
export interface WorkLook {
  bg: string;
  fg: string;
  accent: string;
  muted: string;
  font: string;
  labelFont: string;
}

/** The work's colors and fonts, as #rrggbb (a link's edge color) and font stacks. */
export function workLook(doc: Pick<PatchDocument, 'panel' | 'ui'>): WorkLook {
  const vars = lookVars(doc);
  return {
    bg: hexColor(vars['--dk-bg'] ?? '#111111'),
    fg: hexColor(vars['--dk-fg'] ?? '#eeeeee'),
    accent: hexColor(vars['--dk-accent'] ?? '#ff8800'),
    muted: hexColor(vars['--dk-muted'] ?? '#888888'),
    font: vars['--dk-font'] ?? 'sans-serif',
    labelFont: vars['--dk-label-font'] ?? vars['--dk-font'] ?? 'sans-serif',
  };
}

/** A CSS color as #rrggbb, as the browser reads it (transparency dropped). */
export function hexColor(color: string): string {
  const g = document.createElement('canvas').getContext('2d')!;
  g.fillStyle = '#000000';
  g.fillStyle = color;
  const read = g.fillStyle;
  if (read.startsWith('#')) return read;
  const [r = 0, gr = 0, b = 0] = (read.match(/[\d.]+/g) ?? []).map(Number);
  return `#${[r, gr, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

function canvas() {
  const c = document.createElement('canvas');
  c.width = OUTSIDE_SIZE.width;
  c.height = OUTSIDE_SIZE.height;
  return { c, g: c.getContext('2d')! };
}

async function png(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>(resolve => c.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The picture could not be made.');
  return new Uint8Array(await blob.arrayBuffer());
}

/** Lines of `text` that fit `width` at the current font, at most `most` (the last one cut with …). */
function lines(g: CanvasRenderingContext2D, text: string, width: number, most: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width <= width || !line) line = next;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  if (out.length <= most) return out;
  const kept = out.slice(0, most);
  let last = kept[most - 1]!;
  while (last && g.measureText(`${last}…`).width > width) last = last.slice(0, -1);
  kept[most - 1] = `${last.trimEnd()}…`;
  return kept;
}

/** The largest size from `sizes` at which `text` fits `width` in `most` lines. */
function fit(
  g: CanvasRenderingContext2D,
  text: string,
  font: (size: number) => string,
  sizes: number[],
  width: number,
  most: number,
) {
  for (const size of sizes) {
    g.font = font(size);
    const words = text.split(/\s+/).filter(Boolean);
    if (
      words.every(w => g.measureText(w).width <= width) &&
      lines(g, text, width, 99).length <= most
    )
      return size;
  }
  g.font = font(sizes[sizes.length - 1]!);
  return sizes[sizes.length - 1]!;
}

async function loadFonts(look: WorkLook) {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.allSettled([
    document.fonts.load(`700 64px ${look.font}`),
    document.fonts.load(`400 30px ${look.font}`),
    document.fonts.load(`600 26px ${look.labelFont}`),
  ]);
}

const kindWords = (words: OutsideWords) =>
  words.kind === 'Effect' ? 'An effect' : 'An instrument';

/** The poster: the plugin screen on the right, its name, kind, author and line on the left. */
export async function posterPicture(
  screen: Uint8Array | null,
  words: OutsideWords,
  look: WorkLook,
): Promise<Uint8Array> {
  await loadFonts(look);
  const { c, g } = canvas();
  const { width: W, height: H } = OUTSIDE_SIZE;
  g.fillStyle = look.bg;
  g.fillRect(0, 0, W, H);
  // A wash of the accent behind the screen, so dark and light works both read as theirs.
  const wash = g.createRadialGradient(W * 0.74, H * 0.5, 40, W * 0.74, H * 0.5, W * 0.55);
  wash.addColorStop(0, `${look.accent}40`);
  wash.addColorStop(1, `${look.accent}00`);
  g.fillStyle = wash;
  g.fillRect(0, 0, W, H);
  const textWidth = screen ? 470 : W - 144;
  if (screen) {
    const picture = await createImageBitmap(new Blob([screen as BlobPart], { type: 'image/png' }));
    const box = { x: 590, y: 56, w: 554, h: H - 112 };
    const scale = Math.min(box.w / picture.width, box.h / picture.height);
    const w = picture.width * scale;
    const h = picture.height * scale;
    const x = box.x + (box.w - w) / 2;
    const y = box.y + (box.h - h) / 2;
    g.save();
    g.shadowColor = '#00000080';
    g.shadowBlur = 36;
    g.shadowOffsetY = 12;
    g.fillStyle = look.bg;
    g.fillRect(x, y, w, h);
    g.restore();
    g.drawImage(picture, x, y, w, h);
    g.strokeStyle = `${look.fg}26`;
    g.lineWidth = 2;
    g.strokeRect(x - 1, y - 1, w + 2, h + 2);
  }
  let y = 92;
  g.textBaseline = 'alphabetic';
  g.fillStyle = look.muted;
  g.font = `600 26px ${look.labelFont}`;
  g.fillText(`den-kit · ${words.kind}`, 72, y);
  y += 44;
  const size = fit(
    g,
    words.title,
    s => `700 ${s}px ${look.font}`,
    [84, 76, 68, 60, 52, 46],
    textWidth,
    3,
  );
  g.fillStyle = look.fg;
  for (const l of lines(g, words.title, textWidth, 3)) {
    y += size * 1.05;
    g.fillText(l, 72, y);
  }
  if (words.from) {
    y += 52;
    g.fillStyle = look.accent;
    g.font = `600 32px ${look.font}`;
    g.fillText(`by ${words.from}`, 72, y);
  }
  if (words.line) {
    g.font = `400 28px ${look.font}`;
    g.fillStyle = look.fg;
    g.globalAlpha = 0.82;
    y += 22;
    for (const l of lines(g, words.line, textWidth, Math.max(1, Math.floor((H - 60 - y) / 38)))) {
      y += 38;
      g.fillText(l, 72, y);
    }
    g.globalAlpha = 1;
  }
  return png(c);
}

/**
 * The wrapping: paper in the work's accent with a band across it. Outer: a label on the band
 * with the work's name and who it is from. Inner: a small tag with only who it is from.
 */
export async function wrappingPicture(
  words: OutsideWords,
  look: WorkLook,
  outer: boolean,
): Promise<Uint8Array> {
  await loadFonts(look);
  const { c, g } = canvas();
  const { width: W, height: H } = OUTSIDE_SIZE;
  g.fillStyle = look.accent;
  g.fillRect(0, 0, W, H);
  // The paper's grain: fine diagonal lines in the work's background color.
  g.strokeStyle = `${look.bg}1f`;
  g.lineWidth = 2;
  for (let x = -H; x < W; x += 22) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + H, H);
    g.stroke();
  }
  // The band across, and the knot where it is tied.
  g.fillStyle = look.bg;
  g.fillRect(0, H / 2 - 34, W, 68);
  g.fillRect(W * 0.78 - 34, 0, 68, H);
  g.beginPath();
  g.arc(W * 0.78, H / 2, 58, 0, Math.PI * 2);
  g.fill();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (outer) {
    const w = 560;
    const h = 380;
    const x = W * 0.4 - w / 2;
    const y = (H - h) / 2;
    g.save();
    g.shadowColor = '#00000059';
    g.shadowBlur = 24;
    g.shadowOffsetY = 8;
    g.fillStyle = look.fg;
    g.fillRect(x, y, w, h);
    g.restore();
    g.strokeStyle = look.bg;
    g.lineWidth = 3;
    g.strokeRect(x + 14, y + 14, w - 28, h - 28);
    g.fillStyle = look.bg;
    g.font = `600 24px ${look.labelFont}`;
    g.fillText(`${kindWords(words)}, wrapped`, x + w / 2, y + 62);
    const size = fit(
      g,
      words.title,
      s => `700 ${s}px ${look.font}`,
      [72, 64, 56, 48, 42],
      w - 96,
      2,
    );
    const shown = lines(g, words.title, w - 96, 2);
    shown.forEach((l, i) =>
      g.fillText(
        l,
        x + w / 2,
        y + h / 2 - ((shown.length - 1) * size * 1.08) / 2 + i * size * 1.08,
      ),
    );
    if (words.from) {
      g.font = `600 30px ${look.font}`;
      g.fillText(`from ${words.from}`, x + w / 2, y + h - 64);
    }
  } else {
    const label = words.from ? `from ${words.from}` : 'for you';
    g.font = `600 34px ${look.font}`;
    const w = Math.max(260, g.measureText(label).width + 80);
    const h = 92;
    const x = W * 0.4 - w / 2;
    const y = H / 2 - h / 2;
    g.save();
    g.shadowColor = '#00000059';
    g.shadowBlur = 18;
    g.shadowOffsetY = 6;
    g.fillStyle = look.fg;
    g.fillRect(x, y, w, h);
    g.restore();
    g.fillStyle = look.bg;
    g.fillText(label, x + w / 2, y + h / 2 + 1);
  }
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillStyle = look.bg;
  g.font = `600 24px ${look.labelFont}`;
  g.fillText('den-kit', 48, H - 40);
  return png(c);
}
