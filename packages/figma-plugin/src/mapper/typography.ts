import type {
  IntermediateLineHeight,
  IntermediateTextAlign,
} from "./intermediate.js";

export type FontWeight = "regular" | "medium" | "semibold" | "bold";
export type TypographyStyle =
  | "display"
  | "title"
  | "heading"
  | "body"
  | "label"
  | "caption";
export type TextAlignment = "start" | "center" | "end";

/** `#/$defs/typography.fontSize` bounds. */
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 96;

/** `#/$defs/typography.lineHeightMultiplier` bounds. */
export const MIN_LINE_HEIGHT = 0.8;
export const MAX_LINE_HEIGHT = 3;

/** What a text layer gets when Figma reports a mixed or missing size. */
export const DEFAULT_FONT_SIZE = 16;

/** What a text layer gets for Figma's AUTO line height. */
export const DEFAULT_LINE_HEIGHT = 1.2;

/**
 * Figma has a continuous numeric weight axis; the protocol has four names.
 * Snapping is to the nearest of 400/500/600/700, ties resolving to the lighter
 * name so a 450 does not silently read as medium-heavy.
 */
const WEIGHT_STOPS: readonly (readonly [number, FontWeight])[] = [
  [400, "regular"],
  [500, "medium"],
  [600, "semibold"],
  [700, "bold"],
];

/**
 * Style-name fallback for files where Figma reports no numeric weight (mixed
 * ranges, or older documents). Ordered longest-match-first: "semibold" must be
 * tested before "bold", and "extrabold" before both.
 */
const WEIGHT_BY_STYLE_NAME: readonly (readonly [string, number])[] = [
  ["thin", 100],
  ["extralight", 200],
  ["ultralight", 200],
  ["light", 300],
  ["regular", 400],
  ["normal", 400],
  ["book", 400],
  ["medium", 500],
  ["demibold", 600],
  ["semibold", 600],
  ["extrabold", 800],
  ["ultrabold", 800],
  ["black", 900],
  ["heavy", 900],
  ["bold", 700],
];

export function numericWeightFromStyleName(styleName: string | null): number | null {
  if (!styleName) return null;
  const normalized = styleName.toLowerCase().replace(/[^a-z]/g, "");
  for (const [needle, weight] of WEIGHT_BY_STYLE_NAME) {
    if (normalized.includes(needle)) return weight;
  }
  return null;
}

export function snapFontWeight(
  numericWeight: number | null,
  styleName: string | null = null,
): FontWeight {
  const weight = numericWeight ?? numericWeightFromStyleName(styleName);
  if (weight === null || !Number.isFinite(weight)) return "regular";
  let best: FontWeight = "regular";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [stop, name] of WEIGHT_STOPS) {
    const distance = Math.abs(weight - stop);
    // Strictly-less keeps ties on the lighter stop, since stops ascend.
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }
  return best;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function clampFontSize(fontSize: number | null): number {
  const size =
    fontSize === null || !Number.isFinite(fontSize) ? DEFAULT_FONT_SIZE : fontSize;
  return round(Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size)), 2);
}

/**
 * Figma expresses line height three ways; the protocol has one multiplier.
 * Pixels are divided by the *resolved* font size, so the multiplier matches
 * what the clamped size will actually render.
 */
export function toLineHeightMultiplier(
  lineHeight: IntermediateLineHeight,
  resolvedFontSize: number,
): number {
  let multiplier = DEFAULT_LINE_HEIGHT;
  if (lineHeight.unit === "percent" && Number.isFinite(lineHeight.value)) {
    multiplier = lineHeight.value / 100;
  } else if (
    lineHeight.unit === "pixels" &&
    Number.isFinite(lineHeight.value) &&
    resolvedFontSize > 0
  ) {
    multiplier = lineHeight.value / resolvedFontSize;
  }
  return round(
    Math.min(MAX_LINE_HEIGHT, Math.max(MIN_LINE_HEIGHT, multiplier)),
    2,
  );
}

/**
 * Whether a string reads as an all-caps label rather than prose.
 *
 * Requires at least one cased letter (so "2024" and "•••" are not labels) and
 * a short run (so a shouted paragraph stays body text).
 */
export function isAllCaps(characters: string): boolean {
  const trimmed = characters.trim();
  if (trimmed.length === 0 || trimmed.length > 40) return false;
  if (!/\p{L}/u.test(trimmed)) return false;
  return trimmed === trimmed.toUpperCase() && trimmed !== trimmed.toLowerCase();
}

/**
 * The typography-style heuristic.
 *
 * Figma has no notion of a semantic text role, so the style is inferred from
 * size first and shape second. The order is deliberate and documented in the
 * README:
 *
 *   >= 32          display
 *   >= 24          title
 *   >= 18          heading
 *   all-caps       label   (checked before caption, so small all-caps is a label)
 *   <= 12          caption
 *   otherwise      body
 *
 * The result is a guess. It is meant to be corrected in Studio, not trusted.
 */
export function pickTypographyStyle(
  resolvedFontSize: number,
  characters: string,
): TypographyStyle {
  if (resolvedFontSize >= 32) return "display";
  if (resolvedFontSize >= 24) return "title";
  if (resolvedFontSize >= 18) return "heading";
  if (isAllCaps(characters)) return "label";
  if (resolvedFontSize <= 12) return "caption";
  return "body";
}

/** Figma's JUSTIFIED has no protocol equivalent; it degrades to `start`. */
export function toTextAlignment(align: IntermediateTextAlign): TextAlignment {
  switch (align) {
    case "center":
      return "center";
    case "right":
      return "end";
    default:
      return "start";
  }
}
