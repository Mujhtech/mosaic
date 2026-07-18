# Mosaic — Agentic Product and Engineering Plan

## 1. Project Summary

Mosaic is an open-source monetization platform for mobile applications.

Its initial purpose is to help developers create, publish, test, and manage high-quality native paywalls without rebuilding them manually for every application.

Mosaic will initially support:

- Flutter
- SwiftUI
- Jetpack Compose

The platform will provide one shared paywall protocol, one dashboard, and three native renderers.

Mosaic will not initially replace RevenueCat or native billing infrastructure. Instead, it will integrate with existing billing providers while owning the paywall creation, delivery, rendering, placement, versioning, analytics, and experimentation experience.

The long-term vision is to become an open-source alternative to the combined functionality of:

- Superwall
- RevenueCat Paywalls
- Adapty Paywall Builder
- Qonversion Paywalls
- basic monetization experimentation tools

The initial product promise is:

> Create, publish, and update a production-quality native paywall across Flutter, SwiftUI, and Jetpack Compose without releasing a new app version.

---

# 2. Core Product Principles

## 2.1 One protocol, three native renderers

Mosaic must use a platform-neutral paywall protocol.

The protocol must not be designed around Flutter, SwiftUI, or Jetpack Compose individually.

Each SDK must interpret the same configuration and render it using native platform primitives.

```text
Mosaic Protocol
├── Flutter renderer
├── SwiftUI renderer
└── Jetpack Compose renderer
```

## 2.2 Native rendering

Mosaic must not use WebViews for normal paywall rendering.

Each SDK must use:

- Flutter widgets on Flutter
- SwiftUI views on iOS
- Jetpack Compose composables on Android

This is required for:

- accessibility
- animation quality
- platform conventions
- performance
- safe-area handling
- dynamic type
- design-system integration
- native custom components

## 2.3 Provider independence

The initial platform must not require developers to replace their existing billing provider.

Supported purchase approaches should include:

- RevenueCat adapter
- StoreKit 2 adapter
- Google Play Billing adapter
- custom purchase-provider interface

Mosaic owns the presentation layer and monetization workflow.

The purchase provider owns product retrieval, purchasing, restoration, and entitlement checks.

## 2.4 Remote configuration with safe fallbacks

Apps must continue functioning when Mosaic servers are unavailable.

The SDK resolution order must be:

1. current remote configuration
2. last known valid cached configuration
3. bundled fallback paywall
4. graceful unavailable result

A network failure must never crash the host application or permanently block purchasing.

## 2.5 Open source from the beginning

The core protocol, SDKs, renderer, dashboard, and self-hostable backend should be open source.

The hosted product may later charge for:

- managed hosting
- higher event volumes
- advanced analytics
- experimentation
- AI assistance
- team management
- enterprise security
- audit logs
- backups
- support

## 2.6 Simplicity before scale

Mosaic should begin as a modular monolith.

Do not introduce microservices, Kafka, Kubernetes, gRPC, or distributed databases until a real scaling or organizational problem requires them.

The initial communication model will be:

- REST API for dashboard
- REST API for SDKs
- REST API for public integrations
- WebSocket for local or live preview
- webhooks for external event delivery

---

# 3. Initial Scope

## 3.1 Included in the first major release

The first major release should include:

- shared versioned paywall schema
- Flutter SDK
- SwiftUI SDK
- Jetpack Compose SDK
- native paywall rendering
- Mosaic Studio
- templates
- draft editing
- remote publishing
- immutable versions
- rollback
- environment separation
- local caching
- offline fallback
- RevenueCat adapter
- StoreKit 2 adapter
- Google Play Billing adapter
- custom provider interface
- placements
- basic targeting
- essential analytics events
- local development mode
- self-hostable deployment

## 3.2 Explicitly excluded from the first major release

Do not include:

- full subscription receipt-validation backend
- cross-platform entitlement server
- Stripe subscription backend
- advanced MRR or LTV analytics
- AI-generated paywalls
- template marketplace
- automatic experiment winner selection
- predictive analytics
- complex workflow automation
- dozens of frameworks
- desktop support
- web paywalls
- Kubernetes deployment
- microservices

These features may be added after Mosaic proves adoption of its paywall renderer and Studio.

---

# 4. Target Users

## 4.1 Primary users

The initial target audience is:

- independent mobile developers
- early-stage mobile startups
- Flutter developers
- native iOS developers
- native Android developers
- small teams without dedicated growth engineers
- teams already using RevenueCat
- teams currently hardcoding paywalls
- agencies building subscription apps

## 4.2 Primary user problems

Mosaic should solve these problems:

- paywalls take too long to design and implement
- developers rebuild similar paywalls across applications
- changing paywall copy requires an app release
- remote builders can feel generic
- native custom UI is difficult to combine with visual builders
- teams need multiple SDK implementations
- paywall experiments require engineering effort
- rendering can become inconsistent across devices
- store product setup is confusing
- billing-provider migration is risky

---

# 5. Success Metrics

## 5.1 Time-to-first-paywall

A new developer should be able to:

1. install the SDK
2. use a mock purchase provider
3. select a template
4. render a paywall

within ten minutes.

## 5.2 Time-to-first-publish

A developer with a configured project should be able to modify and publish a paywall within two minutes.

## 5.3 Cross-platform consistency

The same paywall configuration should render successfully in:

- Flutter
- SwiftUI
- Jetpack Compose

without platform-specific configuration changes for standard components.

## 5.4 Reliability

A temporary Mosaic outage should not prevent a cached or bundled paywall from rendering.

## 5.5 Developer satisfaction

The integration should require:

- minimal boilerplate
- clear errors
- no manual JSON editing for normal usage
- no billing-provider migration
- no WebView dependency

---

# 6. Technology Stack

## 6.1 Backend

Use:

- Go
- PostgreSQL
- Redis where required
- S3-compatible object storage
- REST APIs
- WebSockets for preview
- background workers
- Docker Compose for development and self-hosting

Redis should initially be limited to:

- rate limiting
- short-lived caching
- background jobs
- preview sessions
- distributed locks where necessary

