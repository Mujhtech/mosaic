import { mutationOptions, type QueryClient } from "@tanstack/react-query";

import type { AssetAdapter } from "@/features/assets/api/asset-adapter";
import { assetKeys } from "@/features/assets/queries/asset-queries";
import { publishingKeys } from "@/features/publishing/queries/publish-validation-query";

export function uploadAssetMutationOptions(
  projectId: string,
  adapter: AssetAdapter,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: (file: File) => adapter.uploadAsset({ file, projectId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: assetKeys.all(projectId),
      });
      await queryClient.invalidateQueries({ queryKey: publishingKeys.all });
    },
  });
}

export function archiveAssetMutationOptions(
  input: { assetId: string; projectId: string },
  adapter: AssetAdapter,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: () => adapter.archiveAsset(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: assetKeys.all(input.projectId),
      });
      await queryClient.invalidateQueries({ queryKey: publishingKeys.all });
    },
  });
}
