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

Phase 2.5 now has three explicit owner-approved gates:

- **Gate 2.5A — Production Studio UX and Design System:** the current canvas-first Studio,
  Layers, contextual Protocol `0.1` inspector, resizable workspace, local preview, and design-system
  work described in this section and in
  `docs/plans/phase-2.5-studio-implementation.md`.
- **Gate 2.5B — Protocol 0.2 Styling, Component, and Navigation Expansion:** the versioned styling
  contract, bounded screens/navigation, one composable Button, semantic Icon, generalized Stack,
  Carousel, Switch, Countdown, Product Card Default/Selected states, Studio coverage, and matching
  Flutter, SwiftUI, and Compose support described in
  `docs/plans/phase-2.5b-protocol-0.2-expansion.md`.
- **Gate 2.5C — Visual Systems and Presentation Surfaces:** Protocol `0.2` RC4 reusable paywall
  colours/backgrounds/shadows, gradients and decorative media backgrounds, uniform two-axis
  Fit/Fill/Fixed sizing, Screen/Sheet presentation, Studio flow frames and navigation connections,
  plus matching Flutter, SwiftUI, and Compose behavior described in
  `docs/plans/phase-2.5c-protocol-rc4-visual-system-and-presentation.md`.

Gate 2.5A does not authorize protocol or SDK expansion. Gate 2.5B is the separate explicit owner
authorization for Protocol `0.2` RC3 and its complete cross-platform vertical slice. Gate 2.5C
supersedes RC3 with the owner-approved RC4 visual-system and presentation contract. Phase 2.5 is
not accepted, and Phase 3 must not begin, until all three gates pass.

### Objectives

Transform the functional Phase 2 prototype into a production-quality editor that developers and designers genuinely enjoy using.

The goal of Gate 2.5A is **not** to add more product functionality. Gates 2.5B and 2.5C add only
the owner-approved bounded Protocol `0.2` capabilities required to make those contextual editing
workflows useful for production paywalls.

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
} from "@/components/ui/resizable";
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
minSize = "240px";
maxSize = "440px";
defaultSize = "300px";
```

Avoid ambiguous size values.

Recommended starting constraints:

| Workspace area     |         Default |    Minimum |         Maximum |
| ------------------ | --------------: | ---------: | --------------: |
| Activity rail      |            52px |       52px |            52px |
| Left tool panel    |           300px |      240px |           440px |
| Property inspector |           360px |      300px |           560px |
| Bottom diagnostics |      220px high | 140px high |            45vh |
| Canvas             | Remaining space | 420px wide | Remaining space |

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

The layer tree is the structural interaction surface. Do not place a permanent toolbar of move,
nest, outdent, duplicate, or delete buttons above it. An eligible layer row can initiate drag from
any non-control surface; the grip is an affordance, not a required hit target. Right-click and the
overflow button open the same contextual actions. Duplicate and delete live there; nest and
outdent appear only when the selected structure makes them valid. Inline rename remains focused
until commit or cancel. Keep the keyboard reference in a shortcuts tooltip or dialog instead of
permanent panel copy.

---

### Canvas Interaction

Support direct manipulation.

Users should be able to:

- click to select
- hover to highlight
- double-click supported text to edit
- use keyboard navigation between components
- see selection boundaries
- inspect spacing visually where supported

The browser canvas must preserve the rendered component semantics: headings are headings, copy is
text, feature collections are lists, product choices use selection controls, and only protocol
actions render as buttons. Generic editor frames must not turn every component into a button.

Structural editing belongs to Layers. Reorder, reparent, duplicate, delete, lock, hide, and layer
context menus must not add draggable wrappers or structural-action chrome to the canvas.

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

Gate 2.5A is not a protocol-expansion gate. Gates 2.5B and 2.5C are the approved Protocol `0.2`
expansions. Gate 2.5B authorizes bounded screens/navigation, Icon, unified Button, authored Product
Card/Product Badge structure, and safe name/price product templates. Gate 2.5C supersedes the
unapproved RC3 candidate with RC4 and authorizes only the visual-system, media-background,
two-axis-sizing, Screen/Sheet, and flow-canvas capabilities in its contract; capabilities outside
those contracts remain excluded.

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

For Phase 2.5, those section names are a vocabulary, not a promise that every element exposes
every section. Show the most frequently used section first, keep secondary sections collapsed,
and keep Advanced closed until requested. Validation navigation may open the section that owns the
invalid field.

The inspector must expose the complete canonical Protocol `0.1` surface and must not synthesize
properties that the protocol and all three native renderers do not support. IDs, localization keys,
fixed action discriminators, and fixed protocol policies belong in Advanced. Structural child
editing remains in Layers.

For Gate 2.5A, the examples below remain vocabulary only and are not Protocol `0.1` acceptance
criteria. Gates 2.5B and 2.5C approve the bounded subsets defined in their Protocol `0.2`
contracts; those contracts, rather than these examples, are authoritative for exact fields and
semantics.

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
- Every Screen and Sheet remains visible as its own authoring frame on the canvas.
- Navigate To Buttons produce labelled, selectable connections between authoring frames.
- Adding a destination offers Screen or Sheet and links it from the focused source frame.
- Screen/Sheet conversion preserves destination identity, content, links, and workspace position.
- Supported components can be inserted visually.
- Property editing is contextual to the selected component.
- Eligible boxes expose Width and Height as Fit, Fill, or Fixed with defined unbounded Fill fallback.
- Eligible backgrounds support colour, linear/radial gradient, image, and decorative muted video
  with explicit safe fallback.
- Eligible box appearances support one native shadow directly or through a reusable style.
- Studio provides a paywall Design System panel for reusable colours, backgrounds, and shadows,
  and linked colours appear in relevant colour controls.
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

The report must evaluate the three gates separately before issuing one final Phase 2.5
classification.

#### Gate 2.5A evidence

- the complete production Studio UX and design-system acceptance in this roadmap;
- no Protocol `0.1`, Local Preview `0.1`, fixture, or SDK expansion;
- contextual coverage of the complete Protocol `0.1` surface;
- the Studio usability path and one-minute demo.

#### Gate 2.5B evidence

- Protocol `0.1` remains immutable and every valid `0.1` document remains supported;
- the deterministic `0.1` to `0.2` migration, strict `0.2` schema, manifest, documentation,
  generated browser contract, fixtures, and changelogs;
- Local Preview `0.2` schemas, messages, local-project and session-flow fixtures, exact WebSocket
  subprotocol, and capability negotiation, while Local Preview `0.1` remains unchanged and
  supported;
- one through ten reachable screens, acyclic forward navigation, safe back navigation, unified
  passive-content Button, semantic RTL-aware Icon, and the closed Purchase, Restore, Close,
  Navigate To, Navigate Back, and HTTPS External URL action set;
- generalized vertical/horizontal Stack, Carousel, Switch, Countdown, approved styling, and
  Product Card complete Default plus deterministic Selected overrides in Studio and all three
  native renderers, including per-field and full Selected reset;
- exact runtime-versus-document state boundaries for screen history, selection, Carousel page,
  Switch value, Countdown time, and Studio preview controls;
- long localization, RTL, accessibility scaling, contrast, truncation, unavailable product,
  expired Countdown, hidden-content, unsupported-client, fallback, and migration conformance;
- atomic rejection and last-accepted or bundled fallback when a client cannot render Protocol
  `0.2` completely;
- the complete task workflow and demo defined in the Gate 2.5B implementation contract.

#### Gate 2.5C evidence

- Protocol `0.2` RC4 schema, manifest, semantic validation, exact capability derivation, fixtures,
  browser declarations, Local Preview `0.2`, RC3 recovery, documentation, and changelog;
- document-level reusable colour, background, and shadow catalogs with reference/cycle validation;
- literal, semantic, and reusable colours; colour, linear/radial gradient, image, video, and reusable
  backgrounds; one inline or reusable shadow; and safe missing-media fallback;
- consistent Width and Height Fit/Fill/Fixed semantics, fixed-overflow accessibility behavior, and
  unbounded Fill diagnostics in Studio, Flutter, SwiftUI, and Compose;
- one authoring frame per Screen/Sheet, workspace-only frame organization, visible Navigate To
  connections, focused-source creation, and content-preserving Screen/Sheet conversion;
- native Sheet presentation and navigation-history behavior on Flutter, SwiftUI, and Compose;
- retained Layers full-row reorder, right-click menu, rename, canvas selection, inline editing,
  undo/autosave/export, and Protocol/Local Preview `0.1` immutability; and
- the complete task workflow and demo defined in the Gate 2.5C implementation contract.

Classify the phase as:

- Accepted
- Accepted with tracked follow-ups
- Rejected pending fixes

Do not begin Phase 3 until Gates 2.5A, 2.5B, and 2.5C are accepted and the consolidated Phase 2.5
report is accepted.

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

## Phase 4: Connected Product Catalog and Commerce Providers

Phase 4 connects the Mosaic Product Catalog created in Phase 3 to real commerce providers.

The phase is divided into two gates:

- **Gate 4A — RevenueCat and Custom Providers**
- **Gate 4B — Native Store Providers**

Gate 4A provides the fastest adoption path for teams already using RevenueCat or an existing commerce abstraction.

Gate 4B adds first-party StoreKit 2 and Google Play Billing support.

Phase 4 does not make Mosaic the authoritative subscription backend. Authoritative Mosaic-managed transaction validation, subscription state, and customer Entitlements remain part of Phase 9.

---

### Objectives

- connect Mosaic Products to real purchasable items
- preserve provider independence
- allow existing RevenueCat users to adopt Mosaic without migrating billing infrastructure
- support custom commerce implementations
- add first-party StoreKit 2 and Google Play Billing adapters
- resolve localized Product metadata safely at runtime
- maintain clear separation between Products and Entitlements
- expose provider capabilities without pretending every provider behaves identically
- provide complete Product connection, readiness, replacement, and diagnostic workflows
- preserve historical Product references across published Paywall Versions
- complete real sandbox and test purchases across supported platforms

---

### Commerce Domain Boundaries

Phase 4 must preserve the following domain model:

```text
Plan
└── Products
    ├── Provider Product Mappings
    └── Entitlement Grants

