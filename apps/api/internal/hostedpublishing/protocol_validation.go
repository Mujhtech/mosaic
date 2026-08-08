package hostedpublishing

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/dlclark/regexp2"
	"github.com/santhosh-tekuri/jsonschema/v6"
)

const protocolSchemaID = "urn:mosaic:protocol:schema:v0.3:paywall"

type ProtocolValidator struct{ schema *jsonschema.Schema }

type ecmaRegexp regexp2.Regexp

func (expression *ecmaRegexp) MatchString(value string) bool {
	matched, err := (*regexp2.Regexp)(expression).MatchString(value)
	return err == nil && matched
}

func (expression *ecmaRegexp) String() string {
	return (*regexp2.Regexp)(expression).String()
}

func compileECMARegexp(expression string) (jsonschema.Regexp, error) {
	compiled, err := regexp2.Compile(expression, regexp2.ECMAScript)
	if err != nil {
		return nil, err
	}
	return (*ecmaRegexp)(compiled), nil
}

func CompileProtocolValidator(reader io.Reader) (*ProtocolValidator, error) {
	var document any
	decoder := json.NewDecoder(reader)
	if err := decoder.Decode(&document); err != nil {
		return nil, fmt.Errorf("decode canonical Protocol 0.3 schema: %w", err)
	}
	compiler := jsonschema.NewCompiler()
	compiler.UseRegexpEngine(compileECMARegexp)
	compiler.AssertFormat()
	if err := compiler.AddResource(protocolSchemaID, document); err != nil {
		return nil, fmt.Errorf("register canonical Protocol 0.3 schema: %w", err)
	}
	schema, err := compiler.Compile(protocolSchemaID)
	if err != nil {
		return nil, fmt.Errorf("compile canonical Protocol 0.3 schema: %w", err)
	}
	return NewProtocolValidator(schema), nil
}

func NewProtocolValidator(schema *jsonschema.Schema) *ProtocolValidator {
	return &ProtocolValidator{schema: schema}
}

// Validate rejects a document atomically: any error means the whole document is
// refused. The declared version is checked first and on its own so an unknown
// version reports a named diagnostic rather than a generic schema failure, and
// so the check holds even when this validator carries no compiled schema.
// Protocol 0.3 replaced 0.2 outright; a 0.2 document is an unknown version.
func (validator *ProtocolValidator) Validate(root map[string]any) []string {
	errors := make([]string, 0)
	if declared, ok := root["schemaVersion"].(string); !ok || declared != ProtocolVersion {
		return []string{"protocol_version_unsupported"}
	}
	if validator != nil && validator.schema != nil {
		if err := validator.schema.Validate(root); err != nil {
			return []string{"protocol_schema_invalid"}
		}
	}
	entries := walkProtocolNodes(root)
	errors = append(errors, validateProtocolCapabilities(root, entries)...)
	errors = append(errors, validateProtocolIdentifiers(root, entries)...)
	errors = append(errors, validateProtocolDesignSystem(root, entries)...)
	errors = append(errors, validateProtocolAssets(root, entries)...)
	errors = append(errors, validateProtocolProducts(root, entries)...)
	errors = append(errors, validateProtocolLocalization(root, entries)...)
	errors = append(errors, validateProtocolLayout(root, entries)...)
	if len(errors) > 0 {
		return uniqueStrings(errors)
	}
	return nil
}

type protocolNode struct {
	value     map[string]any
	screenID  string
	ancestors []map[string]any
}

func walkProtocolNodes(root map[string]any) []protocolNode {
	result := make([]protocolNode, 0)
	var visit func(map[string]any, string, []map[string]any)
	visit = func(node map[string]any, screenID string, ancestors []map[string]any) {
		if node == nil {
			return
		}
		result = append(result, protocolNode{value: node, screenID: screenID, ancestors: append([]map[string]any(nil), ancestors...)})
		next := append(append([]map[string]any(nil), ancestors...), node)
		switch stringValue(node["type"]) {
		case "scrollContainer":
			visit(mapValue(node["content"]), screenID, next)
		case "stack", "productCard", "productBadge":
			for _, child := range arrayValue(node["children"]) {
				visit(mapValue(child), screenID, next)
			}
		case "carousel":
			for _, page := range arrayValue(node["pages"]) {
				visit(mapValue(mapValue(page)["content"]), screenID, next)
			}
		case "tabs":
			for _, tab := range arrayValue(node["tabs"]) {
				visit(mapValue(mapValue(tab)["content"]), screenID, next)
			}
		case "button":
			for _, key := range []string{"children", "inProgressChildren"} {
				for _, child := range arrayValue(node[key]) {
					visit(mapValue(child), screenID, next)
				}
			}
		case "productSelector":
			for _, card := range arrayValue(node["cards"]) {
				visit(mapValue(card), screenID, next)
			}
		}
	}
	for _, raw := range arrayValue(root["screens"]) {
		screen := mapValue(raw)
		visit(mapValue(screen["layout"]), stringValue(screen["id"]), nil)
	}
	return result
}

