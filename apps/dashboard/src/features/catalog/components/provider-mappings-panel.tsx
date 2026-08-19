import { type Dispatch, useId, useReducer } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProviderMappingView } from "@/features/catalog/types/connected-product-view";
import { validateNativeProviderMapping } from "@/features/catalog/types/native-provider-mapping";
import type {
  ProviderMappingUsage,
  ReplaceProviderMappingRequest,
} from "@/generated/api";

type ProductType = "one_time_non_consumable" | "subscription";
type OfferSelection = "none" | "specific";

/**
 * The one mapping being reviewed for replacement, and everything known about
 * it.
 *
 * These six values only ever change together: opening the editor discards the
 * previous mapping's usage, its loading and failure state, and its draft
 * replacement in the same breath. Keeping them as separate `useState` values
 * made that a six-call sequence every caller had to get right, and a missed
 * call left one row's usage attached to another row's editor.
 */
interface MappingEditingState {
  editingId: string | null;
  replacement: ReplaceProviderMappingRequest;
  replacementOfferSelection: OfferSelection;
  usage: ProviderMappingUsage | null;
  usageError: Error | null;
  usagePending: boolean;
}

type MappingEditingAction =
  | { type: "closeEditing" }
  | { error: Error; type: "usageFailed" }
  | {
      mappingId: string;
      offerSelection: OfferSelection;
      replacement: ReplaceProviderMappingRequest;
      type: "beginEditing";
    }
  | { patch: Partial<ReplaceProviderMappingRequest>; type: "setReplacement" }
  | { pending: boolean; type: "usagePending" }
  | { selection: OfferSelection; type: "selectOffer" }
  | { type: "usageLoaded"; usage: ProviderMappingUsage };

const initialEditingState: MappingEditingState = {
  editingId: null,
  replacement: { providerProductIdentifier: "" },
  replacementOfferSelection: "none",
  usage: null,
  usageError: null,
  usagePending: false,
};

function mappingEditingReducer(
  state: MappingEditingState,
  action: MappingEditingAction
): MappingEditingState {
  switch (action.type) {
    case "beginEditing":
      return {
        ...state,
        editingId: action.mappingId,
        replacement: action.replacement,
        replacementOfferSelection: action.offerSelection,
        usage: null,
        usageError: null,
      };
    case "closeEditing":
      return { ...state, editingId: null, usage: null, usageError: null };
    case "usagePending":
      return action.pending
        ? { ...state, usageError: null, usagePending: true }
        : { ...state, usagePending: false };
    case "usageLoaded":
      return { ...state, usage: action.usage };
    case "usageFailed":
      return { ...state, usageError: action.error };
    case "setReplacement":
      return {
        ...state,
        replacement: { ...state.replacement, ...action.patch },
      };
    case "selectOffer":
      return action.selection === "none"
        ? {
            ...state,
            replacement: {
              ...state.replacement,
              providerOfferIdentifier: undefined,
            },
            replacementOfferSelection: "none",
          }
        : { ...state, replacementOfferSelection: "specific" };
    default: {
      const unhandled: never = action;
      throw new Error(`Unhandled action: ${JSON.stringify(unhandled)}`);
    }
  }
}

function loadMappingUsage(
  mappingId: string,
  dispatch: Dispatch<MappingEditingAction>,
  onLoadUsage: (mappingId: string) => Promise<ProviderMappingUsage>
) {
  dispatch({ pending: true, type: "usagePending" });
  onLoadUsage(mappingId)
    .then((usage) => dispatch({ type: "usageLoaded", usage }))
    .catch((loadError: unknown) =>
      dispatch({
        error:
          loadError instanceof Error
            ? loadError
            : new Error("Mapping usage could not be loaded."),
        type: "usageFailed",
      })
    )
    .finally(() => dispatch({ pending: false, type: "usagePending" }));
}

