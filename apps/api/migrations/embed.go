// Package migrations owns Mosaic's versioned SQL schema migrations.
package migrations

import (
	"embed"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// Files contains the versioned SQL migrations used by the explicit migration command.
//
//go:embed *.sql
var Files embed.FS

// Versions lists every embedded migration version in ascending order.
func Versions() ([]int64, error) {
	entries, err := Files.ReadDir(".")
	if err != nil {
		return nil, fmt.Errorf("read embedded migrations: %w", err)
	}
	versions := make([]int64, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		prefix, _, found := strings.Cut(entry.Name(), "_")
		if !found {
			return nil, fmt.Errorf("migration %q does not start with a version prefix", entry.Name())
		}
		version, err := strconv.ParseInt(prefix, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("migration %q has a non-numeric version prefix", entry.Name())
		}
		versions = append(versions, version)
	}
	sort.Slice(versions, func(i, j int) bool { return versions[i] < versions[j] })
	return versions, nil
}

// ExpectedVersion is the highest migration version this binary ships with. The
// API refuses readiness when the database is behind it, and the migrate
// preflight compares it against the applied version.
func ExpectedVersion() (int64, error) {
	versions, err := Versions()
	if err != nil {
		return 0, err
	}
	if len(versions) == 0 {
		return 0, fmt.Errorf("no embedded migrations found")
	}
	return versions[len(versions)-1], nil
}
