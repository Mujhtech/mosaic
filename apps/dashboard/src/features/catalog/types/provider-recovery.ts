export const PROVIDER_RECOVERY_ACTIONS = [
  "restoreOrReplaceProduct",
  "connectProduct",
  "grantEntitlement",
  "assignProvider",
  "assignProviderConnection",
  "selectCompatibleProvider",
  "createApplication",
  "createNativeProviderMapping",
  "addGoogleBasePlan",
  "runNativeProviderTest",
  "rerunNativeProviderTest",
  "archiveDuplicateMappings",
  "syncProviderMetadata",
  "reconnectProvider",
  "updateConnectionScopes",
  "assignProductionConnection",
  "reviewProductionConnectionUse",
  "testOrReconnectProvider",
  "createOrSyncProviderMapping",
  "reviewProviderProduct",
  "importProviderEntitlementMapping",
  "replaceProviderEntitlementMapping",
  "addEntitlementGrant",
  "fixProductMapping",
  "selectActiveProvider",
  "selectBasePlan",
  "selectOffer",
  "resolveMapping",
  "reviewObservation",
] as const

export type ProviderRecoveryAction = (typeof PROVIDER_RECOVERY_ACTIONS)[number]
export type ProviderRecoveryDestination =
  "access" | "applications" | "lifecycle" | "mapping" | "providers"

export interface ProviderRecoveryDescriptor {
  destination: ProviderRecoveryDestination
  label: string
  message: string
}

const RECOVERY: Record<ProviderRecoveryAction, ProviderRecoveryDescriptor> = {
  restoreOrReplaceProduct: {
    destination: "lifecycle",
    label: "Review Product lifecycle",
    message: "Restore this Product or choose its active replacement.",
  },
  connectProduct: {
    destination: "mapping",
    label: "Connect Product",
    message: "Connect this Product to the selected purchase provider.",
  },
  grantEntitlement: {
    destination: "access",
    label: "Add Access grant",
    message: "Choose the Access definition this Product unlocks.",
  },
  assignProvider: {
    destination: "providers",
    label: "Select active provider",
    message: "Select the purchase provider for this Environment and Application.",
  },
  assignProviderConnection: {
    destination: "providers",
    label: "Select provider connection",
    message: "Select a compatible Provider Connection for this scope.",
  },
  selectCompatibleProvider: {
    destination: "providers",
    label: "Select compatible provider",
    message: "Choose the built-in or connected provider for this Application platform.",
  },
  createApplication: {
    destination: "applications",
    label: "Register Application",
    message: "Register the iOS or Android Application required by this publishing scope.",
  },
  createNativeProviderMapping: {
    destination: "mapping",
    label: "Add native store mapping",
    message: "Add the exact native store Product identifier for this Application.",
  },
  addGoogleBasePlan: {
    destination: "mapping",
    label: "Add Google base plan",
    message: "Add the exact Google Play base plan and explicitly choose no offer or one offer.",
  },
  runNativeProviderTest: {
    destination: "mapping",
    label: "Run native store test",
    message: "This mapping is configured but has no accepted test-client observation.",
  },
  rerunNativeProviderTest: {
    destination: "mapping",
    label: "Rerun native store test",
    message:
      "The latest test-client observation is stale or unavailable; run the scoped test again.",
  },
  archiveDuplicateMappings: {
    destination: "mapping",
    label: "Review duplicate mappings",
    message: "Archive duplicate active mappings so this scope resolves to exactly one mapping.",
  },
  syncProviderMetadata: {
    destination: "mapping",
    label: "Refresh provider metadata",
    message: "Refresh connected-provider catalog metadata for this mapping.",
  },
  reconnectProvider: {
    destination: "providers",
    label: "Reconnect provider",
    message: "Reconnect the selected Provider Connection.",
  },
  updateConnectionScopes: {
    destination: "providers",
    label: "Update connection scopes",
    message: "Add this Environment and Application to the Provider Connection scope.",
  },
  assignProductionConnection: {
    destination: "providers",
    label: "Choose matching connection mode",
    message: "Choose a connection whose mode matches this Mosaic Environment.",
  },
  reviewProductionConnectionUse: {
    destination: "providers",
    label: "Review production connection",
    message: "Review and explicitly acknowledge production connection use in this Environment.",
  },
  testOrReconnectProvider: {
    destination: "providers",
    label: "Test or reconnect provider",
    message: "Test the Provider Connection and reconnect it if its credentials are unavailable.",
  },
  createOrSyncProviderMapping: {
    destination: "mapping",
    label: "Create or refresh mapping",
    message: "Create the connected-provider mapping or refresh its catalog metadata.",
  },
  reviewProviderProduct: {
    destination: "mapping",
    label: "Review provider Product",
    message: "Review the provider Product’s availability and exact identifier.",
  },
  importProviderEntitlementMapping: {
    destination: "mapping",
    label: "Import provider Access mapping",
    message: "Import the provider’s Access mapping for this Product.",
  },
  replaceProviderEntitlementMapping: {
    destination: "mapping",
    label: "Replace provider Access mapping",
    message: "Replace the incompatible provider Access mapping while preserving history.",
  },
  addEntitlementGrant: {
    destination: "access",
    label: "Add Access grant",
    message: "Choose the Access definition this Product unlocks.",
  },
  fixProductMapping: {
    destination: "mapping",
    label: "Review Product mapping",
    message: "Review the exact provider Product mapping for this scope.",
  },
  selectActiveProvider: {
    destination: "providers",
    label: "Select active provider",
    message: "Select the purchase provider for this Environment and Application.",
  },
  selectBasePlan: {
    destination: "mapping",
    label: "Select base plan",
    message: "Add the exact Google Play base plan.",
  },
  selectOffer: {
    destination: "mapping",
    label: "Review Google Play offer",
    message: "Explicitly choose no offer or one exact Google Play offer.",
  },
  resolveMapping: {
    destination: "mapping",
    label: "Resolve mapping",
    message: "Resolve this scope to one active provider mapping.",
  },
  reviewObservation: {
    destination: "mapping",
    label: "Review test evidence",
    message: "Review the latest scoped test-client observation.",
  },
}

export function isProviderRecoveryAction(value: string): value is ProviderRecoveryAction {
  return value in RECOVERY
}

export function providerRecoveryDescriptor(action: string): ProviderRecoveryDescriptor {
  if (isProviderRecoveryAction(action)) return RECOVERY[action]
  return {
    destination: "providers",
    label: "Review Purchase setup",
    message: "Purchase setup needs attention before publishing.",
  }
}

export function providerRecoveryHref(
  action: string,
  destinations: Record<ProviderRecoveryDestination, string>,
) {
  return destinations[providerRecoveryDescriptor(action).destination]
}
