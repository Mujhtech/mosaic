export const hostedAccessDecision = Object.freeze({
  description:
    "Mosaic has not selected an identity provider or browser session mechanism. Hosted data and actions remain unavailable until that owner decision is approved.",
  status: "decision_required" as const,
  title: "Hosted access is not configured",
})

export type HostedAccessDecision = typeof hostedAccessDecision
