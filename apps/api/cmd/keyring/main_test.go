package main

import (
	"context"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingmigrationobject"
)

type sourceObjectInventoryStub map[string]int64

func (s sourceObjectInventoryStub) SourceObjectEnvelopeCountsByKeyID(context.Context) (map[string]int64, error) {
	return s, nil
}

func sourceObjectTestCipher(t *testing.T) *billingmigrationobject.Cipher {
	t.Helper()
	key := base64.RawURLEncoding.EncodeToString(make([]byte, 32))
	cipher, err := billingmigrationobject.NewKeyringCipher(`{"version":1,"activeKeyId":"current","keys":{"current":"`+key+`"}}`, 0)
	if err != nil {
		t.Fatal(err)
	}
	return cipher
}

func TestMigrationSourceInspectFailsClosedForMissingStoredObjectKey(t *testing.T) {
	err := inspectMigrationSourceObjects(context.Background(), sourceObjectInventoryStub{"retired-missing": 2}, sourceObjectTestCipher(t))
	if err == nil || !strings.Contains(err.Error(), "absent from MOSAIC_BILLING_MIGRATION_SOURCE_KEYRING") {
		t.Fatalf("missing-key error = %v", err)
	}
}

func TestMigrationSourceRotateRefusesImmutableObjectReseal(t *testing.T) {
	err := validateCategoryAction(categoryMigrationSource, "rotate")
	if err == nil || !strings.Contains(err.Error(), "immutable and cannot be resealed") {
		t.Fatalf("rotation refusal = %v", err)
	}
}
