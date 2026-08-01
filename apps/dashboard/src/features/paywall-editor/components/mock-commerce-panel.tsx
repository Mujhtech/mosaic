import { useQueries, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HostedAccessBanner } from "@/features/auth/components/hosted-access-banner";
import {
  productReadinessQueryOptions,
  productsQueryOptions,
  providerMappingMetadataQueryOptions,
  providerMappingObservationsQueryOptions,
  providerMappingsQueryOptions,
} from "@/features/catalog/queries/catalog-query";
import { MOCK_PURCHASE_STATES } from "@/features/paywall-editor/constants/editor-constants";
import {
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context";
import { useStudioSource } from "@/features/paywall-editor/stores/use-studio-source";
import type {
  MockProductDefinition,
  MockPurchaseState,
  MosaicDocument,
} from "@/features/paywall-editor/types/editor";
import {
  hostedStudioHref,
  type StudioSource,
} from "@/features/paywall-editor/types/studio-source";
import { resolveLocalizedText } from "@/features/paywall-editor/utils/document-tree-mutations";
import { studioApplicationsErrorMessage } from "@/features/paywall-editor/utils/studio-applications-error";
import { applicationsQueryOptions } from "@/features/projects/queries/projects-query";
import {
  activeProviderAssignmentQueryOptions,
  nativeProviderProfileQueryOptions,
  providerConnectionsQueryOptions,
} from "@/features/provider-connections/queries/provider-connection-queries";
import type { ProviderConnection } from "@/generated/api";
import { ApiError } from "@/lib/api/errors";

const CONTROL_CLASS =
  "border-input bg-background focus-visible:ring-ring w-full rounded border px-2 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none";

const MOCK_AVAILABILITY_OPTIONS = [
  { label: "Available", value: "available" },
  { label: "Not configured", value: "unavailable" },
];

function availableMock(productReferenceId: string): MockProductDefinition {
  return {
    productReferenceId,
    availability: "available",
    kind: "subscription",
    localizedPrice: "$0.00",
    currencyCode: "USD",
    billingPeriod: { unit: "month", value: 1 },
  };
}

function MockProductBinding({
  label,
  product,
  onChange,
}: {
  label: string;
  product: MockProductDefinition;
  onChange: (product: MockProductDefinition) => void;
}) {
  const [draftPrice, setDraftPrice] = useState(
    product.availability === "available" ? product.localizedPrice : "$0.00"
  );
  const availabilityId = `mock-availability-${product.productReferenceId}`;
  const priceId = `mock-price-${product.productReferenceId}`;

  return (
    <div className="rounded border border-border p-3">
      <div className="mb-2">
        <p className="font-medium text-sm">{label}</p>
        <p className="text-[11px] text-muted-foreground">
          {product.productReferenceId}
        </p>
      </div>
      <label
        className="mb-1 block font-medium text-muted-foreground text-xs"
        htmlFor={availabilityId}
      >
        Mock availability
      </label>
      <Select
        items={MOCK_AVAILABILITY_OPTIONS}
        onValueChange={(value) => {
          onChange(
            value === "available"
              ? availableMock(product.productReferenceId)
              : {
                  productReferenceId: product.productReferenceId,
                  availability: "unavailable",
                  reason: "notConfigured",
                }
          );
        }}
        value={product.availability}
      >
        <SelectTrigger
          aria-label={`${label} mock availability`}
          id={availabilityId}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MOCK_AVAILABILITY_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {product.availability === "available" ? (
        <div className="mt-3">
          <label
            className="mb-1 block font-medium text-muted-foreground text-xs"
            htmlFor={priceId}
          >
            Local price
          </label>
          <input
            aria-label={`${label} local price`}
            className={CONTROL_CLASS}
            id={priceId}
            onBlur={() => {
              if (draftPrice !== product.localizedPrice) {
                onChange({ ...product, localizedPrice: draftPrice });
              }
            }}
            onChange={(event) => setDraftPrice(event.target.value)}
            value={draftPrice}
          />
        </div>
      ) : null}
    </div>
  );
}

function HostedCatalogProductBindings() {
  const source = useStudioSource();
  const { document, currentLocale } = useEditorStore();
  const editor = useEditorActions();
  if (source.kind !== "hosted") {
    return null;
  }
  return (
    <HostedCatalogProductBindingsContent
      currentLocale={currentLocale}
      document={document}
      onBind={(referenceId, productId) =>
        editor.updateDocument((current) => ({
          ...current,
          products: current.products.map((product) =>
            product.id === referenceId ? { ...product, productId } : product
          ),
        }))
      }
      source={source}
    />
  );
}

function HostedCatalogProductBindingsContent({
  currentLocale,
  document,
  onBind,
  source,
}: {
  currentLocale: string;
  document: MosaicDocument | null;
  onBind: (referenceId: string, productId: string) => void;
  source: Extract<StudioSource, { kind: "hosted" }>;
}) {
  const catalog = useQuery(productsQueryOptions(source.projectId));
  const applications = useQuery(applicationsQueryOptions(source.projectId));
  const connections = useQuery(
    providerConnectionsQueryOptions(source.projectId)
  );
  const [applicationId, setApplicationId] = useState("");
  const products =
    catalog.data?.items.filter((product) => product.status !== "archived") ??
    [];
  const applicationOptions = [
    { label: "Select Application", value: "" },
    ...(applications.data?.items ?? []).map((application) => ({
      label: `${application.name} · ${application.platform.toUpperCase()}`,
      value: application.id,
    })),
  ];
  const productBindingOptions = products.map((product) => ({
    label: `${product.internalName} · ${product.status.replaceAll("_", " ")}`,
    value: product.id,
  }));
  // A Draft can still cite a Product that is no longer in the Catalog. Keeping its
  // raw ID as an option is what stops opening the panel from silently rebinding it.
  function bindingOptions(productId: string, isKnown: boolean) {
    return isKnown
      ? productBindingOptions
      : [
          { label: `Current ID · ${productId}`, value: productId },
          ...productBindingOptions,
        ];
  }
  const selectedApplication = applications.data?.items.find(
    (application) => application.id === applicationId
  );
  const selectedApplicationId = selectedApplication?.id ?? "";
  const catalogHref = `/orgs/${encodeURIComponent(source.organizationId)}/projects/${encodeURIComponent(source.projectId)}/catalog/products`;
  const returnTo = hostedStudioHref(source);

  if (catalog.error instanceof ApiError && catalog.error.status === 401) {
    return <HostedAccessBanner compact returnTo={returnTo} />;
  }

  return (
    <section
      aria-labelledby="catalog-product-bindings-title"
      className="space-y-3"
    >
      <div>
        <h2
          className="font-semibold text-sm"
          id="catalog-product-bindings-title"
        >
          Catalog Product bindings
        </h2>
        <p className="mt-0.5 text-muted-foreground text-xs leading-5">
          Bind each paywall Product Reference to a stable Project Product. Mock
          preview prices and outcomes remain separate below.
        </p>
      </div>
      {(() => {
        if (catalog.isPending) {
          return (
            <p aria-live="polite" className="text-muted-foreground text-xs">
              Loading Project Products…
            </p>
          );
        }
        if (catalog.error) {
          return (
            <div
              className="rounded border border-destructive/25 bg-destructive/5 p-3"
              role="alert"
            >
              <p className="text-destructive text-xs">
                {catalog.error instanceof ApiError &&
                catalog.error.status === 403
                  ? "You do not have permission to view this Project’s Products. Your Draft remains editable."
                  : catalog.error.message}
              </p>
              <Button
                className="mt-2"
                onClick={() => {
                  catalog.refetch();
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                Retry Products
              </Button>
            </div>
          );
        }
        if (products.length === 0) {
          return (
            <div className="rounded border border-border border-dashed p-3 text-xs">
              <p className="font-medium">No active Project Products</p>
              <p className="mt-1 text-muted-foreground leading-5">
                Create a Product, then return here to bind its stable Mosaic
                Product ID.
              </p>
            </div>
          );
        }
        if (document) {
          return (
            <div className="space-y-2">
              {(() => {
                if (applications.isPending) {
                  return (
                    <p className="text-muted-foreground text-xs" role="status">
                      Loading Applications
                      {source.environmentName
                        ? ` for ${source.environmentName}`
                        : ""}
                      …
                    </p>
                  );
                }
                if (applications.error) {
                  return (
                    <div
                      className="rounded border border-destructive/25 bg-destructive/5 p-3"
                      role="alert"
                    >
                      <p className="text-destructive text-xs">
                        {studioApplicationsErrorMessage(applications.error)}
                      </p>
                      <Button
                        className="mt-2"
                        onClick={() => {
                          applications.refetch();
                        }}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Retry Applications
                      </Button>
                    </div>
                  );
                }
                if (applications.data?.items.length === 0) {
                  return (
                    <div className="rounded border border-dashed p-3 text-xs">
                      <p className="font-medium">No registered Applications</p>
                      <a
                        className="mt-2 inline-flex font-semibold text-primary"
                        href={`/orgs/${encodeURIComponent(source.organizationId)}/projects/${encodeURIComponent(source.projectId)}/apps`}
                      >
                        Register Application
                      </a>
                    </div>
                  );
                }
                return null;
              })()}
              <div className="mb-3 block font-medium text-xs">
                <label htmlFor="provider-preview-application">
                  Provider preview Application
                </label>
                <Select
                  items={applicationOptions}
                  onValueChange={(value) => setApplicationId(value)}
                  value={selectedApplicationId}
                >
                  <SelectTrigger
                    className="mt-1"
                    disabled={
                      applications.isPending ||
                      Boolean(applications.error) ||
                      applications.data?.items.length === 0
                    }
                    id="provider-preview-application"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {applicationOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="mt-1 block text-[11px] text-muted-foreground leading-5">
                  Hosted Environment:{" "}
                  {source.environmentName ?? source.environmentId}. Mosaic does
                  not silently choose an Application or another platform for
                  commerce readiness.
                </span>
              </div>
              {document.products.map((reference) => {
                const selected = products.find(
                  (product) => product.id === reference.productId
                );
                const label = resolveLocalizedText(
                  document,
                  reference.label,
                  currentLocale
                );
                return (
                  <div
                    className="grid gap-1 rounded border border-border p-3"
                    key={reference.id}
                  >
                    <span className="font-medium text-xs">{label}</span>
                    <Select
                      items={bindingOptions(
                        reference.productId,
                        Boolean(selected)
                      )}
                      onValueChange={(value) => onBind(reference.id, value)}
                      value={reference.productId}
                    >
                      <SelectTrigger
                        aria-label={`Catalog Product for ${label}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {bindingOptions(
                          reference.productId,
                          Boolean(selected)
                        ).map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="break-all font-mono text-[10px] text-muted-foreground">
                      {reference.productId}
                    </span>
                    {(() => {
                      if (selected?.metadataSource === "mock") {
                        return (
                          <span className="text-[11px] text-muted-foreground">
                            Simulated metadata only; publishing requires
                            acknowledgement.
                          </span>
                        );
                      }
                      if (selected && selectedApplicationId) {
                        return (
                          <ConnectedProductBindingContext
                            applicationId={selectedApplicationId}
                            connections={connections.data?.items ?? []}
                            environmentId={source.environmentId}
                            productId={selected.id}
                          />
                        );
                      }
                      if (selected) {
                        return (
                          <span className="text-[11px] text-muted-foreground leading-5">
                            Select an Application to inspect its active
                            provider, mapping, and readiness. Simulated preview
                            remains active and is not store verification.
                          </span>
                        );
                      }
                      return null;
                    })()}
                  </div>
                );
              })}
            </div>
          );
        }
        return null;
      })()}
      <a
        className={buttonVariants({ size: "sm", variant: "outline" })}
        href={catalogHref}
      >
        Manage Project Products
      </a>
    </section>
  );
}

function ConnectedProductBindingContext({
  applicationId,
  connections,
  environmentId,
  productId,
}: {
  applicationId: string;
  connections: readonly ProviderConnection[];
  environmentId: string;
  productId: string;
}) {
  const source = useStudioSource();
  const mappings = useQuery(providerMappingsQueryOptions(productId));
  const activeAssignment = useQuery({
    ...activeProviderAssignmentQueryOptions(
      environmentId,
      applicationId || "unselected"
    ),
    enabled: Boolean(applicationId),
  });
  const readiness = useQuery({
    ...productReadinessQueryOptions(
      productId,
      environmentId,
      applicationId || "unselected"
    ),
    enabled: Boolean(applicationId),
  });
  const scopedMappings =
    mappings.data?.items.filter(
      (mappingValue) =>
        mappingValue.applicationId === applicationId &&
        mappingValue.environmentId === environmentId &&
        mappingValue.provider === activeAssignment.data?.provider &&
        (activeAssignment.data?.activationKind === "native_store"
          ? !mappingValue.connectionId
          : mappingValue.connectionId === activeAssignment.data?.connectionId)
    ) ?? [];
  const metadata = useQueries({
    queries: scopedMappings.map((mappingValue) => ({
      ...providerMappingMetadataQueryOptions(mappingValue.id),
      enabled:
        Boolean(mappingValue.currentSnapshotId) &&
        mappingValue.status !== "archived",
    })),
  });
  const observations = useQueries({
    queries: scopedMappings.map((mappingValue) => ({
      ...providerMappingObservationsQueryOptions(mappingValue.id),
      enabled:
        mappingValue.provider === "app_store" ||
        mappingValue.provider === "google_play",
    })),
  });
  const mapping = scopedMappings.length === 1 ? scopedMappings[0] : undefined;
  const snapshot = scopedMappings.length === 1 ? metadata[0]?.data : undefined;
  const latestObservation =
    scopedMappings.length === 1
      ? [...(observations[0]?.data ?? [])].sort((left, right) =>
          right.observedAt.localeCompare(left.observedAt)
        )[0]
      : undefined;
  const connection = connections.find(
    (item) => item.id === activeAssignment.data?.connectionId
  );
  const nativeProvider =
    activeAssignment.data?.provider === "app_store" ||
    activeAssignment.data?.provider === "google_play"
      ? activeAssignment.data.provider
      : null;
  const profile = useQuery({
    ...nativeProviderProfileQueryOptions(
      nativeProvider ?? "app_store",
      activeAssignment.data?.platform ?? "ios"
    ),
    enabled:
      activeAssignment.data?.activationKind === "native_store" &&
      Boolean(nativeProvider),
  });
  const providerLabel =
    profile.data?.displayName ??
    (() => {
      if (nativeProvider === "app_store") {
        return "StoreKit";
      }
      if (nativeProvider === "google_play") {
        return "Google Play Billing";
      }
      return connection?.name;
    })();
  const capabilityWarnings =
    profile.data?.capabilities.filter(
      (capability) => capability.support !== "supported"
    ) ?? [];
  const displayName =
    typeof snapshot?.metadata.displayName === "string"
      ? snapshot.metadata.displayName
      : undefined;
  const state = (() => {
    if (
      mappings.isPending ||
      readiness.isPending ||
      activeAssignment.isPending
    ) {
      return "Checking provider context…";
    }
    if (activeAssignment.data) {
      return (() => {
        if (scopedMappings.length > 1) {
          return "Ambiguous provider mappings block publishing.";
        }
        if (mapping) {
          return `${providerLabel ?? "Provider"} · ${mapping.availability} · ${mapping.syncState.replaceAll("_", " ")} · readiness ${readiness.data?.state ?? "unavailable"}`;
        }
        return "No scoped provider mapping. Mock preview is the safe fallback.";
      })();
    }
    return "No active provider is selected for this Application and Environment.";
  })();
  const diagnosticsHref =
    source.kind === "hosted"
      ? `/orgs/${encodeURIComponent(source.organizationId)}/projects/${encodeURIComponent(source.projectId)}/catalog/products/${encodeURIComponent(productId)}?environmentId=${encodeURIComponent(environmentId)}&applicationId=${encodeURIComponent(applicationId)}&returnTo=${encodeURIComponent(hostedStudioHref(source))}`
      : undefined;

  return (
    <span className="block text-[11px] text-muted-foreground leading-5">
      <span className="block">
        {displayName ? `Observed connected Product: ${displayName}. ` : ""}
        {state}
        {(() => {
          if (latestObservation) {
            return ` Test evidence: ${latestObservation.storeContext}, ${latestObservation.result}, observed ${latestObservation.observedAt}.`;
          }
          if (snapshot) {
            return ` Metadata source ${snapshot.source}; observed ${snapshot.observedAt}; stale after ${snapshot.staleAt}.`;
          }
          return " Observed/runtime metadata is unavailable; simulated preview remains active and is not store verification.";
        })()}
      </span>
      {profile.data ? (
        <span className="mt-1 block">
          Adapter {profile.data.adapterVersion} ·{" "}
          {profile.data.capabilities.length} declared capabilities
          {capabilityWarnings.length
            ? ` · ${capabilityWarnings.length} conditional or unsupported`
            : ""}
          .{" "}
          {nativeProvider === "app_store"
            ? "Recovery uses user-initiated store sync/restore."
            : "Recovery checks active Google Play purchases."}
        </span>
      ) : null}
      <span className="block">
        Live localized price, period, trial, and offer details are resolved by
        the active provider at runtime.
      </span>
      {diagnosticsHref ? (
        <a className="font-semibold text-primary" href={diagnosticsHref}>
          Open scoped Product diagnostics
        </a>
      ) : null}
    </span>
  );
}

export function MockCommercePanel({
  mockProducts,
  mockPurchaseState,
  onProductsChange,
  onPurchaseStateChange,
}: {
  mockProducts: readonly MockProductDefinition[];
  mockPurchaseState: MockPurchaseState;
  onProductsChange: (products: MockProductDefinition[]) => void;
  onPurchaseStateChange: (state: MockPurchaseState) => void;
}) {
  const { document, currentLocale } = useEditorStore();
  const source = useStudioSource();

  function updateProduct(nextProduct: MockProductDefinition) {
    const nextProducts = mockProducts.map((product) =>
      product.productReferenceId === nextProduct.productReferenceId
        ? nextProduct
        : product
    );
    onProductsChange(nextProducts);
    if (nextProduct.availability === "available") {
      onPurchaseStateChange("productAvailable");
    } else if (
      nextProducts.every((product) => product.availability === "unavailable")
    ) {
      onPurchaseStateChange("productUnavailable");
    }
  }

  return (
    <section aria-labelledby="mock-commerce-title" className="space-y-4">
      <HostedCatalogProductBindings />
      {source.kind === "hosted" ? <hr className="border-border" /> : null}
      <div>
        <h2 className="font-semibold text-sm" id="mock-commerce-title">
          Test purchase
        </h2>
        <p className="mt-0.5 text-muted-foreground text-xs">
          Safe local outcomes; no store purchase
        </p>
      </div>
      <div>
        <label
          className="mb-1 block font-medium text-muted-foreground text-xs"
          htmlFor="mock-outcome"
        >
          Preview state
        </label>
        <Select
          items={MOCK_PURCHASE_STATES}
          onValueChange={(value) =>
            onPurchaseStateChange(value as MockPurchaseState)
          }
          value={mockPurchaseState}
        >
          <SelectTrigger id="mock-outcome">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MOCK_PURCHASE_STATES.map((state) => (
              <SelectItem key={state.value} value={state.value}>
                {state.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <h3 className="font-semibold text-xs">Mock product bindings</h3>
        {mockProducts.length === 0 ? (
          <p className="mt-2 text-muted-foreground text-xs">
            This paywall does not declare a product to bind.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {mockProducts.map((product) => {
              const reference = document?.products.find(
                (entry) => entry.id === product.productReferenceId
              );
              const label =
                reference && document
                  ? resolveLocalizedText(
                      document,
                      reference.label,
                      currentLocale
                    )
                  : "Imported product";
              return (
                <MockProductBinding
                  key={`${product.productReferenceId}:${product.availability}`}
                  label={label}
                  onChange={updateProduct}
                  product={product}
                />
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
