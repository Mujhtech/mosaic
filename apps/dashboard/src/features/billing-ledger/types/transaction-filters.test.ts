import { describe, expect, it } from "vitest";

import {
  applyClientTransactionFilters,
  DEFAULT_TRANSACTION_PAGE_SIZE,
  parseTransactionFilters,
} from "@/features/billing-ledger/types/transaction-filters";
import type { TransactionFact } from "@/generated/api";

/**
 * Risk: a crafted, shared, or stale ledger URL retargets the view at another
 * Mosaic Environment, silently blends sandbox and production facts, or throws
 * inside `validateSearch` and replaces a recoverable page with a route error.
 */
describe("transaction ledger search-parameter validation", () => {
  it("never lets the search string carry a Mosaic Environment", () => {
    const filters = parseTransactionFilters({
      environmentId: "env_other_tenant",
      mosaicEnvironmentId: "env_other_tenant",
      storeEnvironment: "production",
    });

    // The Mosaic Environment comes from the route path and the API enforces the
    // tenant boundary. Nothing Environment-shaped may survive parsing.
    expect(filters).not.toHaveProperty("environmentId");
    expect(filters).not.toHaveProperty("mosaicEnvironmentId");
    expect(JSON.stringify(filters)).not.toContain("env_other_tenant");
    // Store Environment is a different value and is kept.
    expect(filters.storeEnvironment).toBe("production");
  });

  it("drops unknown and hostile values instead of throwing", () => {
    const filters = parseTransactionFilters({
      cursor: { toString: () => "not-a-cursor" },
      from: "not-a-date",
      limit: 100_000,
      provider: "stripe",
      productId: "<script>alert(1)</script>",
      reference: "x".repeat(500),
      resolutionState: "entitled",
      storeEnvironment: "PRODUCTION",
    });

    expect(filters.provider).toBeUndefined();
    expect(filters.storeEnvironment).toBeUndefined();
    expect(filters.resolutionState).toBeUndefined();
    expect(filters.productId).toBeUndefined();
    expect(filters.reference).toBeUndefined();
    expect(filters.cursor).toBeUndefined();
    expect(filters.from).toBeUndefined();
    expect(filters.limit).toBe(DEFAULT_TRANSACTION_PAGE_SIZE);
  });

  it("drops an inverted date range rather than returning an always-empty ledger", () => {
    const inverted = parseTransactionFilters({
      from: "2026-07-01T00:00:00Z",
      to: "2026-06-01T00:00:00Z",
    });
    expect(inverted.from).toBeUndefined();
    expect(inverted.to).toBeUndefined();

    const ordered = parseTransactionFilters({
      from: "2026-06-01T00:00:00Z",
      to: "2026-07-01T00:00:00Z",
    });
    expect(ordered.from).toBe("2026-06-01T00:00:00Z");
    expect(ordered.to).toBe("2026-07-01T00:00:00Z");
  });

  it("keeps sandbox and production facts separate when filtering the loaded page", () => {
    const facts = [
      { id: "fact_sandbox", storeEnvironment: "sandbox" },
      { id: "fact_production", storeEnvironment: "production" },
    ] as TransactionFact[];

    const filters = parseTransactionFilters({ storeEnvironment: "production" });
    const visible = applyClientTransactionFilters(facts, filters);

    expect(visible.map((fact) => fact.id)).toEqual(["fact_production"]);
  });
});
