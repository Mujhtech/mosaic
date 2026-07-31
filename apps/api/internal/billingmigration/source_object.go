package billingmigration

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
)

const (
	SourceObjectMaxPlaintext = int64(100 * 1024 * 1024)
	SourceChannelRevenueCat  = "revenuecat_api_v2"
	SourceChannelExport      = "scheduled_export_evidence"
)

var (
	ErrSourceObjectCorrupt  = fmt.Errorf("migration source object corrupt: %w", ErrInvalid)
	ErrSourceObjectTooLarge = fmt.Errorf("migration source object too large: %w", ErrInvalid)
	ErrLeaseLost            = fmt.Errorf("migration execution lease lost: %w", ErrConflict)
)

type SourceObjectScope struct {
	ProjectID, ProgramID, ObjectID, AdapterVersion, SchemaVersion string
}

// AAD is deliberately composed only from bounded tenant and format identities.
// Source identifiers and provider payloads must never become key names or telemetry.
func (s SourceObjectScope) AAD() []byte {
	return []byte(strings.Join([]string{"mosaic", "billing-migration-source", "v1", s.ProjectID, s.ProgramID, s.ObjectID, s.AdapterVersion, s.SchemaVersion}, "\x1f"))
}

type SourceObjectEnvelope struct {
	Version                    int
	Algorithm, KeyID           string
	Nonce                      []byte
	ChunkSize, ChunkCount      int
	AADDigest, PlaintextDigest []byte
	PlaintextSize              int64
	CiphertextDigest           []byte
	CiphertextSize             int64
}

type SourceObject struct {
	SourceObjectScope
	ReservationKey, ObjectKey, SourceChannel, State, ErrorCode string
	ReservationDigest                                          []byte
	ReservationGeneration                                      int64
	WriteTokenDigest                                           []byte
	Envelope                                                   SourceObjectEnvelope
	ReservedAt, VerifiedAt                                     time.Time
}

type ReserveSourceObject struct {
	SourceObject
	Now time.Time
}

type VerifySourceObject struct {
	ProjectID, ProgramID, ObjectID string
	ReservationGeneration          int64
	WriteTokenDigest               []byte
	Envelope                       SourceObjectEnvelope
	Now                            time.Time
}

type SourceObjectManifestWrite struct {
	ExpectedStateVersion                             int64
	SourceObjectID                                   string
	SourcePullJobID                                  string
	SourcePullOwner                                  string
	SourcePullGeneration                             int64
	SourcePullEvidenceDigest                         []byte
	SourcePullResumeCursor, SourcePullFinalWatermark string
	SourcePullProvenCapabilities                     []string
	Manifest                                         ManifestWrite
	Records                                          []NormalizedSourceRecord
	ImportWork                                       *ImportBatchWrite
	BindingDigest                                    []byte
	Now                                              time.Time
}

type NormalizedSourceRecord struct {
	ID, SourceKind, SourceIdentifier, SourceRevision, SourceCursor string
	RecordDigest                                                   []byte
	CurrentAccess                                                  bool
	NormalizationSchemaVersion, EvidenceKind                       string
	ObservedAt, CreatedAt                                          time.Time
	ProviderReference                                              *KnownProviderReference
	CustomerID, ProductID, ExternalAppID, Store, SourceEnvironment string
	StoreIdentifier                                                string
	TargetProductID                                                string
	EntitlementIDs                                                 []string
	Ownership                                                      []byte
	OwnershipDigest                                                []byte
	QuarantineReason                                               string
}

type SourceObjectRepository interface {
	ReserveSourceObject(ctx context.Context, write ReserveSourceObject) (SourceObject, bool, error)
	VerifySourceObject(ctx context.Context, write VerifySourceObject) error
	FailSourceObject(ctx context.Context, projectID, programID, objectID, errorCode string, at time.Time) error
	AppendVerifiedSource(ctx context.Context, write SourceObjectManifestWrite) error
}

