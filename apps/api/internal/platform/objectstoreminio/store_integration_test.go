package objectstoreminio

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"testing"
	"time"
)

func TestS3CompatibleAssetRoundTrip(t *testing.T) {
	endpoint := os.Getenv("OBJECT_STORAGE_TEST_ENDPOINT")
	if endpoint == "" {
		t.Skip("OBJECT_STORAGE_TEST_ENDPOINT is required for S3-compatible integration tests")
	}
	store, err := New(Config{
		Endpoint:  endpoint,
		AccessKey: os.Getenv("OBJECT_STORAGE_TEST_ACCESS_KEY"),
		SecretKey: os.Getenv("OBJECT_STORAGE_TEST_SECRET_KEY"),
		Bucket:    os.Getenv("OBJECT_STORAGE_TEST_BUCKET"),
	})
	if err != nil {
		t.Fatalf("configure object store: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := store.Check(ctx); err != nil {
		t.Fatalf("check object store: %v", err)
	}
	key := fmt.Sprintf("integration-tests/round-trip-%d", time.Now().UnixNano())
	defer func() { _ = store.Delete(context.Background(), key) }()
	content := []byte("mosaic-asset-round-trip")
	if err := store.Put(ctx, key, bytes.NewReader(content), int64(len(content)), "image/png"); err != nil {
		t.Fatalf("put object: %v", err)
	}
	object, err := store.Open(ctx, key)
	if err != nil {
		t.Fatalf("open object: %v", err)
	}
	got, readErr := io.ReadAll(object)
	closeErr := object.Close()
	if readErr != nil || closeErr != nil || !bytes.Equal(got, content) {
		t.Fatalf("object bytes=%q read=%v close=%v", got, readErr, closeErr)
	}
	if err := store.Delete(ctx, key); err != nil {
		t.Fatalf("delete integration object: %v", err)
	}
}
