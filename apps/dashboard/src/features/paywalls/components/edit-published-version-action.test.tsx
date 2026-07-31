import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { EditPublishedVersionAction } from "@/features/paywalls/components/edit-published-version-action"
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import { HostedPublishingAdapterProvider } from "@/features/publishing/api/hosted-publishing-adapter-provider"
import { createTestHostedPublishingAdapter } from "@/test/hosted-publishing-adapter"

describe("EditPublishedVersionAction", () => {
  it("creates a new hosted Draft before opening the editor", async () => {
    const draft = {
      document: EDITOR_TEMPLATES[0]!.document,
      environmentId: "env_staging",
      id: "draft_new",
      paywallId: "paywall_01",
      projectId: "project_01",
      revision: 1,
      updatedAt: "2026-07-22T12:00:00Z",
    }
    const createDraftFromVersion = vi.fn().mockResolvedValue(draft)
    const onDraftCreated = vi.fn()
    const adapter = createTestHostedPublishingAdapter({ createDraftFromVersion })

    render(
      <QueryClientProvider client={new QueryClient()}>
        <HostedPublishingAdapterProvider adapter={adapter}>
          <EditPublishedVersionAction
            environmentId="env_staging"
            onDraftCreated={onDraftCreated}
            paywallId="paywall_01"
            projectId="project_01"
            versionId="version_04"
          />
        </HostedPublishingAdapterProvider>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Edit as new Draft" }))

    await waitFor(() =>
      expect(createDraftFromVersion).toHaveBeenCalledWith({
        environmentId: "env_staging",
        paywallId: "paywall_01",
        projectId: "project_01",
        versionId: "version_04",
      }),
    )
    expect(onDraftCreated).toHaveBeenCalledWith(draft)
  })
})
