import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AnalyticsQueryResult } from "@/features/analytics/components/query-result";
import { ApiError } from "@/lib/api/errors";

describe("analytics query result", () => {
  it("never prints the server's own message, and shows the correlation ID instead", () => {
    // A 500's message can carry query text, driver detail, or internal
    // identifiers. Mosaic-owned copy plus the request ID is the documented
    // support path, and this surface previously rendered `error.message`.
    render(
      <AnalyticsQueryResult
        error={
          new ApiError(
            'pq: relation "analytics_events_2026_08" does not exist',
            {
              code: "internal_error",
              correlationId: "req_9f21",
              retryable: true,
              status: 500,
            }
          )
        }
        isPending={false}
        onRetry={() => {
          /* asserted by presence, not by invocation */
        }}
      >
        <p>loaded</p>
      </AnalyticsQueryResult>
    );

    expect(screen.queryByText(/relation "analytics_events/)).toBeNull();
    expect(
      screen.getByText(/The Mosaic API reported an unexpected error/)
    ).toBeInTheDocument();
    expect(screen.getByText("req_9f21")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again" })
    ).toBeInTheDocument();
  });

  it("explains a coded, non-retryable condition and offers its destination", () => {
    // `analytics_collection_disabled` is a configuration state, so the panel
    // must send the operator to the control that reverses it rather than
    // inviting a retry that would fail identically.
    render(
      <AnalyticsQueryResult
        error={
          new ApiError("collection disabled", {
            code: "analytics_collection_disabled",
            correlationId: "req_44a",
            retryable: false,
            status: 409,
          })
        }
        isPending={false}
        onRetry={() => {
          /* must not be offered */
        }}
        scope={{
          environmentKey: "prod",
          organizationId: "org_1",
          projectId: "prj_1",
        }}
      >
        <p>loaded</p>
      </AnalyticsQueryResult>
    );

    expect(
      screen.getByText(
        /Analytics collection is turned off for this Environment/
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Environment settings" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
