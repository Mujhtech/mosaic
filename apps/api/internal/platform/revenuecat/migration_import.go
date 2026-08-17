package revenuecat

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercatalog"
)

const MigrationNormalizationSchema = "revenuecat-migration-source-v2"

// MigrationPullRecord is an append-only normalized projection. ProviderEvidence
// contains provenance only; provider validation remains a separate operation.
type MigrationPullRecord struct {
	Kind, SourceIdentifier, SourceRevision, Cursor        string
	Digest                                                []byte
	CurrentAccess                                         bool
	ObservedAt                                            time.Time
	CustomerID, ProductID, ExternalAppID                  string
	Store, Environment, Provider, Platform, ReferenceKind string
	ProviderReference                                     string
	StoreIdentifier                                       string
	EntitlementIDs                                        []string
	Ownership                                             json.RawMessage
	QuarantineReason                                      string
}

// MigrationEvidencePage records the boundary of one fetched page. The page
// body itself is streamed to the evidence writer and the digest as it arrives;
// retaining copies here would pin up to maxPages x bodyLimit of dead heap for
// the rest of the pull.
type MigrationEvidencePage struct {
	Endpoint, Resource, Cursor string
}

type MigrationPullResult struct {
	Records                         []MigrationPullRecord
	Pages                           []MigrationEvidencePage
	ProvenCapabilities              []string
	ResumeCursor, FinalWatermark    string
	RecordCount, CurrentAccessCount int64
	EvidenceDigest                  []byte
}

// PullSource adapts the RevenueCat transport result to the platform-neutral
// source-pull orchestration port.
func (c *Client) PullSource(ctx context.Context, externalProjectID string, secret []byte, startingAfter string, output io.Writer) (billingmigration.SourcePullProviderResult, error) {
	result, err := c.PullMigrationEvidence(ctx, externalProjectID, secret, startingAfter, output)
	if err != nil {
		return billingmigration.SourcePullProviderResult{}, err
	}
	records := make([]billingmigration.SourcePullRecord, len(result.Records))
	for i, record := range result.Records {
		records[i] = billingmigration.SourcePullRecord{Kind: record.Kind, SourceIdentifier: record.SourceIdentifier, SourceRevision: record.SourceRevision, Cursor: record.Cursor, Digest: record.Digest, CurrentAccess: record.CurrentAccess, ObservedAt: record.ObservedAt, CustomerID: record.CustomerID, ProductID: record.ProductID, ExternalAppID: record.ExternalAppID, Store: record.Store, Environment: record.Environment, Provider: record.Provider, Platform: record.Platform, ReferenceKind: record.ReferenceKind, ProviderReference: record.ProviderReference, StoreIdentifier: record.StoreIdentifier, EntitlementIDs: record.EntitlementIDs, Ownership: record.Ownership, QuarantineReason: record.QuarantineReason}
	}
	return billingmigration.SourcePullProviderResult{Records: records, ProvenCapabilities: result.ProvenCapabilities, ResumeCursor: result.ResumeCursor, FinalWatermark: result.FinalWatermark, RecordCount: result.RecordCount, CurrentAccessCount: result.CurrentAccessCount, EvidenceDigest: result.EvidenceDigest}, nil
}

type migrationCustomer struct {
	ID                 string `json:"id"`
	OriginalCustomerID string `json:"original_customer_id"`
	UpdatedAt          int64  `json:"updated_at"`
}

type migrationAlias struct {
	ID        string `json:"id"`
	UpdatedAt int64  `json:"updated_at"`
}

type migrationSubscription struct {
	ID                          string          `json:"id"`
	CustomerID                  string          `json:"customer_id"`
	ProductID                   string          `json:"product_id"`
	Store                       string          `json:"store"`
	Environment                 string          `json:"environment"`
	StoreSubscriptionIdentifier string          `json:"store_subscription_identifier"`
	Status                      string          `json:"status"`
	GivesAccess                 bool            `json:"gives_access"`
	UpdatedAt                   int64           `json:"updated_at"`
	Entitlements                json.RawMessage `json:"entitlements"`
	Ownership                   json.RawMessage `json:"ownership"`
}

type migrationProduct struct {
	ID, StoreIdentifier, AppID string
	AppType                    string
	UpdatedAt                  int64
}

