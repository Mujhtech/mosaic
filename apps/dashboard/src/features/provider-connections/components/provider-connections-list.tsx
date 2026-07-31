import type { ProviderConnection } from "@/generated/api"

const PROVIDER_LABELS: Record<ProviderConnection["provider"], string> = {
  custom: "Custom provider",
  revenuecat: "RevenueCat",
}

const INTEGRATION_LABELS: Record<ProviderConnection["integrationMode"], string> = {
  sdk_only: "SDK-only",
  server_connected: "Server-connected",
}

export function ProviderConnectionsList({
  connections,
  organizationId,
  projectId,
}: {
  connections: readonly ProviderConnection[]
  organizationId: string
  projectId: string
}) {
  if (connections.length === 0) {
    return (
      <div className="rounded border border-dashed p-4">
        <p className="text-sm font-semibold">No provider connections</p>
        <p className="text-muted-foreground mt-1 text-sm leading-6">
          Connect RevenueCat to synchronize its catalog into stable Mosaic Products. Credentials are
          accepted once and are never returned by the API.
        </p>
      </div>
    )
  }

  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {connections.map((connection) => (
        <li className="rounded border p-4" key={connection.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium">{connection.name}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {PROVIDER_LABELS[connection.provider]} ·{" "}
                {INTEGRATION_LABELS[connection.integrationMode]} · {connection.mode}
              </p>
            </div>
            <span className="border-border bg-muted rounded-full border px-2.5 py-1 text-xs font-medium">
              {connection.status} · {connection.healthStatus}
            </span>
          </div>

          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <ConnectionField
              label="Environment scopes"
              value={`${connection.environmentIds.length}`}
            />
            <ConnectionField
              label="Application scopes"
              value={`${connection.applicationIds.length}`}
            />
            <ConnectionField
              label="Last successful test"
              value={connection.lastSuccessfulTestAt ?? "Never tested"}
            />
            <ConnectionField
              label="Last successful sync"
              value={connection.lastSuccessfulSyncAt ?? "Never synchronized"}
            />
          </dl>

          <p className="text-muted-foreground mt-3 text-xs leading-5">
            {connection.integrationMode === "sdk_only"
              ? "The host app supplies this custom provider at runtime. Mosaic stores only this non-secret connection metadata."
              : "Mosaic stores non-secret connection metadata here; provider credentials are never displayed again."}
          </p>
          {connection.lastErrorCode ? (
            <p className="text-destructive mt-2 text-xs" role="status">
              Last provider error: {connection.lastErrorCode}
            </p>
          ) : null}
          <a
            className="text-primary mt-3 inline-flex text-sm font-medium hover:underline"
            href={`/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/catalog/providers/${encodeURIComponent(connection.id)}`}
          >
            Open connection details
          </a>
        </li>
      ))}
    </ul>
  )
}

function ConnectionField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{value}</dd>
    </div>
  )
}