## 6.2 Dashboard

Use:

- TanStack Start
- React
- Tailwind CSS
- shadcn/ui
- Base UI primitives
- TanStack Router
- TanStack Query
- TanStack Form
- Zod where useful for client-side validation

Do not use Radix UI.

The dashboard must be designed around Base UI primitives from the beginning.

## 6.3 Mobile SDKs

Use:

- Dart and Flutter
- Swift and SwiftUI
- Kotlin and Jetpack Compose

The SDKs must remain idiomatic to their respective ecosystems rather than exposing identical naming where platform conventions differ.

## 6.4 Protocol

Use:

- JSON Schema as the initial canonical schema definition
- generated or validated models for Go, TypeScript, Dart, Swift, and Kotlin
- versioned fixtures
- compatibility tests
- schema migration rules

## 6.5 API documentation

Use OpenAPI for REST API documentation and client generation where appropriate.

The public REST API should remain manually understandable and easy to call using curl.

---

# 7. Repository Structure

Use a monorepo.

```text
mosaic/
├── apps/
│   ├── dashboard/
│   ├── api/
│   ├── worker/
│   └── docs/
│
├── protocol/
│   ├── schema/
│   ├── fixtures/
│   ├── compatibility/
│   ├── generated/
│   └── documentation/
│
├── sdk/
│   ├── flutter/
│   ├── ios/
│   └── android/
│
├── packages/
│   ├── typescript-client/
│   ├── editor-core/
│   ├── design-tokens/
│   └── test-fixtures/
│
├── examples/
│   ├── flutter-example/
│   ├── ios-example/
│   └── android-example/
│
├── deploy/
│   ├── docker/
│   └── compose/
│
├── scripts/
├── docs/
└── README.md
```

The `protocol` directory must remain independent of every SDK implementation.

The dashboard application should use a feature-oriented structure while maintaining dedicated locations for reusable hooks, providers, stores, shared components, generated API clients, and cross-feature utilities.

---

# 8. Core Domain Model

Mosaic should initially model the following concepts.

## 8.1 Organization

Represents a company or team.

An organization can contain multiple projects and members.

## 8.2 Project

Represents one application or shared application family.

A project may include iOS, Android, and Flutter application identifiers.

## 8.3 Environment

Each project should support:

- development
- staging
- production

Environments should have separate:

- API keys
- releases
- configurations
- events
- experiments
- assets where necessary

## 8.4 Paywall

A logical paywall entity.

A paywall contains:

- metadata
- drafts
- localizations
- versions
- compatibility information

## 8.5 Paywall draft

An editable version of a paywall.

Drafts may change until published.

## 8.6 Paywall version

An immutable published version.

Published versions must never be edited in place.

## 8.7 Placement

A named application event where a paywall may be displayed.

Examples:

- onboarding_complete
- export_pdf
- unlock_ai
- usage_limit_reached
- premium_feature_tapped

Applications should call placement names rather than hardcoded paywall IDs.

## 8.8 Campaign or rule

Determines which paywall is shown for a placement.

A rule may consider:

- environment
- platform
- locale
- country
- app version
- user attributes
- entitlement state
- percentage rollout
- experiment assignment

## 8.9 Product reference

A provider-independent reference to a store product.

The paywall should store a product identifier, not a formatted price.

## 8.10 Configuration release

A complete immutable configuration snapshot delivered to SDKs.

## 8.11 Experiment

Defines:

- control variant
- alternative variants
- allocation
- targeting
- start time
- end time
- metrics
- status

## 8.12 Event

Represents user interaction with a paywall or placement.

---

# 9. Paywall Protocol

## 9.1 Protocol responsibilities

The protocol must define:

- layout structure
- components
- styles
- design tokens
- product references
- localization
- visibility rules
- actions
- accessibility metadata
- animation metadata
- compatibility requirements
- fallback behaviour

## 9.2 Protocol restrictions

The protocol must not allow:

- executable JavaScript
- executable Dart
- executable Swift
- executable Kotlin
- remote code loading
- arbitrary scripts
- unrestricted expressions

The protocol may support a constrained condition language.

## 9.3 Example document

```json
{
  "schemaVersion": "1.0",
  "id": "pro-paywall",
  "revision": 4,
  "theme": {
    "background": "surface.default",
    "contentPadding": 24
  },
  "layout": {
    "type": "scroll",
    "children": [
      {
        "type": "image",
        "assetId": "hero-image",
        "fit": "cover",
        "height": 240
      },
      {
        "type": "text",
        "value": {
          "localizationKey": "paywall.title"
        },
        "style": {
          "token": "heading.large",
          "alignment": "center"
        }
      },
      {
        "type": "featureList",
        "items": [
          {
            "titleKey": "feature.unlimited"
          },
          {
            "titleKey": "feature.sync"
          }
        ]
      },
      {
        "type": "productSelector",
        "products": [
          {
            "productId": "pro_monthly"
          },
          {
            "productId": "pro_yearly",
            "badgeKey": "badge.best_value",
            "preselected": true
          }
        ]
      },
      {
        "type": "purchaseButton",
        "titleKey": "action.start_trial"
      },
      {
        "type": "restoreButton",
        "titleKey": "action.restore"
      }
    ]
  }
}
```

## 9.4 Initial component set

The first shared component set should include:

- vertical stack
- horizontal stack
- scroll container
- container
- spacer
- divider
- text
- image
- feature list
- product selector
- purchase button
- restore button
- close button
- legal text
- badge
- icon
- carousel
- video
- sticky footer
- conditional component

Every component must have precisely defined behaviour.

## 9.5 Layout semantics

The protocol must define logical sizing rather than copying CSS directly.

Examples:

- fill available width
- content-sized
- fixed logical size
- minimum size
- maximum size
- aspect ratio
- padding
- gap
- alignment
- safe-area behaviour

## 9.6 Design tokens

The protocol should support semantic design tokens.

Examples:

- surface.default
- surface.emphasis
- text.primary
- text.secondary
- action.primary
- border.subtle
- heading.large
- body.medium

