# Mosaic Roadmap

## Phase 0: Foundation

### Objectives

- establish the monorepo
- document the product and architecture
- define the first protocol version
- scaffold the backend and dashboard
- scaffold Flutter, iOS, and Android SDKs
- establish project-wide agent instructions and conventions

### Deliverables

- root `AGENTS.md`
- product vision
- product principles
- agentic implementation plan
- architecture overview
- architecture decision records
- backend conventions
- frontend conventions
- protocol conventions
- SDK conventions
- testing conventions
- Go backend scaffold
- TanStack Start dashboard scaffold
- Flutter SDK scaffold
- Swift SDK scaffold
- Kotlin SDK scaffold
- Mosaic Protocol `0.1` draft
- initial shared protocol fixture
- local development commands
- Docker Compose foundation

### Dashboard foundation

Use:

- TanStack Start
- TypeScript
- Tailwind CSS
- shadcn/ui using Base UI
- TanStack Router
- TanStack Query
- TanStack Form
- `sidebar-07`
- `login-05`
- `signup-05`
- `@phosphor-icons/react`

Do not use:

- Radix UI
- Lucide as Mosaic’s application icon library

### Backend foundation

Use:

- Go
- modular monolith architecture
- REST APIs
- PostgreSQL
- Chi router
- Chi middleware
- Chi CORS
- Chi Render behind Mosaic response helpers
- Ozzo Validation
- `otelchi`
- OpenTelemetry
- Zerolog

### Exit criteria

- repository setup is documented
- backend starts and shuts down gracefully
- backend health endpoint works
- response and error helpers are tested
- dashboard shell runs
- dashboard uses Base UI and Phosphor icons
- one fixture validates successfully
- one fixture decodes in Dart, Swift, and Kotlin
- architectural decisions are recorded
- available repository checks pass
- unavailable checks are documented

### Review Gate 0

Phase 0 is classified as:

- Accepted
- Accepted with tracked follow-ups
- Rejected pending fixes

Phase 1 must not begin until Phase 0 is accepted.

---

## Phase 1: Cross-Platform Local Renderer

### Objectives

- prove one protocol can drive three native renderers
- support a minimal usable paywall
- establish equivalent behaviour across Flutter, SwiftUI, and Jetpack Compose

### Components

- scroll container
- vertical stack
- text
- image
- feature list
- product selector
- purchase button
- restore button
- close button
- legal text

Horizontal stack, arbitrary container, and spacer are deferred to a future
protocol version and compatibility review. They are not part of Protocol `0.1`
and must not be introduced implicitly during Phase 2.

### Protocol deliverables

- Mosaic Protocol `0.1 RC1`
- component properties
- layout semantics
- product references
- localization rules
- accessibility metadata
- actions
- compatibility metadata
- fallback behaviour
- normalized presentation results
- canonical complete paywall fixture

### SDK deliverables

#### Flutter

- native Flutter renderer
- canonical fixture decoding
- mock purchase provider
- product selection
- mock purchase outcomes
- restore handling
- close handling
- bundled fallback
- golden tests
- accessibility tests
- example app

#### iOS

- native SwiftUI renderer
- canonical fixture decoding
- mock purchase provider
- product selection
- mock purchase outcomes
- restore handling
- close handling
- bundled fallback
- snapshot tests
- VoiceOver checks
- Dynamic Type checks
- example app

#### Android

- native Jetpack Compose renderer
- canonical fixture decoding
- mock purchase provider
- product selection
- mock purchase outcomes
- restore handling
- close handling
- bundled fallback
- screenshot tests
- Compose UI tests
- TalkBack checks
- font-scaling checks
- example app

### Explicit exclusions

Do not implement:

- hosted configuration
- remote publishing
- Studio editing
- real RevenueCat integration
- StoreKit 2 integration
- Google Play Billing integration
- placements
- analytics ingestion
- experiments

### Exit criteria

- one fixture renders in Flutter, SwiftUI, and Compose
- all required components render on all three platforms
- mock purchase states work
- explicit presentation results work
- bundled fallback works
- accessibility checks pass
- long localization fixtures work
- RTL fixtures work
- unsupported content fails safely
- behavioural differences are documented

### Review Gate 1

Produce a cross-platform conformance matrix covering:

- fixture decoding
- component rendering
- product selection
- purchase success
- purchase cancellation
- purchase failure
- restore flow
- close flow
- bundled fallback
- accessibility
- long text
- RTL behaviour

The Phase 1 demo is:

> One Mosaic protocol document rendering natively and interactively in Flutter, SwiftUI, and Jetpack Compose.

---

## Phase 2: Studio and Local Preview

### Objectives

- build a constrained block editor
- preview edits on running native applications
- validate the Studio workflow before hosted infrastructure is introduced
- allow developers to build paywalls locally without an account or backend

### Deliverables