var componentCapability = map[string]string{
	"award": "component.award", "button": "component.button", "carousel": "component.carousel",
	"countdown": "component.countdown", "featureList": "component.featureList", "icon": "component.icon",
	"image": "component.image", "productBadge": "component.productBadge", "productCard": "component.productCard",
	"productSelector": "component.productSelector", "scrollContainer": "layout.scrollContainer",
	"socialProof": "component.socialProof", "stack": "layout.stack", "switch": "component.switch",
	"tabs": "component.tabs", "text": "component.text", "timeline": "component.timeline",
}

var colorFields = map[string]bool{
	"background": true, "color": true, "emptyColor": true, "filledColor": true,
	"markerColor": true, "offTrackColor": true, "onTrackColor": true,
	"productLabelColor": true, "runtimePriceColor": true, "selectedLabelColor": true,
	"textColor": true, "thumbColor": true,
}

func validateProtocolCapabilities(root map[string]any, entries []protocolNode) []string {
	expected := map[string]bool{"navigation.screens": true, "localization.catalogs": true}
	localization := mapValue(root["localization"])
	for _, raw := range mapValue(localization["locales"]) {
		if stringValue(mapValue(raw)["direction"]) == "rtl" {
			expected["localization.rtl"] = true
		}
	}
	if len(arrayValue(root["products"])) > 0 {
		expected["product.references"] = true
	}
	design := mapValue(root["designSystem"])
	if len(arrayValue(design["colors"]))+len(arrayValue(design["backgrounds"]))+len(arrayValue(design["shadows"])) > 0 {
		expected["style.designTokens"] = true
	}
	if len(arrayValue(design["colors"])) > 0 {
		expected["style.colors"] = true
	}
	for _, reserved := range reservedAccessibilityKeys {
		if reserved.consumedBy(entries) {
			expected["accessibility.reservedStrings"] = true
		}
	}
	for _, raw := range arrayValue(root["assets"]) {
		asset := mapValue(raw)
		sourceKind := "bundled"
		if stringValue(mapValue(asset["source"])["type"]) == "remote" {
			sourceKind = "remote"
		}
		kind := stringValue(asset["type"])
		if kind == "image" {
			expected["asset."+sourceKind+"Image"] = true
			expected["fallback.asset"] = true
		} else if kind == "video" {
			expected["asset."+sourceKind+"Video"] = true
		}
	}
	for _, raw := range arrayValue(root["screens"]) {
		if stringValue(mapValue(mapValue(raw)["presentation"])["type"]) == "sheet" {
			expected["navigation.sheets"] = true
		}
	}
	authored := []any{design}
	for _, entry := range entries {
		node := entry.value
		authored = append(authored, node)
		if capability := componentCapability[stringValue(node["type"])]; capability != "" {
			expected[capability] = true
		}
		if node["accessibility"] != nil || stringValue(node["type"]) == "carousel" {
			expected["accessibility.metadata"] = true
		}
		if node["typography"] != nil {
			expected["style.typography"] = true
		}
		if node["appearance"] != nil || node["styles"] != nil || node["padding"] != nil || (stringValue(node["type"]) == "scrollContainer" && node["background"] != nil) {
			expected["style.box"] = true
		}
		if node["sizing"] != nil {
			expected["layout.sizing"] = true
			if mapValue(node["sizing"])["height"] != nil {
				expected["layout.heightSizing"] = true
			}
		}
		if node["outerInsets"] != nil {
			expected["layout.outerInsets"] = true
		}
		if mapValue(node["appearance"])["clipContent"] != nil {
			expected["style.clipping"] = true
		}
		if visibility := mapValue(node["visibility"]); len(visibility) > 0 {
			switch stringValue(visibility["mode"]) {
			case "switch":
				expected["condition.switchVisibility"] = true
			case "tab":
				expected["condition.tabVisibility"] = true
			default:
				expected["visibility.static"] = true
			}
		}
		if stringValue(node["type"]) == "productSelector" {
			expected["fallback.product"], expected["outcome.normalized"], expected["style.productCardStates"] = true, true, true
		}
		if stringValue(node["type"]) == "productCard" || stringValue(node["type"]) == "productBadge" {
			expected["style.productCardStates"] = true
			if containsProductTemplate(node) {
				expected["localization.productTemplate"] = true
			}
		}
		action := mapValue(node["action"])
		if kind := stringValue(action["type"]); kind != "" {
			expected["action."+kind] = true
			if kind == "purchase" || kind == "restore" || kind == "close" {
				expected["outcome.normalized"] = true
			}
		}
	}
	for _, value := range authored {
		walkObjects(value, func(item map[string]any) {
			typeName := stringValue(item["type"])
			if typeName == "linearGradient" || typeName == "radialGradient" {
				expected["style.gradientBackground"] = true
			}
			if (typeName == "image" || typeName == "video") && item["fallbackColor"] != nil {
				expected["style.mediaBackground"] = true
			}
			if typeName == "shadow" || typeName == "shadowToken" {
				expected["style.shadow"] = true
			}
			if typeName == "colorToken" {
				expected["style.colors"] = true
			}
			for key := range item {
				if colorFields[key] {
					expected["style.colors"] = true
				}
			}
		})
	}
	declared := map[string]string{}
	errors := []string{}
	compatibility := mapValue(root["compatibility"])
	for _, raw := range arrayValue(compatibility["requiredCapabilities"]) {
		capability := mapValue(raw)
		name, version := stringValue(capability["name"]), stringValue(capability["version"])
		if _, exists := declared[name]; exists {
			errors = append(errors, "protocol_capability_duplicate")
		}
		declared[name] = version
	}
	for name := range expected {
		if declared[name] != ProtocolVersion {
			errors = append(errors, "protocol_capability_missing")
		}
	}
	for name, version := range declared {
		if !expected[name] || version != ProtocolVersion {
			errors = append(errors, "protocol_capability_unused_or_unsupported")
		}
	}
	return errors
}

