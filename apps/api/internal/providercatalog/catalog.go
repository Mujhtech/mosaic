// Package providercatalog defines the application-owned boundary for reading
// normalized commerce catalog metadata from a server-connected provider.
package providercatalog

import (
	"context"
	"errors"
	"time"
)

var ErrUnavailable = errors.New("provider catalog unavailable")

type ErrorCode string

const (
	ErrorCredentialInvalid   ErrorCode = "credentialInvalid"
	ErrorPermissionDenied    ErrorCode = "permissionDenied"
	ErrorRateLimited         ErrorCode = "rateLimited"
	ErrorTimeout             ErrorCode = "timeout"
	ErrorProviderUnavailable ErrorCode = "providerUnavailable"
	ErrorInvalidResponse     ErrorCode = "invalidResponse"
)

// Error intentionally excludes provider response bodies and messages.
type Error struct {
	Code       ErrorCode
	Retryable  bool
	RetryAfter time.Duration
}

func (e *Error) Error() string { return string(e.Code) }
func (e *Error) Unwrap() error { return ErrUnavailable }

type Credential struct {
	Secret            []byte
	ExternalProjectID string
}

type App struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Platform   string `json:"platform"`
	Identifier string `json:"identifier,omitempty"`
}

const (
	ProductTypeSubscription         = "subscription"
	ProductTypeOneTimeNonConsumable = "one_time_non_consumable"
)

type Product struct {
	ID              string `json:"id"`
	AppID           string `json:"appId"`
	StoreIdentifier string `json:"storeIdentifier"`
	DisplayName     string `json:"displayName,omitempty"`
	Type            string `json:"type"`
	State           string `json:"state"`
}

type Entitlement struct {
	ID          string `json:"id"`
	LookupKey   string `json:"lookupKey"`
	DisplayName string `json:"displayName"`
	State       string `json:"state"`
}

type Package struct {
	ID          string   `json:"id"`
	LookupKey   string   `json:"lookupKey"`
	DisplayName string   `json:"displayName"`
	ProductIDs  []string `json:"productIds"`
}

type Offering struct {
	ID          string    `json:"id"`
	LookupKey   string    `json:"lookupKey"`
	DisplayName string    `json:"displayName"`
	State       string    `json:"state"`
	IsCurrent   bool      `json:"isCurrent"`
	Packages    []Package `json:"packages"`
}

type Catalog struct {
	Apps         []App         `json:"apps"`
	Products     []Product     `json:"products"`
	Entitlements []Entitlement `json:"entitlements"`
	Offerings    []Offering    `json:"offerings"`
	ObservedAt   time.Time     `json:"observedAt"`
}

type Client interface {
	FetchCatalog(context.Context, Credential) (Catalog, error)
}
