// Package buildinfo carries the release identity stamped into Mosaic binaries
// at build time so operators can tell exactly which artifact is running.
//
// Values are set with -ldflags at image build time, for example:
//
//	go build -ldflags "-X github.com/Mujhtech/mosaic/apps/api/internal/platform/buildinfo.version=v1.0.0 \
//	                   -X github.com/Mujhtech/mosaic/apps/api/internal/platform/buildinfo.commit=abc1234"
package buildinfo

import (
	"runtime/debug"
	"strings"
)

var (
	version = ""
	commit  = ""
	date    = ""
)

// Info is the resolved build identity. It never contains credentials and is
// safe to expose on /health/live and as OpenTelemetry resource attributes.
type Info struct {
	Version string `json:"version"`
	Commit  string `json:"commit,omitempty"`
	Date    string `json:"date,omitempty"`
}

// Current resolves the stamped identity, falling back to Go module build
// metadata (available for `go install`ed binaries) and finally to "dev".
func Current() Info {
	info := Info{
		Version: strings.TrimSpace(version),
		Commit:  strings.TrimSpace(commit),
		Date:    strings.TrimSpace(date),
	}
	if info.Version == "" || info.Commit == "" {
		if build, ok := debug.ReadBuildInfo(); ok {
			if info.Version == "" && build.Main.Version != "" && build.Main.Version != "(devel)" {
				info.Version = build.Main.Version
			}
			for _, setting := range build.Settings {
				switch setting.Key {
				case "vcs.revision":
					if info.Commit == "" {
						info.Commit = setting.Value
					}
				case "vcs.time":
					if info.Date == "" {
						info.Date = setting.Value
					}
				}
			}
		}
	}
	if info.Version == "" {
		info.Version = "dev"
	}
	return info
}

// Version is a convenience accessor for the resolved version string.
func Version() string { return Current().Version }
