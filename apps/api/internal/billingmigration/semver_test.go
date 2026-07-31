package billingmigration

import "testing"

func TestSemanticVersionV1RangeUsesPrecedenceNotLexicalOrder(t *testing.T) {
	tests := []struct {
		value, min, max string
		want            bool
	}{
		{"2.10.0", "2.9.9", "2.10.1", true},
		{"2.9.9", "2.10.0", "3.0.0", false},
		{"2.10.0-rc.1", "2.10.0-rc.0", "2.10.0", true},
		{"2.10.0+build.9", "2.10.0+build.1", "2.10.0+build.2", true},
		{"2.10.0-rc.1+build.9", "2.10.0", "3.0.0", false},
		{"184467440737095516160.1.0", "184467440737095516159.9.9", "184467440737095516161", true},
	}
	for _, test := range tests {
		got, err := SemanticVersionInRange(test.value, test.min, test.max)
		if err != nil || got != test.want {
			t.Fatalf("%s in [%s,%s]=%v err=%v", test.value, test.min, test.max, got, err)
		}
	}
	for _, invalid := range []string{"02.1.0", "1.0.0-01", "1.0.0+", "1.2.3.4"} {
		if _, err := parseSemanticVersion(invalid); err == nil {
			t.Fatalf("accepted invalid semantic version %q", invalid)
		}
	}
}