- template selection
- component tree
- component insertion
- component reordering
- drag and drop
- property inspector
- inline text editing
- theme controls
- localization editor
- product binding
- protocol validation
- compatibility warnings
- undo and redo
- local autosave
- local project files
- JSON import
- JSON export
- WebSocket preview
- mock product states
- connected-preview status
- preview diagnostics
- device previews
- accessibility-text preview
- long-localization preview
- RTL preview

### Local development workflow

Support:

```bash
mosaic dev
```

The local workflow should provide:

- local Studio
- local configuration server
- WebSocket preview server
- mock commerce controls
- event inspector
- connected-device information
- hot updates without rebuilding the app

### UX requirements

- the main workflow must be usable without external documentation
- the native preview should remain visible while editing
- empty states must provide a clear next action
- errors must provide a recovery action
- unsupported components must explain how to resolve the problem
- the editor must not expose unnecessary protocol internals
- the Studio must remain a constrained block editor rather than becoming a Figma replacement

### Explicit exclusions

Do not implement:

- organizations
- hosted projects
- cloud assets
- user accounts
- remote publishing
- CDN delivery
- real billing providers
- hosted analytics
- experiments

### Exit criteria

- edits update all three example apps
- invalid documents cannot be exported as valid configurations
- preview clients report capabilities
- import and export work
- undo and redo work
- autosave preserves local work
- mock product states can be switched
- a new user can build and preview a paywall without external documentation

### Review Gate 2

Review:

- information architecture
- navigation
- naming
- click count
- cognitive load
- empty states
- error recovery
- cross-platform preview consistency
- protocol compatibility

The Phase 2 demo is:

> Edit a paywall locally and see it update immediately in Flutter, iOS, and Android.

---

## Phase 2.5: Design System Freeze

### Objectives

- stabilize Mosaic’s dashboard and Studio design language
- establish shared interaction patterns before hosted publishing
- create a stable mapping between Studio controls, protocol tokens, and native SDK themes

### Deliverables

- semantic colour tokens
- typography tokens
- spacing scale
- radius scale
- border tokens
- elevation rules
- motion tokens
- animation guidelines
- Phosphor icon rules
- form patterns
- navigation patterns
- dialog patterns
- sheet patterns
- empty states
- loading states
- error states
- success states
- permission states
- responsive behaviour
- accessibility requirements
- Studio panel patterns
- protocol theme-token mapping
- native SDK token mapping

### Packages

Establish or finalize:

```text
packages/design-system
packages/design-tokens
```

### Exit criteria

- dashboard and Studio use stable semantic tokens
- shared component behaviour is documented
- Base UI usage is standardized
- no Radix UI dependency exists
- Lucide is absent from Mosaic application code
- protocol tokens map consistently to Flutter, SwiftUI, and Compose
- shared error, empty, loading, and permission states are reusable
- major interaction patterns have accessibility requirements

### Founder Review

Confirm:

- the product feels coherent
- implementation hierarchy is hidden from users
- primary workflows remain simple
- the design system supports Studio rather than restricting it
- the system is ready for hosted publishing workflows

---

## Phase 3: Hosted Publishing

### Objectives

- support organizations, projects, environments, versions, releases, and remote configuration
- allow paywalls to be updated without submitting a new application release
- preserve offline and cached rendering

### Deliverables

#### Accounts and workspace

- authentication
- login
- signup
- session management
- organizations
- members
- projects
- environments
- roles and permissions

#### Paywall management

- hosted drafts
- immutable paywall versions
- draft autosave
- revision conflict detection
- configuration releases
- publishing
- rollback
- version history

#### Infrastructure

- PostgreSQL persistence
- public SDK keys
- secret server keys
- S3-compatible asset storage
- asset upload
- asset validation
- configuration delivery
- ETag support
- compressed responses
- environment isolation
- caching
- bundled fallback support

#### SDK support

- remote configuration fetching
- local persistence
- cache validation
- retry behaviour
- short request timeouts
- configuration integrity checks
- capability reporting

### Publishing workflow

```text
Draft
→ Schema validation
→ Business validation
→ Compatibility validation
→ Immutable paywall version
→ Configuration release
→ Publish
→ SDK delivery
```

When a user edits a published paywall, Mosaic should automatically create a new draft.

The UI must not end with:

> This published version cannot be edited.

Instead, it should create a new editable draft from the published version.

### Exit criteria

- apps fetch and cache configuration
- hosted paywalls can be edited and published
- all three SDKs receive updated releases
- rollback produces a new release
- staging and production are isolated
- an outage does not block cached rendering
- bundled fallback works when no cache exists
- published versions remain immutable
- editing a published version creates a new draft automatically

### Review Gate 3

The Phase 3 demo is:

> Change a paywall, click Publish, and see it update across Flutter, iOS, and Android without an app release.

