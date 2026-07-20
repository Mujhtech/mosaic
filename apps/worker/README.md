# Mosaic worker

Phase 3A does not require a background job, so no placeholder worker process is
started.

The API is currently an application-local Go module at `apps/api`. Before the
first real background job is added, the owner must decide where
shared Go application and domain packages live so the API and worker can reuse
them without duplicate code. No root `go.work`, shared module, queue, Redis
dependency, or placeholder process is introduced by this foundation.
