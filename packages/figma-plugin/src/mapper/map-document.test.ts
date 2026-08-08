import { describe, expect, it } from "vitest";
import {
  parsePortablePaywallJson,
  validatePaywallDocument,
} from "../../../../protocol/browser/index.js";
import type {
  MosaicPaywallV03Stack,
  MosaicPaywallV03TextComponent,
} from "../../../../protocol/browser/index.js";
import { mapDocument, orderAbsoluteChildren } from "./map-document.js";
import {
  frame,
  imagePaint,
  representativePaywall,
  solid,
  text,
  unsupported,
} from "./test-support.js";

function expectValid(document: unknown): void {
  const result = validatePaywallDocument(document);
  if (!result.ok) {
    throw new Error(
      `Expected a valid document, got: ${result.diagnostics
        .map((entry) => `${entry.code} ${entry.message}`)
        .join(" | ")}`,
    );
  }
  expect(result.ok).toBe(true);
}

type DocumentLike = {
  screens: readonly { layout: { content: MosaicPaywallV03Stack } }[];
};

/** The screen's root content exactly as emitted, wrapper included. */
function screenContent(document: DocumentLike): MosaicPaywallV03Stack {
  const screen = document.screens[0];
  if (!screen) throw new Error("The document has no screen.");
  return screen.layout.content;
}

/**
 * The stack the selected frame itself became, seeing past the synthetic root
 * wrapper the protocol requires for a horizontal or empty top-level frame.
 */
function rootStack(document: DocumentLike): MosaicPaywallV03Stack {
  const content = screenContent(document);
  if (content.id !== "imported-root") return content;
  const inner = content.children[0];
  if (!inner || inner.type !== "stack") {
    throw new Error("The synthetic root wrapper holds no stack.");
  }
  return inner;
}

function childAt(stack: MosaicPaywallV03Stack, index: number) {
  const child = stack.children[index];
  if (!child) throw new Error(`No child at index ${index}.`);
  return child;
}

describe("document shell", () => {
  it("produces a valid single-screen document from a representative frame", () => {
    const { document } = mapDocument(representativePaywall());
    expectValid(document);
    expect(document.schemaVersion).toBe("0.3");
    expect(document.revision).toBe(1);
    expect(document.id).toBe("paywall-annual");
    expect(document.initialScreenId).toBe("imported");
    expect(document.screens).toHaveLength(1);
    expect(document.screens[0]?.layout.type).toBe("scrollContainer");
    expect(document.screens[0]?.layout.axis).toBe("vertical");
    expect(document.screens[0]?.layout.safeArea).toBe("respect");
    expect(document.assets).toEqual([]);
    expect(document.products).toEqual([]);
    expect(document.designSystem).toEqual({
      colors: [],
      backgrounds: [],
      shadows: [],
    });
  });

  it("survives the exact path Studio imports through", () => {
    const { document } = mapDocument(representativePaywall());
    const parsed = parsePortablePaywallJson(
      `${JSON.stringify(document, null, 2)}\n`,
    );
    expect(parsed.ok).toBe(true);
  });

  it("falls back to a usable document id when the frame name has no letters", () => {
    const { document } = mapDocument(
      frame({ name: "🎉", children: [text({ name: "T", characters: "Hi" })] }),
    );
    expect(document.id).toBe("imported-paywall");
    expectValid(document);
  });

  it("stays valid for a frame with no mappable children at all", () => {
    const { document, report } = mapDocument(
      frame({
        name: "Empty",
        children: [unsupported({ name: "Art", reason: "vector" })],
      }),
    );
    // The catalog still has the screen label, which `localeCatalog` requires,
    // and the empty frame is wrapped so the root stack has a child.
    expectValid(document);
    const wrapper = screenContent(document);
    expect(wrapper.id).toBe("imported-root");
    expect(childAt(wrapper, 0)).toMatchObject({ id: "empty", children: [] });
    expect(report.skipped).toHaveLength(1);
    expect(report.warnings.map((warning) => warning.code)).toContain(
      "layout.rootWrapped",
    );
  });

  it("wraps a horizontal top-level frame rather than rewriting its direction", () => {
    const { document, report } = mapDocument(
      frame({
        name: "Row root",
        layoutMode: "horizontal",
        itemSpacing: 8,
        children: [text({ name: "Label", characters: "Hello" })],
      }),
    );
    const wrapper = screenContent(document);
    expect(wrapper.direction).toBe("vertical");
    expect(childAt(wrapper, 0)).toMatchObject({
      type: "stack",
      direction: "horizontal",
      gap: 8,
    });
    expect(report.warnings.map((warning) => warning.code)).toContain(
      "layout.rootWrapped",
    );
    expectValid(document);
  });
});

