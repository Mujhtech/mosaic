package cloudworkspace

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"

	"go.opentelemetry.io/otel/attribute"
)

func (s *Service) newSecret(prefix string) (string, [32]byte, error) {
	material := make([]byte, 32)
	if _, err := io.ReadFull(s.random, material); err != nil {
		return "", [32]byte{}, fmt.Errorf("generate API key secret: %w", err)
	}
	secret := prefix + "." + base64.RawURLEncoding.EncodeToString(material)
	return secret, sha256.Sum256([]byte(secret)), nil
}

func (s *Service) CreateAPIKey(ctx context.Context, actor Actor, environmentID string, kind APIKeyKind, applicationIDs ...string) (APIKeySecretResult, error) {
	ctx, span := s.operation(ctx, "api_key.create", actor, attribute.String("mosaic.environment.id", environmentID))
	defer span.End()
	var result APIKeySecretResult
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		environment, project, err := environmentScope(tx, actor, environmentID, true)
		if err != nil {
			return err
		}
		if project.Status == ProjectArchived {
			return ErrResourceArchived
		}
		applicationID := ""
		if len(applicationIDs) > 0 {
			applicationID = applicationIDs[0]
		}
		if kind == APIKeyPublicSDK {
			application, ok := tx.Application(applicationID)
			if !ok || application.ProjectID != project.ID {
				return ErrNotFound
			}
		} else if applicationID != "" {
			return ErrScopeMismatch
		}
		id := tx.NextID("key")
		prefix := "mos_" + string(kind) + "_" + id
		secret, digest, err := s.newSecret(prefix)
		if err != nil {
			return err
		}
		now := s.now()
		applicationProjectID := ""
		if applicationID != "" {
			applicationProjectID = project.ID
		}
		key := APIKey{ID: id, EnvironmentID: environment.ID, ApplicationID: applicationID, ApplicationProjectID: applicationProjectID, Kind: kind, Prefix: prefix, CreatedByActorID: actor.ID, CreatedAt: now}
		tx.SaveAPIKey(APIKeyRecord{APIKey: key, SecretDigest: digest})
		s.audit(tx, actor, project.OrganizationID, project.ID, environment.ID, "api_key.created", "api_key", id, map[string]string{"kind": string(kind), "prefix": prefix, "applicationId": applicationID})
		result = APIKeySecretResult{APIKey: key, Secret: secret}
		return nil
	})
	if err == nil {
		logMutation(ctx, "api_key.created", actor, "", "", result.APIKey.ID)
	}
	return result, err
}

func (s *Service) ListAPIKeys(ctx context.Context, actor Actor, environmentID string, kind APIKeyKind, state string, options ListOptions) (List[APIKey], error) {
	values := make([]APIKey, 0)
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, _, err := environmentScope(reader, actor, environmentID, false); err != nil {
			return err
		}
		for _, record := range reader.APIKeys(environmentID) {
			if kind != "" && record.Kind != kind {
				continue
			}
			if state == "active" && record.RevokedAt != nil {
				continue
			}
			if state == "revoked" && record.RevokedAt == nil {
				continue
			}
			values = append(values, record.APIKey)
		}
		return nil
	})
	return paginated(values, options, func(value APIKey) string { return value.ID }, err)
}

func (s *Service) RotateAPIKey(ctx context.Context, actor Actor, apiKeyID string) (APIKeySecretResult, error) {
	ctx, span := s.operation(ctx, "api_key.rotate", actor, attribute.String("mosaic.api_key.id", apiKeyID))
	defer span.End()
	var result APIKeySecretResult
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		record, ok := tx.APIKey(apiKeyID)
		if !ok {
			return ErrNotFound
		}
		environment, project, err := environmentScope(tx, actor, record.EnvironmentID, true)
		if err != nil {
			return err
		}
		if record.RevokedAt != nil {
			return ErrKeyRevoked
		}
		secret, digest, err := s.newSecret(record.Prefix)
		if err != nil {
			return err
		}
		now := s.now()
		record.SecretDigest, record.RotatedAt = digest, &now
		tx.SaveAPIKey(record)
		s.audit(tx, actor, project.OrganizationID, project.ID, environment.ID, "api_key.rotated", "api_key", apiKeyID, map[string]string{"kind": string(record.Kind), "prefix": record.Prefix})
		result = APIKeySecretResult{APIKey: record.APIKey, Secret: secret}
		return nil
	})
	if err == nil {
		logMutation(ctx, "api_key.rotated", actor, "", "", apiKeyID)
	}
	return result, err
}

func (s *Service) RevokeAPIKey(ctx context.Context, actor Actor, apiKeyID string) (APIKey, error) {
	ctx, span := s.operation(ctx, "api_key.revoke", actor, attribute.String("mosaic.api_key.id", apiKeyID))
	defer span.End()
	var result APIKey
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		record, ok := tx.APIKey(apiKeyID)
		if !ok {
			return ErrNotFound
		}
		environment, project, err := environmentScope(tx, actor, record.EnvironmentID, true)
		if err != nil {
			return err
		}
		if record.RevokedAt == nil {
			now := s.now()
			record.RevokedAt = &now
			tx.SaveAPIKey(record)
			s.audit(tx, actor, project.OrganizationID, project.ID, environment.ID, "api_key.revoked", "api_key", apiKeyID, map[string]string{"kind": string(record.Kind), "prefix": record.Prefix})
		}
		result = record.APIKey
		return nil
	})
	if err == nil {
		logMutation(ctx, "api_key.revoked", actor, "", "", apiKeyID)
	}
	return result, err
}
