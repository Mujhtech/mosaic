# ADR-0009: Use Ozzo Validation

## Status

Accepted

## Date

2026-07-16

## Context

Mosaic requires reusable, readable request validation for Go REST endpoints.

Validation should remain separate from HTTP rendering and database-dependent business rules.

## Decision

Use `github.com/go-ozzo/ozzo-validation/v4` for transport-level validation.

Request DTOs may expose a `Validate` method.

Database-dependent and domain-dependent validation remains in application or domain services.

## Consequences

### Benefits

- readable validation rules
- reusable request validation
- structured field errors
- support for custom rules

### Trade-offs

- another dependency
- field-error conversion must be standardized
- developers must preserve the transport/domain boundary

## Alternatives Considered

- go-playground/validator
- handwritten validation
- schema-only validation

---
