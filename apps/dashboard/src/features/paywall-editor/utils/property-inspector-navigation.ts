import type {
  MosaicDocument,
  ProtocolNode,
  Screen,
  ValidationIssue,
} from "@/features/paywall-editor/types/editor"
import { findNode, flattenDocument } from "@/features/paywall-editor/utils/document-tree"

type InspectorTarget = Screen["layout"] | ProtocolNode

function pointerSegments(path: string) {
  if (!path.startsWith("/")) return []
  return path
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
}

function addressForTarget(target: InspectorTarget, segments: readonly string[], fallback: string) {
  if (segments.length === 0) return fallback

  if (
    target.type === "featureList" &&
    segments.length === 1 &&
    /^items\.[^.]+$/.test(segments[0] ?? "")
  ) {
    return fallback
  }

  if (target.type === "featureList" && segments[0] === "items") {
    const itemIndex = Number(segments[1])
    const item = Number.isInteger(itemIndex) ? target.items[itemIndex] : undefined
    if (!item) return "items"
    if (segments[2] === "id") return `items.${item.id}.id`
    if (segments[2] === "text") {
      return segments[3] === "localizationKey"
        ? `items.${item.id}.text.localizationKey`
        : `items.${item.id}.text`
    }
    return "items"
  }

  if (segments[0] === "cards") return "cards"
  if (segments[0] === "children") return "children"

  if (segments.length === 1 && segments[0] === "accessibility") {
    if (target.type === "text" || target.type === "countdown") {
      return "accessibility.role"
    }
    if (target.type === "image" || target.type === "icon") return "accessibility.hidden"
    return "accessibility.label"
  }
  if (segments.length === 1 && segments[0] === "padding") return "padding.top"
  if (segments.length === 1 && segments[0] === "outerInsets") return "outerInsets.top"
  if (segments.length === 1 && segments[0] === "sizing") return "sizing.width"
  if (segments.length === 1 && segments[0] === "typography") return "typography.style"
  if (segments.length === 1 && segments[0] === "appearance") return "appearance.opacity"
  if (segments.length === 1 && segments[0] === "visibility") return "visibility.mode"
  if (segments[0] === "styles" && segments.length <= 2) {
    return `styles.${segments[1] ?? "default"}.background`
  }
  if (segments[0] === "styles" && segments[2] === "border" && segments.length === 3) {
    return `styles.${segments[1]}.border.color`
  }
  if (segments.length === 1 && segments[0] === "unavailableFallback") {
    return "unavailableFallback.message"
  }
  if (segments.length === 1 && segments[0] === "action") {
    return target.type === "button" && target.action.type === "purchase"
      ? "action.productSelectorId"
      : "action.type"
  }

  const addressSegments = [...segments]
  if (addressSegments.at(-1) === "default") addressSegments.pop()
  return addressSegments.join(".") || fallback
}

function inspectorTargetForPath(document: MosaicDocument, documentPath: string) {
  const targets: Array<{ path: string; target: InspectorTarget }> = [
    ...document.screens.flatMap((screen, index) => [
      { path: `/screens/${index}/layout`, target: screen.layout },
      { path: `/screens/${index}/layout/content`, target: screen.layout.content },
    ]),
    ...flattenDocument(document).map((entry) => ({ path: entry.documentPath, target: entry.node })),
  ]
  return targets
    .filter(({ path }) => documentPath === path || documentPath.startsWith(`${path}/`))
    .sort((left, right) => right.path.length - left.path.length)[0]
}

function stableAddress(value: string) {
  return value.replaceAll(/[^a-zA-Z0-9_-]/g, "-")
}

export function getInspectorFieldId(componentId: string, propertyAddress: string) {
  return `property-${stableAddress(componentId)}-${stableAddress(propertyAddress)}`
}

export function validationPropertyAddress(issue: Pick<ValidationIssue, "property">) {
  const property = issue.property ?? ""
  if (property === "accessibility") return "accessibility.label"
  if (property === "productSelectorId") return "action.productSelectorId"
  if (property === "outerInsets") return "outerInsets.top"
  if (property === "sizing") return "sizing.width"
  if (property === "typography") return "typography.style"
  if (property === "appearance") return "appearance.opacity"
  if (property === "visibility") return "visibility.mode"
  if (property === "styles") return "styles.default.background"
  if (/^items\.[^.]+$/.test(property)) return `${property}.text`
  return property
}

export function resolveInspectorValidationIssue(
  document: MosaicDocument,
  issue: ValidationIssue,
): ValidationIssue {
  const matched = inspectorTargetForPath(document, issue.documentPath)
  if (matched) {
    const relativePath = issue.documentPath.slice(matched.path.length)
    const fallback = validationPropertyAddress(issue)
    return {
      ...issue,
      componentId: matched.target.id,
      property: addressForTarget(matched.target, pointerSegments(relativePath), fallback),
    }
  }

  const existingTarget =
    document.screens.find((screen) => issue.componentId === screen.layout.id)?.layout ??
    findNode(document, issue.componentId ?? null)
  if (!existingTarget) return issue
  return {
    ...issue,
    componentId: existingTarget.id,
    property: validationPropertyAddress(issue),
  }
}

export function getValidationIssueFieldId(issue: ValidationIssue) {
  return issue.componentId
    ? getInspectorFieldId(issue.componentId, validationPropertyAddress(issue))
    : null
}

export function focusInspectorValidationIssue(issue: ValidationIssue) {
  if (typeof window === "undefined") return false
  const fieldId = getValidationIssueFieldId(issue)
  const target = fieldId ? window.document.getElementById(fieldId) : null
  if (!target) return false
  const section = target.closest("details")
  if (section instanceof HTMLDetailsElement) section.open = true
  target.scrollIntoView?.({ block: "center" })
  target.focus()
  return true
}

export function focusDocumentValidationIssue(issue: ValidationIssue) {
  if (typeof window === "undefined") return false
  const fieldId =
    issue.property === "defaultLocale"
      ? "document-default-locale"
      : issue.property === "fallbackLocale"
        ? "document-fallback-locale"
        : null
  const target = fieldId ? window.document.getElementById(fieldId) : null
  if (!target) return false
  target.scrollIntoView?.({ block: "center" })
  target.focus()
  return true
}
