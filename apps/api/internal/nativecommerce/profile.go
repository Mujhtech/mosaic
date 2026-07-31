// Package nativecommerce owns the frozen native-store capability truth matrix.
package nativecommerce

type Capability struct {
	Name       string
	Support    string
	ReasonCode string
}

type Profile struct {
	Provider       string
	DisplayName    string
	Platform       string
	AdapterVersion string
	RecoveryMode   string
	Capabilities   []Capability
}

func capability(name, support string, reason ...string) Capability {
	value := Capability{Name: name, Support: support}
	if len(reason) != 0 {
		value.ReasonCode = reason[0]
	}
	return value
}

func ProfileFor(provider string) (Profile, bool) {
	var profile Profile
	switch provider {
	case "app_store":
		profile = Profile{
			Provider: provider, DisplayName: "StoreKit", Platform: "ios",
			AdapterVersion: "1.0.0", RecoveryMode: "storeSynchronization",
			Capabilities: []Capability{
				capability("productLoading", "supported"),
				capability("subscriptions", "supported"),
				capability("oneTimeNonConsumables", "supported"),
				capability("trials", "supported"),
				capability("introductoryOffers", "supported"),
				capability("promotionalOffers", "conditional", "provider.configurationRequired"),
				capability("restore", "supported"),
				capability("activeEntitlementLookup", "supported"),
				capability("pendingPurchases", "supported"),
				capability("deferredPurchases", "unsupported", "provider.outcomeUnavailable"),
				capability("serverConfirmedTransactions", "unsupported", "provider.serverValidationExcluded"),
				capability("productSynchronization", "unsupported", "provider.serverSynchronizationUnavailable"),
				capability("providerDiagnostics", "supported"),
				capability("basePlans", "unsupported", "provider.capabilityUnavailable"),
				capability("explicitOffers", "unsupported", "provider.capabilityUnavailable"),
				capability("storeSynchronization", "supported"),
				capability("activePurchaseRecovery", "unsupported", "provider.recoveryModeUnavailable"),
				capability("asynchronousCommerceUpdates", "supported"),
				capability("localDeliveryAcceptance", "supported"),
			},
		}
	case "google_play":
		profile = Profile{
			Provider: provider, DisplayName: "Google Play Billing", Platform: "android",
			AdapterVersion: "1.0.0", RecoveryMode: "activePurchaseRecovery",
			Capabilities: []Capability{
				capability("productLoading", "supported"),
				capability("subscriptions", "supported"),
				capability("oneTimeNonConsumables", "supported"),
				capability("trials", "conditional", "provider.eligibilityRequired"),
				capability("introductoryOffers", "conditional", "provider.eligibilityRequired"),
				capability("promotionalOffers", "unsupported", "provider.capabilityUnavailable"),
				capability("restore", "supported"),
				capability("activeEntitlementLookup", "supported"),
				capability("pendingPurchases", "supported"),
				capability("deferredPurchases", "unsupported", "provider.outcomeUnavailable"),
				capability("serverConfirmedTransactions", "unsupported", "provider.serverValidationExcluded"),
				capability("productSynchronization", "unsupported", "provider.serverSynchronizationUnavailable"),
				capability("providerDiagnostics", "supported"),
				capability("basePlans", "supported"),
				capability("explicitOffers", "supported"),
				capability("storeSynchronization", "unsupported", "provider.recoveryModeUnavailable"),
				capability("activePurchaseRecovery", "supported"),
				capability("asynchronousCommerceUpdates", "supported"),
				capability("localDeliveryAcceptance", "supported"),
			},
		}
	default:
		return Profile{}, false
	}
	return profile, true
}
