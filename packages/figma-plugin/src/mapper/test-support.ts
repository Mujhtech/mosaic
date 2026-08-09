/**
 * Builders for intermediate trees.
 *
 * The tree is exactly what `src/main.ts` produces, so a test written against
 * these builders is a test of the real contract, not of a convenience shape.
 */

import type {
  IntermediateBounds,
  IntermediateFrame,
  IntermediateNode,
  IntermediatePaint,
  IntermediateShape,
  IntermediateText,
  IntermediateUnsupported,
} from "./intermediate.js";

/** Shorthand for an absolute bounding box, in the order a designer reads one. */
export function box(
  x: number,
  y: number,
  width: number,
  height: number,
): IntermediateBounds {
  return { x, y, width, height };
}

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
    bounds: null,
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
    bounds: null,
    kind: "text",
    fontSize: 16,
    fontWeight: 400,
    fontStyleName: "Regular",
    lineHeight: { unit: "auto" },
    textAlign: "left",
    fills: [],
    mixedStyling: false,
    ...overrides,
  };
}

export function shape(
  overrides: Partial<IntermediateShape> & { name: string },
): IntermediateShape {
  return {
    figmaId: `shape:${overrides.name}`,
    visible: true,
    opacity: 1,
    x: 0,
    y: 0,
    bounds: null,
    kind: "shape",
    figmaType: "RECTANGLE",
    cornerRadius: 0,
    fills: [solid("#101014")],
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
    bounds: null,
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

/** One plan card: a rounded box with a name and a price. */
function planCard(name: string, price: string, x: number): IntermediateFrame {
  return frame({
    name,
    bounds: box(x, 180, 110, 120),
    layoutMode: "vertical",
    itemSpacing: 4,
    paddingTop: 12,
    paddingBottom: 12,
    paddingLeft: 12,
    paddingRight: 12,
    cornerRadius: 12,
    fills: [solid("#F5F5F7")],
    children: [
      text({ name: `${name} Label`, characters: name, fontSize: 13 }),
      text({ name: `${name} Price`, characters: price, fontSize: 20 }),
    ],
  });
}

/**
 * The shape that motivated the layout inference: an iPhone-sized frame with no
 * auto-layout anywhere, three plan cards side by side, and a painted CTA.
 * Every layer carries a bounding box, because that is all the geometry there is.
 */
export function positionedPaywall(): IntermediateFrame {
  return frame({
    name: "Plans",
    bounds: box(0, 0, 390, 844),
    layoutMode: "none",
    fills: [solid("#FFFFFF")],
    children: [
      text({
        name: "Title",
        characters: "Choose a plan",
        fontSize: 28,
        bounds: box(24, 60, 342, 40),
      }),
      text({
        name: "Subtitle",
        characters: "Cancel any time.",
        fontSize: 14,
        bounds: box(24, 108, 342, 20),
      }),
      planCard("Monthly", "$9.99", 24),
      planCard("Yearly", "$59.99", 142),
      planCard("Lifetime", "$149.00", 260),
      frame({
        name: "CTA Button",
        bounds: box(24, 340, 342, 56),
        layoutMode: "horizontal",
        paddingTop: 16,
        paddingBottom: 16,
        paddingLeft: 24,
        paddingRight: 24,
        cornerRadius: 28,
        fills: [solid("#0D99FF")],
        children: [
          text({
            name: "CTA Label",
            characters: "Continue",
            fontSize: 17,
            fontWeight: 600,
            fontStyleName: "SemiBold",
            fills: [solid("#FFFFFF")],
          }),
        ],
      }),
    ],
  });
}
