package billing

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"io"
	"strings"
	"time"

	"github.com/rs/zerolog"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/appstoreserver"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/googleplay"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
)

// intakeTokenBytes is the entropy behind an Apple notification endpoint. Thirty-
// two random bytes is the same posture as an API key: the URL is the only thing
// standing between an unauthenticated POST and a tenant, so it must be
// unguessable rather than merely unpublished.
const intakeTokenBytes = 32

// CreateCredential stores a new Store Server Credential.
//
// The secret is validated before it is persisted — an Apple .p8 is parsed as a
// P-256 key, a Google key is parsed as a service-account JSON — so an operator
// learns immediately that they pasted the wrong file rather than discovering it
// when the first notification fails validation hours later.
func (s *Service) CreateCredential(ctx context.Context, actor Actor, input CredentialInput) (StoreServerCredential, error) {
	defer zero(input.Secret)
	if actor.ID == "" {
		return StoreServerCredential{}, ErrUnauthenticated
	}
	class, err := validateSecret(input)
	if err != nil {
		return StoreServerCredential{}, err
	}

	now := s.now()
	credentialID, err := s.newID("ssc")
	if err != nil {
		return StoreServerCredential{}, safeFailure(err, "identifier_generation_failed")
	}
	organizationID, err := s.organizationFor(ctx, input.ProjectID)
	if err != nil {
		return StoreServerCredential{}, err
	}

	envelope, err := s.sealCredential(input.Secret, organizationID, input.ProjectID, credentialID, class)
	if err != nil {
		return StoreServerCredential{}, err
	}

	token, digest := "", []byte(nil)
	if input.Provider == ProviderAppStore {
		token, digest, err = s.newIntakeToken()
		if err != nil {
			return StoreServerCredential{}, err
		}
	}

	created, err := s.repository.CreateCredential(ctx, actor, withID(input, credentialID), envelope, class, digest, now)
	if err != nil {
		return StoreServerCredential{}, err
	}
	s.recordCredentialEvent(ctx, input.ProjectID, created.ID, "created", "succeeded", "", actor.ID, now)
	// The full endpoint URL exists exactly twice in the system's lifetime: in
	// this response and in the equivalent rotate response. No read ever returns
	// it, because the token it embeds is stored only as a digest.
	created.NotificationEndpointURL = s.endpointURL(token)
	return created, nil
}

// RotateCredential replaces the secret and mints a new intake token. The old
// token stops working the instant the new one is stored, which is the whole
// point of rotation after a suspected compromise.
func (s *Service) RotateCredential(ctx context.Context, actor Actor, projectID, credentialID string, secret []byte) (StoreServerCredential, error) {
	defer zero(secret)
	if actor.ID == "" {
		return StoreServerCredential{}, ErrUnauthenticated
	}
	existing, err := s.repository.GetCredential(ctx, actor, projectID, credentialID)
	if err != nil {
		return StoreServerCredential{}, err
	}
	if existing.Status != "active" {
		return StoreServerCredential{}, ErrConflict
	}
	class, err := validateSecret(CredentialInput{Provider: existing.Provider, Secret: secret})
	if err != nil {
		return StoreServerCredential{}, err
	}
	organizationID, err := s.organizationFor(ctx, projectID)
	if err != nil {
		return StoreServerCredential{}, err
	}
	envelope, err := s.sealCredential(secret, organizationID, projectID, credentialID, class)
	if err != nil {
		return StoreServerCredential{}, err
	}
	token, digest := "", []byte(nil)
	if existing.Provider == ProviderAppStore {
		token, digest, err = s.newIntakeToken()
		if err != nil {
			return StoreServerCredential{}, err
		}
	}
	now := s.now()
	rotated, err := s.repository.RotateCredential(ctx, actor, projectID, credentialID, envelope, digest, now)
	if err != nil {
		return StoreServerCredential{}, err
	}
	s.recordCredentialEvent(ctx, projectID, credentialID, "rotated", "succeeded", "", actor.ID, now)
	rotated.NotificationEndpointURL = s.endpointURL(token)
	return rotated, nil
}

