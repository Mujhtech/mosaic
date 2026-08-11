import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfigurationErrorBanner } from "@/components/feedback/configuration-error-banner";

vi.mock("@/config/environment", () => ({
  dashboardEnvironment: {
    apiBaseUrl: "http://localhost:8080",
    apiBaseUrlMisconfigured: true,
    previewSessionId: "session_local_01",
    previewUrl: "ws://127.0.0.1:4317/preview",
  },
}));

/**
 * Protects: a deployment with no API address tells the operator so, in the
 * product, as an alert.
 *
 * The decision itself is unit-tested in `config/environment.test.ts`. What this
 * covers is the half that decision is worthless without — that the verdict
 * actually reaches the screen, and reaches it with `role="alert"` rather than
 * as decorative text an operator scrolls past while every request fails and
 * looks like an outage.
 */
describe("configuration error banner", () => {
  it("states the misconfiguration as an alert and names the setting to fix", () => {
    render(<ConfigurationErrorBanner />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("no API address configured");
    expect(alert).toHaveTextContent("MOSAIC_DASHBOARD_API_BASE_URL");
    // Says what it is not, because an outage is the wrong thing to go debug.
    expect(alert).toHaveTextContent(/not a network problem or an outage/i);
  });
});
