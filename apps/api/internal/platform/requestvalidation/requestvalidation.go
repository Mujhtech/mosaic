package requestvalidation

import (
	"errors"
	"strings"
	"unicode"

	validation "github.com/go-ozzo/ozzo-validation/v4"
)

const requestField = "_request"

// FieldErrors converts Ozzo validation errors to Mosaic's field-error shape.
// The boolean is false for non-validation and Ozzo internal errors so callers
// can map those failures to a safe internal response instead.
func FieldErrors(err error) (map[string][]string, bool) {
	return FieldErrorsWithAliases(err, nil)
}

// FieldErrorsWithAliases allows request DTOs to map Go field paths to their
// public JSON names when lower-camel conversion is not sufficient.
func FieldErrorsWithAliases(
	err error,
	aliases map[string]string,
) (map[string][]string, bool) {
	if err == nil {
		return nil, false
	}

	var internalError validation.InternalError
	if errors.As(err, &internalError) {
		return nil, false
	}

	fields := make(map[string][]string)
	if !collect(fields, "", err, aliases) {
		return nil, false
	}
	if len(fields) == 0 {
		return nil, false
	}

	return fields, true
}

func collect(
	fields map[string][]string,
	prefix string,
	err error,
	aliases map[string]string,
) bool {
	var internalError validation.InternalError
	if errors.As(err, &internalError) {
		return false
	}

	var nested validation.Errors
	if errors.As(err, &nested) {
		for field, fieldError := range nested {
			path := join(prefix, field)
			if !collect(fields, path, fieldError, aliases) {
				return false
			}
		}
		return true
	}

	var validationError validation.Error
	if errors.As(err, &validationError) {
		field := publicPath(prefix, aliases)
		if field == "" {
			field = requestField
		}
		fields[field] = append(fields[field], validationError.Error())
		return true
	}

	if prefix == "" {
		return false
	}

	// Errors returned from validation.By are part of the transport contract.
	// Database or other internal failures must be wrapped with
	// validation.NewInternalError by the custom rule.
	field := publicPath(prefix, aliases)
	fields[field] = append(fields[field], err.Error())
	return true
}

func publicPath(path string, aliases map[string]string) string {
	if alias, ok := aliases[path]; ok {
		return alias
	}

	parts := strings.Split(path, ".")
	for index, part := range parts {
		parts[index] = lowerCamel(part)
	}
	return strings.Join(parts, ".")
}

func lowerCamel(value string) string {
	runes := []rune(value)
	if len(runes) == 0 || !unicode.IsUpper(runes[0]) {
		return value
	}

	uppercaseEnd := 0
	for uppercaseEnd < len(runes) && unicode.IsUpper(runes[uppercaseEnd]) {
		uppercaseEnd++
	}
	if uppercaseEnd > 1 && uppercaseEnd < len(runes) && unicode.IsLower(runes[uppercaseEnd]) {
		uppercaseEnd--
	}

	for index := 0; index < uppercaseEnd; index++ {
		runes[index] = unicode.ToLower(runes[index])
	}
	return string(runes)
}

func join(prefix string, field string) string {
	if prefix == "" {
		return field
	}
	return prefix + "." + field
}
