package hostedpublishing

import (
	"context"
	"io"
)

type ObjectStore interface {
	Check(context.Context) error
	Put(context.Context, string, io.Reader, int64, string) error
	Open(context.Context, string) (io.ReadCloser, error)
	Delete(context.Context, string) error
}
