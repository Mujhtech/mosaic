import { describe, expect, it } from "vitest";
import {
  parsePortablePaywallJson,
  validatePaywallDocument,
} from "../../../../protocol/browser/index.js";
import type {
  MosaicPaywallV04Stack,
  MosaicPaywallV04TextComponent,
} from "../../../../protocol/browser/index.js";
import type {
  MosaicPaywallV04ButtonComponent,
  MosaicPaywallV04Document,
} from "../../../../protocol/browser/index.js";
import { mapDocument, orderAbsoluteChildren } from "./map-document.js";
import {
  box,
  frame,
  imagePaint,
  positionedPaywall,
  representativePaywall,
  shape,
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
  screens: readonly { layout: { content: MosaicPaywallV04Stack } }[];
};

/** The screen's root content exactly as emitted, wrapper included. */
function screenContent(document: DocumentLike): MosaicPaywallV04Stack {
  const screen = document.screens[0];
  if (!screen) throw new Error("The document has no screen.");
  return screen.layout.content;
}

/**
 * The stack the selected frame itself became, seeing past the synthetic root
 * wrapper the protocol requires for a horizontal or empty top-level frame.
 */
function rootStack(document: DocumentLike): MosaicPaywallV04Stack {
  const content = screenContent(document);
  if (content.id !== "imported-root") return content;
  const inner = content.children[0];
  if (!inner || inner.type !== "stack") {
    throw new Error("The synthetic root wrapper holds no stack.");
  }
  return inner;
}

function childAt(stack: MosaicPaywallV04Stack, index: number) {
  const child = stack.children[index];
  if (!child) throw new Error(`No child at index ${index}.`);
  return child;
}

describe("document shell", () => {
  it("produces a valid single-screen document from a representative frame", () => {
    const { document } = mapDocument(representativePaywall());
    expectValid(document);
    expect(document.schemaVersion).toBe("0.4");
    expect(document.revision).toBe(1);
    expect(document.id).toBe("paywall-annual");
    expect(document.initialScreenId).toBe("imported");
    expect(document.screens).toHaveLength(1);
    expect(document.screens[0]?.layout.type).toBe("scrollContainer");
    expect(document.screens[0]?.layout.axis).toBe("vertical");
    expect(document.screens[0]?.layout.safeArea).toBe("respect");
    expect(document.assets).toEqual([]);
    expect(document.products).toEqual([]);
    // No motion is authored: a Figma frame is a static composition, and an
    // absent entrance is "no entrance" rather than a default one.
    expect(document.designSystem).toEqual({
      colors: [],
      backgrounds: [],
      shadows: [],
      motions: [],
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
        // Two children, so the painted-and-rounded shape is a card rather than
        // the single-label shape the button heuristic claims.
        children: [
          text({ name: "Label", characters: "Hello" }),
          text({ name: "Detail", characters: "World" }),
        ],
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
        (child) => (child as MosaicPaywallV04TextComponent).value.default,
      ),
    ).toEqual(["First", "Second"]);
    const warning = report.warnings.find(
      (entry) => entry.code === "layout.absoluteFlattened",
    );
    // The warning has to say what to do about it, not just what happened.
    expect(warning?.message).toContain("no auto-layout");
    expect(warning?.message).toContain("Shift+A");
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
    const node = childAt(rootStack(document), 0) as MosaicPaywallV04TextComponent;
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
    const node = childAt(rootStack(document), 0) as MosaicPaywallV04TextComponent;
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
    const node = childAt(rootStack(document), 0) as MosaicPaywallV04TextComponent;
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
      expect(entry.message).toContain("Studio bundle");
      expect(entry.layerPath.startsWith("Root/")).toBe(true);
      expect(entry.figmaId.length).toBeGreaterThan(0);
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
        (child) => (child as MosaicPaywallV04TextComponent).value.localizationKey,
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
    const node = childAt(rootStack(document), 0) as MosaicPaywallV04TextComponent;
    expect(node.value.localizationKey).toBe("figma.screen_2");
    expectValid(document);
  });
});