// RevokeCredential stops the credential being used. Ingestion for the tenant
// stops; nothing already recorded is removed, because the ledger is the
// evidence trail a revocation is usually part of investigating.
func (s *Service) RevokeCredential(ctx context.Context, actor Actor, projectID, credentialID string) (StoreServerCredential, error) {
	if actor.ID == "" {
		return StoreServerCredential{}, ErrUnauthenticated
	}
	now := s.now()
	revoked, err := s.repository.RevokeCredential(ctx, actor, projectID, credentialID, now)
	if err != nil {
		return StoreServerCredential{}, err
	}
	s.recordCredentialEvent(ctx, projectID, credentialID, "revoked", "succeeded", "", actor.ID, now)
	return revoked, nil
}

// TestCredential proves the stored secret still authenticates against the
// store, without changing any store state.
func (s *Service) TestCredential(ctx context.Context, actor Actor, projectID, credentialID string) (StoreServerCredential, error) {
	if actor.ID == "" {
		return StoreServerCredential{}, ErrUnauthenticated
	}
	credential, err := s.repository.GetCredential(ctx, actor, projectID, credentialID)
	if err != nil {
		return StoreServerCredential{}, err
	}
	now := s.now()
	health, code := "healthy", ""

	switch credential.Provider {
	case ProviderAppStore:
		// Get Notification History over a one-minute window is the cheapest call
		// that proves the whole path: the key signs, Apple accepts the issuer,
		// and the team is authorized. It reads nothing that changes.
		// Team-scoped: the credential test proves the key signs and the team is
		// authorized, not that one Application works.
		apple, _, credErr := s.appleCredential(ctx, RawInput{
			ProjectID: projectID, CredentialID: credentialID, Provider: ProviderAppStore,
		}, scopedToTeam)
		if credErr != nil {
			health, code = "unavailable", "credential_unusable"
			break
		}
		_, callErr := s.apple.NotificationHistory(ctx, apple, appstoreserver.NotificationHistoryRequest{
			StartDate: now.Add(-time.Minute).UnixMilli(), EndDate: now.UnixMilli(),
		}, "")
		if callErr != nil {
			classification := Classify(callErr, now)
			health, code = "degraded", classification.Diagnostic
			if !classification.Retryable {
				health = "unavailable"
			}
		}
	case ProviderGooglePlay:
		account, _, _, credErr := s.googleCredential(ctx, RawInput{
			ProjectID: projectID, CredentialID: credentialID, Provider: ProviderGooglePlay,
		})
		if credErr != nil {
			health, code = "unavailable", "credential_unusable"
			break
		}
		// A zero-message pull proves the service account can reach the RTDN
		// subscription without consuming anything.
		if _, callErr := s.google.Pull(ctx, account, credential.GooglePubSubProjectID, credential.GooglePubSubSubscription, 1); callErr != nil {
			classification := Classify(callErr, now)
			health, code = "degraded", classification.Diagnostic
			if !classification.Retryable {
				health = "unavailable"
			}
		}
	}

	if err := s.repository.UpdateCredentialHealth(ctx, projectID, credentialID, health, code, true, now); err != nil {
		return StoreServerCredential{}, err
	}
	outcome := "succeeded"
	if health != "healthy" {
		outcome = "failed"
	}
	s.recordCredentialEvent(ctx, projectID, credentialID, "tested", outcome, code, actor.ID, now)
	return s.repository.GetCredential(ctx, actor, projectID, credentialID)
}

// ListCredentials returns the operator view. It never contains secret material.
func (s *Service) ListCredentials(ctx context.Context, actor Actor, projectID string) ([]StoreServerCredential, error) {
	if actor.ID == "" {
		return nil, ErrUnauthenticated
	}
	return s.repository.ListCredentials(ctx, actor, projectID)
}

// GetCredential returns one credential without the endpoint URL.
func (s *Service) GetCredential(ctx context.Context, actor Actor, projectID, credentialID string) (StoreServerCredential, error) {
	if actor.ID == "" {
		return StoreServerCredential{}, ErrUnauthenticated
	}
	return s.repository.GetCredential(ctx, actor, projectID, credentialID)
}

// Settings reads a Project's billing configuration.
func (s *Service) Settings(ctx context.Context, actor Actor, projectID string) (Settings, error) {
	if actor.ID == "" {
		return Settings{}, ErrUnauthenticated
	}
	return s.repository.Settings(ctx, actor, projectID)
}

