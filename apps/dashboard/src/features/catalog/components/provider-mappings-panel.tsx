import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProviderMappingView } from "@/features/catalog/types/connected-product-view";
import { validateNativeProviderMapping } from "@/features/catalog/types/native-provider-mapping";
import type {
  ProviderMappingUsage,
  ReplaceProviderMappingRequest,
} from "@/generated/api";

export function ProviderMappingsPanel({
  error,
  canManage = true,
  isPending = false,
  manageProvidersHref,
  membersHref,
  mappings,
  onArchive,
  onLoadUsage,
  onReplace,
  productType,
}: {
  canManage?: boolean;
  error?: Error | null;
  isPending?: boolean;
  manageProvidersHref: string;
  membersHref?: string;
  mappings: readonly ProviderMappingView[];
  onArchive?: (mappingId: string) => Promise<void>;
  onLoadUsage?: (mappingId: string) => Promise<ProviderMappingUsage>;
  onReplace?: (
    mappingId: string,
    body: ReplaceProviderMappingRequest
  ) => Promise<void>;
  productType?: "one_time_non_consumable" | "subscription";
}) {
  const fieldIds = useId();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [usage, setUsage] = useState<ProviderMappingUsage | null>(null);
  const [usageError, setUsageError] = useState<Error | null>(null);
  const [usagePending, setUsagePending] = useState(false);
  const [replacementOfferSelection, setReplacementOfferSelection] = useState<
    "none" | "specific"
  >("none");
  const [replacement, setReplacement] = useState<ReplaceProviderMappingRequest>(
    {
      providerProductIdentifier: "",
    }
  );
  return (
    <section
      aria-labelledby="provider-mappings-title"
      className="rounded border"
    >
      <header className="border-b px-5 py-4">
        <h2 className="font-semibold text-sm" id="provider-mappings-title">
          Provider mappings
        </h2>
        <p className="mt-1 text-muted-foreground text-sm leading-6">
          Provider-owned identifiers, availability, and synchronization evidence
          are read-only. Mosaic-owned names, keys, Plan membership, and
          Entitlement grants remain editable separately.
        </p>
      </header>
      <div className="p-5">
        {mappings.length === 0 ? (
          <div className="rounded border border-dashed p-4">
            <p className="font-semibold text-sm">No provider mapping</p>
            <p className="mt-1 text-muted-foreground text-sm leading-6">
              This Product remains available for simulated preview, but
              connected publishing needs an explicit active provider and
              verified mapping.
            </p>
            <a
              className="mt-3 inline-flex font-medium text-primary text-sm"
              href={manageProvidersHref}
            >
              Review Purchase setup
            </a>
          </div>
        ) : (
          <ul className="space-y-3">
            {mappings.map((mapping) => (
              <li className="rounded border p-4" key={mapping.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{mapping.providerLabel}</p>
                    <p className="mt-1 text-muted-foreground text-xs">
                      {mapping.connectionLabel} · {mapping.status}
                    </p>
                  </div>
                  <span className="rounded-full border border-border bg-muted px-2.5 py-1 font-medium text-xs capitalize">
                    {mappingStateLabel(mapping)}
                  </span>
                </div>
                <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <MappingField
                    label={
                      mapping.provider === "app_store"
                        ? "StoreKit Product ID"
                        : mapping.provider === "google_play"
                          ? "Google Play Product ID"
                          : "Provider catalog resource"
                    }
                    value={mapping.providerProductIdentifier}
                  />
                  {mapping.provider !== "app_store" &&
                  mapping.provider !== "google_play" ? (
                    <MappingField
                      label="Store Product ID"
                      value={
                        mapping.expectedStoreProductId ??
                        "Awaiting verified synchronization"
                      }
                    />
                  ) : null}
                  <MappingField
                    label="Environment"
                    value={mapping.environmentLabel}
                  />
                  <MappingField
                    label="Application"
                    value={mapping.applicationLabel}
                  />
                  <MappingField
                    label="Platform"
                    value={mapping.platformLabel}
                  />
                  <MappingField
                    label="Availability"
                    value={mapping.availability}
                  />
                  <MappingField
                    label="Provider display name"
                    value={mapping.providerDisplayName ?? "Unavailable"}
                  />
                  <MappingField
                    label="Provider Product"
                    value={
                      mapping.providerProductType ||
                      mapping.providerProductState
                        ? [
                            mapping.providerProductType,
                            mapping.providerProductState,
                          ]
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
                    <MappingField
                      label="Offering"
                      value={mapping.providerOfferingIdentifier}
                    />
                  ) : null}
                  {mapping.providerPackageIdentifier ? (
                    <MappingField
                      label="Package"
                      value={mapping.providerPackageIdentifier}
                    />
                  ) : null}
                  {mapping.providerBasePlanIdentifier ? (
                    <MappingField
                      label="Base plan"
                      value={mapping.providerBasePlanIdentifier}
                    />
                  ) : null}
                  {mapping.provider === "google_play" ? (
                    <MappingField
                      label="Offer"
                      value={mapping.providerOfferIdentifier ?? "No offer"}
                    />
                  ) : null}
                  {mapping.snapshotSource ? (
                    <MappingField
                      label="Metadata source"
                      value={mapping.snapshotSource}
                    />
                  ) : null}
                </dl>
                <p className="mt-3 text-muted-foreground text-xs">
                  {mapping.provider === "app_store" ||
                  mapping.provider === "google_play"
                    ? mapping.latestObservation
                      ? `Observed by a ${observationContext(mapping.latestObservation.storeContext)} test client at ${mapping.latestObservation.observedAt}${mapping.latestObservation.expiresAt ? `; expires ${mapping.latestObservation.expiresAt}` : ""}.`
                      : "Configured with an exact store identifier. No accepted test-client observation exists yet."
                    : mapping.snapshotSyncedAt
                      ? `Snapshot observed ${mapping.snapshotObservedAt}, synchronized ${mapping.snapshotSyncedAt}, stale after ${mapping.snapshotStaleAt}${mapping.snapshotExpiresAt ? `, expires ${mapping.snapshotExpiresAt}` : ""}. Runtime SDKs still resolve live localized metadata.`
                      : mapping.connectionLastSuccessfulSyncAt
                        ? `Connection last synchronized ${mapping.connectionLastSuccessfulSyncAt}. Mapping state is ${syncStateLabel(mapping.syncState).toLowerCase()}.`
                        : "The connection has never reported a successful synchronization."}
                </p>
                {mapping.lastErrorCode ? (
                  <p className="mt-2 text-destructive text-xs" role="status">
                    Last mapping error: {mapping.lastErrorCode}
                  </p>
                ) : null}
                {mapping.latestObservation ? (
                  <div className="mt-3 rounded border bg-muted/40 p-3 text-xs">
                    <p className="font-semibold">
                      Test-client observation ·{" "}
                      {observationContext(
                        mapping.latestObservation.storeContext
                      )}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {mapping.latestObservation.result} · observed{" "}
                      {mapping.latestObservation.observedAt} · received{" "}
                      {mapping.latestObservation.receivedAt} · adapter{" "}
                      {mapping.latestObservation.adapterVersion}
                      {mapping.latestObservation.expiresAt
                        ? ` · expires ${mapping.latestObservation.expiresAt}`
                        : ""}
                    </p>
                    {Object.keys(mapping.latestObservation.metadata).length ? (
                      <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                        {Object.entries(mapping.latestObservation.metadata).map(
                          ([key, value]) => (
                            <MappingField
                              key={key}
                              label={key}
                              value={
                                typeof value === "string"
                                  ? value
                                  : JSON.stringify(value)
                              }
                            />
                          )
                        )}
                      </dl>
                    ) : null}
                  </div>
                ) : mapping.providerLabel === "StoreKit" ||
                  mapping.providerLabel === "Google Play Billing" ? (
                  <p className="mt-3 text-muted-foreground text-xs">
                    No accepted test-client observation. This mapping is
                    configured, not verified in test.
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-3 text-sm">
                  <a className="font-medium text-primary" href="#used-in-title">
                    View usage
                  </a>
                  <span className="text-muted-foreground">
                    {mapping.syncState === "current" &&
                    mapping.availability === "available"
                      ? "Ready for scoped publishing when Entitlement grants and active-provider assignment also pass."
                      : mapping.providerLabel === "StoreKit" ||
                          mapping.providerLabel === "Google Play Billing"
                        ? "Recovery: inspect the exact store mapping, test-client observation, and diagnostics."
                        : "Recovery: open Purchase setup, test the connection, then retry synchronization."}
                  </span>
                  {mapping.status !== "archived" && onReplace && onArchive ? (
                    <Button
                      onClick={() => {
                        setEditingId(
                          editingId === mapping.id ? null : mapping.id
                        );
                        setUsage(null);
                        setUsageError(null);
                        setReplacementOfferSelection(
                          mapping.providerOfferIdentifier ? "specific" : "none"
                        );
                        setReplacement({
                          providerProductIdentifier:
                            mapping.providerProductIdentifier,
                          ...(mapping.providerOfferingIdentifier
                            ? {
                                providerOfferingIdentifier:
                                  mapping.providerOfferingIdentifier,
                              }
                            : {}),
                          ...(mapping.providerPackageIdentifier
                            ? {
                                providerPackageIdentifier:
                                  mapping.providerPackageIdentifier,
                              }
                            : {}),
                          ...(mapping.providerBasePlanIdentifier
                            ? {
                                providerBasePlanIdentifier:
                                  mapping.providerBasePlanIdentifier,
                              }
                            : {}),
                          ...(mapping.providerOfferIdentifier
                            ? {
                                providerOfferIdentifier:
                                  mapping.providerOfferIdentifier,
                              }
                            : {}),
                        });
                        if (editingId !== mapping.id && onLoadUsage) {
                          setUsagePending(true);
                          onLoadUsage(mapping.id)
                            .then(setUsage)
                            .catch((loadError: unknown) =>
                              setUsageError(
                                loadError instanceof Error
                                  ? loadError
                                  : new Error(
                                      "Mapping usage could not be loaded."
                                    )
                              )
                            )
                            .finally(() => setUsagePending(false));
                        }
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
                  <div className="mt-4 rounded border border-border bg-muted/35 p-4">
                    <p className="font-semibold text-sm">
                      Replace or archive this mapping
                    </p>
                    <p className="mt-1 text-muted-foreground text-xs">
                      Mapping-specific usage must load before confirmation.
                      Replacement creates a new mapping; history remains
                      immutable.
                    </p>
                    {usagePending ? (
                      <p
                        className="mt-3 text-muted-foreground text-xs"
                        role="status"
                      >
                        Loading affected Product, Plans, Access grants,
                        mappings, and historical references…
                      </p>
                    ) : usageError ? (
                      <div className="mt-3 rounded border border-destructive/40 p-3">
                        <p className="text-destructive text-xs" role="alert">
                          Usage could not be loaded. Replacement remains
                          disabled.
                        </p>
                        <Button
                          className="mt-2"
                          onClick={() => {
                            if (!onLoadUsage) {
                              return;
                            }
                            setUsageError(null);
                            setUsagePending(true);
                            onLoadUsage(mapping.id)
                              .then(setUsage)
                              .catch((loadError: unknown) =>
                                setUsageError(
                                  loadError instanceof Error
                                    ? loadError
                                    : new Error(
                                        "Mapping usage could not be loaded."
                                      )
                                )
                              )
                              .finally(() => setUsagePending(false));
                          }}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          Retry usage
                        </Button>
                      </div>
                    ) : usage ? (
                      <p className="mt-3 rounded border bg-background p-3 text-xs">
                        {usage.usage.plans.length} Plan
                        {usage.usage.plans.length === 1 ? "" : "s"} ·{" "}
                        {usage.usage.entitlements.length} Access grant
                        {usage.usage.entitlements.length === 1 ? "" : "s"} ·{" "}
                        {usage.usage.historicalReferences.length} historical
                        reference
                        {usage.usage.historicalReferences.length === 1
                          ? ""
                          : "s"}
                      </p>
                    ) : null}
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <label
                        className="font-medium text-xs"
                        htmlFor={`${fieldIds}-field-1`}
                      >
                        {mapping.provider === "app_store"
                          ? "StoreKit Product ID"
                          : mapping.provider === "google_play"
                            ? "Google Play Product ID"
                            : "Provider Product resource"}
                        <Input
                          className="mt-1"
                          id={`${fieldIds}-field-1`}
                          onChange={(event) =>
                            setReplacement((current) => ({
                              ...current,
                              providerProductIdentifier:
                                event.currentTarget.value,
                            }))
                          }
                          value={replacement.providerProductIdentifier}
                        />
                      </label>
                      {mapping.provider === "google_play" &&
                      productType === "subscription" ? (
                        <>
                          <label
                            className="font-medium text-xs"
                            htmlFor={`${fieldIds}-base-plan-id`}
                          >
                            Base plan ID
                            <Input
                              className="mt-1"
                              id={`${fieldIds}-base-plan-id`}
                              onChange={(event) =>
                                setReplacement((current) => ({
                                  ...current,
                                  providerBasePlanIdentifier:
                                    event.currentTarget.value || undefined,
                                }))
                              }
                              value={
                                replacement.providerBasePlanIdentifier ?? ""
                              }
                            />
                          </label>
                          <fieldset className="space-y-2 text-xs">
                            <legend className="font-medium">Offer</legend>
                            <label className="flex gap-2">
                              <input
                                checked={replacementOfferSelection === "none"}
                                name={`replacement-offer-${mapping.id}`}
                                onChange={() => {
                                  setReplacementOfferSelection("none");
                                  setReplacement((current) => ({
                                    ...current,
                                    providerOfferIdentifier: undefined,
                                  }));
                                }}
                                type="radio"
                              />
                              No offer
                            </label>
                            <label className="flex gap-2">
                              <input
                                checked={
                                  replacementOfferSelection === "specific"
                                }
                                name={`replacement-offer-${mapping.id}`}
                                onChange={() =>
                                  setReplacementOfferSelection("specific")
                                }
                                type="radio"
                              />
                              Use a specific offer
                            </label>
                          </fieldset>
                          {replacementOfferSelection === "specific" ? (
                            <label
                              className="font-medium text-xs"
                              htmlFor={`${fieldIds}-offer-id`}
                            >
                              Offer ID
                              <Input
                                className="mt-1"
                                id={`${fieldIds}-offer-id`}
                                onChange={(event) =>
                                  setReplacement((current) => ({
                                    ...current,
                                    providerOfferIdentifier:
                                      event.currentTarget.value || undefined,
                                  }))
                                }
                                value={
                                  replacement.providerOfferIdentifier ?? ""
                                }
                              />
                            </label>
                          ) : null}
                        </>
                      ) : mapping.provider !== "app_store" &&
                        mapping.provider !== "google_play" ? (
                        <>
                          <label
                            className="font-medium text-xs"
                            htmlFor={`${fieldIds}-offering-lookup-key`}
                          >
                            Offering lookup key
                            <Input
                              className="mt-1"
                              id={`${fieldIds}-offering-lookup-key`}
                              onChange={(event) =>
                                setReplacement((current) => ({
                                  ...current,
                                  providerOfferingIdentifier:
                                    event.currentTarget.value || undefined,
                                }))
                              }
                              value={
                                replacement.providerOfferingIdentifier ?? ""
                              }
                            />
                          </label>
                          <label
                            className="font-medium text-xs"
                            htmlFor={`${fieldIds}-package-lookup-key`}
                          >
                            Package lookup key
                            <Input
                              className="mt-1"
                              id={`${fieldIds}-package-lookup-key`}
                              onChange={(event) =>
                                setReplacement((current) => ({
                                  ...current,
                                  providerPackageIdentifier:
                                    event.currentTarget.value || undefined,
                                }))
                              }
                              value={
                                replacement.providerPackageIdentifier ?? ""
                              }
                            />
                          </label>
                        </>
                      ) : null}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {canManage ? (
                        <>
                          <Button
                            disabled={
                              isPending ||
                              !usage ||
                              !replacementIsValid(
                                mapping,
                                productType,
                                replacement,
                                replacementOfferSelection
                              )
                            }
                            onClick={async () => {
                              await onReplace(mapping.id, {
                                ...replacement,
                                providerProductIdentifier:
                                  replacement.providerProductIdentifier.trim(),
                              });
                              setEditingId(null);
                            }}
                            size="sm"
                            type="button"
                          >
                            Replace mapping
                          </Button>
                          <Button
                            disabled={isPending}
                            onClick={async () => {
                              await onArchive(mapping.id);
                              setEditingId(null);
                            }}
                            size="sm"
                            type="button"
                            variant="destructive"
                          >
                            Archive mapping
                          </Button>
                        </>
                      ) : membersHref ? (
                        <a
                          className="font-semibold text-primary text-xs"
                          href={membersHref}
                        >
                          Ask an Owner or Admin to change this mapping
                        </a>
                      ) : null}
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
          <p className="mt-3 text-destructive text-sm" role="alert">
            {error.message}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function syncStateLabel(syncState: ProviderMappingView["syncState"]) {
  switch (syncState) {
    case "never_synced":
      return "Never synchronized";
    case "current":
      return "Current";
    case "stale":
      return "Stale";
    case "failed":
      return "Synchronization failed";
    default: {
      const unhandled: never = syncState;
      throw new Error(`Unhandled syncState: ${JSON.stringify(unhandled)}`);
    }
  }
}

function mappingStateLabel(mapping: ProviderMappingView) {
  if (mapping.provider === "app_store" || mapping.provider === "google_play") {
    if (!mapping.latestObservation) {
      return "Configured";
    }
    if (
      mapping.latestObservation.expiresAt &&
      Date.parse(mapping.latestObservation.expiresAt) <= Date.now()
    ) {
      return "Observation stale";
    }
    return `Observed · ${mapping.latestObservation.result}`;
  }
  return syncStateLabel(mapping.syncState);
}

function replacementIsValid(
  mapping: ProviderMappingView,
  productType: "one_time_non_consumable" | "subscription" | undefined,
  replacement: ReplaceProviderMappingRequest,
  offerSelection: "none" | "specific"
) {
  if (mapping.provider !== "app_store" && mapping.provider !== "google_play") {
    return Boolean(replacement.providerProductIdentifier.trim());
  }
  if (!productType) {
    return false;
  }
  if (
    mapping.provider === "google_play" &&
    productType === "subscription" &&
    offerSelection === "specific" &&
    !replacement.providerOfferIdentifier?.trim()
  ) {
    return false;
  }
  return (
    Object.keys(
      validateNativeProviderMapping({
        applicationId: mapping.applicationLabel,
        environmentId: mapping.environmentLabel,
        productType,
        provider: mapping.provider,
        providerProductIdentifier: replacement.providerProductIdentifier,
        ...(mapping.provider === "google_play" && productType === "subscription"
          ? {
              googleBasePlanId: replacement.providerBasePlanIdentifier,
              ...(offerSelection === "specific"
                ? { googleOfferId: replacement.providerOfferIdentifier }
                : {}),
            }
          : {}),
      })
    ).length === 0
  );
}

function MappingField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-1 break-all font-mono text-xs">{value}</dd>
    </div>
  );
}

function observationContext(
  context: NonNullable<ProviderMappingView["latestObservation"]>["storeContext"]
) {
  switch (context) {
    case "storekitConfiguration":
      return "StoreKit Configuration";
    case "appleSandbox":
      return "Apple Sandbox";
    case "googlePlayTest":
      return "Google Play test";
    case "production":
      return "Production";
    case "unknown":
      return "Unknown";
    default: {
      const unhandled: never = context;
      throw new Error(`Unhandled context: ${JSON.stringify(unhandled)}`);
    }
  }
}
