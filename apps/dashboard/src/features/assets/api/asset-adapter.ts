import type { HostedAsset } from "@/features/publishing/api/hosted-publishing-adapter";

export interface AssetUsage {
  readonly draftReferences: number;
  readonly releaseReferences: number;
  readonly versionReferences: number;
}

export interface AssetAdapter {
  archiveAsset: (input: {
    assetId: string;
    projectId: string;
  }) => Promise<void>;
  getAssetUsage: (input: {
    assetId: string;
    projectId: string;
  }) => Promise<AssetUsage>;
  listAssets: (projectId: string) => Promise<readonly HostedAsset[]>;
  readonly status: "available" | "contract_pending";
  uploadAsset: (input: {
    file: File;
    projectId: string;
  }) => Promise<HostedAsset>;
}