Paywall
└── Product References

Placement
└── Paywall

Purchase
└── Product

Customer Entitlement State
└── Provider-owned until Mosaic Billing
```

#### Product

A Product is a stable, project-scoped Mosaic representation of something a customer can purchase.

Examples:

- Pro Monthly
- Pro Yearly
- Lifetime Access

A Mosaic Product is not the same thing as:

- an Apple Product identifier
- a Google Play Product identifier
- a Google Play base plan
- a RevenueCat Package
- a RevenueCat Offering
- a custom-provider SKU

#### Plan

A Plan is an optional user-facing grouping of related Products.

Example:

```text
Plan: Pro
├── Pro Monthly
├── Pro Yearly
└── Lifetime Access
```

A Plan is not a store Product and is not sent to a commerce provider.

#### Entitlement

An Entitlement describes the access granted by purchasing a Product.

Example:

```text
Pro Monthly ─┐
Pro Yearly  ──┼── grants → pro
Lifetime    ──┘
```

Mosaic may define:

- Entitlement keys
- Entitlement descriptions
- Product-to-Entitlement grants

Before Phase 9, the configured commerce provider remains authoritative for the customer’s active Entitlement state.

Mosaic must not claim to own authoritative cross-platform customer Entitlement state during Phase 4.

#### Provider Product Mapping

A Provider Product Mapping connects one Mosaic Product to a purchasable item managed by a commerce provider.

A mapping may include:

- provider type
- provider connection
- platform
- application
- environment
- provider Product identifier
- Package reference
- Offering reference
- base-plan reference
- offer reference
- connection status
- availability status
- synchronization status
- last successful synchronization
- diagnostic information

Provider-specific concepts remain inside Provider Product Mappings and provider adapters.

RevenueCat Packages, RevenueCat Offerings, Google base plans, and Google offers must not become mandatory top-level Mosaic concepts.

---

### Active Provider Resolution

Each Application, Environment, and Platform combination must have an explicit active commerce provider.

Example:

```text
Project: Example App
└── Production
    ├── iOS
    │   └── Active provider: RevenueCat
    └── Android
        └── Active provider: RevenueCat
```

A Mosaic Product may contain mappings for more than one provider to support:

- migration
- testing
- provider replacement
- staged rollout
- platform differences

The runtime must not guess which provider to use.

Provider resolution must use:

- Project
- Environment
- Application
- Platform
- configured active provider
- verified Provider Product Mapping

The SDK must never select a Provider Product through unverified string matching.

---

## Gate 4A: RevenueCat and Custom Providers

### Objectives

- connect the Mosaic Catalog to RevenueCat
- allow current RevenueCat users to adopt Mosaic without billing migration
- establish the provider-capability contract
- establish provider connection and synchronization workflows
- support app-owned custom commerce providers
- complete real RevenueCat sandbox purchases
- preserve Mosaic’s provider-independent renderer and Product model

---

### Provider Capability Model

Define provider capabilities explicitly.

Capabilities may include:

- Product loading
- subscriptions
- one-time non-consumables
- trials
- introductory offers
- promotional offers
- restore
- active Entitlement lookup
- pending purchases
- deferred purchases
- server-confirmed transactions
- Product synchronization
- provider diagnostics

Capabilities may vary by:

- provider
- platform
- application
- environment
- Product type

Do not falsely normalize unsupported capabilities.

Studio and the SDK should be able to communicate differences such as:

```text
RevenueCat on iOS