Projects may map tokens to their own design system.

## 9.7 Localization

All visible text should support localization keys.

The protocol should support:

- default locale
- fallback locale
- pluralization where required
- closed interpolation contexts where explicitly versioned
- right-to-left layout
- localized product metadata

## 9.8 Product interpolation

Protocol `0.2` Product Card Text and Product Card accessibility labels may
reference only the two safe product variables below. Product templates are
invalid outside a Product Card context.

Examples:

```text
{{ product.name }}
{{ product.price }}
```

The SDK resolves them from the Product Card's bound purchase-provider product
after locale selection. Missing localized price makes the card unavailable.
Unknown or malformed template syntax rejects the document. General-purpose
expressions, executable code, subscription-period/trial/currency variables,
and arbitrary interpolation remain outside Protocol `0.2`.

## 9.9 Schema compatibility

Every configuration must declare a schema version.

Every SDK must declare:

- supported schema versions
- supported components
- supported component versions
- custom component capabilities

Studio must warn or block publishing when active SDK versions cannot render the configuration safely.

---

# 10. SDK Architecture

## 10.1 Shared conceptual layers

Each SDK should contain:

```text
Core
├── configuration
├── caching
├── identity
├── placements
├── analytics
├── compatibility
└── error handling

Renderer
├── layout
├── components
├── themes
├── localization
└── accessibility

Commerce
├── product models
├── purchase provider
├── entitlement checks
└── restore flow

Devtools
├── mock products
├── preview
├── event inspector
└── local endpoint support
```

## 10.2 Flutter API

```dart
await Mosaic.configure(
  apiKey: 'public_key',
  purchaseProvider: RevenueCatMosaicProvider(),
);

final result = await Mosaic.present(
  placement: 'export_pdf',
);
```

## 10.3 Swift API

```swift
try await Mosaic.configure(
    apiKey: "public_key",
    purchaseProvider: RevenueCatPurchaseProvider()
)

let result = await Mosaic.present(
    placement: "export_pdf"
)
```

## 10.4 SwiftUI component

```swift
MosaicPaywall(
    placement: "export_pdf"
) { result in
    // Handle result.
}
```

## 10.5 Kotlin API

```kotlin
Mosaic.configure(
    context = applicationContext,
    apiKey = "public_key",
    purchaseProvider = RevenueCatPurchaseProvider()
)
```

## 10.6 Compose component

```kotlin
MosaicPaywall(
    placement = "export_pdf",
    onResult = { result ->
        // Handle result.
    }
)
```

## 10.7 Result types

Do not return only booleans.

Results should distinguish:

- purchased
- restored
- already entitled
- dismissed
- cancelled
- product unavailable
- configuration unavailable
- purchase failed
- rendering failed

## 10.8 Purchase provider interface

All platforms must implement the same conceptual interface:

- load products
- purchase product
- restore purchases
- fetch active entitlements

The API should remain idiomatic in each language.

---

# 11. Custom Native Components

Mosaic must support app-owned native components.

A developer should be able to register a component such as:

- before-and-after image slider
- app-specific animation
- usage meter
- personalized preview
- custom pricing layout
- product demo

The server configuration may reference the component, but cannot provide executable code.

## 11.1 Safety requirements

Custom components must:

- be registered by the application
- use validated properties
- declare supported platforms
- declare component version
- define fallback behaviour
- fail gracefully when unavailable

## 11.2 Studio integration

Developers should later be able to provide editor metadata for custom components.

Studio should show compatibility status:

```text
Custom component: comparison_slider

Flutter: supported
iOS: supported
Android: missing
```

Publishing should require a fallback or compatible target rule.

---

# 12. Dashboard Architecture

## 12.1 Application stack

The Mosaic dashboard will use:

- TanStack Start
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Base UI primitives
- TanStack Router
- TanStack Query
- TanStack Form
- Zod where runtime validation is required

Radix UI must not be introduced.

All shadcn/ui components must use Base UI primitives or custom accessible primitives approved for the project.

## 12.2 Dashboard project structure