function replacementFromMapping(
  mapping: ProviderMappingView
): ReplaceProviderMappingRequest {
  return {
    providerProductIdentifier: mapping.providerProductIdentifier,
    ...(mapping.providerOfferingIdentifier
      ? { providerOfferingIdentifier: mapping.providerOfferingIdentifier }
      : {}),
    ...(mapping.providerPackageIdentifier
      ? { providerPackageIdentifier: mapping.providerPackageIdentifier }
      : {}),
    ...(mapping.providerBasePlanIdentifier
      ? { providerBasePlanIdentifier: mapping.providerBasePlanIdentifier }
      : {}),
    ...(mapping.providerOfferIdentifier
      ? { providerOfferIdentifier: mapping.providerOfferIdentifier }
      : {}),
  };
}

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
  productType?: ProductType;
}) {
  const fieldIds = useId();
  const [editing, dispatch] = useReducer(
    mappingEditingReducer,
    initialEditingState
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
              <MappingRow
                canManage={canManage}
                dispatch={dispatch}
                editing={editing}
                fieldIds={fieldIds}
                isPending={isPending}
                key={mapping.id}
                mapping={mapping}
                membersHref={membersHref}
                onArchive={onArchive}
                onLoadUsage={onLoadUsage}
                onReplace={onReplace}
                productType={productType}
              />
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

function MappingRow({
  canManage,
  dispatch,
  editing,
  fieldIds,
  isPending,
  mapping,
  membersHref,
  onArchive,
  onLoadUsage,
  onReplace,
  productType,
}: {
  canManage: boolean;
  dispatch: Dispatch<MappingEditingAction>;
  editing: MappingEditingState;
  fieldIds: string;
  isPending: boolean;
  mapping: ProviderMappingView;
  membersHref?: string;
  onArchive?: (mappingId: string) => Promise<void>;
  onLoadUsage?: (mappingId: string) => Promise<ProviderMappingUsage>;
  onReplace?: (
    mappingId: string,
    body: ReplaceProviderMappingRequest
  ) => Promise<void>;
  productType?: ProductType;
}) {
  const isEditing = editing.editingId === mapping.id;
  const toggleEditing = () => {
    if (isEditing) {
      dispatch({ type: "closeEditing" });
      return;
    }
    dispatch({
      mappingId: mapping.id,
      offerSelection: mapping.providerOfferIdentifier ? "specific" : "none",
      replacement: replacementFromMapping(mapping),
      type: "beginEditing",
    });
    if (onLoadUsage) {
      loadMappingUsage(mapping.id, dispatch, onLoadUsage);
    }
  };
  return (
    <li className="rounded border p-4">
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
      <MappingIdentifiers mapping={mapping} />
      <p className="mt-3 text-muted-foreground text-xs">
        {synchronizationEvidence(mapping)}
      </p>
      {mapping.lastErrorCode ? (
        <p className="mt-2 text-destructive text-xs" role="status">
          Last mapping error: {mapping.lastErrorCode}
        </p>
      ) : null}
      <MappingObservation mapping={mapping} />
      <MappingRowActions
        canEdit={
          mapping.status !== "archived" && Boolean(onReplace && onArchive)
        }
        mapping={mapping}
        onToggleEditing={toggleEditing}
      />
      {isEditing && onReplace && onArchive ? (
        <MappingReplacementForm
          canManage={canManage}
          dispatch={dispatch}
          editing={editing}
          fieldIds={fieldIds}
          isPending={isPending}
          mapping={mapping}
          membersHref={membersHref}
          onArchive={onArchive}
          onLoadUsage={onLoadUsage}
          onReplace={onReplace}
          productType={productType}
        />
      ) : null}
    </li>
  );
}

function MappingIdentifiers({ mapping }: { mapping: ProviderMappingView }) {
  return (
    <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <MappingField
        label={(() => {
          if (mapping.provider === "app_store") {
            return "StoreKit Product ID";
          }
          if (mapping.provider === "google_play") {
            return "Google Play Product ID";
          }
          return "Provider catalog resource";
        })()}
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
        <MappingField label="Metadata source" value={mapping.snapshotSource} />
      ) : null}
    </dl>
  );
}

function MappingObservation({ mapping }: { mapping: ProviderMappingView }) {
  if (mapping.latestObservation) {
    return (
      <div className="mt-3 rounded border bg-muted/40 p-3 text-xs">
        <p className="font-semibold">
          Test-client observation ·{" "}
          {observationContext(mapping.latestObservation.storeContext)}
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
                    typeof value === "string" ? value : JSON.stringify(value)
                  }
                />
              )
            )}
          </dl>
        ) : null}
      </div>
    );
  }
  if (
    mapping.providerLabel === "StoreKit" ||
    mapping.providerLabel === "Google Play Billing"
  ) {
    return (
      <p className="mt-3 text-muted-foreground text-xs">
        No accepted test-client observation. This mapping is configured, not
        verified in test.
      </p>
    );
  }
  return null;
}

