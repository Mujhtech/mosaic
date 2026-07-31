package billingmigration

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"strings"
	"time"
)

const CapabilityRedeliverWebhook = "redeliver-webhook"

type RedeliveryInput struct {
	ProjectID, ProgramID, EventID, DestinationID string
	IdempotencyKey, ExpectedEventDigest, Reason  string
	ExpectedStateVersion                         int64
}

type Redelivery struct {
	ID                   string    `json:"redeliveryId"`
	ProgramID            string    `json:"programId"`
	EventID              string    `json:"eventId"`
	DestinationID        string    `json:"destinationId"`
	DeliveryID           string    `json:"deliveryId"`
	IdempotencyKey       string    `json:"-"`
	Reason               string    `json:"reason"`
	ExpectedStateVersion int64     `json:"stateVersion"`
	CreatedAt            time.Time `json:"createdAt"`
}

type RedeliveryWrite struct {
	Input         RedeliveryInput
	ActorID       string
	RequestDigest []byte
	EventDigest   []byte
	CreatedAt     time.Time
	RedeliveryID  string
}

type RedeliveryRepository interface {
	AuthorizeRedelivery(ctx context.Context, actor Actor, projectID, programID string) error
	RedeliverWebhook(ctx context.Context, write RedeliveryWrite) (Redelivery, bool, error)
}

type RedeliveryService struct {
	repository RedeliveryRepository
	now        func() time.Time
}

func NewRedeliveryService(repository RedeliveryRepository, now func() time.Time) *RedeliveryService {
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &RedeliveryService{repository: repository, now: now}
}

func (s *RedeliveryService) Redeliver(ctx context.Context, actor Actor, input RedeliveryInput) (Redelivery, bool, error) {
	if strings.TrimSpace(input.ProjectID) == "" || strings.TrimSpace(input.ProgramID) == "" ||
		strings.TrimSpace(input.EventID) == "" || strings.TrimSpace(input.DestinationID) == "" ||
		strings.TrimSpace(input.IdempotencyKey) == "" || strings.TrimSpace(input.Reason) == "" ||
		len(input.Reason) > 500 || input.ExpectedStateVersion < 1 {
		return Redelivery{}, false, ErrInvalid
	}
	eventDigest, err := ParseDigest(input.ExpectedEventDigest)
	if err != nil {
		return Redelivery{}, false, ErrInvalid
	}
	if err := s.repository.AuthorizeRedelivery(ctx, actor, input.ProjectID, input.ProgramID); err != nil {
		return Redelivery{}, false, err
	}
	encoded, _ := json.Marshal(input)
	requestDigest := sha256.Sum256(encoded)
	id := sha256.Sum256([]byte("mosaic-migration-redelivery\x00" + input.ProgramID + "\x00" + input.IdempotencyKey))
	return s.repository.RedeliverWebhook(ctx, RedeliveryWrite{Input: input, ActorID: actor.ID,
		RequestDigest: requestDigest[:], EventDigest: eventDigest, CreatedAt: s.now(),
		RedeliveryID: "mwr_" + fmtHex(id[:16])})
}

func fmtHex(value []byte) string {
	const alphabet = "0123456789abcdef"
	result := make([]byte, len(value)*2)
	for i, b := range value {
		result[i*2], result[i*2+1] = alphabet[b>>4], alphabet[b&15]
	}
	return string(result)
}
