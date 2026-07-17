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

## Phase 2.5: Production Studio UX & Design System

### Objectives

Transform the functional Phase 2 prototype into a production-quality editor that developers and designers genuinely enjoy using.

The goal of this phase is **not** to add more product functionality.

The goal is to dramatically improve:

- workflow
- discoverability
- usability
- information architecture
- interaction design
- visual hierarchy
- editing experience
- workspace flexibility
- accessibility

while establishing and documenting the Mosaic Design System for future phases.

This phase must not introduce:

- hosted publishing
- organizations
- hosted projects
- remote configuration delivery
- real billing providers
- analytics infrastructure
- experiments
- unapproved protocol expansion

---

### Studio UX

Transform Studio from an internal editor into a professional design tool.

Studio should feel like a dedicated creative workspace rather than a normal dashboard page.

---

### Workspace

Studio should use its own focused, full-screen workspace.

```text
┌─────────────────────────────────────────────────────────────┐
│ Toolbar                                                     │
│ Back  Paywall Name  Save  Undo  Redo  Preview  Export       │
├──────────────┬──────────────────────────────┬───────────────┤
│ Left Panel   │                              │ Right Panel   │
│              │                              │               │
│ Layers       │                              │ Properties    │
│ Components   │         Canvas               │               │
│ Templates    │                              │ Layout        │
│ Products     │                              │ Typography    │
│ Localization │                              │ Colors        │
│ Assets       │                              │ Actions       │
│ Settings     │                              │ Visibility    │
│              │                              │ Accessibility │
├──────────────┴──────────────────────────────┴───────────────┤
│ Validation / Preview Status                                │
└─────────────────────────────────────────────────────────────┘
```

The standard dashboard navigation should disappear while Studio is open.

Studio should feel like a dedicated creative workspace.

Hosted publishing controls must not be introduced during this phase.

---

### Resizable Workspace Implementation

The Studio workspace must use the shadcn/ui `Resizable` component.

Install it using:

```bash
npx shadcn@latest add resizable
```

Use the generated components from:

```tsx
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
```

The implementation must use:

- `ResizablePanelGroup`
- `ResizablePanel`
- `ResizableHandle`

Use:

```tsx
<ResizableHandle withHandle />
```

where a visible resize affordance is required.

The project must not create a custom resizable-panel primitive.

Do not implement panel resizing using:

- custom pointer-event calculations
- custom mouse-event calculations
- manually tracked drag coordinates
- CSS `resize`
- a custom split-pane library
- a second resizable-panel dependency
- feature-level direct imports from `react-resizable-panels`

Studio-specific layout components may compose the shadcn primitives, but they must not replace or reimplement them.

For example, a component such as:

```text
features/paywall-editor/components/studio-workspace-layout.tsx
```

may compose `ResizablePanelGroup`, `ResizablePanel`, and `ResizableHandle`.

The generic shadcn component should remain at:

```text
components/ui/resizable.tsx
```

Studio-specific state, persistence, and behaviour must remain inside the paywall-editor feature.

---

### Resizable Layout Structure

Use a horizontal resizable group for the primary workspace:

```text
Left Tool Panel
↔
Canvas
↔
Property Inspector
```

Use a nested vertical resizable group when the diagnostics panel is visible:

```text
Main Workspace
↕
Diagnostics Panel
```

A recommended composition is:

```tsx
<div className="flex h-full min-h-0">
  <StudioActivityRail />

  <ResizablePanelGroup orientation="vertical">
    <ResizablePanel id="studio-main">
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel id="studio-left-panel">
          <StudioLeftPanel />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel id="studio-canvas">
          <StudioCanvas />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel id="studio-properties">
          <StudioPropertyInspector />
        </ResizablePanel>
      </ResizablePanelGroup>
    </ResizablePanel>

    <ResizableHandle withHandle />

    <ResizablePanel id="studio-diagnostics">
      <StudioDiagnostics />
    </ResizablePanel>
  </ResizablePanelGroup>
</div>
```

This example communicates composition only. Exact component names may follow established frontend conventions.