function MappingRowActions({
  canEdit,
  mapping,
  onToggleEditing,
}: {
  canEdit: boolean;
  mapping: ProviderMappingView;
  onToggleEditing: () => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-3 text-sm">
      {/* The target exists at runtime: WorkflowPanel derives
          id="used-in-title" from the "Used in" panel title, and
          connected-product-panels.test.tsx asserts the contract. */}
      {/* react-doctor-disable-next-line react-doctor/anchor-target-exists */}
      <a className="font-medium text-primary" href="#used-in-title">
        View usage
      </a>
      <span className="text-muted-foreground">
        {(() => {
          if (
            mapping.syncState === "current" &&
            mapping.availability === "available"
          ) {
            return "Ready for scoped publishing when Entitlement grants and active-provider assignment also pass.";
          }
          if (
            mapping.providerLabel === "StoreKit" ||
            mapping.providerLabel === "Google Play Billing"
          ) {
            return "Recovery: inspect the exact store mapping, test-client observation, and diagnostics.";
          }
          return "Recovery: open Purchase setup, test the connection, then retry synchronization.";
        })()}
      </span>
      {canEdit ? (
        <Button
          onClick={onToggleEditing}
          size="sm"
          type="button"
          variant="outline"
        >
          Review mapping change
        </Button>
      ) : null}
    </div>
  );
}

function MappingReplacementForm({
  canManage,
  dispatch,
  editing,
  fieldIds,
  isPending,
  mapping,
  membersHref,
  onArchive,
  onLoadUsage,
  onReplace,
  productType,
}: {
  canManage: boolean;
  dispatch: Dispatch<MappingEditingAction>;
  editing: MappingEditingState;
  fieldIds: string;
  isPending: boolean;
  mapping: ProviderMappingView;
  membersHref?: string;
  onArchive: (mappingId: string) => Promise<void>;
  onLoadUsage?: (mappingId: string) => Promise<ProviderMappingUsage>;
  onReplace: (
    mappingId: string,
    body: ReplaceProviderMappingRequest
  ) => Promise<void>;
  productType?: ProductType;
}) {
  return (
    <div className="mt-4 rounded border border-border bg-muted/35 p-4">
      <p className="font-semibold text-sm">Replace or archive this mapping</p>
      <p className="mt-1 text-muted-foreground text-xs">
        Mapping-specific usage must load before confirmation. Replacement
        creates a new mapping; history remains immutable.
      </p>
      <MappingUsageSummary
        editing={editing}
        onRetry={() => {
          if (!onLoadUsage) {
            return;
          }
          loadMappingUsage(mapping.id, dispatch, onLoadUsage);
        }}
      />
      <MappingReplacementFields
        dispatch={dispatch}
        editing={editing}
        fieldIds={fieldIds}
        mapping={mapping}
        productType={productType}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {(() => {
          if (canManage) {
            return (
              <>
                <Button
                  disabled={
                    isPending ||
                    !editing.usage ||
                    !replacementIsValid(
                      mapping,
                      productType,
                      editing.replacement,
                      editing.replacementOfferSelection
                    )
                  }
                  onClick={async () => {
                    await onReplace(mapping.id, {
                      ...editing.replacement,
                      providerProductIdentifier:
                        editing.replacement.providerProductIdentifier.trim(),
                    });
                    dispatch({ type: "closeEditing" });
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
                    dispatch({ type: "closeEditing" });
                  }}
                  size="sm"
                  type="button"
                  variant="destructive"
                >
                  Archive mapping
                </Button>
              </>
            );
          }
          if (membersHref) {
            return (
              <a
                className="font-semibold text-primary text-xs"
                href={membersHref}
              >
                Ask an Owner or Admin to change this mapping
              </a>
            );
          }
          return null;
        })()}
        <Button
          disabled={isPending}
          onClick={() => dispatch({ type: "closeEditing" })}
          size="sm"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function MappingUsageSummary({
  editing,
  onRetry,
}: {
  editing: MappingEditingState;
  onRetry: () => void;
}) {
  if (editing.usagePending) {
    return (
      <p className="mt-3 text-muted-foreground text-xs" role="status">
        Loading affected Product, Plans, Access grants, mappings, and historical
        references…
      </p>
    );
  }
  if (editing.usageError) {
    return (
      <div className="mt-3 rounded border border-destructive/40 p-3">
        <p className="text-destructive text-xs" role="alert">
          Usage could not be loaded. Replacement remains disabled.
        </p>
        <Button
          className="mt-2"
          onClick={onRetry}
          size="sm"
          type="button"
          variant="outline"
        >
          Retry usage
        </Button>
      </div>
    );
  }
  if (editing.usage) {
    const { usage } = editing.usage;
    return (
      <p className="mt-3 rounded border bg-background p-3 text-xs">
        {usage.plans.length} Plan{usage.plans.length === 1 ? "" : "s"} ·{" "}
        {usage.entitlements.length} Access grant
        {usage.entitlements.length === 1 ? "" : "s"} ·{" "}
        {usage.historicalReferences.length} historical reference
        {usage.historicalReferences.length === 1 ? "" : "s"}
      </p>
    );
  }
  return null;
}

function MappingReplacementFields({
  dispatch,
  editing,
  fieldIds,
  mapping,
  productType,
}: {
  dispatch: Dispatch<MappingEditingAction>;
  editing: MappingEditingState;
  fieldIds: string;
  mapping: ProviderMappingView;
  productType?: ProductType;
}) {
  const { replacement, replacementOfferSelection } = editing;
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      <label className="font-medium text-xs" htmlFor={`${fieldIds}-field-1`}>
        {(() => {
          if (mapping.provider === "app_store") {
            return "StoreKit Product ID";
          }
          if (mapping.provider === "google_play") {
            return "Google Play Product ID";
          }
          return "Provider Product resource";
        })()}
        <Input
          className="mt-1"
          id={`${fieldIds}-field-1`}
          onChange={(event) =>
            dispatch({
              patch: {
                providerProductIdentifier: event.currentTarget.value,
              },
              type: "setReplacement",
            })
          }
          value={replacement.providerProductIdentifier}
        />
      </label>
      {(() => {
        if (
          mapping.provider === "google_play" &&
          productType === "subscription"
        ) {
          return (
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
                    dispatch({
                      patch: {
                        providerBasePlanIdentifier:
                          event.currentTarget.value || undefined,
                      },
                      type: "setReplacement",
                    })
                  }
                  value={replacement.providerBasePlanIdentifier ?? ""}
                />
              </label>
              <fieldset className="space-y-2 text-xs">
                <legend className="font-medium">Offer</legend>
                <label className="flex gap-2">
                  <input
                    checked={replacementOfferSelection === "none"}
                    name={`replacement-offer-${mapping.id}`}
                    onChange={() =>
                      dispatch({ selection: "none", type: "selectOffer" })
                    }
                    type="radio"
                  />
                  No offer
                </label>
                <label className="flex gap-2">
                  <input
                    checked={replacementOfferSelection === "specific"}
                    name={`replacement-offer-${mapping.id}`}
                    onChange={() =>
                      dispatch({ selection: "specific", type: "selectOffer" })
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
                      dispatch({
                        patch: {
                          providerOfferIdentifier:
                            event.currentTarget.value || undefined,
                        },
                        type: "setReplacement",
                      })
                    }
                    value={replacement.providerOfferIdentifier ?? ""}
                  />
                </label>
              ) : null}
            </>
          );
        }
        if (
          mapping.provider !== "app_store" &&
          mapping.provider !== "google_play"
        ) {
          return (
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
                    dispatch({
                      patch: {
                        providerOfferingIdentifier:
                          event.currentTarget.value || undefined,
                      },
                      type: "setReplacement",
                    })
                  }
                  value={replacement.providerOfferingIdentifier ?? ""}
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
                    dispatch({
                      patch: {
                        providerPackageIdentifier:
                          event.currentTarget.value || undefined,
                      },
                      type: "setReplacement",
                    })
                  }
                  value={replacement.providerPackageIdentifier ?? ""}
                />
              </label>
            </>
          );
        }
        return null;
      })()}
    </div>
  );
}

