package revenuecat

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestMigrationPullUsesOfficialV2GraphAndPreservesExactPages(t *testing.T) {
	var mu sync.Mutex
	requests := make([]string, 0)
	unknownRaw := []byte(`{"items":[{"id":"alias_A","updated_at":2000}],"provider_unknown":{"escaped":"a\\u0062"},"next_page":""}`)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		requests = append(requests, r.URL.RequestURI())
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/v2/projects/rc_project/customers" && r.URL.Query().Get("starting_after") == "opaque+/root=":
			_, _ = w.Write([]byte(`{"items":[{"id":"customer_B","updated_at":3000}],"next_page":""}`))
		case r.URL.Path == "/v2/projects/rc_project/customers":
			if r.URL.Query().Get("expand") != "" {
				t.Errorf("invented customer expand: %s", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`{"items":[{"id":"customer_A","original_customer_id":"original_A","updated_at":2000}],"next_page":"https://api.revenuecat.com/v2/projects/p/customers?starting_after=opaque%2B%2Froot%3D"}`))
		case r.URL.Path == "/v2/projects/rc_project/customers/customer_A/subscriptions" && r.URL.Query().Get("starting_after") == "nested":
			_, _ = w.Write([]byte(`{"items":[{"id":"subscription_unsupported","customer_id":"customer_A","product_id":"product_other","store":"stripe","store_subscription_identifier":"opaque","gives_access":true,"updated_at":2100}],"next_page":""}`))
		case r.URL.Path == "/v2/projects/rc_project/customers/customer_A/subscriptions":
			_, _ = w.Write([]byte(`{"items":[{"id":"subscription_A","customer_id":"customer_A","product_id":"product_A","store":"play_store","environment":"production","store_subscription_identifier":"GPA.opaque.order","gives_access":true,"updated_at":2000,"entitlements":{"items":[{"id":"pro"}]},"ownership":{"type":"purchased"}}],"next_page":"https://api.revenuecat.com/v2/projects/rc_project/customers/customer_A/subscriptions?starting_after=nested"}`))
		case r.URL.Path == "/v2/projects/rc_project/customers/customer_A/aliases":
			_, _ = w.Write(unknownRaw)
		case r.URL.Path == "/v2/projects/rc_project/customers/customer_B/subscriptions" || r.URL.Path == "/v2/projects/rc_project/customers/customer_B/aliases":
			_, _ = w.Write([]byte(`{"items":[],"next_page":""}`))
		case r.URL.Path == "/v2/projects/rc_project/products":
			if r.URL.Query().Get("expand") != "items.app" {
				t.Errorf("products expand = %q", r.URL.Query().Get("expand"))
			}
			_, _ = w.Write([]byte(`{"items":[{"id":"product_A","store_identifier":"sku.a","app_id":"rc_app_android","updated_at":2000,"app":{"id":"rc_app_android","type":"play_store"}},{"id":"product_other","store_identifier":"sku.other","app_id":"rc_app_other","app":{"id":"rc_app_other","type":"stripe"}}],"next_page":""}`))
		default:
			http.Error(w, r.URL.RequestURI(), http.StatusNotFound)
		}
	}))
	defer server.Close()
	client, err := New(Config{BaseURL: server.URL + "/v2", RequestTimeout: time.Second, OperationTimeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	var evidence bytes.Buffer
	result, err := client.PullMigrationEvidence(context.Background(), "rc_project", []byte("secret"), "", &evidence)
	if err != nil {
		t.Fatal(err)
	}
	if result.ResumeCursor != "customer_B" || result.RecordCount != 8 || result.CurrentAccessCount != 2 {
		t.Fatalf("result = %#v", result)
	}
	if strings.Join(result.ProvenCapabilities, ",") != "incremental_delta,read_aliases,read_customers,read_subscriptions" {
		t.Fatalf("proven capabilities = %#v", result.ProvenCapabilities)
	}
	if !bytes.Contains(evidence.Bytes(), unknownRaw) {
		t.Fatal("exact raw alias page was not retained")
	}
	var play, unsupported bool
	for _, record := range result.Records {
		switch record.SourceIdentifier {
		case "subscription_A":
			play = record.Provider == "google_play" && record.Platform == "android" && record.Environment == "production" && record.ReferenceKind == "google_play_order_id" && len(record.EntitlementIDs) == 1 && record.EntitlementIDs[0] == "pro"
		case "subscription_unsupported":
			unsupported = record.Provider == "" && record.QuarantineReason == "unsupported_store"
		}
	}
	if !play || !unsupported {
		t.Fatalf("normalization play=%v unsupported=%v records=%#v", play, unsupported, result.Records)
	}
	joined := strings.Join(requests, "\n")
	if strings.Contains(joined, "transfers") || strings.Contains(joined, "/v2/customers/") || !strings.Contains(joined, "/projects/rc_project/customers/customer_A/subscriptions") || !strings.Contains(joined, "/projects/rc_project/customers/customer_A/aliases") {
		t.Fatalf("resource graph:\n%s", joined)
	}
}

func TestMigrationPullSinglePageResumesAfterTerminalCustomer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v2/projects/rc_project/customers":
			_, _ = w.Write([]byte(`{"items":[{"id":"only_customer","updated_at":3000}],"next_page":""}`))
		case r.URL.Path == "/v2/projects/rc_project/customers/only_customer/subscriptions",
			r.URL.Path == "/v2/projects/rc_project/customers/only_customer/aliases",
			r.URL.Path == "/v2/projects/rc_project/products":
			_, _ = w.Write([]byte(`{"items":[],"next_page":""}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client, err := New(Config{BaseURL: server.URL + "/v2", RequestTimeout: time.Second, OperationTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.PullMigrationEvidence(context.Background(), "rc_project", []byte("secret"), "", &bytes.Buffer{})
	if err != nil {
		t.Fatal(err)
	}
	if result.ResumeCursor != "only_customer" {
		t.Fatalf("resume cursor = %q", result.ResumeCursor)
	}
}

func TestMigrationPullRejectsMalformedCustomerIdentity(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"items":[{"id":"bad\ncustomer"}],"next_page":""}`))
	}))
	defer server.Close()
	client, err := New(Config{BaseURL: server.URL + "/v2", RequestTimeout: time.Second, OperationTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = client.PullMigrationEvidence(context.Background(), "rc_project", []byte("secret"), "", &bytes.Buffer{}); err == nil {
		t.Fatal("malformed source identifier was accepted")
	}
}
