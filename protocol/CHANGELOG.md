# Protocol changelog

All notable changes to the Mosaic protocol are recorded here. Versioned schema,
fixture, and compatibility artifacts remain drafts until their review gate is
approved.

## 0.1 - 2026-07-16

Status: draft

- Added the initial paywall document schema.
- Added the compatibility manifest and strict reader policy.
- Added the canonical minimal vertical paywall fixture.
- Added schema, semantic-contract, formatting, and invalid-input checks.
- Documented component semantics, SDK consumption, and exact version handling.
- Bounded `revision` to the inclusive range 1 through 2,147,483,647 while
  retaining JSON Schema's mathematical integer semantics.
