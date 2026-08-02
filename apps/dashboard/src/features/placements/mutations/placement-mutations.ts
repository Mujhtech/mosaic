import { mutationOptions, type QueryClient } from "@tanstack/react-query";

import { placementKeys } from "@/features/placements/queries/placement-queries";
import type {
  HostedPaywallListItem,
  HostedPlacement,
  HostedPublishingAdapter,
} from "@/features/publishing/api/hosted-publishing-adapter";
import { publishingKeys } from "@/features/publishing/queries/publish-validation-query";

interface PlacementScope {
  environmentId: string;
  projectId: string;
}

export class PlacementCreatedWithoutBindingError extends Error {
  readonly placement: HostedPlacement;

  constructor(placement: HostedPlacement, cause: unknown) {
    super(
      `${placement.name} was created, but its Environment binding could not be saved. Retry the binding without creating another Placement.`,
      { cause }
    );
    this.name = "PlacementCreatedWithoutBindingError";
    this.placement = placement;
  }
}

function withBinding(
  placement: HostedPlacement,
  input: PlacementScope & { paywall: HostedPaywallListItem }
): HostedPlacement {
  return {
    ...placement,
    binding: {
      environmentId: input.environmentId,
      paywallId: input.paywall.id,
      paywallName: input.paywall.name,
    },
  };
}

interface CreatePlacementAndBindRequest {
  existingPlacement?: HostedPlacement;
  key: string;
  name: string;
  paywall?: HostedPaywallListItem;
}

export async function createPlacementAndBind(
  input: CreatePlacementAndBindRequest,
  scope: PlacementScope,
  adapter: HostedPublishingAdapter
) {
  const placement =
    input.existingPlacement ??
    (await adapter.createPlacement({
      key: input.key,
      name: input.name,
      projectId: scope.projectId,
    }));
  if (!input.paywall) {
    return placement;
  }
  try {
    await adapter.bindPlacement({
      environmentId: scope.environmentId,
      paywallId: input.paywall.id,
      placementId: placement.id,
      projectId: scope.projectId,
    });
    return withBinding(placement, { ...scope, paywall: input.paywall });
  } catch (error) {
    // biome-ignore lint/style/useErrorCause: PlacementCreatedWithoutBindingError chains the cause through its constructor
    throw new PlacementCreatedWithoutBindingError(placement, error);
  }
}

export function createPlacementAndBindMutationOptions(
  scope: PlacementScope,
  adapter: HostedPublishingAdapter,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: (input: CreatePlacementAndBindRequest) =>
      createPlacementAndBind(input, scope, adapter),
    onError: async (error) => {
      if (!(error instanceof PlacementCreatedWithoutBindingError)) {
        return;
      }
      queryClient.setQueryData<readonly HostedPlacement[]>(
        placementKeys.list(scope, adapter),
        (current) =>
          current?.some((item) => item.id === error.placement.id)
            ? current
            : [...(current ?? []), error.placement]
      );
      await queryClient.invalidateQueries({
        queryKey: placementKeys.list(scope),
      });
    },
    onSuccess: async (placement) => {
      queryClient.setQueryData<readonly HostedPlacement[]>(
        placementKeys.list(scope, adapter),
        (current) =>
          current?.some((item) => item.id === placement.id)
            ? current.map((item) =>
                item.id === placement.id ? placement : item
              )
            : [...(current ?? []), placement]
      );
      await queryClient.invalidateQueries({
        queryKey: placementKeys.list(scope),
      });
      await queryClient.invalidateQueries({ queryKey: publishingKeys.all });
    },
  });
}

export function bindPlacementMutationOptions(
  scope: PlacementScope & { placement: HostedPlacement },
  adapter: HostedPublishingAdapter,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async (paywall: HostedPaywallListItem) => {
      await adapter.bindPlacement({
        environmentId: scope.environmentId,
        paywallId: paywall.id,
        placementId: scope.placement.id,
        projectId: scope.projectId,
      });
      return withBinding(scope.placement, { ...scope, paywall });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<readonly HostedPlacement[]>(
        placementKeys.list(scope, adapter),
        (current) =>
          current?.map((item) => (item.id === updated.id ? updated : item)) ?? [
            updated,
          ]
      );
      queryClient.invalidateQueries({ queryKey: publishingKeys.all });
    },
  });
}