func validateProtocolIdentifiers(root map[string]any, entries []protocolNode) []string {
	errors := []string{}
	if hasDuplicateField(arrayValue(root["screens"]), "id") {
		errors = append(errors, "protocol_screen_id_duplicate")
	}
	values := make([]any, 0, len(entries))
	for _, entry := range entries {
		values = append(values, entry.value)
		if stringValue(entry.value["type"]) == "carousel" {
			values = append(values, arrayValue(entry.value["pages"])...)
		}
		// A tab id names a control, a panel, and the value a tab-visibility
		// condition compares against, so it shares the one layout namespace.
		if stringValue(entry.value["type"]) == "tabs" {
			values = append(values, arrayValue(entry.value["tabs"])...)
		}
		if stringValue(entry.value["type"]) == "featureList" && hasDuplicateField(arrayValue(entry.value["items"]), "id") {
			errors = append(errors, "protocol_feature_id_duplicate")
		}
		if stringValue(entry.value["type"]) == "timeline" && hasDuplicateField(arrayValue(entry.value["entries"]), "id") {
			errors = append(errors, "protocol_timeline_entry_id_duplicate")
		}
	}
	if hasDuplicateField(values, "id") {
		errors = append(errors, "protocol_component_id_duplicate")
	}
	return errors
}

func validateProtocolDesignSystem(root map[string]any, entries []protocolNode) []string {
	errors := []string{}
	design := mapValue(root["designSystem"])
	catalogs := map[string][]any{"colorToken": arrayValue(design["colors"]), "backgroundToken": arrayValue(design["backgrounds"]), "shadowToken": arrayValue(design["shadows"])}
	known := map[string]map[string]bool{}
	for kind, catalog := range catalogs {
		if hasDuplicateField(catalog, "id") || hasDuplicateField(catalog, "name") {
			errors = append(errors, "protocol_design_token_duplicate")
		}
		known[kind] = map[string]bool{}
		for _, raw := range catalog {
			known[kind][stringValue(mapValue(raw)["id"])] = true
		}
	}
	roots := []any{design}
	for _, entry := range entries {
		roots = append(roots, entry.value)
	}
	for _, rootValue := range roots {
		walkObjects(rootValue, func(item map[string]any) {
			kind := stringValue(item["type"])
			if ids, ok := known[kind]; ok && !ids[stringValue(item["id"])] {
				errors = append(errors, "protocol_design_token_unknown")
			}
			if kind == "linearGradient" || kind == "radialGradient" {
				prior := -1.0
				for _, raw := range arrayValue(item["stops"]) {
					position := numberValue(mapValue(raw)["position"])
					if position <= prior {
						errors = append(errors, "protocol_gradient_stops_invalid")
						break
					}
					prior = position
				}
			}
		})
	}
	for kind, catalog := range catalogs {
		graph := map[string][]string{}
		for _, raw := range catalog {
			token := mapValue(raw)
			id := stringValue(token["id"])
			walkObjects(token["value"], func(item map[string]any) {
				if stringValue(item["type"]) == kind {
					graph[id] = append(graph[id], stringValue(item["id"]))
				}
			})
		}
		if graphCycle(graph) {
			errors = append(errors, "protocol_design_token_cycle")
		}
	}
	return errors
}

