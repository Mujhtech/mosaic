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

    expect(collectEditorValidation(document)).toEqual({
      contractValid: false,
      issues: [
        expect.objectContaining({
          code: "localization.emptyValue",
          componentId: "headline",
          property: "value",
        }),
      ],
    })
  })
})
