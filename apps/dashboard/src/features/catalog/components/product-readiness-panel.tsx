import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle"

import {
  readinessStateLabel,
  type ProductReadinessView,
} from "@/features/catalog/types/connected-product-view"

export function ProductReadinessPanel({
  accessHref,
  manageProvidersHref,
  readiness,
}: {
  accessHref: string
  manageProvidersHref: string
  readiness: ProductReadinessView
}) {
  const blockers = readiness.issues.filter((issue) => issue.severity === "blocker")
  const warnings = readiness.issues.filter((issue) => issue.severity === "warning")
  const healthy = readiness.state === "connected" && blockers.length === 0

  return (
    <section aria-labelledby="connected-readiness-title" className="rounded border">
      <header className="border-b px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold" id="connected-readiness-title">
              Connected readiness
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Authoritative for one explicit Environment, Application, and platform.
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
              {readiness.environmentId} · {readiness.applicationId} ·{" "}
              {readiness.platform.toUpperCase()}
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
                title="Blocking issues"
                tone="danger"
              />
            ) : null}
            {warnings.length > 0 ? (
              <IssueList
                accessHref={accessHref}
                issues={warnings}
                manageProvidersHref={manageProvidersHref}
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
  title,
  tone,
}: {
  issues: ProductReadinessView["issues"]
  accessHref: string
  manageProvidersHref: string
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
            <p>{readinessIssueLabel(issue.code)}</p>
            <a
              className="text-primary mt-1 inline-flex text-xs font-semibold"
              href={recoveryHref(issue.recoveryAction, accessHref, manageProvidersHref)}
            >
              {recoveryLabel(issue.recoveryAction)}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

function readinessIssueLabel(code: string) {
  switch (code) {
    case "mappingMissing":
      return "This Product is not mapped to the active commerce provider."
    case "metadataStale":
      return "Connected Product details need to be synchronized."
    case "entitlementGrantMissing":
      return "This Product does not grant an Access definition."
    case "connectionUnavailable":
      return "The active commerce connection is unavailable."
    default:
      return "Connected commerce setup needs attention before publishing."
  }
}

function recoveryHref(action: string, accessHref: string, manageProvidersHref: string) {
  return action === "addEntitlementGrant" ? accessHref : manageProvidersHref
}

function recoveryLabel(action: string) {
  switch (action) {
    case "addEntitlementGrant":
      return "Add Access"
    case "fixProductMapping":
      return "Review Product mapping"
    case "reconnectProvider":
      return "Reconnect provider"
    case "selectActiveProvider":
      return "Select active provider"
    case "syncProviderMetadata":
      return "Synchronize Product details"
    default:
      return "Review commerce setup"
  }
}
