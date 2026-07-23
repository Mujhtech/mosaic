# ADR-0013: Use pgx and Goose for PostgreSQL Persistence

## Status

Accepted

## Date

2026-07-20

## Context

Mosaic requires durable relational storage for organizations, projects, environments, API keys, Plans, Products, Entitlements, publishing data, and later analytics and experiments.

An in-memory repository cannot provide persistence, constraints, transactions, migrations, recovery, or production readiness.

Mosaic targets PostgreSQL and does not require database portability.

## Decision

Use:

- PostgreSQL as the system of record
- `github.com/jackc/pgx/v5/pgxpool` for runtime database access
- `github.com/pressly/goose/v3` for versioned SQL migrations

Production API wiring must use PostgreSQL repositories.

In-memory repositories may exist only for tests or explicitly isolated mock programs.

The API must fail startup if its required PostgreSQL connection is unavailable.

Migrations run through an explicit migration command or deployment step rather than automatic API startup.

## Consequences

### Benefits

- durable storage
- foreign-key and uniqueness enforcement
- explicit schema history
- transactional application operations
- production-compatible repository behaviour
- reliable restart and recovery behaviour

### Trade-offs

- local development requires PostgreSQL
- repository integration tests require a database
- migrations require ongoing discipline
- deployment must run migrations safely

## Alternatives Considered

### In-memory repositories

Rejected for runtime use because data disappears on restart and database invariants are absent.

### SQLite

Rejected because Mosaic has selected PostgreSQL as its production database and does not currently require database portability.

### ORM-selected persistence

Deferred. Mosaic will not introduce an ORM without a separate decision demonstrating a concrete need.