```text
apps/dashboard/
├── public/
│
├── src/
│   ├── routes/
│   │   ├── __root.tsx
│   │   ├── index.tsx
│   │   ├── login.tsx
│   │   ├── organizations/
│   │   ├── projects/
│   │   ├── paywalls/
│   │   ├── placements/
│   │   ├── experiments/
│   │   ├── analytics/
│   │   └── settings/
│   │
│   ├── components/
│   │   ├── ui/
│   │   ├── layout/
│   │   ├── navigation/
│   │   ├── feedback/
│   │   ├── data-display/
│   │   └── forms/
│   │
│   ├── features/
│   │   ├── auth/
│   │   ├── organizations/
│   │   ├── projects/
│   │   ├── environments/
│   │   ├── api-keys/
│   │   ├── assets/
│   │   ├── paywalls/
│   │   ├── paywall-editor/
│   │   ├── placements/
│   │   ├── publishing/
│   │   ├── experiments/
│   │   ├── analytics/
│   │   ├── members/
│   │   └── settings/
│   │
│   ├── hooks/
│   │   ├── use-debounce.ts
│   │   ├── use-throttled-value.ts
│   │   ├── use-media-query.ts
│   │   ├── use-mobile.ts
│   │   ├── use-mounted.ts
│   │   ├── use-previous.ts
│   │   ├── use-keyboard-shortcut.ts
│   │   ├── use-copy-to-clipboard.ts
│   │   └── use-event-listener.ts
│   │
│   ├── providers/
│   │   ├── app-providers.tsx
│   │   ├── query-provider.tsx
│   │   ├── auth-provider.tsx
│   │   ├── organization-provider.tsx
│   │   ├── project-provider.tsx
│   │   ├── environment-provider.tsx
│   │   └── theme-provider.tsx
│   │
│   ├── stores/
│   │   ├── editor-store.ts
│   │   ├── preview-store.ts
│   │   └── workspace-store.ts
│   │
│   ├── lib/
│   │   ├── api/
│   │   ├── auth/
│   │   ├── query/
│   │   ├── schema/
│   │   ├── validation/
│   │   ├── permissions/
│   │   ├── storage/
│   │   ├── errors/
│   │   ├── formatting/
│   │   └── utils/
│   │
│   ├── generated/
│   │   ├── api/
│   │   ├── protocol/
│   │   └── types/
│   │
│   ├── constants/
│   ├── types/
│   ├── config/
│   ├── styles/
│   ├── router.tsx
│   └── routeTree.gen.ts
│
├── components.json
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 12.3 Feature structure

Each substantial feature should own its related components, hooks, API queries, mutations, validation schemas, types, and utilities.

Example:

```text
features/paywall-editor/
├── components/
│   ├── editor-shell.tsx
│   ├── component-tree.tsx
│   ├── property-inspector.tsx
│   ├── preview-canvas.tsx
│   └── editor-toolbar.tsx
│
├── hooks/
│   ├── use-editor-history.ts
│   ├── use-editor-selection.ts
│   ├── use-editor-keyboard-shortcuts.ts
│   ├── use-editor-validation.ts
│   ├── use-preview-connection.ts
│   └── use-draft-autosave.ts
│
├── queries/
│   ├── paywall-draft-query.ts
│   ├── paywall-assets-query.ts
│   └── preview-session-query.ts
│
├── mutations/
│   ├── save-draft-mutation.ts
│   ├── publish-paywall-mutation.ts
│   ├── upload-asset-mutation.ts
│   └── rollback-paywall-mutation.ts
│
├── schema/
│   ├── editor-form-schema.ts
│   └── component-properties-schema.ts
│
├── stores/
│   └── editor-store.ts
│
├── types/
├── utils/
├── constants/
└── index.ts
```

## 12.4 Hook placement rules

Hooks must be organized according to their ownership and reuse boundaries.

### Global hooks

Place a hook in `src/hooks/` only when it is:

- independent of one Mosaic feature
- reusable across multiple features
- not coupled to a particular API resource
- not dependent on editor-specific state
- suitable for general React behaviour

Examples:

- `useDebounce`
- `useMediaQuery`
- `useMounted`
- `useKeyboardShortcut`
- `useCopyToClipboard`
- `useEventListener`

### Feature hooks

Place a hook inside `features/<feature>/hooks/` when it:

- operates on feature-specific data
- depends on a feature store
- wraps feature-specific queries or mutations
- implements a feature workflow
- would be meaningless outside that feature

Examples:

```text
features/paywall-editor/hooks/use-draft-autosave.ts
features/projects/hooks/use-current-project.ts
features/environments/hooks/use-active-environment.ts
features/publishing/hooks/use-publish-validation.ts
features/experiments/hooks/use-experiment-allocation.ts
```

### Provider-backed hooks

Hooks consuming React context should live near their provider unless they are clearly owned by a feature.

Example:

```text
providers/project-provider.tsx
hooks/use-project-context.ts
```

Alternatively, when project context belongs exclusively to the projects feature:

```text
features/projects/providers/project-provider.tsx
features/projects/hooks/use-current-project.ts
```

### Query hooks

TanStack Query hooks must remain near the feature that owns the resource.

Do not place every API query in the global hooks directory.

Preferred:

```text
features/paywalls/queries/paywalls-query.ts
features/paywalls/hooks/use-paywalls.ts
```

Avoid:

```text
hooks/use-paywalls.ts
hooks/use-projects.ts
hooks/use-experiments.ts
hooks/use-analytics.ts
```

The global hooks directory must not become a dumping ground.

## 12.5 Server-state rules

Use TanStack Query for:

- REST API data
- cache invalidation
- background refetching
- optimistic mutations
- request deduplication
- pagination
- retry behaviour
- mutation status
- server-state synchronization

Do not duplicate TanStack Query data in Zustand, React context, or another global store without a documented reason.

Query keys should be created through feature-owned factories.

Example:

```typescript
export const paywallKeys = {
  all: ["paywalls"] as const,
  lists: () => [...paywallKeys.all, "list"] as const,
  list: (projectId: string, environmentId: string) =>
    [...paywallKeys.lists(), projectId, environmentId] as const,
  details: () => [...paywallKeys.all, "detail"] as const,
  detail: (paywallId: string) => [...paywallKeys.details(), paywallId] as const,
};
```

## 12.6 Client-state rules

Use local React state for:

- temporary UI state
- open or closed panels
- controlled inputs
- hover state
- selection inside a small component
- simple dialogs

Use a dedicated store only for complex state shared by several distant components.

Approved store use cases include:

- paywall editor document state
- editor selection
- undo and redo history
- drag-and-drop state
- preview state
- workspace panel state
- unsaved local transformations

Do not place API responses in a client store merely to avoid using TanStack Query.

## 12.7 Provider rules

Providers should be kept narrow.

Avoid one large application context containing unrelated data.

Recommended providers include:

- query provider
- authenticated-user provider
- active organization provider
- active project provider
- active environment provider
- theme provider

Providers must not become substitutes for server-state management.

## 12.8 REST API client

The dashboard must use the shared REST API.

Use OpenAPI-generated request and response types where practical.

The API layer should provide:

- authenticated requests
- consistent errors
- request cancellation
- environment headers where required
- typed response handling
- retry rules
- correlation IDs
- pagination utilities

Suggested structure:

```text
lib/api/
├── client.ts
├── errors.ts
├── middleware.ts
├── pagination.ts
└── request-context.ts

