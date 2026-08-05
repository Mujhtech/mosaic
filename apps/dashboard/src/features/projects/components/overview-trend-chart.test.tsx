import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OverviewTrendChart } from "@/features/projects/components/overview-trend-chart";
import type {
  OverviewSeries,
  OverviewSeriesPoint,
  ProjectOverviewMetricsSeries,
} from "@/generated/api";

const getProjectOverviewMetricsSeries = vi.hoisted(() => vi.fn());

vi.mock("@/generated/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/generated/api")>()),
  getProjectOverviewMetricsSeries,
}));

function series(
  points: OverviewSeriesPoint[] | null,
  overrides: Partial<OverviewSeries> = {}
): OverviewSeries {
  return {
    authority: "client_observed",
    available: points !== null,
    scope: "environment",
    ...(points === null ? {} : { points }),
    ...overrides,
  };
}

function counts(values: number[], partialLast = false): OverviewSeriesPoint[] {
  return values.map((value, index) => ({
    date: `2026-07-${String(index + 1).padStart(2, "0")}`,
    value,
    ...(partialLast && index === values.length - 1 ? { partial: true } : {}),
  }));
}

function response(
  metrics: Partial<ProjectOverviewMetricsSeries["metrics"]>,
  days = 30
) {
  const empty = series([]);
  return {
    data: {
      data: {
        days,
        environmentId: "environment_01",
        metrics: {
          conversionRate: empty,
          newCustomers: empty,
          newSubscriptions: empty,
          paywallViews: empty,
          purchases: empty,
          purchaseStarts: empty,
          trialsStarted: empty,
          ...metrics,
        },
        projectId: "project_01",
        window: {
          from: "2026-07-01T00:00:00Z",
          timezone: "UTC",
          to: "2026-07-03T10:00:00Z",
        },
      } satisfies ProjectOverviewMetricsSeries,
    },
  };
}

function renderChart() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <OverviewTrendChart
        environmentId="environment_01"
        organizationId="org_01"
        projectId="project_01"
      />
    </QueryClientProvider>
  );
}

function rowAt(rows: HTMLElement[], index: number): HTMLElement {
  const row = rows[index];
  if (!row) {
    throw new Error(`the table has no row ${index}`);
  }
  return row;
}

/** Moves the selector off the default two-series funnel view. */
async function selectView(label: string) {
  fireEvent.click(await screen.findByRole("button", { name: label }));
}

describe("overview trend chart", () => {
  beforeEach(() => {
    getProjectOverviewMetricsSeries.mockReset();
  });

  it("breaks the line on days a conversion rate was not measured", async () => {
    getProjectOverviewMetricsSeries.mockResolvedValue(
      response({
        conversionRate: series([
          { date: "2026-07-01", value: 0.2 },
          { date: "2026-07-02", value: 0.3 },
          // No presentations that day: there is no rate, and 0% would draw a
          // collapse on a day that measured nothing.
          { date: "2026-07-03", value: null },
          { date: "2026-07-04", value: 0.25 },
          { date: "2026-07-05", value: 0.4 },
        ]),
      })
    );
    renderChart();
    await selectView("Conversion rate");

    await waitFor(() =>
      expect(screen.getAllByTestId("trend-segment")).toHaveLength(2)
    );
    const paths = screen
      .getAllByTestId("trend-segment")
      .map((path) => path.getAttribute("d") ?? "");
    // Two separate runs, never one path bridging the gap.
    expect(paths.every((path) => path.split("M").length === 2)).toBe(true);
    expect(screen.getByText("Not measured")).toBeInTheDocument();
  });

  it("states why a series is unavailable instead of drawing it as zero", async () => {
    getProjectOverviewMetricsSeries.mockResolvedValue(
      response({
        paywallViews: series(null, { reason: "analytics_collection_disabled" }),
        purchases: series(null, { reason: "analytics_collection_disabled" }),
      })
    );
    renderChart();

    expect(
      await screen.findByText(
        /Analytics collection is turned off for this Environment/
      )
    ).toBeInTheDocument();
    // An unreadable window has no line at all — a flat zero would be a claim
    // Mosaic cannot support.
    expect(screen.queryAllByTestId("trend-segment")).toHaveLength(0);
  });

  it("marks today's still-accruing point distinctly", async () => {
    getProjectOverviewMetricsSeries.mockResolvedValue(
      response({ paywallViews: series(counts([10, 12, 4], true)) })
    );
    renderChart();
    await selectView("Paywall views");

    await waitFor(() =>
      expect(screen.getAllByTestId("trend-segment").length).toBeGreaterThan(0)
    );
    const partial = screen
      .getAllByTestId("trend-segment")
      .filter((path) => path.getAttribute("data-partial") === "true");
    expect(partial).toHaveLength(1);
    expect(partial[0]).toHaveAttribute("stroke-dasharray");
    expect(screen.getByTestId("trend-end-dot")).toHaveAttribute(
      "data-partial",
      "true"
    );
    expect(screen.getByText(/Today is still accruing/)).toBeInTheDocument();
  });

  it("asks the API for the window the reader selected", async () => {
    getProjectOverviewMetricsSeries.mockResolvedValue(
      response({ paywallViews: series(counts([1, 2, 3])) })
    );
    renderChart();

    await waitFor(() =>
      expect(getProjectOverviewMetricsSeries).toHaveBeenCalledWith(
        expect.objectContaining({ query: { days: 30 } })
      )
    );

    fireEvent.click(screen.getByRole("button", { name: "90 days" }));

    // The window is served, not sliced client-side, so switching it is a new
    // request rather than a re-render of the same points.
    await waitFor(() =>
      expect(getProjectOverviewMetricsSeries).toHaveBeenCalledWith(
        expect.objectContaining({ query: { days: 90 } })
      )
    );
  });

  it("mirrors every plotted value in the table a screen reader can read", async () => {
    getProjectOverviewMetricsSeries.mockResolvedValue(
      response({
        paywallViews: series(counts([10, 0, 7])),
        purchases: series(counts([2, 0, 1])),
      })
    );
    renderChart();

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    // Header plus one row per day, each carrying both series' numbers —
    // including the measured zeros, which are answers rather than gaps.
    expect(rows).toHaveLength(4);
    expect(within(rowAt(rows, 1)).getByText("10")).toBeInTheDocument();
    expect(within(rowAt(rows, 1)).getByText("2")).toBeInTheDocument();
    expect(within(rowAt(rows, 2)).getAllByText("0")).toHaveLength(2);
    expect(within(rowAt(rows, 3)).getByText("7")).toBeInTheDocument();
  });
});
