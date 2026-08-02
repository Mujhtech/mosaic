import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SubscriptionStateAxes } from "@/features/billing-customers/components/subscription-state-axes";
import type { BillingSubscriptionSnapshot } from "@/generated/api";

/**
 * The cancelled-but-still-current subscription.
 *
 * This is the case a merged status pill cannot state, and the realistic failure
 * is expensive in one direction: a support agent who reads "Cancelled" as
 * "access gone" issues a refund or talks a paying customer through a
 * re-purchase for a subscription that is working correctly. So the rendering
 * has to keep both facts on screen — renewal stopped, access continues — and
 * must never emit the inactive label for a subscription whose access is active.
 */
describe("subscription state axes", () => {
  const cancelledButCurrent: BillingSubscriptionSnapshot = {
    accessState: "active",
    billingState: "current",
    cancellationEffectiveAt: "2026-07-10T09:00:00Z",
    lifecycleState: "active",
    periodEnd: "2026-09-01T12:00:00Z",
    renewalIntent: "auto_renew_disabled",
    subscriptionInstanceId: "sub_01",
    uncertaintyReason: "none",
  };

  it("renders auto-renew disabled and access until the period end, never inactive", () => {
    render(<SubscriptionStateAxes subscription={cancelledButCurrent} />);

    expect(screen.getByText("Auto-renew disabled")).toBeInTheDocument();
    expect(
      screen.getByText("Active until 2026-09-01 12:00:00 UTC")
    ).toBeInTheDocument();
    expect(screen.queryByText("No access")).not.toBeInTheDocument();
  });

  it("keeps the five axes separate rather than merging them into one status", () => {
    render(<SubscriptionStateAxes subscription={cancelledButCurrent} />);

    for (const axis of [
      "Access",
      "Lifecycle",
      "Renewal intent",
      "Billing state",
      "Uncertainty",
    ]) {
      expect(screen.getByText(axis)).toBeInTheDocument();
    }
    // Access and lifecycle disagreeing with renewal intent is the whole point:
    // all three are true simultaneously and none is summarised away.
    expect(screen.getByText("Access active")).toBeInTheDocument();
    expect(screen.getByText("Billing current")).toBeInTheDocument();
  });

  it("does not present an undetermined subscription as having no access", () => {
    render(
      <SubscriptionStateAxes
        subscription={{
          accessState: "unknown",
          billingState: "unknown",
          lifecycleState: "unknown",
          renewalIntent: "unknown",
          subscriptionInstanceId: "sub_02",
          uncertaintyReason: "provider_unavailable",
        }}
      />
    );

    // The pill and the summary sentence both say it, which is the point: there
    // is no reading of this component that produces "inactive".
    expect(screen.getAllByText("Access undetermined").length).toBeGreaterThan(
      0
    );
    expect(screen.queryByText("No access")).not.toBeInTheDocument();
    expect(screen.getByText("Store unavailable")).toBeInTheDocument();
  });
});