describe("auto-layout mapping", () => {
  it("maps direction, spacing, padding, and both alignments", () => {
    const { document } = mapDocument(
      frame({
        name: "Row",
        layoutMode: "horizontal",
        itemSpacing: 12,
        primaryAxisAlignItems: "center",
        counterAxisAlignItems: "max",
        paddingTop: 4,
        paddingRight: 8,
        paddingBottom: 16,
        paddingLeft: 32,
        children: [text({ name: "Label", characters: "Hello" })],
      }),
    );
    const stack = rootStack(document);
    expect(stack.direction).toBe("horizontal");
    expect(stack.gap).toBe(12);
    // Figma pads left/right; the protocol pads start/end.
    expect(stack.padding).toEqual({ top: 4, start: 32, bottom: 16, end: 8 });
    expect(stack.mainAxisDistribution).toBe("center");
    expect(stack.crossAxisAlignment).toBe("end");
    expectValid(document);
  });

  it("turns Figma auto spacing into spaceBetween with a zero gap", () => {
    const { document } = mapDocument(
      frame({
        name: "Row",
        layoutMode: "horizontal",
        // Figma still reports the last manual spacing here; it is not rendered.
        itemSpacing: 40,
        primaryAxisAlignItems: "spaceBetween",
        children: [
          text({ name: "Left", characters: "Left" }),
          text({ name: "Right", characters: "Right" }),
        ],
      }),
    );
    const stack = rootStack(document);
    expect(stack.mainAxisDistribution).toBe("spaceBetween");
    expect(stack.gap).toBe(0);
    expectValid(document);
  });

  it("maps baseline alignment to center and says so", () => {
    const { document, report } = mapDocument(
      frame({
        name: "Row",
        layoutMode: "horizontal",
        counterAxisAlignItems: "baseline",
        children: [text({ name: "Label", characters: "Hello" })],
      }),
    );
    expect(rootStack(document).crossAxisAlignment).toBe("center");
    expect(report.warnings.map((warning) => warning.code)).toContain(
      "layout.baselineAlignment",
    );
  });

  it("clamps spacing and padding to the schema bounds", () => {
    const { document } = mapDocument(
      frame({
        name: "Row",
        itemSpacing: 99_999,
        paddingTop: -20,
        paddingLeft: 99_999,
        children: [text({ name: "Label", characters: "Hello" })],
      }),
    );
    const stack = rootStack(document);
    expect(stack.gap).toBe(4096);
    expect(stack.padding.top).toBe(0);
    expect(stack.padding.start).toBe(4096);
    expectValid(document);
  });

  it("carries a solid background and a corner radius into the appearance", () => {
    const { document } = mapDocument(
      frame({
        name: "Card",
        cornerRadius: 16,
        fills: [solid("#101014", 0.5)],
        opacity: 0.5,
        children: [text({ name: "Label", characters: "Hello" })],
      }),
    );
    expect(rootStack(document).appearance).toEqual({
      background: { type: "color", value: "#10101440" },
      cornerRadius: 16,
    });
    expectValid(document);
  });

  it("omits the appearance entirely when there is nothing to say", () => {
    const { document } = mapDocument(
      frame({
        name: "Plain",
        children: [text({ name: "Label", characters: "Hello" })],
      }),
    );
    // `containerAppearance` has minProperties 1, so an empty object is invalid.
    expect(rootStack(document).appearance).toBeUndefined();
    expectValid(document);
  });

  it("keeps a container that has children but an image fill, and reports the fill", () => {
    const { document, report } = mapDocument(
      frame({
        name: "Hero",
        fills: [imagePaint()],
        children: [text({ name: "Label", characters: "Hello" })],
      }),
    );
    expect(rootStack(document).children).toHaveLength(1);
    expect(rootStack(document).appearance).toBeUndefined();
    expect(report.warnings.map((warning) => warning.code)).toContain(
      "style.unsupportedFill",
    );
    expectValid(document);
  });
});

