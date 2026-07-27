package requestvalidation

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	validation "github.com/go-ozzo/ozzo-validation/v4"
)

func TestFieldErrorsMapsNestedOzzoErrors(t *testing.T) {
	err := validation.Errors{
		"Name": validation.ErrRequired.SetMessage("Name is required."),
		"Profile": validation.Errors{
			"DisplayName": validation.ErrLengthTooShort.SetMessage(
				"Display name is too short.",
			),
		},
	}

	fields, ok := FieldErrors(err)
	if !ok {
		t.Fatal("FieldErrors reported a non-validation error")
	}

	want := map[string][]string{
		"name":                {"Name is required."},
		"profile.displayName": {"Display name is too short."},
	}
	if !reflect.DeepEqual(fields, want) {
		t.Fatalf("fields = %#v, want %#v", fields, want)
	}
}

func TestFieldErrorsSupportsJSONAliases(t *testing.T) {
	err := validation.Errors{
		"APIKey": validation.ErrRequired.SetMessage("API key is required."),
	}

	fields, ok := FieldErrorsWithAliases(err, map[string]string{
		"APIKey": "api_key",
	})
	if !ok {
		t.Fatal("FieldErrorsWithAliases reported a non-validation error")
	}

	want := map[string][]string{
		"api_key": {"API key is required."},
	}
	if !reflect.DeepEqual(fields, want) {
		t.Fatalf("fields = %#v, want %#v", fields, want)
	}
}

func TestFieldErrorsRejectsInternalValidationErrors(t *testing.T) {
	err := validation.Errors{
		"Name": validation.NewInternalError(errors.New("database unavailable")),
	}

	fields, ok := FieldErrors(err)
	if ok {
		t.Fatalf("FieldErrors returned %#v, want internal failure", fields)
	}
}

// TestPlacementKeyMatchesDatabaseConstraint protects against the transport
// layer accepting a key PostgreSQL will reject. Placement, alias, and attribute
// keys are the only keys in the schema that forbid hyphens; when the boundary
// checked length alone, a hyphenated key became a 500 with no field error and no
// logged cause. The pattern here must stay identical to the CHECK constraints in
// migrations 00009 and 00011.
func TestPlacementKeyMatchesDatabaseConstraint(t *testing.T) {
	rule := PlacementKey()
	accepted := []string{"onboarding", "drill_onboarding", "a", "p1", strings.Repeat("a", 64)}
	for _, key := range accepted {
		if err := rule.Validate(key); err != nil {
			t.Errorf("key %q = %v, want accepted", key, err)
		}
	}
	rejected := []string{"drill-onboarding", "Onboarding", "1onboarding", "_onboarding", "onboarding key", "onboarding.key", strings.Repeat("a", 65)}
	for _, key := range rejected {
		if err := rule.Validate(key); err == nil {
			t.Errorf("key %q was accepted; PostgreSQL rejects it", key)
		}
	}
}
