import { archiveAsset, getAssetUsage, listAssets, uploadAsset } from "@/generated/api/sdk.gen"
import type { Asset } from "@/generated/api/types.gen"
import type { AssetAdapter } from "@/features/assets/api/asset-adapter"
import type { HostedAsset } from "@/features/publishing/api/hosted-publishing-adapter"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

function mapAsset(asset: Asset): HostedAsset {
  return {
    byteLength: asset.byteLength,
    contentDigest: asset.contentDigest,
    id: asset.id,
    kind: asset.kind,
    mediaType: asset.mediaType,
    name: asset.originalFilename,
    status: asset.status,
    url: asset.url,
  }
}

export const generatedAssetAdapter: AssetAdapter = {
  status: "available",
  async archiveAsset(input) {
    await archiveAsset({
      client: generatedDashboardClient,
      path: input,
      throwOnError: true,
    })
  },
  async getAssetUsage(input) {
    const result = await getAssetUsage({
      client: generatedDashboardClient,
      path: input,
      throwOnError: true,
    })
    return result.data.data
  },
  async listAssets(projectId) {
    const result = await listAssets({
      client: generatedDashboardClient,
      path: { projectId },
      throwOnError: true,
    })
    return result.data.data.items.map(mapAsset)
  },
  async uploadAsset(input) {
    const result = await uploadAsset({
      body: { file: input.file },
      client: generatedDashboardClient,
      path: { projectId: input.projectId },
      throwOnError: true,
    })
    return mapAsset(result.data.data)
  },
}
