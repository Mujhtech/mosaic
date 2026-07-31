package billingmigrationobject

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"testing"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
)

func TestChunkedEnvelopeRoundTripAndCiphertextDiffers(t *testing.T) {
	cipher := testCipher(t)
	scope := testScope("project_one")
	plaintext := bytes.Repeat([]byte("migration-evidence-"), 5000)
	var encrypted bytes.Buffer
	metadata, err := cipher.Encrypt(context.Background(), scope, bytes.NewReader(plaintext), &encrypted)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(encrypted.Bytes(), plaintext[:256]) {
		t.Fatal("ciphertext contains a plaintext prefix")
	}
	var opened bytes.Buffer
	if err := cipher.Decrypt(context.Background(), scope, metadata, bytes.NewReader(encrypted.Bytes()), &opened); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(opened.Bytes(), plaintext) {
		t.Fatal("roundtrip plaintext differs")
	}
}

func TestChunkedEnvelopeRejectsCrossAADTruncationAndTamper(t *testing.T) {
	cipher := testCipher(t)
	scope := testScope("project_one")
	var encrypted bytes.Buffer
	metadata, err := cipher.Encrypt(context.Background(), scope, bytes.NewReader(bytes.Repeat([]byte("x"), 40000)), &encrypted)
	if err != nil {
		t.Fatal(err)
	}
	if err := cipher.Decrypt(context.Background(), testScope("project_two"), metadata, bytes.NewReader(encrypted.Bytes()), io.Discard); !errors.Is(err, billingmigration.ErrSourceObjectCorrupt) {
		t.Fatalf("cross-AAD error = %v", err)
	}
	truncated := encrypted.Bytes()[:encrypted.Len()-1]
	if err := cipher.Decrypt(context.Background(), scope, metadata, bytes.NewReader(truncated), io.Discard); !errors.Is(err, billingmigration.ErrSourceObjectCorrupt) {
		t.Fatalf("truncation error = %v", err)
	}
	tampered := append([]byte(nil), encrypted.Bytes()...)
	tampered[len(tampered)/2] ^= 0x80
	if err := cipher.Decrypt(context.Background(), scope, metadata, bytes.NewReader(tampered), io.Discard); !errors.Is(err, billingmigration.ErrSourceObjectCorrupt) {
		t.Fatalf("tamper error = %v", err)
	}
}

func TestChunkedEnvelopeRejectsOversizeWithoutBuffering(t *testing.T) {
	cipher := testCipher(t)
	reader := io.LimitReader(zeroes{}, billingmigration.SourceObjectMaxPlaintext+1)
	if _, err := cipher.Encrypt(context.Background(), testScope("project_one"), reader, io.Discard); !errors.Is(err, billingmigration.ErrSourceObjectTooLarge) {
		t.Fatalf("oversize error = %v", err)
	}
}

func TestKeyringRotationRetainsOldObjectDecryption(t *testing.T) {
	oldKey := bytes.Repeat([]byte{0x31}, 32)
	newKey := bytes.Repeat([]byte{0x32}, 32)
	oldCipher, err := NewKeyringCipher(keyring("old", map[string][]byte{"old": oldKey}), 16*1024)
	if err != nil {
		t.Fatal(err)
	}
	oldCipher.random = bytes.NewReader(bytes.Repeat([]byte{0x41}, 12))
	var encrypted bytes.Buffer
	metadata, err := oldCipher.Encrypt(context.Background(), testScope("project_one"), bytes.NewBufferString("retained migration evidence"), &encrypted)
	if err != nil {
		t.Fatal(err)
	}
	rotated, err := NewKeyringCipher(keyring("new", map[string][]byte{"old": oldKey, "new": newKey}), 16*1024)
	if err != nil {
		t.Fatal(err)
	}
	if rotated.ActiveKeyID() != "new" || fmt.Sprint(rotated.KeyIDs()) != "[new old]" {
		t.Fatalf("rotated keyring active=%q ids=%v", rotated.ActiveKeyID(), rotated.KeyIDs())
	}
	var opened bytes.Buffer
	if err := rotated.Decrypt(context.Background(), testScope("project_one"), metadata, bytes.NewReader(encrypted.Bytes()), &opened); err != nil {
		t.Fatal(err)
	}
	if opened.String() != "retained migration evidence" {
		t.Fatalf("opened = %q", opened.String())
	}
}

func TestKeyringRejectsUnknownFieldsAndMissingEnvelopeKey(t *testing.T) {
	valid := keyring("active", map[string][]byte{"active": bytes.Repeat([]byte{0x51}, 32)})
	if err := ValidateKeyring(valid); err != nil {
		t.Fatal(err)
	}
	if err := ValidateKeyring(`{"version":1,"activeKeyId":"active","keys":{},"extra":true}`); err == nil {
		t.Fatal("unknown keyring field was accepted")
	}
	if err := ValidateKeyring(`{"version":1,"activeKeyId":"active","activeKeyId":"other","keys":{"active":"MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI"}}`); err == nil {
		t.Fatal("duplicate keyring field was accepted")
	}
	cipher, err := NewKeyringCipher(valid, 16*1024)
	if err != nil {
		t.Fatal(err)
	}
	metadata := billingmigration.SourceObjectEnvelope{Version: EnvelopeVersion, Algorithm: Algorithm, KeyID: "retired"}
	if err := cipher.Decrypt(context.Background(), testScope("project_one"), metadata, bytes.NewReader(nil), io.Discard); !errors.Is(err, billingmigration.ErrSourceObjectCorrupt) {
		t.Fatalf("missing key error = %v", err)
	}
}

func keyring(active string, keys map[string][]byte) string {
	encoded := make(map[string]string, len(keys))
	for id, key := range keys {
		encoded[id] = base64.RawURLEncoding.EncodeToString(key)
	}
	raw, _ := json.Marshal(map[string]any{"version": 1, "activeKeyId": active, "keys": encoded})
	return string(raw)
}

func testCipher(t *testing.T) *Cipher {
	t.Helper()
	cipher, err := NewCipher("source-key-one", bytes.Repeat([]byte{0x42}, 32), 16*1024)
	if err != nil {
		t.Fatal(err)
	}
	cipher.random = bytes.NewReader(bytes.Repeat([]byte{0x24}, 12))
	return cipher
}
func testScope(project string) billingmigration.SourceObjectScope {
	return billingmigration.SourceObjectScope{ProjectID: project, ProgramID: "program_one", ObjectID: "object_one", AdapterVersion: billingmigration.AdapterVersion, SchemaVersion: "v1"}
}

type zeroes struct{}

func (zeroes) Read(p []byte) (int, error) { clear(p); return len(p), nil }
