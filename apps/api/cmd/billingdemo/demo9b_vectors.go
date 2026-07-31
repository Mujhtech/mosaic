//go:build billingdemo

// This file belongs to the build-tagged demonstration driver and is excluded
// from every ordinary build. See demo9b_stubs.go for why that matters.
package main

import (
	"encoding/json"
	"time"
)

// The Apple material produced here is SYNTHETIC, signed by the per-run chain in
// vectors.go and verified by Mosaic's real verifier against a root it was told
// to trust. Every field name and every unit is Apple's documented one, so
// everything downstream of the signature check — parsing, normalization, fact
// classification, ordering, projection — runs exactly as it would on a real
// payload.

// transactionVector is the controllable subset of Apple's
// JWSTransactionDecodedPayload. It is a struct rather than a map so a
// demonstration step cannot silently misspell a field Mosaic reads.
type transactionVector struct {
	TransactionID         string
	OriginalTransactionID string
	ProductID             string
	ProductType           string
	TransactionReason     string
	PurchaseDate          time.Time
	ExpiresDate           *time.Time
	RevocationDate        *time.Time
	RevocationReason      *int
	IsUpgraded            bool
	SignedDate            time.Time
	OwnershipType         string
}

func (v transactionVector) payload() map[string]any {
	productType := v.ProductType
	if productType == "" {
		productType = "Auto-Renewable Subscription"
	}
	reason := v.TransactionReason
	if reason == "" {
		reason = "PURCHASE"
	}
	ownership := v.OwnershipType
	if ownership == "" {
		ownership = "PURCHASED"
	}
	signed := v.SignedDate
	if signed.IsZero() {
		signed = v.PurchaseDate
	}
	payload := map[string]any{
		"transactionId":               v.TransactionID,
		"originalTransactionId":       v.OriginalTransactionID,
		"webOrderLineItemId":          "1000000" + v.TransactionID[len(v.TransactionID)-6:],
		"bundleId":                    appleBundleID9B,
		"productId":                   v.ProductID,
		"subscriptionGroupIdentifier": "21456789",
		"purchaseDate":                v.PurchaseDate.UnixMilli(),
		"originalPurchaseDate":        v.PurchaseDate.UnixMilli(),
		"quantity":                    1,
		"type":                        productType,
		"transactionReason":           reason,
		"inAppOwnershipType":          ownership,
		"signedDate":                  signed.UnixMilli(),
		"environment":                 "Production",
		"storefront":                  "USA",
	}
	if v.ExpiresDate != nil {
		payload["expiresDate"] = v.ExpiresDate.UnixMilli()
	}
	if v.RevocationDate != nil {
		payload["revocationDate"] = v.RevocationDate.UnixMilli()
	}
	if v.RevocationReason != nil {
		payload["revocationReason"] = *v.RevocationReason
	}
	if v.IsUpgraded {
		payload["isUpgraded"] = true
	}
	return payload
}

// renewalVector is the controllable subset of Apple's
// JWSRenewalInfoDecodedPayload. It carries the three fields Phase 9B's
// fact-shape pass added: auto-renew intent, billing-retry state, and the grace
// period's end.
type renewalVector struct {
	OriginalTransactionID string
	AutoRenewStatus       int
	AutoRenewProductID    string
	ProductID             string
	IsInBillingRetry      bool
	GracePeriodExpiresAt  *time.Time
	SignedAt              time.Time
}

func (v renewalVector) payload() map[string]any {
	payload := map[string]any{
		"originalTransactionId": v.OriginalTransactionID,
		"autoRenewStatus":       v.AutoRenewStatus,
		"autoRenewProductId":    v.AutoRenewProductID,
		"productId":             v.ProductID,
		"signedDate":            v.SignedAt.UnixMilli(),
		"environment":           "Production",
	}
	if v.IsInBillingRetry {
		payload["isInBillingRetryPeriod"] = true
	}
	if v.GracePeriodExpiresAt != nil {
		payload["gracePeriodExpiresDate"] = v.GracePeriodExpiresAt.UnixMilli()
	}
	return payload
}

// appleEvent is one complete App Store Server Notification V2 plus the signed
// transaction the App Store Server API will return when Mosaic re-reads it.
//
// Mosaic never trusts the transaction embedded in a notification: validation
// re-queries the store. Both are produced here so the two agree, exactly as
// they would in production.
type appleEvent struct {
	NotificationUUID string
	NotificationType string
	Subtype          string
	Transaction      transactionVector
	Renewal          *renewalVector
	// SignedAt is the notification's own signedDate. It is the provider event
	// time Mosaic recovers for ordering.
	SignedAt time.Time
}

// build returns the notification body to POST to the intake endpoint and the
// signed transaction to install on the App Store Server API stub.
func (c demoChain) buildAppleEvent(event appleEvent) (body string, signedTransaction string, err error) {
	signedTransaction, err = c.signJWS(event.Transaction.payload())
	if err != nil {
		return "", "", err
	}
	data := map[string]any{
		"appAppleId":            1234567890,
		"bundleId":              appleBundleID9B,
		"bundleVersion":         "1",
		"environment":           "Production",
		"signedTransactionInfo": signedTransaction,
		"status":                1,
	}
	if event.Renewal != nil {
		signedRenewal, renewalErr := c.signJWS(event.Renewal.payload())
		if renewalErr != nil {
			return "", "", renewalErr
		}
		data["signedRenewalInfo"] = signedRenewal
	}
	envelope := map[string]any{
		"notificationType": event.NotificationType,
		"notificationUUID": event.NotificationUUID,
		"version":          "2.0",
		"signedDate":       event.SignedAt.UnixMilli(),
		"data":             data,
	}
	if event.Subtype != "" {
		envelope["subtype"] = event.Subtype
	}
	signedPayload, err := c.signJWS(envelope)
	if err != nil {
		return "", "", err
	}
	encoded, err := json.Marshal(map[string]string{"signedPayload": signedPayload})
	return string(encoded), signedTransaction, err
}

func timePointer(value time.Time) *time.Time { return &value }

func intPointer(value int) *int { return &value }
