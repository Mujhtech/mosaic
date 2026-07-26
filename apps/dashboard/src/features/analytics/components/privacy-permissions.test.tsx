import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { AnalyticsAdapter } from "../api/analytics-adapter"
import { DataPrivacyPanel, JobStatus } from "./data-privacy-panel"

const scope = {
  organizationId: "org_01",
  projectId: "project_01",
  environmentId: "environment_01",
}

describe("privacy permissions and recovery", () => {
  it("does not expose identity search controls to members", async () => {
    const adapter = {
      getCollectionSettings: vi.fn(async () => ({
        enabled: false,
        rawRetentionDays: 180,
        aggregateRetentionMonths: 24,
        auditRetentionMonths: 24,
        exportExpiryDays: 7,
      })),
    } as unknown as AnalyticsAdapter
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <DataPrivacyPanel adapter={adapter} role="member" scope={scope} />
      </QueryClientProvider>,
    )
    expect(await screen.findByText(/Only organization owners/)).toBeInTheDocument()
    expect(screen.queryByLabelText("Opaque identity")).not.toBeInTheDocument()
  })

  it("offers an explicit recovery action for a failed asynchronous job", () => {
    const onRetry = vi.fn()
    render(
      <JobStatus
        job={{
          id: "job_01",
          type: "identity_deletion",
          state: "failed",
          createdAt: "2026-07-26T12:00:00.000Z",
          safeErrorCode: "storage_temporarily_unavailable",
        }}
        onDownload={() => undefined}
        onRetry={onRetry}
      />,
    )
    screen.getByRole("button", { name: "Start recovery" }).click()
    expect(onRetry).toHaveBeenCalledOnce()
    expect(screen.getByRole("alert")).toHaveTextContent("storage_temporarily_unavailable")
  })
})
