package objectstoreminio

import (
	"context"
	"fmt"
	"io"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"github.com/Mujhtech/mosaic/apps/api/internal/hostedpublishing"
)

type Config struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	Bucket    string
	UseTLS    bool
}

type Store struct {
	client *minio.Client
	bucket string
}

func New(cfg Config) (*Store, error) {
	client, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseTLS,
	})
	if err != nil {
		return nil, fmt.Errorf("configure S3-compatible object store: %w", err)
	}
	return &Store{client: client, bucket: cfg.Bucket}, nil
}

func (s *Store) Check(ctx context.Context) error {
	exists, err := s.client.BucketExists(ctx, s.bucket)
	if err != nil {
		return fmt.Errorf("check object-storage bucket: %w", err)
	}
	if !exists {
		return fmt.Errorf("object-storage bucket %q does not exist", s.bucket)
	}
	return nil
}

func (s *Store) Put(ctx context.Context, key string, reader io.Reader, size int64, mediaType string) error {
	_, err := s.client.PutObject(ctx, s.bucket, key, reader, size, minio.PutObjectOptions{ContentType: mediaType})
	if err != nil {
		return fmt.Errorf("put object: %w", err)
	}
	return nil
}

func (s *Store) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	object, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("open object: %w", err)
	}
	if _, err := object.Stat(); err != nil {
		_ = object.Close()
		return nil, fmt.Errorf("stat object: %w", err)
	}
	return object, nil
}

func (s *Store) Delete(ctx context.Context, key string) error {
	if err := s.client.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{}); err != nil {
		return fmt.Errorf("delete object: %w", err)
	}
	return nil
}

var _ hostedpublishing.ObjectStore = (*Store)(nil)
