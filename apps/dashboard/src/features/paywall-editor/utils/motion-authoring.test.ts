import { describe, expect, it } from "vitest";
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates";
import { collectEditorValidation } from "@/features/paywall-editor/hooks/use-editor-validation";
import { upgradeDocumentToV04 } from "@/features/paywall-editor/mutations/upgrade-to-v04";
import type {
  AppearMotion,
  LoopMotion,
  MosaicDocument,
} from "@/features/paywall-editor/types/editor";
import { cloneValue } from "@/features/paywall-editor/utils/clone";
import {
  flattenDocument,
  updateNode,
} from "@/features/paywall-editor/utils/document-tree-traversal";
import {
  documentRequiredCapabilities,
  findAppearAncestorId,
  withDocumentParts,
  withNodeParts,
} from "@/features/paywall-editor/utils/document-version";
import { synchronizeProtocolMetadata } from "@/features/paywall-editor/utils/protocol-document";
import { validatePaywallDocument } from "@/lib/mosaic-protocol";
import { required } from "@/test/required";

function v04Template() {
  return upgradeDocumentToV04(
    cloneValue(required(EDITOR_TEMPLATES[0], "EDITOR_TEMPLATES[0]").document)
  );
}

const ENTRANCE: AppearMotion = {
  effect: "fade",
  curve: { type: "motion", durationMilliseconds: 240, easing: "decelerate" },
  delayMilliseconds: 0,
};

const PULSE: LoopMotion = {
  effect: "pulse",
  scaleAmplitude: 0.04,
  opacityAmplitude: 0.12,
  curve: { type: "motion", durationMilliseconds: 600, easing: "standard" },
  repeat: { count: 3 },
};

function withMotion(
  document: MosaicDocument,
  nodeId: string,
  motion: Record<string, unknown>
) {
  return updateNode(document, nodeId, (node) =>
    withNodeParts(node, { motion })
  );
}

function buttonIds(document: MosaicDocument) {
  return flattenDocument(document)
    .filter((entry) => entry.node.type === "button")
    .map((entry) => entry.node.id);
}

function motionDiagnostics(document: MosaicDocument) {
  return collectEditorValidation(document).issues.filter(
    (issue) => issue.code === "semantic.motion"
  );
}

