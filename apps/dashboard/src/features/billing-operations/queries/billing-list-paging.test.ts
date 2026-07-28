import { beforeEach, describe, expect, it, vi } from "vitest"

const listBillingQuarantine = vi.fn()
const listReconciliationRuns = vi.fn()

vi.mock("@/generated/api", () => ({
  getQuarantineRecord: vi.fn(),
  listBillingQuarantine,
  listReconciliationRuns,
}))

const { quarantineRecordsQueryOptions } =
  await import("@/features/billing-operations/queries/quarantine-queries")
const { reconciliationRunsQueryOptions } =
  await import("@/features/billing-operations/queries/reconciliation-queries")

/**
 * Risk: a page of records is presented as the total.
 *
 * Both lists used to fetch a fixed page, drop the cursor, and render
 * `items.length` as the count. An Environment with 60 open quarantine records
 * showed 50 and said "50 quarantine record(s)" — on the surface whose entire
 * job is "security-relevant inputs that need attention". Silent truncation
 * reported as an exact count is a correctness problem, not a paging nicety,
 * and there was no way to reach the rest.
 */
describe("billing list paging", () => {
  beforeEach(() => {
    listBillingQuarantine.mockReset()
    listReconciliationRuns.mockReset()
  })

  it("returns the quarantine cursor instead of swallowing it", async () => {
    listBillingQuarantine.mockResolvedValue({
      data: { data: { items: [{ id: "quar_1" }], nextCursor: "cursor_page_2" } },
    })

    const options = quarantineRecordsQueryOptions("proj_1", "env_1", { status: "open" })
    const page = await options.queryFn!({ signal: new AbortController().signal } as never)

    expect(page.items).toHaveLength(1)
    expect(page.nextCursor).toBe("cursor_page_2")
  })

  it("forwards a quarantine cursor and keeps each page in its own cache entry", async () => {
    listBillingQuarantine.mockResolvedValue({ data: { data: { items: [] } } })

    const options = quarantineRecordsQueryOptions("proj_1", "env_1", {
      cursor: "cursor_page_2",
      status: "open",
    })
    await options.queryFn!({ signal: new AbortController().signal } as never)

    const [request] = listBillingQuarantine.mock.calls[0] ?? []
    expect(request.query.cursor).toBe("cursor_page_2")
    expect(request.query.status).toBe("open")

    expect(options.queryKey).not.toEqual(
      quarantineRecordsQueryOptions("proj_1", "env_1", { status: "open" }).queryKey,
    )
  })

  it("returns the reconciliation cursor and forwards it on the next page", async () => {
    listReconciliationRuns.mockResolvedValue({
      data: { data: { items: [{ id: "run_1" }], nextCursor: "cursor_older" } },
    })

    const first = reconciliationRunsQueryOptions("proj_1", "env_1")
    const firstPage = await first.queryFn!({ signal: new AbortController().signal } as never)
    expect(firstPage.nextCursor).toBe("cursor_older")
    // The first page must not send an empty cursor the API would reject.
    expect(listReconciliationRuns.mock.calls[0]?.[0].query.cursor).toBeUndefined()

    const second = reconciliationRunsQueryOptions("proj_1", "env_1", "cursor_older")
    await second.queryFn!({ signal: new AbortController().signal } as never)
    expect(listReconciliationRuns.mock.calls[1]?.[0].query.cursor).toBe("cursor_older")
    expect(second.queryKey).not.toEqual(first.queryKey)
  })
})
