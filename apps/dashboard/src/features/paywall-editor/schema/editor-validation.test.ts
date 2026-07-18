import { describe, expect, it } from "vitest"

import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import { collectEditorValidation } from "@/features/paywall-editor/hooks/use-editor-validation"
import { validateEditorDocument } from "@/features/paywall-editor/schema/editor-validation"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import { findNode } from "@/features/paywall-editor/utils/document-tree"

describe("editor validation", () => {
  it("reports the exact recursive JSON pointer for a nested component", () => {
    const template = EDITOR_TEMPLATES.find((entry) => entry.id === "focused")
    if (!template) throw new Error("Missing focused template")
    const document = cloneValue(template.document)
    const headline = document.screens[0]!.layout.content.children.find(
      (node) => node.id === "headline",
    )
    if (!headline) throw new Error("Missing headline")

    headline.id = "Invalid headline"
    document.screens[0]!.layout.content.children =
      document.screens[0]!.layout.content.children.filter((node) => node !== headline)
    document.screens[0]!.layout.content.children.unshift({
      type: "stack",
      id: "nested-stack",
      direction: "vertical",
      gap: 8,
      padding: { top: 0, start: 0, bottom: 0, end: 0 },
      mainAxisDistribution: "start",
      crossAxisAlignment: "stretch",
      children: [headline],
    })

    expect(
      validateEditorDocument(document).find((issue) => issue.code === "component.invalidId"),
    ).toMatchObject({
      componentId: "Invalid headline",
      property: "id",
      documentPath: "/screens/0/layout/content/children/0/children/0/id",
    })
  })

  it("warns without blocking for indistinguishable states, contrast, truncation, and overflow", () => {
    const template = EDITOR_TEMPLATES.find((entry) => entry.id === "focused")
    if (!template) throw new Error("Missing focused template")
    const document = cloneValue(template.document)
    const card = findNode(document, "monthly-card")
    const name = findNode(document, "monthly-name")
    const purchase = findNode(document, "purchase")
    if (
      card?.type !== "productCard" ||
      name?.type !== "text" ||
      purchase?.type !== "button" ||
      purchase.children[0]?.type !== "text"
    ) {
      throw new Error("Missing warning fixtures")
    }

    document.screens[0]!.layout.background = { type: "color", value: "#FFFFFFFF" }
    card.styles.default.background = { type: "color", value: "#FFFFFFFF" }
    card.styles.default.border = { color: "#FDFDFDFF", width: 1 }
    card.styles.default.opacity = 0.5
    card.styles.selected = {}
    name.typography.color = "#FFFFFF80"
    name.typography.maxLines = 1
    name.typography.overflow = "ellipsis"
    name.sizing = { width: { mode: "fixed", value: 120 }, height: "fit" }
    purchase.direction = "horizontal"
    purchase.sizing = { width: { mode: "fixed", value: 100 }, height: "fit" }

    const warnings = validateEditorDocument(document).filter(
      (issue) => issue.severity === "warning",
    )
    expect(warnings.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "appearance.indistinguishableProductStates",
        "appearance.lowContrast",
        "appearance.lowBoundaryContrast",
        "appearance.contrastCannotVerify",
        "typography.truncationRisk",
        "layout.horizontalOverflow",
      ]),
    )
    expect(warnings).toContainEqual(
      expect.objectContaining({
        componentId: "monthly-card",
        property: "styles.selected",
      }),
    )

    const merged = collectEditorValidation(document)
    expect(merged.contractValid).toBe(true)
    expect(merged.issues.some((issue) => issue.severity === "error")).toBe(false)
  })

  it("warns symmetrically when authored Fill is on an unbounded axis", () => {
    const document = cloneValue(EDITOR_TEMPLATES[0]!.document)
    const card = findNode(document, "monthly-card")
    const headline = findNode(document, "headline")
    if (!card || card.type !== "productCard" || !headline || headline.type !== "text") {
      throw new Error("Missing sizing fixtures")
    }

    card.sizing = { width: "fill", height: "fit" }
    headline.sizing = { width: "fill", height: "fill" }

    const fillWarnings = validateEditorDocument(document).filter(
      (issue) => issue.code === "layout.unboundedFill",
    )
    expect(fillWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ componentId: "monthly-card", property: "sizing.width" }),
        expect.objectContaining({ componentId: "headline", property: "sizing.height" }),
      ]),
    )
    expect(fillWarnings).not.toContainEqual(
      expect.objectContaining({ componentId: "headline", property: "sizing.width" }),
    )
  })
})
