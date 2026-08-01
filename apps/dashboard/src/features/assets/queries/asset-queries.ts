import { queryOptions } from "@tanstack/react-query";

import type { AssetAdapter } from "@/features/assets/api/asset-adapter";

export const assetKeys = {
  all: (projectId: string) => ["assets", projectId] as const,
  list: (projectId: string, adapter?: AssetAdapter) =>
    adapter
      ? ([...assetKeys.all(projectId), "list", adapter] as const)
      : ([...assetKeys.all(projectId), "list"] as const),
  usage: (
    input: { assetId: string; projectId: string },
    adapter?: AssetAdapter
  ) =>
    adapter
      ? ([
          ...assetKeys.all(input.projectId),
          "usage",
          input.assetId,
          adapter,
        ] as const)
      : ([...assetKeys.all(input.projectId), "usage", input.assetId] as const),
};

export function assetsQueryOptions(projectId: string, adapter: AssetAdapter) {
  return queryOptions({
    queryKey: assetKeys.list(projectId, adapter),
    queryFn: () => adapter.listAssets(projectId),
  });
}

export function assetUsageQueryOptions(
  input: { assetId: string; projectId: string },
  adapter: AssetAdapter
) {
  return queryOptions({
    queryKey: assetKeys.usage(input, adapter),
    queryFn: () => adapter.getAssetUsage(input),
  });
}