generated/api/
├── client/
├── models/
└── schemas/
```

Generated code must not contain application-specific business logic.

## 12.9 Studio editor model

Studio v1 should use a constrained block-based editor.

It must not attempt to become a complete Figma-style freeform canvas.

The editor should provide:

- template selection
- component tree
- component insertion
- component reordering
- drag-and-drop
- property inspector
- theme controls
- product binding
- localization
- undo and redo
- keyboard shortcuts
- draft autosave
- validation
- compatibility warnings
- responsive preview
- device preview
- live native preview
- publish flow
- rollback access

## 12.10 Editor store responsibilities

The editor store may contain:

- current draft document
- selected component ID
- hovered component ID
- expanded tree nodes
- undo stack
- redo stack
- dirty state
- local validation state
- active preview device
- active localization
- active editor mode

It must not contain:

- authenticated user
- organization list
- project list
- server analytics
- persisted paywall versions
- API keys
- unrelated dashboard state

## 12.11 Draft autosave hook

Draft autosave should be implemented as a feature-level hook.

```text
features/paywall-editor/hooks/use-draft-autosave.ts
```

It should:

- observe editor document changes
- debounce requests
- avoid saving unchanged content
- cancel obsolete requests
- expose saving, saved, and failed states
- preserve local changes after a failed request
- avoid overwriting a newer server revision
- detect revision conflicts
- support manual retry

## 12.12 Editor history hook

Undo and redo behaviour should be isolated behind:

```text
features/paywall-editor/hooks/use-editor-history.ts
```

The history system should:

- group related operations
- avoid recording transient hover state
- support keyboard shortcuts
- limit retained history
- preserve deterministic document state
- reset appropriately when switching drafts
- prevent published versions from being edited

## 12.13 Preview connection hook

Live preview should be managed through:

```text
features/paywall-editor/hooks/use-preview-connection.ts
```

It should:

- connect through WebSocket
- reconnect with bounded backoff
- expose connection status
- publish draft updates
- receive device capability information
- track connected preview clients
- avoid sending stale revisions
- support Flutter, SwiftUI, and Compose clients

REST remains the primary API.

WebSocket is used only for live preview and related real-time development interactions.

## 12.14 Permission hooks

Permission checks should be exposed through focused hooks.

Examples:

```text
features/members/hooks/use-project-permissions.ts
features/publishing/hooks/use-can-publish.ts
features/api-keys/hooks/use-can-manage-api-keys.ts
```

UI permission checks improve usability but do not replace backend authorization.

Every protected action must still be authorized by the Go backend.

## 12.15 Studio preview devices

Initial preview presets should include:

- small iPhone
- large iPhone
- compact Android phone
- standard Android phone
- tablet
- landscape
- accessibility text scaling
- long localization
- right-to-left layout
- offline mode
- missing-product mode

## 12.16 Component ownership rules

Use `components/ui/` only for generic design-system primitives.

Examples:

- button
- input
- dialog
- popover
- tooltip
- tabs
- select
- command menu
- table
- badge
- card

Use feature component directories for components containing Mosaic business meaning.

Preferred:

```text
features/paywalls/components/paywall-card.tsx
features/experiments/components/variant-allocation-form.tsx
```

Avoid:

```text
components/paywall-card.tsx
components/experiment-form.tsx
```

## 12.17 Barrel-export rules

Feature-level `index.ts` files may expose a small public API.

Do not create deep chains of barrel exports across the entire application.

Imports should make feature ownership clear.

Preferred:

```typescript
import { PaywallEditor } from "@/features/paywall-editor";
```

Avoid broad barrels that expose every internal hook, component, schema, and utility.

## 12.18 Frontend agent responsibilities

The dashboard agent is responsible for:

- maintaining the TanStack Start application
- following the agreed route conventions
- using Tailwind CSS
- using shadcn/ui with Base UI
- maintaining global and feature-local hook boundaries
- using TanStack Query for server state
- implementing feature-owned queries and mutations
- keeping complex editor state isolated
- implementing accessible interfaces
- maintaining generated API clients
- preventing Radix UI dependencies
- documenting new frontend conventions

The dashboard agent must not:

- introduce Radix UI
- add a global store for all application data
- place all query hooks in `src/hooks`
- duplicate TanStack Query state
- put business logic in generic UI components
- tightly couple the editor to Flutter-specific behaviour
- bypass backend permission checks
- edit generated API files manually

## 12.19 Frontend review checklist

Every dashboard pull request should confirm:

- Does the code belong to a feature?
- Is the hook global or feature-specific?
- Is server state managed by TanStack Query?
- Is a global store genuinely necessary?
- Are Base UI primitives being used?
- Has Radix UI been avoided?
- Are loading, empty, failure, and permission states handled?
- Are query keys stable?
- Are mutations invalidating the correct resources?
- Are editor changes compatible with all three native renderers?
- Are keyboard and accessibility interactions supported?
- Are generated files left unmodified?
- Are reusable patterns documented?

# 13. Backend Architecture

## 13.1 Architectural style

Use a modular monolith.

```text
REST Handler
    ↓
Application Service
    ↓
Domain Logic
    ↓
Repository
    ↓
PostgreSQL
```

Both dashboard and SDK endpoints should call the same application services where their domain operations overlap.

## 13.2 Suggested backend modules

```text
internal/
├── organization/
├── member/
├── project/
├── environment/
├── apikey/
├── asset/
├── paywall/
├── placement/
├── publishing/
├── configuration/
├── experiment/
├── event/
├── identity/
├── webhook/
├── auth/
├── audit/
└── platform/
```

## 13.3 Transport layers

```text
internal/transport/
├── dashboardapi/
├── sdkapi/
├── publicapi/
├── websocket/
└── webhook/
```

Business rules must not live inside handlers.

## 13.4 REST API groups

```text
/api/v1/dashboard
/api/v1/sdk
/api/v1/public
/api/v1/internal
```

Possible endpoints:

```text
GET    /api/v1/dashboard/projects
POST   /api/v1/dashboard/projects

GET    /api/v1/dashboard/paywalls
POST   /api/v1/dashboard/paywalls
PUT    /api/v1/dashboard/paywalls/{id}/draft
POST   /api/v1/dashboard/paywalls/{id}/publish
POST   /api/v1/dashboard/paywalls/{id}/rollback

GET    /api/v1/sdk/configuration
POST   /api/v1/sdk/events/batch
POST   /api/v1/sdk/identify