describe("absolute layout flattening", () => {
  it("orders children top-to-bottom, then left-to-right", () => {
    const ordered = orderAbsoluteChildren([
      text({ name: "c", characters: "c", x: 0, y: 20 }),
      text({ name: "b", characters: "b", x: 40, y: 0 }),
      text({ name: "a", characters: "a", x: 10, y: 0 }),
    ]);
    expect(ordered.map((node) => node.name)).toEqual(["a", "b", "c"]);
  });

  it("flattens a non-auto-layout frame into a vertical stack and warns", () => {
    const { document, report } = mapDocument(
      frame({
        name: "Absolute",
        layoutMode: "none",
        itemSpacing: 24,
        paddingLeft: 40,
        children: [
          text({ name: "Lower", characters: "Second", y: 100 }),
          text({ name: "Upper", characters: "First", y: 10 }),
        ],
      }),
    );
    const stack = rootStack(document);
    expect(stack.direction).toBe("vertical");
    // Nothing about an absolute frame's spacing or padding is meaningful.
    expect(stack.gap).toBe(0);
    expect(stack.padding).toEqual({ top: 0, start: 0, bottom: 0, end: 0 });
    expect(stack.mainAxisDistribution).toBe("start");
    expect(stack.crossAxisAlignment).toBe("stretch");
    expect(
      stack.children.map(
        (child) => (child as MosaicPaywallV03TextComponent).value.default,
      ),
    ).toEqual(["First", "Second"]);
    const warning = report.warnings.find(
      (entry) => entry.code === "layout.absoluteFlattened",
    );
    expect(warning?.message).toContain("Absolute layout flattened");
    expectValid(document);
  });
});

describe("text mapping", () => {
  it("maps characters, typography, and colour", () => {
    const { document } = mapDocument(
      frame({
        name: "Root",
        children: [
          text({
            name: "Hero Title",
            characters: "Unlock everything",
            fontSize: 34,
            fontWeight: 700,
            textAlign: "center",
            lineHeight: { unit: "pixels", value: 44 },
            fills: [solid("#101014")],
          }),
        ],
      }),
    );
    const node = childAt(rootStack(document), 0) as MosaicPaywallV03TextComponent;
    expect(node).toMatchObject({
      type: "text",
      id: "hero-title",
      value: { default: "Unlock everything", localizationKey: "figma.hero_title" },
      typography: {
        style: "display",
        fontSize: 34,
        lineHeightMultiplier: 1.29,
        weight: "bold",
        color: "#101014FF",
        alignment: "center",
      },
      accessibility: { role: "text" },
    });
    expectValid(document);
  });

  it("uses the semantic text colour when the layer has no solid fill", () => {
    const { document } = mapDocument(
      frame({
        name: "Root",
        children: [text({ name: "Label", characters: "Hello", fills: [] })],
      }),
    );
    const node = childAt(rootStack(document), 0) as MosaicPaywallV03TextComponent;
    expect(node.typography.color).toBe("text.primary");
    expectValid(document);
  });

  it("skips an empty text layer rather than emitting an empty default", () => {
    const { document, report } = mapDocument(
      frame({
        name: "Root",
        children: [
          text({ name: "Blank", characters: "   " }),
          text({ name: "Real", characters: "Hello" }),
        ],
      }),
    );
    expect(rootStack(document).children).toHaveLength(1);
    expect(report.skipped.map((entry) => entry.reason)).toContain("emptyText");
    expectValid(document);
  });

  it("reports a mixed font size and falls back", () => {
    const { document, report } = mapDocument(
      frame({
        name: "Root",
        children: [text({ name: "Mixed", characters: "Hi", fontSize: null })],
      }),
    );
    const node = childAt(rootStack(document), 0) as MosaicPaywallV03TextComponent;
    expect(node.typography.fontSize).toBe(16);
    expect(report.warnings.map((warning) => warning.code)).toContain(
      "text.mixedFontSize",
    );
    expectValid(document);
  });
});

