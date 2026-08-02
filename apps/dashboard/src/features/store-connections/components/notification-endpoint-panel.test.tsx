import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NotificationEndpointPanel } from "@/features/store-connections/components/notification-endpoint-panel";

/**
 * Risk: the Store Notification intake token stays in the DOM after the operator
 * dismisses the one-time reveal, or is re-rendered from a prop the component
 * still holds. The token is one of the two factors that authenticate an inbound
 * Apple notification, so a leaked endpoint is a forgeable notification address.
 *
 * This is tested at component level because the risk is DOM presence across a
 * state change, which no unit test on a pure module can observe.
 */

const INTAKE_TOKEN = "mk_live_fixtureintaketoken0123456789";
const ENDPOINT = `https://billing.example.test/v1/billing/apple/notifications/${INTAKE_TOKEN}`;

describe("one-time Store Notification endpoint", () => {
  it("reveals the endpoint once, copies it, and leaves no trace of the intake token after dismissal", async () => {
    const writeToClipboard = vi.fn(async () => undefined);
    const onDismiss = vi.fn();

    render(
      <NotificationEndpointPanel
        endpointUrl={ENDPOINT}
        onDismiss={onDismiss}
        writeToClipboard={writeToClipboard}
      />
    );

    expect(screen.getByText(ENDPOINT)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Copy endpoint URL" }));
    expect(writeToClipboard).toHaveBeenCalledWith(ENDPOINT);
    expect(await screen.findByRole("button", { name: "Copied" })).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Dismiss the one-time notification endpoint",
      })
    );

    expect(onDismiss).toHaveBeenCalled();
    // The prop still holds the URL: the component must not render it again.
    expect(document.body.innerHTML).not.toContain(INTAKE_TOKEN);
    expect(screen.queryByText(ENDPOINT)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copy endpoint URL" })
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Mosaic cannot display it again/)).toBeVisible();
  });

  it("shows no endpoint and no copy control when nothing was just issued", () => {
    render(<NotificationEndpointPanel onDismiss={vi.fn()} />);

    expect(
      screen.queryByRole("button", { name: "Copy endpoint URL" })
    ).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(INTAKE_TOKEN);
  });
});
