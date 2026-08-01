import { dashboardEnvironment } from "@/config/environment";
import { createClient } from "@/generated/api/client";
import {
  ApiError,
  ApiNetworkError,
  ApiRequestAbortedError,
} from "@/lib/api/errors";

function createRequestId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return (
    "mosaic-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeGeneratedError(
  error: unknown,
  response: Response | undefined,
  request: Request | undefined
) {
  if (error instanceof ApiError) {
    return error;
  }

  const fallbackRequestId =
    request?.headers.get("X-Request-ID") ?? createRequestId();
  const envelope =
    isRecord(error) && isRecord(error.error) ? error.error : undefined;
  const requestId =
    response?.headers.get("X-Request-ID") ??
    (typeof envelope?.requestId === "string"
      ? envelope.requestId
      : fallbackRequestId);

  if (!response) {
    if (request?.signal.aborted) {
      return new ApiRequestAbortedError(requestId, error);
    }
    return new ApiNetworkError(requestId, error);
  }

  return new ApiError(
    typeof envelope?.message === "string"
      ? envelope.message
      : `Request failed with status ${response.status}.`,
    {
      cause: error,
      code: typeof envelope?.code === "string" ? envelope.code : "http_error",
      correlationId: requestId,
      details: envelope?.details ?? envelope?.fields,
      retryable: response.status === 429 || response.status >= 500,
      status: response.status,
    }
  );
}

export function createGeneratedDashboardClient(
  fetchImplementation: typeof fetch = globalThis.fetch
) {
  const client = createClient({
    baseUrl: dashboardEnvironment.apiBaseUrl,
    fetch: fetchImplementation,
  });

  client.interceptors.request.use((request) => {
    if (!request.headers.has("X-Request-ID")) {
      request.headers.set("X-Request-ID", createRequestId());
    }
    return new Request(request, { credentials: "include" });
  });
  client.interceptors.error.use(normalizeGeneratedError);

  return client;
}

export const generatedDashboardClient = createGeneratedDashboardClient();
