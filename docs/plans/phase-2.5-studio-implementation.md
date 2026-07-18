# Phase 2.5 Studio Implementation Contract

**Status:** Gate 2.5A frozen for implementation; Gate 2.5B owner-approved addendum  
**Date:** 2026-07-17  
**Phase gate:** Phase 2 is **Accepted with tracked follow-ups** and explicitly authorizes Phase 2.5.

## Purpose

Phase 2.5 turns the accepted local Phase 2 editor into a dedicated, canvas-first Studio. It changes the editor's information architecture and interaction model while preserving the frozen Mosaic Paywall Protocol `0.1`, Local Preview `0.1`, native renderers, local project format, and local-only product boundary.

This contract integrates the Stage 1 dashboard, UX, product, and quality reviews. It is the frontend implementation boundary for Phase 2.5.

This document is now specifically the **Gate 2.5A** contract. The product owner subsequently
approved a separate **Gate 2.5B — Protocol 0.2 Styling and Component Expansion**. That addendum is
frozen in `docs/plans/phase-2.5b-protocol-0.2-expansion.md`. It does not retroactively authorize
Protocol `0.2` work inside Gate 2.5A, and it does not invalidate the Protocol `0.1` behavior and
Studio UX decisions recorded here. Phase 3 remains blocked until both gates pass.

## Authority and resolved decisions

The following order resolves contradictions in older planning material:

1. Canonical Mosaic Paywall Protocol `0.1` and Local Preview `0.1` contracts.
2. The accepted Phase 2 review and its tracked follow-ups.
3. The product owner's Phase 2.5 brief and the current Phase 2.5 roadmap.
4. The older agentic plan where it does not conflict with the items above.

The older agentic plan's omission of Phase 2.5 does not block this owner-directed phase. No
protocol or SDK expansion is approved **by Gate 2.5A**. Gate 2.5B is the separate explicit owner
approval for the frozen Protocol `0.2` vertical slice.

| Question surfaced in Stage 1                                   | Resolution for Phase 2.5                                                                                                                                                                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container and Spacer appear in examples but not Protocol `0.1` | Exclude them. Do not show disabled future components.                                                                                                                                                                         |
| Scroll Container is supported but is the document root         | Show it as the non-insertable root in Layers; do not offer it in Add content.                                                                                                                                                 |
| Vertical Stack is supported but not currently insertable       | Add visual creation, inspection, nesting, duplication, and reordering for Vertical Stack.                                                                                                                                     |
| Inspector examples contain unsupported style fields            | Render only canonical Protocol `0.1` properties. Do not invent font, color, border, background, visibility, margin, or trial fields.                                                                                          |
| Preview controls exceed Local Preview `0.1`                    | Keep device, orientation, zoom, fit, appearance, safe-area, and forced RTL as labeled browser-canvas preferences. Continue sending only supported locale, text scale, document, and mock-commerce data to native clients.     |
| Mock-commerce loading is not in Local Preview `0.1`            | Exclude a native loading outcome. Preserve the accepted mock outcomes and product availability states.                                                                                                                        |
| Layers versus Paywall order                                    | Use **Layers** as the tool name and **Paywall structure** or **Paywall order** as helper copy.                                                                                                                                |
| Components versus Add                                          | Use **Components** in the activity rail and command names; use **Add content** as the panel heading.                                                                                                                          |
| Product terminology                                            | Use **Products**, **Available plans**, and **Purchase simulation** in primary UI. Keep protocol type names in diagnostics/advanced details.                                                                                   |
| Paywall name has no display-name field                         | Show a read-only humanized document identifier/template label. Do not add or edit protocol metadata.                                                                                                                          |
| Manual Save versus autosave                                    | Show **Saving locally**, **Saved locally**, or **Autosave failed**. Do not add a manual Save or Publish action.                                                                                                               |
| Back destination                                               | The toolbar Back action returns to `/foundation`; template replacement remains a separate explicit Studio action.                                                                                                             |
| Multiple Product Selectors                                     | Permit the combinations allowed by Protocol `0.1`; purchase buttons expose their selector binding. Do not retain the Phase 2 UI-only singleton restriction.                                                                   |
| Rename, lock, and hide have no protocol representation         | Treat them as clearly labeled Studio-only layer metadata. They never modify, autosave, export, or transmit the paywall document and never enter document undo history.                                                        |
| Canvas selection versus commerce interaction                   | The browser canvas remains an editing surface: click selects and double-click edits supported text. Commerce interaction remains in Purchase simulation and connected native previews; no separate interact mode is required. |
| Feature-list items as layers                                   | Keep them inside the Feature List inspector because they are not protocol component nodes. Provide item editing and reordering there.                                                                                         |
| Required design-system packages without a root JS workspace    | Create narrowly scoped local packages and consume them from the dashboard through explicit local package dependencies. Do not introduce a repository-wide package-manager migration.                                          |

