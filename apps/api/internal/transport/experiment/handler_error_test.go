package experimenthttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Mujhtech/mosaic/apps/api/internal/experiment"
)

// Publishing an Experiment requires the Environment's current Configuration
// Release to carry a Placement Decision representation, i.e. a published
// Placement rule set. That prerequisite used to surface as a generic
// `422 experiment_invalid` with no detail, which sent operators to inspect the
// Experiment instead of the Environment. It must be its own code and must state
// what to do.
func TestPlacementDecisionPrerequisiteIsNamedAndActionable(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/publish", nil)

	writeError(recorder, request, experiment.ErrPlacementDecisionRequired)

	if recorder.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 (body %s)", recorder.Code, recorder.Body.String())
	}
	body := recorder.Body.String()
	if !strings.Contains(body, `"code":"experiment_placement_decision_required"`) {
		t.Fatalf("body = %s, want the dedicated prerequisite code", body)
	}
	// The message must name the action, not merely restate the failure.
	if !strings.Contains(body, "Placement rule set") {
		t.Fatalf("body = %s, want a message naming the prerequisite", body)
	}
}
