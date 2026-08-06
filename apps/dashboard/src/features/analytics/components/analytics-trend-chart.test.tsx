import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AnalyticsMetricSeries,
  OverviewSeriesPoint,
} from "@/generated/api";
import { ApiError } from "@/lib/api/errors";
import { restAnalyticsAdapter } from "../api/rest-analytics-adapter";
import type { AnalyticsFilters } from "../types/analytics";
import { AnalyticsTrendChart } from "./analytics-trend-chart";

const getAnalyticsSeries = vi.hoisted(() => vi.fn());

vi.mock("@/generated/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/generated/api")>()),
  getAnalyticsSeries,
}));

const SCOPE = {
  environmentId: "environment_01",
  environmentKey: "prod",
  organizationId: "org_01",
  projectId: "project_01",
};

const BASE_FILTERS: AnalyticsFilters = {
  basis: "event_count",
  from: "2026-07-01",
  timezone: "UTC",
  to: "2026-07-31",
};

function counts(values: number[]): OverviewSeriesPoint[] {
  return values.map((value, index) => ({
    date: `2026-07-${String(index + 1).padStart(2, "0")}`,
    value,
  }));
}

function metricSeries(
  metricId: string,
  points: OverviewSeriesPoint[] | null,
  overrides: Partial<AnalyticsMetricSeries> = {}
): AnalyticsMetricSeries {
  return {
    authority: "client_observed",
    available: points !== null,
    kind: "count",
    metricId,
    scope: "environment",
    ...(points === null ? {} : { points }),
    ...overrides,
  };
}

function response(series: AnalyticsMetricSeries[], days = 30) {
  return {
    data: {
      data: {
        days,
        environmentId: SCOPE.environmentId,
        freshness: {
          lateEventPolicy: "Late events are accepted for 24 hours.",
          latestAggregatedAt: "2026-07-31T00:00:00Z",
          latestReceivedAt: "2026-07-31T00:00:00Z",
        },
        projectId: SCOPE.projectId,
        series,
        window: {
          from: "2026-07-01T00:00:00Z",
          timezone: "UTC",
          to: "2026-07-31T10:00:00Z",
        },
      },
    },
  };
}

function renderChart(
  filters: AnalyticsFilters,
  onFiltersChange = vi.fn<(next: AnalyticsFilters) => void>()
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AnalyticsTrendChart
        adapter={restAnalyticsAdapter}
        filters={filters}
        onFiltersChange={onFiltersChange}
        scope={SCOPE}
      />
    </QueryClientProvider>
  );
  const rerender = (next: AnalyticsFilters) =>
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <AnalyticsTrendChart
          adapter={restAnalyticsAdapter}
          filters={next}
          onFiltersChange={onFiltersChange}
          scope={SCOPE}
        />
      </QueryClientProvider>
    );
  return { onFiltersChange, rerender };
}

const DEFAULT_SERIES = [
  metricSeries("paywall_presentations", counts([10, 12, 9])),
  metricSeries("purchase_starts", counts([3, 4, 2])),
];

