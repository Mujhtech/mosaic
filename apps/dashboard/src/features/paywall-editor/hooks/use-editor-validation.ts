import { useMemo } from "react"

import { validateEditorDocument } from "@/features/paywall-editor/schema/editor-validation"
import { useEditorStore } from "@/features/paywall-editor/stores/editor-store-context"
import type { MosaicDocument, ValidationIssue } from "@/features/paywall-editor/types/editor"
import { findNode } from "@/features/paywall-editor/utils/document-tree"
import { resolveInspectorValidationIssue } from "@/features/paywall-editor/utils/property-inspector-navigation"
import { validatePaywallDocument } from "@/lib/mosaic-protocol"

function canonicalIssue(
  diagnostic: ReturnType<typeof validatePaywallDocument> extends { diagnostics: infer T }
    ? T extends readonly (infer D)[]
      ? D
      : never
    : never,
): ValidationIssue {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    severity: "error",
    componentId: diagnostic.location.componentId,
    property: diagnostic.location.property,
    documentPath: diagnostic.location.documentPath,
    recovery: diagnostic.recovery.message,
  }
}

function isSupportedAddress(document: MosaicDocument, issue: ValidationIssue) {
  const target =
    document.screens.find((screen) => issue.componentId === screen.layout.id)?.layout ??
    (issue.componentId ? findNode(document, issue.componentId) : null)
  if (!target) return false
  const root = issue.property?.split(".")[0]
  if (!root) return false
  const shared = new Set(["id", "type"])
  const nodeShared = new Set([...shared, "appearance", "outerInsets", "visibility"])
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
    text: new Set([...nodeShared, "value", "typography", "sizing", "accessibility"]),
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
  }
  return supportedByType[target.type].has(root)
}

function conditionalAccessibilityBranchDecision(
  document: MosaicDocument,
  issue: ValidationIssue,
): boolean | null {
  const target =
    document.screens.find((screen) => issue.componentId === screen.layout.id)?.layout ??
    (issue.componentId ? findNode(document, issue.componentId) : null)
  if (!target) return null

  const address = issue.property ?? ""
  if (target.type === "text" || target.type === "countdown") {
    const role = target.accessibility.role
    if (address === "accessibility.role" && issue.code === "schema.const") {
      return role === "text" || role === "heading"
    }
    if (address === "accessibility.level") {
      if (role === "heading") return issue.code === "schema.additionalProperties"
      if (role === "text") return issue.code !== "schema.additionalProperties"
      return true
    }
    if (address === "accessibility.hidden") {
      return issue.code !== "schema.additionalProperties"
    }
    if (
      address === "accessibility.label" &&
      (issue.code === "schema.required" || issue.code === "schema.additionalProperties")
    ) {
      return true
    }
  }

  if (target.type === "image" || target.type === "icon") {
    const hidden = target.accessibility.hidden
    if (address === "accessibility.hidden" && issue.code === "schema.const") {
      return typeof hidden === "boolean"
    }
    if (address === "accessibility.label" || address.startsWith("accessibility.label.")) {
      if (hidden === true) {
        return !(issue.code === "schema.additionalProperties" && address === "accessibility.label")
      }
      if (hidden === false) {
        return issue.code === "schema.additionalProperties" && address === "accessibility.label"
      }
      return true
    }
  }

  return null
}

function isSchemaBranchNoise(document: MosaicDocument, issue: ValidationIssue) {
  if (!issue.code.startsWith("schema.")) return false
  const conditionalAccessibility = conditionalAccessibilityBranchDecision(document, issue)
  if (conditionalAccessibility !== null) return conditionalAccessibility
  const supportedAddress = isSupportedAddress(document, issue)
  if (issue.code === "schema.oneOf") return true
  if (issue.code === "schema.required") return !supportedAddress
  if (issue.code === "schema.additionalProperties") return supportedAddress
  return issue.code === "schema.const" && issue.property === "type" && supportedAddress
}

export function collectEditorValidation(document: MosaicDocument) {
  const editorIssues = validateEditorDocument(document)
  const displayEditorIssues = editorIssues.filter(
    (candidate) =>
      candidate.code !== "localization.missingKey" ||
      !editorIssues.some(
        (issue) =>
          issue.code === "localization.emptyValue" &&
          issue.componentId === candidate.componentId &&
          issue.property === candidate.property,
      ),
  )
  const canonical = validatePaywallDocument(document)
  if (canonical.ok) {
    return {
      issues: displayEditorIssues.map((issue) => resolveInspectorValidationIssue(document, issue)),
      contractValid: true,
    }
  }

  const additionalCanonicalIssues = canonical.diagnostics
    .map(canonicalIssue)
    .map((issue) => resolveInspectorValidationIssue(document, issue))
    .filter((issue) => !isSchemaBranchNoise(document, issue))
    .filter(
      (issue, index, issues) =>
        issues.findIndex(
          (candidate) =>
            candidate.code === issue.code && candidate.documentPath === issue.documentPath,
        ) === index,
    )
    .filter(
      (contractIssue) =>
        !editorIssues.some(
          (editorIssue) =>
            editorIssue.documentPath === contractIssue.documentPath ||
            contractIssue.documentPath.startsWith(`${editorIssue.documentPath}/`) ||
            (editorIssue.componentId === contractIssue.componentId &&
              editorIssue.property === contractIssue.property),
        ),
    )
  return {
    issues: [
      ...displayEditorIssues.map((issue) => resolveInspectorValidationIssue(document, issue)),
      ...additionalCanonicalIssues,
    ],
    contractValid: false,
  }
}

export function useEditorValidation() {
  const { document } = useEditorStore()
  const { issues, contractValid } = useMemo(
    () => (document ? collectEditorValidation(document) : { issues: [], contractValid: false }),
    [document],
  )
  const errors = issues.filter((entry) => entry.severity === "error")
  const warnings = issues.filter((entry) => entry.severity === "warning")

  return {
    issues,
    errors,
    warnings,
    isValid: !!document && contractValid && errors.length === 0,
  }
}
