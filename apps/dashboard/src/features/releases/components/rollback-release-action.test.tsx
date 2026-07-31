import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { HostedPublishingAdapterProvider } from "@/features/publishing/api/hosted-publishing-adapter-provider"
import { RollbackReleaseAction } from "@/features/releases/components/rollback-release-action"
import { createTestHostedPublishingAdapter } from "@/test/hosted-publishing-adapter"

describe("RollbackReleaseAction", () => {
  it("explains and creates a new immutable Release without rewriting history", async () => {
    const rollbackRelease = vi.fn().mockResolvedValue({
      environmentId: "env_staging",
      id: "release_08",
      isCurrent: true,
      number: 8,
      publishedAt: "2026-07-22T12:00:00Z",
      rollbackSourceNumber: 4,
    })
    const adapter = createTestHostedPublishingAdapter({ rollbackRelease })

    render(
      <QueryClientProvider client={new QueryClient()}>
        <HostedPublishingAdapterProvider adapter={adapter}>
          <RollbackReleaseAction
            environmentId="env_staging"
            projectId="project_01"
            release={{
              id: "release_04",
              isCurrent: false,
              number: 4,
              publishedAt: "2026-07-20T12:00:00Z",
            }}
          />
        </HostedPublishingAdapterProvider>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Roll back to Release 4" }))
    expect(screen.getByText(/new immutable Release/)).toBeVisible()
    expect(screen.getByText(/history will not be rewritten/)).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: "Confirm new rollback Release" }))

    await waitFor(() =>
      expect(rollbackRelease).toHaveBeenCalledWith({
        environmentId: "env_staging",
        projectId: "project_01",
        releaseId: "release_04",
      }),
    )
    const confirmation = await screen.findByRole("status")
    expect(confirmation).toHaveTextContent(
      "Release 8 is now current. Release 4 remains in history.",
    )
    // The confirm button unmounts on success. Without an explicit focus move,
    // keyboard focus falls back to document.body and the operator loses their
    // place in the release list.
    await waitFor(() => expect(confirmation).toHaveFocus())
  })
})