// imageAssetReferences lists every image asset a component names directly.
// Every component that can name one is listed here, so a new component whose
// asset went uncounted would be reported as an unused asset rather than pass
// silently: the list is exhaustive by construction, not by convention.
func imageAssetReferences(node map[string]any) []string {
	switch stringValue(node["type"]) {
	case "image":
		return []string{stringValue(node["assetId"])}
	case "award":
		emblem := mapValue(node["emblem"])
		if stringValue(emblem["type"]) == "image" {
			return []string{stringValue(emblem["assetId"])}
		}
	case "socialProof":
		if avatar := mapValue(node["avatar"]); len(avatar) > 0 {
			return []string{stringValue(avatar["assetId"])}
		}
	}
	return nil
}

func validateProtocolAssets(root map[string]any, entries []protocolNode) []string {
	errors := []string{}
	assetsRaw := arrayValue(root["assets"])
	if hasDuplicateField(assetsRaw, "id") {
		errors = append(errors, "protocol_asset_id_duplicate")
	}
	assets := map[string]map[string]any{}
	for _, raw := range assetsRaw {
		asset := mapValue(raw)
		assets[stringValue(asset["id"])] = asset
		if source := mapValue(asset["source"]); stringValue(source["type"]) == "remote" && !safeAbsoluteHTTPS(stringValue(source["url"])) {
			errors = append(errors, "protocol_asset_url_unsafe")
		}
	}
	referenced := map[string]bool{}
	for _, entry := range entries {
		for _, id := range imageAssetReferences(entry.value) {
			if stringValue(assets[id]["type"]) != "image" {
				errors = append(errors, "protocol_asset_reference_invalid")
			} else {
				referenced[id] = true
			}
		}
	}
	roots := []any{mapValue(root["designSystem"])}
	for _, entry := range entries {
		roots = append(roots, entry.value)
	}
	for _, item := range roots {
		walkObjects(item, func(value map[string]any) {
			kind := stringValue(value["type"])
			if (kind != "image" && kind != "video") || value["fallbackColor"] == nil {
				return
			}
			id := stringValue(value["assetId"])
			if stringValue(assets[id]["type"]) != kind {
				errors = append(errors, "protocol_background_asset_invalid")
			} else {
				referenced[id] = true
			}
			if kind == "video" && stringValue(value["posterAssetId"]) != "" {
				poster := stringValue(value["posterAssetId"])
				if stringValue(assets[poster]["type"]) != "image" {
					errors = append(errors, "protocol_video_poster_invalid")
				} else {
					referenced[poster] = true
				}
			}
		})
	}
	for id := range assets {
		if !referenced[id] {
			errors = append(errors, "protocol_asset_unused")
		}
	}
	return errors
}

