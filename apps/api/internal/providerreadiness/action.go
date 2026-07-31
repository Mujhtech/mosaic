// Package providerreadiness owns stable recovery-action vocabulary shared by
// Catalog readiness and hosted publishing.
package providerreadiness

type Action string

const (
	ActionAddGoogleBasePlan                 Action = "addGoogleBasePlan"
	ActionArchiveDuplicateMappings          Action = "archiveDuplicateMappings"
	ActionAssignProductionConnection        Action = "assignProductionConnection"
	ActionAssignProvider                    Action = "assignProvider"
	ActionAssignProviderConnection          Action = "assignProviderConnection"
	ActionConnectProduct                    Action = "connectProduct"
	ActionCreateApplication                 Action = "createApplication"
	ActionCreateNativeProviderMapping       Action = "createNativeProviderMapping"
	ActionCreateOrSyncProviderMapping       Action = "createOrSyncProviderMapping"
	ActionGrantEntitlement                  Action = "grantEntitlement"
	ActionImportProviderEntitlementMapping  Action = "importProviderEntitlementMapping"
	ActionReconnectProvider                 Action = "reconnectProvider"
	ActionReplaceProviderEntitlementMapping Action = "replaceProviderEntitlementMapping"
	ActionRerunNativeProviderTest           Action = "rerunNativeProviderTest"
	ActionRestoreOrReplaceProduct           Action = "restoreOrReplaceProduct"
	ActionReviewProductionConnectionUse     Action = "reviewProductionConnectionUse"
	ActionReviewProviderProduct             Action = "reviewProviderProduct"
	ActionRunNativeProviderTest             Action = "runNativeProviderTest"
	ActionSelectCompatibleProvider          Action = "selectCompatibleProvider"
	ActionSyncProviderMetadata              Action = "syncProviderMetadata"
	ActionTestOrReconnectProvider           Action = "testOrReconnectProvider"
	ActionUpdateConnectionScopes            Action = "updateConnectionScopes"
)

func IsKnown(action Action) bool {
	switch action {
	case ActionAddGoogleBasePlan,
		ActionArchiveDuplicateMappings,
		ActionAssignProductionConnection,
		ActionAssignProvider,
		ActionAssignProviderConnection,
		ActionConnectProduct,
		ActionCreateApplication,
		ActionCreateNativeProviderMapping,
		ActionCreateOrSyncProviderMapping,
		ActionGrantEntitlement,
		ActionImportProviderEntitlementMapping,
		ActionReconnectProvider,
		ActionReplaceProviderEntitlementMapping,
		ActionRerunNativeProviderTest,
		ActionRestoreOrReplaceProduct,
		ActionReviewProductionConnectionUse,
		ActionReviewProviderProduct,
		ActionRunNativeProviderTest,
		ActionSelectCompatibleProvider,
		ActionSyncProviderMetadata,
		ActionTestOrReconnectProvider,
		ActionUpdateConnectionScopes:
		return true
	default:
		return false
	}
}
