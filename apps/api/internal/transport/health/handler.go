// Package health exposes Mosaic's liveness and readiness probes.
//
// Liveness answers "is this process up" and reports the build identity so an
// operator can tell which artifact is serving. Readiness answers "should this
// instance receive traffic" by checking the dependencies Mosaic cannot serve
// without, and reports 503 while the process is draining.
package health

import (
	"context"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/buildinfo"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
)

// checkTimeout bounds every individual readiness probe so a hung dependency
// cannot hold the probe open past a load balancer's own timeout.
const checkTimeout = 3 * time.Second

// Checker is the single-dependency readiness contract.
type Checker interface{ Ping(context.Context) error }

// Check is one named readiness dependency. Code is a stable, safe diagnostic
// identifier reported to operators; it must never embed configuration values.
//
// DependsOn names another Check this one cannot be evaluated without. When that
// prerequisite fails, this check is skipped rather than reported: the migration
// probe needs PostgreSQL, so reporting `migration_incompatible` while the
// database is simply down sends an operator to diagnose a schema problem that
// does not exist. Readiness still fails — on the dependency that actually broke.
type Check struct {
	Name      string
	Code      string
	DependsOn string
	Probe     func(context.Context) error
}

// Readiness aggregates readiness dependencies and the draining flag.
type Readiness struct {
	checks   []Check
	draining atomic.Bool
}

func NewReadiness(checks ...Check) *Readiness {
	return &Readiness{checks: checks}
}

// StartDraining flips readiness to 503 before the HTTP server begins its
// graceful shutdown so load balancers stop sending new work.
func (r *Readiness) StartDraining() {
	if r != nil {
		r.draining.Store(true)
	}
}

func (r *Readiness) Draining() bool { return r != nil && r.draining.Load() }

// Evaluate runs every check and returns the failing dependency codes.
func (r *Readiness) Evaluate(ctx context.Context) []string {
	if r == nil {
		return nil
	}
	var failures []string
	failed := make(map[string]struct{}, len(r.checks))
	for _, check := range r.checks {
		if check.Probe == nil {
			continue
		}
		if check.DependsOn != "" {
			if _, broken := failed[check.DependsOn]; broken {
				zerolog.Ctx(ctx).Warn().
					Str("readiness_check", check.Name).
					Str("readiness_skipped_because", check.DependsOn).
					Msg("readiness dependency check skipped: a prerequisite is unavailable")
				continue
			}
		}
		probeContext, cancel := context.WithTimeout(ctx, checkTimeout)
		err := check.Probe(probeContext)
		cancel()
		if err != nil {
			zerolog.Ctx(ctx).Warn().
				Str("readiness_check", check.Name).
				Str("readiness_code", check.Code).
				Err(err).
				Msg("readiness dependency check failed")
			failed[check.Name] = struct{}{}
			failures = append(failures, check.Code)
		}
	}
	return failures
}

type livePayload struct {
	Status  string `json:"status"`
	Version string `json:"version"`
	Commit  string `json:"commit,omitempty"`
	Built   string `json:"built,omitempty"`
}

type readyPayload struct {
	Status  string `json:"status"`
	Version string `json:"version"`
}

func LiveRoutes() http.Handler {
	router := chi.NewRouter()
	router.Get("/", live)
	return router
}

// ReadyRoutes keeps the single-dependency probe used by callers that only need
// PostgreSQL readiness.
func ReadyRoutes(checker Checker) http.Handler {
	if checker == nil {
		return ReadinessRoutes(nil)
	}
	return ReadinessRoutes(NewReadiness(Check{
		Name: "postgresql", Code: "database_unavailable", Probe: checker.Ping,
	}))
}

func ReadinessRoutes(readiness *Readiness) http.Handler {
	router := chi.NewRouter()
	router.Get("/", func(w http.ResponseWriter, r *http.Request) {
		if readiness == nil {
			response.ServiceUnavailable(w, r, "not_ready", "A required dependency is unavailable.")
			return
		}
		if readiness.Draining() {
			response.ServiceUnavailableWithDetails(w, r, "draining",
				"The instance is shutting down and is no longer accepting traffic.",
				map[string]any{"checks": []string{"draining"}})
			return
		}
		if failures := readiness.Evaluate(r.Context()); len(failures) > 0 {
			response.ServiceUnavailableWithDetails(w, r, "not_ready",
				"A required dependency is unavailable.", map[string]any{"checks": failures})
			return
		}
		response.OK(w, r, readyPayload{Status: "ready", Version: buildinfo.Version()})
	})
	return router
}

func live(w http.ResponseWriter, r *http.Request) {
	build := buildinfo.Current()
	response.OK(w, r, livePayload{Status: "ok", Version: build.Version, Commit: build.Commit, Built: build.Date})
}
