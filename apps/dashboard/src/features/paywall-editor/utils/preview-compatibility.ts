import type { MosaicDocument, PreviewClient } from "@/features/paywall-editor/types/editor"
import { PREVIEW_PROTOCOL_VERSION } from "@/features/paywall-editor/schema/preview-message"
import { requiredPreviewCapabilities } from "@/lib/mosaic-protocol"

function supportsCapability(
  capabilities: readonly { name: string; version: string }[],
  requirement: { name: string; version: string },
) {
  return capabilities.some(
    (capability) =>
      capability.name === requirement.name && capability.version === requirement.version,
  )
}

export function compatibilityWarnings(document: MosaicDocument, clients: readonly PreviewClient[]) {
  const documentBytes = new TextEncoder().encode(JSON.stringify(document)).byteLength
  return clients.flatMap((client) => {
    const warnings: string[] = []
    if (!client.supportedSchemaVersions.includes(document.schemaVersion)) {
      warnings.push(`${client.displayName} does not report support for this paywall format.`)
    }
    if (client.maxDocumentBytes && documentBytes > client.maxDocumentBytes) {
      warnings.push(
        `${client.displayName} supports documents up to ${client.maxDocumentBytes.toLocaleString()} bytes; this draft is ${documentBytes.toLocaleString()} bytes. Reduce its size before previewing.`,
      )
    }
    const missingDocumentCapabilities = document.compatibility.requiredCapabilities.filter(
      (required) => !supportsCapability(client.supportedCapabilities, required),
    )
    if (missingDocumentCapabilities.length > 0) {
      warnings.push(
        `${client.displayName} cannot show every part of this paywall yet. Update the example app or inspect the affected content; its last working preview remains visible.`,
      )
    }
    const missingPreviewCapabilities = requiredPreviewCapabilities.filter(
      (name) =>
        !supportsCapability(client.previewCapabilities, {
          name,
          version: PREVIEW_PROTOCOL_VERSION,
        }),
    )
    if (missingPreviewCapabilities.length > 0) {
      warnings.push(
        `${client.displayName} cannot receive every local preview update yet. Update or reconnect the example app before relying on live preview.`,
      )
    }
    return warnings
  })
}
