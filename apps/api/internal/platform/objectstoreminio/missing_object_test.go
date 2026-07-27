package objectstoreminio

import (
	"errors"
	"fmt"
	"testing"

	"github.com/minio/minio-go/v7"
)

// An Asset row whose bytes are absent from the bucket -- what a failed or
// partial object-storage restore leaves behind -- used to reach the SDK as
// `500 internal_error`, indistinguishable from "Mosaic is broken", so a client
// could not fall back to its bundled Asset. Classifying the S3 error is what
// lets the delivery path answer a safe 404 instead, so the classification is
// pinned here rather than left to a string match at the call site.
func TestMissingObjectIsDistinguishedFromStorageFailure(t *testing.T) {
	for name, testCase := range map[string]struct {
		err  error
		want bool
	}{
		"absent key":             {minio.ErrorResponse{Code: "NoSuchKey"}, true},
		"absent bucket":          {minio.ErrorResponse{Code: "NoSuchBucket"}, true},
		"wrapped absent key":     {fmt.Errorf("stat object: %w", minio.ErrorResponse{Code: "NoSuchKey"}), true},
		"access denied":          {minio.ErrorResponse{Code: "AccessDenied"}, false},
		"internal storage fault": {minio.ErrorResponse{Code: "InternalError"}, false},
		"transport failure":      {errors.New("dial tcp 10.0.0.2:9000: connect: connection refused"), false},
	} {
		t.Run(name, func(t *testing.T) {
			if got := missingKey(testCase.err); got != testCase.want {
				t.Fatalf("missingKey(%v) = %v, want %v", testCase.err, got, testCase.want)
			}
		})
	}

	// The wrapper must survive errors.As so callers can classify without
	// importing this package.
	wrapped := &objectNotFound{err: fmt.Errorf("stat object: %w", minio.ErrorResponse{Code: "NoSuchKey"})}
	var missing interface{ ObjectNotFound() bool }
	if !errors.As(error(wrapped), &missing) || !missing.ObjectNotFound() {
		t.Fatal("a missing-object error is not classifiable through the ObjectNotFound contract")
	}
}
