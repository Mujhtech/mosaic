import { describe, expect, it, vi } from "vitest"

import { createApiClient } from "@/lib/api/client"
import { ApiError, ApiNetworkError, ApiRequestAbortedError } from "@/lib/api/errors"

describe("createApiClient", () => {
  it("sends auth and request context and unwraps the response envelope", async () => {
    const fetchImplementation = vi.fn<typeof fetch>()
    fetchImplementation.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { status: "ok" } }), {
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": "request-from-api",
        },
        status: 200,
      }),
    )
    const client = createApiClient({
      baseUrl: "https://api.example.test/api/v1/dashboard",
      fetchImplementation,
      getAccessToken: () => "session-token",
    })

    const response = await client.request<{ status: string }>("health", {
      correlationId: "request-from-dashboard",
    })

    expect(response.data).toEqual({ status: "ok" })
    expect(response.correlationId).toBe("request-from-api")
    expect(response.status).toBe(200)

    const [requestUrl, requestInit] = fetchImplementation.mock.calls[0] ?? []
    expect(String(requestUrl)).toBe("https://api.example.test/api/v1/dashboard/health")
    const headers = new Headers(requestInit?.headers)
    expect(headers.get("Authorization")).toBe("Bearer session-token")
    expect(headers.get("X-Request-ID")).toBe("request-from-dashboard")
    expect(headers.has("X-Correlation-ID")).toBe(false)
  })

  it("normalizes a machine-readable HTTP error", async () => {
    const fetchImplementation = vi.fn<typeof fetch>()
    fetchImplementation.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "project_not_found",
            fields: { projectId: ["Project not found."] },
            message: "Project not found.",
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "X-Request-ID": "error-correlation",
          },
          status: 404,
        },
      ),
    )
    const client = createApiClient({
      baseUrl: "https://api.example.test/",
      fetchImplementation,
    })

    const error = await client.request("projects/project-1").catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toEqual(
      expect.objectContaining({
        code: "project_not_found",
        correlationId: "error-correlation",
        details: { projectId: ["Project not found."] },
        message: "Project not found.",
        retryable: false,
        status: 404,
      }),
    )
  })

  it("uses the error body's request ID when the response header is absent", async () => {
    const fetchImplementation = vi.fn<typeof fetch>()
    fetchImplementation.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "validation_failed",
            message: "The request contains invalid fields.",
            requestId: "request-from-body",
          },
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 422,
        },
      ),
    )
    const client = createApiClient({
      baseUrl: "https://api.example.test/",
      fetchImplementation,
    })

    await expect(client.request("projects")).rejects.toEqual(
      expect.objectContaining({
        code: "validation_failed",
        correlationId: "request-from-body",
        status: 422,
      }),
    )
  })

  it("rejects a successful response without the Mosaic data envelope", async () => {
    const fetchImplementation = vi.fn<typeof fetch>()
    fetchImplementation.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    )
    const client = createApiClient({
      baseUrl: "https://api.example.test/",
      fetchImplementation,
    })

    await expect(client.request("health")).rejects.toEqual(
      expect.objectContaining({ code: "invalid_response", retryable: false, status: 200 }),
    )
  })

  it.each([
    "../outside",
    "%2e%2e%2foutside",
    "%252e%252e%252foutside",
    "/outside",
    "\\\\untrusted.example/outside",
  ])("rejects a path that can escape the configured API boundary: %s", async (path) => {
    const fetchImplementation = vi.fn<typeof fetch>()
    const client = createApiClient({
      baseUrl: "https://api.example.test/api/v1/dashboard",
      fetchImplementation,
      getAccessToken: () => "session-token",
    })

    await expect(client.request(path)).rejects.toBeInstanceOf(TypeError)
    expect(fetchImplementation).not.toHaveBeenCalled()
  })

  it("distinguishes cancellation from a network failure", async () => {
    const abortedFetch = vi.fn<typeof fetch>()
    abortedFetch.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"))
    const abortedClient = createApiClient({
      baseUrl: "https://api.example.test/",
      fetchImplementation: abortedFetch,
    })

    await expect(abortedClient.request("projects")).rejects.toBeInstanceOf(ApiRequestAbortedError)

    const failedFetch = vi.fn<typeof fetch>()
    failedFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    const failedClient = createApiClient({
      baseUrl: "https://api.example.test/",
      fetchImplementation: failedFetch,
    })

    await expect(failedClient.request("projects")).rejects.toBeInstanceOf(ApiNetworkError)
  })
})
