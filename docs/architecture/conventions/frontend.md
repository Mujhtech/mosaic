# Frontend Conventions

## Approved Stack

Use:

- TanStack Start
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Base UI
- TanStack Router
- TanStack Query
- TanStack Form

Do not use Radix UI.

## Structure

```text
src/
├── routes/
├── components/
├── features/
├── hooks/
├── providers/
├── stores/
├── lib/
├── generated/
├── constants/
├── types/
├── config/
└── styles/
```

## Feature Ownership

Substantial features own their:

- components
- hooks
- queries
- mutations
- schemas
- stores
- types
- utilities
- constants

Example:

```text
features/paywall-editor/
├── components/
├── hooks/
├── queries/
├── mutations/
├── schema/
├── stores/
├── types/
└── utils/
```

## Hooks

Place hooks in `src/hooks/` only when they are reusable across features and contain no Mosaic-domain ownership.

Feature hooks belong in:

```text
features/<feature>/hooks/
```

Do not place all API hooks in the global hooks directory.

## Server State

Use TanStack Query for server state.

Do not duplicate query data into a global store.

Feature-owned query-key factories should be used.

## Client State

Use local React state for small component interactions.

Use a dedicated store for complex shared state such as:

- editor document
- selection
- history
- drag state
- preview state
- unsaved transformations

Do not use a global store as a replacement for application architecture.

## Components

`components/ui/` contains generic primitives only.

Business components belong to features.

## Design-System Packages

The dashboard consumes two private local packages:

```text
@mosaic/design-tokens
@mosaic/design-system
```

Declare them as explicit `file:` dependencies in the dashboard package. Do not add a root
JavaScript workspace solely to share frontend foundations.

Import `@mosaic/design-tokens/theme.css` and then `@mosaic/design-system/styles.css` once from
`src/styles/globals.css`. The token package owns light, dark, and semantic values. Keep Tailwind
`@theme` mappings and application base rules in the dashboard stylesheet.

Use `--mosaic-*` semantic roles for shared styling. The unprefixed color and radius variables remain
compatibility inputs for existing shadcn primitives and Tailwind utilities. Token inventory and
usage rules are documented in [`docs/architecture/design-system.md`](../design-system.md).

The only approved React runtime exports are `ToolbarGroup`, `PanelSection`, and `StatusMessage`.
Use them as compositional patterns: name toolbar groups, connect panel sections to visible headings,
and provide concise visible status text. The design-system package does not own feature state,
business behavior, application icons, or shadcn primitives. React remains its peer dependency; keep
the dashboard TypeScript symlink preservation and Vite/Vitest React deduplication settings when
using the local file-linked package.

## Supported Browsers and Delivery Requirements

| Browser | Minimum |
| ------- | ------- |
| Chrome  | 111     |
| Edge    | 111     |
| Safari  | 16.4    |
| Firefox | 128     |

The floor is set by Tailwind CSS v4, which requires modern cascade-layer and `@property` support.
Encode the matrix as `browserslist` in the dashboard package so the CSS and JS pipelines target
exactly these engines. Do not add a polyfill without measured evidence that a supported browser in
this matrix needs it.

Serve the dashboard over HTTPS, or over `http://localhost` in development. The session cookie is
`Secure`, and clipboard access is restricted to secure contexts, so plain `http://` on any other
host breaks authentication.

Viewport floors:

- Studio is desktop-only and requires at least 768 px of width. Below that, present a
  desktop-required state that still permits a safe local export.
- The hosted workspace is desktop-first. It stays usable on a tablet, but it is not a supported
  phone experience; document that rather than redesigning it.

## Runtime Configuration

Read deployment configuration once at startup from the SSR-injected `window.__MOSAIC_CONFIG__`.
Validate every value, and fall back to a documented safe default instead of throwing, so a
misconfigured deployment still renders a page that can explain the problem. Compile-time `VITE_*`
variables are development fallbacks only; a shipped bundle must not require them.

## Client Error Reporting

Mosaic ships no client-side error reporting by design. Do not add a crash reporter, telemetry
beacon, or automatic error upload. Surface the API correlation identifier instead, and never render
raw server messages or stack traces to users.

## Responsive Workspace Styling

Studio is desktop-first. Preserve canvas space before showing every panel simultaneously:

1. Reduce side panels toward their documented minimums.
2. Collapse the inactive side panel.
3. Present the inspector through an accessible sheet or drawer when constrained.
4. Keep persisted layout state outside design tokens and outside the paywall document.

Use logical CSS properties for bidirectional layouts. Responsive changes must preserve keyboard
access, visible focus, accessible names, and the selected editor component.

## Resizable Workspaces

Feature code must consume the app-local shadcn wrapper from `components/ui/resizable`. Only that
wrapper may import `react-resizable-panels`; do not add pointer/mouse resize calculations, CSS
`resize`, another split-pane dependency, or feature-owned resize primitives. Keep panels and
handles as direct group children so upstream separator semantics, keyboard resizing, collapse, and
double-click reset remain intact.

Persist completed user layouts from the upstream completed-layout callback, not from pointer-move
events. Validate the entire versioned workspace payload before applying it, and restore complete
defaults when any field is malformed, incompatible, non-finite, or outside its current viewport
constraint. Workspace preferences remain separate from TanStack Query data, paywall documents,
undo history, document autosave, portable exports, and preview document contracts.

Use one feature-owned global shortcut registry for editor commands. It must ignore keystrokes while
an input, textarea, select, contenteditable, or command search owns focus, avoid browser and OS
conflicts, and expose the same command hints in the palette and relevant tooltips.

## Forms

Use TanStack Form for complex forms.

Use schema validation consistently.

Display server validation errors at both form and field level where appropriate.

## Accessibility

All interactive controls must support:

- keyboard navigation
- visible focus
- accessible names
- disabled and loading states
- screen-reader semantics

Use the semantic focus-ring tokens for custom interactive treatments. Never remove the focus
behavior supplied by Base UI or shadcn. Status colors require accompanying text or semantics, and
motion must remain understandable when `prefers-reduced-motion` reduces shared durations.

## Generated Code

Do not edit:

- generated REST clients
- route-tree output
- generated protocol types

Change the source and regenerate.

## Dashboard Scaffolding

Use the following shadcn templates as the initial dashboard and authentication foundation:

```bash
npx shadcn@latest add sidebar-07
npx shadcn@latest add login-05
npx shadcn@latest add signup-05
```

Use:

- `sidebar-07` for the authenticated dashboard shell
- `login-05` for the login route
- `signup-05` for the registration route

These templates are starting points, not immutable generated output.

Adapt them to Mosaic’s:

- routing
- branding
- permissions
- responsive behaviour
- feature-oriented architecture
- authentication APIs
- loading and error states

Generated template components must be moved into the correct ownership locations rather than leaving all files inside generic component directories.

Recommended structure:

```text
src/
├── components/
│   ├── ui/
│   ├── layout/
│   └── navigation/
│
├── features/
│   └── auth/
│       ├── components/
│       │   ├── login-form.tsx
│       │   └── signup-form.tsx
│       ├── hooks/
│       ├── mutations/
│       ├── schema/
│       └── types/
│
└── routes/
    ├── login.tsx
    └── signup.tsx
```

Do not preserve the generated template structure when it conflicts with Mosaic’s documented feature ownership.

## Icon Library

Use:

```text
@phosphor-icons/react
```

Do not use Lucide as Mosaic’s application icon library.

After adding the shadcn templates:

1. Replace all `lucide-react` imports.
2. Map every icon to an appropriate Phosphor equivalent.
3. Remove `lucide-react` when no remaining dependency requires it.
4. Use consistent Phosphor weights within related UI surfaces.
5. Prefer semantic icon choices rather than merely selecting visually similar icons.

Example:

```tsx
import {
  Bell,
  CaretDown,
  Gear,
  House,
  SignOut,
  SquaresFour,
  User,
} from "@phosphor-icons/react";
```

Example usage:

```tsx
<House size={18} weight="regular" aria-hidden />
```

For icon-only buttons, always provide an accessible label:

```tsx
<Button variant="ghost" size="icon" aria-label="Open settings">
  <Gear size={18} aria-hidden />
</Button>
```

Do not create a generic icon wrapper unless Mosaic needs shared behaviour such as:

- standardized sizing
- accessibility defaults
- dynamic icon lookup
- consistent weights
- shared animation behaviour

---
