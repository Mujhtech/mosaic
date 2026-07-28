package billing

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"
	"time"
)

// Idempotency keys are domain-separated SHA-256 digests. Domain separation
// matters here more than usual: an Apple notification UUID and a Pub/Sub message
// id are both opaque strings, and without a domain prefix a value that happened
// to collide across providers would deduplicate two unrelated inputs into one.
//
// None of these keys is derived from a timestamp, a Product, a display name, an
// amount, or any customer identifier. Every one of those changes independently
// of the delivery it is meant to identify.

func digestOf(domain string, parts ...string) []byte {
	hasher := sha256.New()
	hasher.Write([]byte(domain))
	for _, part := range parts {
		hasher.Write([]byte{0})
		hasher.Write([]byte(part))
	}
	return hasher.Sum(nil)
}

// AppleNotificationKey identifies one App Store Server Notification.
// notificationUUID is the identifier Apple documents for duplicate detection.
func AppleNotificationKey(notificationUUID string) []byte {
	return digestOf("mosaic-billing-apple-notification-v1", notificationUUID)
}

// AppleTransactionKey identifies one Apple transaction in one Store Environment.
func AppleTransactionKey(storeEnvironment, transactionID string) []byte {
	return digestOf("mosaic-billing-apple-transaction-v1", storeEnvironment, transactionID)
}

// GoogleRTDNKey identifies one Pub/Sub delivery. Google's messageId is unique
// per subscription rather than globally, so the subscription name is part of
// the key, and the notification content digest is folded in so a subscription
// replayed under a recycled id cannot mask a different notification.
func GoogleRTDNKey(subscription, messageID string, contentDigest []byte) []byte {
	return digestOf("mosaic-billing-google-rtdn-v1", subscription, messageID, hex.EncodeToString(contentDigest))
}

// GooglePurchaseKey identifies one Google purchase by token digest. The raw
// purchase token is never part of a key that gets persisted or logged.
func GooglePurchaseKey(packageName string, tokenDigest []byte) []byte {
	return digestOf("mosaic-billing-google-purchase-v1", packageName, hex.EncodeToString(tokenDigest))
}

// ObservationKey identifies one client or trusted-server submission.
func ObservationKey(environmentID, submissionID string) []byte {
	return digestOf("mosaic-billing-observation-v1", environmentID, submissionID)
}

// TokenDigest is the cross-SDK contract for referring to a Google purchase
// token without transmitting it: SHA-256 over the UTF-8 token, lowercase hex.
// The Android adapter already computes exactly this, and the server recomputes
// it rather than trusting a client-supplied digest whenever it holds the token.
func TokenDigest(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

// ContentDigest canonicalizes a JSON body before hashing so that two deliveries
// differing only in key order or whitespace compare equal. A body that is not
// JSON is hashed as received.
func ContentDigest(body []byte) []byte {
	var canonical any
	if err := json.Unmarshal(body, &canonical); err == nil {
		if encoded, err := json.Marshal(canonical); err == nil {
			sum := sha256.Sum256(encoded)
			return sum[:]
		}
	}
	sum := sha256.Sum256(body)
	return sum[:]
}

// FactDigest is the identity of a Transaction Fact within an Environment.
//
// It covers everything that gives the fact meaning and deliberately excludes
// the fact's own id, its provenance columns, and recorded_at. That exclusion is
// what makes replay a structural no-op: re-validating the same input against
// the same mapping history recomputes the same digest and the unique constraint
// absorbs the write, while a genuinely different outcome produces a different
// digest and is recorded as a new fact rather than overwriting the old one.
func FactDigest(fact TransactionFact) []byte {
	fields := []string{
		fact.EnvironmentID,
		fact.ApplicationID,
		fact.Provider,
		fact.StoreEnvironment,
		fact.ProviderTransactionID,
		fact.ProviderOriginalTransactionID,
		hex.EncodeToString(fact.PurchaseChainDigest),
		hex.EncodeToString(fact.SupersedesChainDigest),
		fact.TransactionType,
		fact.FactKind,
		timeField(&fact.OccurredAt),
		timeField(fact.PeriodStartAt),
		timeField(fact.PeriodEndAt),
		timeField(fact.RevokedAt),
		timeField(fact.RefundedAt),
		boolField(fact.RenewalExpected),
		strconv.FormatBool(fact.IsTestTransaction),
		fact.ProviderProductIdentifier,
		fact.ProviderBasePlanIdentifier,
		fact.ProviderOfferIdentifier,
		fact.ResolutionState,
		fact.MosaicProductID,
		fact.ProviderProductMappingID,
		int64Field(fact.ResolvedMappingVersion),
		strconv.Itoa(fact.ValidatorVersion),
		strconv.Itoa(fact.FactVersion),
	}
	return digestOf("mosaic-billing-fact-v1", fields...)
}

func timeField(value *time.Time) string {
	if value == nil || value.IsZero() {
		return ""
	}
	return strconv.FormatInt(value.UTC().UnixMilli(), 10)
}

func boolField(value *bool) string {
	if value == nil {
		return ""
	}
	return strconv.FormatBool(*value)
}

func int64Field(value *int64) string {
	if value == nil {
		return ""
	}
	return strconv.FormatInt(*value, 10)
}

// SafeProviderCode bounds any provider-supplied identifier to the charset the
// contract's safeProviderCode allows: printable ASCII, no control characters,
// at most 128 runes. Every reference a client may submit is checked against
// this, which structurally excludes a JWS or a raw Google purchase token from
// the untrusted observation endpoint — both exceed the length bound by an order
// of magnitude.
func SafeProviderCode(value string) (string, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || len([]rune(trimmed)) > 128 {
		return "", false
	}
	for _, r := range trimmed {
		if r < 0x20 || r > 0x7e {
			return "", false
		}
	}
	return trimmed, true
}

// ValidHexDigest reports whether value is a lowercase hex SHA-256 digest.
func ValidHexDigest(value string) ([]byte, bool) {
	if len(value) != 64 {
		return nil, false
	}
	decoded, err := hex.DecodeString(value)
	if err != nil || strings.ToLower(value) != value {
		return nil, false
	}
	return decoded, true
}