These resolutions leave no owner-level blocker for Gate 2.5A. Any Gate 2.5A implementation that
would change a protocol, preview message, fixture, or SDK must stop. Gate 2.5B changes only the
artifacts expressly assigned by its separate contract. It preserves Local Preview `0.1` and adds
the explicitly versioned Local Preview `0.2` schemas, messages, fixtures, subprotocol, and
capability negotiation required to carry Protocol `0.2`.

## Baseline to preserve

The implementation must preserve:

- template selection and autosave recovery;
- portable Protocol `0.1` JSON import/export;
- local-project recovery and mock-commerce separation;
- document undo/redo and the 50-entry history boundary;
- canonical and editor-friendly validation;
- Local Preview WebSocket behavior, capability reporting, acknowledgements, diagnostics, and reconnect handling;
- Flutter, SwiftUI, and Compose compatibility;
- TanStack Start, Router, Query, and Form;
- Tailwind CSS, shadcn/ui on Base UI, and Phosphor icons;
- the absence of Radix UI and Lucide application imports.

Before Phase 2.5, the dashboard baseline passes 50/50 Vitest tests, 6/6 relay tests, and 108/108 protocol tests.

## Workspace information architecture

```text
Studio toolbar
├── Back to dashboard
├── Paywall identity (read-only)
├── Local save status
├── Undo / Redo
├── Connected-preview summary
├── Preview controls
├── Import
├── Export
└── Commands

Fixed activity rail
└── Resizable vertical workspace
    ├── Resizable horizontal main workspace
    │   ├── Left tool panel
    │   ├── Canvas
    │   └── Property inspector
    └── Diagnostics panel
```

The `/studio` route must not compose `AppShell`, `AppSidebar`, `SidebarProvider`, or the dashboard header. Other dashboard routes keep the normal shell.

### Toolbar

The toolbar contains:

- Back to dashboard (`/foundation`);
- humanized paywall identifier/template label, read-only;
- `Saving locally`, `Saved locally`, or `Autosave failed` state, including a retry action on failure;
- undo and redo with disabled states and shortcuts;
- connected native-preview summary;
- common canvas preview controls;
- Import and Export;
- command-palette trigger.

It must not contain Publish, hosted save, organization, environment, release, placement, analytics, experiment, or real-billing actions.

### Activity rail

The fixed rail is `52px` wide and remains outside every resizable panel group. One tool is selected at a time.

| Destination  | Purpose                                                              | Empty/dead-end behavior                                                        |
| ------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Layers       | Actual Protocol `0.1` hierarchy; default tool                        | Always shows the root scroll container and its content stack.                  |
| Components   | Searchable **Add content** library                                   | Shows only insertable, renderer-supported Protocol `0.1` nodes.                |
| Templates    | Preview and explicitly replace the local draft                       | Replacement is confirmed, undoable, and accurately explains autosave behavior. |
| Products     | Product bindings, mock availability, prices, and purchase simulation | Uses local/mock data only; no provider setup prompt.                           |
| Localization | Edit existing locale strings and select preview language             | Never implies hosted localization or machine translation.                      |
| Assets       | Select and inspect existing bundled Protocol `0.1` image assets      | No upload/cloud dead end; explain that Phase 2.5 uses bundled assets.          |
| Settings     | Workspace reset, preview defaults, and shortcut reference            | Contains only local Studio settings.                                           |