✓ Subscriptions
✓ One-time non-consumables
✓ Trials
✓ Restore
✓ Active Entitlements
! Promotional offers depend on provider configuration
```

A missing capability must not be represented as a generic provider failure.

---

### Provider Connections

Implement server-side Provider Connections.

A Provider Connection should contain:

- stable connection ID
- Project ID
- provider type
- connection name
- environment scope
- application scope where required
- encrypted credentials
- connection status
- last successful test
- last successful synchronization
- credential-expiry status where available
- diagnostic information
- creation metadata
- revocation metadata
- audit history

Support:

- create connection
- test connection
- reconnect
- rotate credentials
- revoke connection
- inspect connection status
- inspect synchronization status
- retry synchronization
- separate sandbox and production connections

Provider secrets must:

- be encrypted at rest
- never appear in logs
- never appear in exported paywall documents
- never be delivered through the public SDK configuration endpoint
- never be returned after their accepted one-time entry where avoidable
- be redacted in diagnostics and audit events

Only explicitly client-safe provider configuration may be delivered to an SDK.

---

### RevenueCat Adapter

Implement a RevenueCat adapter across the backend, dashboard, and supported SDKs.

#### Backend and Dashboard

Support:

- RevenueCat Provider Connection
- connection validation
- application mapping
- environment mapping
- Product import
- Product synchronization
- Package mapping
- Offering mapping
- Entitlement synchronization where appropriate
- localized Product metadata synchronization
- stale metadata detection
- synchronization diagnostics
- credential-expiry diagnostics
- connection revocation
- audit events

RevenueCat-specific Packages and Offerings remain adapter details.

The primary Mosaic Catalog experience remains:

```text
Catalog
├── Plans
├── Products
└── Entitlements
```

Do not make users navigate through a mandatory hierarchy such as:

```text
Product
→ Package
→ Offering
→ Entitlement
```

#### SDK Integration

Support RevenueCat through a Mosaic purchase-provider adapter.

The adapter should conceptually support:

- loading mapped Products
- resolving localized Product metadata
- purchasing a Product
- handling purchase cancellation
- handling pending or deferred outcomes
- restoring purchases
- reading active Entitlements
- normalizing provider errors
- reporting provider capabilities
- exposing safe diagnostics

The RevenueCat adapter should work with an already configured RevenueCat SDK where practical.

Mosaic must not initialize a second conflicting RevenueCat instance when the host application already owns initialization.

---

### Custom Provider Interface

Provide a documented custom commerce-provider interface for Flutter, Swift, and Kotlin.

The interface should conceptually support:

- provider identity
- capability reporting
- Product loading
- localized Product metadata
- purchase
- cancellation
- pending outcome
- failure
- restore
- active Entitlements
- provider diagnostics

A custom provider must be able to map a Mosaic Product to an app-owned commerce object without changing the paywall document.

Custom providers must not require Mosaic backend credentials unless the provider implementation explicitly needs a backend integration.

---

### Catalog Workflows

Complete the connected Catalog experience.

Support:

- Product creation
- Product import
- Product synchronization
- Product search
- Product filtering
- Product platform availability
- Provider Product Mapping
- active-provider selection
- Product readiness validation
- Product archive and restore
- Product replacement
- Product usage graph
- stale metadata indicators
- Entitlement grants
- Plan membership
- synchronization retry
- connection diagnostics

Each Product should show:

- Mosaic-owned metadata
- provider mappings
- supported platforms
- current active provider
- live availability
- metadata freshness
- Entitlement grants
- Paywall usage
- Placement usage
- published-version usage
- readiness state
- recovery actions

---

### Product Readiness

A Product should expose an environment-specific readiness state.

Suggested readiness states:

- Draft
- Mock Only
- Connected
- Attention Required
- Unavailable
- Archived

Readiness should consider:

- Product lifecycle
- active provider
- application mapping
- environment mapping
- Provider Product Mapping
- provider Product availability
- required platform mappings
- Entitlement grants
- metadata freshness
- provider connection health

Readiness failures must explain:

- what is missing
- which platform is affected
- whether publishing is blocked
- how to resolve the problem

Examples:

```text
Pro Yearly has no Android RevenueCat mapping.

[Add Mapping]
```

```text
RevenueCat has not synchronized this Product successfully.

[Retry Synchronization]
```

```text
This Product has no active Entitlement grant.

[Add Entitlement]
```

---

### Product Metadata Ownership

Mosaic-owned metadata may be edited directly:

- internal Product name
- internal description
- Product key
- Plan membership
- Entitlement grants
- internal tags
- internal notes

Provider-owned metadata should be synchronized and read-only where appropriate:

- localized display name
- localized price
- currency
- billing period
- trial duration
- introductory offer
- promotional offer
- store availability
- provider Product status

Studio may use synchronized metadata for preview, but it must show when that data is:

- stale
- simulated
- unavailable
- environment-specific

Runtime SDKs should prefer live provider metadata for final commerce presentation.

---

### Gate 4A Exit Criteria

Gate 4A is complete only when:

- the provider-capability model is documented
- capabilities can vary by provider and platform
- RevenueCat connections can be created, tested, rotated, and revoked
- provider secrets are encrypted and never exposed to SDKs
- sandbox and production connections are separated
- RevenueCat Products can be imported
- RevenueCat Products can be synchronized
- RevenueCat Packages and Offerings remain adapter details
- Mosaic Products can be mapped to RevenueCat Products
- Plans can group connected Products
- Products can grant Entitlements
- Product readiness is visible
- stale metadata is visible
- connection and synchronization failures provide recovery actions
- the custom provider interface is documented
- custom providers can load Products
- custom providers can complete and restore purchases
- RevenueCat sandbox purchases work on supported platforms
- RevenueCat restore works
- RevenueCat active Entitlements can be read through the adapter
- localized pricing is resolved correctly
- purchase cancellation is distinguished from failure
- pending or deferred purchases are represented explicitly
- the paywall renderer remains provider-independent
- published paywalls continue referencing stable Mosaic Product IDs
- no Mosaic-owned authoritative customer Entitlement state is introduced

### Review Gate 4A

Create:

```text
docs/reviews/phase-4a.md
```

The Gate 4A demo is:

> Connect RevenueCat, import Monthly and Yearly Products, group them into a Pro Plan, grant the Pro Entitlement, bind both Products to a paywall, and complete a RevenueCat sandbox purchase without changing the paywall document.

Classify Gate 4A as:

- Accepted
- Accepted with tracked follow-ups
- Rejected pending fixes

Gate 4B must not begin until Gate 4A is accepted.

---

## Gate 4B: Native Store Providers

### Objectives

- add first-party StoreKit 2 support
- add first-party Google Play Billing support
- allow Mosaic to operate without RevenueCat
- preserve the same Mosaic Product and Entitlement model
- preserve provider-independent paywall documents
- complete native sandbox and test purchases
- expose platform capability differences clearly

---

### StoreKit 2 Adapter

Implement:

- Apple Product loading
- Apple Product mapping
- application and environment mapping
- localized pricing
- currency resolution
- subscription-period resolution
- trial resolution
- introductory-offer resolution
- Product availability
- purchase handling
- pending and deferred outcomes
- cancellation handling
- restore handling
- current Entitlement checks
- transaction outcome normalization
- sandbox diagnostics
- provider capability reporting
- safe error normalization

The StoreKit adapter must remain behind the Mosaic purchase-provider boundary.

The paywall renderer must not depend directly on StoreKit types.

---

### Google Play Billing Adapter

Implement:

- Google Play Product loading
- Product mapping
- application and environment mapping
- base-plan mapping
- offer mapping
- localized pricing
- currency resolution
- subscription-period resolution
- trial resolution
- introductory-offer resolution
- Product availability
- purchase handling
- pending outcomes
- cancellation handling
- restore or purchase-history handling
- current Entitlement checks where supported
- transaction outcome normalization
- test-environment diagnostics
- provider capability reporting
- safe error normalization

Google-specific base plans and offers remain Provider Product Mapping details.

They must not become required top-level Mosaic concepts.

---

### Flutter Native Commerce Integration

Provide a provider-independent Dart commerce API.

Support:

- StoreKit 2 bridge where required
- Google Play Billing bridge where required
- native Product loading
- native purchase presentation
- restore
- active Entitlement lookup
- provider capability reporting
- normalized purchase outcomes
- normalized diagnostics

The Flutter API should not expose incompatible native objects as its primary public contract.

Provider-native objects may be retained internally when required to complete a purchase.

---

### Native SDK Requirements

Flutter, Swift, and Kotlin SDKs must support the same conceptual commerce contract while remaining idiomatic to their languages.

The shared conceptual operations are:

- load Products
- inspect capabilities
- purchase Product
- restore purchases
- retrieve active Entitlements
- inspect diagnostics

The SDKs must not:

- hardcode formatted prices from Mosaic configuration
- block the UI while loading Products
- treat cancellation as an error
- silently convert provider failure into inactive Entitlements
- silently select a fallback Product through string matching
- allow analytics failure to block purchasing
- mutate the published paywall document with runtime Product state

---

### Runtime Product Model

The runtime Product model should expose normalized fields such as:

- Mosaic Product ID
- Product key
- Product type
- localized display name
- localized price
- currency code
- billing period
- trial information
- introductory-offer information
- availability
- provider
- provider capabilities
- Entitlement grants

The SDK may retain an internal provider object needed to complete the purchase.

Provider-specific capabilities must remain inspectable.

Unsupported provider fields should be absent or explicitly unavailable rather than populated with misleading defaults.

---

### Product Binding and Runtime Resolution

Paywalls bind to stable Mosaic Product IDs.

At runtime:

```text
Paywall Product Reference
→ Mosaic Product
→ Active Provider for Application and Environment
→ Verified Provider Product Mapping
→ Provider Product
→ Localized Commerce Metadata
```

The SDK must reject ambiguous or invalid resolution safely.

The SDK must not:

- match by display name
- guess by billing period
- guess by price
- use a Product from another Environment
- use a Product from another Application
- select an archived Product
- silently substitute another Product

---

### Purchase Result Model

Normalize purchase outcomes without discarding provider-specific diagnostics.

Suggested outcomes include:

- Purchased
- Pending
- Deferred
- Cancelled
- Already Entitled
- Product Unavailable
- Provider Unavailable
- Failed

A successful result should include where available:

- Mosaic Product ID
- provider
- provider transaction reference safe for the client
- active Entitlement keys
- transaction timestamp
- diagnostic metadata safe for the application

A failure result should include:

- stable Mosaic error code
- user-safe message
- retryability
- provider code where safe
- diagnostic correlation ID

Raw provider errors must not be exposed as the only public contract.

---

### Restore Result Model

Normalize restore outcomes such as:

- Restored
- Nothing to Restore
- Cancelled
- Provider Unavailable
- Failed

Restoration should return the current active Entitlements where available.

A provider failure must not be interpreted as an empty Entitlement set.

---

### Entitlement State Boundary

During Phase 4:

- Mosaic defines Entitlement keys
- Products grant Entitlements
- provider adapters read active customer Entitlements
- the SDK exposes normalized Entitlement state
- the provider remains authoritative

If Entitlement lookup fails, the result should represent:

```text
Unknown or unavailable
```

It must not silently become:

```text
Inactive
```

Authoritative Mosaic-managed Entitlement state remains Phase 9.

---

### Production Publishing Validation

Before publishing a production commerce paywall, validate:

- every referenced Product exists
- every Product belongs to the Project
- every Product is active
- every targeted Application has a mapping
- every targeted Platform has a mapping
- the selected provider is active
- the provider connection is healthy
- the provider can load the Product
- Product types are compatible
- required Entitlement grants exist
- archived Products are not newly introduced
- synchronized metadata is sufficiently recent
- every targeted platform has a safe fallback
- no Provider Product Mapping is ambiguous

Validation failures must provide recovery actions.

Examples:

```text
Pro Yearly has no Android mapping.

