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

* `sidebar-07` for the authenticated dashboard shell
* `login-05` for the login route
* `signup-05` for the registration route

These templates are starting points, not immutable generated output.

Adapt them to Mosaic’s:

* routing
* branding
* permissions
* responsive behaviour
* feature-oriented architecture
* authentication APIs
* loading and error states

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
<Button
  variant="ghost"
  size="icon"
  aria-label="Open settings"
>
  <Gear size={18} aria-hidden />
</Button>
```

Do not create a generic icon wrapper unless Mosaic needs shared behaviour such as:

* standardized sizing
* accessibility defaults
* dynamic icon lookup
* consistent weights
* shared animation behaviour

---
