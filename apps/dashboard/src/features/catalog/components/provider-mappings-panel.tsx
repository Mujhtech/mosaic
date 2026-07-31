import type { ProviderMappingView } from "@/features/catalog/types/connected-product-view"

export function ProviderMappingsPanel({
  manageProvidersHref,
  mappings,
}: {
  manageProvidersHref: string
  mappings: readonly ProviderMappingView[]
}) {
  return (
    <section aria-labelledby="provider-mappings-title" className="rounded border">
      <header className="border-b px-5 py-4">
        <h2 className="text-sm font-semibold" id="provider-mappings-title">
          Provider mappings
        </h2>
        <p className="text-muted-foreground mt-1 text-sm leading-6">
          Provider-owned identifiers and synchronization state are read-only. The current API does
          not return localized price or other display metadata here.
        </p>
      </header>
      <div className="p-5">
        {mappings.length === 0 ? (
          <div className="rounded border border-dashed p-4">
            <p className="text-sm font-semibold">No provider mapping</p>
            <p className="text-muted-foreground mt-1 text-sm leading-6">
              This Product remains available for simulated preview, but connected publishing needs
              an explicit active provider and verified mapping.
            </p>
            <a
              className="text-primary mt-3 inline-flex text-sm font-medium"
              href={manageProvidersHref}
            >
              Review Commerce providers
            </a>
          </div>
        ) : (
          <ul className="space-y-3">
            {mappings.map((mapping) => (
              <li className="rounded border p-4" key={mapping.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{mapping.providerLabel}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {mapping.connectionLabel} · {mapping.status}
                    </p>
                  </div>
                  <span className="border-border bg-muted rounded-full border px-2.5 py-1 text-xs font-medium capitalize">
                    {syncStateLabel(mapping.syncState)}
                  </span>
                </div>
                <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <MappingField
                    label="Provider Product ID"
                    value={mapping.providerProductIdentifier}
                  />
                  <MappingField label="Environment" value={mapping.environmentLabel} />
                  <MappingField label="Application" value={mapping.applicationLabel} />
                  <MappingField label="Platform" value={mapping.platformLabel} />
                  <MappingField label="Availability" value={mapping.availability} />
                  {mapping.providerOfferingIdentifier ? (
                    <MappingField label="Offering" value={mapping.providerOfferingIdentifier} />
                  ) : null}
                  {mapping.providerPackageIdentifier ? (
                    <MappingField label="Package" value={mapping.providerPackageIdentifier} />
                  ) : null}
                </dl>
                <p className="text-muted-foreground mt-3 text-xs">
                  {mapping.connectionLastSuccessfulSyncAt
                    ? `Connection last synchronized ${mapping.connectionLastSuccessfulSyncAt}. This timestamp is not mapping-specific.`
                    : "The connection has never reported a successful synchronization."}
                </p>
                {mapping.lastErrorCode ? (
                  <p className="text-destructive mt-2 text-xs" role="status">
                    Last mapping error: {mapping.lastErrorCode}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-3 text-sm">
                  <a className="text-primary font-medium" href="#used-in-title">
                    View usage
                  </a>
                  <span className="text-muted-foreground">
                    Replacement is unavailable until the provider contract is active.
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function syncStateLabel(syncState: ProviderMappingView["syncState"]) {
  switch (syncState) {
    case "never_synced":
      return "Never synchronized"
    case "current":
      return "Current"
    case "stale":
      return "Stale"
    case "failed":
      return "Synchronization failed"
  }
}

function MappingField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-1 font-mono text-xs break-all">{value}</dd>
    </div>
  )
}