Every panel must have a stable `id` so that layout persistence remains predictable.

Resizable panels and handles must remain direct children of their corresponding panel group.

---

### Resizable Workspace Panels

The following workspace areas should be independently resizable:

- left tool panel
- property inspector
- bottom diagnostics panel
- additional preview panel where explicitly displayed

The compact activity rail should remain fixed-width and outside the primary resizable group.

The central canvas should consume the remaining available space.

Each resizable panel must define:

- default size
- minimum size
- maximum size
- collapsed size where applicable
- stable identifier
- persisted size
- reset size

Use explicit units for panel constraints.

Prefer:

```tsx
minSize="240px"
maxSize="440px"
defaultSize="300px"
```

Avoid ambiguous size values.

Recommended starting constraints:

| Workspace area | Default | Minimum | Maximum |
|---|---:|---:|---:|
| Activity rail | 52px | 52px | 52px |
| Left tool panel | 300px | 240px | 440px |
| Property inspector | 360px | 300px | 560px |
| Bottom diagnostics | 220px high | 140px high | 45vh |
| Canvas | Remaining space | 420px wide | Remaining space |

These values are initial constraints and may be adjusted following usability testing.

The canvas should automatically expand to consume remaining available space.

---

### Panel Behaviour

Panels should support:

- drag-to-resize
- keyboard-based resizing
- collapse
- expand
- double-click divider to reset size
- remembered width or height
- responsive behaviour
- minimum canvas size
- visible resize handles
- accessible separator semantics

Do not disable the shadcn resizable handle’s built-in keyboard behaviour.

Do not replace `ResizableHandle` with a plain `div`.

Users should never lose access to functionality when a panel is collapsed.

Collapsed panels should remain accessible through:

- activity-rail icons
- tooltips
- keyboard shortcuts
- command-palette actions
- quick actions

Panel resizing must not:

- modify the paywall document
- create undo-history entries
- trigger document autosave
- appear inside exported JSON
- cause canvas selection to be lost

---

### Resizable Layout Persistence

Workspace layout should be persisted locally.

Use the layout APIs provided through the shadcn resizable component and its underlying implementation.

Persist completed layout changes rather than writing to storage for every pointer movement.

Use the supported layout-completion callback for persistence.

Persist:

- left-panel size
- property-inspector size
- diagnostics-panel size
- collapsed states
- selected Studio tool
- selected device
- orientation
- zoom level
- selected locale
- RTL state
- theme
- text scale
- safe-area state
- preview settings

Validate and clamp restored values before applying them.

If stored layout data is:

- malformed
- incomplete
- incompatible
- outside current constraints

Studio should restore the default layout rather than failing.

Workspace preferences must remain separate from the Mosaic paywall document.

Opening Studio again should restore the previous workspace.

Provide a command to reset the workspace layout to its defaults.

---

### Responsive Behaviour

Studio should adapt automatically.

#### Large desktop

```text
Activity Rail
+ Left Tool Panel
+ Canvas
+ Property Inspector
```

#### Medium desktop

```text
Activity Rail
+ Narrower Left Tool Panel
+ Canvas
+ Narrower Property Inspector
```

#### Small desktop

```text
Activity Rail
+ Canvas
+ One collapsible side panel
+ Property Inspector as a sheet or drawer
```

Laptop widths should prioritize preserving canvas space.

Studio is desktop-first during this phase.

A complete mobile-phone editing experience is not required.

---

### Canvas Priority

The canvas is the primary workspace.

Panel resizing must never reduce the canvas below its minimum usable width.

When the workspace becomes constrained, Studio should apply this order:

1. reduce side panels toward their minimum sizes
2. collapse the inactive side panel
3. move the property inspector into a sheet or drawer
4. preserve the canvas and current selection

The editor should always optimize for editing the paywall rather than displaying every side panel simultaneously.

---

### Canvas

The canvas becomes the primary visual focus.

Requirements:

- large centered preview
- zoom in
- zoom out
- reset zoom
- fit to available space
- device switching
- orientation switching
- light and dark mode
- text scaling preview
- RTL preview
- localization preview
- safe-area preview
- multiple preview devices
- mock product states
- mock purchase states

