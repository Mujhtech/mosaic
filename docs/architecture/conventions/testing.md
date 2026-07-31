# Testing Conventions

## Purpose

Mosaic uses tests to protect important behaviour and reduce meaningful product and operational risk.

The goal is not maximum test count or maximum line coverage.

The goal is the smallest maintainable set of tests that gives confidence in critical behaviour.

## Minimum Sufficient Testing

Every proposed test must map to a specific risk.

A useful test protects at least one of:

- observable user behaviour
- domain rules
- authorization
- security
- data integrity
- state transitions
- API or protocol compatibility
- persistence
- transaction boundaries
- idempotency
- failure recovery
- regressions
- critical accessibility behaviour

Do not add a test when the only justification is:

- “this code is new”
- “this function has no test”
- “coverage decreased”
- “other files have matching test files”
- “we may need it later”

## Test Selection

Prefer the lowest-cost test that reliably catches the failure.

### Unit tests

Use for:

- domain invariants
- deterministic transformations
- rule evaluation
- validation owned by Mosaic
- state machines
- error classification
- compatibility decisions

### Integration tests

Use for:

- HTTP contracts
- PostgreSQL constraints and transactions
- repository behaviour
- authorization boundaries
- API-key handling
- storage
- WebSocket message flow
- persistence and restoration
- migration behaviour

### End-to-end tests

Use only for critical journeys that cannot be proven adequately at lower layers.

Examples:

- create a Product, grant an Entitlement, and inspect usage
- publish a release and retrieve it through an SDK endpoint
- complete the primary Studio editing journey
- purchase through a provider adapter and return a normalized result

Do not create an end-to-end test for every feature variation.

## Tests That Usually Do Not Add Value

Avoid tests for:

- trivial getters and setters
- constants
- static configuration values
- generated models and generated clients
- framework routing mechanics
- third-party component internals
- shadcn component behaviour that Mosaic has not changed
- Base UI internals
- TanStack Query internals
- Chi internals
- standard-library behaviour
- exact private method calls
- implementation-specific component trees
- duplicated happy paths across unit, integration, and end-to-end layers
- snapshots with no reviewed behavioural or visual contract

## Third-Party Components

Test Mosaic’s integration with a third-party component, not the component library itself.

For example, for shadcn `Resizable`, meaningful Mosaic tests include:

- persisted workspace layout is restored
- malformed saved layout falls back safely
- workspace state is excluded from exported paywall JSON
- resizing does not modify the paywall document
- resizing does not create editor undo-history entries
- compact layouts preserve a usable canvas

Do not recreate tests for the underlying library’s:

- pointer calculations
- minimum-size algorithm
- maximum-size algorithm
- separator implementation
- generic keyboard resizing

unless Mosaic has changed, wrapped, or broken that behaviour in a way that creates project-owned risk.

## Regression Tests

Add a regression test when fixing a defect if:

- the defect could realistically return
- the test catches the defect through stable behaviour
- the test is not tightly coupled to the old implementation

Do not add a regression test for a one-off environmental failure that cannot be reproduced reliably.

## Coverage

Coverage is a diagnostic signal, not an acceptance target.

Do not:

- chase a global percentage
- add low-value tests to increase coverage
- reject a change solely because line coverage decreased

Investigate uncovered critical behaviour rather than uncovered lines.

## New Test Infrastructure

Do not add a new:

- test runner
- browser automation system
- snapshot framework
- mock framework
- test database abstraction
- suite directory
- CI test job

unless existing infrastructure cannot verify a required acceptance criterion.

A proposal for new test infrastructure must document:

- the missing capability
- the critical acceptance criterion it enables
- alternatives considered
- ongoing maintenance cost
- expected execution cost
- owner approval

## Review Requirements

A reviewer must not request “more tests” without identifying:

- the uncovered behaviour
- the failure mode
- the product or engineering risk
- the appropriate test layer

“Add more coverage” is not an actionable review finding.

## Agent Completion Report

Agents must report:

- each test added
- the behaviour it protects
- the failure it detects
- why that test layer was selected
- existing tests reused or modified
- tests deliberately omitted
- commands run
- unavailable checks