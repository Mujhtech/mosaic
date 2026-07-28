package billingwebhook

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
)

// Rotation is the one place where "which secrets sign this delivery?" has more
// than one right answer, and getting it wrong is invisible until a tenant's
// receiver starts rejecting deliveries.
//
// Two failures are protected here. Signing with only the newest secret breaks
// every receiver that has not yet redeployed, which is the outage the overlap
// exists to prevent. Continuing to sign with a secret whose window has lapsed —
// or one an operator explicitly retired after a suspected compromise — leaves
// the compromised secret able to authenticate Mosaic's own traffic, which is
// the reason retirement exists at all.

// plaintextCipher seals by copying. It still enforces the subject scope, so a
// secret read under the wrong destination fails to open exactly as the real
// AES-GCM additional-authenticated-data binding makes it fail.
type plaintextCipher struct {
	boundTo providercredential.SubjectScope
}

func (c *plaintextCipher) EncryptSubject(plaintext []byte, scope providercredential.SubjectScope) (providercredential.Envelope, error) {
	c.boundTo = scope
	return providercredential.Envelope{
		Version: 1, Algorithm: "test", KeyID: "test",
		Ciphertext: append([]byte(nil), plaintext...), CredentialClass: scope.CredentialClass,
	}, nil
}

func (c *plaintextCipher) DecryptSubject(envelope providercredential.Envelope, scope providercredential.SubjectScope) ([]byte, error) {
	if scope.SubjectKind != providercredential.SubjectWebhookSigningSecret || scope.SubjectID == "" {
		return nil, ErrSecretUnavailable
	}
	return append([]byte(nil), envelope.Ciphertext...), nil
}

func (c *plaintextCipher) ActiveKeyID() string { return "test" }

func sealedFor(value, status string, honoredUntil *time.Time) StoredSecret {
	return StoredSecret{
		SealedSecret: SealedSecret{
			ID: "whs_" + value, EnvelopeVersion: 1, Algorithm: "test", KeyID: "test",
			Ciphertext: []byte(value),
		},
		Status: status, HonoredUntil: honoredUntil,
	}
}

func TestOverlapSignsWithEverySecretStillHonored(t *testing.T) {
	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	service := NewService(nil, &plaintextCipher{}, NewPolicy(), WithClock(func() time.Time { return now }))

	insideWindow := now.Add(6 * time.Hour)
	lapsed := now.Add(-1 * time.Minute)

	leased := LeasedDelivery{
		Delivery:       Delivery{ID: "whdl_1", ProjectID: "prj_1", DestinationID: "whd_1", EventID: "evt_1"},
		OrganizationID: "org_1",
		Body:           []byte(`{"payload":{}}`),
		Secrets: []StoredSecret{
			// Deliberately out of order: the newest active secret must lead the
			// header regardless of the order storage returned.
			sealedFor("superseded", SecretRetired, &insideWindow),
			sealedFor("current", SecretActive, nil),
			// Its window has passed. It must not sign again.
			sealedFor("expired", SecretRetired, &lapsed),
			// Retired with no window at all: an explicit retirement.
			sealedFor("revoked", SecretRetired, nil),
		},
	}

	secrets, err := service.openSecrets(context.Background(), leased)
	if err != nil {
		t.Fatalf("openSecrets: %v", err)
	}
	if len(secrets) != 2 {
		t.Fatalf("signing with %d secrets (%v), want the active one and the one still inside its window",
			len(secrets), secrets)
	}
	if secrets[0] != "current" {
		t.Fatalf("first signature is from %q, want the active secret", secrets[0])
	}
	if secrets[1] != "superseded" {
		t.Fatalf("second signature is from %q, want the secret inside its overlap window", secrets[1])
	}

	timestamp := now.Unix()
	signatures := make([]string, 0, len(secrets))
	for _, secret := range secrets {
		signatures = append(signatures, Sign(secret, timestamp, leased.Delivery.EventID, leased.Body))
	}
	header := Header(signatures, timestamp)
	if strings.Count(header, "v1=") != 2 {
		t.Fatalf("header carries %d v1 elements during a rotation, want one per signing secret: %q",
			strings.Count(header, "v1="), header)
	}
	// A receiver that has adopted either secret must be able to verify.
	for _, secret := range []string{"current", "superseded"} {
		if !Verify(secret, timestamp, leased.Delivery.EventID, leased.Body, signatures) {
			t.Fatalf("a receiver holding %q could not verify the delivery", secret)
		}
	}
	// The lapsed and explicitly retired secrets must not.
	for _, secret := range []string{"expired", "revoked"} {
		if Verify(secret, timestamp, leased.Delivery.EventID, leased.Body, signatures) {
			t.Fatalf("retired secret %q still signs deliveries", secret)
		}
	}
}

// A destination with nothing left that can sign must fail the attempt rather
// than send an unsigned body. An unsigned entitlement webhook is an
// unauthenticated instruction to grant access, so "send it anyway" is never the
// safe degradation.
func TestNoHonoredSecretRefusesToSign(t *testing.T) {
	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	service := NewService(nil, &plaintextCipher{}, NewPolicy(), WithClock(func() time.Time { return now }))
	lapsed := now.Add(-time.Second)

	_, err := service.openSecrets(context.Background(), LeasedDelivery{
		Delivery: Delivery{ID: "whdl_1", ProjectID: "prj_1", DestinationID: "whd_1"},
		Secrets:  []StoredSecret{sealedFor("expired", SecretRetired, &lapsed)},
	})
	if err != ErrSecretUnavailable {
		t.Fatalf("openSecrets with no honored secret = %v, want ErrSecretUnavailable", err)
	}
}
