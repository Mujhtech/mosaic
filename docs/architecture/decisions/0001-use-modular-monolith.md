# ADR-0001: Use a Modular Monolith

## Status

Accepted

## Date

2026-07-16

## Context

Mosaic contains several domains, but the initial team and product do not require independently deployed services.

Starting with microservices would add network boundaries, deployment complexity, distributed tracing requirements, failure modes, and operational cost before they solve a measured problem.

## Decision

Mosaic will begin as a modular monolith.

Domain boundaries will be represented through Go packages and application interfaces.

The API and background worker may run as separate processes while sharing domain packages.

## Consequences

### Benefits

- simpler development
- simpler deployment
- easier transactions
- easier debugging
- lower operational cost
- clear path to vertical slices

### Trade-offs

- modules share one codebase
- extraction requires discipline
- poor boundaries could produce coupling

## Alternatives Considered

- microservices
- serverless functions
- independently deployed domain services

## These were rejected for the initial release because their complexity is not yet justified.