describe("skipped layers", () => {
  it("reports images and vectors instead of inventing assets", () => {
    const { document, report } = mapDocument(
      frame({
        name: "Root",
        children: [
          unsupported({ name: "Photo", figmaType: "RECTANGLE", reason: "image" }),
          unsupported({ name: "Squiggle", figmaType: "VECTOR", reason: "vector" }),
          text({ name: "Label", characters: "Hello" }),
        ],
      }),
    );
    expect(document.assets).toEqual([]);
    expect(rootStack(document).children).toHaveLength(1);
    expect(report.skipped).toHaveLength(2);
    for (const entry of report.skipped) {
      expect(entry.message).toContain("skipped: image/vector");
      expect(entry.layerPath.startsWith("Root/")).toBe(true);
    }
    expectValid(document);
  });

  it("skips hidden layers", () => {
    const { document, report } = mapDocument(
      frame({
        name: "Root",
        children: [
          text({ name: "Hidden", characters: "Nope", visible: false }),
          frame({ name: "Hidden Group", visible: false }),
          text({ name: "Shown", characters: "Yes" }),
        ],
      }),
    );
    expect(rootStack(document).children).toHaveLength(1);
    expect(report.skipped.filter((entry) => entry.reason === "hidden")).toHaveLength(
      2,
    );
    expectValid(document);
  });
});

describe("identifiers and the localization catalog", () => {
  it("de-duplicates ids and keys derived from repeated layer names", () => {
    const { document } = mapDocument(
      frame({
        name: "Root",
        children: [
          text({ name: "Feature", characters: "One" }),
          text({ name: "Feature", characters: "Two" }),
          text({ name: "Feature", characters: "Three" }),
        ],
      }),
    );
    const stack = rootStack(document);
    expect(stack.children.map((child) => child.id)).toEqual([
      "feature",
      "feature-2",
      "feature-3",
    ]);
    expect(
      stack.children.map(
        (child) => (child as MosaicPaywallV03TextComponent).value.localizationKey,
      ),
    ).toEqual(["figma.feature", "figma.feature_2", "figma.feature_3"]);
    expectValid(document);
  });

  it("puts every user-visible string in the default catalog and nothing else", () => {
    const { document } = mapDocument(representativePaywall());
    const strings = document.localization.locales.en?.strings ?? {};
    expect(document.localization.defaultLocale).toBe("en");
    expect(document.localization.fallbackLocale).toBe("en");
    expect(document.localization.locales.en?.direction).toBe("ltr");
    expect(Object.values(strings)).toEqual(
      expect.arrayContaining([
        "Paywall / Annual",
        "Unlock everything",
        "Every feature, on every device.",
        "Offline mode",
        "INCLUDED",
      ]),
    );
    // The validator rejects both a missing key and an unused one, so the
    // catalog is exactly the referenced set.
    expectValid(document);
  });

  it("labels the screen even when the frame contains no text", () => {
    const { document } = mapDocument(frame({ name: "Bare" }));
    expect(document.screens[0]?.accessibilityLabel).toEqual({
      default: "Bare",
      localizationKey: "figma.screen",
    });
    expectValid(document);
  });

  it("keeps the screen label key when a layer is also called Screen", () => {
    const { document } = mapDocument(
      frame({
        name: "Root",
        children: [text({ name: "Screen", characters: "Screen title" })],
      }),
    );
    expect(document.screens[0]?.accessibilityLabel?.localizationKey).toBe(
      "figma.screen",
    );
    const node = childAt(rootStack(document), 0) as MosaicPaywallV03TextComponent;
    expect(node.value.localizationKey).toBe("figma.screen_2");
    expectValid(document);
  });
});

describe("the export report", () => {
  it("counts what was emitted and lists what was not", () => {
    const { report } = mapDocument(representativePaywall());
    expect(report.documentId).toBe("paywall-annual");
    expect(report.rootLayerName).toBe("Paywall / Annual");
    expect(report.stackCount).toBe(3);
    expect(report.textCount).toBe(6);
    // The scroll container counts: the renderer walks it like any other node.
    expect(report.mappedNodeCount).toBe(1 + report.stackCount + report.textCount);
    // The screen label is a string too.
    expect(report.localizedStringCount).toBe(report.textCount + 1);
    expect(report.skipped.map((entry) => entry.reason)).toEqual(["image"]);
    expect(report.warnings.map((warning) => warning.code).sort()).toEqual([
      "layout.absoluteFlattened",
    ]);
  });
});
