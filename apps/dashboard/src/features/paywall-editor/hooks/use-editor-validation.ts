import { useMemo } from "react"

import { validateEditorDocument } from "@/features/paywall-editor/schema/editor-validation"
import { useEditorStore } from "@/features/paywall-editor/stores/editor-store-context"
import type { MosaicDocument, ValidationIssue } from "@/features/paywall-editor/types/editor"
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
  if (canonical.ok) return { issues: displayEditorIssues, contractValid: true }

  const additionalCanonicalIssues = canonical.diagnostics
    .map(canonicalIssue)
    .filter(
      (contractIssue) =>
        !editorIssues.some(
          (editorIssue) =>
            editorIssue.documentPath === contractIssue.documentPath ||
            (editorIssue.componentId !== undefined &&
              editorIssue.componentId === contractIssue.componentId),
        ),
    )
  return {
    issues: [...displayEditorIssues, ...additionalCanonicalIssues],
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
