import { providerRecoveryDescriptor } from "@/features/catalog/types/provider-recovery";
import type { MosaicDocument } from "@/features/paywall-editor/types/editor";
import {
  type HostedDraft,
  HostedDraftConflictError,
  HostedDraftOfflineError,
  type HostedPaywallDetail,
  type HostedPaywallListItem,
  type HostedPaywallVersion,
  type HostedPlacement,
  type HostedPlacementBinding,
  type HostedPublishingAdapter,
  type HostedRelease,
  type PublishValidationResult,
} from "@/features/publishing/api/hosted-publishing-adapter";
import type { Client } from "@/generated/api/client";
import {
  bindPlacement,
  clonePaywallVersionToDraft,
  createPaywall,
  createPaywallDraft,
  createPlacement,
  getActivePaywallDraft,
  getPaywall,
  getPaywallDraft,
  getPlacementBinding,
  getProductReadiness,
  listApplications,
  listAssets,
  listConfigurationReleases,
  listEnvironments,
  listPaywalls,
  listPaywallVersions,
  listPlacements,
  publishConfiguration,
  rollbackConfigurationRelease,
  updatePaywallDraft,
  validatePaywallDraft,
} from "@/generated/api/sdk.gen";
import type {
  ConfigurationRelease,
  DraftResource,
  Paywall,
  PaywallVersion,
  Placement,
} from "@/generated/api/types.gen";
import { ApiError, ApiNetworkError } from "@/lib/api/errors";
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client";
import { parsePortablePaywallJson } from "@/lib/mosaic-protocol";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createIdempotencyKey() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `mosaic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function draftETag(draftId: string, revision: number) {
  return `"draft-${draftId}-r${revision}"`;
}

function documentRequest(
  document: MosaicDocument,
  paywallId: string
): Record<string, unknown> {
  const request = structuredClone(document) as unknown as Record<
    string,
    unknown
  >;
  request.id = paywallId;
  return request;
}

function hostedDocument(document: Record<string, unknown>): MosaicDocument {
  const result = parsePortablePaywallJson(JSON.stringify(document));
  if (!result.ok) {
    throw new Error("The hosted Draft returned an invalid Mosaic document.");
  }
  return result.value as MosaicDocument;
}

function mapDraft(resource: DraftResource): HostedDraft {
  return {
    document: hostedDocument(resource.document),
    environmentId: resource.draft.environmentId,
    id: resource.draft.id,
    paywallId: resource.draft.paywallId,
    projectId: resource.draft.projectId,
    revision: resource.draft.revision,
    updatedAt: resource.draft.updatedAt,
  };
}

function mapPaywall(paywall: Paywall): HostedPaywallListItem {
  return {
    id: paywall.id,
    key: paywall.key,
    name: paywall.name,
    status: paywall.status,
    updatedAt: paywall.updatedAt,
  };
}

function mapVersion(version: PaywallVersion): HostedPaywallVersion {
  return {
    createdAt: version.createdAt,
    environmentId: version.environmentId,
    id: version.id,
    protocolVersion: version.protocolVersion,
    sourceDraftRevision: version.sourceRevision,
    versionNumber: version.versionNumber,
  };
}

function mapPlacement(placement: Placement): HostedPlacement {
  return {
    id: placement.id,
    key: placement.key,
    name: placement.name,
    status: placement.status,
  };
}

function mapRelease(
  release: ConfigurationRelease,
  isCurrent = false
): HostedRelease {
  return {
    id: release.id,
    isCurrent,
    number: release.releaseNumber,
    publishedAt: release.publishedAt,
  };
}

function conflictFrom(error: unknown) {
  if (
    !(error instanceof ApiError) ||
    error.code !== "draft_revision_conflict"
  ) {
    return null;
  }
  const details = isRecord(error.details) ? error.details : undefined;
  const revision = details?.currentRevision;
  if (typeof revision !== "number") {
    return null;
  }
  return new HostedDraftConflictError(
    revision,
    typeof details?.updatedAt === "string" ? details.updatedAt : undefined
  );
}

function recoveryActionLabel(recoveryAction: string) {
  return providerRecoveryDescriptor(recoveryAction).label;
}

function recoveryActionMessage(
  recoveryAction: string,
  product: string,
  application: string
) {
  return `${product} · ${application}: ${providerRecoveryDescriptor(recoveryAction).message}`;
}

export function resolvePlacementReadiness(
  placements: readonly HostedPlacement[],
  paywallId: string
) {
  return placements.map((placement) => ({
    bound: placement.binding?.paywallId === paywallId,
    id: placement.id,
    key: placement.key,
  }));
}

export function createGeneratedHostedPublishingAdapter(
  client: Client = generatedDashboardClient
): HostedPublishingAdapter {
  const idempotencyKeys = new Map<string, string>();
  const placementBindings = new Map<string, string>();

  function placementBindingKey(environmentId: string, placementId: string) {
    return `${environmentId}:${placementId}`;
  }

  async function idempotent<T>(
    scope: string,
    request: (key: string) => Promise<T>
  ) {
    const key = idempotencyKeys.get(scope) ?? createIdempotencyKey();
    idempotencyKeys.set(scope, key);
    const result = await request(key);
    if (idempotencyKeys.get(scope) === key) {
      idempotencyKeys.delete(scope);
    }
    return result;
  }

  return {
    status: "available",
    async bindPlacement(input): Promise<HostedPlacementBinding> {
      const result = await bindPlacement({
        body: { paywallId: input.paywallId },
        client,
        path: {
          environmentId: input.environmentId,
          placementId: input.placementId,
          projectId: input.projectId,
        },
        throwOnError: true,
      });
      const binding = {
        environmentId: result.data.data.environmentId,
        paywallId: result.data.data.paywallId,
        placementId: result.data.data.placementId,
        projectId: result.data.data.projectId,
      };
      placementBindings.set(
        placementBindingKey(binding.environmentId, binding.placementId),
        binding.paywallId
      );
      return binding;
    },
    createDraft(input) {
      return idempotent(
        `create-draft:${input.projectId}:${input.paywallId}:${input.environmentId}`,
        async (key) => {
          const result = await createPaywallDraft({
            body: {
              document: documentRequest(input.document, input.paywallId),
              environmentId: input.environmentId,
            },
            client,
            headers: { "Idempotency-Key": key },
            path: { paywallId: input.paywallId, projectId: input.projectId },
            throwOnError: true,
          });
          return mapDraft(result.data.data);
        }
      );
    },
    createDraftFromVersion(input) {
      return idempotent(
        `clone:${input.projectId}:${input.paywallId}:${input.versionId}`,
        async (key) => {
          const result = await clonePaywallVersionToDraft({
            client,
            headers: { "Idempotency-Key": key },
            path: {
              paywallId: input.paywallId,
              projectId: input.projectId,
              versionId: input.versionId,
            },
            throwOnError: true,
          });
          return mapDraft(result.data.data);
        }
      );
    },
    async createPaywall(input): Promise<HostedPaywallDetail> {
      const result = await createPaywall({
        body: { key: input.key, name: input.name },
        client,
        path: { projectId: input.projectId },
        throwOnError: true,
      });
      return {
        ...mapPaywall(result.data.data),
        drafts: [],
        projectId: input.projectId,
        versions: [],
      };
    },
    async createPlacement(input) {
      const result = await createPlacement({
        body: { key: input.key, name: input.name },
        client,
        path: { projectId: input.projectId },
        throwOnError: true,
      });
      return mapPlacement(result.data.data);
    },
    async getActiveDraft(input) {
      try {
        const result = await getActivePaywallDraft({
          client,
          path: { paywallId: input.paywallId, projectId: input.projectId },
          query: { environmentId: input.environmentId },
          throwOnError: true,
        });
        return mapDraft(result.data.data);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
    async getDraft(input) {
      const result = await getPaywallDraft({
        client,
        path: input,
        throwOnError: true,
      });
      return mapDraft(result.data.data);
    },
    async getPaywall(input) {
      const [paywallResult, versionsResult] = await Promise.all([
        getPaywall({ client, path: input, throwOnError: true }),
        listPaywallVersions({ client, path: input, throwOnError: true }),
      ]);
      return {
        ...mapPaywall(paywallResult.data.data),
        drafts: [],
        projectId: paywallResult.data.data.projectId,
        versions: versionsResult.data.data.items.map(mapVersion),
      };
    },
    async getPaywallPreviewDocument(input) {
      // The published Version is preferred because it is what this Environment
      // actually serves; the active Draft only stands in for a Paywall that has
      // never shipped here. Showing unreleased work as though it were live
      // would make the gallery misreport the Environment.
      const versionsResult = await listPaywallVersions({
        client,
        path: { paywallId: input.paywallId, projectId: input.projectId },
        throwOnError: true,
      });
      const latest = versionsResult.data.data.items
        .filter((version) => version.environmentId === input.environmentId)
        .reduce<PaywallVersion | null>(
          (newest, version) =>
            newest && newest.versionNumber >= version.versionNumber
              ? newest
              : version,
          null
        );
      if (latest) {
        return {
          document: hostedDocument(latest.document),
          source: "publishedVersion",
          versionNumber: latest.versionNumber,
        };
      }
      const draft = await this.getActiveDraft(input);
      return draft ? { document: draft.document, source: "draft" } : null;
    },
    async listPaywalls(projectId) {
      const result = await listPaywalls({
        client,
        path: { projectId },
        throwOnError: true,
      });
      return result.data.data.items.map(mapPaywall);
    },
    async listPlacements(input) {
      const [placementsResult, paywallsResult] = await Promise.all([
        listPlacements({
          client,
          path: { projectId: input.projectId },
          throwOnError: true,
        }),
        listPaywalls({
          client,
          path: { projectId: input.projectId },
          throwOnError: true,
        }),
      ]);
      const paywallNames = new Map(
        paywallsResult.data.data.items.map((paywall) => [
          paywall.id,
          paywall.name,
        ])
      );
      // Only a 404 means "this Placement is unbound". Any other failure is a
      // read Mosaic could not complete, and it is reported as such rather than
      // being flattened into the same `null` — an unbound Placement invites a
      // bind action, while an unreadable one must not.
      const bindings = await Promise.all(
        placementsResult.data.data.items.map(async (placement) => {
          try {
            const result = await getPlacementBinding({
              client,
              path: {
                environmentId: input.environmentId,
                placementId: placement.id,
                projectId: input.projectId,
              },
              throwOnError: true,
            });
            return { binding: result.data.data, state: "bound" } as const;
          } catch (error) {
            if (error instanceof ApiError && error.status === 404) {
              return { state: "unbound" } as const;
            }
            return { state: "unknown" } as const;
          }
        })
      );
      return placementsResult.data.data.items.map((placement, index) => {
        const mapped = mapPlacement(placement);
        const probe = bindings[index];
        if (probe?.state === "unknown") {
          return { ...mapped, bindingState: "unknown" as const };
        }
        const paywallId =
          probe?.binding?.paywallId ??
          placementBindings.get(
            placementBindingKey(input.environmentId, placement.id)
          );
        return paywallId
          ? {
              ...mapped,
              binding: {
                environmentId: input.environmentId,
                paywallId,
                // A bound Paywall missing from the Project listing is a real
                // inconsistency, so it is named as unresolved rather than
                // dressed up with a generic label that reads like a name.
                paywallName:
                  paywallNames.get(paywallId) ??
                  `Unresolved Paywall (${paywallId})`,
              },
              bindingState: "bound" as const,
            }
          : { ...mapped, bindingState: "unbound" as const };
      });
    },
    async listPublishedVersions(input) {
      const [paywallResult, versionsResult] = await Promise.all([
        getPaywall({
          client,
          path: { paywallId: input.paywallId, projectId: input.projectId },
          throwOnError: true,
        }),
        listPaywallVersions({
          client,
          path: { paywallId: input.paywallId, projectId: input.projectId },
          throwOnError: true,
        }),
      ]);
      return versionsResult.data.data.items.flatMap((version) =>
        version.environmentId === input.environmentId
          ? [
              {
                ...mapVersion(version),
                paywallName: paywallResult.data.data.name,
              },
            ]
          : []
      );
    },
    async listReleases(input) {
      const result = await listConfigurationReleases({
        client,
        path: input,
        throwOnError: true,
      });
      const releaseNumbers = new Map(
        result.data.data.items.map((release) => [
          release.id,
          release.releaseNumber,
        ])
      );
      return result.data.data.items.map((release, index) => ({
        ...mapRelease(release, index === 0),
        ...(release.rollbackSourceReleaseId
          ? {
              rollbackSourceNumber: releaseNumbers.get(
                release.rollbackSourceReleaseId
              ),
            }
          : {}),
      }));
    },
    publishDraft(input) {
      return idempotent(
        `publish:${input.projectId}:${input.environmentId}:${input.draftId}:${input.expectedRevision}:${input.acknowledgeMockProducts}`,
        async (key) => {
          const result = await publishConfiguration({
            body: {
              acknowledgeMockProducts: input.acknowledgeMockProducts,
              draftId: input.draftId,
              expectedRevision: input.expectedRevision,
            },
            client,
            headers: { "Idempotency-Key": key },
            path: {
              environmentId: input.environmentId,
              projectId: input.projectId,
            },
            throwOnError: true,
          });
          return mapRelease(result.data.data.release, true);
        }
      );
    },
    rollbackRelease(input) {
      return idempotent(
        `rollback:${input.projectId}:${input.environmentId}:${input.releaseId}`,
        async (key) => {
          const result = await rollbackConfigurationRelease({
            client,
            headers: { "Idempotency-Key": key },
            path: input,
            throwOnError: true,
          });
          return mapRelease(result.data.data, true);
        }
      );
    },
    async saveDraft(input) {
      try {
        return await idempotent(
          `save:${input.projectId}:${input.paywallId}:${input.draftId}:${input.expectedRevision}`,
          async (key) => {
            const result = await updatePaywallDraft({
              body: {
                document: documentRequest(input.document, input.paywallId),
              },
              client,
              headers: {
                "Idempotency-Key": key,
                "If-Match": draftETag(input.draftId, input.expectedRevision),
              },
              path: {
                draftId: input.draftId,
                paywallId: input.paywallId,
                projectId: input.projectId,
              },
              throwOnError: true,
            });
            return mapDraft(result.data.data);
          }
        );
      } catch (error) {
        const conflict = conflictFrom(error);
        if (conflict) {
          throw conflict;
        }
        if (error instanceof ApiNetworkError) {
          // biome-ignore lint/style/useErrorCause: HostedDraftOfflineError chains the cause through its constructor
          throw new HostedDraftOfflineError(error);
        }
        throw error;
      }
    },
    async validateDraftForPublish(input): Promise<PublishValidationResult> {
      const path = {
        draftId: input.draftId,
        paywallId: input.paywallId,
        projectId: input.projectId,
      };
      const [
        validationResult,
        draftResult,
        placements,
        assetsResult,
        applicationsResult,
        environmentsResult,
      ] = await Promise.all([
        validatePaywallDraft({ client, path, throwOnError: true }),
        getPaywallDraft({ client, path, throwOnError: true }),
        this.listPlacements({
          environmentId: input.environmentId,
          projectId: input.projectId,
        }),
        listAssets({
          client,
          path: { projectId: input.projectId },
          throwOnError: true,
        }),
        listApplications({
          client,
          path: { projectId: input.projectId },
          throwOnError: true,
        }),
        listEnvironments({
          client,
          path: { projectId: input.projectId },
          throwOnError: true,
        }),
      ]);
      const document = hostedDocument(draftResult.data.data.document);
      const productIds = [
        ...new Set(document.products.map((product) => product.productId)),
      ];
      const environment = environmentsResult.data.data.items.find(
        (item) => item.id === input.environmentId
      );
      if (!environment) {
        throw new Error(
          "The selected Environment is unavailable in this Project."
        );
      }
      const applications = applicationsResult.data.data.items;
      const products = await Promise.all(
        productIds.map(async (productId) => {
          const scopes = await Promise.all(
            applications.map(async (application) => {
              const result = await getProductReadiness({
                client,
                path: { productId },
                query: {
                  applicationId: application.id,
                  environmentId: environment.id,
                },
                throwOnError: true,
              });
              return { application, readiness: result.data.data };
            })
          );
          return {
            id: productId,
            name: productId,
            ready:
              scopes.length > 0 &&
              scopes.every(
                ({ readiness }) =>
                  (readiness.state === "configured" ||
                    readiness.state === "verifiedInTest") &&
                  readiness.blockers.length === 0
              ),
            scopes,
          };
        })
      );
      const productIssues = products.flatMap((product) =>
        product.scopes.flatMap(({ application, readiness }) => [
          ...readiness.blockers.map((issue) => ({
            applicationId: readiness.applicationId,
            code: issue.code,
            connectionId: readiness.connectionId,
            environmentId: readiness.environmentId,
            message: recoveryActionMessage(
              issue.recoveryAction,
              product.name,
              application.name
            ),
            productId: product.id,
            recoveryAction: issue.recoveryAction,
            recoveryLabel: recoveryActionLabel(issue.recoveryAction),
            resourceId: issue.resourceId,
            resourceType: issue.resourceType,
            severity:
              environment.mode === "production"
                ? ("error" as const)
                : ("warning" as const),
          })),
          ...readiness.warnings.map((issue) => ({
            applicationId: readiness.applicationId,
            code: issue.code,
            connectionId: readiness.connectionId,
            environmentId: readiness.environmentId,
            message: recoveryActionMessage(
              issue.recoveryAction,
              product.name,
              application.name
            ),
            productId: product.id,
            recoveryAction: issue.recoveryAction,
            recoveryLabel: recoveryActionLabel(issue.recoveryAction),
            resourceId: issue.resourceId,
            resourceType: issue.resourceType,
            severity: "warning" as const,
          })),
        ])
      );
      const managedAssetsByUrl = new Map(
        assetsResult.data.data.items.map((asset) => [asset.url, asset])
      );
      const assetReadiness = document.assets.map((asset) => {
        const managedAsset =
          asset.source.type === "remote"
            ? managedAssetsByUrl.get(asset.source.url)
            : undefined;
        return {
          id: asset.id,
          name: managedAsset?.originalFilename ?? asset.id,
          ready:
            asset.source.type === "bundled" || managedAsset?.status === "ready",
        };
      });
      const assetIssues = assetReadiness.flatMap((asset) =>
        asset.ready
          ? []
          : [
              {
                code: "asset.hosted_mapping_required",
                message: `${asset.name} is not backed by a ready managed Asset. Upload or select one before publishing.`,
                severity: "error" as const,
              },
            ]
      );
      const placementsForPaywall = resolvePlacementReadiness(
        placements,
        input.paywallId
      );
      const placementIssues = placementsForPaywall.some(
        (placement) => placement.bound
      )
        ? []
        : [
            {
              code: "placement.binding_required",
              message:
                "Bind at least one Placement to this Paywall in the selected Environment.",
              severity: "error" as const,
            },
          ];
      return {
        assets: assetReadiness,
        issues: [
          ...validationResult.data.data.errors.map((message) => ({
            code: "draft.validation",
            message,
            severity: "error" as const,
          })),
          ...validationResult.data.data.warnings.map((message) => ({
            code: "draft.validation",
            message,
            severity: "warning" as const,
          })),
          ...productIssues,
          ...assetIssues,
          ...placementIssues,
        ],
        placements: placementsForPaywall,
        products: products.map((product) => ({
          id: product.id,
          name: product.name,
          ready: product.ready,
        })),
        protocolVersion: draftResult.data.data.draft.protocolVersion,
      };
    },
  };
}

export const generatedHostedPublishingAdapter =
  createGeneratedHostedPublishingAdapter();
