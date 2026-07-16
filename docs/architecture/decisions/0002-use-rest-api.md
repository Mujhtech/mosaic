# ADR-0002: Use REST APIs Throughout

## Status

Accepted

## Date

2026-07-16

## Context

Mosaic needs APIs for its dashboard, SDKs, CLI, and public integrations.

The system should remain easy to inspect, document, self-host, and consume from Dart, Swift, Kotlin, TypeScript, Go, and curl.

## Decision

Use REST and JSON for:

- dashboard APIs
- SDK APIs
- public APIs
- trusted server APIs

Use WebSockets only for live preview and related real-time workflows.

## Consequences

### Benefits

- broad client compatibility
- simple debugging
- simple self-hosting
- easy OpenAPI documentation
- low contributor tooling overhead

### Trade-offs

- contracts require disciplined schema management
- streaming is not native to normal REST requests
- generated clients may be less strict than Protobuf clients

## Alternatives Considered

- gRPC
- ConnectRPC
- GraphQL

These may be reconsidered only if a measurable need emerges.

---
