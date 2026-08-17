const TRAILING_SLASHES = /\/+$/;
const DEFAULT_API_BASE_URL = "http://localhost:8080";
const DEFAULT_PREVIEW_URL = "ws://127.0.0.1:4317/preview";
const DEFAULT_PREVIEW_SESSION_ID = "session_local_01";

/**
 * Hosts for which `http://localhost:8080` is a plausible API origin. Anything
 * else is a real deployment, where that default cannot possibly be right.
 */
const LOOPBACK_HOSTNAMES = new Set([
  "0.0.0.0",
  "127.0.0.1",
  "::1",
  "[::1]",
  "localhost",
]);

export interface MosaicRuntimeConfig {
  apiBaseUrl: string;
  /**
   * True when no usable API origin was supplied *and* this is not a local
   * development context, so `apiBaseUrl` is a fabricated loopback address that
   * cannot serve this deployment.
   *
   * The value is still filled in rather than left empty: the page has to render
   * in order to explain the problem, which is more useful than a blank screen
   * or a wall of failed requests with no stated cause. It is surfaced by
   * `ConfigurationErrorBanner`.
   */
  apiBaseUrlMisconfigured: boolean;
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

/**
 * Whether falling back to `DEFAULT_API_BASE_URL` is a real misconfiguration.
 *
 * A dev build never is. A production bundle is not either while the page itself
 * is served from a loopback host — that is a developer running `npm start`
 * locally, which no real deployment ever looks like. Everything else is a
 * deployment pointing at an API address that cannot exist.
 *
 * Pure and exported so the production branch is testable without moving the
 * jsdom page URL.
 */
export function apiBaseUrlIsMisconfigured(input: {
  configured: string | undefined;
  hostname: string | undefined;
  isDevBuild: boolean;
}) {
  if (input.configured !== undefined || input.isDevBuild) {
    return false;
  }
  // On the server there is no page host to judge by, so the SSR pass reports
  // the problem and the injected flag carries the verdict to the client.
  return input.hostname === undefined
    ? true
    : !LOOPBACK_HOSTNAMES.has(input.hostname);
}

function resolveRuntimeConfig(): MosaicRuntimeConfig {
  const raw = readRawConfig();
  const configuredApiBaseUrl =
    validateUrl(readString(raw, "apiBaseUrl"), ["http:", "https:"]) ??
    // Build-time value remains a development convenience only; the shipped
    // bundle no longer depends on it.
    validateUrl(import.meta.env.VITE_API_BASE_URL?.trim(), ["http:", "https:"]);
  // The SSR pass writes its verdict into the injected payload, so a client that
  // reads back the substituted loopback default still knows it is a fallback
  // rather than a deliberate configuration. Both passes agree, so hydration
  // stays stable.
  const injectedMisconfigured =
    isRecord(raw) && raw.apiBaseUrlMisconfigured === true;
  const apiBaseUrlMisconfigured =
    injectedMisconfigured ||
    apiBaseUrlIsMisconfigured({
      configured: configuredApiBaseUrl,
      hostname: globalThis.window?.location?.hostname,
      isDevBuild: import.meta.env.DEV,
    });

  if (apiBaseUrlMisconfigured && !injectedMisconfigured) {
    // Deliberately loud, and deliberately once per pass. A deployment with a
    // typo'd API host previously looked identical to an API outage.
    console.error(
      "[mosaic] No API base URL is configured. Set MOSAIC_DASHBOARD_API_BASE_URL on the dashboard container (or inject window.__MOSAIC_CONFIG__.apiBaseUrl). Mosaic is falling back to " +
        `${DEFAULT_API_BASE_URL}, which cannot serve this deployment, so every API request will fail.`
    );
  }

  return {
    apiBaseUrl: configuredApiBaseUrl ?? DEFAULT_API_BASE_URL,
    apiBaseUrlMisconfigured,
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
