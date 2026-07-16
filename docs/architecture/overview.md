# Mosaic Architecture Overview

## Architectural Style

Mosaic begins as a modular monolith.

The system is divided by domain boundaries while remaining deployable as a small number of processes:

- API
- background worker
- dashboard
- SDK configuration delivery
- object storage
- PostgreSQL
- optional Redis

This reduces operational complexity while preserving clear module boundaries.

## System Diagram

```text
TanStack Start Dashboard
          |
          | REST
          v
       Go API
          |
          +--------------------+
          |                    |
          v                    v
     PostgreSQL          Object Storage
          |
          v
  Configuration Releases
          |
          v
        CDN/API
          |
          +-----------------------------+
          |              |              |
          v              v              v
      Flutter         SwiftUI        Compose
```

Live Studio preview uses WebSockets.

All normal dashboard, SDK, and public integrations use REST.

## Core Domains

The initial backend domains are:

- organizations
- members
- projects
- environments
- API keys
- assets
- paywalls
- drafts
- versions
- placements
- publishing
- configuration releases
- identities
- events
- experiments
- webhooks
- audit logs

## Backend Layers

```text
HTTP transport
    ↓
Application services
    ↓
Domain rules
    ↓
Repositories
    ↓
PostgreSQL and infrastructure
```

HTTP handlers must not contain business logic.

Repositories must not decide HTTP status codes.

Domain packages must not depend on Chi, HTTP request types, or JSON rendering.

## Public Interfaces

### Dashboard API

Used by Mosaic Studio and account-management interfaces.

### SDK API

Used by Flutter, iOS, and Android SDKs for:

- configuration
- event ingestion
- identity
- capability reporting

### Public server API

Used by trusted server-side integrations.

### WebSocket preview

Used only for local or live preview interactions.

## Protocol

The Mosaic protocol is defined independently of platform implementations.

The protocol owns:

- components
- layout semantics
- design tokens
- product references
- localization
- actions
- visibility conditions
- compatibility metadata
- accessibility metadata

The protocol does not contain executable remote code.

## Configuration Lifecycle

```text
Draft
  ↓
Schema validation
  ↓
Business validation
  ↓
Compatibility validation
  ↓
Immutable paywall version
  ↓
Configuration release
  ↓
SDK delivery
```

Published versions and releases are immutable.

## SDK Resilience

Configuration resolution follows:

1. valid remote configuration
2. cached configuration
3. bundled fallback
4. unavailable result

Analytics or configuration-network failures must not crash applications or block a purchase flow.

---
