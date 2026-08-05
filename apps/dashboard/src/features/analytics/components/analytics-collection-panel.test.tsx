import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AnalyticsAdapter } from "../api/analytics-adapter";
import type { AnalyticsRole, CollectionSettings } from "../types/analytics";
import { AnalyticsCollectionPanel } from "./analytics-collection-panel";

/** Named rather than inlined: `role="owner"` in JSX reads as an ARIA role. */
const OWNER: AnalyticsRole = "owner";

const scope = {
  environmentId: "environment_01",
  organizationId: "org_01",
  projectId: "project_01",
};

function renderPanel(adapter: Partial<AnalyticsAdapter>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AnalyticsCollectionPanel
        adapter={adapter as AnalyticsAdapter}
        environmentName="Production"
        role={OWNER}
        scope={scope}
      />
    </QueryClientProvider>
  );
}

function settings(overrides: Partial<CollectionSettings> = {}) {
  return {
    enabled: true,
    rawRetentionDays: 180,
    updatedAt: "2026-08-01T09:30:00.000Z",
    ...overrides,
  } satisfies CollectionSettings;
}

describe("analytics collection panel", () => {
  it("turns collection off only after stating what stops", async () => {
    const updateCollectionSettings = vi.fn(async () =>
      settings({ enabled: false })
    );
    renderPanel({
      getCollectionSettings: vi.fn(async () => settings()),
      updateCollectionSettings,
    });

    const toggle = await screen.findByRole("switch", {
      name: "Collect analytics events",
    });
    expect(toggle).toBeChecked();
    // Retention is reported, never guessed: the panel must show the value the
    // API returned rather than a house default.
    expect(screen.getByText(/180 days/)).toBeInTheDocument();

    toggle.click();

    // Flipping the switch is a request, not the change. The consequence has to
    // be readable before anything is sent.
    expect(
      await screen.findByText(
        "Paywall metrics and the overview stop receiving events; recorded data is retained."
      )
    ).toBeInTheDocument();
    expect(updateCollectionSettings).not.toHaveBeenCalled();

    screen.getByRole("button", { name: "Turn collection off" }).click();

    await waitFor(() =>
      expect(updateCollectionSettings).toHaveBeenCalledWith(scope, {
        enabled: false,
        rawRetentionDays: 180,
      })
    );
  });

  it("says what an Environment with collection off is not recording", async () => {
    renderPanel({
      getCollectionSettings: vi.fn(async () => settings({ enabled: false })),
    });

    const toggle = await screen.findByRole("switch", {
      name: "Collect analytics events",
    });
    expect(toggle).not.toBeChecked();
    expect(
      screen.getByText(
        "Paywall metrics and the overview are not receiving events; recorded data is retained."
      )
    ).toBeInTheDocument();
  });

  it("offers a retry instead of a fabricated collection state", async () => {
    const getCollectionSettings = vi.fn(() =>
      Promise.reject(new Error("network down"))
    );
    renderPanel({
      getCollectionSettings: getCollectionSettings as never,
    });

    expect(
      await screen.findByRole("button", { name: "Retry loading settings" })
    ).toBeInTheDocument();
    // An unreadable setting must never render as a switch in either position.
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();

    screen.getByRole("button", { name: "Retry loading settings" }).click();

    await waitFor(() => expect(getCollectionSettings).toHaveBeenCalledTimes(2));
  });
});
