import {
  type BillingProvider,
  billingProviders,
  type ResolutionState,
  resolutionStates,
  type StoreEnvironment,
  storeEnvironments,
} from "@/features/billing-ledger/types/billing-vocabulary";
import type { TransactionFact } from "@/generated/api";

const CURSOR_PATTERN = /^[\x20-\x7E]{1,512}$/;

/**
 * Transaction ledger filters, carried in the URL so a view is shareable and
 * reloadable.
 *
 * Two rules drive this module.
 *
 * 1. **The Mosaic Environment is never a filter.** It is a route path segment
 *    and the tenant boundary the API enforces. Any Environment-shaped value in
 *    the search string is deliberately ignored, so a crafted or stale URL can
 *    never redirect a ledger view at another Environment's records.
 * 2. **Store Environment is a filter and is a different thing.** It is what the
 *    store itself reported about the transaction. The two are never merged.
 *
 * Hostile or stale values fall back to the documented default instead of
 * throwing: `validateSearch` runs before the route renders, so throwing here
 * would replace a recoverable page with a route error.
 */
export interface TransactionFilters {
  applicationId?: string;
  cursor?: string;
  /** Inclusive lower bound on the store-reported `occurredAt`. */
  from?: string;
  limit: number;
  productId?: string;
  provider?: BillingProvider;
  reference?: string;
  resolutionState?: ResolutionState;
  storeEnvironment?: StoreEnvironment;
  /** Inclusive upper bound on the store-reported `occurredAt`. */
  to?: string;
}

export const TRANSACTION_PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_TRANSACTION_PAGE_SIZE = 50;

/** Matches the `safeProviderCode` bound the ingestion contract applies. */
const SAFE_REFERENCE = /^[\x20-\x7E]{1,128}$/;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,64}$/;

function safeString(value: unknown, pattern: RegExp) {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

function safeTimestamp(value: unknown) {
  if (typeof value !== "string" || value.length === 0 || value.length > 40) {
    return;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : value;
}

function member<T extends string>(value: unknown, allowed: readonly T[]) {
  return typeof value === "string" && allowed.some((item) => item === value)
    ? (value as T)
    : undefined;
}

export function defaultTransactionFilters(): TransactionFilters {
  return { limit: DEFAULT_TRANSACTION_PAGE_SIZE };
}

export function parseTransactionFilters(
  search: Record<string, unknown>
): TransactionFilters {
  const from = safeTimestamp(search.from);
  const to = safeTimestamp(search.to);
  // An inverted range would silently return nothing and read as data loss.
  // Dropping both bounds returns the documented unfiltered default instead.
  const orderedRange =
    from && to && Date.parse(from) > Date.parse(to) ? {} : { from, to };
  const limit = TRANSACTION_PAGE_SIZES.find(
    (size) => size === Number(search.limit)
  );

  return {
    applicationId: safeString(search.applicationId, IDENTIFIER),
    cursor: safeString(search.cursor, CURSOR_PATTERN),
    ...orderedRange,
    limit: limit ?? DEFAULT_TRANSACTION_PAGE_SIZE,
    productId: safeString(search.productId, IDENTIFIER),
    provider: member(search.provider, billingProviders),
    reference: safeString(search.reference, SAFE_REFERENCE),
    resolutionState: member(search.resolutionState, resolutionStates),
    // Deliberately independent of the Mosaic Environment, which is a path
    // segment and is never read from the search string.
    storeEnvironment: member(search.storeEnvironment, storeEnvironments),
  };
}

/** Drops empty values so a cleared filter leaves the URL rather than sitting in it. */
export function serializeTransactionFilters(
  filters: TransactionFilters
): TransactionFilters {
  const entries = Object.entries(filters).filter(
    ([, value]) => value !== undefined && value !== ""
  );
  return {
    ...(Object.fromEntries(entries) as TransactionFilters),
    limit: filters.limit,
  };
}

/**
 * The subset the API accepts today. Everything else is applied client-side over
 * the returned page, and the view says so rather than implying the whole ledger
 * was searched.
 */
export function transactionFactsQuery(filters: TransactionFilters) {
  return {
    ...(filters.cursor ? { cursor: filters.cursor } : {}),
    ...(filters.from ? { from: filters.from } : {}),
    limit: filters.limit,
    ...(filters.provider ? { provider: filters.provider } : {}),
    ...(filters.to ? { to: filters.to } : {}),
  };
}

export const CLIENT_APPLIED_FILTER_KEYS = [
  "applicationId",
  "productId",
  "reference",
  "resolutionState",
  "storeEnvironment",
] as const satisfies readonly (keyof TransactionFilters)[];

export function clientAppliedFilterCount(filters: TransactionFilters) {
  return CLIENT_APPLIED_FILTER_KEYS.filter((key) => filters[key] !== undefined)
    .length;
}

export function hasActiveTransactionFilters(filters: TransactionFilters) {
  return (
    clientAppliedFilterCount(filters) > 0 ||
    filters.provider !== undefined ||
    filters.from !== undefined ||
    filters.to !== undefined
  );
}

export function applyClientTransactionFilters(
  items: readonly TransactionFact[],
  filters: TransactionFilters
): TransactionFact[] {
  const reference = filters.reference?.toLowerCase();
  return items.filter((item) => {
    if (filters.applicationId && item.applicationId !== filters.applicationId) {
      return false;
    }
    if (filters.productId && item.mosaicProductId !== filters.productId) {
      return false;
    }
    if (
      filters.storeEnvironment &&
      item.storeEnvironment !== filters.storeEnvironment
    ) {
      return false;
    }
    if (
      filters.resolutionState &&
      item.resolutionState !== filters.resolutionState
    ) {
      return false;
    }
    if (reference) {
      const haystack = [
        item.providerTransactionId,
        item.providerOriginalTransactionId,
        item.providerProductIdentifier,
      ]
        .filter((value): value is string => typeof value === "string")
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(reference)) {
        return false;
      }
    }
    return true;
  });
}
