# ADR-0012: Use shadcn Dashboard Templates and Phosphor Icons

## Status

Accepted

## Date

2026-07-16

## Context

Mosaic needs a consistent dashboard shell and authentication foundation without spending the first implementation phase recreating standard navigation and authentication layouts.

The selected shadcn templates provide a strong starting point, but their default icon usage and generated file organization do not fully match Mosaic’s frontend conventions.

Mosaic also requires:

* Base UI rather than Radix UI
* feature-oriented frontend ownership
* accessible icon usage
* a consistent visual language
* TanStack Start route integration
* TanStack Form integration
* REST-based authentication workflows

## Decision

Use the following shadcn templates:

```bash
npx shadcn@latest add sidebar-07
npx shadcn@latest add login-05
npx shadcn@latest add signup-05
```

Use:

* `sidebar-07` for the authenticated dashboard shell
* `login-05` for the login experience
* `signup-05` for the registration experience

Use:

```text
@phosphor-icons/react
```

as Mosaic’s dashboard icon library.

Replace Lucide icons introduced by the templates.

Refactor generated components into Mosaic’s documented feature-oriented directory structure.

Generated templates must be adapted to:

* TanStack Start routing
* TanStack Query
* TanStack Form
* Mosaic REST APIs
* Mosaic authentication behaviour
* Mosaic branding
* Mosaic permissions
* accessibility requirements

## Consequences

### Benefits

* faster dashboard setup
* consistent responsive navigation
* established authentication layouts
* reduced initial UI scaffolding work
* consistent icon language through Phosphor
* less time spent recreating common shell components

### Trade-offs

* generated files require cleanup
* template updates are not inherited automatically
* icon substitutions require manual review
* generated structure may initially conflict with Mosaic conventions
* authentication logic still requires full implementation
* accessibility must be reviewed after customization

## Alternatives Considered

### Build the dashboard shell from scratch

Rejected because it would increase initial development time without creating meaningful Mosaic differentiation.

### Retain Lucide icons

Rejected because Mosaic has selected Phosphor as its application icon language.

### Use different shadcn templates

Rejected for now because `sidebar-07`, `login-05`, and `signup-05` provide a suitable starting point for the current product direction.

### Use Radix-based shadcn components

Rejected because Mosaic has explicitly selected Base UI primitives.