func validateProtocolProducts(root map[string]any, entries []protocolNode) []string {
	errors := []string{}
	productsRaw := arrayValue(root["products"])
	if hasDuplicateField(productsRaw, "id") || hasDuplicateField(productsRaw, "productId") {
		errors = append(errors, "protocol_product_duplicate")
	}
	products := map[string]bool{}
	for _, raw := range productsRaw {
		products[stringValue(mapValue(raw)["id"])] = true
	}
	type selector struct {
		node   map[string]any
		screen string
	}
	selectors := map[string]selector{}
	purchaseTargets := map[string]bool{}
	referenced := map[string]bool{}
	for _, entry := range entries {
		node, kind := entry.value, stringValue(entry.value["type"])
		if kind == "productSelector" {
			selectors[stringValue(node["id"])] = selector{node: node, screen: entry.screenID}
			cardIDs, productIDs := map[string]bool{}, map[string]bool{}
			for _, raw := range arrayValue(node["cards"]) {
				card := mapValue(raw)
				cardIDs[stringValue(card["id"])] = true
				id := stringValue(card["productReferenceId"])
				if !products[id] || productIDs[id] {
					errors = append(errors, "protocol_selector_product_invalid")
				}
				productIDs[id], referenced[id] = true, true
			}
			if !cardIDs[stringValue(node["initialProductCardId"])] {
				errors = append(errors, "protocol_selector_initial_card_invalid")
			}
		}
		if kind == "button" && stringValue(mapValue(node["action"])["type"]) == "purchase" {
			purchaseTargets[entry.screenID+":"+stringValue(mapValue(node["action"])["productSelectorId"])] = true
		}
	}
	for _, entry := range entries {
		node := entry.value
		if stringValue(node["type"]) != "button" || stringValue(mapValue(node["action"])["type"]) != "purchase" {
			continue
		}
		id := stringValue(mapValue(node["action"])["productSelectorId"])
		value, ok := selectors[id]
		if !ok || value.screen != entry.screenID {
			errors = append(errors, "protocol_purchase_selector_invalid")
		}
	}
	for id, value := range selectors {
		if !purchaseTargets[value.screen+":"+id] {
			errors = append(errors, "protocol_selector_purchase_missing")
		}
	}
	for id := range products {
		if !referenced[id] {
			errors = append(errors, "protocol_product_unused")
		}
	}
	return errors
}

var productTemplatePattern = regexp.MustCompile(`\{\{\s*product\.(name|price)\s*\}\}`)

// reservedAccessibilityKey names a localization key the protocol itself
// consumes rather than any component referencing it. A renderer must never
// compose an accessibility phrase from a hardcoded string in any language, so
// each key is required exactly when the document contains the feature that
// announces it and forbidden otherwise. Mirrors reservedAccessibilityKeys in
// protocol/tools/validation-v0.3.mjs.
type reservedAccessibilityStrings struct {
	key          string
	placeholders []string
	consumedBy   func([]protocolNode) bool
}

var reservedAccessibilityKeys = []reservedAccessibilityStrings{
	{
		key:          "mosaic.a11y.rating",
		placeholders: []string{"{{ rating.value }}", "{{ rating.maximum }}"},
		consumedBy: func(entries []protocolNode) bool {
			for _, entry := range entries {
				if stringValue(entry.value["type"]) == "socialProof" && len(mapValue(entry.value["rating"])) > 0 {
					return true
				}
			}
			return false
		},
	},
	{
		key:          "mosaic.a11y.in_progress",
		placeholders: nil,
		consumedBy: func(entries []protocolNode) bool {
			for _, entry := range entries {
				if stringValue(entry.value["type"]) == "button" && entry.value["inProgressChildren"] != nil {
					return true
				}
			}
			return false
		},
	},
}

func reservedAccessibilityKey(key string) bool {
	for _, reserved := range reservedAccessibilityKeys {
		if reserved.key == key {
			return true
		}
	}
	return false
}

type localizedValue struct {
	key, fallback string
}

