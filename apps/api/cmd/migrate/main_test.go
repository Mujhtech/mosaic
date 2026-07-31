package main

import (
	"reflect"
	"testing"
)

// The failed-migration recovery runbook tells an operator to run
// `migrate down-to <version> --confirm`. That exact form used to fail with
// "down-to requires a target version", because the version and the flag both
// landed in the positional list: the documented recovery path could not be
// followed at the moment an operator most needs it. This pins every documented
// argument order, including a flag whose value is a separate argument.
func TestSplitArgumentsAcceptsEveryDocumentedForm(t *testing.T) {
	for name, testCase := range map[string]struct {
		arguments  []string
		action     string
		flags      []string
		positional []string
	}{
		"destructive rollback to a target": {
			[]string{"down-to", "17", "--confirm"}, "down-to", []string{"--confirm"}, []string{"17"},
		},
		"flags before the subcommand": {
			[]string{"--confirm", "down"}, "down", []string{"--confirm"}, []string{},
		},
		"target with a separate flag value": {
			[]string{"up-to", "18", "--timeout", "30m"}, "up-to", []string{"--timeout", "30m"}, []string{"18"},
		},
		"target with an inline flag value": {
			[]string{"up-to", "18", "--timeout=30m"}, "up-to", []string{"--timeout=30m"}, []string{"18"},
		},
		"a flag value must never become the subcommand": {
			[]string{"--timeout", "30m", "up"}, "up", []string{"--timeout", "30m"}, []string{},
		},
		"plain subcommand": {
			[]string{"preflight"}, "preflight", []string{}, []string{},
		},
	} {
		t.Run(name, func(t *testing.T) {
			action, flags, positional := splitArguments(testCase.arguments)
			if action != testCase.action {
				t.Errorf("action = %q, want %q", action, testCase.action)
			}
			if !reflect.DeepEqual(flags, testCase.flags) {
				t.Errorf("flags = %#v, want %#v", flags, testCase.flags)
			}
			if !reflect.DeepEqual(positional, testCase.positional) {
				t.Errorf("positional = %#v, want %#v", positional, testCase.positional)
			}
		})
	}
}