GET    /api/v1/public/customers/{id}/entitlements
POST   /api/v1/public/webhooks
```

## 13.5 API type safety

Use:

- Go request and response structs
- OpenAPI generation
- generated TypeScript clients for the dashboard
- generated mobile models only where they improve maintenance

Do not expose database entities directly through REST responses.

## 13.6 Backend HTTP conventions

Use:

- `github.com/go-chi/chi/v5` for routing.
- `github.com/go-chi/chi/v5/middleware` for standard middleware.
- `github.com/go-chi/cors` for CORS.
- `github.com/go-chi/render` behind Mosaic-owned response helpers.
- `github.com/go-ozzo/ozzo-validation/v4` for HTTP request validation.
- `github.com/riandyrn/otelchi` for Chi instrumentation.
- OpenTelemetry for traces, metrics, and observability context.
- `github.com/rs/zerolog` for structured application logging.

Handlers must not call `render.JSON` directly. Use the shared `response` package, such as:

- `response.OK`
- `response.Created`
- `response.Accepted`
- `response.NoContent`
- `response.Error`

Request types should define Ozzo validation rules. Database-dependent and domain-dependent validation belongs in application or domain services.

Handlers must remain thin:

1. Decode input.
2. Validate transport input.
3. Call an application service.
4. Translate the result into an HTTP response.

Do not place business logic in routers, middleware, response helpers, or request DTOs.

Use the request context for Zerolog and OpenTelemetry correlation. Logs should include request ID and trace ID automatically.

Do not introduce another router, validation library, structured logger, or HTTP response framework without an approved ADR.

---

# 14. Publishing System

## 14.1 Publishing pipeline

```text
Draft
  ↓
Schema validation
  ↓
Business validation
  ↓
Compatibility validation
  ↓
Asset validation
  ↓
Product-reference validation
  ↓
Configuration build
  ↓
Immutable release creation
  ↓
CDN publication
  ↓
