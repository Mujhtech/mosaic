# Testing Conventions

## Testing Pyramid

Use:

- unit tests for isolated rules
- integration tests for repositories and boundaries
- end-to-end tests for critical user journeys
- visual tests for SDK renderers
- conformance tests for protocol compatibility

## Required Journey

The system must eventually test:

```text
Create paywall
→ edit draft
→ validate
→ publish
→ fetch
→ cache
→ render
→ purchase
→ emit events
→ view analytics
→ rollback
```

## Protocol Tests

Test:

- valid documents
- invalid documents
- unknown components
- unknown fields
- schema-version handling
- compatibility fallbacks
- localization
- product interpolation

## Backend Tests

Test:

- handlers using `httptest`
- application services independently
- repositories against PostgreSQL
- authorization
- error mapping
- publishing atomicity
- event idempotency

## Frontend Tests

Test:

- user-visible behaviour
- validation
- loading states
- error states
- permissions
- editor history
- autosave
- query invalidation
- keyboard accessibility

## SDK Tests

Test all common fixtures across Flutter, iOS, and Android.

Visual output may use platform-specific baselines while preserving the same semantic contract.
