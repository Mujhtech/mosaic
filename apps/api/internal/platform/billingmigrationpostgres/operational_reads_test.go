package billingmigrationpostgres

import (
	"testing"
	"time"
)

func TestOperationalCursorRoundTripAndRejectsMalformedInput(t *testing.T) {
	at := time.Date(2026, 7, 29, 10, 30, 0, 0, time.UTC)
	encoded := encodeOperationalCursor(at, "record_one")
	decoded, err := decodeOperationalCursor(encoded)
	if err != nil || decoded.ID != "record_one" || !decoded.At.Equal(at) {
		t.Fatalf("cursor round trip decoded=%+v err=%v", decoded, err)
	}
	if _, err = decodeOperationalCursor("not-a-cursor"); err == nil {
		t.Fatal("malformed cursor was accepted")
	}
}
