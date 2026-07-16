# Mosaic Roadmap

## Phase 0: Foundation

### Objectives

- establish the monorepo
- document architecture
- define the first protocol version
- scaffold the backend and dashboard
- scaffold Flutter, iOS, and Android SDKs

### Exit criteria

- repository setup is documented
- backend health endpoint works
- dashboard shell runs
- one fixture decodes in Dart, Swift, and Kotlin
- architectural decisions are recorded

## Phase 1: Cross-Platform Local Renderer

### Objectives

- prove one protocol can drive three native renderers
- support a minimal usable paywall

### Components

- scroll container
- stack
- text
- image
- feature list
- product selector
- purchase button
- restore button
- close button
- legal text

### Exit criteria

- one fixture renders in Flutter, SwiftUI, and Compose
- mock purchase states work
- bundled fallback works
- accessibility checks pass
- long localization and RTL fixtures work

## Phase 2: Studio and Local Preview

### Objectives

- build a constrained block editor
- preview edits on running native applications

### Deliverables

- template selection
- component tree
- property inspector
- theme controls
- localization
- product binding
- validation
- undo and redo
- autosave
- WebSocket preview
- mock product states

### Exit criteria

- edits update all three example apps
- invalid documents cannot be published
- preview clients report capabilities
- import and export work

## Phase 3: Hosted Publishing

### Objectives

- support projects, environments, versions, releases, and remote configuration

### Deliverables

- organizations
- projects
- environments
- public SDK keys
- drafts
- immutable versions
- publishing
- rollback
- configuration delivery
- caching
- assets

### Exit criteria

- apps fetch and cache configuration
- rollback produces a new release
- staging and production are isolated
- an outage does not block cached rendering

## Phase 4: Billing Adapters

### Deliverables

- RevenueCat adapter
- StoreKit 2 adapter
- Google Play Billing adapter
- custom provider interfaces
- entitlement checks
- restore flows
- normalized product models

### Exit criteria

- sandbox purchases work on iOS and Android
- RevenueCat integration works
- localized pricing is correct
- unavailable products fail safely

## Phase 5: Placements and Targeting

### Deliverables

- named placements
- rule evaluation
- platform targeting
- locale targeting
- app-version targeting
- user attributes
- percentage rollout
- fallback behaviour

### Exit criteria

- applications reference placement names
- matching is deterministic
- nonmatching users continue safely
- rule decisions are debuggable

## Phase 6: Analytics

### Deliverables

- event batching
- ingestion
- retry handling
- event dashboard
- placement metrics
- paywall metrics
- version comparisons
- platform breakdowns

### Exit criteria

- event delivery does not block UI
- conversion funnels are visible
- historical versions remain attributable

## Phase 7: Experiments

### Deliverables

- control and variants
- deterministic assignment
- weighted allocation
- exposure tracking
- QA overrides
- pause and resume
- result reporting

### Exit criteria

- assignment remains stable
- variants remain immutable
- exposure occurs only after presentation
- data can be exported

## Phase 8: Self-Hosting and Public Alpha

### Deliverables

- Docker Compose deployment
- migrations
- storage configuration
- administrator bootstrap
- upgrade documentation
- backup documentation
- security guide
- public documentation

### Exit criteria

Running:

```bash
docker compose up
```

starts a complete usable Mosaic installation.

---