describe("the export report", () => {
  it("counts what was emitted and lists what was not", () => {
    const { report } = mapDocument(representativePaywall());
    expect(report.documentId).toBe("paywall-annual");
    expect(report.rootLayerNames).toEqual(["Paywall / Annual"]);
    expect(report.screenCount).toBe(1);
    expect(report.stackCount).toBe(3);
    expect(report.textCount).toBe(6);
    expect(report.buttonCount).toBe(0);
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

describe("inferred layout for a frame without auto-layout", () => {
  it("reconstructs rows, gaps, padding, and alignment from the geometry", () => {
    const { document, report } = mapDocument(positionedPaywall());
    const stack = rootStack(document);

    // The gap is the median of the three inter-row spacings (8, 52, 40), so
    // one unusually tight pair does not set the whole screen's rhythm.
    expect(stack.gap).toBe(40);
    // Padding is the smallest offset each edge sees, in Figma's own pixels.
    expect(stack.padding).toEqual({ top: 60, start: 24, bottom: 448, end: 20 });
    expect(stack.crossAxisAlignment).toBe("stretch");
    expect(stack.mainAxisDistribution).toBe("start");

    // Title, subtitle, the three cards as one row, and the button.
    expect(stack.children.map((child) => child.id)).toEqual([
      "title",
      "subtitle",
      "plans-row",
      "cta-button",
    ]);
    expectValid(document);
    expect(report.warnings.map((warning) => warning.code)).toContain(
      "layout.absoluteFlattened",
    );
  });

  it("gathers overlapping siblings into a horizontal row with its own gap", () => {
    const { document } = mapDocument(positionedPaywall());
    const row = childAt(rootStack(document), 2) as MosaicPaywallV04Stack;
    expect(row.type).toBe("stack");
    expect(row.direction).toBe("horizontal");
    // 142 - 134 and 260 - 252: an eight-pixel gutter, twice.
    expect(row.gap).toBe(8);
    expect(row.padding).toEqual({ top: 0, start: 0, bottom: 0, end: 0 });
    expect(row.children.map((child) => child.id)).toEqual([
      "monthly",
      "yearly",
      "lifetime",
    ]);
  });

  it("leaves a single-child row as a direct child rather than wrapping it", () => {
    const { document } = mapDocument(
      frame({
        name: "Column",
        bounds: box(0, 0, 200, 300),
        layoutMode: "none",
        children: [
          text({ name: "One", characters: "One", bounds: box(20, 20, 160, 20) }),
          text({ name: "Two", characters: "Two", bounds: box(20, 60, 160, 20) }),
        ],
      }),
    );
    const stack = rootStack(document);
    expect(stack.children.map((child) => child.type)).toEqual(["text", "text"]);
    expect(stack.gap).toBe(20);
  });

  it("centres a row that is narrower than the content box", () => {
    const { document } = mapDocument(
      frame({
        name: "Column",
        bounds: box(0, 0, 300, 300),
        layoutMode: "none",
        children: [
          // A full-width header sets the padding; the pair below is centred
          // inside it, which one padding value alone could not express.
          text({ name: "Header", characters: "H", bounds: box(20, 20, 260, 20) }),
          text({ name: "A", characters: "A", bounds: box(100, 60, 40, 20) }),
          text({ name: "B", characters: "B", bounds: box(160, 60, 40, 20) }),
        ],
      }),
    );
    const row = childAt(rootStack(document), 1) as MosaicPaywallV04Stack;
    expect(row.direction).toBe("horizontal");
    expect(row.mainAxisDistribution).toBe("center");
    expect(row.gap).toBe(20);
  });

  it("measures spacing from the rows that survived, not the ones that were skipped", () => {
    const { document } = mapDocument(
      frame({
        name: "Column",
        bounds: box(0, 0, 200, 400),
        layoutMode: "none",
        children: [
          text({ name: "One", characters: "One", bounds: box(20, 20, 160, 20) }),
          // A vector between them is not emitted, so the surviving gap is
          // 120 - 40, not the 30 either side of the vector.
          unsupported({
            name: "Rule",
            reason: "vector",
            bounds: box(20, 70, 160, 20),
          }),
          text({ name: "Two", characters: "Two", bounds: box(20, 120, 160, 20) }),
        ],
      }),
    );
    expect(rootStack(document).gap).toBe(80);
  });

  it("falls back to reading order, and says so, when there are no bounding boxes", () => {
    const { document, report } = mapDocument(
      frame({
        name: "Unmeasured",
        layoutMode: "none",
        children: [
          text({ name: "Lower", characters: "Second", y: 100 }),
          text({ name: "Upper", characters: "First", y: 10 }),
        ],
      }),
    );
    const stack = rootStack(document);
    expect(stack.gap).toBe(0);
    expect(stack.padding).toEqual({ top: 0, start: 0, bottom: 0, end: 0 });
    expect(
      stack.children.map(
        (child) => (child as MosaicPaywallV04TextComponent).value.default,
      ),
    ).toEqual(["First", "Second"]);
    const warning = report.warnings.find(
      (entry) => entry.code === "layout.absoluteFlattened",
    );
    expect(warning?.message).toContain("no bounding box");
    expectValid(document);
  });

  it("clamps an inferred gap and padding to the schema bounds", () => {
    const { document } = mapDocument(
      frame({
        name: "Huge",
        bounds: box(0, 0, 20_000, 20_000),
        layoutMode: "none",
        children: [
          text({ name: "A", characters: "A", bounds: box(9000, 9000, 10, 10) }),
          text({ name: "B", characters: "B", bounds: box(9000, 19_000, 10, 10) }),
        ],
      }),
    );
    const stack = rootStack(document);
    expect(stack.gap).toBeLessThanOrEqual(4096);
    expect(stack.padding.bottom).toBeLessThanOrEqual(4096);
    expectValid(document);
  });
});

describe("button detection", () => {
  const buttonFrame = () =>
    frame({
      name: "Frame 9",
      layoutMode: "horizontal",
      paddingTop: 16,
      paddingBottom: 16,
      paddingLeft: 24,
      paddingRight: 24,
      cornerRadius: 28,
      fills: [solid("#0D99FF")],
      children: [
        text({
          name: "Label",
          characters: "Continue",
          fills: [solid("#FFFFFF")],
        }),
      ],
    });

  it("emits a button with the minimal schema-valid placeholder action", () => {
    const { document } = mapDocument(
      frame({ name: "Root", children: [buttonFrame()] }),
    );
    const button = childAt(rootStack(document), 0) as MosaicPaywallV04ButtonComponent;
    expect(button.type).toBe("button");
    // `close` is the only member of `#/$defs/buttonAction` with no field the
    // plugin would have to invent.
    expect(button.action).toEqual({ type: "close" });
    expect(button.children).toHaveLength(1);
    expect(button.direction).toBe("horizontal");
    expectValid(document);
  });

  it("reuses the label as the control's accessible name rather than a second string", () => {
    const { document } = mapDocument(
      frame({ name: "Root", children: [buttonFrame()] }),
    );
    const button = childAt(rootStack(document), 0) as MosaicPaywallV04ButtonComponent;
    const label = button.children[0] as MosaicPaywallV04TextComponent;
    expect(button.accessibility.label).toEqual(label.value);
    expect(Object.keys(document.localization.locales.en?.strings ?? {})).toEqual([
      "figma.screen",
      "figma.label",
    ]);
    expectValid(document);
  });

  it("puts the frame's padding in the appearance, which is where a button has one", () => {
    const { document } = mapDocument(
      frame({ name: "Root", children: [buttonFrame()] }),
    );
    const button = childAt(rootStack(document), 0) as MosaicPaywallV04ButtonComponent;
    // `#/$defs/buttonComponent` has no `padding` property at all.
    expect("padding" in button).toBe(false);
    expect(button.appearance).toEqual({
      background: { type: "color", value: "#0D99FFFF" },
      cornerRadius: 28,
      padding: { top: 16, start: 24, bottom: 16, end: 24 },
    });
    expectValid(document);
  });

  it("says every button carries a placeholder", () => {
    const { report } = mapDocument(
      frame({ name: "Root", children: [buttonFrame()] }),
    );
    const warning = report.warnings.find(
      (entry) => entry.code === "component.buttonDetected",
    );
    expect(warning?.message).toBe(
      "Detected as button with placeholder action -- set the real action in Studio.",
    );
    expect(report.buttonCount).toBe(1);
  });

  it("wraps a top-level frame that is itself a button", () => {
    const { document, report } = mapDocument(buttonFrame());
    const wrapper = screenContent(document);
    expect(wrapper.direction).toBe("vertical");
    expect(childAt(wrapper, 0).type).toBe("button");
    expect(report.warnings.map((warning) => warning.code)).toContain(
      "layout.rootWrapped",
    );
    expectValid(document);
  });

  it("leaves a frame with two children as a stack", () => {
    const { document, report } = mapDocument(
      frame({
        name: "Root",
        children: [
          frame({
            name: "Card",
            cornerRadius: 12,
            fills: [solid("#0D99FF")],
            children: [
              text({ name: "Title", characters: "Yearly" }),
              text({ name: "Price", characters: "$59.99" }),
            ],
          }),
        ],
      }),
    );
    expect(childAt(rootStack(document), 0).type).toBe("stack");
    expect(report.buttonCount).toBe(0);
    expectValid(document);
  });
});

describe("solid-fill shapes", () => {
  it("emits a childless painted rectangle as a sized, empty stack", () => {
    const { document } = mapDocument(
      frame({
        name: "Root",
        bounds: box(0, 0, 300, 300),
        layoutMode: "none",
        children: [
          text({ name: "Title", characters: "Hi", bounds: box(20, 20, 260, 20) }),
          shape({
            name: "Divider",
            bounds: box(20, 60, 100, 2),
            fills: [solid("#E0E0E0")],
          }),
        ],
      }),
    );
    const block = childAt(rootStack(document), 1) as MosaicPaywallV04Stack;
    // `#/$defs/stack` allows `children: []`, and only a *screen root* has to be
    // non-empty, so a colour block needs no filler child.
    expect(block.children).toEqual([]);
    expect(block.appearance).toEqual({
      background: { type: "color", value: "#E0E0E0FF" },
    });
    expect(block.sizing).toEqual({
      width: { mode: "fixed", value: 100 },
      height: { mode: "fixed", value: 2 },
    });
    expectValid(document);
  });

  it("fills the width when the shape spans its parent on one axis only", () => {
    const { document } = mapDocument(
      frame({
        name: "Root",
        bounds: box(0, 0, 300, 300),
        layoutMode: "none",
        children: [
          text({ name: "Title", characters: "Hi", bounds: box(0, 20, 300, 20) }),
          shape({ name: "Rule", bounds: box(0, 60, 300, 1) }),
        ],
      }),
    );
    const block = childAt(rootStack(document), 1) as MosaicPaywallV04Stack;
    expect(block.sizing).toEqual({
      width: "fill",
      height: { mode: "fixed", value: 1 },
    });
    expectValid(document);
  });

  it("merges a shape that covers its parent into the parent's background", () => {
    const { document, report } = mapDocument(
      frame({
        name: "Root",
        bounds: box(0, 0, 300, 300),
        layoutMode: "none",
        children: [
          shape({ name: "Backdrop", bounds: box(0, 0, 300, 300), fills: [solid("#101014")] }),
          text({ name: "Title", characters: "Hi", bounds: box(20, 20, 260, 20) }),
        ],
      }),
    );
    const stack = rootStack(document);
    expect(stack.appearance).toEqual({
      background: { type: "color", value: "#101014FF" },
    });
    expect(stack.children.map((child) => child.type)).toEqual(["text"]);
    expect(report.warnings.map((warning) => warning.code)).toContain(
      "style.backgroundMerged",
    );
    expectValid(document);
  });

  it("keeps a full-bleed shape as a box when the parent already has a background", () => {
    const { document } = mapDocument(
      frame({
        name: "Root",
        bounds: box(0, 0, 300, 300),
        layoutMode: "none",
        fills: [solid("#FFFFFF")],
        children: [
          shape({ name: "Tint", bounds: box(0, 0, 300, 300), fills: [solid("#101014")] }),
        ],
      }),
    );
    expect(rootStack(document).children).toHaveLength(1);
    expectValid(document);
  });

  it("approximates an ellipse with a rounded rectangle and says so", () => {
    const { document, report } = mapDocument(
      frame({
        name: "Root",
        bounds: box(0, 0, 300, 300),
        layoutMode: "none",
        children: [
          text({ name: "Title", characters: "Hi", bounds: box(20, 20, 260, 20) }),
          shape({
            name: "Dot",
            figmaType: "ELLIPSE",
            bounds: box(20, 60, 24, 24),
            fills: [solid("#0D99FF")],
          }),
        ],
      }),
    );
    const dot = childAt(rootStack(document), 1) as MosaicPaywallV04Stack;
    expect(dot.appearance?.cornerRadius).toBe(12);
    expect(report.warnings.map((warning) => warning.code)).toContain(
      "style.shapeApproximated",
    );
    expectValid(document);
  });

  it("skips an unmeasurable shape and says precisely why", () => {
    const { document, report } = mapDocument(
      frame({
        name: "Root",
        children: [
          text({ name: "Title", characters: "Hi" }),
          shape({ name: "Ghost", bounds: null }),
        ],
      }),
    );
    expect(rootStack(document).children).toHaveLength(1);
    const skip = report.skipped.find((entry) => entry.reason === "unmeasurable");
    expect(skip?.message).toContain("no usable size");
    expect(skip?.message).toContain("explicit width and height");
    expectValid(document);
  });
});

describe("plan-card suggestions", () => {
  it("suggests a product selector without emitting one", () => {
    const { document, report } = mapDocument(positionedPaywall());
    const warning = report.warnings.find(
      (entry) => entry.code === "component.productCardCandidate",
    );
    expect(warning?.message).toContain("look like plan cards");
    expect(warning?.message).toContain("Plans/Monthly");
    expect(warning?.message).toContain("Plans/Yearly");
    expect(warning?.message).toContain("Plans/Lifetime");
    // The suggestion changes nothing: fabricating `products[]` would ship a
    // paywall bound to store identifiers that do not exist.
    expect(document.products).toEqual([]);
    expect(JSON.stringify(document)).not.toContain("productSelector");
    expectValid(document);
  });

  it("stays quiet for a frame with no repeated priced siblings", () => {
    const { report } = mapDocument(representativePaywall());
    expect(report.warnings.map((warning) => warning.code)).not.toContain(
      "component.productCardCandidate",
    );
  });
});

describe("multi-frame export", () => {
  /**
   * Every screen carries a CTA, because the protocol requires each screen to be
   * reachable from the first and a detected button is the only edge the plugin
   * can honestly draw.
   */
  const screen = (name: string, x: number, label: string) =>
    frame({
      name,
      bounds: box(x, 0, 390, 844),
      layoutMode: "vertical",
      children: [
        text({ name: "Title", characters: label }),
        frame({
          name: "CTA",
          cornerRadius: 24,
          fills: [solid("#0D99FF")],
          children: [text({ name: "Action", characters: "Continue" })],
        }),
      ],
    });

  it("makes one screen per frame, in canvas order", () => {
    const { document, report } = mapDocument([
      screen("Plans", 500, "Plans"),
      screen("Welcome", 0, "Welcome"),
      screen("Confirm", 1000, "Confirm"),
    ]);
    expect(document.screens.map((entry) => entry.id)).toEqual([
      "welcome",
      "plans",
      "confirm",
    ]);
    // The first frame on the canvas is where the paywall opens.
    expect(document.initialScreenId).toBe("welcome");
    expect(document.id).toBe("welcome");
    expect(report.screenCount).toBe(3);
    expect(report.rootLayerNames).toEqual(["Welcome", "Plans", "Confirm"]);
    expectValid(document);
  });

  it("orders frames stacked in a column by their y", () => {
    const upper = screen("Upper", 0, "Upper");
    const lower = screen("Lower", 0, "Lower");
    const { document } = mapDocument([
      { ...lower, bounds: box(0, 900, 390, 844) },
      { ...upper, bounds: box(0, 0, 390, 844) },
    ]);
    expect(document.screens.map((entry) => entry.id)).toEqual(["upper", "lower"]);
    expectValid(document);
  });

  it("threads the flow through each screen's last button", () => {
    const { document, report } = mapDocument([
      screen("Welcome", 0, "Hello"),
      screen("Plans", 500, "Choose"),
    ]);
    const welcome = document.screens[0];
    const cta = welcome?.layout.content.children[1] as MosaicPaywallV04ButtonComponent;
    expect(cta.type).toBe("button");
    // The protocol rejects a screen the first one cannot reach, and a button's
    // `navigateTo` is the only edge that exists.
    expect(cta.action).toEqual({ type: "navigateTo", screenId: "plans" });
    // The last screen keeps its placeholder: it navigates nowhere.
    const last = document.screens[1];
    const lastCta = last?.layout.content.children[1] as MosaicPaywallV04ButtonComponent;
    expect(lastCta.action).toEqual({ type: "close" });
    expect(
      report.warnings.some((warning) =>
        warning.message.includes('pointed at the "plans" screen'),
      ),
    ).toBe(true);
    expectValid(document);
  });

  it("declares navigateTo without claiming a normalized outcome for it", () => {
    const { document } = mapDocument([
      screen("Welcome", 0, "Hello"),
      screen("Plans", 500, "Choose"),
    ]);
    const names = document.compatibility.requiredCapabilities.map(
      (capability) => capability.name,
    );
    expect(names).toContain("action.navigateTo");
    // The last screen's button still closes, which is what keeps
    // `outcome.normalized` in the set.
    expect(names).toContain("action.close");
    expect(names).toContain("outcome.normalized");
    expectValid(document);
  });

  it("stops the flow at a frame with no button, and says why", () => {
    const plain = frame({
      name: "Static",
      bounds: box(500, 0, 390, 844),
      layoutMode: "vertical",
      children: [text({ name: "Title", characters: "No CTA here" })],
    });
    const { document, report } = mapDocument([
      screen("Welcome", 0, "Hello"),
      plain,
      frame({
        name: "Orphan",
        bounds: box(1000, 0, 390, 844),
        layoutMode: "vertical",
        children: [text({ name: "Title", characters: "Never reached" })],
      }),
    ]);
    expect(document.screens.map((entry) => entry.id)).toEqual([
      "welcome",
      "static",
    ]);
    const skip = report.skipped.find((entry) => entry.reason === "unreachable");
    expect(skip?.layerPath).toBe("Orphan");
    expect(skip?.message).toContain('stops at "Static"');
    expectValid(document);
  });

  it("namespaces localization keys per screen so identical layer names cannot collide", () => {
    const { document } = mapDocument([
      screen("Welcome", 0, "Hello"),
      screen("Plans", 500, "Choose"),
    ]);
    expect(Object.keys(document.localization.locales.en?.strings ?? {})).toEqual([
      "figma.welcome.screen",
      "figma.welcome.title",
      "figma.welcome.action",
      "figma.plans.screen",
      "figma.plans.title",
      "figma.plans.action",
    ]);
    expectValid(document);
  });

  it("keeps the flat namespace and the `imported` screen for a single frame", () => {
    const { document } = mapDocument(screen("Welcome", 0, "Hello"));
    expect(document.screens.map((entry) => entry.id)).toEqual(["imported"]);
    expect(Object.keys(document.localization.locales.en?.strings ?? {})).toEqual([
      "figma.screen",
      "figma.title",
      "figma.action",
    ]);
    expectValid(document);
  });

  it("de-duplicates screen ids, and the keys derived from them, for repeated frame names", () => {
    const { document } = mapDocument([
      screen("Paywall", 0, "One"),
      screen("Paywall", 500, "Two"),
      screen("Paywall", 1000, "Three"),
    ]);
    expect(document.screens.map((entry) => entry.id)).toEqual([
      "paywall",
      "paywall-2",
      "paywall-3",
    ]);
    expect(Object.keys(document.localization.locales.en?.strings ?? {})).toEqual([
      "figma.paywall.screen",
      "figma.paywall.title",
      "figma.paywall.action",
      "figma.paywall_2.screen",
      "figma.paywall_2.title",
      "figma.paywall_2.action",
      "figma.paywall_3.screen",
      "figma.paywall_3.title",
      "figma.paywall_3.action",
    ]);
    expectValid(document);
  });

  it("keeps node ids unique across screens, which the validator checks globally", () => {
    const { document } = mapDocument([
      screen("Welcome", 0, "Hello"),
      screen("Plans", 500, "Choose"),
    ]);
    const ids: string[] = [];
    const visit = (node: { id: string; children?: readonly { id: string }[] }) => {
      ids.push(node.id);
      for (const child of node.children ?? []) visit(child as never);
    };
    for (const entry of document.screens) {
      ids.push(entry.layout.id);
      visit(entry.layout.content);
    }
    expect(new Set(ids).size).toBe(ids.length);
    expectValid(document);
  });

  it("refuses to map an empty selection rather than emit a screenless document", () => {
    expect(() => mapDocument([])).toThrow(/at least one frame/);
  });
});

describe("report entries point back at their layer", () => {
  it("carries the Figma node id on every warning and skip", () => {
    const { report } = mapDocument(
      frame({
        name: "Root",
        layoutMode: "none",
        children: [
          unsupported({ name: "Art", reason: "image" }),
          text({ name: "Blank", characters: " " }),
          text({ name: "Real", characters: "Hi", textAlign: "justified" }),
        ],
      }),
    );
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(report.skipped.length).toBeGreaterThan(0);
    for (const entry of [...report.warnings, ...report.skipped]) {
      expect(entry.figmaId).toBeTruthy();
    }
  });
});

describe("mixed text styling", () => {
  it("reports that the first character's font stood in for the layer", () => {
    const { document, report } = mapDocument(
      frame({
        name: "Root",
        children: [
          text({
            name: "Headline",
            characters: "Save 40% today",
            fontSize: 24,
            fontWeight: 700,
            fontStyleName: "Bold",
            mixedStyling: true,
          }),
        ],
      }),
    );
    const node = childAt(rootStack(document), 0) as MosaicPaywallV04TextComponent;
    // The first character's styling was carried, not thrown away for a default.
    expect(node.typography.fontSize).toBe(24);
    expect(node.typography.weight).toBe("bold");
    const warning = report.warnings.find(
      (entry) => entry.code === "text.mixedStyling",
    );
    expect(warning?.message).toContain("first character");
    expectValid(document);
  });
});

describe("the whole export survives the path Studio imports through", () => {
  it("round-trips a positioned, multi-frame selection", () => {
    const { document } = mapDocument([
      positionedPaywall(),
      frame({
        name: "Confirm",
        bounds: box(500, 0, 390, 844),
        layoutMode: "vertical",
        children: [text({ name: "Done", characters: "You're all set." })],
      }),
    ]);
    const parsed = parsePortablePaywallJson(
      `${JSON.stringify(document as MosaicPaywallV04Document, null, 2)}\n`,
    );
    expect(parsed.ok).toBe(true);
    expectValid(document);
  });
});
