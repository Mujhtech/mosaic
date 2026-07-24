import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { ProviderMappingView } from "@/features/catalog/types/connected-product-view"
import type { ReplaceProviderMappingRequest } from "@/generated/api"

export function ProviderMappingsPanel({
  error,
  isPending = false,
  manageProvidersHref,
  mappings,
  onArchive,
  onReplace,
}: {
  error?: Error | null
  isPending?: boolean
  manageProvidersHref: string
  mappings: readonly ProviderMappingView[]
  onArchive?: (mappingId: string) => Promise<void>
  onReplace?: (mappingId: string, body: ReplaceProviderMappingRequest) => Promise<void>
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [replacement, setReplacement] = useState<ReplaceProviderMappingRequest>({
    providerProductIdentifier: "",
  })
  return (
    <section aria-labelledby="provider-mappings-title" className="rounded border">
      <header className="border-b px-5 py-4">
        <h2 className="text-sm font-semibold" id="provider-mappings-title">
          Provider mappings
        </h2>
        <p className="text-muted-foreground mt-1 text-sm leading-6">
          Provider-owned identifiers, availability, and synchronization evidence are read-only.
          Mosaic-owned names, keys, Plan membership, and Entitlement grants remain editable
          separately.
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
                    label="Provider catalog resource"
                    value={mapping.providerProductIdentifier}
                  />
                  <MappingField
                    label="Store Product ID"
                    value={mapping.expectedStoreProductId ?? "Awaiting verified synchronization"}
                  />
                  <MappingField label="Environment" value={mapping.environmentLabel} />
                  <MappingField label="Application" value={mapping.applicationLabel} />
                  <MappingField label="Platform" value={mapping.platformLabel} />
                  <MappingField label="Availability" value={mapping.availability} />
                  <MappingField
                    label="Provider display name"
                    value={mapping.providerDisplayName ?? "Unavailable"}
                  />
                  <MappingField
                    label="Provider Product"
                    value={
                      mapping.providerProductType || mapping.providerProductState
                        ? [mapping.providerProductType, mapping.providerProductState]
                            .filter(Boolean)
                            .join(" · ")
                        : "Unavailable"
                    }
                  />
                  <MappingField
                    label="Metadata snapshot"
                    value={mapping.snapshotId ?? "No synchronized snapshot"}
                  />
                  {mapping.providerOfferingIdentifier ? (
                    <MappingField label="Offering" value={mapping.providerOfferingIdentifier} />
                  ) : null}
                  {mapping.providerPackageIdentifier ? (
                    <MappingField label="Package" value={mapping.providerPackageIdentifier} />
                  ) : null}
                </dl>
                <p className="text-muted-foreground mt-3 text-xs">
                  {mapping.snapshotSyncedAt
                    ? `Snapshot observed ${mapping.snapshotObservedAt}, synchronized ${mapping.snapshotSyncedAt}, stale after ${mapping.snapshotStaleAt}${mapping.snapshotExpiresAt ? `, expires ${mapping.snapshotExpiresAt}` : ""}. Runtime SDKs still resolve live localized metadata.`
                    : mapping.connectionLastSuccessfulSyncAt
                      ? `Connection last synchronized ${mapping.connectionLastSuccessfulSyncAt}. Mapping state is ${syncStateLabel(mapping.syncState).toLowerCase()}.`
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
                    {mapping.syncState === "current" && mapping.availability === "available"
                      ? "Ready for scoped publishing when Entitlement grants and active-provider assignment also pass."
                      : "Recovery: open Commerce providers, test the connection, then retry synchronization."}
                  </span>
                  {mapping.status !== "archived" && onReplace && onArchive ? (
                    <Button
                      onClick={() => {
                        setEditingId(editingId === mapping.id ? null : mapping.id)
                        setReplacement({
                          providerProductIdentifier: mapping.providerProductIdentifier,
                          ...(mapping.providerOfferingIdentifier
                            ? {
                                providerOfferingIdentifier: mapping.providerOfferingIdentifier,
                              }
                            : {}),
                          ...(mapping.providerPackageIdentifier
                            ? { providerPackageIdentifier: mapping.providerPackageIdentifier }
                            : {}),
                        })
                      }}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Review mapping change
                    </Button>
                  ) : null}
                </div>
                {editingId === mapping.id && onReplace && onArchive ? (
                  <div className="border-border bg-muted/35 mt-4 rounded border p-4">
                    <p className="text-sm font-semibold">Replace or archive this mapping</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      Review the Product, Plan, Paywall, and historical usage shown above before
                      changing this mapping. Replacement creates a new mapping; history remains
                      immutable.
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <label className="text-xs font-medium">
                        Provider Product resource
                        <Input
                          className="mt-1"
                          onChange={(event) =>
                            setReplacement((current) => ({
                              ...current,
                              providerProductIdentifier: event.currentTarget.value,
                            }))
                          }
                          value={replacement.providerProductIdentifier}
                        />
                      </label>
                      <label className="text-xs font-medium">
                        Offering lookup key
                        <Input
                          className="mt-1"
                          onChange={(event) =>
                            setReplacement((current) => ({
                              ...current,
                              providerOfferingIdentifier: event.currentTarget.value || undefined,
                            }))
                          }
                          value={replacement.providerOfferingIdentifier ?? ""}
                        />
                      </label>
                      <label className="text-xs font-medium">
                        Package lookup key
                        <Input
                          className="mt-1"
                          onChange={(event) =>
                            setReplacement((current) => ({
                              ...current,
                              providerPackageIdentifier: event.currentTarget.value || undefined,
                            }))
                          }
                          value={replacement.providerPackageIdentifier ?? ""}
                        />
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        disabled={isPending || !replacement.providerProductIdentifier.trim()}
                        onClick={async () => {
                          await onReplace(mapping.id, {
                            ...replacement,
                            providerProductIdentifier: replacement.providerProductIdentifier.trim(),
                          })
                          setEditingId(null)
                        }}
                        size="sm"
                        type="button"
                      >
                        Replace mapping
                      </Button>
                      <Button
                        disabled={isPending}
                        onClick={async () => {
                          await onArchive(mapping.id)
                          setEditingId(null)
                        }}
                        size="sm"
                        type="button"
                        variant="destructive"
                      >
                        Archive mapping
                      </Button>
                      <Button
                        disabled={isPending}
                        onClick={() => setEditingId(null)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {error ? (
          <p className="text-destructive mt-3 text-sm" role="alert">
            {error.message}
          </p>
        ) : null}
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