[Add Android Mapping]
```

```text
Pro Monthly is archived but used by this Draft.

[Choose Replacement]
```

```text
RevenueCat connection has expired.

[Reconnect RevenueCat]
```

```text
Google Play has two active mappings for Pro Monthly.

[Resolve Mapping]
```

Publishing validation must not claim that a store purchase will succeed merely because a Product identifier exists.

---

### Product Editing and Replacement Rules

Mosaic-owned Product metadata may be edited safely.

When a provider-controlled Product identifier cannot be changed:

- create a replacement Product or Provider Product Mapping
- preserve the previous mapping for historical releases
- show affected Paywalls
- show affected Placements
- show affected Experiments where applicable
- allow active Drafts to adopt the replacement
- never rewrite immutable Paywall Versions
- never rewrite historical Configuration Releases
- never erase the meaning of existing purchases

Every blocked edit must provide a recovery action.

Do not end with:

> This Product cannot be edited.

Prefer:

> This provider identifier is already live. Create a replacement while preserving existing releases?

```text
[Create Replacement]
```

---

### Diagnostics and Recovery

Provide diagnostics for:

- provider disconnected
- credentials expired
- Product not found
- Product unavailable
- stale synchronization
- missing platform mapping
- missing application mapping
- ambiguous mapping
- unsupported Product type
- unsupported trial
- invalid offer
- restore failure
- pending purchase
- provider timeout
- provider SDK unavailable
- Entitlement lookup unavailable

Every diagnostic should explain:

- what failed
- which Product is affected
- which provider is affected
- which platform is affected
- whether publishing or purchasing is blocked
- how to recover

---

### Security Requirements

Provider integration must ensure:

- provider secrets are encrypted at rest
- secret values are never logged
- secrets are never included in SDK configuration
- client-safe keys are explicitly identified
- credentials are scoped to the correct Project and Environment
- connection tests do not expose secret values
- rotation and revocation are audited
- provider web requests use bounded timeouts
- provider responses are validated
- cross-tenant access is prevented
- diagnostics redact sensitive fields

---

### Explicit Exclusions

Do not implement:

- Mosaic receipt validation
- Mosaic transaction validation
- Mosaic subscription-state engine
- authoritative cross-platform customer Entitlement state
- Apple server notifications
- Google real-time developer notifications
- Stripe Billing
- Paddle
- Lemon Squeezy
- full financial reporting
- MRR
- ARR
- LTV
- reconciliation
- consumable Products
- credit-based Products
- metered Products
- quantity-based Products
- automatic store Product creation
- advanced Placement targeting
- analytics ingestion
- Experiments

Any additional provider or Product type requires explicit product approval.

---

### Gate 4B Exit Criteria

Gate 4B is complete only when:

- StoreKit 2 Products can be loaded
- StoreKit 2 Products can be mapped to Mosaic Products
- StoreKit sandbox purchases work
- StoreKit restore works
- StoreKit localized pricing is correct
- StoreKit trial and introductory-offer metadata is resolved
- Google Play Products can be loaded
- Google Play Products can be mapped to Mosaic Products
- Google Play base plans and offers remain adapter details
- Google Play test purchases work
- Google Play restore or purchase-history recovery works
- Google Play localized pricing is correct
- Google Play trial and offer metadata is resolved
- Flutter can use native StoreKit and Google Play adapters
- SwiftUI can use the StoreKit adapter
- Compose can use the Google Play Billing adapter
- purchase cancellation is not reported as a generic failure
- pending and deferred outcomes are represented explicitly
- unavailable Products fail safely
- ambiguous Product mappings fail safely
- Entitlement lookup failures return unknown rather than inactive
- Product replacement preserves immutable history
- publishing validation checks provider readiness
- provider-specific capabilities remain visible
- the renderer remains independent of the active provider
- no Mosaic-owned authoritative customer Entitlement state is introduced

### Review Gate 4B

Create:

```text
docs/reviews/phase-4b.md
```

The Gate 4B demo is:

> Use the same Mosaic paywall document to complete an Apple StoreKit sandbox purchase on iOS and a Google Play test purchase on Android without changing the paywall’s Product references.

Classify Gate 4B as:

- Accepted
- Accepted with tracked follow-ups
- Rejected pending fixes

---

### Phase 4 Exit Criteria

Phase 4 is complete only when both Gate 4A and Gate 4B are accepted.

The consolidated Phase 4 review must confirm:

- Mosaic Products remain stable across providers
- Plans group Products without becoming provider objects
- Products grant Entitlements
- provider-specific concepts remain adapter details
- RevenueCat integration works
- custom provider integration works
- StoreKit 2 integration works
- Google Play Billing integration works
- Products can be imported, synchronized, connected, archived, and replaced
- Product usage is visible
- Product readiness is visible
- stale metadata is visible
- missing mappings provide recovery actions
- localized pricing is correct
- trial and introductory-offer metadata is resolved correctly
- purchase results are normalized without hiding provider differences
- restore results are normalized
- active Entitlement state remains provider-owned
- published Product references remain historically valid
- the paywall renderer remains provider-independent
- no Phase 5 targeting work was introduced
- no Phase 6 analytics work was introduced
- no Phase 9 billing infrastructure was introduced

---

### Review Gate 4

Create:

```text
docs/reviews/phase-4.md
```

The review must evaluate Gate 4A and Gate 4B separately before issuing one final Phase 4 decision.

The Phase 4 demo is:

> Connect RevenueCat, import Monthly and Yearly Products, group them into a Pro Plan, grant the Pro Entitlement, bind them to a paywall, complete a RevenueCat sandbox purchase, then use the same Mosaic Product references to complete native StoreKit and Google Play test purchases.

Classify Phase 4 as:

- Accepted
- Accepted with tracked follow-ups
- Rejected pending fixes

Release milestone:

> Design-Partner Alpha

Do not begin Phase 5 until Gate 4A, Gate 4B, and the consolidated Phase 4 review are accepted.

## Phase 5: Advanced Placement Decisions and Targeting

Phase 5 extends the basic one-to-one Placement contract introduced during hosted publishing.

Basic Placement names and SDK presentation APIs already exist before this phase.

Phase 5 adds remotely configurable, deterministic, offline-capable decisions.

### Objectives

- select the correct published Paywall for a Placement
- support a deliberate `no_paywall` outcome
- target users without application-code changes
- preserve deterministic decisions
- support offline evaluation
- make every decision explainable
- prevent selection of Paywalls whose Products are unavailable
- preserve user privacy and minimize collected attributes

### Placement Model

A Placement is a stable user-facing application intent.

Examples:

- `onboarding_complete`
- `export_pdf`
- `unlock_ai`
- `usage_limit_reached`
- `premium_feature_tapped`

Applications call:

```dart
final result = await Mosaic.present(
  placement: "export_pdf",
);
```

```swift
let result = await Mosaic.present(
    placement: "export_pdf"
)
```

```kotlin
val result = Mosaic.present(
    placement = "export_pdf"
)
```

Applications should not hardcode Paywall Version IDs.

### Placement Outcomes

A Placement decision may return:

- show a published Paywall Version
- show no Paywall
- use a defined fallback Paywall
- return an explicit unavailable result

A nonmatching rule is not an error.

A `no_paywall` outcome must be an explicit supported decision.

### Decision Inputs

Supported inputs may include:

- platform
- operating-system version where justified
- application version
- locale
- explicitly supplied country
- anonymous installation ID
- optional application user ID
- allow-listed user attributes
- provider-observed Entitlement state
- Product availability
- Product readiness
- Environment
- QA override

Country must not be silently inferred from locale.

Every decision input must have a documented source.

### Identity Model

Support:

- generated installation ID
- optional application user ID
- anonymous-to-identified aliasing
- stable decision assignment
- typed user attributes
- attribute allow-listing
- attribute size limits
- attribute removal
- identity reset

Do not rely on advertising identifiers.

Do not require personal information for Placement evaluation.

### User Attributes

Supported attribute types should be constrained, such as:

- string
- boolean
- number
- timestamp
- bounded string list

Attributes must be:

- explicitly supplied by the host application
- allow-listed by Project configuration
- size-limited
- inspectable in the targeting simulator
- excluded from logs where sensitive
- omitted when unnecessary

Do not provide an arbitrary remote scripting language.

### Rule Model

A rule should include:

- stable rule ID
- Placement ID
- priority
- conditions
- outcome
- fallback
- enabled state
- created metadata
- updated metadata
- configuration version

Conditions may support bounded operators such as:

- equals
- not equals
- in
- not in
- greater than
- greater than or equal
- less than
- less than or equal
- exists
- does not exist
- semantic-version comparison
- percentage bucket

Do not allow executable JavaScript or arbitrary remote expressions.

### Rule Priority and Conflict Handling

Rule evaluation order must be explicit and deterministic.

The dashboard must detect:

- unreachable rules
- duplicate conditions
- conflicting rules
- missing fallback
- unsupported attribute types
- invalid app-version comparisons
- Paywalls with unavailable Products

Users should see which rule wins and why.

### Deterministic Percentage Rollout

Percentage rollout must use a versioned deterministic algorithm.

The bucket should derive from values such as:

```text
Project ID
+ Placement ID
+ Rule ID
+ stable identity key
+ bucketing algorithm version
```

The same identity and configuration must receive the same outcome.

Do not use a new random value on every Placement call.

### Offline Evaluation

Placement decisions should be evaluable from the accepted Configuration Release.

The SDK must not require a network request every time a Placement is presented.

Evaluation order:

1. use the current accepted Configuration Release
2. evaluate rules locally
3. verify Product and capability availability
4. choose the outcome
5. use fallback where necessary
6. return an explicit result

### Product and Entitlement Safety

A rule must not select a Paywall that cannot safely resolve required Products for the current:

- application
- Environment
- platform
- active provider

Entitlement states must preserve:

- active
- inactive
- unknown
- provider unavailable
- failed

Unknown Entitlement state must not silently become inactive.

### Targeting Simulator

Provide a simulator in the dashboard.

Users should be able to enter:

```text
Platform: iOS
Application version: 2.3.0
Locale: de-DE
Country: DE
Entitlement: free
Product availability:
- Pro Monthly
- Pro Yearly
User attributes:
- student = true
```

The simulator should return:

- selected Placement
- evaluated rules
- condition results
- winning rule
- selected Paywall Version
- Product readiness
- fallback path
- final outcome
- decision trace

### Decision Diagnostics

Each Placement result should support safe development diagnostics containing:

- Placement key
- Configuration Release ID
- evaluated rule IDs
- winning rule
- decision reason
- fallback reason
- Product-readiness result
- identity-key type
- bucketing-algorithm version

Do not expose sensitive user attributes unnecessarily.

### Dashboard

Implement:

- Placement list
- Placement detail
- rule builder
- rule priority
- audience conditions
- percentage rollout
- QA overrides
- Product and Entitlement conditions
- fallback configuration
- simulator
- decision trace
- unreachable-rule warnings
- conflict warnings
- archive and usage inspection

### SDKs

Flutter, SwiftUI, and Compose must support:

- local rule evaluation
- typed user attributes
- identify
- reset identity
- Placement decision result
- `no_paywall`
- deterministic rollout
- Product-readiness fallback
- development diagnostics
- offline operation

### Explicit Exclusions

Do not implement:

- experiments
- statistical result reporting
- analytics dashboards
- AI targeting
- arbitrary remote code
- server request on every Placement
- automatic Product substitution
- automatic Entitlement assumptions

### Exit Criteria

- applications use stable Placement names
- basic Phase 3 Placement APIs remain compatible
- rules evaluate deterministically
- rule priority is explicit
- conflicts are detected
- percentage rollout remains stable
- local offline evaluation works
- nonmatching users continue safely
- `no_paywall` works
- unknown Entitlement state is preserved
- unavailable Products trigger defined fallback
- targeting can change without an application release
- user attributes are typed and allow-listed
- identity aliasing is documented
- the simulator explains the final decision
- decision traces are debuggable
- no workflow ends in a dead end

### Review Gate 5

Create:

```text
docs/reviews/phase-5.md
```

The Phase 5 demo is:

> Call one Placement and show different published Paywalls for iOS, Android, application version, locale, Product availability, Entitlement state, and user attributes while preserving deterministic offline decisions.

Release milestone:

> Public Alpha

Classify Phase 5 as:

- Accepted
- Accepted with tracked follow-ups
- Rejected pending fixes

---

## Phase 6: Analytics, Identity, and Privacy

### Objectives

- provide reliable Paywall, Product, commerce, and Placement analytics
- preserve attribution to immutable versions
- distinguish client-observed outcomes from provider-confirmed outcomes
- provide a stable identity model
- ensure analytics never block rendering or purchasing
- establish privacy and data-governance controls

### Event Contract

Define a versioned Analytics Event Contract.

Every event should include where applicable:

- event ID
- event-schema version
- occurred-at timestamp
- received-at timestamp
- Organization ID
- Project ID
- Environment ID
- Application ID
- anonymous installation ID
- optional application user ID
- session ID
- platform
- SDK version
- application version
- Configuration Release ID
- Placement ID
- rule ID
- Paywall ID
- Paywall Version ID
- Product ID
- Plan ID
- provider
- experiment ID and Variant ID where applicable later
- typed event properties

### Event Taxonomy

Support events such as:

#### Placement

- Placement requested
- Placement matched
- Placement returned no Paywall
- Placement fallback used
- Placement failed

#### Paywall

- Paywall presented
- Paywall dismissed
- Paywall render failed
- Paywall action selected

#### Product

- Product load started
- Product load completed
- Product load failed
- Product unavailable
- Product selected

#### Purchase

- purchase started
- purchase completed on client
- purchase pending
- purchase cancelled
- purchase failed

#### Restore

- restore started
- restore completed
- restore found nothing
- restore failed

Client-observed purchase completion must remain distinguishable from provider-confirmed transaction completion.

Provider-confirmed transaction completion is available only when a provider supplies a trusted confirmation path.

### Delivery Semantics

Use:

> At-least-once SDK delivery with idempotent server ingestion.

SDK delivery must support:

- local queue
- batching
- bounded retry
- bounded backoff
- local storage limits
- lifecycle-aware flushing
- request cancellation
- event expiry
- explicit drop policy
- nonblocking rendering
- nonblocking purchasing

An analytics failure must never block:

- Placement evaluation
- Paywall rendering
- Product loading
- purchase
- restore

### Event Ingestion

Implement:

- batch endpoint
- environment-scoped SDK authentication
- idempotency by event ID
- schema-version validation
- bounded payload size
- rate limiting
- safe rejection
- ingestion telemetry
- tenant isolation
- retention metadata

Do not introduce Kafka, ClickHouse, or another analytics database solely because future scale may require it.

Use the existing architecture until measured load justifies an ADR.

### Identity

Support:

- anonymous installation identity
- optional application user identity
- aliasing
- logout or identity reset
- cross-session continuity
- identity merge audit
- deleted-user handling
- no advertising-ID dependency

Identity merge rules must be deterministic.

Do not merge users based on email, display name, or heuristic similarity.

### Metrics

Dashboard metrics should include:

- Paywall impressions
- dismissals
- Product selections
- purchase starts
- client-observed purchase completions
- provider-confirmed completions where available
- conversion rate
- Product conversion
- Plan conversion
- Placement performance
- Paywall performance
- Paywall Version comparison
- provider error breakdown
- Product-availability failures
- platform breakdown
- locale breakdown
- export

### Metric Definitions

Every metric must document:

- numerator
- denominator
- event basis or unique-user basis
- attribution window
- timezone
- identity handling
- retry handling
- duplicate handling
- cancelled and pending outcome handling
- client-observed versus provider-confirmed basis

Do not show a metric named only `Conversion` without defining it.

### Attribution

Events must remain attributable to:

- exact Configuration Release
- exact Placement rule
- exact Paywall Version
- exact Mosaic Product
- provider
- application
- Environment

Historical definitions must not change when current Paywalls or Products are updated.

### Privacy and Data Governance

Implement:

- data minimization
- attribute allow-listing
- consent-aware collection where required
- retention configuration
- user-data export
- user-data deletion
- Organization isolation
- server-side filtering
- audit events
- sensitive-property redaction
- documented data inventory
- no unnecessary personal information

Do not collect raw Paywall text, secrets, store credentials, or full request bodies by default.

### Dashboard

Implement:

- analytics overview
- Placement funnel
- Paywall funnel
- Product funnel
- Paywall Version comparison
- provider errors
- Product-availability failures
- platform and locale filtering
- Environment filtering
- metric definitions
- event export
- retention settings
- user-data export and deletion workflows

### Explicit Exclusions

Do not implement:

- MRR
- ARR
- LTV
- financial reconciliation
- cohort analysis
- predictive analytics
- revenue forecasting
- AI insights
- experiment statistics

### Exit Criteria

- analytics does not block UI or purchasing
- event ingestion is idempotent
- event schemas are versioned
- events remain attributable to immutable versions
- Placement funnels are visible
- Paywall funnels are visible
- Product funnels are visible
- client and provider-confirmed outcomes are distinct
- Product and provider failures are visible
- retries work
- identity aliasing is deterministic
- user-data export works
- user-data deletion works
- retention is configurable
- metric definitions are visible
- metrics filter by Project and Environment
- privacy controls are documented

### Review Gate 6

Create:

```text
docs/reviews/phase-6.md
```

The Phase 6 demo is:

> Trace users from Placement request to Paywall presentation, Product selection, purchase start, and completion for one exact Paywall Version and Product, then export or delete one user’s data.

Release milestone:

> Public Beta

Classify Phase 6 as:

- Accepted
- Accepted with tracked follow-ups
- Rejected pending fixes

---

## Phase 7: Experiments

### Objectives

- enable valid Paywall and Product-presentation experiments without application-code changes
- preserve deterministic assignment
- support offline assignment
- preserve immutable attribution
- report results without overstating certainty

### Experiment Model

An Experiment should contain:

- stable Experiment ID
- Project and Environment
- Placement
- control Variant
- one or more treatment Variants
- immutable Paywall Version references
- immutable Configuration Release references
- targeting
- allocation
- assignment-key policy
- bucketing-algorithm version
- start and end times
- status
- primary metric
- guardrail metrics
- traffic-allocation history

### Variant Model

Each Variant references immutable resources.

A Variant must not mutate during an active Experiment.

Changing a Variant creates:

- a new Paywall Version
- a new Variant version
- or a new Experiment

Changing a Provider Product Mapping must not silently change an active Variant.

### Assignment

Implement:

- versioned bucketing algorithm
- stable assignment-key definition
- SDK-local assignment for offline operation
- anonymous installation assignment
- identified-user assignment
- cross-device assignment where supported
- persistent assignment
- weighted allocation
- QA override

The same identity and Experiment version must receive the same Variant.

### Exposure

Assignment alone does not count as exposure.

Exposure occurs only when the Variant Paywall is actually presented.

Exposure events must include:

- Experiment ID
- Variant ID
- Paywall Version ID
- Configuration Release ID
- Placement ID
- assignment-key type
- bucketing-algorithm version
- exposure timestamp

### Experiment Safety

Implement:

- broken-Variant emergency stop
- pause and resume
- scheduled start and end
- traffic-allocation history
- sample-ratio mismatch detection
- minimum-sample warnings
- overlapping-Experiment warnings
- mutual-exclusion groups
- Product-availability comparison
- provider-capability comparison
- fallback detection
- guardrail metrics

### Statistical Reporting

Use an explicitly documented statistical method.

Reports should include:

- sample size
- conversion estimate
- confidence interval or equivalent uncertainty
- allocation
- exposure count
- conversion count
- observation window
- data freshness
- sample-ratio warnings
- guardrail changes

Do not display a simplistic `Winner` label based only on raw conversion percentages.

### Supported Experiment Variables

Experiments may test:

- Paywall layout
- copy
- Product ordering
- default selected Product
- Product-set composition
- trial messaging
- annual versus monthly emphasis
- image or media presentation
- CTA treatment

Do not mutate provider Product mappings inside an active Variant.

### Dashboard

Implement:

- Experiment list
- Experiment creation
- control and Variant selection
- allocation editor
- targeting
- QA overrides
- start and end
- result reporting
- sample-ratio warnings
- overlap warnings
- mutual-exclusion configuration
- emergency stop
- raw-event export
- Experiment history

### Explicit Exclusions

Do not implement:

- automatic winner selection
- AI Experiment recommendations
- predictive Experiment outcomes
- automated traffic reallocation
- autonomous publishing

### Exit Criteria

- assignment is deterministic
- offline assignment works
- identified-user assignment works across devices where supported
- Variants remain immutable
- exposure occurs only after presentation
- results remain attributable to exact versions
- allocation history is preserved
- sample-ratio mismatches are detected
- minimum-sample warnings are shown
- overlapping Experiments are warned or isolated
- Product-availability differences are detected
- broken Variants can be stopped safely
- QA users can force a Variant
- uncertainty is shown
- raw data can be exported

### Review Gate 7

Create:

```text
docs/reviews/phase-7.md
```

The Phase 7 demo is:

> Split users between two immutable Paywall Variants, preserve offline and identified-user assignment, record exposure only after presentation, detect a sample-ratio issue, and compare purchase conversion with documented uncertainty.

Release milestone:

> v1 Feature Complete

Classify Phase 7 as:

- Accepted
- Accepted with tracked follow-ups
- Rejected pending fixes

---

## Phase 8: Operational Hardening and v1 General Availability

### Objectives

- make Mosaic reliable to install, operate, upgrade, secure, and recover
- harden Mosaic Cloud and self-hosted deployments
- stabilize public APIs and SDK compatibility
- complete v1 documentation and operational tooling
- move from beta to General Availability

Phase 8 should prioritize hardening over adding new product functionality.

### Deployment and Operations

Implement:

- tested Docker Compose deployment
- production deployment examples
- environment configuration reference
- administrator bootstrap
- health checks
- readiness checks
- installation diagnostics
- operational dashboards
- structured logs
- traces
- metrics
- rate limiting
- abuse protection
- resource limits
- graceful shutdown
- worker recovery
- object-storage diagnostics

### Database and Upgrades

Implement:

- migration compatibility policy
- preflight migration checks
- migration status
- migration rollback procedures where safe
- upgrade testing
- downgrade limitations
- release channels
- upgrade notifications
- failed-upgrade recovery
- backup verification
- restore verification
- data-integrity checks
- persistent-volume documentation

A production installation must not silently auto-migrate without an accepted deployment workflow.

### Security

Complete:

- security review
- dependency scanning
- secret scanning
- software-bill-of-materials generation
- session-security review
- API-key review
- provider-secret encryption review
- credential-rotation documentation
- least-privilege deployment guidance
- cross-tenant authorization review
- rate-limit review
- object-storage access review
- vulnerability-reporting policy
- security-contact process
- audit-log review

### API and SDK Stability

Define:

- REST API versioning policy
- Paywall Protocol compatibility policy
- Configuration Delivery compatibility policy
- Commerce Provider Contract compatibility policy
- SDK semantic-versioning policy
- deprecation policy
- minimum supported SDK window
- migration guides
- release notes
- rollback guidance

### Documentation and Community

Complete:

- installation guide
- local-development guide
- SDK quickstarts
- Flutter guide
- iOS guide
- Android guide
- provider guides
- Product Catalog guide
- publishing guide
- Placement guide
- analytics guide
- Experiment guide
- backup and restore guide
- upgrade guide
- security guide
- troubleshooting guide
- contribution guide
- code of conduct
- release notes
- support workflow

### Operational Verification

Demonstrate:

- clean installation
- upgrade from the previous supported release
- database migration
- failed-migration recovery
- backup
- restore
- API restart
- worker restart
- object-storage restart
- SDK configuration delivery after recovery
- provider-secret rotation
- public SDK-key rotation

### Exit Criteria

A production installation can be:

- installed
- configured
- upgraded
- backed up
- restored
- monitored
- secured
- recovered from a failed migration
- recovered from a failed process
- operated using documented procedures

Additional criteria:

- Docker Compose starts a complete installation
- production examples are tested
- backup and restore are demonstrated
- upgrade paths are documented and tested
- critical security findings are resolved
- operational alerts are actionable
- public APIs have compatibility policies
- SDKs have stable compatibility policies
- v1 documentation covers the complete workflow
- no known critical data-loss path remains

### Review Gate 8

Create:

```text
docs/reviews/phase-8.md
```

Classify v1 readiness as:

- Ready for General Availability
- Ready with documented limitations
- Not ready

The Phase 8 demo is:

> Install Mosaic, publish a Paywall, upgrade the deployment, rotate credentials, restore from backup, and verify that SDK configuration delivery and provider integrations continue working.

Release milestone:

> v1 General Availability

---

## Phase 9: Mosaic Billing Program

### Conditional Entry Gate

Phase 9 begins only when post-v1 adoption demonstrates meaningful demand for replacing RevenueCat or equivalent subscription infrastructure.

The entry review must provide evidence such as:

- design-partner requests
- public user demand
- migration intent
- provider-cost concerns
- self-hosting requirements
- need for authoritative cross-platform Entitlements

Mosaic Billing remains optional.

Teams may continue using:

- RevenueCat
- StoreKit 2
- Google Play Billing
- custom providers

Using Studio, Products, Paywalls, Placements, analytics, and Experiments must not require Mosaic Billing.

### Objectives

- validate Apple and Google transactions server-side
- ingest provider notifications reliably
- maintain an auditable subscription-state engine
- compute authoritative customer Entitlement state
- preserve historical Product meaning
- support migration, reconciliation, and repair
- keep billing events replayable

---

### Gate 9A: Transaction Ingestion and Validation

Implement:

- Apple transaction validation
- Google purchase validation
- App Store Server Notifications
- Google Real-time Developer Notifications
- sandbox and production isolation
- encrypted store credentials
- credential rotation
- idempotent transaction ingestion
- append-only billing-event log
- raw notification retention policy
- transaction-to-Mosaic-Product resolution
- Provider Product Mapping history
- unknown Product quarantine
- duplicate-event handling
- ordering handling
- retry handling
- reconciliation jobs
- replayable ingestion
- validation diagnostics
- audit events

Do not update customer access directly from an unvalidated client event.

### Gate 9A Exit Criteria

- Apple transactions validate
- Google purchases validate
- notifications ingest idempotently
- duplicates do not duplicate billing state
- unknown Products are quarantined
- sandbox and production are isolated
- credentials are protected
- events are replayable
- reconciliation detects missing or conflicting state

Create:

```text
docs/reviews/phase-9a.md
```

---

### Gate 9B: Subscription State and Entitlements

Implement:

- unified customer model
- anonymous and identified aliases
- cross-platform identity
- subscription-state machine
- active state
- expired state
- grace-period state
- billing-retry state
- revoked state
- refunded state
- upgrade
- downgrade
- restore synchronization
- versioned Product-to-Entitlement grants
- authoritative Entitlement computation
- server-side Entitlement API
- state history
- state replay from billing events
- concurrency controls
- audit trail

State computation:

```text
Validated Transaction
+ Mosaic Product
+ Versioned Entitlement Grants
+ Subscription State
= Customer Entitlement State
```

Historical transactions must continue to resolve using the Product and grant history required to preserve their meaning.

A Product replacement must not remove access from customers who purchased an earlier Product.

### Gate 9B Exit Criteria

- customer state is deterministic
- replay produces the same state
- renewals update state
- expiration updates state
- grace periods update state
- billing retry is represented
- refunds and revocations update access
- upgrades and downgrades preserve history
- cross-platform identity is documented
- Entitlement API is authorized and auditable
- Product replacement preserves purchase meaning

Create:

```text
docs/reviews/phase-9b.md
```

---

### Gate 9C: Migration, Reconciliation, and Operations

Implement:

- RevenueCat migration tools
- customer import
- transaction import
- customer aliases
- cross-platform identity reconciliation
- Product replacement history
- provider Product migration
- migration dry run
- migration validation
- migration rollback strategy
- the remainder of the billing webhook subsystem beyond the Gate 9B
  minimal slice (owner decision OD-1(b), 2026-07-28): the nine
  reserved event types beyond `customer.entitlements.changed`,
  dashboard webhook destination and delivery UI, and any further
  delivery tooling. Gate 9B shipped the minimal slice: one emitted
  event type, HMAC signing with rotation, at-least-once delivery with
  bounded backoff, append-only attempt history, SSRF-screened
  API-only destination management, and an audited operator
  delivery-replay endpoint.
- manual reconciliation
- repair tools
- invalid mapping diagnostics
- quarantined-event review
- support tooling
- operational dashboards
- operational runbooks

Migration must not require users to stop using existing providers before validation is complete.

### Gate 9C Exit Criteria

- migration dry run works
- imported customers reconcile
- imported Products map correctly
- invalid mappings are visible
- migration rollback is documented
- webhooks retry and remain auditable
- repair tools are permission-protected
- operational alerts are actionable
- runbooks cover common failures

Create:

```text
docs/reviews/phase-9c.md
```

---

### Phase 9 Exit Criteria

Phase 9 is complete only when Gates 9A, 9B, and 9C are accepted.

The consolidated review must confirm:

- transaction validation is reliable
- ingestion is idempotent
- billing events are append-only and replayable
- unknown Products are quarantined
- Entitlement state remains consistent
- refunds and revocations update access
- Product replacements preserve historical meaning
- cross-platform identity is documented and tested
- migration and rollback procedures exist
- webhooks retry safely
- repair workflows are auditable
- Mosaic Billing remains optional

### Review Gate 9

Create:

```text
docs/reviews/phase-9.md
```

The Phase 9 demo is:

> Complete a purchase, validate the provider transaction, resolve it to a Mosaic Product, apply versioned Entitlement grants, update customer access, replay the billing events, and notify the application backend.

Release milestone:

> Optional Mosaic Billing Availability

---

## Phase 10: AI Assistance

### Objectives

- add optional AI assistance after Mosaic has reliable authoring, publishing, commerce, analytics, and Experiment foundations
- improve authoring and analysis without removing human control
- keep every AI action reviewable
- preserve normal Mosaic operation when AI is disabled
- protect Organization data boundaries

Phase 10 is divided into:

- Gate 10A — Authoring Assistance
- Gate 10B — Monetization Insights

### AI Foundation

Implement:

- model-provider abstraction
- Organization-level opt-in
- Project-level configuration
- role-based access
- usage and cost limits
- prompt and output audit metadata
- data-retention configuration
- sensitive-data filtering
- timeout and retry handling
- graceful provider failure
- provider disable switch
- evaluation datasets
- quality monitoring

Do not train on Organization data without explicit permission.

Do not require AI for normal Mosaic workflows.

---

### Gate 10A: Authoring Assistance

Support:

- generate a Paywall draft from a prompt
- generate structured Protocol-valid output
- copy suggestions
- headline alternatives
- CTA alternatives
- localization assistance
- layout recommendations
- accessibility suggestions
- component suggestions
- theme suggestions
- explain validation errors
- reviewable document diff
- accept individual changes
- reject individual changes
- undo accepted changes

AI-generated documents must:

- conform to a supported Paywall Protocol
- use supported components only
- preserve stable Product IDs
- avoid inventing Product mappings
- avoid inventing prices
- avoid inventing analytics
- remain editable in Studio

AI must never publish automatically.

### Gate 10A Exit Criteria

- generated drafts validate
- unsupported components are not generated
- Product IDs are not fabricated
- generated copy is reviewable
- diffs are visible
- individual suggestions can be accepted or rejected
- undo works
- accessibility suggestions explain their basis
- AI failure does not affect Studio

Create:

```text
docs/reviews/phase-10a.md
```

---

### Gate 10B: Monetization Insights

Support:

- funnel explanations
- conversion-change investigation
- anomaly detection
- Paywall Version comparison
- Product performance explanation
- provider-error explanation
- localization regression detection
- accessibility regression detection
- Experiment suggestions
- proposed Variant generation
- evidence-linked recommendations

Every recommendation must identify:

- observed data
- metric definition
- time window
- affected Paywall Version
- affected Product
- affected Placement
- confidence or uncertainty
- whether the statement is observation or inference

AI must not fabricate causality.

Use phrasing such as:

```text
Observed:
Purchase-start rate decreased after Release 42.

