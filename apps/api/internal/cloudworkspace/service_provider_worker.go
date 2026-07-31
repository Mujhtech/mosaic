package cloudworkspace

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/providercatalog"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
)

const providerSyncLeaseDuration = 2 * time.Minute

func (s *Service) workerCredential(ctx context.Context, connectionID string) (ProviderConnection, Project, []byte, error) {
	if err := s.requireProviderOperations(); err != nil {
		return ProviderConnection{}, Project{}, nil, err
	}
	var connection ProviderConnection
	var project Project
	var record ProviderCredentialRecord
	err := s.repository.View(ctx, func(reader Reader) error {
		var ok bool
		connection, ok = reader.ProviderConnection(connectionID)
		if !ok {
			return ErrNotFound
		}
		if connection.Status == ProviderConnectionRevoked {
			return ErrConnectionRevoked
		}
		project, ok = reader.Project(connection.ProjectID)
		if !ok {
			return ErrNotFound
		}
		record, ok = reader.ProviderCredential(connection.ID)
		if !ok || record.RevokedAt != nil {
			return ErrProviderCredentialInvalid
		}
		return nil
	})
	if err != nil {
		return ProviderConnection{}, Project{}, nil, err
	}
	plaintext, err := s.credentialCipher.Decrypt(providercredential.Envelope{
		Version: record.Version, Algorithm: record.Algorithm, KeyID: record.KeyID,
		Nonce: record.Nonce, Ciphertext: record.Ciphertext,
		CredentialClass: record.Class, Fingerprint: record.Fingerprint,
	}, providercredential.Scope{
		OrganizationID: project.OrganizationID, ProjectID: project.ID,
		ConnectionID: connection.ID, CredentialClass: record.Class,
	})
	if err != nil {
		return ProviderConnection{}, Project{}, nil, ErrProviderCredentialInvalid
	}
	return connection, project, plaintext, nil
}

