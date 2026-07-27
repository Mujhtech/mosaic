package cloudworkspacepostgres

import "testing"

// Audit history is immutable, so a reader that cannot decode what a writer
// stored breaks the trail permanently. The Experiment writers record numbers
// (`revision`) and booleans (`valid`) in audit metadata while AuditEvent
// declares map[string]string, which made
// GET /v1/organizations/{id}/audit-events return 500 for the whole
// Organization from the first Experiment action onward. This pins the lenient
// decode that makes already-written history readable.
func TestAuditMetadataDecodesValuesWritersActuallyStore(t *testing.T) {
	for name, testCase := range map[string]struct {
		stored string
		want   map[string]string
	}{
		"experiment draft update writes a number and a boolean": {
			`{"valid":true,"revision":7}`, map[string]string{"valid": "true", "revision": "7"},
		},
		"experiment publish writes mixed scalars": {
			`{"releaseId":"release_000004","sourceRevision":7}`,
			map[string]string{"releaseId": "release_000004", "sourceRevision": "7"},
		},
		"plain string metadata is unchanged": {
			`{"releaseNumber":"3"}`, map[string]string{"releaseNumber": "3"},
		},
		"structured values are kept as JSON text rather than dropped": {
			`{"blockers":["a","b"]}`, map[string]string{"blockers": `["a","b"]`},
		},
		"null metadata":  {`null`, nil},
		"empty metadata": {``, nil},
	} {
		t.Run(name, func(t *testing.T) {
			got, err := decodeAuditMetadata([]byte(testCase.stored))
			if err != nil {
				t.Fatalf("decode %s: %v", testCase.stored, err)
			}
			if len(got) != len(testCase.want) {
				t.Fatalf("decoded %#v, want %#v", got, testCase.want)
			}
			for key, want := range testCase.want {
				if got[key] != want {
					t.Errorf("metadata[%q] = %q, want %q", key, got[key], want)
				}
			}
		})
	}
}
