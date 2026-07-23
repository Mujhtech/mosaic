package database

import (
	"context"
	"testing"
	"time"
)

func TestOpenFailsWhenPostgreSQLIsUnavailable(t *testing.T) {
	_, err := Open(context.Background(), Config{
		URL:            "postgres://mosaic:test@127.0.0.1:1/mosaic?sslmode=disable",
		MaxConnections: 1, ConnectTimeout: 100 * time.Millisecond,
	})
	if err == nil {
		t.Fatal("Open succeeded, want unavailable PostgreSQL error")
	}
}
