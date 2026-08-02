import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { catalogKeys } from "@/features/catalog/queries/catalog-query";
import { invalidateActiveProviderImpact } from "@/features/provider-connections/mutations/provider-connection-mutations";
import { providerConnectionKeys } from "@/features/provider-connections/queries/provider-connection-queries";

describe("active provider assignment cache impact", () => {
  it("invalidates only the assignment scope and affected Project catalog", async () => {
    const queryClient = new QueryClient();
    const assignmentKey = providerConnectionKeys.activeAssignment(
      "environment_01",
      "application_01"
    );
    const projectCatalogKey = catalogKeys.products("project_01");
    const unrelatedAssignmentKey = providerConnectionKeys.activeAssignment(
      "environment_02",
      "application_02"
    );
    const unrelatedCatalogKey = catalogKeys.products("project_02");

    for (const key of [
      assignmentKey,
      projectCatalogKey,
      unrelatedAssignmentKey,
      unrelatedCatalogKey,
    ]) {
      queryClient.setQueryData(key, { present: true });
    }

    await invalidateActiveProviderImpact(
      "application_01",
      "environment_01",
      "project_01",
      queryClient
    );

    expect(queryClient.getQueryState(assignmentKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(projectCatalogKey)?.isInvalidated).toBe(
      true
    );
    expect(
      queryClient.getQueryState(unrelatedAssignmentKey)?.isInvalidated
    ).toBe(false);
    expect(queryClient.getQueryState(unrelatedCatalogKey)?.isInvalidated).toBe(
      false
    );
  });
});
