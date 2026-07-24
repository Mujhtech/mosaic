import { describe, expect, it, vi } from "vitest"

import {
  nextProviderImportAttempt,
  providerEntitlementSelections,
  providerImportIdentifier,
  type ProviderCatalogProductView,
} from "@/features/provider-connections/types/provider-catalog-import"

describe("provider catalog import integrity", () => {
  it("keeps provider resource IDs distinct from store identifiers", () => {
    const product: ProviderCatalogProductView = {
      applicationId: "provider_app_01",
      displayName: "Pro Monthly",
      id: "rc_product_resource_01",
      importable: true,
      state: "active",
      storeIdentifier: "com.example.pro.monthly",
      type: "subscription",
    }

    expect(providerImportIdentifier(product)).not.toBe(product.storeIdentifier)
    expect(providerImportIdentifier(product)).toBe("rc_product_resource_01")
  })

  it("reuses one idempotency key after an uncertain retry and rotates it for changed work", () => {
    const createKey = vi
      .fn<() => string>()
      .mockReturnValueOnce("provider-import:first")
      .mockReturnValueOnce("provider-import:second")
    const first = nextProviderImportAttempt(null, "request-a", createKey)
    const uncertainRetry = nextProviderImportAttempt(first, "request-a", createKey)
    const changedSelection = nextProviderImportAttempt(first, "request-b", createKey)

    expect(uncertainRetry).toBe(first)
    expect(changedSelection.idempotencyKey).toBe("provider-import:second")
    expect(createKey).toHaveBeenCalledTimes(2)
  })

  it("keeps Access grants scoped to the Product that selected them", () => {
    const entitlements = [
      {
        displayName: "Pro",
        id: "rc_entitlement_pro",
        lookupKey: "pro",
        state: "active",
      },
    ]

    expect(
      providerEntitlementSelections(entitlements, {
        rc_entitlement_pro: "entitlement_existing",
      }),
    ).toEqual([
      {
        existingEntitlementId: "entitlement_existing",
        providerIdentifier: "rc_entitlement_pro",
      },
    ])
    expect(providerEntitlementSelections(entitlements, {})).toEqual([])
  })
})
