import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LowDataNotice } from "./analytics-states";
import { MetricDictionary, MetricGrid } from "./metric-grid";

describe("analytics authority and data-quality states", () => {
  it("shows provider-confirmed absence as unavailable and keeps client outcomes separate", () => {
    render(
      <MetricGrid
        metrics={[
          {
            metricId: "client_completed",
            value: 12,
            numerator: 12,
            authority: "client_observed",
            available: true,
            warnings: [],
          },
          {
            metricId: "provider_completed",
            numerator: 0,
            authority: "provider_confirmed",
            available: false,
            warnings: ["No trusted provider source is configured."],
          },
        ]}
      />
    );
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("Provider-confirmed")).toBeInTheDocument();
  });

  it("reports sample size without declaring a winner below the accepted threshold", () => {
    render(<LowDataNotice sampleSize={42} />);
    expect(screen.getByText(/42 presentations/)).toHaveTextContent(
      "does not declare a winner"
    );
  });

  it("uses singular presentation grammar", () => {
    render(<LowDataNotice sampleSize={1} />);
    expect(screen.getByText(/1 presentation\./)).toBeInTheDocument();
    expect(screen.queryByText(/1 presentations/)).not.toBeInTheDocument();
  });

  it("shows backend metric semantics and does not format count metrics as rates", () => {
    const metric = {
      metricId: "purchase_attempts",
      value: 25,
      numerator: 25,
      denominator: 100,
      authority: "client_observed" as const,
      available: true,
      warnings: [],
      basis: "event_count",
      attributionWindow: "24h",
      timezone: "UTC",
      definition: "Accepted purchase_started events.",
    };
    render(
      <>
        <MetricGrid metrics={[metric]} />
        <MetricDictionary metrics={[metric]} />
      </>
    );

    expect(screen.getAllByText("25")).toHaveLength(2);
    expect(screen.queryByText("2500.0%")).not.toBeInTheDocument();
    expect(
      screen.getAllByText("Accepted purchase_started events.")
    ).toHaveLength(2);
    expect(screen.getAllByText(/Denominator: 100/)).toHaveLength(2);
    expect(screen.getAllByText(/Basis: event_count/)).toHaveLength(2);
    expect(screen.queryByText(/metric denominator/i)).not.toBeInTheDocument();
  });
});
