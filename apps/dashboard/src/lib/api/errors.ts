import {
  assetsHref,
  billingQuarantineHref,
  catalogProductsHref,
  environmentSettingsHref,
  placementsHref,
  providersHref,
  storeConnectionsHref,
  type WorkspaceScope,
} from "@/lib/routing/workspace-hrefs";

interface ApiErrorOptions {
  cause?: unknown;
  code: string;
  correlationId: string;
  details?: unknown;
  retryable: boolean;
  status: number;
}

export class ApiError extends Error {
  readonly code: string;
  readonly correlationId: string;
  readonly details?: unknown;
  readonly retryable: boolean;
  readonly status: number;

  constructor(message: string, options: ApiErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "ApiError";
    this.code = options.code;
    this.correlationId = options.correlationId;
    this.details = options.details;
    this.retryable = options.retryable;
    this.status = options.status;
  }
}

export class ApiNetworkError extends ApiError {
  constructor(correlationId: string, cause: unknown) {
    super("The service could not be reached.", {
      cause,
      code: "network_error",
      correlationId,
      retryable: true,
      status: 0,
    });
    this.name = "ApiNetworkError";
  }
}

export class ApiRequestAbortedError extends ApiError {
  constructor(correlationId: string, cause: unknown) {
    super("The request was cancelled.", {
      cause,
      code: "request_aborted",
      correlationId,
      retryable: false,
      status: 0,
    });
    this.name = "ApiRequestAbortedError";
  }
}

export type ApiErrorKind =
  | "aborted"
  | "conflict"
  | "forbidden"
  | "network"
  | "not_found"
  | "rate_limited"
  | "server"
  | "unauthorized"
  | "unknown"
  | "validation";

/** A single, Mosaic-owned next step for a described failure. */
export interface ApiErrorRecovery {
  /** Internal destination. Absent when no page can resolve the condition. */
  href?: string;
  label: string;
}

/**
 * One structured fact the server attached to the failure. Values are
 * server-supplied identifiers and Mosaic-owned codes, never free-form server
 * prose, so they stay safe to render.
 */
export interface ApiErrorDetailEntry {
  label?: string;
  value: string;
}

export interface ApiErrorDescription {
  /** Correlation identifier operators can use to find the matching server log entry. */
  correlationId?: string;
  /** Mosaic-owned copy. Never the raw server message, which may leak internals. */
  description: string;
  /** Structured, safe-to-render specifics such as readiness blockers or rejected fields. */
  details?: ApiErrorDetailEntry[];
  kind: ApiErrorKind;
  /** Where the operator goes next. Present only for codes with a known remedy. */
  recovery?: ApiErrorRecovery;
  retryable: boolean;
}

const DESCRIPTIONS: Record<ApiErrorKind, string> = {
  aborted: "The request was cancelled before it completed.",
  conflict: "This resource changed since it was loaded. Reload and try again.",
  forbidden: "Your account does not have permission for this resource.",
  network: "Mosaic could not reach the API. Check your connection, then retry.",
  not_found: "This resource no longer exists, or the address is incomplete.",
  rate_limited: "Too many requests were sent. Wait a moment, then retry.",
  server: "The Mosaic API reported an unexpected error. Retry shortly.",
  unauthorized: "Your session is no longer valid. Sign in again to continue.",
  unknown: "Mosaic could not complete this request.",
  validation:
    "The submitted values were rejected. Review the form and try again.",
};

