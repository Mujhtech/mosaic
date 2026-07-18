import { describe, expect, it } from "vitest"

import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import { collectEditorValidation } from "@/features/paywall-editor/hooks/use-editor-validation"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import { findNode } from "@/features/paywall-editor/utils/document-tree"

describe("editor validation merge", () => {
  it("keeps one actionable error instead of oneOf branch noise for an empty headline", () => {
    const template = EDITOR_TEMPLATES.find((entry) => entry.id === "focused")
    if (!template) throw new Error("Missing focused template")
    const document = cloneValue(template.document)
    const headline = findNode(document, "headline")
    if (!headline || headline.type !== "text") throw new Error("Missing headline")
    headline.value.default = ""
    document.localization.locales.en!.strings[headline.value.localizationKey] = ""

    const result = collectEditorValidation(document)
    expect(result.contractValid).toBe(false)
    expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([
      expect.objectContaining({
        code: "localization.emptyValue",
        componentId: "headline",
        property: "value",
      }),
    ])
  })

  it("maps canonical localized defaults and keys to their exact inspector addresses", () => {
    const mismatch = templateDocument("focused")
    const mismatchHeadline = findNode(mismatch, "headline")
    if (!mismatchHeadline || mismatchHeadline.type !== "text") throw new Error("Missing headline")
    mismatchHeadline.value.default = "A default that does not match the catalog"

    expect(collectEditorValidation(mismatch).issues).toContainEqual(
      expect.objectContaining({
        componentId: "headline",
        documentPath: expect.stringMatching(/\/value\/default$/),
        property: "value",
      }),
    )

    const invalidKey = templateDocument("focused")
    const invalidKeyHeadline = findNode(invalidKey, "headline")
    if (!invalidKeyHeadline || invalidKeyHeadline.type !== "text") {
      throw new Error("Missing headline")
    }
    invalidKeyHeadline.value.localizationKey = "InvalidKey"

    expect(collectEditorValidation(invalidKey).issues).toContainEqual(
      expect.objectContaining({
        code: "schema.pattern",
        componentId: "headline",
        documentPath: expect.stringMatching(/\/value\/localizationKey$/),
        property: "value.localizationKey",
      }),
    )
  })

  it("maps canonical nested fields and feature item IDs to stable inspector addresses", () => {
    const invalidPadding = templateDocument("focused")
    invalidPadding.screens[0]!.layout.content.padding.top = -1
    expect(collectEditorValidation(invalidPadding).issues).toContainEqual(
      expect.objectContaining({
        componentId: "paywall-content",
        property: "padding.top",
      }),
    )

    const invalidHeading = templateDocument("focused")
    const heading = findNode(invalidHeading, "headline")
    if (!heading || heading.type !== "text" || heading.accessibility.role !== "heading") {
      throw new Error("Missing heading")
    }
    heading.accessibility.level = 7
    expect(collectEditorValidation(invalidHeading).issues).toContainEqual(
      expect.objectContaining({
        componentId: "headline",
        property: "accessibility.level",
      }),
    )

    const invalidAction = templateDocument("focused")
    const purchase = findNode(invalidAction, "purchase")
    if (!purchase || purchase.type !== "button") throw new Error("Missing purchase button")
    ;(purchase.action as { type: string }).type = "invalid"
    expect(collectEditorValidation(invalidAction).issues).toContainEqual(
      expect.objectContaining({
        code: "schema.const",
        componentId: "purchase",
        property: "action.type",
      }),
    )

    const invalidItem = templateDocument("benefits")
    const features = findNode(invalidItem, "features")
    if (!features || features.type !== "featureList" || !features.items[0]) {
      throw new Error("Missing feature list")
    }
    features.items[0].id = "InvalidItem"
    expect(collectEditorValidation(invalidItem).issues).toContainEqual(
      expect.objectContaining({
        componentId: "features",
        property: "items.InvalidItem.id",
      }),
    )
  })

  it("keeps only diagnostics from the matching text-accessibility branch", () => {
    const invalidHeading = templateDocument("focused")
    const heading = findNode(invalidHeading, "headline")
    if (!heading || heading.type !== "text" || heading.accessibility.role !== "heading") {
      throw new Error("Missing heading")
    }
    heading.accessibility.level = 7

    expect(
      collectEditorValidation(invalidHeading).issues.filter(
        (issue) => issue.componentId === "headline",
      ),
    ).toEqual([
      expect.objectContaining({
        code: "schema.maximum",
        property: "accessibility.level",
      }),
    ])

    const textWithLevel = templateDocument("focused")
    const text = findNode(textWithLevel, "headline")
    if (!text || text.type !== "text") throw new Error("Missing text")
    ;(text as unknown as { accessibility: { role: "text"; level: number } }).accessibility = {
      role: "text",
      level: 2,
    }

    expect(
      collectEditorValidation(textWithLevel).issues.filter(
        (issue) => issue.componentId === "headline",
      ),
    ).toEqual([
      expect.objectContaining({
        code: "schema.additionalProperties",
        property: "accessibility.level",
      }),
    ])
  })

  it("maps feature-list editor paths to the exact stable text address", () => {
    const invalidFeature = templateDocument("benefits")
    const features = findNode(invalidFeature, "features")
    if (!features || features.type !== "featureList" || !features.items[0]) {
      throw new Error("Missing feature list")
    }
    const item = features.items[0]
    item.text.default = ""
    invalidFeature.localization.locales.en!.strings[item.text.localizationKey] = ""

    expect(collectEditorValidation(invalidFeature).issues).toContainEqual(
      expect.objectContaining({
        code: "localization.emptyValue",
        componentId: "features",
        property: `items.${item.id}.text`,
      }),
    )
  })
})

function templateDocument(id: "focused" | "benefits") {
  const template = EDITOR_TEMPLATES.find((entry) => entry.id === id)
  if (!template) throw new Error(`Missing ${id} template`)
  return cloneValue(template.document)
}