Every rail control uses a Phosphor icon, accessible name, tooltip, selected state, visible focus, and shortcut hint where applicable. Clicking the selected tool collapses or expands the left panel without losing the selected component.

Validation and connected clients belong in Diagnostics, not in the rail. Preview controls belong with the canvas, not in the rail.

## Resizable workspace contract

Feature code imports only:

```tsx
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
```

Only `src/components/ui/resizable.tsx` may import `react-resizable-panels`. It is the current shadcn-generated wrapper, adjusted only for Mosaic styling and a Phosphor handle icon. Feature code must not implement pointer math, mouse math, CSS resize, a split-pane primitive, or a second resize dependency.

Resizable panels and handles remain direct children of their group.

### Stable identifiers

- `studio-root-group`
- `studio-main-panel`
- `studio-diagnostics-panel`
- `studio-horizontal-group`
- `studio-left-panel`
- `studio-canvas-panel`
- `studio-properties-panel`
- `studio-left-handle`
- `studio-right-handle`
- `studio-diagnostics-handle`

### Constraints

| Area               |   Default | Minimum |   Maximum |            Collapsed |
| ------------------ | --------: | ------: | --------: | -------------------: |
| Activity rail      |    `52px` |  `52px` |    `52px` |                never |
| Left tool panel    |   `300px` | `240px` |   `440px` |                `0px` |
| Property inspector |   `360px` | `300px` |   `560px` |                `0px` |
| Diagnostics        |   `220px` | `140px` |    `45vh` | compact status strip |
| Canvas             | remaining | `420px` | remaining |                never |

Every visible separator uses `<ResizableHandle withHandle />`, keeps its separator semantics and keyboard behavior, and preserves the underlying double-click reset. Collapse/expand controls and command actions call the panel APIs rather than replacing them.

### Responsive behavior

- **Large desktop (`>= 1440px`)**: rail + left panel + canvas + inspector; default sizes above.
- **Medium desktop (`1120px`–`1439px`)**: rail + narrower constrained left panel + canvas + narrower constrained inspector.
- **Compact laptop (`768px`–`1119px`)**: rail + canvas + one active left tool panel; properties render in the existing Base UI/shadcn sheet. Selection is preserved when the sheet opens or closes.
- **Below `768px`**: provide a clear desktop-required state with safe access to the current local draft/export; a full phone editor is out of scope.

The runtime must prefer reducing panels, then collapsing the inactive left panel, then moving properties to a sheet. The canvas must never render below `420px` wide.

## State and persistence boundaries

### Paywall document

The canonical document remains the only source of exportable paywall semantics. Document mutations enter undo history, mark the draft dirty, autosave through the existing local-project path, validate, and may be sent to connected preview clients.

### Local project wrapper

The accepted Local Preview `0.1` wrapper remains unchanged. Its locale/text-scale fields remain for contract compatibility. Workspace preferences are authoritative when valid; local-project preview fields are a fallback for older/missing workspace data. A preview-only change must not itself trigger document autosave.

### Workspace preferences

Use the versioned key:

```text
mosaic:studio:workspace:v1
```

Persist only validated local Studio state:

- completed left, property, and diagnostics panel sizes;
- panel collapsed states;
- selected Studio tool;
- selected preview device and orientation;
- zoom and fit mode;
- selected locale and forced RTL state;
- canvas appearance and text scale;
- safe-area state;
- supported preview settings;
- Studio-only layer labels, locked IDs, and canvas-hidden IDs;
- recently inserted supported component types.

Storage reads and writes are guarded for unavailable/quota-limited local storage. The value has an explicit schema version. Missing, incomplete, malformed, incompatible, non-finite, or out-of-range values restore the complete default layout; partial unvalidated application is forbidden.

Durable panel writes occur only from the resizable implementation's completed-layout callback, never on every pointer movement. Frequent transient resize and hover values must not force whole-editor subscriptions or document renders.

Workspace state must never:

- modify the Mosaic document;
- trigger document autosave by itself;
- create undo/redo history;
- enter portable exported JSON;
- enter preview messages as document properties;
- alter the Local Preview or SDK contract.