describe("motion authoring constraints", () => {
  /**
   * A node carrying `appear` under another node carrying `appear` rejects the
   * document, and the Validation panel is where an author finds out. This
   * asserts the diagnostic reaches the panel rather than being swallowed by the
   * editor's own validation layer, which is the realistic failure: Studio has
   * its own validator and only forwards contract diagnostics it does not
   * already cover.
   */
  it("surfaces a nested entrance as a validation error", () => {
    const base = v04Template();
    const contentId = required(base.screens[0], "screens[0]").layout.content.id;
    const [childId] = required(
      base.screens[0],
      "screens[0]"
    ).layout.content.children.map((child) => child.id);

    const nested = withMotion(
      withMotion(base, contentId, { appear: ENTRANCE }),
      required(childId, "first child id"),
      { appear: ENTRANCE }
    );

    expect(motionDiagnostics(base)).toEqual([]);
    expect(motionDiagnostics(nested).length).toBeGreaterThan(0);
  });

  /**
   * The inspector's inline note depends on this lookup, so it is asserted
   * directly: an ancestor scan that silently returned null would leave the
   * author with a document-rejecting entrance and no explanation at the control.
   */
  it("finds the ancestor responsible for a nested entrance", () => {
    const base = v04Template();
    const contentId = required(base.screens[0], "screens[0]").layout.content.id;
    const childId = required(
      required(base.screens[0], "screens[0]").layout.content.children[0],
      "first child"
    ).id;

    const nested = withMotion(
      withMotion(base, contentId, { appear: ENTRANCE }),
      childId,
      { appear: ENTRANCE }
    );

    expect(findAppearAncestorId(nested, childId)).toBe(contentId);
    expect(findAppearAncestorId(base, childId)).toBeNull();
  });

  /**
   * At most one pulse per screen. The second one is the interesting case: one
   * is legal, so a rule that counted globally or not at all would still pass a
   * single-pulse document.
   */
  it("accepts one pulse per screen and rejects the second", () => {
    const base = v04Template();
    const [firstButton, secondButton] = buttonIds(base);

    const onePulse = withMotion(base, required(firstButton, "first button"), {
      loop: PULSE,
    });
    const twoPulses = withMotion(
      onePulse,
      required(secondButton, "second button"),
      { loop: PULSE }
    );

    expect(motionDiagnostics(onePulse)).toEqual([]);
    expect(motionDiagnostics(twoPulses).length).toBeGreaterThan(0);
  });

  /**
   * Capability derivation must track authored motion, because an under-declared
   * capability is refused at delivery and an over-declared one is refused by the
   * validator. The dashboard composes this itself -- the protocol package's
   * `requiredCapabilitiesFor` is not version-aware -- so it is worth pinning.
   */
  it("derives the motion capabilities an authored document requires", () => {
    const base = v04Template();
    const withEntrance = withMotion(
      base,
      required(base.screens[0], "screens[0]").layout.content.id,
      { appear: ENTRANCE }
    );

    const names = documentRequiredCapabilities(withEntrance).map(
      (capability) => capability.name
    );

    expect(names).toContain("motion.appear");
    expect(names).not.toContain("motion.loop");
    expect(
      documentRequiredCapabilities(base).map((capability) => capability.name)
    ).not.toContain("motion.appear");
  });
  /**
   * Motion tokens are rejected when unreferenced -- a deliberate asymmetry with
   * the colour, background and shadow catalogs, because a motion's safety bound
   * is checked at its reference site, so a token nothing references has never
   * been checked against anything. The Design System panel's "add motion"
   * button therefore produces a document that is invalid until a node uses the
   * token, and an author has to be told that rather than left guessing.
   */
  it("surfaces an unreferenced motion token as a validation error", () => {
    const base = v04Template();
    const withUnusedToken = withDocumentParts(base, {
      designSystem: {
        ...base.designSystem,
        motions: [
          {
            id: "motion-unused",
            name: "Unused",
            value: {
              type: "motion",
              durationMilliseconds: 240,
              easing: "standard",
            },
          },
        ],
      },
    });

    const { issues } = collectEditorValidation(withUnusedToken);

    expect(
      issues.some((issue) => issue.code === "semantic.unusedDeclaration")
    ).toBe(true);
    // Referencing it from a node clears the error rather than needing the token
    // deleted, which is the resolution the panel's copy points authors at.
    const referenced = withMotion(
      withUnusedToken,
      required(withUnusedToken.screens[0], "screens[0]").layout.content.id,
      {
        appear: {
          effect: "fade",
          curve: { type: "motionToken", id: "motion-unused" },
          delayMilliseconds: 0,
        },
      }
    );
    expect(
      collectEditorValidation(referenced).issues.filter(
        (issue) => issue.code === "semantic.unusedDeclaration"
      )
    ).toEqual([]);
  });

  /**
   * The metadata pass runs on every document change, so if it derived 0.3
   * capabilities for a 0.4 document it would rewrite a valid document into an
   * invalid one on the author's next keystroke. This drives the whole path:
   * upgrade, author motion, synchronise, validate against the real contract.
   */
  it("keeps a motion-bearing document valid through the metadata pass", () => {
    const authored = withMotion(
      v04Template(),
      required(v04Template().screens[0], "screens[0]").layout.content.id,
      {
        appear: ENTRANCE,
      }
    );

    const synchronized = synchronizeProtocolMetadata(authored);
    const result = validatePaywallDocument(synchronized);

    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(
      synchronized.compatibility.requiredCapabilities.map(
        (capability) => capability.name
      )
    ).toContain("motion.appear");
  });
});