---

## Phase 4: Commerce Providers

### Objectives

- connect Mosaic paywalls to real purchase systems
- preserve provider independence
- allow existing RevenueCat users to adopt Mosaic without migration

### Deliverables

- provider-independent product model
- RevenueCat adapter
- StoreKit 2 adapter
- Google Play Billing adapter
- custom provider interfaces
- product loading
- localized pricing
- subscription periods
- introductory offers
- trial information
- entitlement checks
- purchase handling
- restore flows
- normalized purchase results
- normalized provider errors
- unavailable-product handling

### Product rules

Paywall configuration stores product identifiers, not formatted prices.

At runtime, SDKs resolve:

- localized price
- currency
- billing period
- trial duration
- introductory offer
- product availability

### Explicit exclusions

Do not implement:

- Mosaic receipt validation
- Mosaic subscription-state engine
- cross-platform entitlement backend
- Stripe billing infrastructure
- full revenue reporting

### Exit criteria

- sandbox purchases work on iOS
- test purchases work on Android
- RevenueCat integration works
- restore flows work
- localized pricing is correct
- unavailable products fail safely
- commerce failures provide useful diagnostics
- the renderer remains independent of any specific provider

### Review Gate 4

The Phase 4 demo is:

> One Mosaic paywall completing a real purchase through RevenueCat, StoreKit 2, or Google Play Billing.

---

## Phase 5: Placements and Targeting

### Objectives

- allow applications to request monetization decisions by intent
- remove hardcoded paywall identifiers from application workflows
- support remotely configurable targeting

### Deliverables

- named placements
- placement SDK APIs
- rule evaluation
- rule priority
- platform targeting
- locale targeting
- country targeting
- app-version targeting
- user attributes
- entitlement targeting
- percentage rollout
- QA overrides
- default outcomes
- fallback behaviour
- rule-decision diagnostics

### Example

Applications should call:

```dart
final result = await Mosaic.present(
  placement: "export_pdf",
);
```

rather than referencing a specific paywall identifier.

### Information architecture

The user-facing model should favour:

```text
Plan
→ Products
→ Paywalls
→ Placements
```

Avoid exposing unnecessary implementation hierarchy such as:

```text
Product
→ Package
→ Offering
→ Entitlement
```

### Exit criteria

- applications reference placement names
- matching is deterministic
- nonmatching users continue safely
- rule decisions are debuggable
- targeting can change without an application release
- the dashboard explains why a rule matched
- workflows do not end in dead ends

### Review Gate 5

The Phase 5 demo is:

> One placement showing different paywalls based on platform, locale, app version, or user attributes.

---

## Phase 6: Analytics

### Objectives

- provide reliable paywall and placement funnel analytics
- preserve attribution to exact paywall versions
- ensure analytics never block rendering or purchasing

### Deliverables

#### SDK events

- placement requested
- placement matched
- placement not matched
- paywall presented
- paywall dismissed
- paywall render failed
- product selected
- purchase started
- purchase completed
- purchase cancelled
- purchase failed
- restore started
- restore completed
- restore failed

#### Delivery

- local event queue
- event batching
- retry handling
- local storage limits
- event identifiers
- idempotency strategy
- environment isolation
- nonblocking delivery

#### Dashboard

- impressions
- dismissals
- product selections
- purchase starts
- purchase completions
- conversion rate
- placement metrics
- paywall metrics
- version comparisons
- platform breakdowns
- locale breakdowns
- event export

### Explicit exclusions

Do not implement:

- MRR
- ARR
- LTV
- financial reconciliation
- cohort analysis
- predictive analytics
- revenue forecasting

### Exit criteria

- event delivery does not block UI
- event delivery does not block purchases
- conversion funnels are visible
- historical versions remain attributable
- retries work
- duplicate-event handling is documented
- metrics can be filtered by project and environment

### Review Gate 6

The Phase 6 demo is:

> Show how users move from paywall presentation to completed purchase for a specific paywall version.

---

## Phase 7: Experiments

### Objectives

- enable valid paywall experiments without application-code changes
- provide deterministic assignment and reliable exposure tracking

### Deliverables

- control and variants
- weighted allocation
- deterministic assignment
- persistent assignment
- immutable variant versions
- exposure tracking
- audience targeting
- start and end times
- QA overrides
- pause and resume
- result reporting
- raw-event export
- experiment history
- guardrail metrics

### Experiment rules

- assignment alone does not count as exposure
- exposure occurs only after the paywall is presented
- variants remain immutable during an active experiment
- modifying a variant creates a new version
- the same stable identity receives the same assignment

### Explicit exclusions

Do not implement:

- automatic winner selection
- AI experiment recommendations
- predictive experiment outcomes

### Exit criteria

- assignment remains stable
- variants remain immutable
- exposure occurs only after presentation
- results remain attributable to exact versions
- experiments can be paused safely
- QA users can force a variant
- data can be exported