Reset Workspace Layout is available from Settings, the command palette, and the keyboard-accessible toolbar/menu path.

## Canvas interaction model

The canvas is the largest visual region and remains visible while properties are edited.

It supports:

- centered device preview;
- iPhone, Android phone, and tablet presets;
- separate portrait/landscape orientation;
- zoom in/out, reset to `100%`, and fit-to-area;
- locale, locale-derived direction, and explicit browser-canvas RTL override;
- text scale;
- light/dark browser-canvas appearance;
- safe-area visualization;
- mock product availability and accepted mock-commerce outcomes;
- selected, hovered, locked, and Studio-hidden boundaries/states.

Device, orientation, zoom, appearance, safe area, and forced RTL are labeled **Canvas preview** settings. Only contract-supported locale, text scale, mock commerce, and document revisions reach connected native previews.

Interaction rules:

- click selects without entering text edit;
- hover highlights and synchronizes with Layers;
- double-click eligible text/legal/button labels to edit;
- Enter confirms a single-line edit; Shift+Enter may add a newline where valid; Escape cancels;
- selection is preserved after edit and panel resizing;
- Arrow navigation moves between visible editable nodes when the canvas owns focus;
- rendered nodes retain protocol-appropriate HTML semantics instead of becoming generic buttons;
- generic editor frames provide selection and highlighting without becoming document controls;
- reorder, reparent, duplicate, delete, lock, hide, and contextual layer actions live in Layers;
- canvas nodes are not draggable; Layers owns pointer and keyboard structural movement;
- global shortcuts do nothing while a text input, textarea, select, contenteditable, or command search owns the keystroke, except explicitly scoped confirmation/cancellation shortcuts.

Property and inline typing update the browser canvas immediately. Related keystrokes/slider motion form one explicit edit transaction and one undo entry rather than flooding history.

## Layer-tree interaction model

Layers render the actual recursive Protocol `0.1` tree with tree semantics:

- non-insertable Scroll Container root;
- root Vertical Stack;
- nested Vertical Stacks and supported child components;
- indentation, disclosure, `aria-level`, `aria-expanded`, and `aria-selected`;
- synchronized selection and hover;
- ancestor reveal and scroll-to-layer when canvas or validation selects a nested component;
- component-type Phosphor icons;
- validation and compatibility indicators;
- accessible context menus;
- duplicate, rename Studio label, delete, lock, and **Hide in Studio canvas**;
- pointer drag/drop plus keyboard move, nest, and outdent alternatives.

Protocol-valid nesting is deliberately small:

- the Scroll Container owns its existing root Vertical Stack and cannot move;
- Vertical Stack children may be any supported Protocol `0.1` node, including another Vertical Stack;
- non-stack nodes cannot contain children;
- the operation may not leave a Vertical Stack with zero children because the schema requires at least one;
- an invalid drop is rejected without mutation and names the affected nodes, reason, and valid recovery action.

The tree has no permanent selected-layer action toolbar. Each eligible row can initiate drag from
any non-control surface; its grip communicates drag affordance without becoming a required hit
target. Right-click and the overflow button expose the same contextual actions. Duplicate and
delete remain there; nest and outdent appear only when valid for that layer. Inline rename retains
focus until commit or cancel. Keyboard guidance lives in a shortcuts tooltip or dialog rather than
permanent panel copy. Duplicate operations generate fresh component IDs and localization keys and
repair internal purchase-selector references. Multiple Product Selectors are allowed; Purchase
Button binding remains explicit.

Studio-only labels/lock/hide metadata does not alter the protocol tree, native preview, export, document history, or document autosave.

## Protocol-aware component library

The searchable Add content surface exposes exactly:

### Layout

- Vertical Stack

### Content

- Text
- Image
- Feature List

### Commerce

- Product Selector
- Purchase Button
- Restore Button
- Legal Text

### Navigation

- Close Button

It excludes Scroll Container insertion, Container, Spacer, Grid, Video, Icon, multi-page navigation, and every unsupported future component.