type SourceObjectStore interface {
	Put(ctx context.Context, key string, body io.Reader, size int64, mediaType string) error
	Open(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
}

type SourceObjectCipher interface {
	Encrypt(ctx context.Context, scope SourceObjectScope, plaintext io.Reader, ciphertext io.Writer) (SourceObjectEnvelope, error)
	Decrypt(ctx context.Context, scope SourceObjectScope, expected SourceObjectEnvelope, ciphertext io.Reader, plaintext io.Writer) error
}

// SourceObjectIngestor streams plaintext to encrypted private storage, then
// independently opens and authenticates it before the repository may append a
// manifest. It never buffers the source object.
type SourceObjectIngestor struct {
	repository SourceObjectRepository
	store      SourceObjectStore
	cipher     SourceObjectCipher
	now        func() time.Time
}

func NewSourceObjectIngestor(repository SourceObjectRepository, store SourceObjectStore, cipher SourceObjectCipher, now func() time.Time) *SourceObjectIngestor {
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &SourceObjectIngestor{repository: repository, store: store, cipher: cipher, now: now}
}

func DeterministicSourceObjectKey(projectID, programID, objectID string) string {
	digest := sha256.Sum256([]byte(projectID + "\x1f" + programID + "\x1f" + objectID))
	return "billing-migration/v1/" + hex.EncodeToString(digest[:]) + ".mso"
}

func (s *SourceObjectIngestor) Ingest(ctx context.Context, reservation ReserveSourceObject, plaintext io.Reader) (SourceObject, bool, error) {
	if s == nil || s.repository == nil || s.store == nil || s.cipher == nil || plaintext == nil || reservation.ProjectID == "" || reservation.ProgramID == "" || reservation.ObjectID == "" {
		return SourceObject{}, false, ErrInvalid
	}
	reservation.ObjectKey = DeterministicSourceObjectKey(reservation.ProjectID, reservation.ProgramID, reservation.ObjectID)
	writeToken := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, writeToken); err != nil {
		return SourceObject{}, false, ErrUnavailable
	}
	tokenDigest := sha256.Sum256(writeToken)
	reservation.WriteTokenDigest = tokenDigest[:]
	reservation.ReservationGeneration = 1
	reservation.Now = s.now()
	object, replay, err := s.repository.ReserveSourceObject(ctx, reservation)
	if err != nil || replay && object.State == "verified" {
		return object, replay, err
	}
	if replay {
		return object, true, ErrConflict
	}

	pipeReader, pipeWriter := io.Pipe()
	type encryptionResult struct {
		envelope SourceObjectEnvelope
		err      error
	}
	result := make(chan encryptionResult, 1)
	go func() {
		envelope, encryptErr := s.cipher.Encrypt(ctx, object.SourceObjectScope, plaintext, pipeWriter)
		_ = pipeWriter.CloseWithError(encryptErr)
		result <- encryptionResult{envelope: envelope, err: encryptErr}
	}()
	putErr := s.store.Put(ctx, object.ObjectKey, pipeReader, -1, "application/vnd.mosaic.source-object.v1")
	_ = pipeReader.CloseWithError(putErr)
	encrypted := <-result
	if putErr != nil || encrypted.err != nil {
		failure := errors.Join(putErr, encrypted.err)
		_ = s.repository.FailSourceObject(ctx, object.ProjectID, object.ProgramID, object.ObjectID, "source_object_store_failed", s.now())
		return object, replay, errors.Join(ErrUnavailable, failure)
	}

	stored, err := s.store.Open(ctx, object.ObjectKey)
	if err == nil {
		err = s.cipher.Decrypt(ctx, object.SourceObjectScope, encrypted.envelope, stored, io.Discard)
		_ = stored.Close()
	}
	if err != nil {
		_ = s.store.Delete(ctx, object.ObjectKey)
		_ = s.repository.FailSourceObject(ctx, object.ProjectID, object.ProgramID, object.ObjectID, "source_object_verification_failed", s.now())
		return object, replay, errors.Join(ErrSourceObjectCorrupt, err)
	}
	if err := s.repository.VerifySourceObject(ctx, VerifySourceObject{ProjectID: object.ProjectID, ProgramID: object.ProgramID, ObjectID: object.ObjectID, ReservationGeneration: object.ReservationGeneration, WriteTokenDigest: object.WriteTokenDigest, Envelope: encrypted.envelope, Now: s.now()}); err != nil {
		return object, replay, err
	}
	object.State, object.Envelope, object.VerifiedAt = "verified", encrypted.envelope, s.now()
	return object, replay, nil
}