### Review Gate 7

The Phase 7 demo is:

> Split users between two paywall versions and compare completed-purchase conversion.

---

## Phase 8: Self-Hosting and Public Alpha

### Objectives

- make Mosaic independently deployable
- publish the open-source platform for external developers
- document installation, upgrades, backups, and security

### Deliverables

- Docker Compose deployment
- API container
- worker container
- dashboard container
- PostgreSQL
- Redis where required
- S3-compatible storage
- environment configuration
- database migrations
- administrator bootstrap
- health checks
- backup documentation
- restore documentation
- upgrade documentation
- security guide
- production configuration examples
- public SDK documentation
- contribution guide
- troubleshooting guide

### Exit criteria

Running:

```bash
docker compose up
```

starts a complete usable Mosaic installation.

The installation supports:

- account creation
- project creation
- local and hosted paywall editing
- publishing
- SDK configuration delivery
- commerce providers
- placements
- analytics
- experiments

### Review Gate 8

Classify the public alpha as:

- Ready
- Ready with documented limitations
- Not ready

The Phase 8 demo is:

> Clone Mosaic, run Docker Compose, create a paywall, and publish it to an example application.

---

## Phase 9: Mosaic Billing

### Objectives

- build an optional open-source subscription infrastructure layer
- allow teams to replace RevenueCat when they choose
- preserve compatibility with external providers

### Deliverables

- Apple transaction validation
- Google purchase validation
- subscription-state engine
- unified customer model
- entitlements
- renewals
- expiration
- grace periods
- billing retry states
- refunds
- revocations
- upgrades
- downgrades
- cross-platform identity
- restore synchronization
- customer server API
- billing webhooks
- audit history
- replayable billing events

### Migration rules

Mosaic Billing remains optional.

Teams may continue using:

- RevenueCat
- StoreKit 2
- Google Play Billing
- custom providers

Using Mosaic Studio, paywalls, placements, analytics, and experiments must not require Mosaic Billing.

### Exit criteria

- Apple transactions validate reliably
- Google purchases validate reliably
- entitlement state remains consistent
- refunds and revocations update access correctly
- webhooks retry safely
- billing events are auditable
- billing events can be replayed
- cross-platform identity is documented
- migration guides exist

### Review Gate 9

The Phase 9 demo is:

> Complete a purchase and see Mosaic validate it, update entitlement state, and notify the application backend.

---

## Phase 10: AI Assistance

### Objectives

- add AI assistance after Mosaic has reliable workflows and analytics
- help teams create and improve monetization experiences
- keep every AI action reviewable

### Deliverables

- paywall draft generation
- copy suggestions
- localization assistance
- layout recommendations
- accessibility suggestions
- experiment suggestions
- funnel explanations
- anomaly detection
- conversion-drop investigation
- reviewable optimization proposals

### AI rules

AI must:

- remain optional
- explain recommendations
- distinguish evidence from inference
- never fabricate analytics
- never publish without approval
- never start an experiment without approval
- preserve structured editable output
- respect organization data boundaries

### Exit criteria

- generated paywalls conform to the Mosaic protocol
- recommendations cite observed Mosaic data
- users can review and edit all generated output
- AI cannot silently publish changes
- AI cannot silently create experiments
- AI failures do not affect normal Mosaic workflows

### Review Gate 10

The Phase 10 demo is:

> Ask why conversion dropped, receive an evidence-backed explanation, and generate a reviewable experiment proposal.

---

# Phase Review Process

Create:

```text
docs/reviews/
├── phase-0.md
├── phase-1.md
├── phase-2.md
├── phase-2.5.md
├── phase-3.md
├── phase-4.md
├── phase-5.md
├── phase-6.md
├── phase-7.md
├── phase-8.md
├── phase-9.md
└── phase-10.md
```

Each phase review must contain the following sections.

## Status

Choose one:

- Accepted
- Accepted with tracked follow-ups
- Rejected pending fixes

## Product Review

- Does the phase solve its intended user problem?
- Did the implementation remain within scope?
- Were exclusions respected?
- Is later-phase functionality being introduced prematurely?

## Engineering Review

- Does the architecture remain valid?
- Are tests complete?
- Are compatibility requirements preserved?
- Are failures handled safely?
- Are known limitations documented?

## UX Review

- Are there dead ends?
- Is terminology understandable?
- Is implementation hierarchy hidden?
- Can the primary workflow be completed without documentation?
- Can navigation or click count be reduced?

## Demo Review

- What is the one-minute demo?
- Can it be performed reliably?
- Does it communicate clear user value?

## Risks

- blocking risks
- important follow-ups
- deferred improvements
- unavailable checks
- known technical debt

## Decision

Choose one:

- Proceed
- Hold
- Pivot
