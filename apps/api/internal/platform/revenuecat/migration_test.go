package revenuecat

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
)

func TestAssessMigrationEarnsReadOnlyMigrationCapabilities(t *testing.T) {
	var mu sync.Mutex
	requests := make([]string, 0)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		mu.Lock()
		requests = append(requests, request.URL.RequestURI())
		mu.Unlock()
		if request.Header.Get("Authorization") != "Bearer migration-secret" {
			t.Fatal("migration credential was not sent as bearer authentication")
		}
		w.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/v2/projects/rc_project/customers":
			if request.URL.Query().Get("limit") != "1" {
				t.Fatalf("customer limit = %q", request.URL.Query().Get("limit"))
			}
			if request.URL.Query().Get("starting_after") == "customer_cursor" {
				_, _ = w.Write([]byte(`{"items":[{"id":"customer_next"}],"next_page":""}`))
				return
			}
			if request.URL.Query().Get("starting_after") != "" {
				t.Fatalf("unexpected customer cursor = %q", request.URL.Query().Get("starting_after"))
			}
			_, _ = w.Write([]byte(`{"items":[{"id":"customer_A"}],"next_page":"https://api.revenuecat.com/v2/projects/other/customers?starting_after=customer_cursor"}`))
		case "/v2/projects/rc_project/customers/customer_A/subscriptions",
			"/v2/projects/rc_project/customers/customer_A/aliases":
			if request.URL.Query().Get("limit") != "1" {
				t.Fatalf("nested limit = %q", request.URL.Query().Get("limit"))
			}
			_, _ = w.Write([]byte(`{"items":[],"next_page":""}`))
		default:
			http.NotFound(w, request)
		}
	}))
	defer server.Close()
	client := migrationAssessmentClient(t, server)
	assessedAt := time.Date(2026, time.July, 29, 12, 0, 0, 0, time.UTC)
	client.now = func() time.Time { return assessedAt }
	result, err := client.AssessMigration(context.Background(), "rc_project", []byte("migration-secret"))
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"read_customers", "read_subscriptions", "read_aliases", "incremental_delta"}
	if result.ProviderAPIVersion != billingmigration.ProviderAPIV2 || result.AssessedAt != assessedAt || strings.Join(result.Capabilities, ",") != strings.Join(want, ",") {
		t.Fatalf("assessment = %#v", result)
	}
	mu.Lock()
	defer mu.Unlock()
	joined := strings.Join(requests, "\n")
	if strings.Contains(joined, "transfers") || strings.Contains(joined, "/v2/customers/") ||
		!strings.Contains(joined, "/projects/rc_project/customers/customer_A/subscriptions?limit=1") ||
		!strings.Contains(joined, "/projects/rc_project/customers/customer_A/aliases?limit=1") ||
		!strings.Contains(joined, "/projects/rc_project/customers?limit=1&starting_after=customer_cursor") {
		t.Fatalf("assessment used wrong resource graph:\n%s", joined)
	}
}

func TestAssessMigrationPermissionFailuresFailClosedPerProbe(t *testing.T) {
	tests := []struct {
		name             string
		deniedPath       string
		deniedQuery      string
		wantErr          error
		wantCapabilities []string
	}{
		{
			name:        "customers",
			deniedPath:  "/v2/projects/rc_project/customers",
			wantErr:     billingmigration.ErrInvalid,
			deniedQuery: "limit=1",
		},
		{
			name:             "subscriptions",
			deniedPath:       "/v2/projects/rc_project/customers/customer_A/subscriptions",
			wantCapabilities: []string{"read_customers", "read_aliases", "incremental_delta"},
		},
		{
			name:             "aliases",
			deniedPath:       "/v2/projects/rc_project/customers/customer_A/aliases",
			wantCapabilities: []string{"read_customers", "read_subscriptions", "incremental_delta"},
		},
		{
			name:             "delta cursor",
			deniedPath:       "/v2/projects/rc_project/customers",
			deniedQuery:      "limit=1&starting_after=customer_A",
			wantCapabilities: []string{"read_customers", "read_subscriptions", "read_aliases"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if request.URL.Path == tt.deniedPath && (tt.deniedQuery == "" || request.URL.RawQuery == tt.deniedQuery) {
					w.WriteHeader(http.StatusForbidden)
					_, _ = w.Write([]byte(`{"message":"denied"}`))
					return
				}
				switch request.URL.Path {
				case "/v2/projects/rc_project/customers":
					_, _ = w.Write([]byte(`{"items":[{"id":"customer_A"}],"next_page":""}`))
				case "/v2/projects/rc_project/customers/customer_A/subscriptions",
					"/v2/projects/rc_project/customers/customer_A/aliases":
					_, _ = w.Write([]byte(`{"items":[],"next_page":""}`))
				default:
					http.NotFound(w, request)
				}
			}))
			defer server.Close()
			client := migrationAssessmentClient(t, server)
			result, err := client.AssessMigration(context.Background(), "rc_project", []byte("migration-secret"))
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("error = %v, want %v", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if strings.Join(result.Capabilities, ",") != strings.Join(tt.wantCapabilities, ",") {
				t.Fatalf("capabilities = %#v", result.Capabilities)
			}
		})
	}
}

func TestAssessMigrationEmptyProjectDoesNotInventCustomerScopedCapabilities(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		requests++
		if request.URL.Path != "/v2/projects/rc_project/customers" {
			t.Fatalf("unexpected path for empty assessment: %s", request.URL.RequestURI())
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[],"next_page":""}`))
	}))
	defer server.Close()
	client := migrationAssessmentClient(t, server)
	result, err := client.AssessMigration(context.Background(), "rc_project", []byte("migration-secret"))
	if err != nil {
		t.Fatal(err)
	}
	if requests != 1 || strings.Join(result.Capabilities, ",") != "read_customers" {
		t.Fatalf("empty assessment requests=%d result=%#v", requests, result)
	}
}

func TestAssessMigrationDoesNotOverclaimDeltaOnMalformedCursor(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v2/projects/rc_project/customers" {
			http.NotFound(w, request)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"id":"customer_A"}],"next_page":"https://api.revenuecat.com/v2/projects/rc_project/customers"}`))
	}))
	defer server.Close()
	client := migrationAssessmentClient(t, server)
	if _, err := client.AssessMigration(context.Background(), "rc_project", []byte("migration-secret")); !errors.Is(err, billingmigration.ErrUnavailable) {
		t.Fatalf("malformed cursor error = %v", err)
	}
}

func migrationAssessmentClient(t *testing.T, server *httptest.Server) *Client {
	t.Helper()
	client, err := New(Config{BaseURL: server.URL + "/v2", RequestTimeout: time.Second, OperationTimeout: time.Second, MaxAttempts: 1})
	if err != nil {
		t.Fatal(err)
	}
	return client
}