Possible explanation:
Android Product-load failures increased during the same period.
```

Do not state an inferred cause as proven fact.

AI must never:

- publish a Paywall
- start an Experiment
- change Product mappings
- change pricing
- change active providers
- modify Entitlements

without explicit user approval through the normal product workflow.

### Gate 10B Exit Criteria

- recommendations cite Mosaic data
- metric definitions are included
- observations and inferences are distinct
- affected versions are identified
- users can inspect supporting evidence
- suggested Experiments remain drafts
- AI cannot publish or activate changes
- Organization data remains isolated
- AI can be disabled without affecting Mosaic

Create:

```text
docs/reviews/phase-10b.md
```

---

### Phase 10 Exit Criteria

Phase 10 is complete only when Gates 10A and 10B are accepted.

The consolidated review must confirm:

- AI remains optional
- normal Mosaic operation does not depend on AI
- structured output is Protocol-valid
- Product IDs and prices are not invented
- recommendations cite observed data
- uncertainty is visible
- users review all changes
- AI cannot publish automatically
- AI cannot start Experiments automatically
- AI cannot change commerce configuration automatically
- data boundaries and retention are documented

### Review Gate 10

Create:

```text
docs/reviews/phase-10.md
```

The Phase 10 demo is:

> Generate a reviewable Paywall draft, accept selected changes, then ask why conversion changed and receive an evidence-linked explanation plus a draft Experiment proposal that cannot run without approval.

Classify Phase 10 as:

- Accepted
- Accepted with tracked follow-ups
- Rejected pending fixes

---

# Updated Review Files

Use:

```text
docs/reviews/
├── phase-0.md
├── phase-1.md
├── phase-2.md
├── phase-2.5a.md
├── phase-2.5b.md
├── phase-2.5c.md
├── phase-2.5.md
├── phase-3a.md
├── phase-3b.md
├── phase-3.md
├── phase-4a.md
├── phase-4b.md
├── phase-4.md
├── phase-5.md
├── phase-6.md
├── phase-7.md
├── phase-8.md
├── phase-9a.md
├── phase-9b.md
├── phase-9c.md
├── phase-9.md
├── phase-10a.md
├── phase-10b.md
└── phase-10.md
```