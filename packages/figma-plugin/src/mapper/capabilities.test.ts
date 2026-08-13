import { describe, expect, it } from "vitest";
import {
  requiredCapabilitiesFor,
  validatePaywallDocument,
} from "../../../../protocol/browser/index.js";
import type { MosaicPaywallV04Document } from "../../../../protocol/browser/index.js";
import { mapDocument } from "./map-document.js";
import {
  box,
  frame,
  positionedPaywall,
  representativePaywall,
  shape,
  solid,
  text,
  unsupported,
} from "./test-support.js";
import type { IntermediateFrame } from "./intermediate.js";

const cta = (name: string) =>
  frame({
    name,
    cornerRadius: 24,
    fills: [solid("#0D99FF")],
    children: [text({ name: `${name} Label`, characters: "Continue" })],
  });

/**
 * Every distinct shape the mapper can produce, in capability terms: text or no
 * text, appearance or no appearance, nested or flat, absolute or auto-layout,
 * plus everything the newer heuristics can emit -- a button with its
 * placeholder action, an explicitly sized colour block, and a threaded
 * multi-screen flow.
 */
const CASES: readonly (readonly [string, IntermediateFrame | IntermediateFrame[]])[] = [
  ["a representative paywall", representativePaywall()],
  ["a positioned paywall with inferred layout and a button", positionedPaywall()],
  ["a frame holding only a detected button", frame({ name: "Root", children: [cta("Buy")] })],
  ["a top-level frame that is itself a button", cta("Buy")],
  [
    "an explicitly sized colour block",
    frame({
      name: "Root",
      bounds: box(0, 0, 300, 300),
      layoutMode: "none",
      children: [
        text({ name: "Title", characters: "Hi", bounds: box(20, 20, 200, 20) }),
        shape({ name: "Rule", bounds: box(20, 60, 100, 2) }),
      ],
    }),
  ],
  [
    "a colour block that fills its parent's width",
    frame({
      name: "Root",
      bounds: box(0, 0, 300, 300),
      layoutMode: "none",
      children: [
        text({ name: "Title", characters: "Hi", bounds: box(0, 20, 300, 20) }),
        shape({ name: "Rule", bounds: box(0, 60, 300, 1) }),
      ],
    }),
  ],
  [
    "a threaded multi-screen flow",
    [
      frame({
        name: "Welcome",
        bounds: box(0, 0, 390, 844),
        children: [text({ name: "Title", characters: "Hello" }), cta("Next")],
      }),
      frame({
        name: "Plans",
        bounds: box(500, 0, 390, 844),
        children: [text({ name: "Title", characters: "Choose" }), cta("Buy")],
      }),
    ],
  ],
  ["a bare frame with no children", frame({ name: "Bare" })],
  [
    "a frame whose only child was skipped",
    frame({
      name: "Skipped only",
      children: [unsupported({ name: "Art", reason: "vector" })],
    }),
  ],
  [
    "a frame with a background but no text",
    frame({ name: "Painted", fills: [solid("#101014")], cornerRadius: 8 }),
  ],
  [
    "a frame with text but no colours anywhere",
    frame({
      name: "Plain text",
      children: [text({ name: "Label", characters: "Hello", fills: [] })],
    }),
  ],
  [
    "nested stacks",
    frame({
      name: "Outer",
      children: [
        frame({
          name: "Inner",
          layoutMode: "horizontal",
          children: [text({ name: "Label", characters: "Hello" })],
        }),
      ],
    }),
  ],
];

