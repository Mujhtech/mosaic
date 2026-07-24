package cloudworkspace

import "errors"

var (
	ErrUnauthenticated                             = errors.New("unauthenticated")
	ErrForbidden                                   = errors.New("forbidden")
	ErrNotFound                                    = errors.New("not found")
	ErrConflict                                    = errors.New("conflict")
	ErrLastOwner                                   = errors.New("last owner")
	ErrResourceArchived                            = errors.New("resource archived")
	ErrProductReferenced                           = errors.New("product referenced")
	ErrReplacementInvalid                          = errors.New("replacement invalid")
	ErrKeyRevoked                                  = errors.New("key revoked")
	ErrSecretUnavailable                           = errors.New("secret unavailable")
	ErrInvalidCursor                               = errors.New("invalid cursor")
	ErrScopeMismatch                               = errors.New("provider scope mismatch")
	ErrModeMismatch                                = errors.New("provider mode mismatch")
	ErrConnectionRevoked                           = errors.New("provider connection revoked")
	ErrProviderUnsupported                         = errors.New("provider integration mode unsupported")
	ErrProviderFeatureDisabled                     = errors.New("server-connected providers are disabled")
	ErrProviderProjectInvalid                      = errors.New("provider project identifier is invalid")
	ErrProviderCredentialInvalid                   = errors.New("provider credential is invalid")
	ErrProviderPermissionDenied                    = errors.New("provider credential permissions are insufficient")
	ErrProviderRateLimited                         = errors.New("provider rate limited")
	ErrProviderUnavailable                         = errors.New("provider unavailable")
	ErrProviderInvalidResponse                     = errors.New("provider returned an invalid response")
	ErrProviderSyncInProgress                      = errors.New("provider synchronization in progress")
	ErrProviderSyncLeaseLost                       = errors.New("provider synchronization lease lost")
	ErrProviderImportInProgress                    = errors.New("provider import in progress")
	ErrIdempotencyConflict                         = errors.New("idempotency conflict")
	ErrProductionConnectionAcknowledgementRequired = errors.New("production provider connection acknowledgement required")
	ErrMappingAmbiguous                            = errors.New("provider mapping ambiguous")
	ErrMappingTargetInvalid                        = errors.New("provider mapping target invalid")
)

type ConflictError struct {
	Resource string
	Field    string
}

func (e *ConflictError) Error() string { return e.Resource + " conflicts on " + e.Field }
func (e *ConflictError) Unwrap() error { return ErrConflict }