function synchronizationEvidence(mapping: ProviderMappingView) {
  if (mapping.provider === "app_store" || mapping.provider === "google_play") {
    if (mapping.latestObservation) {
      return `Observed by a ${observationContext(mapping.latestObservation.storeContext)} test client at ${mapping.latestObservation.observedAt}${mapping.latestObservation.expiresAt ? `; expires ${mapping.latestObservation.expiresAt}` : ""}.`;
    }
    return "Configured with an exact store identifier. No accepted test-client observation exists yet.";
  }
  if (mapping.snapshotSyncedAt) {
    return `Snapshot observed ${mapping.snapshotObservedAt}, synchronized ${mapping.snapshotSyncedAt}, stale after ${mapping.snapshotStaleAt}${mapping.snapshotExpiresAt ? `, expires ${mapping.snapshotExpiresAt}` : ""}. Runtime SDKs still resolve live localized metadata.`;
  }
  if (mapping.connectionLastSuccessfulSyncAt) {
    return `Connection last synchronized ${mapping.connectionLastSuccessfulSyncAt}. Mapping state is ${syncStateLabel(mapping.syncState).toLowerCase()}.`;
  }
  return "The connection has never reported a successful synchronization.";
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
  productType: ProductType | undefined,
  replacement: ReplaceProviderMappingRequest,
  offerSelection: OfferSelection
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
