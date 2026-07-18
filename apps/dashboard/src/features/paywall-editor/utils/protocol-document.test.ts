import { describe, expect, it } from "vitest"

import navigationOnlyFixture from "../../../../../../protocol/fixtures/v0.2/navigation-only.json"
import type { MosaicDocument } from "@/features/paywall-editor/types/editor"
import { synchronizeProtocolMetadata } from "@/features/paywall-editor/utils/protocol-document"
import { validatePaywallDocument } from "@/lib/mosaic-protocol"

describe("Protocol metadata synchronization", () => {
  it("does not add normalized commerce outcomes to navigation-only actions", () => {
    const source = navigationOnlyFixture as unknown as MosaicDocument
    const synchronized = synchronizeProtocolMetadata(source)
    const capabilities = synchronized.compatibility.requiredCapabilities.map(({ name }) => name)

    expect(capabilities).toContain("action.navigateTo")
    expect(capabilities).toContain("action.navigateBack")
    expect(capabilities).toContain("action.openExternalUrl")
    expect(capabilities).not.toContain("outcome.normalized")
    expect(validatePaywallDocument(synchronized).ok).toBe(true)
  })
})
