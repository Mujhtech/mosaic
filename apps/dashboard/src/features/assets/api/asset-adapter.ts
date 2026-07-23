import type { HostedAsset } from "@/features/publishing/api/hosted-publishing-adapter"

export interface AssetUsage {
  readonly draftReferences: number
  readonly releaseReferences: number
  readonly versionReferences: number
}

export interface AssetAdapter {
  readonly status: "available" | "contract_pending"
  archiveAsset(input: { assetId: string; projectId: string }): Promise<void>
  getAssetUsage(input: { assetId: string; projectId: string }): Promise<AssetUsage>
  listAssets(projectId: string): Promise<readonly HostedAsset[]>
  uploadAsset(input: { file: File; projectId: string }): Promise<HostedAsset>
}

class AssetContractPendingError extends Error {
  constructor() {
    super("Managed Asset operations are not present in the generated REST client yet.")
    this.name = "AssetContractPendingError"
  }
}

const pending = () => Promise.reject(new AssetContractPendingError())

export const ASSET_CONTRACT_PENDING_ADAPTER: AssetAdapter = Object.freeze({
  status: "contract_pending",
  archiveAsset: pending,
  getAssetUsage: pending,
  listAssets: pending,
  uploadAsset: pending,
})
