import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  invalidateCatalogImpact,
  replacementImpactProductIds,
} from "@/features/catalog/mutations/catalog-impact";
import { catalogKeys } from "@/features/catalog/queries/catalog-query";

describe("Catalog impact invalidation", () => {
  it("invalidates project lists plus affected detail, usage, readiness, and relationship caches", async () => {
    const queryClient = new QueryClient();
    const affectedKeys = [
      catalogKeys.products("project_one"),
      catalogKeys.planProducts("plan_one"),
      catalogKeys.product("product_one"),
      catalogKeys.productUsage("product_one"),
      catalogKeys.productReadiness(
        "product_one",
        "environment_one",
        "application_one"
      ),
      catalogKeys.productEntitlements("product_one"),
      catalogKeys.providerMappings("product_one"),
      catalogKeys.entitlement("entitlement_one"),
    ];
    const unrelatedKey = catalogKeys.product("product_other");

    for (const key of [...affectedKeys, unrelatedKey]) {
      queryClient.setQueryData(key, { value: key.join(":") });
    }

    await invalidateCatalogImpact(queryClient, {
      entitlementIds: ["entitlement_one"],
      planIds: ["plan_one"],
      productIds: ["product_one"],
      projectId: "project_one",
    });

    for (const key of affectedKeys) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(queryClient.getQueryState(unrelatedKey)?.isInvalidated).toBe(false);
  });

  it("invalidates the source plus previous and next replacement targets", async () => {
    const queryClient = new QueryClient();
    const impactedProductIds = replacementImpactProductIds(
      "source",
      "old_target",
      "new_target"
    );

    for (const productId of [...impactedProductIds, "unrelated"]) {
      queryClient.setQueryData(catalogKeys.productUsage(productId), {
        productId,
      });
    }

    await invalidateCatalogImpact(queryClient, {
      productIds: impactedProductIds,
      projectId: "project_one",
    });

    for (const productId of impactedProductIds) {
      expect(
        queryClient.getQueryState(catalogKeys.productUsage(productId))
          ?.isInvalidated
      ).toBe(true);
    }
    expect(
      queryClient.getQueryState(catalogKeys.productUsage("unrelated"))
        ?.isInvalidated
    ).toBe(false);
  });
});
