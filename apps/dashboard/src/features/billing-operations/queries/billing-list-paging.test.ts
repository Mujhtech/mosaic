import { beforeEach, describe, expect, it, vi } from "vitest"

const listBillingQuarantine = vi.fn()
const listReconciliationRuns = vi.fn()
const listBillingCustomerSubscriptions = vi.fn()
const listBillingSubscriptionTimeline = vi.fn()

vi.mock("@/generated/api", () => ({
  getBillingCustomerEntitlementSnapshot: vi.fn(),
  getBillingSubscription: vi.fn(),
  getOperatorBillingCustomer: vi.fn(),
  getQuarantineRecord: vi.fn(),
  listBillingCustomers: vi.fn(),
  listBillingCustomerSubscriptions,
  listBillingQuarantine,
  listBillingSubscriptionTimeline,
  listReconciliationRuns,
}))

const { quarantineRecordsQueryOptions } =
  await import("@/features/billing-operations/queries/quarantine-queries")
const { reconciliationRunsQueryOptions } =
  await import("@/features/billing-operations/queries/reconciliation-queries")
const { customerSubscriptionsQueryOptions, subscriptionTimelineQueryOptions } =
  await import("@/features/billing-customers/queries/customer-queries")

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

  /**
   * Same failure, worse copy. The subscription timeline requested a fixed page
   * and discarded the cursor while the panel told the operator entries are
   * never trimmed. A subscription with two years of renewals therefore showed
   * one page and claimed it was the history — the derivation an operator uses
   * to argue with a customer, silently incomplete and asserted as complete.
   */
  it("returns the timeline cursor and forwards it on the next page", async () => {
    listBillingSubscriptionTimeline.mockResolvedValue({
      data: { data: { items: [{ timelineEntryId: "tl_1" }], nextCursor: "cursor_older" } },
    })

    const first = subscriptionTimelineQueryOptions("proj_1", "env_1", "sub_1")
    const firstPage = await first.queryFn!({ signal: new AbortController().signal } as never)
    expect(firstPage.items).toHaveLength(1)
    expect(firstPage.nextCursor).toBe("cursor_older")
    expect(listBillingSubscriptionTimeline.mock.calls[0]?.[0].query.cursor).toBeUndefined()

    const second = subscriptionTimelineQueryOptions("proj_1", "env_1", "sub_1", "cursor_older")
    await second.queryFn!({ signal: new AbortController().signal } as never)
    expect(listBillingSubscriptionTimeline.mock.calls[1]?.[0].query.cursor).toBe("cursor_older")
    expect(second.queryKey).not.toEqual(first.queryKey)
  })

  it("pages the customer subscription list rather than returning a bare array", async () => {
    listBillingCustomerSubscriptions.mockResolvedValue({
      data: { data: { items: [{ subscriptionInstanceId: "sub_1" }], nextCursor: "cursor_older" } },
    })

    const options = customerSubscriptionsQueryOptions("proj_1", "env_1", "cus_1", "cursor_older")
    const page = await options.queryFn!({ signal: new AbortController().signal } as never)

    expect(page.nextCursor).toBe("cursor_older")
    expect(listBillingCustomerSubscriptions.mock.calls[0]?.[0].query.cursor).toBe("cursor_older")
    expect(options.queryKey).not.toEqual(
      customerSubscriptionsQueryOptions("proj_1", "env_1", "cus_1").queryKey,
    )
  })
})
