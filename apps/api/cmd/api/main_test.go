package main

import (
	"os"
	"strings"
	"testing"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/config"
)

func TestRepairExecutionRequiresBillingAndMigrationOptIn(t *testing.T) {
	for _, test := range []struct {
		billing, migration, want bool
	}{
		{billing: false, migration: false, want: false},
		{billing: true, migration: false, want: false},
		{billing: false, migration: true, want: false},
		{billing: true, migration: true, want: true},
	} {
		cfg := config.Config{}
		cfg.Billing.Enabled = test.billing
		cfg.Migration.Enabled = test.migration
		if got := repairExecutionEnabled(cfg); got != test.want {
			t.Fatalf("billing=%v migration=%v enabled=%v want=%v", test.billing, test.migration, got, test.want)
		}
	}
}

func TestProductionWiringUsesPostgreSQLOnly(t *testing.T) {
	source, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	for _, required := range []string{"cloudworkspacepostgres.New", "browserauthpostgres.New", "hostedpublishingpostgres.New", "authn.NewBrowserSessionResolver", "hostedpublishing.CompileProtocolValidator", "objectstoreminio.New"} {
		if !strings.Contains(text, required) {
			t.Fatalf("production API does not compose %s", required)
		}
	}
	for _, forbidden := range []string{"cloudworkspacememory", "AnonymousResolver"} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("production API still composes forbidden fallback %s", forbidden)
		}
	}
}