func validateProtocolLocalization(root map[string]any, entries []protocolNode) []string {
	errors := []string{}
	localization := mapValue(root["localization"])
	defaultLocale, fallbackLocale := stringValue(localization["defaultLocale"]), stringValue(localization["fallbackLocale"])
	locales := mapValue(localization["locales"])
	if locales[defaultLocale] == nil || locales[fallbackLocale] == nil {
		errors = append(errors, "protocol_localization_locale_missing")
		return errors
	}
	defaultStrings := mapValue(mapValue(locales[defaultLocale])["strings"])
	allowedTemplateKeys := map[string]bool{}
	for _, entry := range entries {
		if stringValue(entry.value["type"]) == "productCard" || ancestorType(entry.ancestors, "productCard") {
			collectLocalized(entry.value, func(value localizedValue) { allowedTemplateKeys[value.key] = true })
		}
	}
	referenced := map[string]bool{}
	collectLocalized(root, func(value localizedValue) {
		referenced[value.key] = true
		catalogValue, ok := defaultStrings[value.key].(string)
		if !ok || catalogValue != value.fallback {
			errors = append(errors, "protocol_localization_default_mismatch")
		}
		for _, rawCatalog := range locales {
			text, exists := mapValue(mapValue(rawCatalog)["strings"])[value.key].(string)
			if !exists {
				continue
			}
			remainder := productTemplatePattern.ReplaceAllString(text, "")
			usesTemplate := remainder != text
			if strings.Contains(remainder, "{{") || strings.Contains(remainder, "}}") || (usesTemplate && !allowedTemplateKeys[value.key]) {
				errors = append(errors, "protocol_product_template_invalid")
			}
		}
	})
	for _, reserved := range reservedAccessibilityKeys {
		consumed := reserved.consumedBy(entries)
		_, declared := defaultStrings[reserved.key]
		// Both directions, as with the timeline style rules: a phrase the
		// document needs but never authored would leave a renderer composing
		// one from a hardcoded English string, and a phrase nothing announces
		// is a translation cost nobody reads.
		if consumed != declared {
			errors = append(errors, "protocol_reserved_accessibility_key_invalid")
		}
		if !declared {
			continue
		}
		for _, raw := range locales {
			text, exists := mapValue(mapValue(raw)["strings"])[reserved.key].(string)
			if !exists {
				continue
			}
			residue := text
			for _, placeholder := range reserved.placeholders {
				// Exactly once. A translation that drops the placeholder
				// announces a rating with no number in it; one that repeats it
				// announces the number twice.
				if strings.Count(text, placeholder) != 1 {
					errors = append(errors, "protocol_reserved_accessibility_placeholder_invalid")
				}
				residue = strings.ReplaceAll(residue, placeholder, "")
			}
			if strings.Contains(residue, "{{") || strings.Contains(residue, "}}") {
				errors = append(errors, "protocol_reserved_accessibility_placeholder_invalid")
			}
		}
	}
	for key := range defaultStrings {
		// Reserved keys are consumed by the protocol itself, not referenced by
		// any component, so the unused sweep would flag every one of them.
		if reservedAccessibilityKey(key) {
			continue
		}
		if !referenced[key] {
			errors = append(errors, "protocol_localization_key_unused")
		}
	}
	for locale, raw := range locales {
		if locale == defaultLocale {
			continue
		}
		for key := range mapValue(mapValue(raw)["strings"]) {
			if defaultStrings[key] == nil {
				errors = append(errors, "protocol_localization_key_unknown")
			}
		}
	}
	return errors
}

