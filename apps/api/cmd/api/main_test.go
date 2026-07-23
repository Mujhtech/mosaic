package main

import (
	"os"
	"strings"
	"testing"
)

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
