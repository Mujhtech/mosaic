package appstorejws

import (
	"encoding/json"
	"time"
)

// The structures below are the subset of Apple's decoded payloads Phase 9A
// actually reads. Fields Mosaic deliberately does not persist are deliberately
// absent from these structs rather than parsed and dropped:
//
//   - `price`, `currency`, `offerDiscountType` — Apple's own documentation says
//     not to use them for accounting, and Phase 9A persists no monetary value.
//   - `appAccountToken` was on this list for Phase 9A and no longer is. Phase 9B
//     is the phase with a gate for customer identity, and the value is read here
//     so the association resolver can match it. It is hashed the moment it
//     leaves this struct: `billing.AliasDigest` is the only thing that receives
//     it, no Transaction Fact column holds it, and no log line, metric
//     attribute, or audit record ever sees either the value or its digest.
//     Phase 9A's fact-shape exclusion is unchanged.
//
// Anything not named here stays inside the encrypted raw input, recoverable by
// a future phase that has a gate for it.

// NotificationPayload is the decoded App Store Server Notification V2 body.
type NotificationPayload struct {
	NotificationType string            `json:"notificationType"`
	Subtype          string            `json:"subtype"`
	NotificationUUID string            `json:"notificationUUID"`
	Version          string            `json:"version"`
	SignedDate       int64             `json:"signedDate"`
	Data             *NotificationData `json:"data"`
	Summary          json.RawMessage   `json:"summary"`
	ExternalPurchase json.RawMessage   `json:"externalPurchaseToken"`
	AppMetadata      json.RawMessage   `json:"appMetadata"`
}

// NotificationData is the `data` member of a V2 notification.
type NotificationData struct {
	AppAppleID            int64  `json:"appAppleId"`
	BundleID              string `json:"bundleId"`
	BundleVersion         string `json:"bundleVersion"`
	Environment           string `json:"environment"`
	SignedTransactionInfo string `json:"signedTransactionInfo"`
	SignedRenewalInfo     string `json:"signedRenewalInfo"`
	Status                int    `json:"status"`
}

// TransactionPayload is the decoded JWSTransactionDecodedPayload.
type TransactionPayload struct {
	TransactionID               string `json:"transactionId"`
	OriginalTransactionID       string `json:"originalTransactionId"`
	WebOrderLineItemID          string `json:"webOrderLineItemId"`
	BundleID                    string `json:"bundleId"`
	ProductID                   string `json:"productId"`
	SubscriptionGroupIdentifier string `json:"subscriptionGroupIdentifier"`
	PurchaseDate                int64  `json:"purchaseDate"`
	OriginalPurchaseDate        int64  `json:"originalPurchaseDate"`
	ExpiresDate                 int64  `json:"expiresDate"`
	Quantity                    int    `json:"quantity"`
	Type                        string `json:"type"`
	TransactionReason           string `json:"transactionReason"`
	InAppOwnershipType          string `json:"inAppOwnershipType"`
	SignedDate                  int64  `json:"signedDate"`
	Environment                 string `json:"environment"`
	OfferType                   int    `json:"offerType"`
	OfferIdentifier             string `json:"offerIdentifier"`
	IsUpgraded                  bool   `json:"isUpgraded"`
	RevocationDate              int64  `json:"revocationDate"`
	RevocationReason            *int   `json:"revocationReason"`
	Storefront                  string `json:"storefront"`
	// AppAccountToken is the developer-chosen customer correlator, a UUID the
	// app supplied at purchase time. Apple scopes it to the purchase rather than
	// to the store account, which is exactly why it is evidence of moderate
	// authority rather than an identity: it says the app believed this purchase
	// belonged to that user, not that the store agrees.
	AppAccountToken string `json:"appAccountToken"`
}

// RenewalPayload is the subset of JWSRenewalInfoDecodedPayload Phase 9A reads.
type RenewalPayload struct {
	OriginalTransactionID string `json:"originalTransactionId"`
	AutoRenewStatus       int    `json:"autoRenewStatus"`
	AutoRenewProductID    string `json:"autoRenewProductId"`
	ExpirationIntent      int    `json:"expirationIntent"`
	IsInBillingRetry      bool   `json:"isInBillingRetryPeriod"`
	GracePeriodExpiresAt  int64  `json:"gracePeriodExpiresDate"`
	SignedDate            int64  `json:"signedDate"`
	Environment           string `json:"environment"`
	ProductID             string `json:"productId"`
	RenewalDate           int64  `json:"renewalDate"`
}

// Apple product types as they appear in `type`.
const (
	ProductTypeAutoRenewable = "Auto-Renewable Subscription"
	ProductTypeNonConsumable = "Non-Consumable"
	ProductTypeConsumable    = "Consumable"
	ProductTypeNonRenewing   = "Non-Renewing Subscription"
)

// Apple transaction reasons as they appear in `transactionReason`. Apple
// documents these two and no others; the set is treated as closed so that a
// reason introduced later is recognised as unknown instead of being folded into
// purchase semantics.
const (
	TransactionReasonPurchase = "PURCHASE"
	TransactionReasonRenewal  = "RENEWAL"
)

// Store environments as they appear in `environment`.
const (
	EnvironmentSandbox    = "Sandbox"
	EnvironmentProduction = "Production"
)

// Millis converts an Apple millisecond timestamp to a UTC time, reporting
// whether the value was present. Apple omits optional timestamps rather than
// sending zero, so a zero value is genuinely "absent".
func Millis(value int64) (time.Time, bool) {
	if value <= 0 {
		return time.Time{}, false
	}
	return time.UnixMilli(value).UTC(), true
}

// DecodeNotification verifies and decodes a signedPayload.
func (v *Verifier) DecodeNotification(compact string) (NotificationPayload, error) {
	raw, _, err := v.Verify(compact)
	if err != nil {
		return NotificationPayload{}, err
	}
	var payload NotificationPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return NotificationPayload{}, reject(ReasonMalformed)
	}
	if payload.NotificationUUID == "" || payload.NotificationType == "" {
		return NotificationPayload{}, reject(ReasonMalformed)
	}
	return payload, nil
}

// DecodeTransaction verifies and decodes a signedTransactionInfo.
func (v *Verifier) DecodeTransaction(compact string) (TransactionPayload, error) {
	raw, _, err := v.Verify(compact)
	if err != nil {
		return TransactionPayload{}, err
	}
	var payload TransactionPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return TransactionPayload{}, reject(ReasonMalformed)
	}
	if payload.TransactionID == "" || payload.ProductID == "" || payload.BundleID == "" {
		return TransactionPayload{}, reject(ReasonMalformed)
	}
	return payload, nil
}

// DecodeRenewal verifies and decodes a signedRenewalInfo.
func (v *Verifier) DecodeRenewal(compact string) (RenewalPayload, error) {
	raw, _, err := v.Verify(compact)
	if err != nil {
		return RenewalPayload{}, err
	}
	var payload RenewalPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return RenewalPayload{}, reject(ReasonMalformed)
	}
	return payload, nil
}