// PullMigrationEvidence follows the documented RevenueCat v2 resource graph.
// Each raw response body is framed with its endpoint/resource/cursor boundary;
// the raw bytes themselves are copied without JSON re-encoding.
func (c *Client) PullMigrationEvidence(ctx context.Context, externalProjectID string, secret []byte, startingAfter string, output io.Writer) (MigrationPullResult, error) {
	if externalProjectID == "" || len(secret) == 0 || output == nil {
		return MigrationPullResult{}, billingmigration.ErrInvalid
	}
	ctx, cancel := context.WithTimeout(ctx, c.operationTimeout)
	defer cancel()
	budget := operationBudget{remainingPages: c.maxPages, remainingRetries: c.maxRetries}
	result := MigrationPullResult{}
	hash := sha256.New()
	seen := make(map[string]struct{})
	appendRecord := func(record MigrationPullRecord) {
		key := record.Kind + "\x1f" + record.SourceIdentifier + "\x1f" + record.SourceRevision + "\x1f" + hex.EncodeToString(record.Digest)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		result.Records = append(result.Records, record)
		result.RecordCount++
		if record.CurrentAccess {
			result.CurrentAccessCount++
		}
	}
	fetch := func(path, resource, initialCursor string, consume func(json.RawMessage, string) error) (string, []byte, error) {
		cursor := initialCursor
		terminalCursor := initialCursor
		var last []byte
		for {
			if !budget.takePage() {
				return "", nil, &providercatalog.Error{Code: providercatalog.ErrorInvalidResponse}
			}
			query := url.Values{"limit": {strconv.Itoa(defaultPageLimit)}}
			if cursor != "" {
				query.Set("starting_after", cursor)
			}
			var raw json.RawMessage
			if err := c.get(ctx, &budget, secret, path, query, &raw); err != nil {
				return "", nil, err
			}
			if err := writeMigrationEvidencePage(output, hash, path, resource, cursor, raw); err != nil {
				return "", nil, err
			}
			result.Pages = append(result.Pages, MigrationEvidencePage{Endpoint: path, Resource: resource, Cursor: cursor})
			var page listResponse[json.RawMessage]
			if err := json.Unmarshal(raw, &page); err != nil {
				return "", nil, &providercatalog.Error{Code: providercatalog.ErrorInvalidResponse}
			}
			for _, item := range page.Items {
				if err := consume(item, cursor); err != nil {
					return "", nil, &providercatalog.Error{Code: providercatalog.ErrorInvalidResponse}
				}
				// RevenueCat documents starting_after as the ID of the last
				// object from the previous page. next_page is absent on the
				// terminal page, so its final item ID is the only correct resume
				// cursor for a later delta. It is treated as an opaque ID after
				// decoding; Mosaic never infers order or meaning from its shape.
				var identity struct {
					ID string `json:"id"`
				}
				if json.Unmarshal(item, &identity) != nil || identity.ID == "" || invalidSourceID(identity.ID) {
					return "", nil, &providercatalog.Error{Code: providercatalog.ErrorInvalidResponse}
				}
				terminalCursor = identity.ID
			}
			last = append(last[:0], raw...)
			if page.NextPage == "" {
				return terminalCursor, last, nil
			}
			next, err := opaqueCursor(page.NextPage)
			if err != nil || next == "" || next == cursor {
				return "", nil, &providercatalog.Error{Code: providercatalog.ErrorInvalidResponse}
			}
			cursor = next
		}
	}

	customersPath := "/projects/" + url.PathEscape(externalProjectID) + "/customers"
	resume, finalCustomerPage, err := fetch(customersPath, "customers", startingAfter, func(raw json.RawMessage, cursor string) error {
		var customer migrationCustomer
		if json.Unmarshal(raw, &customer) != nil || customer.ID == "" || invalidSourceID(customer.ID) {
			return errors.New("invalid customer")
		}
		appendRecord(migrationRecord("customer", customer.ID, customer.UpdatedAt, raw, false, cursor))
		if customer.OriginalCustomerID != "" {
			if invalidSourceID(customer.OriginalCustomerID) {
				return errors.New("invalid original customer")
			}
			record := migrationRecord("customer", customer.OriginalCustomerID, customer.UpdatedAt, raw, false, cursor)
			record.CustomerID = customer.ID
			appendRecord(record)
		}
		subscriptionsPath := "/projects/" + url.PathEscape(externalProjectID) + "/customers/" + url.PathEscape(customer.ID) + "/subscriptions"
		_, _, nestedErr := fetch(subscriptionsPath, "customer:"+customer.ID+":subscriptions", "", func(subscriptionRaw json.RawMessage, nestedCursor string) error {
			var sub migrationSubscription
			if json.Unmarshal(subscriptionRaw, &sub) != nil || sub.ID == "" || invalidSourceID(sub.ID) || sub.ProductID == "" || invalidSourceID(sub.ProductID) {
				return errors.New("invalid subscription")
			}
			if sub.CustomerID == "" {
				sub.CustomerID = customer.ID
			}
			record := migrationRecord("subscription", sub.ID, sub.UpdatedAt, subscriptionRaw, sub.GivesAccess, nestedCursor)
			record.CustomerID, record.ProductID, record.Store, record.Environment = sub.CustomerID, sub.ProductID, sub.Store, sub.Environment
			record.ProviderReference = sub.StoreSubscriptionIdentifier
			record.EntitlementIDs = entitlementIDs(sub.Entitlements)
			record.Ownership = append(json.RawMessage(nil), sub.Ownership...)
			record.Provider, record.Platform, record.ReferenceKind, record.QuarantineReason = normalizeStoreReference(sub.Store, sub.StoreSubscriptionIdentifier)
			appendRecord(record)
			return nil
		})
		if nestedErr != nil {
			return nestedErr
		}
		aliasesPath := "/projects/" + url.PathEscape(externalProjectID) + "/customers/" + url.PathEscape(customer.ID) + "/aliases"
		_, _, nestedErr = fetch(aliasesPath, "customer:"+customer.ID+":aliases", "", func(aliasRaw json.RawMessage, nestedCursor string) error {
			var alias migrationAlias
			if json.Unmarshal(aliasRaw, &alias) != nil || alias.ID == "" || invalidSourceID(alias.ID) {
				return errors.New("invalid alias")
			}
			record := migrationRecord("alias", alias.ID, alias.UpdatedAt, aliasRaw, false, nestedCursor)
			record.CustomerID = customer.ID
			appendRecord(record)
			return nil
		})
		return nestedErr
	})
	if err != nil {
		return MigrationPullResult{}, err
	}
	result.ResumeCursor = resume
	productsPath := "/projects/" + url.PathEscape(externalProjectID) + "/products"
	// expand is part of the official resource request and therefore part of the endpoint boundary.
	fetchProducts := func() error {
		cursor := ""
		for {
			if !budget.takePage() {
				return &providercatalog.Error{Code: providercatalog.ErrorInvalidResponse}
			}
			query := url.Values{"limit": {strconv.Itoa(defaultPageLimit)}, "expand": {"items.app"}}
			if cursor != "" {
				query.Set("starting_after", cursor)
			}
			var raw json.RawMessage
			if err := c.get(ctx, &budget, secret, productsPath, query, &raw); err != nil {
				return err
			}
			if err := writeMigrationEvidencePage(output, hash, productsPath+"?expand=items.app", "products", cursor, raw); err != nil {
				return err
			}
			result.Pages = append(result.Pages, MigrationEvidencePage{Endpoint: productsPath + "?expand=items.app", Resource: "products", Cursor: cursor})
			var page listResponse[json.RawMessage]
			if json.Unmarshal(raw, &page) != nil {
				return &providercatalog.Error{Code: providercatalog.ErrorInvalidResponse}
			}
			for _, item := range page.Items {
				product, parseErr := parseMigrationProduct(item)
				if parseErr != nil {
					return &providercatalog.Error{Code: providercatalog.ErrorInvalidResponse}
				}
				record := migrationRecord("product", product.ID, product.UpdatedAt, item, false, cursor)
				record.ProductID, record.ExternalAppID, record.Store = product.ID, product.AppID, product.AppType
				record.ProviderReference = product.StoreIdentifier
				record.StoreIdentifier = product.StoreIdentifier
				record.Provider, record.Platform, _, record.QuarantineReason = normalizeStoreReference(product.AppType, "")
				appendRecord(record)
			}
			if page.NextPage == "" {
				return nil
			}
			next, parseErr := opaqueCursor(page.NextPage)
			if parseErr != nil || next == "" || next == cursor {
				return &providercatalog.Error{Code: providercatalog.ErrorInvalidResponse}
			}
			cursor = next
		}
	}
	if err := fetchProducts(); err != nil {
		return MigrationPullResult{}, err
	}
	final := sha256.Sum256(append([]byte("revenuecat-v2-final-page\x1f"), finalCustomerPage...))
	result.FinalWatermark = "rcv2:sha256:" + hex.EncodeToString(final[:])
	result.ProvenCapabilities = migrationPullCapabilities(result.Pages)
	sort.Slice(result.Records, func(i, j int) bool {
		a, b := result.Records[i], result.Records[j]
		if a.Kind != b.Kind {
			return a.Kind < b.Kind
		}
		if a.SourceIdentifier != b.SourceIdentifier {
			return a.SourceIdentifier < b.SourceIdentifier
		}
		return a.SourceRevision < b.SourceRevision
	})
	result.EvidenceDigest = hash.Sum(nil)
	return result, nil
}

