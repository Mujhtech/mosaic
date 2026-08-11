/**
 * Builders for intermediate trees.
 *
 * The tree is exactly what `src/main.ts` produces, so a test written against
 * these builders is a test of the real contract, not of a convenience shape.
 */

import type {
  IntermediateFrame,
  IntermediateNode,
  IntermediatePaint,
  IntermediateText,
  IntermediateUnsupported,
} from "./intermediate.js";

export function solid(
  hex: `#${string}`,
  opacity = 1,
  visible = true,
): IntermediatePaint {
  const value = hex.slice(1);
  const channel = (index: number) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16) / 255;
  return {
    type: "solid",
    visible,
    color: { r: channel(0), g: channel(1), b: channel(2) },
    opacity,
  };
}

export function imagePaint(visible = true): IntermediatePaint {
  return { type: "unsupported", visible, paintType: "IMAGE" };
}

export function frame(
  overrides: Partial<IntermediateFrame> & { name: string },
): IntermediateFrame {
  return {
    figmaId: `frame:${overrides.name}`,
    visible: true,
    opacity: 1,
    x: 0,
    y: 0,
    kind: "frame",
    figmaType: "FRAME",
    layoutMode: "vertical",
    itemSpacing: 0,
    primaryAxisAlignItems: "min",
    counterAxisAlignItems: "min",
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    cornerRadius: 0,
    fills: [],
    children: [],
    ...overrides,
  };
}

export function text(
  overrides: Partial<IntermediateText> & { name: string; characters: string },
): IntermediateText {
  return {
    figmaId: `text:${overrides.name}`,
    visible: true,
    opacity: 1,
    x: 0,
    y: 0,
    kind: "text",
    fontSize: 16,
    fontWeight: 400,
    fontStyleName: "Regular",
    lineHeight: { unit: "auto" },
    textAlign: "left",
    fills: [],
    ...overrides,
  };
}

export function unsupported(
  overrides: Partial<IntermediateUnsupported> & { name: string },
): IntermediateUnsupported {
  return {
    figmaId: `other:${overrides.name}`,
    visible: true,
    opacity: 1,
    x: 0,
    y: 0,
    kind: "unsupported",
    figmaType: "RECTANGLE",
    reason: "vector",
    ...overrides,
  };
}

/** A frame with a hero, a feature row, and layers that cannot cross. */
export function representativePaywall(): IntermediateFrame {
  const children: IntermediateNode[] = [
    text({
      name: "Hero Title",
      characters: "Unlock everything",
      fontSize: 34,
      fontWeight: 700,
      fontStyleName: "Bold",
      textAlign: "center",
      fills: [solid("#101014")],
      lineHeight: { unit: "percent", value: 120 },
    }),
    text({
      name: "Subtitle",
      characters: "Every feature, on every device.",
      fontSize: 15,
      fontWeight: 400,
      textAlign: "center",
      fills: [solid("#5A5A66")],
    }),
    unsupported({ name: "Hero Illustration", figmaType: "RECTANGLE", reason: "image" }),
    frame({
      name: "Feature Row",
      layoutMode: "horizontal",
      itemSpacing: 12,
      primaryAxisAlignItems: "spaceBetween",
      counterAxisAlignItems: "center",
      paddingTop: 8,
      paddingRight: 16,
      paddingBottom: 8,
      paddingLeft: 16,
      cornerRadius: 12,
      fills: [solid("#F5F5F7")],
      children: [
        text({ name: "Feature", characters: "Offline mode", fontSize: 13 }),
        text({
          name: "Feature",
          characters: "INCLUDED",
          fontSize: 11,
          fontWeight: 600,
          fontStyleName: "SemiBold",
        }),
      ],
    }),
    frame({
      name: "Absolute Group",
      layoutMode: "none",
      children: [
        text({ name: "Lower", characters: "Second", y: 40 }),
        text({ name: "Upper", characters: "First", y: 10 }),
      ],
    }),
  ];

  return frame({
    name: "Paywall / Annual",
    layoutMode: "vertical",
    itemSpacing: 16,
    counterAxisAlignItems: "center",
    paddingTop: 24,
    paddingRight: 20,
    paddingBottom: 24,
    paddingLeft: 20,
    fills: [solid("#FFFFFF")],
    children,
  });
}
