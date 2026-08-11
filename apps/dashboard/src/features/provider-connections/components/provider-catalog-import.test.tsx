import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProviderCatalogImport } from "@/features/provider-connections/components/provider-catalog-import";
import type { ProviderCatalogPreviewView } from "@/features/provider-connections/types/provider-catalog-import";
import type {
  Application,
  Entitlement,
  Environment,
  Product,
} from "@/generated/api";

/**
 * Risk: App Store Connect has no entitlement resource at all, so every catalog
 * it returns has an empty entitlement list. If the import screen treats
 * selecting a provider Entitlement as a step on the way to importing, the whole
 * App Store Connect import path is unreachable — the operator sees products
 * they can tick and a button that never becomes usable.
 *
 * This asserts the zero-entitlement catalog imports cleanly and sends an empty
 * entitlement selection rather than being blocked or inventing a grant.
 */

const applications = [
  {
    id: "app_1",
    identifier: "com.example.app",
    name: "Example",
    platform: "ios",
  },
] as Application[];

const environments = [
  { id: "env_1", mode: "development", name: "Development" },
] as Environment[];

const preview: ProviderCatalogPreviewView = {
  entitlements: [],
  observedAt: "2026-08-03T00:00:00Z",
  offerings: [
    {
      displayName: "Pro subscriptions",
      id: "group_1",
      isCurrent: true,
      lookupKey: "group_1",
      packages: [
        {
          displayName: "Pro subscriptions",
          id: "pkg_1",
          lookupKey: "pkg_1",
          productIds: ["prod_1"],
        },
      ],
      state: "active",
    },
  ],
  products: [
    {
      applicationId: "app_1",
      displayName: "Pro monthly",
      id: "prod_1",
      importable: true,
      state: "active",
      storeIdentifier: "com.example.app.pro.monthly",
      type: "subscription",
    },
  ],
};

describe("ProviderCatalogImport with a catalog that has no entitlements", () => {
  it("imports without requiring a provider Entitlement selection", async () => {
    const onImport = vi
      .fn()
      .mockResolvedValue({ id: "imp_1", items: [], status: "completed" });
    render(
      <ProviderCatalogImport
        applications={applications}
        catalogProductsHref="/products"
        entitlements={[] as Entitlement[]}
        environments={environments}
        onImport={onImport}
        preview={preview}
        products={[] as Product[]}
        provider="app_store_connect"
        providersHref="/providers"
      />
    );

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Import Pro monthly" })
    );

    // No grant mapping is offered, because the provider reports none to map.
    expect(
      screen.queryByText("Access granted by this Product")
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Import 1 Product(s)" })
    );

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    const [items] = onImport.mock.calls[0] ?? [];
    expect(items).toHaveLength(1);
    expect(items[0].entitlements).toEqual([]);
    expect(items[0].providerProductIdentifier).toBe("prod_1");
  });

  it("names the advanced mapping control for Apple's own resource", () => {
    render(
      <ProviderCatalogImport
        applications={applications}
        catalogProductsHref="/products"
        entitlements={[] as Entitlement[]}
        environments={environments}
        onImport={vi.fn()}
        preview={preview}
        products={[] as Product[]}
        provider="app_store_connect"
        providersHref="/providers"
      />
    );

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Import Pro monthly" })
    );

    // "Offering" and "Package" are RevenueCat words. An operator looking at
    // App Store Connect sees a subscription group.
    expect(screen.getByText(/Advanced Subscription group/)).toBeInTheDocument();
  });
});