func migrationPullCapabilities(pages []MigrationEvidencePage) []string {
	seen := map[string]bool{}
	for _, page := range pages {
		switch {
		case page.Resource == "customers":
			seen[billingmigration.SourceCapabilityReadCustomers] = true
			if page.Cursor != "" {
				seen[billingmigration.SourceCapabilityIncrementalDelta] = true
			}
		case strings.HasSuffix(page.Resource, ":subscriptions"):
			seen[billingmigration.SourceCapabilityReadSubscriptions] = true
		case strings.HasSuffix(page.Resource, ":aliases"):
			seen[billingmigration.SourceCapabilityReadAliases] = true
		}
	}
	capabilities := make([]string, 0, len(seen))
	for capability := range seen {
		capabilities = append(capabilities, capability)
	}
	sort.Strings(capabilities)
	return capabilities
}

func writeMigrationEvidencePage(output io.Writer, digest io.Writer, endpoint, resource, cursor string, raw []byte) error {
	for _, writer := range []io.Writer{output, digest} {
		if _, err := writer.Write([]byte("MOSAIC-RC-V2-PAGE\x00")); err != nil {
			return err
		}
		for _, value := range [][]byte{[]byte(endpoint), []byte(resource), []byte(cursor), raw} {
			var size [8]byte
			binary.BigEndian.PutUint64(size[:], uint64(len(value)))
			if _, err := writer.Write(size[:]); err != nil {
				return err
			}
			if _, err := writer.Write(value); err != nil {
				return err
			}
		}
	}
	return nil
}

