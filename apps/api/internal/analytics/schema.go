package analytics

import (
	"encoding/json"
	"fmt"
	"io"

	"github.com/dlclark/regexp2"
	"github.com/santhosh-tekuri/jsonschema/v6"
)

const eventSchemaID = "urn:mosaic:protocol:schema:analytics-event:v1:event"
const eventSchemaV2ID = "urn:mosaic:protocol:schema:analytics-event:v2:event"

type SchemaValidator struct{ event, eventV2 *jsonschema.Schema }
type ecmaRegexp regexp2.Regexp

func (expression *ecmaRegexp) MatchString(value string) bool {
	matched, err := (*regexp2.Regexp)(expression).MatchString(value)
	return err == nil && matched
}
func (expression *ecmaRegexp) String() string { return (*regexp2.Regexp)(expression).String() }

func CompileSchemaValidator(reader io.Reader) (*SchemaValidator, error) {
	return CompileSchemaValidators(reader, nil)
}

func CompileSchemaValidators(reader io.Reader, readerV2 io.Reader) (*SchemaValidator, error) {
	var document any
	if err := json.NewDecoder(reader).Decode(&document); err != nil {
		return nil, fmt.Errorf("decode Analytics Event v1 schema: %w", err)
	}
	compiler := jsonschema.NewCompiler()
	compiler.UseRegexpEngine(func(value string) (jsonschema.Regexp, error) {
		compiled, err := regexp2.Compile(value, regexp2.ECMAScript)
		return (*ecmaRegexp)(compiled), err
	})
	compiler.AssertFormat()
	if err := compiler.AddResource(eventSchemaID, document); err != nil {
		return nil, fmt.Errorf("register Analytics Event v1 schema: %w", err)
	}
	schema, err := compiler.Compile(eventSchemaID)
	if err != nil {
		return nil, fmt.Errorf("compile Analytics Event v1 schema: %w", err)
	}
	validator := &SchemaValidator{event: schema}
	if readerV2 != nil {
		var documentV2 any
		if err := json.NewDecoder(readerV2).Decode(&documentV2); err != nil {
			return nil, fmt.Errorf("decode Analytics Event v2 schema: %w", err)
		}
		compilerV2 := jsonschema.NewCompiler()
		compilerV2.UseRegexpEngine(func(value string) (jsonschema.Regexp, error) {
			compiled, err := regexp2.Compile(value, regexp2.ECMAScript)
			return (*ecmaRegexp)(compiled), err
		})
		compilerV2.AssertFormat()
		if err := compilerV2.AddResource(eventSchemaV2ID, documentV2); err != nil {
			return nil, fmt.Errorf("register Analytics Event v2 schema: %w", err)
		}
		validator.eventV2, err = compilerV2.Compile(eventSchemaV2ID)
		if err != nil {
			return nil, fmt.Errorf("compile Analytics Event v2 schema: %w", err)
		}
	}
	return validator, nil
}
func (v *SchemaValidator) ValidateEvent(raw []byte) error {
	var document any
	if err := json.Unmarshal(raw, &document); err != nil {
		return err
	}
	version := ""
	if value, ok := document.(map[string]any); ok {
		version, _ = value["eventSchemaVersion"].(string)
	}
	if version == EventSchemaVersionV2 {
		if v.eventV2 == nil {
			return fmt.Errorf("Analytics Event v2 schema is unavailable")
		}
		return v.eventV2.Validate(document)
	}
	return v.event.Validate(document)
}
