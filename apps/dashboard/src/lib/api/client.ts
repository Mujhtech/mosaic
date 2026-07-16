import { ApiError, ApiNetworkError, ApiRequestAbortedError } from "@/lib/api/errors"

type AccessToken = string | null | undefined

export interface ApiClientConfig {
  baseUrl: string
  fetchImplementation?: typeof fetch
  getAccessToken?: () => AccessToken | Promise<AccessToken>
}

export interface ApiRequestOptions extends Omit<
  RequestInit,
  "body" | "headers" | "method" | "signal"
> {
  body?: BodyInit | null
  correlationId?: string
  headers?: HeadersInit
  json?: unknown
  method?: "DELETE" | "GET" | "PATCH" | "POST" | "PUT"
  signal?: AbortSignal
}

export interface ApiResponse<T> {
  correlationId: string
  data: T
  headers: Headers
  status: number
}

export interface ApiClient {
  request<T>(path: string, options?: ApiRequestOptions): Promise<ApiResponse<T>>
}

interface ErrorDescriptor {
  code?: string
  details?: unknown
  message?: string
  requestId?: string
}

function ensureTrailingSlash(url: string) {
  return url.endsWith("/") ? url : url + "/"
}

function resolveRequestUrl(path: string, baseUrl: URL) {
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith("/") || path.includes("\\")) {
    throw new TypeError("API request paths must be relative to the configured base URL.")
  }

  const pathEnd = path.search(/[?#]/)
  let decodedPath = pathEnd === -1 ? path : path.slice(0, pathEnd)
  for (let iteration = 0; iteration < 8; iteration += 1) {
    let nextDecodedPath: string
    try {
      nextDecodedPath = decodeURIComponent(decodedPath)
    } catch {
      if (iteration === 0) {
        throw new TypeError("API request paths must use valid URL encoding.")
      }
      break
    }
    if (nextDecodedPath === decodedPath) {
      break
    }
    decodedPath = nextDecodedPath
  }
  if (decodedPath.replaceAll("\\", "/").split("/").includes("..")) {
    throw new TypeError("API request paths must remain inside the configured base URL.")
  }

  const requestUrl = new URL(path, baseUrl)
  if (requestUrl.origin !== baseUrl.origin || !requestUrl.pathname.startsWith(baseUrl.pathname)) {
    throw new TypeError("API request paths must remain inside the configured base URL.")
  }

  return requestUrl
}

function createCorrelationId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID()
  }

  return "mosaic-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readErrorDescriptor(payload: unknown): ErrorDescriptor {
  if (!isRecord(payload)) {
    return {}
  }

  const candidate = isRecord(payload.error) ? payload.error : payload

  return {
    code: typeof candidate.code === "string" ? candidate.code : undefined,
    details: candidate.details ?? candidate.fields,
    message: typeof candidate.message === "string" ? candidate.message : undefined,
    requestId: typeof candidate.requestId === "string" ? candidate.requestId : undefined,
  }
}

function readSuccessData(payload: unknown, response: Response, correlationId: string) {
  if (response.status === 204) {
    return undefined
  }

  if (!isRecord(payload) || !Object.hasOwn(payload, "data")) {
    throw new ApiError("The service returned an invalid success envelope.", {
      code: "invalid_response",
      correlationId,
      retryable: false,
      status: response.status,
    })
  }

  return payload.data
}

function isAbortError(error: unknown, signal?: AbortSignal) {
  return signal?.aborted === true || (isRecord(error) && error.name === "AbortError")
}

async function readResponsePayload(response: Response, correlationId: string) {
  if (response.status === 204) {
    return undefined
  }

  const responseText = await response.text()
  if (responseText.length === 0) {
    return undefined
  }

  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("json")) {
    return responseText
  }

  try {
    return JSON.parse(responseText) as unknown
  } catch (error) {
    if (!response.ok) {
      return undefined
    }

    throw new ApiError("The service returned an invalid JSON response.", {
      cause: error,
      code: "invalid_response",
      correlationId,
      retryable: false,
      status: response.status,
    })
  }
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const baseUrl = new URL(ensureTrailingSlash(config.baseUrl))
  const fetchImplementation = config.fetchImplementation ?? globalThis.fetch

  return {
    async request<T>(path: string, options: ApiRequestOptions = {}) {
      const {
        body: requestBody,
        correlationId: providedCorrelationId,
        headers: requestHeaders,
        json,
        method = "GET",
        signal,
        ...requestOptions
      } = options
      const headers = new Headers(requestHeaders)
      const correlationId =
        providedCorrelationId ??
        headers.get("X-Request-ID") ??
        headers.get("X-Correlation-ID") ??
        createCorrelationId()
      const accessToken = await config.getAccessToken?.()

      if (!headers.has("Accept")) {
        headers.set("Accept", "application/json")
      }
      // The backend contract and CORS policy standardize on X-Request-ID.
      headers.delete("X-Correlation-ID")
      headers.set("X-Request-ID", correlationId)

      if (accessToken && !headers.has("Authorization")) {
        headers.set("Authorization", "Bearer " + accessToken)
      }

      if (requestBody !== undefined && json !== undefined) {
        throw new TypeError("Provide either body or json, not both.")
      }

      let body = requestBody
      if (json !== undefined) {
        body = JSON.stringify(json)
        if (!headers.has("Content-Type")) {
          headers.set("Content-Type", "application/json")
        }
      }

      const requestUrl = resolveRequestUrl(path, baseUrl)

      let response: Response
      try {
        response = await fetchImplementation(requestUrl, {
          ...requestOptions,
          body,
          headers,
          method,
          signal,
        })
      } catch (error) {
        if (error instanceof ApiError) {
          throw error
        }

        if (isAbortError(error, signal)) {
          throw new ApiRequestAbortedError(correlationId, error)
        }

        throw new ApiNetworkError(correlationId, error)
      }

      const responseHeaderCorrelationId =
        response.headers.get("X-Request-ID") ?? response.headers.get("X-Correlation-ID")
      const responseCorrelationId = responseHeaderCorrelationId ?? correlationId
      const payload = await readResponsePayload(response, responseCorrelationId)

      if (!response.ok) {
        const descriptor = readErrorDescriptor(payload)
        const errorCorrelationId =
          responseHeaderCorrelationId ?? descriptor.requestId ?? correlationId
        throw new ApiError(
          descriptor.message ?? "Request failed with status " + response.status + ".",
          {
            code: descriptor.code ?? "http_error",
            correlationId: errorCorrelationId,
            details: descriptor.details,
            retryable: response.status === 429 || response.status >= 500,
            status: response.status,
          },
        )
      }

      const data = readSuccessData(payload, response, responseCorrelationId)

      return {
        correlationId: responseCorrelationId,
        data: data as T,
        headers: response.headers,
        status: response.status,
      }
    },
  }
}