func parseMigrationProduct(raw json.RawMessage) (migrationProduct, error) {
	var wire struct {
		ID, StoreIdentifier, AppID string
		UpdatedAt                  int64           `json:"updated_at"`
		App                        json.RawMessage `json:"app"`
	}
	if err := json.Unmarshal(raw, &wire); err != nil {
		return migrationProduct{}, err
	}
	// Go field-name matching does not translate underscores.
	var fields struct {
		ID              string `json:"id"`
		StoreIdentifier string `json:"store_identifier"`
		AppID           string `json:"app_id"`
		UpdatedAt       int64  `json:"updated_at"`
		App             struct {
			ID   string `json:"id"`
			Type string `json:"type"`
		} `json:"app"`
	}
	if err := json.Unmarshal(raw, &fields); err != nil || fields.ID == "" || fields.StoreIdentifier == "" || fields.App.ID == "" || fields.App.Type == "" || invalidSourceID(fields.ID) || invalidSourceID(fields.StoreIdentifier) || invalidSourceID(fields.App.ID) {
		return migrationProduct{}, errors.New("invalid product")
	}
	return migrationProduct{ID: fields.ID, StoreIdentifier: fields.StoreIdentifier, AppID: fields.App.ID, AppType: fields.App.Type, UpdatedAt: fields.UpdatedAt}, nil
}

func normalizeStoreReference(store, reference string) (provider, platform, referenceKind, quarantine string) {
	switch store {
	case "app_store", "mac_app_store":
		return "app_store", "ios", "app_store_transaction_id", ""
	case "play_store":
		// RevenueCat v2 exposes an order id here, not a Google purchase token.
		return "google_play", "android", "google_play_order_id", ""
	default:
		return "", "", "", "unsupported_store"
	}
}

func entitlementIDs(raw json.RawMessage) []string {
	var list []string
	if json.Unmarshal(raw, &list) == nil {
		sort.Strings(list)
		return list
	}
	var page listResponse[struct {
		ID string `json:"id"`
	}]
	if json.Unmarshal(raw, &page) == nil {
		for _, item := range page.Items {
			if item.ID != "" && !invalidSourceID(item.ID) {
				list = append(list, item.ID)
			}
		}
	}
	sort.Strings(list)
	return list
}

func migrationRecord(kind, id string, revision int64, value any, current bool, cursor string) MigrationPullRecord {
	canonical, _ := json.Marshal(value)
	digest := sha256.Sum256(canonical)
	return MigrationPullRecord{Kind: kind, SourceIdentifier: id, SourceRevision: fmt.Sprintf("%d:%x", revision, digest[:]), Cursor: cursor, Digest: digest[:], CurrentAccess: current, ObservedAt: time.UnixMilli(revision).UTC()}
}

func opaqueCursor(nextPage string) (string, error) {
	parsed, err := url.Parse(nextPage)
	if err != nil {
		return "", err
	}
	values, ok := parsed.Query()["starting_after"]
	if !ok || len(values) != 1 {
		return "", errors.New("missing cursor")
	}
	return values[0], nil
}

func invalidSourceID(value string) bool {
	if len(value) > 512 {
		return true
	}
	for _, r := range value {
		if r <= 0x1f || r == 0x7f {
			return true
		}
	}
	return false
}
