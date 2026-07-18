import { describe, expect, it } from "vitest"

import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import { PREVIEW_PROTOCOL_VERSION } from "@/features/paywall-editor/schema/preview-message"
import type { PreviewClient } from "@/features/paywall-editor/types/editor"
import { compatibilityWarnings } from "@/features/paywall-editor/utils/preview-compatibility"
import { requiredPreviewCapabilities } from "@/lib/mosaic-protocol"

const document = EDITOR_TEMPLATES[0]!.document

function compatibleClient(): PreviewClient {
  return {
    clientId: "client_flutter",
    sessionId: "session_local_01",
    platform: "flutter",
    displayName: "Flutter preview",
    renderer: { id: "mosaic.flutter", version: "0.1.0" },
    application: { id: "example.app", displayName: "Example", version: "0.1.0" },
    device: { displayName: "Device", systemName: "OS", systemVersion: "1" },
    supportedSchemaVersions: [document.schemaVersion],
    supportedCapabilities: document.compatibility.requiredCapabilities.map((capability) => ({
      ...capability,
    })),
    previewCapabilities: requiredPreviewCapabilities.map((name) => ({
      name,
      version: PREVIEW_PROTOCOL_VERSION,
    })),
    lastSeenAt: "2026-07-17T08:00:00Z",
  }
}

describe("preview compatibility", () => {
  it("requires exact schema and capability versions before presenting compatibility", () => {
    expect(compatibilityWarnings(document, [compatibleClient()])).toEqual([])

    const wrongDocumentVersion = compatibleClient()
    wrongDocumentVersion.supportedCapabilities[0] = {
      ...wrongDocumentVersion.supportedCapabilities[0]!,
      version: "0.1",
    }
    expect(compatibilityWarnings(document, [wrongDocumentVersion])).toContainEqual(
      expect.stringContaining("cannot show every part"),
    )

    const wrongPreviewVersion = compatibleClient()
    wrongPreviewVersion.previewCapabilities[0] = {
      ...wrongPreviewVersion.previewCapabilities[0]!,
      version: "0.1",
    }
    expect(compatibilityWarnings(document, [wrongPreviewVersion])).toContainEqual(
      expect.stringContaining("cannot receive every local preview update"),
    )

    const wrongSchema = compatibleClient()
    wrongSchema.supportedSchemaVersions = ["0.1"]
    expect(compatibilityWarnings(document, [wrongSchema])).toContainEqual(
      expect.stringContaining("does not report support"),
    )
  })
})
