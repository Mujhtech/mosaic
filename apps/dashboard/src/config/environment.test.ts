import { afterEach, describe, expect, it } from "vitest"

import { resolveRuntimeConfig } from "@/config/environment"

/**
 * The dashboard reads its API origin from SSR-injected runtime configuration.
 * A malformed or hostile value must never produce a broken client: the risks
 * are a blank page on a misconfigured deployment, and a redirected API origin
 * if an untrusted protocol were accepted.
 */
afterEach(() => {
  delete window.__MOSAIC_CONFIG__
})

describe("runtime configuration", () => {
  it("uses a valid injected API origin", () => {
    window.__MOSAIC_CONFIG__ = { apiBaseUrl: "https://api.mosaic.example" }

    expect(resolveRuntimeConfig().apiBaseUrl).toBe("https://api.mosaic.example")
  })

  it("falls back to the documented default when the value is missing or unusable", () => {
    for (const injected of [
      undefined,
      {},
      { apiBaseUrl: "" },
      { apiBaseUrl: "   " },
      { apiBaseUrl: 8080 },
      { apiBaseUrl: "not-a-url" },
      { apiBaseUrl: "/v1" },
      // A non-HTTP protocol must never become the API origin.
      { apiBaseUrl: "javascript:alert(1)" },
      { apiBaseUrl: "file:///etc/passwd" },
    ]) {
      window.__MOSAIC_CONFIG__ = injected
      expect(resolveRuntimeConfig().apiBaseUrl).toBe("http://localhost:8080")
    }
  })

  it("rejects a preview relay URL that is not a WebSocket URL", () => {
    window.__MOSAIC_CONFIG__ = { previewUrl: "https://relay.example" }

    expect(resolveRuntimeConfig().previewUrl).toBe("ws://127.0.0.1:4317/preview")
  })

  it("ignores a non-object configuration payload instead of throwing", () => {
    window.__MOSAIC_CONFIG__ = "https://attacker.example"

    expect(() => resolveRuntimeConfig()).not.toThrow()
    expect(resolveRuntimeConfig().apiBaseUrl).toBe("http://localhost:8080")
  })
})
