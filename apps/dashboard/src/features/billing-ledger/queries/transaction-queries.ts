import { queryOptions } from "@tanstack/react-query";
import {
  type TransactionFilters,
  transactionFactsQuery,
} from "@/features/billing-ledger/types/transaction-filters";
import {
  listBillingLedger,
  listTransactionFacts,
  listValidationAttempts,
  type TransactionFact,
} from "@/generated/api";
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client";

/**
 * The ledger is cursor-paged and append-only. Nothing here mutates, and no
 * query key includes a store identifier or token — only Mosaic identifiers and
 * the filter values that are already in the URL.
 */
export const transactionKeys = {
  attempts: (projectId: string, environmentId: string, rawInputId: string) =>
    [
      "billing-ledger",
      projectId,
      environmentId,
      "validation-attempts",
      rawInputId,
    ] as const,
  attemptsScope: (projectId: string, environmentId: string) =>
    [
      "billing-ledger",
      projectId,
      environmentId,
      "validation-attempts",
    ] as const,
  fact: (projectId: string, environmentId: string, factId: string) =>
    ["billing-ledger", projectId, environmentId, "fact", factId] as const,
  facts: (
    projectId: string,
    environmentId: string,
    filters: Record<string, unknown>
  ) => ["billing-ledger", projectId, environmentId, "facts", filters] as const,
  ledger: (projectId: string, environmentId: string) =>
    ["billing-ledger", projectId, environmentId, "entries"] as const,
  scope: (projectId: string, environmentId: string) =>
    ["billing-ledger", projectId, environmentId] as const,
};

export function transactionFactsQueryOptions(
  projectId: string,
  environmentId: string,
  filters: TransactionFilters
) {
  const query = transactionFactsQuery(filters);
  return queryOptions({
    queryKey: transactionKeys.facts(projectId, environmentId, query),
    queryFn: async ({ signal }) => {
      const result = await listTransactionFacts({
        client: generatedDashboardClient,
        path: { environmentId, projectId },
        query,
        signal,
        throwOnError: true,
      });
      return {
        items: result.data.data?.items ?? [],
        nextCursor: result.data.data?.nextCursor,
      };
    },
  });
}

/**
 * The contract exposes no `GET .../billing/facts/{factId}`, so a deep link to a
 * detail page is resolved by walking the cursor-paged list. The walk is bounded
 * so a stale link degrades into an explicit "not in the recent ledger" state
 * rather than an unbounded fetch loop.
 */
const FACT_LOOKUP_MAX_PAGES = 10;
const FACT_LOOKUP_PAGE_SIZE = 100;

export function transactionFactQueryOptions(
  projectId: string,
  environmentId: string,
  factId: string
) {
  return queryOptions({
    queryKey: transactionKeys.fact(projectId, environmentId, factId),
    queryFn: async ({ signal }): Promise<TransactionFact | null> => {
      let cursor: string | undefined;
      for (let page = 0; page < FACT_LOOKUP_MAX_PAGES; page += 1) {
        const result = await listTransactionFacts({
          client: generatedDashboardClient,
          path: { environmentId, projectId },
          query: {
            limit: FACT_LOOKUP_PAGE_SIZE,
            ...(cursor ? { cursor } : {}),
          },
          signal,
          throwOnError: true,
        });
        const match = result.data.data?.items?.find(
          (item) => item.id === factId
        );
        if (match) {
          return match;
        }
        cursor = result.data.data?.nextCursor;
        if (!cursor) {
          break;
        }
      }
      return null;
    },
  });
}

/**
 * One input's complete attempt history.
 *
 * The `rawInputId` filter is applied by the API. Filtering an Environment-wide
 * page client-side was wrong in a way that mattered: in an Environment with
 * real traffic the attempts belonging to the opened record fall outside the
 * window, and the panel then asserted "no attempt recorded" about a record
 * whose own attempt count said otherwise. For a phase whose promise is a
 * preserved, readable attempt history, that claim is worse than showing
 * nothing.
 *
 * The list stays newest-first and is never trimmed: a superseded attempt is
 * still part of the audit trail.
 */
export function validationAttemptsQueryOptions(
  projectId: string,
  environmentId: string,
  rawInputId: string
) {
  return queryOptions({
    queryKey: transactionKeys.attempts(projectId, environmentId, rawInputId),
    queryFn: async ({ signal }) => {
      const result = await listValidationAttempts({
        client: generatedDashboardClient,
        path: { environmentId, projectId },
        query: { limit: 100, rawInputId },
        signal,
        throwOnError: true,
      });
      return result.data.data?.items ?? [];
    },
  });
}

export function billingLedgerQueryOptions(
  projectId: string,
  environmentId: string
) {
  return queryOptions({
    queryKey: transactionKeys.ledger(projectId, environmentId),
    queryFn: async ({ signal }) => {
      const result = await listBillingLedger({
        client: generatedDashboardClient,
        path: { environmentId, projectId },
        query: { limit: 100 },
        signal,
        throwOnError: true,
      });
      return result.data.data?.items ?? [];
    },
  });
}