func validateProtocolLayout(root map[string]any, entries []protocolNode) []string {
	errors := []string{}
	screens := map[string]map[string]any{}
	edges := map[string][]string{}
	for _, raw := range arrayValue(root["screens"]) {
		screen := mapValue(raw)
		id := stringValue(screen["id"])
		screens[id] = screen
		layout, content := mapValue(screen["layout"]), mapValue(mapValue(screen["layout"])["content"])
		if stringValue(content["direction"]) != "vertical" || len(arrayValue(content["children"])) == 0 || stringValue(layout["type"]) != "scrollContainer" {
			errors = append(errors, "protocol_screen_root_invalid")
		}
	}
	initial := stringValue(root["initialScreenId"])
	if screens[initial] == nil || stringValue(mapValue(screens[initial]["presentation"])["type"]) != "screen" {
		errors = append(errors, "protocol_initial_screen_invalid")
	}
	switches := map[string]protocolNode{}
	tabs := map[string]protocolNode{}
	for _, entry := range entries {
		switch stringValue(entry.value["type"]) {
		case "switch":
			switches[stringValue(entry.value["id"])] = entry
		case "tabs":
			tabs[stringValue(entry.value["id"])] = entry
		}
	}
	interactive := map[string]bool{"button": true, "productSelector": true, "switch": true, "carousel": true, "tabs": true}
	for _, entry := range entries {
		node, kind := entry.value, stringValue(entry.value["type"])
		if kind == "productCard" {
			if len(entry.ancestors) == 0 || stringValue(entry.ancestors[len(entry.ancestors)-1]["type"]) != "productSelector" {
				errors = append(errors, "protocol_product_card_owner_invalid")
			}
			badges, descendants, stackDepth := 0, 0, 0
			for _, raw := range arrayValue(node["children"]) {
				if stringValue(mapValue(raw)["type"]) == "productBadge" {
					badges++
				}
				d, depth := passiveMetrics(mapValue(raw), 0)
				descendants += d
				if depth > stackDepth {
					stackDepth = depth
				}
			}
			if badges > 1 || descendants > 20 || stackDepth > 4 {
				errors = append(errors, "protocol_product_card_content_invalid")
			}
		}
		if kind == "productBadge" && (len(entry.ancestors) == 0 || stringValue(entry.ancestors[len(entry.ancestors)-1]["type"]) != "productCard") {
			errors = append(errors, "protocol_product_badge_owner_invalid")
		}
		if ancestorType(entry.ancestors, "button") && interactive[kind] {
			errors = append(errors, "protocol_button_interactive_child")
		}
		if kind == "button" && node["inProgressChildren"] != nil {
			action := stringValue(mapValue(node["action"])["type"])
			if action != "purchase" && action != "restore" {
				errors = append(errors, "protocol_button_progress_invalid")
			}
		}
		if kind == "carousel" {
			if ancestorType(entry.ancestors, "carousel") || int(numberValue(node["initialPageIndex"])) >= len(arrayValue(node["pages"])) {
				errors = append(errors, "protocol_carousel_invalid")
			}
		}
		if kind == "tabs" {
			declared := map[string]bool{}
			for _, raw := range arrayValue(node["tabs"]) {
				declared[stringValue(mapValue(raw)["id"])] = true
			}
			// Positional defaults are forbidden: the opening panel is authored,
			// so reordering the array cannot change which panel opens.
			if !declared[stringValue(node["initialTabId"])] {
				errors = append(errors, "protocol_tabs_initial_tab_invalid")
			}
		}
		if kind == "timeline" {
			marked, described := false, false
			for _, raw := range arrayValue(node["entries"]) {
				timelineEntry := mapValue(raw)
				if timelineEntry["marker"] != nil {
					marked = true
				}
				if timelineEntry["description"] != nil {
					described = true
				}
			}
			// Both directions matter. A missing style where a marker exists
			// leaves the renderer choosing one; a declared style no entry
			// consumes is how a stale field survives a redesign.
			for _, rule := range []struct {
				field string
				used  bool
			}{
				{"markerColor", marked}, {"markerSize", marked}, {"descriptionTypography", described},
			} {
				_, present := node[rule.field]
				if rule.used != present {
					errors = append(errors, "protocol_timeline_style_copresence_invalid")
				}
			}
		}
		if kind == "socialProof" {
			if rating := mapValue(node["rating"]); len(rating) > 0 {
				stepsPerPoint := 1.0
				if stringValue(rating["step"]) == "half" {
					stepsPerPoint = 2
				}
				if numberValue(rating["value"]) > numberValue(rating["maximum"])*stepsPerPoint {
					errors = append(errors, "protocol_social_proof_rating_invalid")
				}
			}
		}
		visibility := mapValue(node["visibility"])
		if stringValue(visibility["mode"]) == "tab" {
			controller, ok := tabs[stringValue(visibility["tabsId"])]
			switch {
			case !ok || controller.screenID != entry.screenID:
				errors = append(errors, "protocol_tab_visibility_invalid")
			case stringValue(controller.value["id"]) == stringValue(node["id"]) ||
				ancestorID(entry.ancestors, stringValue(controller.value["id"])):
				// Inside a panel the condition is already decided: against the
				// owning tab it is vacuously true, against any other tab it is
				// unsatisfiable. Both are dead layout, so both reject.
				errors = append(errors, "protocol_tab_visibility_invalid")
			default:
				declared := false
				for _, raw := range arrayValue(controller.value["tabs"]) {
					if stringValue(mapValue(raw)["id"]) == stringValue(visibility["equals"]) {
						declared = true
					}
				}
				if !declared {
					errors = append(errors, "protocol_tab_visibility_invalid")
				}
			}
		}
		if stringValue(visibility["mode"]) == "switch" {
			controller, ok := switches[stringValue(visibility["switchId"])]
			if !ok || controller.screenID != entry.screenID || stringValue(controller.value["id"]) == stringValue(node["id"]) {
				errors = append(errors, "protocol_switch_visibility_invalid")
			}
		}
		if kind == "button" {
			action := mapValue(node["action"])
			switch stringValue(action["type"]) {
			case "navigateTo":
				target := stringValue(action["screenId"])
				if screens[target] == nil || target == entry.screenID {
					errors = append(errors, "protocol_navigation_target_invalid")
				} else {
					edges[entry.screenID] = append(edges[entry.screenID], target)
				}
			case "openExternalUrl":
				if !safeAbsoluteHTTPS(stringValue(action["url"])) {
					errors = append(errors, "protocol_external_url_unsafe")
				}
			}
		}
		if kind == "countdown" {
			if !canonicalUTC(stringValue(node["endsAt"])) || countdownOrder(stringValue(node["largestUnit"])) > countdownOrder(stringValue(node["smallestUnit"])) {
				errors = append(errors, "protocol_countdown_invalid")
			}
		}
	}
	if screens[initial] != nil {
		reachable, pending := map[string]bool{}, []string{initial}
		for len(pending) > 0 {
			id := pending[len(pending)-1]
			pending = pending[:len(pending)-1]
			if reachable[id] {
				continue
			}
			reachable[id] = true
			pending = append(pending, edges[id]...)
		}
		if len(reachable) != len(screens) {
			errors = append(errors, "protocol_screen_unreachable")
		}
	}
	if graphCycle(edges) {
		errors = append(errors, "protocol_navigation_cycle")
	}
	return errors
}

