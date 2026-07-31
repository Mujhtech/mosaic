import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ExperimentAdapter } from "../api/experiment-adapter";
import { ExperimentAdapterProvider } from "../api/experiment-adapter-provider";
import { ExperimentResultsPanel } from "./experiment-results";

describe("Experiment result interpretation", () => {
  it("shows uncertainty and an actionable SRM warning without declaring a winner", async () => {
    const adapter = {
      results: async () => ({
        aggregateUpdatedAt: "2026-07-26T20:00:00Z",
        attributionWindowMature: false,
        fallbackExposures: 3,
        freshnessMinutes: 4,
        guardrails: [
          {
            name: "Purchase failure rate",
            severity: "ok" as const,
            summary: "No material increase observed.",
          },
        ],
        interim: true,
        issues: [
          {
            code: "sample_ratio_mismatch",
            continues: true,
            investigation: "Check exposure instrumentation by Variant.",
            message:
              "Observed exposure allocation differs from the immutable allocation.",
            recoveryAction:
              "Inspect instrumentation; do not reallocate traffic in place.",
            severity: "critical" as const,
            title: "Sample-ratio mismatch",
          },
        ],
        primaryMetricName: "Presentation to purchase start",
        primaryMetricAuthority: "provider_confirmed" as const,
        primaryMetricAvailability: "trusted_source_unavailable" as const,
        primaryMetricEventFilter: {
          "payload.reason": "provider_unavailable" as const,
        },
        srm: {
          cells: [
            {
              expected: 100,
              expectedShare: 0.5,
              observed: 140,
              observedShare: 0.7,
              variantId: "control",
            },
            {
              expected: 100,
              expectedShare: 0.5,
              observed: 60,
              observedShare: 0.3,
              variantId: "treatment",
            },
          ],
          degreesOfFreedom: 1,
          exclusions: ["QA overrides"],
          pValue: 0.000_01,
          severity: "critical" as const,
          statistic: 32,
          status: "mismatch" as const,
        },
        treatments: [
          {
            absoluteLift: 0.02,
            interval: { high: 0.06, low: -0.02 },
            relativeLift: 0.2,
            variantId: "treatment",
          },
        ],
        variants: [
          {
            allocationBasisPoints: 5000,
            conversions: 10,
            estimate: 0.1,
            interval: { high: 0.17, low: 0.06 },
            name: "Control",
            role: "control" as const,
            uniqueExposures: 100,
            variantId: "control",
          },
          {
            allocationBasisPoints: 5000,
            conversions: 12,
            estimate: 0.12,
            interval: { high: 0.19, low: 0.07 },
            name: "Treatment A",
            role: "treatment" as const,
            uniqueExposures: 100,
            variantId: "treatment",
          },
        ],
      }),
    } as unknown as ExperimentAdapter;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ExperimentAdapterProvider adapter={adapter}>
          <ExperimentResultsPanel
            experimentId="experiment"
            scope={{ environmentId: "staging", projectId: "project" }}
          />
        </ExperimentAdapterProvider>
      </QueryClientProvider>
    );

    expect(
      await screen.findByText("Sample-ratio mismatch")
    ).toBeInTheDocument();
    expect(screen.getByText("Do not interpret yet")).toBeInTheDocument();
    expect(screen.getByText("Observed estimate")).toBeInTheDocument();
    expect(screen.getByText("Descriptive lift")).toBeInTheDocument();
    expect(screen.getByText(/95% Wilson estimates/)).toBeInTheDocument();
    expect(screen.getByText(/95% Newcombe interval/)).toBeInTheDocument();
    expect(
      screen.getByText(/No automatic winner is selected/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Trusted source: trusted source unavailable/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/payload.reason = provider_unavailable/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Winner$/i)).not.toBeInTheDocument();
  });
});