describe("required capabilities", () => {
  it.each(CASES)(
    "declares exactly what the protocol derives for %s",
    (_name, tree) => {
      const { document } = mapDocument(tree);
      expect(document.compatibility.requiredCapabilities).toEqual(
        requiredCapabilitiesFor(document as MosaicPaywallV04Document),
      );
    },
  );

  it.each(CASES)("validates without a missing or unused capability for %s", (
    _name,
    tree,
  ) => {
    const { document } = mapDocument(tree);
    const result = validatePaywallDocument(document);
    expect(result.diagnostics.map((entry) => entry.code)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("declares the capabilities a text-bearing paywall actually uses", () => {
    const { document } = mapDocument(representativePaywall());
    expect(
      document.compatibility.requiredCapabilities.map(
        (capability) => capability.name,
      ),
    ).toEqual([
      "layout.scrollContainer",
      "layout.stack",
      "navigation.screens",
      "component.text",
      "localization.catalogs",
      "accessibility.metadata",
      "style.colors",
      "style.box",
      "style.typography",
    ]);
    for (const capability of document.compatibility.requiredCapabilities) {
      expect(capability.version).toBe("0.4");
    }
  });

  it("declares the button and its placeholder action, and what they imply", () => {
    const { document } = mapDocument(
      frame({ name: "Root", children: [cta("Buy")] }),
    );
    const names = document.compatibility.requiredCapabilities.map(
      (capability) => capability.name,
    );
    expect(names).toContain("component.button");
    expect(names).toContain("action.close");
    // `close` is one of the actions the protocol pairs with a normalized
    // outcome, so declaring the action alone would be under-declaring.
    expect(names).toContain("outcome.normalized");
    expect(names).toContain("accessibility.metadata");
    expect(document.compatibility.requiredCapabilities).toEqual(
      requiredCapabilitiesFor(document as MosaicPaywallV04Document),
    );
  });

  it("declares both sizing capabilities for an explicitly sized colour block", () => {
    const { document } = mapDocument(
      frame({
        name: "Root",
        bounds: box(0, 0, 300, 300),
        layoutMode: "none",
        children: [
          text({ name: "Title", characters: "Hi", bounds: box(20, 20, 200, 20) }),
          shape({ name: "Rule", bounds: box(20, 60, 100, 2) }),
        ],
      }),
    );
    const names = document.compatibility.requiredCapabilities.map(
      (capability) => capability.name,
    );
    // `#/$defs/boxSizing` requires both axes, so height sizing always comes
    // along with sizing.
    expect(names).toContain("layout.sizing");
    expect(names).toContain("layout.heightSizing");
    expect(document.compatibility.requiredCapabilities).toEqual(
      requiredCapabilitiesFor(document as MosaicPaywallV04Document),
    );
  });

  it("does not declare sizing for a document with no explicitly sized node", () => {
    const { document } = mapDocument(representativePaywall());
    const names = document.compatibility.requiredCapabilities.map(
      (capability) => capability.name,
    );
    expect(names).not.toContain("layout.sizing");
    expect(names).not.toContain("layout.heightSizing");
    expect(names).not.toContain("component.button");
  });

  it("does not declare component.text or style.typography for a text-free frame", () => {
    const { document } = mapDocument(frame({ name: "Bare" }));
    const names = document.compatibility.requiredCapabilities.map(
      (capability) => capability.name,
    );
    expect(names).not.toContain("component.text");
    expect(names).not.toContain("style.typography");
    expect(names).not.toContain("style.colors");
    expect(names).toContain("layout.stack");
  });

  it("rejects a document whose declaration is padded with an unused capability", () => {
    const { document } = mapDocument(representativePaywall());
    const padded = {
      ...document,
      compatibility: {
        requiredCapabilities: [
          ...document.compatibility.requiredCapabilities,
          { name: "component.image", version: "0.4" },
        ],
      },
    };
    const result = validatePaywallDocument(padded);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      "semantic.unusedCapability",
    );
  });

  it("rejects a document with a capability removed", () => {
    const { document } = mapDocument(representativePaywall());
    const stripped = {
      ...document,
      compatibility: {
        requiredCapabilities: document.compatibility.requiredCapabilities.filter(
          (capability) => capability.name !== "component.text",
        ),
      },
    };
    const result = validatePaywallDocument(stripped);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      "semantic.missingCapability",
    );
  });
});
