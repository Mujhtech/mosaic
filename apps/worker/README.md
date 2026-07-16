# Mosaic worker

Phase 0 does not start a worker process because there are no background jobs or
product domains yet.

The API is currently an application-local Go module at `apps/api`. Before the
first real background job is added, the Phase 0 review gate must decide where
shared Go application and domain packages live so the API and worker can reuse
them without duplicate code. No root `go.work`, shared module, queue, Redis
dependency, or placeholder process is introduced by this foundation.
