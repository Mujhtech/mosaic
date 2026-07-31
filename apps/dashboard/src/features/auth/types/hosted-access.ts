export const hostedAccessDecision = Object.freeze({
  description:
    "Sign in with your Mosaic email and password to access Organizations, Projects, and hosted publishing. Local Studio remains available without an account.",
  status: "decision_required" as const,
  title: "Sign in to continue",
});

export type HostedAccessDecision = typeof hostedAccessDecision;

export function safeInternalReturnTo(value: unknown, fallback = "/workspace") {
  if (typeof value !== "string") {
    return fallback;
  }
  const candidate = value.trim();
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\")
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(candidate, "https://mosaic.local");
    if (parsed.origin !== "https://mosaic.local") {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
