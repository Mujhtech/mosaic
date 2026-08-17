package hostedpublishing

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
)

type documentAnalysis struct {
	DocumentID      string
	ProtocolVersion string
	ProductIDs      []string
	HostedAssets    bool
	RemoteAssets    []documentAssetReference
	Summary         ValidationSummary
	Canonical       json.RawMessage
	Hash            string
}

type documentAssetReference struct {
	DocumentAssetID string
	Kind            string
	URL             string
}

func analyzeDocument(document json.RawMessage) documentAnalysis {
	return analyzeDocumentWithValidator(document, NewProtocolValidator(nil))
}

func (s *Service) analyzeDocument(document json.RawMessage) documentAnalysis {
	return analyzeDocumentWithValidator(document, s.validator)
}

func analyzeDocumentWithValidator(document json.RawMessage, validator *ProtocolValidator) documentAnalysis {
	analysis := documentAnalysis{Summary: ValidationSummary{Errors: []string{}, Warnings: []string{}}}
	var root map[string]any
	if err := json.Unmarshal(document, &root); err != nil {
		analysis.Summary.Errors = append(analysis.Summary.Errors, "document_invalid_json")
		return analysis
	}
	analysis.ProtocolVersion, _ = root["schemaVersion"].(string)
	analysis.DocumentID, _ = root["id"].(string)
	analysis.Summary.Errors = append(analysis.Summary.Errors, validator.Validate(root)...)
	products, ok := root["products"].([]any)
	if !ok {
		analysis.Summary.Errors = append(analysis.Summary.Errors, "products_missing")
	} else {
		seen := make(map[string]struct{}, len(products))
		for _, raw := range products {
			product, ok := raw.(map[string]any)
			if !ok {
				analysis.Summary.Errors = append(analysis.Summary.Errors, "product_reference_invalid")
				continue
			}
			productID, _ := product["productId"].(string)
			if strings.TrimSpace(productID) == "" {
				analysis.Summary.Errors = append(analysis.Summary.Errors, "product_id_missing")
				continue
			}
			if _, duplicate := seen[productID]; duplicate {
				analysis.Summary.Errors = append(analysis.Summary.Errors, "product_id_duplicate")
				continue
			}
			seen[productID] = struct{}{}
			analysis.ProductIDs = append(analysis.ProductIDs, productID)
		}
	}
	for _, raw := range arrayValue(root["assets"]) {
		asset := mapValue(raw)
		source := mapValue(asset["source"])
		if stringValue(source["type"]) == "remote" {
			analysis.RemoteAssets = append(analysis.RemoteAssets, documentAssetReference{
				DocumentAssetID: stringValue(asset["id"]), Kind: stringValue(asset["type"]), URL: stringValue(source["url"]),
			})
		}
	}
	analysis.HostedAssets = len(analysis.RemoteAssets) > 0
	sort.Strings(analysis.ProductIDs)
	if canonical, err := json.Marshal(root); err == nil {
		analysis.Canonical = append(json.RawMessage(nil), canonical...)
		digest := sha256.Sum256(canonical)
		analysis.Hash = hex.EncodeToString(digest[:])
	}
	analysis.Summary.Errors = uniqueStrings(analysis.Summary.Errors)
	return analysis
}

func validationStatus(summary ValidationSummary) string {
	if len(summary.Errors) == 0 {
		return "valid"
	}
	return "invalid"
}

func digestString(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func ContentHash(value []byte) string {
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
}

func requestDigest(value any) string {
	encoded, _ := json.Marshal(value)
	return digestString(string(encoded))
}

func formatInt(value int64) string { return strconv.FormatInt(value, 10) }

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func validationError(summary ValidationSummary) error {
	if len(summary.Errors) == 0 {
		return nil
	}
	if len(summary.Errors) == 1 && summary.Errors[0] == "hosted_asset_storage_unavailable" {
		return ErrAssetStorageUnavailable
	}
	return &ValidationError{Errors: append([]string(nil), summary.Errors...)}
}

func draftETagMatches(value string, draft Draft) bool {
	return strings.TrimSpace(value) == DraftETag(draft.ID, draft.CurrentRevision)
}
