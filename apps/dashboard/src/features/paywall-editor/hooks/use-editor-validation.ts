import { useMemo } from "react";

import { validateEditorDocument } from "@/features/paywall-editor/schema/editor-validation";
import { useEditorStore } from "@/features/paywall-editor/stores/editor-store-context";
import type {
  MosaicDocument,
  ValidationIssue,
} from "@/features/paywall-editor/types/editor";
import { findNode } from "@/features/paywall-editor/utils/document-tree-traversal";
import { resolveInspectorValidationIssue } from "@/features/paywall-editor/utils/property-inspector-navigation";
import { validatePaywallDocument } from "@/lib/mosaic-protocol";

function canonicalIssue(
  diagnostic: ReturnType<typeof validatePaywallDocument> extends {
    diagnostics: infer T;
  }
    ? T extends readonly (infer D)[]
      ? D
      : never
    : never
): ValidationIssue {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    severity: "error",
    componentId: diagnostic.location.componentId,
    property: diagnostic.location.property,
    documentPath: diagnostic.location.documentPath,
    recovery: diagnostic.recovery.message,
  };
}

function issueTargetNode(document: MosaicDocument, issue: ValidationIssue) {
  return (
    document.screens.find((screen) => issue.componentId === screen.layout.id)
      ?.layout ??
    (issue.componentId ? findNode(document, issue.componentId) : null)
  );
}

function isSupportedAddress(document: MosaicDocument, issue: ValidationIssue) {
  const target = issueTargetNode(document, issue);
  if (!target) {
    return false;
  }
  const root = issue.property?.split(".")[0];
  if (!root) {
    return false;
  }
  // Every node except the scroll container carries a `motion` block:
  // `appear` on any node, plus `selection` on Product Selector and Tabs and
  // `loop` on Button. Which subkeys a node accepts is the schema's business;
  // here the root only has to be recognised so its diagnostics are not
  // discarded as branch noise.
  const shared = new Set(["id", "type"]);
  const nodeShared = new Set([
    ...shared,
    "motion",
    "appearance",
    "outerInsets",
    "visibility",
  ]);
  const supportedByType: Record<typeof target.type, ReadonlySet<string>> = {
    scrollContainer: new Set([
      ...shared,
      "axis",
      "safeArea",
      "showsIndicators",
      "background",
      "content",
    ]),
    stack: new Set([
      ...nodeShared,
      "direction",
      "gap",
      "padding",
      "mainAxisDistribution",
      "crossAxisAlignment",
      "sizing",
      "children",
    ]),
    text: new Set([
      ...nodeShared,
      "value",
      "typography",
      "sizing",
      "accessibility",
    ]),
    image: new Set([
      ...nodeShared,
      "assetId",
      "width",
      "aspectRatio",
      "height",
      "contentMode",
      "accessibility",
    ]),
    icon: new Set([...nodeShared, "name", "size", "color", "accessibility"]),
    featureList: new Set([
      ...nodeShared,
      "marker",
      "gap",
      "markerColor",
      "items",
      "typography",
      "sizing",
      "accessibility",
    ]),
    productSelector: new Set([
      ...nodeShared,
      "cards",
      "initialProductCardId",
      "direction",
      "gap",
      "crossAxisAlignment",
      "sizing",
      "unavailableFallback",
      "accessibility",
    ]),
    productCard: new Set([
      ...shared,
      "motion",
      "productReferenceId",
      "direction",
      "gap",
      "mainAxisDistribution",
      "crossAxisAlignment",
      "children",
      "styles",
      "clipContent",
      "accessibility",
    ]),
    productBadge: new Set([
      ...shared,
      "motion",
      "placement",
      "direction",
      "gap",
      "mainAxisDistribution",
      "crossAxisAlignment",
      "children",
      "styles",
    ]),
    button: new Set([
      ...nodeShared,
      "direction",
      "gap",
      "mainAxisDistribution",
      "crossAxisAlignment",
      "children",
      "inProgressChildren",
      "sizing",
      "action",
      "accessibility",
    ]),
    carousel: new Set([
      ...nodeShared,
      "initialPageIndex",
      "showsIndicators",
      "pages",
      "sizing",
      "accessibility",
    ]),
    switch: new Set([
      ...nodeShared,
      "label",
      "initialValue",
      "typography",
      "offTrackColor",
      "onTrackColor",
      "thumbColor",
      "accessibility",
    ]),
    countdown: new Set([
      ...nodeShared,
      "endsAt",
      "largestUnit",
      "smallestUnit",
      "completedText",
      "typography",
      "sizing",
      "accessibility",
    ]),
    tabs: new Set([
      ...nodeShared,
      "tabBarDirection",
      "tabBarGap",
      "tabBarDistribution",
      "gap",
      "initialTabId",
      "tabs",
      "styles",
      "labelTypography",
      "selectedLabelColor",
      "sizing",
      "accessibility",
    ]),
    timeline: new Set([
      ...nodeShared,
      "orientation",
      "gap",
      "connector",
      "entries",
      "markerColor",
      "markerSize",
      "titleTypography",
      "descriptionTypography",
      "sizing",
      "accessibility",
    ]),
    award: new Set([
      ...nodeShared,
      "direction",
      "gap",
      "crossAxisAlignment",
      "emblem",
      "title",
      "titleTypography",
      "subtitle",
      "subtitleTypography",
      "sizing",
      "accessibility",
    ]),
    socialProof: new Set([
      ...nodeShared,
      "gap",
      "quote",
      "quoteTypography",
      "attribution",
      "attributionTypography",
      "rating",
      "avatar",
      "sizing",
      "accessibility",
    ]),
  };
  return supportedByType[target.type].has(root);
}

