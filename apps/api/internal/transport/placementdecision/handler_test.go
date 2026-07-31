package placementdecisionhttp

import (
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/placementdecision"
)

func TestArchiveRuleSetRouteContract(t *testing.T) {
	router := chi.NewRouter()
	RegisterProjectRoutes(router, nil)
	want := "/environments/{environmentId}/placements/{placementId}/rule-sets/{ruleSetId}/archive"
	found := false
	if err := chi.Walk(router, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if method == http.MethodPost && route == want {
			found = true
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatalf("POST %s is not registered", want)
	}
}

func TestSimulationRequestValidationUsesRequestOwnedFields(t *testing.T) {
	request := simulationRequest{
		Country:        "DE",
		Locale:         "en-DE",
		InstallationID: "install_01",
		Attributes: map[string]placementdecision.InputValue{
			"student": {Value: true, Valid: true, Source: "host_application"},
		},
	}
	if err := request.Validate(); err != nil {
		t.Fatalf("valid simulator request rejected: %v", err)
	}

	request.Country = "DEU"
	if err := request.Validate(); err == nil {
		t.Fatal("overlong explicit country accepted")
	}

	request.Country = "DE"
	request.Attributes["oversized"] = placementdecision.InputValue{
		Value:  strings.Repeat("x", 9<<10),
		Valid:  true,
		Source: "host_application",
	}
	if err := request.Validate(); err == nil {
		t.Fatal("oversized serialized attribute payload accepted")
	}
}
