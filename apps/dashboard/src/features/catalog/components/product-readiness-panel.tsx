import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle"

import {
  readinessStateLabel,
  type ProductReadinessView,
} from "@/features/catalog/types/connected-product-view"
import {
  providerRecoveryDescriptor,
  providerRecoveryHref,
} from "@/features/catalog/types/provider-recovery"

export function ProductReadinessPanel({
  accessHref,
  applicationsHref,
  manageProvidersHref,
  mappingHref = "#provider-mappings-title",
  readiness,
  scopeLabel,
}: {
  accessHref: string
  applicationsHref: string
  manageProvidersHref: string
  mappingHref?: string
  readiness: ProductReadinessView
  scopeLabel?: string
}) {
  const blockers = readiness.issues.filter((issue) => issue.severity === "blocker")
  const warnings = readiness.issues.filter((issue) => issue.severity === "warning")
  const healthy =
    ["configured", "connected", "verifiedInTest"].includes(readiness.state as string) &&
    blockers.length === 0

  return (
    <section aria-labelledby="connected-readiness-title" className="rounded border">
      <header className="border-b px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold" id="connected-readiness-title">
              Purchase readiness
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Authoritative for one explicit Mosaic Environment, Application, and platform.
            </p>
          </div>
          <span
            className={
              healthy
                ? "border-primary/25 bg-primary/5 text-primary rounded-full border px-2.5 py-1 text-xs font-semibold"
                : "border-border bg-muted text-foreground rounded-full border px-2.5 py-1 text-xs font-semibold"
            }
          >
            {readinessStateLabel(readiness.state)}
          </span>
        </div>
      </header>
      <div className="space-y-4 p-5">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="rounded border p-3">
            <dt className="text-muted-foreground text-xs">Scope</dt>
            <dd className="mt-1 text-sm font-medium">
              {scopeLabel ??
                `${readiness.environmentId} · ${readiness.applicationId} · ${readiness.platform.toUpperCase()}`}
            </dd>
          </div>
          <div className="rounded border p-3">
            <dt className="text-muted-foreground text-xs">Evaluated</dt>
            <dd className="mt-1 text-sm font-medium">{readiness.evaluatedAt}</dd>
          </div>
        </dl>

        {readiness.issues.length === 0 ? (
          <p className="text-sm">No scoped provider readiness issues were reported.</p>
        ) : (
          <div className="space-y-3">
            {blockers.length > 0 ? (
              <IssueList
                accessHref={accessHref}
                issues={blockers}
                manageProvidersHref={manageProvidersHref}
                mappingHref={mappingHref}
                title="Blocking issues"
                tone="danger"
              />
            ) : null}
            {warnings.length > 0 ? (
              <IssueList
                accessHref={accessHref}
                issues={warnings}
                manageProvidersHref={manageProvidersHref}
                mappingHref={mappingHref}
                title="Warnings"
                tone="neutral"
              />
            ) : null}
          </div>
        )}
      </div>
    </section>
  )
}

function IssueList({
  issues,
  accessHref,
  manageProvidersHref,
  mappingHref,
  title,
  tone,
}: {
  issues: ProductReadinessView["issues"]
  accessHref: string
  manageProvidersHref: string
  mappingHref: string
  title: string
  tone: "danger" | "neutral"
}) {
  return (
    <section
      aria-label={title}
      className={
        tone === "danger"
          ? "border-destructive/25 bg-destructive/5 rounded border p-3"
          : "border-border bg-muted/35 rounded border p-3"
      }
      role={tone === "danger" ? "alert" : "status"}
    >
      <p className="flex items-center gap-2 text-sm font-semibold">
        <WarningCircleIcon
          aria-hidden
          className={tone === "danger" ? "text-destructive" : undefined}
          size={17}
        />
        {title}
      </p>
      <ul className="mt-2 space-y-2 text-sm">
        {issues.map((issue) => (
          <li key={`${issue.code}:${issue.resourceType}:${issue.resourceId}`}>
            <p>{readinessIssueLabel(issue.code, issue.recoveryAction)}</p>
            <a
              className="text-primary mt-1 inline-flex text-xs font-semibold"
              href={providerRecoveryHref(issue.recoveryAction, {
                access: accessHref,
                applications: applicationsHref,
                lifecycle: "#lifecycle-title",
                mapping: mappingHref,
                providers: manageProvidersHref,
              })}
            >
              {providerRecoveryDescriptor(issue.recoveryAction).label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

function readinessIssueLabel(code: string, action: string) {
  if (
    action === "runNativeProviderTest" ||
    action === "rerunNativeProviderTest" ||
    action === "createNativeProviderMapping" ||
    action === "addGoogleBasePlan" ||
    action === "archiveDuplicateMappings" ||
    action === "grantEntitlement"
  ) {
    return providerRecoveryDescriptor(action).message
  }
  switch (code) {
    case "mappingMissing":
      return "This Product is not mapped to the active purchase provider."
    case "metadataStale":
      return "Connected-provider catalog metadata is stale."
    case "entitlementGrantMissing":
      return "This Product does not grant an Access definition."
    case "connectionUnavailable":
      return "The active purchase provider is unavailable."
    case "commerce.mapping.basePlanMissing":
      return "This Google Play subscription needs an exact base plan."
    case "commerce.mapping.offerMissing":
      return "The selected Google Play offer is missing."
    case "commerce.mapping.offerIneligible":
      return "The selected Google Play offer is not eligible for this test context."
    case "commerce.provider.platformMismatch":
      return "The active provider is not compatible with this Application platform."
    case "commerce.observation.missing":
      return "This mapping is configured but has not been observed by an accepted test client."
    case "commerce.observation.stale":
      return "The latest test-client observation is stale."
    default:
      return "Purchase setup needs attention before publishing."
  }
}