describe("analytics trend chart", () => {
  beforeEach(() => {
    getAnalyticsSeries.mockReset();
  });

  it("charts under the surface's filters and re-reads when they change", async () => {
    getAnalyticsSeries.mockResolvedValue(response(DEFAULT_SERIES));
    const { rerender } = renderChart({ ...BASE_FILTERS, platform: "ios" });

    // The chart must never answer a different question from the table beside
    // it, so every dimension the filter row holds reaches the daily endpoint.
    await waitFor(() =>
      expect(getAnalyticsSeries).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            days: 30,
            metricBasis: "event_count",
            metrics: "paywall_presentations,purchase_starts",
            platform: "ios",
            timezone: "UTC",
          }),
        })
      )
    );

    rerender({ ...BASE_FILTERS, platform: "android" });

    await waitFor(() =>
      expect(getAnalyticsSeries).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ platform: "android" }),
        })
      )
    );
  });

  it("asks the API for the window the reader selected", async () => {
    getAnalyticsSeries.mockResolvedValue(response(DEFAULT_SERIES));
    renderChart(BASE_FILTERS);

    await waitFor(() => expect(getAnalyticsSeries).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "90 days" }));

    // The window is served and clamped by the API, not sliced client-side, so
    // switching it is a new request rather than a re-render of the same points.
    await waitFor(() =>
      expect(getAnalyticsSeries).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ days: 90 }),
        })
      )
    );
  });

  it("names the refused filter and metric, and clears only that filter", async () => {
    getAnalyticsSeries.mockRejectedValue(
      new ApiError("The requested filter cannot be applied.", {
        code: "analytics_dimension_unsupported",
        correlationId: "request_01",
        details: {
          platform: [
            "Not carried by the daily aggregate for presentation_to_purchase_start_rate.",
          ],
        },
        retryable: false,
        status: 422,
      })
    );
    const { onFiltersChange } = renderChart({
      ...BASE_FILTERS,
      locale: "en-US",
      platform: "ios",
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "View → purchase start rate" })
    );

    // Neither half of the disagreement may be dropped silently: an unfiltered
    // series under a filtered heading is indistinguishable from a correct one.
    const explanation = await screen.findByText(/cannot be filtered by/);
    expect(explanation).toHaveTextContent("View → purchase start rate");
    expect(explanation).toHaveTextContent("platform");
    expect(screen.queryAllByTestId("trend-segment")).toHaveLength(0);

    fireEvent.click(
      screen.getByRole("button", { name: /Clear the platform filter/ })
    );

    // Only the dimension the server named is cleared; the rest of the reader's
    // filter survives.
    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "en-US", platform: undefined })
    );
  });

  /**
   * Risk: the clear control acts on the dimensions this chart can clear, but was
   * named after every dimension the server refused. A button that promises to
   * clear a filter it leaves in place sends the reader back to the same refusal
   * with no explanation of why nothing changed.
   */
  it("promises to clear only the filters it actually clears", async () => {
    getAnalyticsSeries.mockRejectedValue(
      new ApiError("The requested filter cannot be applied.", {
        code: "analytics_dimension_unsupported",
        correlationId: "request_01",
        details: {
          paywallId: [
            "Not carried by the daily aggregate for purchase_starts.",
          ],
          platform: ["Not carried by the daily aggregate for purchase_starts."],
        },
        retryable: false,
        status: 422,
      })
    );
    renderChart({ ...BASE_FILTERS, platform: "ios" });

    const clear = await screen.findByRole("button", { name: /^Clear the/ });
    expect(clear).toHaveAccessibleName("Clear the platform filter");
    // The dimension this control cannot reach is still named, as something to
    // change elsewhere rather than something this button will do.
    expect(
      screen.getByText(/paywallId is not cleared here/)
    ).toBeInTheDocument();
  });

  /**
   * Risk: `analytics_collection_disabled` explains that collection is off and
   * names Environment settings as the fix. The link to it is built from the
   * Environment alias, which the analytics scope now carries; without it the
   * recovery is described and then not offered.
   */
  it("links to the Environment control that turns collection back on", async () => {
    getAnalyticsSeries.mockRejectedValue(
      new ApiError("Collection is disabled.", {
        code: "analytics_collection_disabled",
        correlationId: "request_02",
        retryable: false,
        status: 409,
      })
    );
    renderChart(BASE_FILTERS);

    expect(
      await screen.findByRole("link", { name: "Open Environment settings" })
    ).toHaveAttribute(
      "href",
      "/orgs/org_01/projects/project_01/env/prod/settings/environments#analytics-collection"
    );
  });

  /**
   * Risk: a missing aggregate watermark was folded into the "aggregation is
   * behind" caption, which asserts a cause the response never reported.
   */
  it("does not claim aggregation is behind when no watermark was reported", async () => {
    const withoutWatermark = response(DEFAULT_SERIES);
    withoutWatermark.data.data.freshness.latestAggregatedAt = "";
    getAnalyticsSeries.mockResolvedValue(withoutWatermark);
    renderChart(BASE_FILTERS);

    expect(
      await screen.findByText(/Aggregation progress was not reported/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Aggregation is behind/)).toBeNull();
  });

  it("explains a metric Mosaic does not compute instead of drawing zeros", async () => {
    getAnalyticsSeries.mockResolvedValue(
      response([
        metricSeries("paywall_presentations", null, {
          authority: "provider_confirmed",
          reason: "provider_confirmed_unavailable",
        }),
        metricSeries("purchase_starts", null, {
          authority: "provider_confirmed",
          reason: "provider_confirmed_unavailable",
        }),
      ])
    );
    renderChart(BASE_FILTERS);

    expect(
      await screen.findByText(/does not compute this metric yet/)
    ).toBeInTheDocument();
    // A flat zero line would be a measurement claim Mosaic cannot support.
    expect(screen.queryAllByTestId("trend-segment")).toHaveLength(0);
  });
});
