import { describe, expect, it } from "vitest";
import {
  requiredCapabilitiesFor,
  validatePaywallDocument,
} from "../../../../protocol/browser/index.js";
import type { MosaicPaywallV03Document } from "../../../../protocol/browser/index.js";
import { mapDocument } from "./map-document.js";
import {
  frame,
  representativePaywall,
  solid,
  text,
  unsupported,
} from "./test-support.js";
import type { IntermediateFrame } from "./intermediate.js";

/**
 * Every distinct shape the mapper can produce, in capability terms: text or no
 * text, appearance or no appearance, nested or flat, absolute or auto-layout.
 */
const CASES: readonly (readonly [string, IntermediateFrame])[] = [
  ["a representative paywall", representativePaywall()],
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
        requiredCapabilitiesFor(document as MosaicPaywallV03Document),
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
      expect(capability.version).toBe("0.3");
    }
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
          { name: "component.image", version: "0.3" },
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
