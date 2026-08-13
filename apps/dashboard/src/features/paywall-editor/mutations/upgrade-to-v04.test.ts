import { describe, expect, it } from "vitest";
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates";
import { upgradeDocumentToV04 } from "@/features/paywall-editor/mutations/upgrade-to-v04";
import { cloneValue } from "@/features/paywall-editor/utils/clone";
import { flattenDocument } from "@/features/paywall-editor/utils/document-tree-traversal";
import { validatePaywallDocument } from "@/lib/mosaic-protocol";
import { required } from "@/test/required";

function template(id: "focused" | "benefits" = "benefits") {
  const found = EDITOR_TEMPLATES.find((entry) => entry.id === id);
  return cloneValue(required(found, `template ${id}`).document);
}

describe("upgrade to Protocol 0.4", () => {
  /**
   * The whole point of the command: a 0.3 document that has been through the
   * five documented steps must be a document the 0.4 validator accepts. This is
   * the assertion that would catch a missed step, because every one of them --
   * the version, the capability stamps, the removed capability, the required
   * motions catalog, the marker rewrite -- is separately document-rejecting.
   */
  it("produces a document the 0.4 contract validator accepts", () => {
    const upgraded = upgradeDocumentToV04(template());

    const result = validatePaywallDocument(upgraded);

    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(upgraded.schemaVersion).toBe("0.4");
  });

  /**
   * Steps 2, 3 and 4 individually. These are asserted by name rather than left
   * to the validator alone so that a failure says which step regressed: the
   * validator reports "unknown capability", not "step 3 was skipped".
   */
  it("applies the capability, catalog, and marker steps", () => {
    const before = template();
    const upgraded = upgradeDocumentToV04(before);

    expect(
      upgraded.compatibility.requiredCapabilities.every(
        (capability) => capability.version === "0.4"
      )
    ).toBe(true);
    expect(
      upgraded.compatibility.requiredCapabilities.map(
        (capability) => capability.name
      )
    ).not.toContain("style.productCardStates");
    expect(upgraded.designSystem.motions).toEqual([]);

    const featureLists = flattenDocument(upgraded).filter(
      (entry) => entry.node.type === "featureList"
    );
    expect(featureLists.length).toBeGreaterThan(0);
    for (const entry of featureLists) {
      expect(entry.node).toHaveProperty("marker", {
        kind: "icon",
        name: "checkmark",
      });
    }
  });

  /**
   * The migration must not change what the paywall renders -- that is the claim
   * that makes a one-way upgrade safe to offer. Everything outside the five
   * steps is compared verbatim.
   */
  it("changes nothing outside the five documented steps", () => {
    const before = template();
    const upgraded = upgradeDocumentToV04(before);

    expect(upgraded.id).toBe(before.id);
    expect(upgraded.products).toEqual(before.products);
    expect(upgraded.assets).toEqual(before.assets);
    expect(upgraded.localization).toEqual(before.localization);
    expect(upgraded.designSystem.colors).toEqual(before.designSystem.colors);
    expect(upgraded.designSystem.backgrounds).toEqual(
      before.designSystem.backgrounds
    );
    expect(upgraded.designSystem.shadows).toEqual(before.designSystem.shadows);
    // No entrance is invented: motion is authored after the upgrade, never by it.
    expect(
      flattenDocument(upgraded).every((entry) => !("motion" in entry.node))
    ).toBe(true);
  });

  /** One way, and idempotent: re-running it must not corrupt a 0.4 document. */
  it("leaves an already-upgraded document alone", () => {
    const once = upgradeDocumentToV04(template());

    expect(upgradeDocumentToV04(once)).toEqual(once);
  });

  /** The source document must not be mutated under the caller. */
  it("does not mutate the source document", () => {
    const before = template();
    const snapshot = cloneValue(before);

    upgradeDocumentToV04(before);

    expect(before).toEqual(snapshot);
  });
});
