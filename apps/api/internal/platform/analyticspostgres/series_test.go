package analyticspostgres

import (
	"testing"

	"github.com/Mujhtech/mosaic/apps/api/internal/analytics"
)

// The domain's series vocabulary and this adapter's SQL expression tables are
// two descriptions of the same aggregates, and they drift silently: a metric
// added to the SQL alone is invisible to the series endpoint, while a metric
// marked dimensioned in the domain but missing from dailyEventExpressions makes
// a filtered request fail at the database instead of at validation. Neither
// shows up in a compile.
func TestSeriesVocabularyMatchesTheSQLExpressions(t *testing.T) {
	for _, id := range analytics.SeriesMetricIDs() {
		spec, _ := analytics.SeriesMetricSpecFor(id)
		if _, ok := metricDefinitions[id]; !ok {
			t.Errorf("metric %q is in the series vocabulary but has no SQL definition", id)
		}
		if _, ok := dailyEventExpressions[id]; ok != spec.Dimensioned {
			t.Errorf("metric %q: Dimensioned=%v but dimensioned expression present=%v", id, spec.Dimensioned, ok)
		}
	}
	for id := range metricDefinitions {
		if _, ok := analytics.SeriesMetricSpecFor(id); !ok {
			t.Errorf("metric %q has a SQL definition but is missing from the series vocabulary", id)
		}
	}
	for id := range dailyEventExpressions {
		if _, ok := metricDefinitions[id]; !ok {
			t.Errorf("metric %q has a dimensioned expression but is not a defined metric", id)
		}
	}
}