func mapValue(value any) map[string]any {
	result, _ := value.(map[string]any)
	return result
}

func arrayValue(value any) []any {
	result, _ := value.([]any)
	return result
}

func stringValue(value any) string {
	result, _ := value.(string)
	return result
}

func numberValue(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case json.Number:
		result, _ := typed.Float64()
		return result
	default:
		return -1
	}
}

func walkObjects(value any, visit func(map[string]any)) {
	switch typed := value.(type) {
	case map[string]any:
		visit(typed)
		for _, child := range typed {
			walkObjects(child, visit)
		}
	case []any:
		for _, child := range typed {
			walkObjects(child, visit)
		}
	}
}

func containsProductTemplate(value any) bool {
	found := false
	walkObjects(value, func(item map[string]any) {
		for _, raw := range item {
			if text, ok := raw.(string); ok && productTemplatePattern.MatchString(text) {
				found = true
			}
		}
	})
	return found
}

func hasDuplicateField(values []any, field string) bool {
	seen := map[string]bool{}
	for _, raw := range values {
		value := stringValue(mapValue(raw)[field])
		if seen[value] {
			return true
		}
		seen[value] = true
	}
	return false
}

func graphCycle(graph map[string][]string) bool {
	visiting, visited := map[string]bool{}, map[string]bool{}
	var visit func(string) bool
	visit = func(id string) bool {
		if visiting[id] {
			return true
		}
		if visited[id] {
			return false
		}
		visiting[id] = true
		for _, target := range graph[id] {
			if visit(target) {
				return true
			}
		}
		delete(visiting, id)
		visited[id] = true
		return false
	}
	keys := make([]string, 0, len(graph))
	for id := range graph {
		keys = append(keys, id)
	}
	sort.Strings(keys)
	for _, id := range keys {
		if visit(id) {
			return true
		}
	}
	return false
}

func safeAbsoluteHTTPS(value string) bool {
	if len([]rune(value)) > 2048 || strings.Contains(value, "\\") || strings.ContainsFunc(value, unicode.IsControl) {
		return false
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return false
	}
	host := parsed.Hostname()
	if host == "" || strings.Contains(host, "..") {
		return false
	}
	if port := parsed.Port(); port != "" {
		value, err := strconv.Atoi(port)
		if err != nil || value < 1 || value > 65535 {
			return false
		}
	}
	return net.ParseIP(host) != nil || strings.Trim(host, ".") == host
}

func collectLocalized(value any, visit func(localizedValue)) {
	switch typed := value.(type) {
	case map[string]any:
		fallback, fallbackOK := typed["default"].(string)
		key, keyOK := typed["localizationKey"].(string)
		if fallbackOK && keyOK {
			visit(localizedValue{key: key, fallback: fallback})
			return
		}
		for _, child := range typed {
			collectLocalized(child, visit)
		}
	case []any:
		for _, child := range typed {
			collectLocalized(child, visit)
		}
	}
}

// ancestorID reports whether the node is a descendant of the identified node.
// Layout ids are unique across the tree (validateProtocolIdentifiers rejects
// duplicates), so identity by id is identity by node.
func ancestorID(values []map[string]any, id string) bool {
	for _, value := range values {
		if stringValue(value["id"]) == id {
			return true
		}
	}
	return false
}

func ancestorType(values []map[string]any, kind string) bool {
	for _, value := range values {
		if stringValue(value["type"]) == kind {
			return true
		}
	}
	return false
}

func passiveMetrics(node map[string]any, depth int) (int, int) {
	nextDepth := depth
	if stringValue(node["type"]) == "stack" {
		nextDepth++
	}
	count, maximum := 1, nextDepth
	for _, raw := range arrayValue(node["children"]) {
		childCount, childDepth := passiveMetrics(mapValue(raw), nextDepth)
		count += childCount
		if childDepth > maximum {
			maximum = childDepth
		}
	}
	return count, maximum
}

func canonicalUTC(value string) bool {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	return err == nil && strings.HasSuffix(value, "Z") && parsed.UTC().Format(time.RFC3339Nano) == value
}

func countdownOrder(value string) int {
	return map[string]int{"day": 0, "hour": 1, "minute": 2, "second": 3}[value]
}