Insertion supports pointer drag to a valid target, double-click at the current valid insertion point, and a keyboard Insert action. The UI announces the insertion location and invalid-nesting reason. A small recent list may contain only successfully inserted supported types and is stored as workspace preference data.

## Contextual property inspector

The inspector shows the selected layer icon, user-facing type name, breadcrumb, validation state, and only relevant Protocol `0.1` controls. It uses progressive sections such as Content, Layout, Actions, Accessibility, and Advanced only when fields exist. The primary section opens by default, secondary sections start collapsed, and Advanced remains collapsed unless the user or validation navigation opens it.

Supported coverage includes:

- **Scroll Container:** scroll-indicator visibility; ID, type, fixed vertical axis, safe-area policy, and Content Stack reference in Advanced. The root is selectable but remains non-insertable and structurally immutable.
- **Vertical Stack:** spacing, padding edges, horizontal alignment, and a child summary; ID and type in Advanced.
- **Text:** localized content, title/body/caption style, alignment, and accessibility role/heading level; ID, type, and localization key in Advanced.
- **Legal Text:** localized content, alignment, and accessibility role/heading level; ID, type, and localization key in Advanced.
- **Image:** existing bundled asset, aspect ratio, fit/fill content mode, and decorative/accessible label behavior; ID, type, fixed fill-width policy, and label localization key in Advanced.
- **Feature List:** item spacing, add/edit/remove/reorder benefits, and accessibility label/hint; ID, type, fixed checkmark marker, and localization keys in Advanced.
- **Product Selector:** bound product order, initial selection, item spacing, unavailable message, and accessibility label/hint; ID, type, fixed fallback policies, and localization keys in Advanced.
- **Purchase Button:** label, in-progress label, Product Selector action binding, and accessibility label/hint; ID, type, fixed purchase action, and localization keys in Advanced.
- **Restore Button:** label, in-progress label, and accessibility label/hint; ID, type, fixed restore action, and localization keys in Advanced.
- **Close Button:** label and accessibility label/hint; ID, type, fixed close action, and localization keys in Advanced.

Protocol `0.1` has no text colour, maximum lines, line height, generic width behavior, per-node outer spacing, visual visibility, or Text/Legal Text accessibility-label override. These controls never appear in a `0.1` inspector. Adding them requires an approved, versioned protocol revision and matching Flutter, SwiftUI, and Compose renderer support. Raw JSON is absent from the normal inspector; Import remains a deliberate toolbar/command action and machine details remain in Diagnostics or Advanced.

Each control has a stable property address. Inline validation appears beside the field. Validation navigation opens the inspector/sheet, expands the owning section, and focuses the exact field.

## Validation and diagnostics workflow

Validation remains nonmodal and does not block unrelated editing.

- properties show inline errors/warnings;
- Layers show affected-node badges;
- the collapsed diagnostics strip shows Ready or issue/client counts;
- expanded Diagnostics groups Document, Compatibility, Connected previews, and Advanced details;
- an issue action selects the node, expands all ancestors, reveals the canvas element, opens the relevant inspector section, focuses the property, and preserves canvas position;
- every issue states what is wrong, where, why it matters, and how to recover;
- warning-only states remain editable/export behavior follows the canonical Phase 2 rules;
- document-wide issues without a component navigate to the most relevant document/diagnostic control.

The known multi-error canonical-diagnostic suppression case receives a regression test before validation navigation is broadened.

## Command palette and shortcuts

The Base UI/shadcn command surface provides:

- add supported component;
- open Layers, Components, Products, and Localization;
- undo and redo;
- duplicate and delete selection;
- fit canvas and reset zoom;
- change canvas appearance;
- collapse/expand left panel and property inspector;
- show/collapse diagnostics;
- reset workspace layout;
- import and export document.

Use one coordinated global shortcut listener/registry rather than one listener per command. Shortcuts are discoverable in tooltips, context menus, and the palette, avoid common browser/OS conflicts, and respect all focused editing controls.

## Design-system scope

Create:

```text
packages/design-tokens/
packages/design-system/
```

The packages are local, narrowly scoped frontend packages consumed explicitly by `apps/dashboard`. They do not trigger a repository-wide package-manager migration.