function classifyApiError(error: ApiError): ApiErrorKind {
  if (error instanceof ApiRequestAbortedError) {
    return "aborted";
  }
  if (error instanceof ApiNetworkError || error.status === 0) {
    return "network";
  }
  if (error.status === 401) {
    return "unauthorized";
  }
  if (error.status === 403) {
    return "forbidden";
  }
  if (error.status === 404) {
    return "not_found";
  }
  if (error.status === 409) {
    return "conflict";
  }
  if (error.status === 422 || error.status === 400) {
    return "validation";
  }
  if (error.status === 429) {
    return "rate_limited";
  }
  if (error.status >= 500) {
    return "server";
  }
  return "unknown";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * Provider readiness reports one object per blocking Product/Application pair.
 * Only the stable diagnostic code and the identifiers are rendered; the raw
 * object is never stringified into the page.
 */
function blockerEntries(details: unknown): ApiErrorDetailEntry[] | undefined {
  const blockers = record(details)?.blockers;
  if (!Array.isArray(blockers)) {
    return;
  }
  const entries = blockers.flatMap((blocker) => {
    const item = record(blocker);
    const code = text(item?.code);
    if (!code) {
      return [];
    }
    const productId = text(item?.productId);
    return [
      { label: productId ? `Product ${productId}` : undefined, value: code },
    ];
  });
  return entries.length > 0 ? entries : undefined;
}

/**
 * Validation details arrive in two shapes: a `fields` map from transport-level
 * request validation, and a flat `errors` list from document validation.
 */
function validationEntries(
  details: unknown
): ApiErrorDetailEntry[] | undefined {
  const payload = record(details);
  const fields = record(payload?.fields);
  if (fields) {
    const entries = Object.entries(fields).flatMap(([field, messages]) => {
      const value = Array.isArray(messages)
        ? messages
            .filter((message): message is string => typeof message === "string")
            .join(", ")
        : text(messages);
      return value ? [{ label: field, value }] : [];
    });
    if (entries.length > 0) {
      return entries;
    }
  }

  const errors = payload?.errors;
  if (Array.isArray(errors)) {
    const entries = errors.flatMap((issue) => {
      const value = text(issue) ?? text(record(issue)?.code);
      return value ? [{ value }] : [];
    });
    if (entries.length > 0) {
      return entries;
    }
  }
}

function reasonEntries(details: unknown): ApiErrorDetailEntry[] | undefined {
  const reason = text(record(details)?.reason);
  return reason ? [{ label: "Reason", value: reason }] : undefined;
}

/**
 * The 406 names the term that refused: the capability an SDK must advertise,
 * or the protocol version it must speak. Without it there is no path from the
 * response to the header to send or the SDK build to upgrade.
 */
function capabilityEntries(
  details: unknown
): ApiErrorDetailEntry[] | undefined {
  const payload = record(details);
  const entries: ApiErrorDetailEntry[] = [];
  const requirement = text(payload?.requirement);
  if (requirement) {
    entries.push({ label: "Requirement", value: requirement });
  }
  const capability = text(payload?.capability);
  if (capability) {
    entries.push({ label: "Capability", value: capability });
  }
  const version = text(payload?.version);
  if (version) {
    entries.push({ label: "Version", value: version });
  }
  const reason = text(payload?.reason);
  if (reason) {
    entries.push({ label: "Reason", value: reason });
  }
  return entries.length > 0 ? entries : undefined;
}

interface CodeDescriptor {
  description: string;
  details?: (details: unknown) => ApiErrorDetailEntry[] | undefined;
  href?: (scope: WorkspaceScope) => string | undefined;
  label?: string;
}

/**
 * Mosaic-owned copy for the API error codes an operator can actually act on.
 * Consulted before the status-family fallback, which stays in place for codes
 * with no specific remedy (a genuinely stale 409, an unexpected 500).
 */
const CODE_DESCRIPTORS: Record<string, CodeDescriptor> = {
  analytics_collection_disabled: {
    description:
      "Analytics collection is turned off for this Environment, so no events are being recorded. Turn it on in Environment settings to populate this view.",
    href: environmentSettingsHref,
    label: "Open Environment settings",
  },
  asset_object_missing: {
    description:
      "The stored bytes for this Asset are no longer available, so it cannot be served or published. Upload the Asset again to restore it.",
    href: assetsHref,
    label: "Review Assets",
  },
  billing_disabled: {
    description:
      "Mosaic Billing is turned off for this Project, so no store input is accepted or recorded. The rest of Mosaic — Studio, Products, Paywalls, Placements, Analytics, and Experiments — is unaffected.",
    href: storeConnectionsHref,
    label: "Open Mosaic Billing setup",
  },
  product_resolution_ambiguous: {
    description:
      "More than one provider Product mapping matched this store transaction, so Mosaic refused to guess which Mosaic Product it belongs to. Correct the overlapping mappings, then re-run validation from the quarantine record.",
    href: billingQuarantineHref,
    label: "Review quarantine",
  },
  reconciliation_window_invalid: {
    description:
      "The reconciliation window was rejected. A run must cover a bounded past range, and it may not exceed 180 days — the retention Apple applies to its own notification history.",
  },
  store_credentials_still_active: {
    description:
      "Mosaic Billing cannot be turned off while a Store Server Credential is active. Turning it off alone would not stop the store: Apple keeps posting to an endpoint whose intake token still resolves, and every refusal spends one of its five non-renewable delivery attempts. Revoke the credentials first.",
    href: storeConnectionsHref,
    label: "Open Store Server Credentials",
  },
  store_credential_invalid: {
    description:
      "The stored Store Server Credential no longer authenticates against the store, so validation cannot proceed. Rotate the credential with a current key; nothing already recorded is removed.",
    href: storeConnectionsHref,
    label: "Open Store Server Credentials",
  },
  store_credential_revoked: {
    description:
      "This Store Server Credential is revoked, so its notification endpoint no longer resolves and no store lookup can be made with it. Add a replacement credential to resume ingestion.",
    href: storeConnectionsHref,
    label: "Open Store Server Credentials",
  },
  store_environment_mismatch: {
    description:
      "The Store Environment reported by the store does not match the Store Environment this credential is registered for. Sandbox and production are always separate connections and never mix.",
    href: storeConnectionsHref,
    label: "Open Store Server Credentials",
  },
  asset_storage_unavailable: {
    description:
      "Hosted Asset publishing is unavailable until object storage is configured for this deployment. Ask an operator to configure Mosaic object storage, then retry.",
  },
  experiment_invalid: {
    description:
      "Mosaic refused this Experiment request because a publish precondition failed.",
    details: reasonEntries,
  },
  experiment_placement_decision_required: {
    description:
      "Publish a Placement rule set in this Environment first. The current Configuration Release carries no Placement decision for an Experiment release to build on.",
    href: placementsHref,
    label: "Review Placements",
  },
  placement_unpublished: {
    description:
      "This Paywall isn't bound to a Placement yet. Every active Placement binding must resolve to a published Paywall before a Release can go out.",
    href: placementsHref,
    label: "Review Placements",
  },
  product_invalid: {
    description:
      "A referenced Product is missing, archived, or belongs to another Project. Correct the reference in the catalog, then retry.",
    href: catalogProductsHref,
    label: "Review Products",
  },
  provider_readiness_unavailable: {
    description:
      "Production publishing requires every referenced Product to be connected for every Application in this Project.",
    details: blockerEntries,
    href: providersHref,
    label: "Review Purchase setup",
  },
  unsupported_capability: {
    description:
      "The requesting SDK build does not support this Configuration Release. Send the required capability header, or upgrade the SDK.",
    details: capabilityEntries,
  },
  validation_failed: {
    description:
      "Mosaic rejected the submitted values. Resolve the listed issues, then try again.",
    details: validationEntries,
  },
};

/**
 * Maps an unknown thrown value onto Mosaic-owned, user-safe copy plus the
 * correlation identifier. Raw server messages are deliberately discarded:
 * Mosaic surfaces correlation IDs instead of server internals.
 *
 * `scope` supplies the identifiers a recovery link needs. Without it the copy
 * and details are unchanged and only the link is omitted, so callers outside a
 * project context still get the specific explanation.
 */
export function describeApiError(
  error: unknown,
  scope: WorkspaceScope = {}
): ApiErrorDescription {
  if (error instanceof ApiError) {
    const kind = classifyApiError(error);
    const descriptor = CODE_DESCRIPTORS[error.code];
    if (!descriptor) {
      return {
        correlationId: error.correlationId,
        description: DESCRIPTIONS[kind],
        kind,
        retryable: error.retryable,
      };
    }

    const details = descriptor.details?.(error.details);
    const href = descriptor.href?.(scope);
    const recovery = descriptor.label
      ? { ...(href ? { href } : {}), label: descriptor.label }
      : undefined;

    return {
      correlationId: error.correlationId,
      description: descriptor.description,
      ...(details ? { details } : {}),
      kind,
      ...(recovery ? { recovery } : {}),
      retryable: error.retryable,
    };
  }

  return {
    description: DESCRIPTIONS.unknown,
    kind: "unknown",
    retryable: false,
  };
}
