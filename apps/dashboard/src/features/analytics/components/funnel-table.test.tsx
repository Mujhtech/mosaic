import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FunnelTable } from "./funnel-table";

describe("FunnelTable", () => {
  it("renders provider-confirmed unavailability without a false zero or drop-off bar", () => {
    render(
      <FunnelTable
        report={{
          title: "Purchases funnel",
          correlationKey: "purchase attempt",
          sampleSize: 120,
          warnings: ["provider_confirmed_unavailable"],
          freshness: {
            aggregateState: "unavailable",
            lateEventPolicy: "Seven-day event-time window.",
          },
          steps: [
            {
              id: "client_completed_purchases",
              label: "client completed purchases",
              eventName: "Client-observed purchased outcomes.",
              count: 3,
              available: true,
              authority: "client_observed",
              warnings: [],
            },
            {
              id: "provider_confirmed_purchases",
              label: "provider confirmed purchases",
              eventName: "Provider-confirmed purchases.",
              count: 0,
              available: false,
              authority: "provider_confirmed",
              warnings: ["provider_confirmed_unavailable"],
            },
          ],
        }}
      />
    );

    expect(
      screen.getByText("Provider-confirmed · Unavailable")
    ).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
    expect(
      screen.getByText("provider_confirmed_unavailable")
    ).toBeInTheDocument();
    expect(screen.queryByText("100.0%")).not.toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });
});
