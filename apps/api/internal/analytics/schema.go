package analytics

import (
	"encoding/json"
	"fmt"
	"io"

	"github.com/dlclark/regexp2"
	"github.com/santhosh-tekuri/jsonschema/v6"
)

const eventSchemaID = "urn:mosaic:protocol:schema:analytics-event:v1:event"

type SchemaValidator struct{ event *jsonschema.Schema }
type ecmaRegexp regexp2.Regexp

func (expression *ecmaRegexp) MatchString(value string) bool {
	matched, err := (*regexp2.Regexp)(expression).MatchString(value)
	return err == nil && matched
}
func (expression *ecmaRegexp) String() string { return (*regexp2.Regexp)(expression).String() }

func CompileSchemaValidator(reader io.Reader) (*SchemaValidator, error) {
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
	return &SchemaValidator{event: schema}, nil
}
func (v *SchemaValidator) ValidateEvent(raw []byte) error {
	var document any
	if err := json.Unmarshal(raw, &document); err != nil {
		return err
	}
	return v.event.Validate(document)
}
