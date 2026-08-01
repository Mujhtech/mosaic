import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NativeProviderMappingSheet } from "@/features/catalog/components/native-provider-mapping-sheet";
import type { Application, Environment, Product } from "@/generated/api";

const environment: Environment = {
  createdAt: "2026-07-24T12:00:00Z",
  id: "env_staging",
  key: "staging",
  mode: "staging",
  name: "Staging",
  projectId: "project_01",
  updatedAt: "2026-07-24T12:00:00Z",
};

const subscription: Product = {
  createdAt: "2026-07-24T12:00:00Z",
  id: "product_monthly",
  internalName: "Pro Monthly",
  key: "pro_monthly",
  metadataSource: "provider",
  projectId: "project_01",
  readiness: { metadataSource: "provider", ready: false, reasons: [] },
  status: "connected",
  type: "subscription",
  updatedAt: "2026-07-24T12:00:00Z",
};

const androidApplication: Application = {
  createdAt: "2026-07-24T12:00:00Z",
  id: "app_android",
  identifier: "com.example.android",
  name: "Example Android",
  platform: "android",
  projectId: "project_01",
  updatedAt: "2026-07-24T12:00:00Z",
};

describe("NativeProviderMappingSheet", () => {
  it("requires a Google base plan and an explicit offer ID when a specific offer is selected", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <NativeProviderMappingSheet
        application={androidApplication}
        environment={environment}
        onSubmit={onSubmit}
        product={subscription}
        provider="google_play"
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Add Google Play Billing mapping" })
    );
    fireEvent.change(screen.getByLabelText("Google Play Product ID"), {
      target: { value: "pro_subscription" },
    });
    fireEvent.click(
      screen.getByRole("radio", { name: /Use a specific offer/ })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save configured mapping" })
    );

    expect(
      await screen.findByText("Enter the exact base plan ID.")
    ).toBeVisible();
    expect(screen.getByText("Enter the exact offer ID.")).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Base plan ID"), {
      target: { value: "monthly" },
    });
    fireEvent.change(screen.getByLabelText("Offer ID"), {
      target: { value: "intro" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save configured mapping" })
    );

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        applicationId: androidApplication.id,
        environmentId: environment.id,
        googleBasePlanId: "monthly",
        googleOfferId: "intro",
        productType: "subscription",
        provider: "google_play",
        providerProductIdentifier: "pro_subscription",
      })
    );
  });

  it("rejects StoreKit for an Android Application without invoking the mutation", () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <NativeProviderMappingSheet
        application={androidApplication}
        environment={environment}
        onSubmit={onSubmit}
        product={subscription}
        provider="app_store"
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Add StoreKit mapping" })
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "StoreKit is not compatible with this ANDROID Application"
    );
    expect(
      screen.getByRole("button", { name: "Save configured mapping" })
    ).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
