import { describe, expect, it } from "vitest"

import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import { validateEditorDocument } from "@/features/paywall-editor/schema/editor-validation"
import { cloneValue } from "@/features/paywall-editor/utils/clone"

describe("editor validation", () => {
  it("reports the exact recursive JSON pointer for a nested component", () => {
    const template = EDITOR_TEMPLATES.find((entry) => entry.id === "focused")
    if (!template) throw new Error("Missing focused template")
    const document = cloneValue(template.document)
    const headline = document.layout.content.children.find((node) => node.id === "headline")
    if (!headline) throw new Error("Missing headline")

    headline.id = "Invalid headline"
    document.layout.content.children = document.layout.content.children.filter(
      (node) => node !== headline,
    )
    document.layout.content.children.unshift({
      type: "verticalStack",
      id: "nested-stack",
      spacing: 8,
      padding: { top: 0, start: 0, bottom: 0, end: 0 },
      horizontalAlignment: "stretch",
      children: [headline],
    })

    expect(
      validateEditorDocument(document).find((issue) => issue.code === "component.invalidId"),
    ).toMatchObject({
      componentId: "Invalid headline",
      property: "id",
      documentPath: "/layout/content/children/0/children/0/id",
    })
  })
})
