import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OverviewMetricTile } from "@/features/projects/components/overview-metric-tile";
import type { OverviewMetric } from "@/generated/api";

function metric(overrides: Partial<OverviewMetric> = {}): OverviewMetric {
  return {
    authority: "projected",
    available: true,
    scope: "environment",
    value: 0,
    ...overrides,
  };
}

const recovery = (target: string, label: string) => (
  <a data-target={target} href="/settings">
    {label}
  </a>
);

describe("overview metric tile", () => {
  it("distinguishes a measured zero from a metric that could not be read", () => {
    render(
      <dl>
        <OverviewMetricTile label="Purchases" metric={metric({ value: 0 })} />
        <OverviewMetricTile
          label="Active trials"
          metric={metric({
            available: false,
            reason: "metric_unavailable",
            value: null,
          })}
        />
      </dl>
    );

    // A zero is a real answer and prints as one; the unreadable metric must
    // never borrow that answer, which is the whole point of the tri-state.
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getAllByText("0")).toHaveLength(1);
    expect(screen.getByText("Not available")).toBeInTheDocument();
  });

  it("shows a delta only when both windows were readable", () => {
    const { rerender } = render(
      <dl>
        <OverviewMetricTile
          comparison={metric({ value: 8 })}
          label="Paywall views"
          metric={metric({ value: 12 })}
        />
      </dl>
    );

    expect(screen.getByText("+4")).toBeInTheDocument();
    expect(screen.getByText("vs yesterday")).toBeInTheDocument();

    rerender(
      <dl>
        <OverviewMetricTile
          comparison={metric({
            available: false,
            reason: "metric_unavailable",
            value: null,
          })}
          label="Paywall views"
          metric={metric({ value: 12 })}
        />
      </dl>
    );

    // Today is still shown; the comparison is simply not claimed.
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.queryByText("vs yesterday")).not.toBeInTheDocument();
  });

  it("reports a conversion-rate change in percentage points", () => {
    render(
      <dl>
        <OverviewMetricTile
          comparison={metric({ value: 0.1 })}
          kind="rate"
          label="Conversion rate"
          metric={metric({ value: 0.125 })}
        />
      </dl>
    );

    expect(screen.getByText("12.5%")).toBeInTheDocument();
    expect(screen.getByText("+2.5 pts")).toBeInTheDocument();
  });

  it("explains disabled analytics collection and points at the settings that reverse it", () => {
    render(
      <dl>
        <OverviewMetricTile
          label="Paywall views"
          metric={metric({
            available: false,
            reason: "analytics_collection_disabled",
            value: null,
          })}
          renderRecovery={recovery}
        />
      </dl>
    );

    expect(
      screen.getByText(
        /Analytics collection is turned off for this Environment/
      )
    ).toBeInTheDocument();
    const link = screen.getByRole("link", {
      name: "Open Environment settings",
    });
    expect(link).toHaveAttribute("data-target", "environment-settings");
    // A configuration choice is not a transient failure, so no retry is offered.
    expect(
      screen.queryByRole("button", { name: "Retry" })
    ).not.toBeInTheDocument();
  });

  it("offers a retry, not a settings link, when the source simply could not be read", () => {
    render(
      <dl>
        <OverviewMetricTile
          label="Total customers"
          metric={metric({
            available: false,
            reason: "metric_unavailable",
            value: null,
          })}
          onRetry={() => {
            /* asserted by presence, not by invocation */
          }}
          renderRecovery={recovery}
        />
      </dl>
    );

    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