function conditionalAccessibilityBranchDecision(
  document: MosaicDocument,
  issue: ValidationIssue
): boolean | null {
  const target = issueTargetNode(document, issue);
  if (!target) {
    return null;
  }

  const address = issue.property ?? "";
  if (target.type === "text" || target.type === "countdown") {
    const { role } = target.accessibility;
    if (address === "accessibility.role" && issue.code === "schema.const") {
      return role === "text" || role === "heading";
    }
    if (address === "accessibility.level") {
      if (role === "heading") {
        return issue.code === "schema.additionalProperties";
      }
      if (role === "text") {
        return issue.code !== "schema.additionalProperties";
      }
      return true;
    }
    if (address === "accessibility.hidden") {
      return issue.code !== "schema.additionalProperties";
    }
    if (
      address === "accessibility.label" &&
      (issue.code === "schema.required" ||
        issue.code === "schema.additionalProperties")
    ) {
      return true;
    }
  }

  if (target.type === "image" || target.type === "icon") {
    const { hidden } = target.accessibility;
    if (address === "accessibility.hidden" && issue.code === "schema.const") {
      return typeof hidden === "boolean";
    }
    if (
      address === "accessibility.label" ||
      address.startsWith("accessibility.label.")
    ) {
      if (hidden === true) {
        return !(
          issue.code === "schema.additionalProperties" &&
          address === "accessibility.label"
        );
      }
      if (hidden === false) {
        return (
          issue.code === "schema.additionalProperties" &&
          address === "accessibility.label"
        );
      }
      return true;
    }
  }

  return null;
}

