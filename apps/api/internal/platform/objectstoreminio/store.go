package objectstoreminio

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/Mujhtech/mosaic/apps/api/internal/hostedpublishing"
)

const (
	defaultOperationTimeout = 30 * time.Second
	defaultCheckTimeout     = 5 * time.Second
)

type Config struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	Bucket    string
	UseTLS    bool
	// OperationTimeout bounds put and delete so a stalled object store cannot
	// hold a request handler or worker job open indefinitely.
	OperationTimeout time.Duration
	// CheckTimeout bounds the readiness probe.
	CheckTimeout time.Duration
}

type Store struct {
	client           *minio.Client
	bucket           string
	operationTimeout time.Duration
	checkTimeout     time.Duration
}

var tracer = otel.Tracer("mosaic/objectstore")

func New(cfg Config) (*Store, error) {
	client, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseTLS,
	})
	if err != nil {
		return nil, fmt.Errorf("configure S3-compatible object store: %w", err)
	}
	store := &Store{
		client:           client,
		bucket:           cfg.Bucket,
		operationTimeout: cfg.OperationTimeout,
		checkTimeout:     cfg.CheckTimeout,
	}
	if store.operationTimeout <= 0 {
		store.operationTimeout = defaultOperationTimeout
	}
	if store.checkTimeout <= 0 {
		store.checkTimeout = defaultCheckTimeout
	}
	return store, nil
}

// span opens an operation span. The bucket name is deployment configuration,
// never a credential, so it is safe as a span attribute. Object keys are
// digest-addressed and are recorded as a length only to avoid unbounded
// cardinality.
func (s *Store) span(ctx context.Context, operation string) (context.Context, trace.Span) {
	return tracer.Start(ctx, "objectstore."+operation, trace.WithAttributes(
		attribute.String("objectstore.operation", operation),
		attribute.String("objectstore.bucket", s.bucket),
	))
}

func finish(span trace.Span, err error) error {
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "object storage operation failed")
	}
	span.End()
	return err
}

func (s *Store) Check(ctx context.Context) error {
	ctx, span := s.span(ctx, "check")
	ctx, cancel := context.WithTimeout(ctx, s.checkTimeout)
	defer cancel()
	exists, err := s.client.BucketExists(ctx, s.bucket)
	if err != nil {
		return finish(span, fmt.Errorf("check object-storage bucket: %w", err))
	}
	if !exists {
		return finish(span, fmt.Errorf("object-storage bucket %q does not exist", s.bucket))
	}
	return finish(span, nil)
}

func (s *Store) Put(ctx context.Context, key string, reader io.Reader, size int64, mediaType string) error {
	ctx, span := s.span(ctx, "put")
	span.SetAttributes(attribute.Int64("objectstore.size_bytes", size))
	ctx, cancel := context.WithTimeout(ctx, s.operationTimeout)
	defer cancel()
	options := minio.PutObjectOptions{ContentType: mediaType}
	if size < 0 {
		// For unknown-size streams minio-go sizes its part buffer for the S3
		// 5 TiB object ceiling — one ~528 MiB allocation per Put. 16 MiB parts
		// still allow 160 GiB objects, far beyond anything stored here, without
		// the half-gigabyte buffer.
		options.PartSize = 16 << 20
	}
	_, err := s.client.PutObject(ctx, s.bucket, key, reader, size, options)
	if err != nil {
		return finish(span, fmt.Errorf("put object: %w", err))
	}
	return finish(span, nil)
}

// Open returns a reader for an object. The span covers opening and validating
// the handle; the returned stream stays bound to the caller's context because
// the caller, not this package, owns how long the body is streamed for.
// objectNotFound marks an object-store failure that means "this key is not
// there", as distinct from "the object store is failing". Callers classify it
// through the ObjectNotFound() method rather than importing this package, so a
// missing Asset can be answered 404 instead of 500.
type objectNotFound struct{ err error }

func (e *objectNotFound) Error() string        { return e.err.Error() }
func (e *objectNotFound) Unwrap() error        { return e.err }
func (e *objectNotFound) ObjectNotFound() bool { return true }

// missingKey reports whether an S3 error means the key or bucket is absent.
// It unwraps, so a caller may classify an error it has already annotated.
func missingKey(err error) bool {
	var response minio.ErrorResponse
	if !errors.As(err, &response) {
		response = minio.ToErrorResponse(err)
	}
	switch response.Code {
	case "NoSuchKey", "NoSuchBucket":
		return true
	}
	return false
}

func (s *Store) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	_, span := s.span(ctx, "open")
	object, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		wrapped := fmt.Errorf("open object: %w", err)
		if missingKey(err) {
			return nil, finish(span, &objectNotFound{err: wrapped})
		}
		return nil, finish(span, wrapped)
	}
	// GetObject is lazy: a missing key only surfaces on Stat.
	if _, err := object.Stat(); err != nil {
		_ = object.Close()
		wrapped := fmt.Errorf("stat object: %w", err)
		if missingKey(err) {
			return nil, finish(span, &objectNotFound{err: wrapped})
		}
		return nil, finish(span, wrapped)
	}
	return object, finish(span, nil)
}

func (s *Store) Delete(ctx context.Context, key string) error {
	ctx, span := s.span(ctx, "delete")
	ctx, cancel := context.WithTimeout(ctx, s.operationTimeout)
	defer cancel()
	if err := s.client.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{}); err != nil {
		return finish(span, fmt.Errorf("delete object: %w", err))
	}
	return finish(span, nil)
}

var _ hostedpublishing.ObjectStore = (*Store)(nil)