`design-tokens` owns documented semantic CSS tokens for:

- canvas and application surfaces;
- foreground and muted text;
- action and selection states;
- success, warning, destructive, and information states;
- borders, focus rings, elevation, and shadows;
- spacing, typography, radius, and motion duration/easing;
- panel, toolbar, activity-rail, inspector, and resize-handle roles.

`design-system` owns generic React/CSS patterns needed by more than one Studio surface, such as toolbar grouping, panel sections, status treatments, focus rules, and empty/loading/error patterns. It contains no paywall, product, protocol, validation, preview-client, or commerce business logic. shadcn primitives remain in `apps/dashboard/src/components/ui`, including `resizable.tsx`.

Studio must consume both packages. Document token inventory, accessibility rules, reduced motion, responsive behavior, iconography, panel/toolbar patterns, resize handles, forms, contextual menus, and state treatments. Update the frontend convention and dashboard documentation without editing generated files.

## Explicit exclusions

Do not implement:

- Publish or hosted save;
- authentication-dependent editing;
- organizations, hosted projects, environments, cloud synchronization, releases, CDN delivery, or remote configuration;
- real RevenueCat, StoreKit 2, or Google Play Billing;
- placements, analytics ingestion, experiments, AI, collaboration, marketplace behavior, or arbitrary freeform positioning;
- cloud asset upload;
- full phone editing;
- unsupported protocol components or properties;
- Local Preview message changes or SDK changes;
- a custom resize engine, CSS resize, or another split-pane dependency;
- Radix UI or Lucide application icons;
- manual edits to generated route, API, or protocol files.

## Migration and bounded implementation sequence

1. **Behavior lock and state seams**
   - Fix shortcut behavior inside focused controls.
   - Add regression tests for current import/export, history, autosave failure/retry, selection, and workspace/document separation.
   - Add selector-based editor subscriptions and edit transactions before high-frequency hover/drag work.

2. **Design and resize foundation**
   - Create and consume design-token/design-system packages.
   - Generate the shadcn Resizable wrapper from `apps/dashboard`.
   - Replace any generated Lucide handle with Phosphor without changing wrapper behavior.
   - Add generic Base UI/shadcn command/menu primitives only as needed.

3. **Dedicated workspace and persistence**
   - Remove the dashboard shell from `/studio`.
   - Add toolbar, activity rail, nested resizable groups, stable IDs, constraints, collapse/reset, versioned persistence, responsive property sheet, and minimum canvas enforcement.
   - Complete all resizable tests before proceeding.

4. **Editor operations and Layers**
   - Add Stack insertion, transactional operations, duplication, legal reparenting, expand/collapse, tree keyboard behavior, Studio-only labels/lock/hide, hover/selection sync, indicators, and pointer/keyboard reorder.

5. **Production canvas**
   - Add canvas toolbar, device/orientation/zoom/fit/appearance/safe-area/RTL preview settings, semantic component rendering, direct selection, synchronized hover, keyboard navigation, and explicit inline editing. Keep structural actions and drag reorder in Layers.

6. **Components, Products, Localization, Assets, and inspector**
   - Add searchable protocol-aware insertion and useful non-hosted tool panels.
   - Complete contextual inspectors, immediate transactional updates, Feature List item editing, accessibility fields, and inline validation/focus addresses.

7. **Diagnostics and commands**
   - Move document validation, compatibility, native-client status, and details into the resizable diagnostics surface.
   - Complete command palette, shortcut discovery, exact validation navigation, autosave retry, and workspace reset paths.

8. **Gate validation and documentation**
   - Run complete frontend and protocol checks.
   - Perform the required task workflow and one-minute demo where the environment allows.
   - Capture before/after screenshots where an approved browser surface permits it.
   - Complete product, UX, and quality review and write `docs/reviews/phase-2.5.md`.

The dashboard agent is the only agent permitted to modify production frontend code and frontend package/docs paths. UX and product remain read-only. Quality remains read-only except for an explicitly assigned documentation-only task.

## Required automated tests

### Resizable conformance