function authoredValueAt(target: unknown, segments: readonly string[]) {
  let current: unknown = target;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Branch decisions for the two `oneOf`s inside a node's `motion` block.
 *
 * The generic heuristics below were written for the accessibility branches and
 * are wrong for motion: they drop every `schema.oneOf` and every
 * `schema.additionalProperties` at a supported address, which left an invalid
 * motion block blocking publish with an empty Validation panel. Motion's
 * `oneOf`s are cleanly discriminated -- `appear` on `effect` ("fade" |
 * "fadeRise") and every `curve` on `type` ("motion" | "motionToken") -- so the
 * authored discriminator selects the branch: the chosen branch's diagnostics
 * are actionable and survive, the other branch's are noise and are dropped.
 * When the discriminator itself is missing or unknown no branch can be chosen,
 * and everything is kept rather than guessed away.
 *
 * Returns true for noise, false for an actionable diagnostic, and null when
 * the issue is not a node-motion address.
 */
function motionSchemaBranchDecision(
  document: MosaicDocument,
  issue: ValidationIssue
): boolean | null {
  const address = issue.property ?? "";
  if (address !== "motion" && !address.startsWith("motion.")) {
    return null;
  }
  const target = issueTargetNode(document, issue);
  if (!target) {
    return null;
  }
  const segments = address.split(".");

  // The appear oneOf, discriminated on `effect`.
  const appearEffect = authoredValueAt(target, ["motion", "appear", "effect"]);
  const appearBranchChosen =
    appearEffect === "fade" || appearEffect === "fadeRise";
  if (address === "motion.appear" && issue.code === "schema.oneOf") {
    return appearBranchChosen;
  }
  if (address === "motion.appear.effect" && issue.code === "schema.const") {
    return appearBranchChosen;
  }
  if (address === "motion.appear.riseLogicalSize") {
    if (issue.code === "schema.required") {
      return appearEffect === "fade";
    }
    if (issue.code === "schema.additionalProperties") {
      return appearEffect === "fadeRise";
    }
  }

  // The curve oneOf (inline motion vs token reference), discriminated on
  // `type`. A curve sits under appear, selection, and loop alike.
  const curveIndex = segments.indexOf("curve");
  if (curveIndex >= 0) {
    const curve = authoredValueAt(target, segments.slice(0, curveIndex + 1));
    const curveType =
      curve && typeof curve === "object" && !Array.isArray(curve)
        ? (curve as Record<string, unknown>).type
        : undefined;
    const inline = curveType === "motion";
    const token = curveType === "motionToken";
    const leaf = segments.slice(curveIndex + 1).join(".");
    if (leaf === "" && issue.code === "schema.oneOf") {
      return inline || token;
    }
    if (leaf === "type" && issue.code === "schema.const") {
      return inline || token;
    }
    if (leaf === "id") {
      if (issue.code === "schema.required") {
        return inline;
      }
      if (issue.code === "schema.additionalProperties") {
        return token;
      }
    }
    if (leaf === "durationMilliseconds" || leaf === "easing") {
      if (issue.code === "schema.required") {
        return token;
      }
      if (issue.code === "schema.additionalProperties") {
        return inline;
      }
    }
  }

  // Everything else under `motion` is a real, actionable diagnostic -- a
  // missing selection curve, a loop on a node that cannot carry one. Never let
  // the generic rules swallow it.
  return false;
}

function isSchemaBranchNoise(document: MosaicDocument, issue: ValidationIssue) {
  if (!issue.code.startsWith("schema.")) {
    return false;
  }
  const conditionalAccessibility = conditionalAccessibilityBranchDecision(
    document,
    issue
  );
  if (conditionalAccessibility !== null) {
    return conditionalAccessibility;
  }
  const motionDecision = motionSchemaBranchDecision(document, issue);
  if (motionDecision !== null) {
    return motionDecision;
  }
  const supportedAddress = isSupportedAddress(document, issue);
  if (issue.code === "schema.oneOf") {
    return true;
  }
  if (issue.code === "schema.required") {
    return !supportedAddress;
  }
  if (issue.code === "schema.additionalProperties") {
    return supportedAddress;
  }
  return (
    issue.code === "schema.const" &&
    issue.property === "type" &&
    supportedAddress
  );
}

export function collectEditorValidation(document: MosaicDocument) {
  const editorIssues = validateEditorDocument(document);
  const displayEditorIssues = editorIssues.filter(
    (candidate) =>
      candidate.code !== "localization.missingKey" ||
      !editorIssues.some(
        (issue) =>
          issue.code === "localization.emptyValue" &&
          issue.componentId === candidate.componentId &&
          issue.property === candidate.property
      )
  );
  const canonical = validatePaywallDocument(document);
  if (canonical.ok) {
    return {
      issues: displayEditorIssues.map((issue) =>
        resolveInspectorValidationIssue(document, issue)
      ),
      contractValid: true,
    };
  }

  const additionalCanonicalIssues: ValidationIssue[] = [];
  const seenCanonicalIssues = new Set<string>();
  for (const diagnostic of canonical.diagnostics) {
    const contractIssue = resolveInspectorValidationIssue(
      document,
      canonicalIssue(diagnostic)
    );
    const issueKey = `${contractIssue.code}:${contractIssue.documentPath}`;
    if (
      isSchemaBranchNoise(document, contractIssue) ||
      seenCanonicalIssues.has(issueKey)
    ) {
      continue;
    }
    seenCanonicalIssues.add(issueKey);
    const coveredByEditorIssue = editorIssues.some(
      (editorIssue) =>
        editorIssue.documentPath === contractIssue.documentPath ||
        contractIssue.documentPath.startsWith(`${editorIssue.documentPath}/`) ||
        (editorIssue.componentId === contractIssue.componentId &&
          editorIssue.property === contractIssue.property)
    );
    if (!coveredByEditorIssue) {
      additionalCanonicalIssues.push(contractIssue);
    }
  }
  return {
    issues: [
      ...displayEditorIssues.map((issue) =>
        resolveInspectorValidationIssue(document, issue)
      ),
      ...additionalCanonicalIssues,
    ],
    contractValid: false,
  };
}

export function useEditorValidation() {
  const { document } = useEditorStore();
  const { issues, contractValid } = useMemo(
    () =>
      document
        ? collectEditorValidation(document)
        : { issues: [], contractValid: false },
    [document]
  );
  const errors = issues.filter((entry) => entry.severity === "error");
  const warnings = issues.filter((entry) => entry.severity === "warning");

  return {
    issues,
    errors,
    warnings,
    isValid: !!document && contractValid && errors.length === 0,
  };
}
