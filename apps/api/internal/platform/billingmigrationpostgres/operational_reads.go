package billingmigrationpostgres

import (
	"encoding/base64"
	"encoding/json"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
)

type operationalCursor struct {
	At time.Time `json:"at"`
	ID string    `json:"id"`
}

func decodeOperationalCursor(value string) (operationalCursor, error) {
	if value == "" {
		return operationalCursor{}, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return operationalCursor{}, billingmigration.ErrInvalid
	}
	var cursor operationalCursor
	if json.Unmarshal(raw, &cursor) != nil || cursor.At.IsZero() || cursor.ID == "" {
		return operationalCursor{}, billingmigration.ErrInvalid
	}
	return cursor, nil
}

func encodeOperationalCursor(at time.Time, id string) string {
	raw, _ := json.Marshal(operationalCursor{At: at, ID: id})
	return base64.RawURLEncoding.EncodeToString(raw)
}
