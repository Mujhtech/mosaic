const TRAILING_SLASHES = /\/+$/;
const DEFAULT_API_BASE_URL = "http://localhost:8080";
// Matches PREVIEW_ENDPOINT_DEFAULT in the editor constants.
const DEFAULT_PREVIEW_URL = "ws://127.0.0.1:4317/preview";
const DEFAULT_PREVIEW_SESSION_ID = "session_local_01";

export interface MosaicRuntimeConfig {
  apiBaseUrl: string;
  previewSessionId: string;
  previewUrl: string;
}

declare global {
  interface Window {
    __MOSAIC_CONFIG__?: unknown;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown> | undefined, key: string) {
  const value = source?.[key];
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Accepts only an absolute URL using one of the allowed protocols. A malformed
 * or hostile value falls back to the documented default rather than throwing:
 * a misconfigured deployment must still render a usable page that says what is
 * wrong, not a blank screen.
 */
function validateUrl(
  candidate: string | undefined,
  protocols: readonly string[]
) {
  if (!candidate) {
    return;
  }
  try {
    const parsed = new URL(candidate);
    return protocols.includes(parsed.protocol)
      ? candidate.replace(TRAILING_SLASHES, "")
      : undefined;
  } catch {
    /* an unparseable URL falls through to the undefined return below */
  }
}

function readRawConfig(): Record<string, unknown> | undefined {
  if (import.meta.env.SSR) {
    // Server render: the values come from the container's environment, so the
    // same image can be deployed against any API host without rebuilding.
    const env = typeof process === "undefined" ? undefined : process.env;
    if (!env) {
      return;
    }
    return {
      apiBaseUrl: env.MOSAIC_DASHBOARD_API_BASE_URL,
      previewSessionId: env.MOSAIC_DASHBOARD_PREVIEW_SESSION_ID,
      previewUrl: env.MOSAIC_DASHBOARD_PREVIEW_URL,
    };
  }

  return isRecord(globalThis.window?.__MOSAIC_CONFIG__)
    ? globalThis.window.__MOSAIC_CONFIG__
    : undefined;
}

function resolveRuntimeConfig(): MosaicRuntimeConfig {
  const raw = readRawConfig();

  return {
    apiBaseUrl:
      validateUrl(readString(raw, "apiBaseUrl"), ["http:", "https:"]) ??
      // Build-time value remains a development convenience only; the shipped
      // bundle no longer depends on it.
      validateUrl(import.meta.env.VITE_API_BASE_URL?.trim(), [
        "http:",
        "https:",
      ]) ??
      DEFAULT_API_BASE_URL,
    previewSessionId:
      readString(raw, "previewSessionId") ??
      import.meta.env.VITE_MOSAIC_PREVIEW_SESSION_ID?.trim() ??
      DEFAULT_PREVIEW_SESSION_ID,
    previewUrl:
      validateUrl(readString(raw, "previewUrl"), ["ws:", "wss:"]) ??
      validateUrl(import.meta.env.VITE_MOSAIC_PREVIEW_URL?.trim(), [
        "ws:",
        "wss:",
      ]) ??
      DEFAULT_PREVIEW_URL,
  };
}

/**
 * Resolved once at module load. `window.__MOSAIC_CONFIG__` is injected by the
 * server render before any application module executes, so both passes observe
 * the same values and hydration stays stable.
 */
export const dashboardEnvironment: Readonly<MosaicRuntimeConfig> =
  Object.freeze(resolveRuntimeConfig());

/** Exported for tests and for the SSR script tag. */
export { resolveRuntimeConfig };

/**
 * Inline script assigning the runtime configuration. Rendered identically on
 * the server and the client so React does not report a hydration mismatch.
 */
export function runtimeConfigScript() {
  return `window.__MOSAIC_CONFIG__=${JSON.stringify(dashboardEnvironment).replace(/</g, "\\u003c")}`;
}

export const dashboardBuildInfo = Object.freeze({
  builtAt: __MOSAIC_BUILD_TIME__,
  commit: __MOSAIC_COMMIT__,
  version: __MOSAIC_VERSION__,
});
