import { describe, expect, it } from "vitest"

import { DEFAULT_STUDIO_WORKSPACE_PREFERENCES } from "@/features/paywall-editor/constants/studio-workspace"
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import {
  reconcilePreviewLocale,
  resolveRestoredPreviewContext,
} from "@/features/paywall-editor/hooks/use-workspace-preview-context"
import { cloneValue } from "@/features/paywall-editor/utils/clone"

describe("workspace preview context precedence", () => {
  it("keeps a valid persisted workspace locale and text scale authoritative", () => {
    const document = EDITOR_TEMPLATES[0]!.document
    expect(
      resolveRestoredPreviewContext({
        document,
        localProjectPreview: { locale: "de", textScale: 0.8 },
        workspaceCanvas: {
          ...DEFAULT_STUDIO_WORKSPACE_PREFERENCES.canvas,
          locale: "ar",
          textScale: 1.5,
        },
        workspaceSource: "persisted",
      }),
    ).toEqual({ locale: "ar", textScale: 1.5 })
  })

  it("uses local-project compatibility preview values only when workspace storage is missing", () => {
    const document = EDITOR_TEMPLATES[0]!.document
    expect(
      resolveRestoredPreviewContext({
        document,
        localProjectPreview: { locale: "de", textScale: 0.8 },
        workspaceCanvas: DEFAULT_STUDIO_WORKSPACE_PREFERENCES.canvas,
        workspaceSource: "default",
      }),
    ).toEqual({ locale: "de", textScale: 0.8 })
  })

  it("reconciles an unavailable persisted locale without discarding its text scale", () => {
    const document = EDITOR_TEMPLATES[0]!.document
    expect(
      resolveRestoredPreviewContext({
        document,
        localProjectPreview: { locale: "de", textScale: 0.8 },
        workspaceCanvas: {
          ...DEFAULT_STUDIO_WORKSPACE_PREFERENCES.canvas,
          locale: "fr",
          textScale: 1.25,
        },
        workspaceSource: "persisted",
      }),
    ).toEqual({ locale: "en", textScale: 1.25 })

    const missingDefault = cloneValue(document)
    delete missingDefault.localization.locales.en
    expect(reconcilePreviewLocale(missingDefault, "fr")).toBe("de")
  })
})