// SetBillingEnabled turns Mosaic Billing on for a Project. It is off by default.
func (s *Service) SetBillingEnabled(ctx context.Context, actor Actor, projectID string, enabled bool) error {
	if actor.ID == "" {
		return ErrUnauthenticated
	}
	return s.repository.SetBillingEnabled(ctx, actor, projectID, enabled, s.now())
}

// validateSecret parses the supplied material without persisting it, returning
// the credential class it belongs to.
func validateSecret(input CredentialInput) (string, error) {
	switch input.Provider {
	case ProviderAppStore:
		if _, err := appstoreserver.ParsePrivateKey(input.Secret); err != nil {
			return "", ErrInvalid
		}
		if strings.TrimSpace(input.AppleIssuerID) == "" && input.AppleIssuerID != "" {
			return "", ErrInvalid
		}
		return ClassAppleInAppPurchaseKey, nil
	case ProviderGooglePlay:
		if _, err := googleplay.ParseServiceAccount(input.Secret); err != nil {
			return "", ErrInvalid
		}
		return ClassGoogleServiceAccountKey, nil
	default:
		return "", ErrInvalid
	}
}

func (s *Service) sealCredential(secret []byte, organizationID, projectID, credentialID, class string) (Envelope, error) {
	envelope, err := s.cipher.EncryptSubject(secret, providercredential.SubjectScope{
		OrganizationID:  organizationID,
		ProjectID:       projectID,
		SubjectKind:     providercredential.SubjectStoreServerCredential,
		SubjectID:       credentialID,
		CredentialClass: class,
	})
	if err != nil {
		return Envelope{}, ErrCredentialUnusable
	}
	return Envelope{
		Version: envelope.Version, Algorithm: envelope.Algorithm, KeyID: envelope.KeyID,
		Nonce: envelope.Nonce, Ciphertext: envelope.Ciphertext, Fingerprint: envelope.Fingerprint,
	}, nil
}

func (s *Service) newIntakeToken() (string, []byte, error) {
	buffer := make([]byte, intakeTokenBytes)
	if _, err := io.ReadFull(s.random, buffer); err != nil {
		return "", nil, safeFailure(err, "intake_token_generation_failed")
	}
	token := base64.RawURLEncoding.EncodeToString(buffer)
	digest := sha256.Sum256([]byte(token))
	return token, digest[:], nil
}

func (s *Service) endpointURL(token string) string {
	if token == "" {
		return ""
	}
	return s.notificationBaseURL + "/v1/billing/apple/notifications/" + token
}

func withID(input CredentialInput, id string) CredentialInput {
	input.Name = strings.TrimSpace(input.Name)
	input.CredentialID = id
	return input
}

// organizationFor resolves the organization that owns a Project. The
// organization is part of the envelope's additional data, so it has to be known
// before encryption rather than discovered during the insert.
func (s *Service) organizationFor(ctx context.Context, projectID string) (string, error) {
	organizationID, err := s.repository.OrganizationForProject(ctx, projectID)
	if err != nil {
		return "", ErrNotFound
	}
	return organizationID, nil
}

// recordCredentialEvent appends the Store Server Credential lifecycle event and
// reports a failed append loudly rather than discarding it.
//
// The credential mutation has already committed at every call site, so failing
// the operation would tell an operator to retry a rotation or a revocation that
// has already taken effect — and re-rotating mints a second intake token,
// invalidating the one the first response just handed out exactly once. What is
// lost instead is the credential's audit trail, which is usually being read
// during an investigation into the very compromise a rotation responds to, so
// the failure is raised at error level where an alert can see it.
//
// No secret, envelope, or intake token is ever a field here.
func (s *Service) recordCredentialEvent(ctx context.Context, projectID, credentialID, event, outcome, diagnostic, actorID string, now time.Time) {
	if err := s.repository.RecordCredentialEvent(ctx, projectID, credentialID, event, outcome, diagnostic, actorID, now); err != nil {
		zerolog.Ctx(ctx).Error().Err(err).
			Str("project_id", projectID).
			Str("store_server_credential_id", credentialID).
			Str("credential_event", event).
			Str("outcome", outcome).
			Msg("store server credential event was not recorded")
	}
}
