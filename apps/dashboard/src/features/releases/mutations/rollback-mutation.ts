import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import type { HostedPublishingAdapter } from "@/features/publishing/api/hosted-publishing-adapter";
import { releaseKeys } from "@/features/releases/queries/release-queries";

export function rollbackReleaseMutationOptions(
  input: { environmentId: string; projectId: string; releaseId: string },
  adapter: HostedPublishingAdapter,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: () => adapter.rollbackRelease(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: releaseKeys.all({
          environmentId: input.environmentId,
          projectId: input.projectId,
        }),
      });
    },
  });
}
