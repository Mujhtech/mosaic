package billingmigration

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
)

type SourcePullService struct {
	repository SourcePullRepository
	now        func() time.Time
}

func NewSourcePullService(repository SourcePullRepository, now func() time.Time) *SourcePullService {
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &SourcePullService{repository: repository, now: now}
}

func (s *SourcePullService) Queue(ctx context.Context, command SourcePullCommand) (SourcePullJob, bool, error) {
	if s == nil || s.repository == nil || strings.TrimSpace(command.Actor.ID) == "" || strings.TrimSpace(command.ProjectID) == "" || strings.TrimSpace(command.ProgramID) == "" || strings.TrimSpace(command.IdempotencyKey) == "" || command.ExpectedStateVersion < 1 || !validSourcePullIntent(command.Intent) {
		return SourcePullJob{}, false, ErrInvalid
	}
	if command.Intent == SourcePullSnapshot {
		if command.StartingCursor != "" || command.StartingWatermark != "" || len(command.StartingWatermarkDigest) != 0 {
			return SourcePullJob{}, false, ErrInvalid
		}
	} else if !validOptionalSourcePullPosition(command.StartingCursor) || !validSourcePullPosition(command.StartingWatermark) || len(command.StartingWatermarkDigest) != sha256.Size {
		return SourcePullJob{}, false, ErrInvalid
	}
	if len(command.RequestDigest) == 0 {
		canonical, _ := json.Marshal([]any{command.ProjectID, command.ProgramID, command.Intent, command.StartingCursor, command.StartingWatermark, command.StartingWatermarkDigest, command.ExpectedStateVersion})
		digest := sha256.Sum256(canonical)
		command.RequestDigest = digest[:]
	}
	command.CreatedAt = s.now()
	return s.repository.QueueSourcePull(ctx, command)
}

type SourcePullProcessor struct {
	repository    SourcePullRepository
	provider      SourcePullProvider
	ingestor      *SourceObjectIngestor
	cipher        providercredential.SubjectCipher
	now           func() time.Time
	leaseDuration time.Duration
}

func NewSourcePullProcessor(repository SourcePullRepository, provider SourcePullProvider, ingestor *SourceObjectIngestor, cipher providercredential.SubjectCipher, now func() time.Time) *SourcePullProcessor {
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &SourcePullProcessor{repository: repository, provider: provider, ingestor: ingestor, cipher: cipher, now: now, leaseDuration: 2 * time.Minute}
}