// ProcessNextProviderSync leases and processes at most one job. The bool is
// false when no job was ready; callers may then wait before polling again.
func (s *Service) ProcessNextProviderSync(ctx context.Context, workerID string) (bool, error) {
	if workerID == "" {
		return false, errors.New("worker ID is required")
	}
	var job ProviderSyncJob
	var run ProviderSyncRun
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		now := s.now()
		var ok bool
		job, ok = tx.LeaseProviderSyncJob(workerID, now, now.Add(providerSyncLeaseDuration))
		if !ok {
			return nil
		}
		for _, existing := range tx.ProviderSyncRuns(job.ConnectionID) {
			if existing.JobID == job.ID {
				run = existing
				break
			}
		}
		if run.ID == "" {
			run = ProviderSyncRun{
				ID: tx.NextID("provider_sync_run"), ProjectID: job.ProjectID,
				ConnectionID: job.ConnectionID, JobID: job.ID, CreatedAt: now,
			}
		}
		run.Status, run.StartedAt, run.CompletedAt = "running", now, nil
		run.ItemCount, run.SuccessCount, run.FailureCount = 0, 0, 0
		tx.SaveProviderSyncRun(run)
		return nil
	})
	if err != nil || job.ID == "" {
		return job.ID != "", err
	}
	connection, project, secret, err := s.workerCredential(ctx, job.ConnectionID)
	if err != nil {
		return true, s.finishFailedProviderSync(ctx, job, run, err)
	}
	catalog, providerErr := s.providerCatalog.FetchCatalog(ctx, providercatalog.Credential{
		Secret: secret, ExternalProjectID: connection.ExternalProjectID,
	})
	zero(secret)
	if providerErr != nil {
		return true, s.finishFailedProviderSync(ctx, job, run, providerErr)
	}
	err = s.repository.Transact(ctx, func(tx Transaction) error {
		if !tx.OwnsProviderSyncJobLease(job.ID, job.LeaseOwner, job.AttemptCount, s.now()) {
			return ErrProviderSyncLeaseLost
		}
		currentJob := job
		currentRun := run
		mappings := tx.ProviderMappingsByConnection(connection.ID)
		now := s.now()
		currentRun.ItemCount = len(mappings)
		for _, mapping := range mappings {
			if mapping.Status == ProviderMappingArchived || mapping.Status == ProviderMappingPlaceholder {
				currentRun.ItemCount--
				continue
			}
			product, ok := catalogProduct(catalog, mapping.ProviderProductIdentifier)
			item := ProviderSyncRunItem{
				RunID: currentRun.ID, ProjectID: project.ID, MappingID: mapping.ID,
				Status: "failed", ErrorCode: ProviderErrorProductNotFound, CompletedAt: now,
			}
			if !ok || product.State != "active" {
				mapping.Availability, mapping.SyncState = ProviderAvailabilityUnavailable, ProviderSyncFailed
				mapping.LastErrorCode, mapping.UpdatedAt = ProviderErrorProductNotFound, now
				tx.SaveProviderMapping(mapping)
				tx.SaveProviderSyncRunItem(item)
				currentRun.FailureCount++
				continue
			}
			offeringLookupKey, packageLookupKey, packageOK := catalogPackageLookupKeys(
				catalog, mapping.ProviderOfferingIdentifier, mapping.ProviderPackageIdentifier, product.ID,
			)
			if !packageOK {
				item.ErrorCode = ProviderErrorMappingMissing
				mapping.Availability, mapping.SyncState = ProviderAvailabilityUnavailable, ProviderSyncFailed
				mapping.LastErrorCode, mapping.UpdatedAt = ProviderErrorMappingMissing, now
				tx.SaveProviderMapping(mapping)
				tx.SaveProviderSyncRunItem(item)
				currentRun.FailureCount++
				continue
			}
			metadata, digest := normalizedProductMetadata(product)
			staleAt, expiresAt := now.Add(s.providerSnapshotTTL), now.Add(7*s.providerSnapshotTTL)
			snapshot := ProviderProductMetadataSnapshot{
				ID: tx.NextID("provider_snapshot"), ProjectID: project.ID, MappingID: mapping.ID,
				Source: ProviderMetadataProvider, Digest: digest,
				Availability: ProviderAvailabilityAvailable, ObservedAt: catalog.ObservedAt,
				SyncedAt: now, StaleAt: staleAt, ExpiresAt: &expiresAt,
				Metadata: json.RawMessage(metadata), CreatedAt: now,
			}
			tx.SaveProviderMetadataSnapshot(snapshot)
			mapping.ExpectedStoreProductID = product.StoreIdentifier
			mapping.ProviderOfferingIdentifier = offeringLookupKey
			mapping.ProviderPackageIdentifier = packageLookupKey
			mapping.Status, mapping.Availability, mapping.SyncState = ProviderMappingActive, ProviderAvailabilityAvailable, ProviderSyncCurrent
			mapping.CurrentSnapshotID, mapping.LastErrorCode, mapping.UpdatedAt = snapshot.ID, "", now
			tx.SaveProviderMapping(mapping)
			item.Status, item.SnapshotID, item.ErrorCode = "synchronized", snapshot.ID, ""
			tx.SaveProviderSyncRunItem(item)
			currentRun.SuccessCount++
		}
		currentRun.Status = "completed"
		if currentRun.FailureCount > 0 && currentRun.SuccessCount > 0 {
			currentRun.Status = "partial"
		} else if currentRun.FailureCount > 0 {
			currentRun.Status = "failed"
		}
		currentRun.CompletedAt = &now
		tx.SaveProviderSyncRun(currentRun)
		currentJob.Status, currentJob.LeaseOwner, currentJob.LeaseExpiresAt = ProviderSyncJobCompleted, "", nil
		if currentRun.Status == "failed" {
			currentJob.Status = ProviderSyncJobFailed
		}
		currentJob.UpdatedAt = now
		tx.SaveProviderSyncJob(currentJob)
		currentConnection, ok := tx.ProviderConnection(connection.ID)
		if ok {
			if currentRun.SuccessCount > 0 {
				currentConnection.LastSuccessfulSyncAt = &now
			}
			if currentRun.FailureCount > 0 {
				currentConnection.HealthStatus = ProviderHealthDegraded
				currentConnection.LastErrorCode = ProviderErrorSyncPartial
			} else {
				currentConnection.HealthStatus = ProviderHealthHealthy
				currentConnection.LastErrorCode = ""
			}
			currentConnection.UpdatedAt = now
			tx.SaveProviderConnection(currentConnection)
		}
		s.audit(tx, Actor{ID: job.RequestedByActorID}, project.OrganizationID, project.ID, "", "provider_sync.completed", "provider_sync_run", currentRun.ID, map[string]string{
			"status": currentRun.Status,
		})
		return nil
	})
	return true, err
}

func (s *Service) finishFailedProviderSync(ctx context.Context, job ProviderSyncJob, run ProviderSyncRun, failure error) error {
	code, _, retryAfter := providerErrorCode(failure)
	return s.repository.Transact(ctx, func(tx Transaction) error {
		now := s.now()
		if !tx.OwnsProviderSyncJobLease(job.ID, job.LeaseOwner, job.AttemptCount, now) {
			return ErrProviderSyncLeaseLost
		}
		run.Status, run.CompletedAt, run.FailureCount = "failed", &now, 1
		run.ItemCount = 1
		tx.SaveProviderSyncRun(run)
		job.LeaseOwner, job.LeaseExpiresAt, job.UpdatedAt = "", nil, now
		if job.AttemptCount < job.MaxAttempts && code != ProviderErrorCredentialInvalid && code != ProviderErrorPermissionDenied {
			job.Status = ProviderSyncJobQueued
			delay := time.Duration(1<<min(job.AttemptCount, 6)) * time.Second
			if retryAfter != nil {
				delay = time.Duration(*retryAfter) * time.Second
			}
			job.AvailableAt = now.Add(delay)
		} else {
			job.Status = ProviderSyncJobFailed
		}
		tx.SaveProviderSyncJob(job)
		connection, ok := tx.ProviderConnection(job.ConnectionID)
		if ok {
			connection.HealthStatus, connection.LastErrorCode, connection.UpdatedAt = ProviderHealthDegraded, code, now
			tx.SaveProviderConnection(connection)
		}
		return nil
	})
}
