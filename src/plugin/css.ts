// The look's data turned into CSS declarations. Every value here already passed
// the checks in core/ui.ts (colours, numbers, asset ids); picture assets become
// URLs through `url` (null while loading or missing: the layer is left out).
import {
  cssColor,
  fontStack,
  tokenVar,
  type ColorToken,
  type ElementStyle,
  type Fill,
  type TextStyle,
  type WidgetStyle,
} from '../core/ui.ts';

export type AssetUrl = (asset: string) => string | null;
type Css = Record<string, string>;

const stops = (list: Array<{ color: string; at: number }>) =>
  list.map(s => `${cssColor(s.color)} ${(s.at * 100).toFixed(1)}%`).join(', ');
const quoted = (url: string) => `url("${url.replace(/["\\\n]/g, '')}")`;

/** One fill layer (drawn as its own box, so each layer has its own opacity and blend). */
export function fillCss(fill: Fill, url: AssetUrl): Css | null {
  const css: Css = {};
  switch (fill.kind) {
    case 'color':
      css.background = cssColor(fill.color);
      break;
    case 'linear':
      css.backgroundImage = `linear-gradient(${fill.angle}deg, ${stops(fill.stops)})`;
      break;
    case 'radial':
      css.backgroundImage = `radial-gradient(ellipse at ${(fill.x * 100).toFixed(1)}% ${(fill.y * 100).toFixed(1)}%, ${stops(fill.stops)})`;
      break;
    case 'image': {
      const u = url(fill.asset);
      if (!u) return null;
      css.backgroundImage = quoted(u);
      css.backgroundPosition = 'center';
      css.backgroundRepeat = fill.fit === 'tile' ? 'repeat' : 'no-repeat';
      css.backgroundSize =
        fill.fit === 'tile'
          ? `${fill.size ?? 256}px`
          : fill.fit === 'stretch'
            ? '100% 100%'
            : fill.fit;
      break;
    }
  }
  if (fill.opacity !== undefined) css.opacity = String(fill.opacity);
  if (fill.blend && fill.blend !== 'normal') css.mixBlendMode = fill.blend;
  return css;
}

/** The box of an element (or of a widget's cell): border, corners, shadows, opacity, rotation. */
export function boxCss(style: ElementStyle | undefined, ellipse = false): Css {
  const css: Css = {};
  if (!style) {
    if (ellipse) css.borderRadius = '50%';
    return css;
  }
  if (style.stroke && style.stroke.width > 0)
    css.border = `${style.stroke.width}px ${style.stroke.style} ${cssColor(style.stroke.color)}`;
  if (ellipse) css.borderRadius = '50%';
  else if (style.radius) css.borderRadius = `${style.radius}px`;
  if (style.shadows?.length)
    css.boxShadow = style.shadows
      .map(
        s =>
          `${s.inset ? 'inset ' : ''}${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${cssColor(s.color)}`,
      )
      .join(', ');
  if (style.opacity !== undefined) css.opacity = String(style.opacity);
  if (style.rotate) css.transform = `rotate(${style.rotate}deg)`;
  if (style.blend && style.blend !== 'normal') css.mixBlendMode = style.blend;
  if (style.blur) css.filter = `blur(${style.blur}px)`;
  return css;
}

/** Text: font, size, colour, alignment, spacing, case, shadows (glow, engraving) and outline. */
export function textCss(
  t: TextStyle | undefined,
  defaults: { font?: string; size?: number; color?: string } = {},
): Css {
  const css: Css = {
    fontFamily: fontStack(t?.font ?? defaults.font ?? 'font'),
    fontSize: `${t?.size ?? defaults.size ?? 14}px`,
    color: cssColor(t?.color ?? defaults.color ?? 'fg'),
    textAlign: t?.align ?? 'center',
    justifyContent:
      t?.align === 'left' ? 'flex-start' : t?.align === 'right' ? 'flex-end' : 'center',
    alignItems: t?.valign === 'top' ? 'flex-start' : t?.valign === 'bottom' ? 'flex-end' : 'center',
  };
  if (t?.weight) css.fontWeight = String(t.weight);
  if (t?.spacing !== undefined) css.letterSpacing = `${t.spacing}em`;
  if (t?.lineHeight !== undefined) css.lineHeight = String(t.lineHeight);
  if (t?.case && t.case !== 'none')
    css.textTransform = t.case === 'upper' ? 'uppercase' : 'lowercase';
  if (t?.italic) css.fontStyle = 'italic';
  if (t?.shadows?.length)
    css.textShadow = t.shadows
      .map(s => `${s.x}px ${s.y}px ${s.blur}px ${cssColor(s.color)}`)
      .join(', ');
  if (t?.stroke && t.stroke.width > 0)
    css.webkitTextStroke = `${t.stroke.width}px ${cssColor(t.stroke.color)}`;
  return css;
}

/** A widget's own colours and label text, as the custom properties its control reads. */
export function widgetVars(style: WidgetStyle | undefined): Css {
  const css: Css = {};
  for (const [token, color] of Object.entries(style?.tokens ?? {}))
    css[tokenVar(token as ColorToken)] = cssColor(color!);
  const t = style?.textStyle;
  if (t?.font) css['--dk-label-font'] = fontStack(t.font);
  if (t?.size) css['--dk-label-size'] = `${t.size}px`;
  if (t?.color) {
    css['--dk-label-color'] = cssColor(t.color);
    css['--dk-value-color'] = cssColor(t.color);
  }
  if (t?.weight) css['--dk-label-weight'] = String(t.weight);
  if (t?.spacing !== undefined) css['--dk-label-spacing'] = `${t.spacing}em`;
  if (t?.case && t.case !== 'none')
    css['--dk-label-case'] = t.case === 'upper' ? 'uppercase' : 'lowercase';
  if (t?.italic) css['--dk-label-style'] = 'italic';
  if (t?.shadows?.length)
    css['--dk-label-shadow'] = t.shadows
      .map(s => `${s.x}px ${s.y}px ${s.blur}px ${cssColor(s.color)}`)
      .join(', ');
  if (t?.stroke && t.stroke.width > 0)
    css['--dk-label-stroke'] = `${t.stroke.width}px ${cssColor(t.stroke.color)}`;
  return css;
}