func (p *SourcePullProcessor) ProcessNext(ctx context.Context, workerID string) (bool, error) {
	if p == nil || p.repository == nil || p.provider == nil || p.ingestor == nil || p.cipher == nil || strings.TrimSpace(workerID) == "" {
		return false, ErrInvalid
	}
	now := p.now()
	lease, ok, err := p.repository.LeaseSourcePull(ctx, workerID, now, now.Add(p.leaseDuration))
	if err != nil || !ok {
		return ok, err
	}
	secret, err := p.cipher.DecryptSubject(lease.CredentialEnvelope, providercredential.SubjectScope{OrganizationID: lease.OrganizationID, ProjectID: lease.ProjectID, SubjectKind: providercredential.SubjectBillingMigrationCredential, SubjectID: lease.CredentialID, CredentialClass: "revenuecat_migration_api_key"})
	if err != nil {
		return true, p.fail(ctx, lease, "credential_unavailable", err)
	}
	defer func() {
		for i := range secret {
			secret[i] = 0
		}
	}()

	objectID := fmt.Sprintf("mso_pull_%s_%d", lease.ID, lease.LeaseGeneration)
	reservationDigest := sha256.Sum256([]byte(lease.ID + "\x1f" + fmt.Sprint(lease.LeaseGeneration) + "\x1f" + lease.Intent))
	reader, writer := io.Pipe()
	type ingestResult struct {
		object SourceObject
		err    error
	}
	ingested := make(chan ingestResult, 1)
	go func() {
		object, _, ingestErr := p.ingestor.Ingest(ctx, ReserveSourceObject{SourceObject: SourceObject{SourceObjectScope: SourceObjectScope{ProjectID: lease.ProjectID, ProgramID: lease.ProgramID, ObjectID: objectID, AdapterVersion: AdapterVersion, SchemaVersion: "revenuecat-migration-source-v2"}, ReservationKey: fmt.Sprintf("source-pull:%s:%d", lease.ID, lease.LeaseGeneration), ReservationDigest: reservationDigest[:], SourceChannel: SourceChannelRevenueCat}}, reader)
		ingested <- ingestResult{object: object, err: ingestErr}
	}()
	pulled, pullErr := p.provider.PullSource(ctx, lease.ExternalProjectID, secret, lease.StartingCursor, writer)
	_ = writer.CloseWithError(pullErr)
	stored := <-ingested
	if pullErr != nil || stored.err != nil {
		return true, p.fail(ctx, lease, "source_pull_failed", errors.Join(pullErr, stored.err))
	}
	currentAccess := int64(0)
	for _, record := range pulled.Records {
		if record.CurrentAccess {
			currentAccess++
		}
	}
	if len(pulled.EvidenceDigest) != sha256.Size || pulled.RecordCount != int64(len(pulled.Records)) || pulled.CurrentAccessCount != currentAccess {
		return true, p.fail(ctx, lease, "source_normalization_invalid", ErrInvalid)
	}
	records, err := p.repository.BindSourcePullRecords(ctx, lease, pulled.Records)
	if err != nil {
		return true, p.fail(ctx, lease, "source_binding_failed", err)
	}
	manifestID := deterministicPullID("msm", lease.ID, lease.LeaseGeneration)
	batchID := deterministicPullID("mib", lease.ID, lease.LeaseGeneration)
	manifestDigest := sourcePullManifestDigest(lease, pulled, stored.object)
	current := int64(0)
	imports := 0
	for i := range records {
		if records[i].CurrentAccess {
			current++
		}
		if records[i].ProviderReference != nil && records[i].QuarantineReason == "" {
			imports++
		}
	}
	write := SourceObjectManifestWrite{ExpectedStateVersion: lease.ExpectedStateVersion, SourceObjectID: objectID, SourcePullJobID: lease.ID, SourcePullOwner: lease.Owner, SourcePullGeneration: lease.LeaseGeneration, SourcePullEvidenceDigest: pulled.EvidenceDigest, SourcePullResumeCursor: pulled.ResumeCursor, SourcePullFinalWatermark: pulled.FinalWatermark, SourcePullProvenCapabilities: pulled.ProvenCapabilities, Records: records, BindingDigest: manifestDigest, Now: p.now()}
	write.Manifest = ManifestWrite{Manifest: SourceManifest{ManifestID: manifestID, ProgramID: lease.ProgramID, StateVersion: lease.ExpectedStateVersion, AdapterVersion: AdapterVersion, ProviderAPIVersion: ProviderAPIV2, SchemaVersion: "revenuecat-migration-source-v2", RecordCount: int64(len(records)), CurrentAccessRecordCount: current, CapturedAt: write.Now}, ProjectID: lease.ProjectID, ObjectKey: stored.object.ObjectKey, ObjectChecksum: stored.object.Envelope.PlaintextDigest, ObjectSizeBytes: stored.object.Envelope.PlaintextSize, ManifestDigest: manifestDigest, SourceWatermark: pulled.FinalWatermark}
	request := sha256.Sum256(append(append([]byte("source-pull-import\x1f"), manifestDigest...), pulled.EvidenceDigest...))
	write.ImportWork = &ImportBatchWrite{Batch: ImportBatch{BatchID: batchID, ProgramID: lease.ProgramID, StateVersion: lease.ExpectedStateVersion, IdempotencyKey: "source-pull:" + lease.ID, RecordCount: imports}, ProjectID: lease.ProjectID, ManifestID: manifestID, MappingSetID: lease.MappingSetID, RequestDigest: request[:], CursorBefore: lease.StartingCursor, CreatedAt: write.Now}
	if err := p.ingestor.repository.AppendVerifiedSource(ctx, write); err != nil {
		return true, p.fail(ctx, lease, "source_append_failed", err)
	}
	return true, nil
}

func (p *SourcePullProcessor) fail(ctx context.Context, lease SourcePullLease, code string, cause error) error {
	err := p.repository.SettleSourcePull(ctx, SourcePullSettlement{Lease: lease, Status: "failed", ErrorCode: code, RetryAt: p.now().Add(time.Minute), SettledAt: p.now()})
	return errors.Join(cause, err)
}

func validSourcePullIntent(intent string) bool {
	return intent == SourcePullSnapshot || intent == SourcePullDelta || intent == SourcePullFinalDelta
}

func validSourcePullPosition(value string) bool {
	if len(value) == 0 || len(value) > 512 {
		return false
	}
	for _, r := range value {
		if r <= 0x1f || r == 0x7f {
			return false
		}
	}
	return true
}

func validOptionalSourcePullPosition(value string) bool {
	return value == "" || validSourcePullPosition(value)
}

func deterministicPullID(prefix, jobID string, generation int64) string {
	d := sha256.Sum256([]byte(prefix + "\x1f" + jobID + "\x1f" + fmt.Sprint(generation)))
	return prefix + "_" + hex.EncodeToString(d[:12])
}

func sourcePullManifestDigest(lease SourcePullLease, result SourcePullProviderResult, object SourceObject) []byte {
	h := sha256.New()
	for _, value := range [][]byte{[]byte("mosaic-source-pull-manifest-v1"), []byte(lease.ID), []byte(lease.Intent), result.EvidenceDigest, object.Envelope.PlaintextDigest, []byte(result.FinalWatermark)} {
		_, _ = h.Write(value)
		_, _ = h.Write([]byte{0})
	}
	return h.Sum(nil)
}
