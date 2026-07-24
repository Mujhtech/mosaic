import { describe, expect, it, vi } from "vitest"

import type { HostedPublishingAdapter } from "@/features/publishing/api/hosted-publishing-adapter"
import { publishValidationQueryOptions } from "@/features/publishing/queries/publish-validation-query"

describe("Publish validation query", () => {
  it("always revalidates when Publish review remounts after a recovery workflow", () => {
    const adapter = {
      validateDraftForPublish: vi.fn(),
    } as unknown as HostedPublishingAdapter

    const options = publishValidationQueryOptions(
      {
        draftId: "draft_01",
        environmentId: "env_staging",
        expectedRevision: 4,
        paywallId: "paywall_01",
        projectId: "project_01",
      },
      adapter,
    )

    expect(options.refetchOnMount).toBe("always")
  })
})
