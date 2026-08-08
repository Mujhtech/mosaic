import type { IntermediatePaint, IntermediateSolidPaint } from "./intermediate.js";

/**
 * `#/$defs/literalColor` is `^#[0-9A-F]{8}$`: eight digits, always uppercase,
 * alpha always present. Lowercase or a six-digit `#RRGGBB` is rejected.
 */
export type LiteralColor = string;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

function channel(value: number): string {
  return Math.round(clamp01(value) * 255)
    .toString(16)
    .toUpperCase()
    .padStart(2, "0");
}

/**
 * A Figma RGB triple plus a resolved alpha, as a protocol literal colour.
 *
 * Alpha is the product of paint opacity and node opacity: Figma composites the
 * two, and the protocol has one alpha channel to say it in.
 */
export function toLiteralColor(
  color: { readonly r: number; readonly g: number; readonly b: number },
  alpha = 1,
): LiteralColor {
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}${channel(alpha)}`;
}

/** The first visible solid paint, or null when the node has none. */
export function firstVisibleSolid(
  fills: readonly IntermediatePaint[],
): IntermediateSolidPaint | null {
  for (const fill of fills) {
    if (!fill.visible) continue;
    if (fill.type === "solid") return fill;
  }
  return null;
}

/** Whether the node carries a visible paint the protocol cannot express. */
export function hasVisibleUnsupportedPaint(
  fills: readonly IntermediatePaint[],
): boolean {
  return fills.some((fill) => fill.visible && fill.type === "unsupported");
}

/**
 * The literal colour for a node's fill, or null when it has no solid fill.
 *
 * A fully transparent result is still a colour: `#00000000` is what Figma
 * renders, and the protocol can carry it.
 */
export function solidFillColor(
  fills: readonly IntermediatePaint[],
  nodeOpacity: number,
): LiteralColor | null {
  const solid = firstVisibleSolid(fills);
  if (!solid) return null;
  return toLiteralColor(solid.color, clamp01(solid.opacity) * clamp01(nodeOpacity));
}