SDK availability
```

## 14.2 Immutability

Published paywall versions and configuration releases must be immutable.

Changing a published paywall creates a new draft and a new version.

## 14.3 Rollback

Rollback should publish a new release pointing to a prior valid configuration.

Do not mutate release history.

## 14.4 Configuration delivery

SDK configuration should support:

- CDN caching
- ETag
- If-None-Match
- compressed responses
- integrity metadata
- environment-specific delivery
- SDK compatibility targeting
- short request timeouts

## 14.5 Configuration response

```json
{
  "environment": "production",
  "configurationVersion": 42,
  "etag": "cfg_42",
  "generatedAt": "2026-07-16T10:00:00Z",
  "placements": {},
  "paywalls": {},
  "experiments": {}
}
```

---

# 15. Local Development Mode

Local development should be treated as a core feature.

## 15.1 CLI workflow

```bash
mosaic init
mosaic dev
```

## 15.2 Local development services

`mosaic dev` should eventually start:

- local configuration server
- local Studio
- WebSocket preview server
- mock product provider
- event inspector
- configuration validator

## 15.3 SDK development configuration

SDKs should support a local endpoint.

The developer should be able to edit a paywall and see the change immediately in a running application.

## 15.4 Mock commerce states

Developers should be able to simulate:

- product available
- product unavailable
- monthly subscription
- yearly subscription
- free trial
- introductory offer
- purchase success
- purchase cancellation
- purchase failure
- restore success
- already entitled

---

# 16. Analytics

## 16.1 Initial event types

Track:

- placement_requested
- placement_matched
- placement_not_matched
- paywall_presented
- paywall_render_failed
- paywall_dismissed
- product_selected
- purchase_started
- purchase_completed
- purchase_cancelled
- purchase_failed
- restore_started
- restore_completed
- restore_failed

## 16.2 Event fields

Each event should include:

- event ID
- project ID
- environment
- anonymous ID
- optional user ID
- session ID
- placement ID
- paywall ID
- paywall version
- configuration version
- experiment ID
- variant ID
- product ID
- platform
- SDK version
- app version
- timestamp
- properties

## 16.3 SDK event delivery

Events should:

- queue locally
- send in batches
- retry safely
- use a maximum local storage size
- never block rendering
- never block purchases
- avoid duplicate processing where possible

## 16.4 Initial analytics dashboard

The first analytics dashboard only needs:

- paywall impressions
- dismissals
- product selections
- purchase starts
- purchase completions
- conversion rate
- placement performance
- paywall-version comparison
- platform breakdown

Do not build full financial reporting initially.

---

# 17. Experiments

Experiments should be introduced only after event tracking is stable.

## 17.1 Assignment

Assignment must be deterministic.

A stable assignment key should be hashed using:

- project ID
- experiment ID
- user or installation ID

## 17.2 Requirements

Experiments must support:

- control
- one or more variants
- weighted allocation
- immutable variant versions
- explicit exposure tracking
- QA overrides
- start and end times
- audience targeting
- pause and resume
- event export

## 17.3 Exposure definition

A user should count as exposed only after the paywall is actually presented.

Assignment alone must not count as exposure.

## 17.4 Initial result metrics

Use:

- presentation rate
- dismissal rate
- product selection rate
- purchase-start rate
- purchase-completion rate

Avoid claiming statistical certainty until methodology is properly implemented.

---

# 18. Authentication and Security

## 18.1 Dashboard authentication

Dashboard users require:

- secure session management
- organization membership
- project roles
- environment permissions
- audit logging for sensitive changes

## 18.2 Public SDK key

Safe to embed in applications.

May:

- fetch SDK configuration
- submit SDK events
- perform limited identity operations

May not:

- edit project data
- publish
- read organization information
- access secret customer information

## 18.3 Secret API key

Used by server integrations.

May:

- manage trusted user identity
- retrieve protected data
- send trusted events
- access future entitlement APIs

## 18.4 Security requirements

The platform must include:

- rate limiting
- request validation
- audit logs
- environment isolation
- asset validation
- safe URL handling
- no remote executable code
- minimum personal-data collection
- encrypted secrets
- key rotation
- revocable keys

---

# 19. Testing Strategy

## 19.1 Protocol tests

Test:

- schema validation
- backward compatibility
- unknown components
- unknown properties
- invalid layout values
- localization fallbacks
- unsupported schema versions

## 19.2 Cross-platform fixtures

Every SDK must render the same fixture set.

Fixtures should include:

- basic monthly/yearly paywall
- trial paywall
- lifetime purchase
- long localized content
- right-to-left content
- large accessibility text
- missing image
- unavailable product
- offline fallback
- unsupported component
- nested conditional content
- sticky CTA
- tablet layout

## 19.3 Golden and snapshot tests

Use platform-specific visual baselines.

The three platforms do not need pixel-identical output, but they must follow the same semantic contract.

## 19.4 Interaction tests

Verify:

- product selection
- purchase-button state
- restoration
- dismissal
- scrolling
- sticky controls
- placement result
- analytics emission
- accessibility labels

## 19.5 End-to-end tests

Test:

```text
Create paywall
→ edit draft
→ preview
→ publish
→ SDK fetch
→ render
→ purchase
→ emit events
→ view analytics
→ rollback
```

---

# 20. Agentic Execution Model

The project should be implemented using specialized agents with clear boundaries.

## 20.1 Product agent

Responsibilities:

- maintain product requirements
- validate scope
- reject unnecessary features
- map user research to requirements
- define acceptance criteria
- maintain roadmap

The product agent must not approve work solely because it is technically interesting.

## 20.2 Protocol agent

Responsibilities:

- design JSON schema
- define component semantics
- maintain compatibility rules
- create fixtures
- review SDK deviations
- prevent platform-specific leakage

This agent owns the canonical protocol.

## 20.3 Backend agent

Responsibilities:

- implement domain model
- implement REST endpoints
- publishing pipeline
- configuration delivery
- caching
- event ingestion
- background workers
- database migrations
- security boundaries

## 20.4 Dashboard agent

Responsibilities:

- TanStack Start application
- Tailwind CSS
- shadcn/ui with Base UI
- project management
- paywall Studio
- draft editing
- previews
- publishing workflow
- analytics UI

The dashboard agent must not introduce Radix UI.

## 20.5 Flutter agent

Responsibilities:

- Dart SDK
- Flutter renderer
- Flutter purchase adapters
- caching
- local preview
- Flutter tests
- example app

## 20.6 iOS agent

Responsibilities:

- Swift SDK
- SwiftUI renderer
- StoreKit 2 integration
- iOS caching
- accessibility
- snapshot tests
- example app

## 20.7 Android agent

Responsibilities:

- Kotlin SDK
- Jetpack Compose renderer
- Google Play Billing integration
- Android caching
- accessibility
- screenshot tests
- example app

## 20.8 Quality agent

Responsibilities:

- test plans
- cross-platform conformance
- compatibility reports
- security checks
- performance testing
- release readiness

## 20.9 Documentation agent

Responsibilities:

- setup guides
- SDK references
- examples
- migration guides
- self-hosting documentation
- troubleshooting
- contribution guidelines

---

# 21. Agent Operating Instructions

All agents must follow these rules.

## 21.1 Work from written requirements

No agent should implement a major feature without:

- user problem
- scope
- acceptance criteria
- API or schema contract
- test plan

## 21.2 Do not invent architecture independently

Cross-cutting architectural decisions must be documented before implementation.

Examples:

- schema changes
- new authentication model
- background queue replacement
- new state-management library
- component semantics
- API-version changes

## 21.3 Preserve platform neutrality

No SDK agent may change the canonical schema solely to match one framework’s convenience.

Platform-specific features require:

- capability declaration
- fallback
- explicit protocol extension
- review by the protocol agent

## 21.4 Prefer small vertical slices

Agents should implement complete user journeys rather than disconnected infrastructure.

Preferred:

```text
Create draft
→ publish
→ fetch
→ render
```

Avoid:

```text
Build every database table first
```

## 21.5 Tests are part of the feature

A feature is incomplete without:

- unit tests
- validation tests
- integration tests where relevant
- fixture updates
- documentation updates

## 21.6 No silent fallback

When the SDK encounters unsupported or invalid content, it must:

- fail safely
- emit a diagnostic event
- provide a useful debug message
- use a defined fallback

## 21.7 Avoid premature optimization

Do not introduce:

- microservices
- event streaming platforms
- sharding
- Kubernetes
- custom databases
- complicated caching layers

unless measured evidence justifies them.

## 21.8 Maintain changelogs

Every protocol, SDK, dashboard, and API change must be documented.

Breaking changes require migration instructions.

---

# 22. Implementation Roadmap

## Phase 0 — Foundation and validation

### Objectives

- establish repository
- define architecture
- validate product scope
- design protocol
- build first visual prototype

### Deliverables

- monorepo
- project governance
- architecture decision records
- protocol draft
- initial fixtures
- three example applications
- dashboard shell
- backend shell
- five template concepts
- landing page
- waitlist

### Exit criteria

- one schema fixture decodes successfully in Dart, Swift, and Kotlin
- dashboard shell uses the agreed stack
- backend exposes a health endpoint
- repository can be set up from documented instructions

---

## Phase 1 — Cross-platform local renderer

### Objectives

- prove one protocol can drive three native renderers

### Deliverables

- core schema
- Flutter renderer
- SwiftUI renderer
- Compose renderer
- mock purchase provider
- bundled local paywalls
- cross-platform fixtures
- snapshot tests
- example apps

### Minimum component set

- scroll
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

- same paywall renders on all three platforms
- mock purchase flow works
- offline bundled paywall works
- accessibility checks pass
- long localization fixture works

---

## Phase 2 — Studio and local preview

### Objectives

- allow users to build paywalls visually
- allow instant preview on devices

### Deliverables

- block editor
- component tree
- property inspector
- template selection
- theme editor
- product binding
- localizations
- validation
- local preview server
- WebSocket updates
- mock product states
- event inspector

### Exit criteria

- editing Studio updates all three example apps
- invalid configuration cannot be published
- undo and redo work
- JSON import and export work
- preview supports major device sizes

---

## Phase 3 — Hosted backend and publishing

### Objectives

- support remote configuration

### Deliverables

- organizations
- projects
- environments
- API keys
- assets
- drafts
- versions
- releases
- publishing
- rollback
- SDK configuration endpoint
- CDN delivery
- caching
- bundled fallback

### Exit criteria

- paywall can be published remotely
- all SDKs fetch and cache configuration
- rollback works
- temporary backend outage does not block cached rendering
- production and staging remain isolated

---

## Phase 4 — Billing-provider adapters

### Objectives

- connect real products and purchases

### Deliverables

- RevenueCat adapter
- StoreKit 2 adapter
- Google Play Billing adapter
- custom provider interfaces
- entitlement checks
- restore handling
- product interpolation
- error normalization

### Exit criteria

- real sandbox purchase works on iOS
- real test purchase works on Android
- RevenueCat integration works
- unavailable products fail gracefully
- localized pricing renders correctly

---

## Phase 5 — Placements and targeting

### Objectives

- separate application events from paywall identity

### Deliverables

- placement API
- rule engine
- user attributes
- locale targeting
- platform targeting
- app-version targeting
- percentage rollout
- default fallback behaviour

### Exit criteria

- app calls a placement name
- correct paywall is selected
- nonmatching users continue safely
- targeting is deterministic
- rule evaluation can be debugged

---

## Phase 6 — Analytics

### Objectives

- provide reliable paywall-funnel data

### Deliverables

- event batching
- event ingestion
- retry handling
- deduplication strategy
- analytics dashboard
- placement metrics
- paywall-version metrics
- platform metrics

### Exit criteria

- events appear reliably
- SDK event delivery does not block UI
- conversion funnel is visible
- historical version performance remains intact

---

## Phase 7 — Experiments

### Objectives

- enable controlled paywall testing

### Deliverables

- experiment creation
- deterministic assignment
- variant allocation
- exposure tracking
- result reporting
- QA overrides
- pause and resume
- audience filters

### Exit criteria

- user assignment remains stable
- variants remain immutable during test
- exposure is recorded only after presentation
- result data can be exported
- experiment can be paused safely

---

## Phase 8 — Self-hosting and public alpha

### Objectives

- make Mosaic usable outside the managed environment

### Deliverables

- Docker Compose deployment
- environment configuration
- database migrations
- object storage configuration
- administrator setup
- backups documentation
- upgrade guide
- public documentation
- security guide

### Exit criteria

```bash
docker compose up
```

starts a complete usable Mosaic environment.

---

# 23. Review Gates

You should review and approve the project at these gates.

## Gate 1 — Product definition

Review:

- target user
- product promise
- initial exclusions
- competitive positioning

Do not start full implementation until this is approved.

## Gate 2 — Protocol

Review:

- component model
- schema
- styling model
- localization
- compatibility rules
- custom component system

This is the most important technical review.

## Gate 3 — Cross-platform prototype

Review the same paywall on:

- Flutter
- SwiftUI
- Jetpack Compose

Confirm that the differences are acceptable and the protocol is not biased toward one platform.

## Gate 4 — Studio workflow

Review:

- template selection
- editing
- device preview
- product binding
- publishing
- validation
- rollback

## Gate 5 — Real purchasing

Review:

- RevenueCat integration
- StoreKit 2
- Google Play Billing
- restore flow
- failures
- entitlement handling

## Gate 6 — Public alpha

Review:

- onboarding
- documentation
- reliability
- self-hosting
- security
- pricing direction
- open-source licensing

---

# 24. Reviewer Instructions

Use the following process to review this plan.

## 24.1 Review product assumptions

Mark each statement as:

- approved
- modify
- reject
- undecided

Focus especially on:

- Mosaic beginning as a paywall platform rather than a full RevenueCat replacement
- supporting Flutter, SwiftUI, and Compose from the first release
- using native rendering rather than WebViews
- integrating with existing billing providers
- open-source scope
- hosted-product scope

## 24.2 Review technical decisions

Confirm or change:

- Go backend
- PostgreSQL
- REST throughout
- WebSockets for preview
- modular monolith
- TanStack Start
- Tailwind CSS
- shadcn/ui with Base UI
- JSON Schema protocol
- monorepo
- Docker Compose self-hosting

## 24.3 Review scope

Identify anything that should move:

- into the first release
- out of the first release
- into a later phase
- out of the project entirely

## 24.4 Review SDK requirements

Confirm:

- first-party Flutter SDK
- first-party SwiftUI SDK
- first-party Jetpack Compose SDK
- RevenueCat adapters
- native purchase adapters
- custom provider interface
- custom native components

## 24.5 Review product terminology

Confirm or rename:

- project
- environment
- paywall
- placement
- campaign
- version
- release
- experiment
- entitlement
- product reference

Terminology should be finalized early because it will appear in code, documentation, APIs, and the dashboard.

## 24.6 Review implementation order

Check whether the roadmap correctly prioritizes:

1. protocol
2. renderer
3. Studio
4. remote publishing
5. billing adapters
6. placements
7. analytics
8. experiments
9. self-hosting

## 24.7 Add comments using this format

```text
Section:
Decision:
Comment:
Requested change:
Priority:
```

Example:

```text
Section: 9.4 Initial component set
Decision: Modify
Comment: Video should not be included in the first renderer milestone.
Requested change: Move video to Phase 2.
Priority: Medium
```

---

# 25. Immediate Next Actions After Approval

After this document is approved, the first execution tasks should be:

1. Create the monorepo.
2. Add architecture decision records.
3. Define the Mosaic protocol version 0.1.
4. Create the first five protocol fixtures.
5. Scaffold the Go API.
6. Scaffold the TanStack Start dashboard.
7. Configure Tailwind CSS and shadcn/ui using Base UI.
8. Scaffold Flutter, iOS, and Android SDK packages.
9. Implement one vertical paywall fixture on all three platforms.
10. Add cross-platform conformance tests.
11. Create three example applications.
12. Build a local mock-purchase provider.
13. Document local setup.
14. Review the cross-platform vertical slice before expanding components.

The first meaningful milestone should not be a complete backend.

It should be:

> One schema document rendered natively and interactively on Flutter, SwiftUI, and Jetpack Compose.

That milestone will prove the most important technical assumption behind Mosaic.
