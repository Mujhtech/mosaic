interface ApiErrorOptions {
  cause?: unknown
  code: string
  correlationId: string
  details?: unknown
  retryable: boolean
  status: number
}

export class ApiError extends Error {
  readonly code: string
  readonly correlationId: string
  readonly details?: unknown
  readonly retryable: boolean
  readonly status: number

  constructor(message: string, options: ApiErrorOptions) {
    super(message, { cause: options.cause })
    this.name = "ApiError"
    this.code = options.code
    this.correlationId = options.correlationId
    this.details = options.details
    this.retryable = options.retryable
    this.status = options.status
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
    })
    this.name = "ApiNetworkError"
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
    })
    this.name = "ApiRequestAbortedError"
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
  | "validation"

export interface ApiErrorDescription {
  /** Correlation identifier operators can use to find the matching server log entry. */
  correlationId?: string
  /** Mosaic-owned copy. Never the raw server message, which may leak internals. */
  description: string
  kind: ApiErrorKind
  retryable: boolean
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
  validation: "The submitted values were rejected. Review the form and try again.",
}

function classifyApiError(error: ApiError): ApiErrorKind {
  if (error instanceof ApiRequestAbortedError) return "aborted"
  if (error instanceof ApiNetworkError || error.status === 0) return "network"
  if (error.status === 401) return "unauthorized"
  if (error.status === 403) return "forbidden"
  if (error.status === 404) return "not_found"
  if (error.status === 409) return "conflict"
  if (error.status === 422 || error.status === 400) return "validation"
  if (error.status === 429) return "rate_limited"
  if (error.status >= 500) return "server"
  return "unknown"
}

/**
 * Maps an unknown thrown value onto Mosaic-owned, user-safe copy plus the
 * correlation identifier. Raw server messages are deliberately discarded:
 * Mosaic surfaces correlation IDs instead of server internals.
 */
export function describeApiError(error: unknown): ApiErrorDescription {
  if (error instanceof ApiError) {
    const kind = classifyApiError(error)
    return {
      correlationId: error.correlationId,
      description: DESCRIPTIONS[kind],
      kind,
      retryable: error.retryable,
    }
  }

  return { description: DESCRIPTIONS.unknown, kind: "unknown", retryable: false }
}