The preview should always remain visible while editing.

The Studio canvas is an interactive editor representation of the Mosaic document.

Flutter, SwiftUI, and Compose clients remain native conformance previews.

---

### Layers Panel

Replace the current simple component list with a real layer hierarchy.

Support:

- nested layers
- indentation
- expand and collapse
- drag-and-drop reordering
- drag-and-drop nesting where valid
- duplicate
- delete
- rename
- lock
- hide and show
- component icons
- contextual menus
- hover synchronization
- canvas synchronization
- selection synchronization
- validation indicators
- compatibility indicators

Example:

```text
Scroll
├── Hero Image
├── Content Stack
│   ├── Headline
│   ├── Description
│   └── Feature List
├── Product Selector
├── Purchase Button
├── Restore Button
└── Legal Text
```

Invalid nesting must be rejected with:

- an explanation
- the affected components
- a valid recovery action

The hierarchy must represent the actual Mosaic document structure.

---

### Canvas Interaction

Support direct manipulation.

Users should be able to:

- click to select
- hover to highlight
- double-click supported text to edit
- use keyboard navigation between components
- drag to reorder where appropriate
- duplicate from the canvas
- delete selected components
- open contextual menus
- see selection boundaries
- inspect spacing visually where supported

Canvas selection and layer selection must remain synchronized.

Selecting an element on the canvas should:

1. select its corresponding layer
2. reveal the layer if nested
3. open the correct property inspector
4. preserve the canvas position where possible

Selecting a layer should highlight the corresponding canvas element.

---

### Component Library

Provide a searchable component library.

The component library should expose only components supported by the active Mosaic protocol version.

For Protocol `0.1`, categories may include:

#### Layout

- Stack
- Scroll Container
- Container
- Spacer

#### Content

- Text
- Image
- Feature List

#### Commerce

- Product Selector
- Purchase Button
- Restore Button
- Legal Text

#### Navigation

- Close Button

Support:

- drag into canvas
- double-click to insert
- keyboard insertion
- search
- recently used components
- favourites where reliable

Do not add components such as:

- Grid
- Video
- Icon
- multi-page navigation

solely for this phase unless:

1. the protocol supports them
2. Flutter supports them
3. SwiftUI supports them
4. Compose supports them
5. conformance tests exist
6. the product owner explicitly approves the expansion

Phase 2.5 is not a protocol-expansion phase.

---

### Property Inspector

Replace the generic property panel with contextual inspectors.

Each component should expose only relevant controls.

Use progressive disclosure through sections such as:

- Content
- Layout
- Size
- Spacing
- Typography
- Appearance
- Background
- Border
- Actions
- Visibility
- Accessibility
- Advanced

#### Text example

- content
- localization key
- typography style
- font size
- font weight
- line height
- alignment
- color
- maximum lines
- spacing
- visibility
- accessibility label

#### Stack example

- direction
- alignment
- distribution
- gap
- padding
- margin
- width behaviour
- height behaviour
- background
- border
- visibility

#### Product Selector example

- bound products
- default selection
- selection behaviour
- layout
- product order
- badge
- pricing presentation
- trial presentation
- spacing
- appearance
- accessibility

Property changes should update the canvas immediately.

Raw JSON should appear only inside an explicitly advanced developer view.

---

### Inline Editing

Inline editing should be available for supported text components.

Requirements:

- double-click or explicit edit action
- visible editing state
- keyboard confirmation
- keyboard cancellation
- preserved selection after editing
- localization-aware editing
- validation without destructive interruption
- undo and redo support

Inline editing must not replace the property inspector for advanced controls.

---

### Preview Controls

Provide built-in preview controls.

Support:

- device
- orientation
- locale
- RTL
- text size
- appearance
- safe areas
- mock purchase state
- mock product availability
- preview zoom
- connected native preview clients

Frequently used preview controls should remain in or near the canvas toolbar.

Less common controls may use a popover or preview-settings panel.

---

### Mock Commerce

Support:

- purchase success
- purchase cancelled
- purchase failed
- already entitled
- restore success
- restore failed
- unavailable product
- loading

No real billing provider is required during this phase.

Mock commerce state must remain preview configuration.

It must not modify the exported Mosaic paywall document.

---

### Validation Experience

Validation should never unnecessarily interrupt editing.

Provide:

- inline warnings
- property-level errors
- layer-level indicators
- document summary
- compatibility warnings
- unsupported-component warnings
- actionable recovery guidance
- navigation from an error to its affected component and property

Avoid modal dialogs for normal validation failures.

Validation messages should explain:

- what is wrong
- where it is wrong
- why it matters
- how to fix it

---

### Command Palette and Keyboard Shortcuts

Provide a command palette for common Studio actions.

Examples:

- add component
- open Layers
- open Components
- open Products
- open Localization
- undo
- redo
- duplicate selection
- delete selection
- fit canvas
- reset zoom
- toggle preview appearance
- collapse left panel
- collapse property inspector
- show diagnostics
- reset workspace layout
- import document
- export document

Keyboard shortcuts must:

- avoid browser and operating-system conflicts
- be discoverable
- appear in menus and tooltips where relevant
- work without pointer input
- respect focused text-editing contexts

---

### UX Principles

The Studio must follow these principles:

- Canvas first.
- No dead ends.
- Progressive disclosure.
- User terminology over implementation terminology.
- Preserve editing context.
- Minimize unnecessary navigation.
- Make destructive actions recoverable.
- Safe editing through autosave, undo, and redo.
- Hide protocol and backend complexity.
- Provide useful defaults.
- Explain invalid actions and provide a valid next step.

---

### Design System

Establish and document the initial Mosaic Design System.

Use:

- Tailwind CSS
- shadcn/ui using Base UI
- shadcn/ui `Resizable`
- `@phosphor-icons/react`

Do not use:

- Radix UI
- Lucide as the application icon library
- a custom resizable-panel primitive
- another split-pane dependency

Standardize:

- semantic color tokens
- typography
- spacing
- radius
- elevation
- shadows
- borders
- focus indicators
- motion
- animation
- iconography
- forms
- toolbars
- activity rails
- panels
- resize handles
- contextual menus
- empty states
- loading states
- error states
- success states
- permission states
- accessibility rules
- responsive behaviour
- Studio interaction patterns

Create or finalize:

```text
packages/design-system
packages/design-tokens
```

The design system should support Studio and the wider Mosaic dashboard without coupling generic components to paywall-specific business logic.

---

### Deliverables

- dedicated full-screen Studio workspace
- fixed activity rail
- shadcn `Resizable` installation
- shadcn `ResizablePanelGroup` workspace composition
- shadcn `ResizablePanel` side and diagnostics panels
- shadcn `ResizableHandle` separators
- resizable left tool panel
- resizable property inspector
- resizable bottom diagnostics panel
- collapsible panels
- persisted workspace layout
- workspace reset action
- production canvas
- production layers panel
- synchronized canvas and layer selection
- contextual property inspector
- searchable protocol-aware component library
- interactive canvas
- supported inline editing
- drag-and-drop reordering
- keyboard shortcuts
- command palette
- preview controls
- mock commerce controls
- nonblocking validation experience
- semantic design tokens
- design-system package
- design-system documentation
- interaction guidelines
- accessibility guidelines
- responsive workspace rules

---

### Explicit Exclusions

Do not implement:

- custom resize primitives
- custom split-pane logic
- hosted publishing
- cloud synchronization
- authentication-dependent editing
- organizations
- hosted projects
- configuration releases
- CDN delivery
- real billing providers
- placements
- analytics ingestion
- experiments
- AI editing
- collaborative multiplayer editing
- arbitrary freeform positioning
- full mobile-phone Studio editing
- new protocol components without explicit approval

---

### Exit Criteria

Phase 2.5 is complete only when:

- Studio uses a dedicated full-screen workspace.
- The standard dashboard sidebar is absent from Studio.
- The canvas receives the majority of available workspace.
- All resizable panels use the shadcn `Resizable` component.
- No custom resize engine exists.
- No second resizable-panel dependency exists.
- Feature code does not import directly from `react-resizable-panels`.
- Left and right panels resize within their defined limits.
- The diagnostics panel resizes within its defined limits.
- Panel sizes and collapsed states persist after reload.
- Double-clicking a resize divider restores its default size.
- Resize handles support keyboard interaction.
- Resize handles preserve accessible separator semantics.
- The canvas never shrinks below its minimum usable width.
- Resizing does not modify the paywall document.
- Resizing does not create editor undo-history entries.
- Workspace preferences are excluded from exported paywall JSON.
- Canvas selection and layer selection remain synchronized.
- Nested layers can be expanded, collapsed, and reordered.
- Supported components can be inserted visually.
- Property editing is contextual to the selected component.
- Supported text can be edited inline.
- Validation identifies and navigates to the affected property.
- Validation does not block unrelated editing.
- Import, export, autosave, undo, and redo continue to work.
- Mock commerce controls remain separate from document data.
- Flutter, SwiftUI, and Compose previews remain protocol-compatible.
- No Radix UI dependency is introduced.
- No Lucide application imports remain.
- The design system is documented and used by Studio.
- Internal protocol concepts are hidden from the primary workflow.
- All critical UX and accessibility findings are resolved.

---

### Resizable Panel Test Requirements

Add tests covering:

- pointer-based horizontal resizing
- pointer-based vertical resizing
- keyboard resizing
- minimum-size enforcement
- maximum-size enforcement
- collapse
- expand
- double-click reset
- persistence after reload
- malformed persisted-layout recovery
- responsive fallback behaviour
- minimum canvas width
- resize-handle accessibility
- no document mutation during resize
- no undo-history entry during resize
- workspace reset

Tests should verify behaviour through the shadcn components rather than testing custom drag mathematics.

---

### Usability Acceptance

A first-time user must be able to complete this workflow without external documentation:

1. open Studio
2. choose an existing template
3. resize the left and right panels
4. select a component from the canvas
5. change the headline
6. add a supported component
7. reorder a component
8. bind a mock product
9. switch preview device
10. switch locale
11. trigger and resolve a validation error
12. export the resulting Mosaic document
13. reload Studio
14. confirm the workspace layout was restored

The test should record:

- completion rate
- completion time
- number of blocking errors
- number of times assistance was required
- unclear labels or controls
- dead ends encountered

The UX score of at least `8/10` may remain a supporting signal, but it must not replace task-based acceptance.

---

### One-Minute Demo

The Phase 2.5 demo should show:

```text
Open Studio
→ resize the left and right panels
→ select a paywall element directly on the canvas
→ edit its text inline
→ add a supported component
→ reorder it in the layer tree
→ switch from iPhone to Android preview
→ switch locale and RTL
→ resolve an inline validation warning
→ export the document
→ reload Studio
→ confirm the shadcn resizable workspace layout was restored
```

---

### Founder Review

Answer the following:

- Would a developer choose this over hardcoding a paywall?
- Would a designer be comfortable using the editor?
- Is the primary workflow easier to understand than RevenueCat’s?
- Does Mosaic avoid the dead ends found in competing products?
- Does Studio feel like a focused professional tool?
- Does the canvas remain the center of the experience?
- Are the shadcn resizable panels smooth, constrained, and accessible?
- Can the value be demonstrated convincingly in under one minute?

If any core answer is **No**, Phase 2.5 is not complete.

---

### Review Gate 2.5

Create:

```text
docs/reviews/phase-2.5.md
```

The review must include:

- acceptance status
- completed deliverables
- usability-test results
- UX findings
- accessibility findings
- shadcn Resizable implementation confirmation
- panel-resizing conformance
- workspace-persistence conformance
- protocol-compatibility status
- design-system status
- unresolved defects
- deferred work
- one-minute demo result
- founder-review answers

Classify the phase as:

- Accepted
- Accepted with tracked follow-ups
- Rejected pending fixes

Do not begin Phase 3 until Phase 2.5 is accepted.

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
