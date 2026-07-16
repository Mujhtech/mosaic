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