- horizontal pointer resizing;
- vertical pointer resizing;
- keyboard resizing;
- minimum-size enforcement;
- maximum-size enforcement;
- left/property/diagnostics collapse and expansion;
- double-click reset;
- persisted layout restoration;
- malformed persisted-layout recovery;
- incomplete/incompatible/out-of-range persisted-layout recovery;
- responsive compact fallback;
- `420px` minimum canvas width;
- handle accessible names and visible focus;
- separator roles/semantics;
- workspace reset;
- no document mutation during resize;
- no document undo entry during resize;
- no layout/workspace data in exported paywall JSON.

Tests exercise the shadcn components and underlying panel APIs; they do not test custom resize mathematics because none exists.

### Editor behavior

- Studio route has no dashboard sidebar;
- rail selection, collapse, keyboard navigation, tooltips, and labels;
- actual nested tree expand/collapse and ancestor reveal;
- valid reorder/reparent and rejected invalid nesting with recovery copy;
- Layers pointer drag and keyboard movement alternatives;
- duplicate/delete/rename/lock/Studio-hide behavior and document separation;
- canvas/layer selection and hover synchronization;
- selection survives panel resizing and compact inspector sheet transitions;
- click selects and double-click edits;
- inline confirm, cancel, selection retention, localization, validation, and one-step undo;
- focused input/select/contenteditable shortcut safety;
- searchable component filtering against the exact supported list;
- drag, double-click, and keyboard insertion;
- contextual inspector fields and immediate grouped updates;
- validation-to-layer/section/property navigation;
- property/layer/document/compatibility messages remain nonmodal;
- command-palette actions and shortcut discovery;
- autosave retry and template-replacement safety;
- import, export, autosave, undo, redo, mock commerce, and preview connection regressions;
- preview/workspace settings remain outside document history/export.

### Dependency and architecture checks

- only the shadcn wrapper imports `react-resizable-panels`;
- exactly one resizable dependency;
- no custom resize implementation patterns;
- no Radix packages/imports;
- no Lucide package/application imports;
- no protocol, fixture, generated, SDK, API, or worker changes;
- design-system components contain no paywall business logic;
- package and browser bundle growth is reported.

## Incremental validation

After each package, run the narrow relevant tests followed by:

```bash
npm run format
npm run lint
npm run typecheck
npm run test
```

Use `npm run format:check` when no formatting write is intended. After Stage 2, run `npm run check`, protocol validation, dependency scans, `git diff --check`, and inspect the complete diff. Do not enter Stage 3 with blocking failures.

## Usability and demo evidence

The acceptance path is the owner-provided workflow:

1. open Studio;
2. select a template;
3. resize left and property panels;
4. select from canvas;
5. edit headline inline;
6. insert a supported component;
7. reorder it;
8. bind a mock product;
9. change device;
10. change locale;
11. enable RTL;
12. create a validation error;
13. navigate to and fix its property;
14. export;
15. reload;
16. confirm layout restoration.

The target is completion without assistance, no dead end, no blocking accessibility defect, and within the product's ten-minute time-to-first-paywall goal. The one-minute demo is a separate presentation target, not a substitute for task acceptance.

Record completion, elapsed time, blocking errors, assistance, unclear controls, dead ends, accessibility failures, and unresolved UX issues. Automated DOM evidence may cover deterministic behavior, but it must be labeled as automated rather than human usability research.

The in-app browser safety policy blocked the initial local screenshot attempt and forbade browser workarounds. This is an unavailable evidence check, not permission to bypass browser controls. Use a later approved browser surface if one becomes available; otherwise record screenshots and live first-time-user observation as unavailable in the gate report.

## Review gate

After Gate 2.5A implementation, UX, product, and quality review in parallel. Classify every finding
and complete at most two targeted fix rounds. Any unresolved blocking issue after two rounds makes
Gate 2.5A **Rejected pending fixes**.

Gate 2.5A completion does not authorize Phase 3. Gate 2.5B must then pass its protocol,
cross-platform renderer, Studio, accessibility, migration, and safe-failure review. The final
consolidated report must classify Phase 2.5 as Accepted, Accepted with tracked follow-ups, or
Rejected pending fixes, and must stop before Phase 3.
