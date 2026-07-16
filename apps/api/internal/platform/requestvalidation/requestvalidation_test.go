package requestvalidation

import (
	"errors"
	"reflect"
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
