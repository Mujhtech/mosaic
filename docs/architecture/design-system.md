# Mosaic Web Design System

## Current Scope

The Phase 2.5 web design-system foundation provides two local packages:

```text
@mosaic/design-tokens
@mosaic/design-system
```

Both are private ESM packages. The token package exposes one CSS entry, and the React package
exposes one module plus its styles:

```css
@import "@mosaic/design-tokens/theme.css";
@import "@mosaic/design-system/styles.css";
```

```tsx
import {
  PanelSection,
  StatusMessage,
  ToolbarGroup,
} from "@mosaic/design-system";
```

The dashboard declares both through explicit `file:` dependencies; Mosaic does not use a root
JavaScript workspace or package-manager migration. Import both CSS entries once from
`src/styles/globals.css`, with the component styles after the tokens they consume. The token package
owns semantic values. The dashboard continues to own Tailwind `@theme` mappings, application base
rules, and shadcn component source.

`@mosaic/design-system` treats React 19 as a peer dependency. The dashboard preserves symlinks for
TypeScript resolution, while Vite and Vitest deduplicate `react` and `react-dom`, so the file-linked
package shares the application's runtime. Do not add a package-local React runtime.

## Component Patterns

The package intentionally has only three public runtime exports:

| Pattern         | Semantic contract                                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ToolbarGroup`  | Renders a `group`, requires `aria-label` or `aria-labelledby`, and composes child controls. Place it inside the page's single named `toolbar` when needed. |
| `PanelSection`  | Renders a native `section` and requires `aria-labelledby`. The caller supplies the visible heading and chooses its correct document level.                 |
| `StatusMessage` | Renders visible status text. Neutral, info, success, and warning tones are polite `status` regions; danger is an assertive `alert`.                        |

The patterns accept native element props and `className`; their children remain feature-owned. A
tone changes appearance and live-region urgency, never the status text. Use `danger` only when an
immediate failure requires interruption, not for routine field validation or persistent guidance.

```tsx
<div role="toolbar" aria-label="Editor actions">
  <ToolbarGroup aria-label="History">
    <button type="button">Undo</button>
    <button type="button">Redo</button>
  </ToolbarGroup>
</div>

<PanelSection aria-labelledby="layout-heading">
  <h2 id="layout-heading">Layout</h2>
  {/* Feature-owned controls */}
</PanelSection>

<StatusMessage tone="success">Draft saved</StatusMessage>
```

## Token Inventory

The token source is `packages/design-tokens/src/theme.css`.

| Category              | Public roles                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace surfaces    | `--mosaic-surface`, `--mosaic-surface-raised`, `--mosaic-canvas-surface`, `--mosaic-panel-surface`, `--mosaic-toolbar-surface`, `--mosaic-rail-surface`, `--mosaic-inspector-surface` |
| Text                  | `--mosaic-text`, `--mosaic-text-muted`, `--mosaic-text-on-action`                                                                                                                     |
| Actions and selection | `--mosaic-action`, `--mosaic-action-foreground`, `--mosaic-action-hover`, `--mosaic-selection-surface`, `--mosaic-selection-border`                                                   |
| Status                | `--mosaic-status-{info,success,warning,danger}-{surface,border,text}`                                                                                                                 |
| Borders and focus     | `--mosaic-border`, `--mosaic-border-strong`, `--mosaic-focus-ring`, `--mosaic-focus-width`, `--mosaic-focus-offset`                                                                   |
| Elevation and shadow  | `--mosaic-shadow-color`, `--mosaic-shadow-sm`, `--mosaic-shadow-md`, `--mosaic-elevation-toolbar`, `--mosaic-elevation-overlay`                                                       |
| Spacing               | `--mosaic-space-{1,2,3,4,6}`                                                                                                                                                          |
| Typography            | `--mosaic-font-sans`, `--mosaic-type-{xs,sm,md}`, `--mosaic-leading-{tight,normal}`, `--mosaic-weight-{medium,semibold}`                                                              |
| Radius                | `--mosaic-radius-{sm,md,lg,full}`                                                                                                                                                     |
| Motion                | `--mosaic-motion-{fast,standard}`, `--mosaic-ease-standard`                                                                                                                           |

The unprefixed variables in the same file are compatibility values consumed by current shadcn and
Tailwind classes. New shared styling should use `--mosaic-*` roles. Do not treat a raw OKLCH value
or an unprefixed compatibility variable as a new shared API.

Example:

```css
.workspace-panel {
  border: 1px solid var(--mosaic-border);
  border-radius: var(--mosaic-radius-lg);
  background: var(--mosaic-panel-surface);
  color: var(--mosaic-text);
  box-shadow: var(--mosaic-shadow-sm);
}
```

## Accessibility and Focus

- Color never communicates selection, status, or validation alone. Pair it with text, an accessible
  name, or another semantic indicator.
- Interactive focus treatments use `--mosaic-focus-ring`, `--mosaic-focus-width`, and
  `--mosaic-focus-offset`. Do not remove the visible focus supplied by Base UI or shadcn primitives.
- Status surface, border, and text tokens are a set. Consumers must preserve readable contrast in
  light and dark themes. `StatusMessage` supplies the appropriate live-region role and urgency;
  callers must supply concise visible text.
- Icon-only controls require an accessible label. Decorative icons are `aria-hidden`.

## Motion

Shared transitions use the motion tokens rather than hard-coded durations. Under
`prefers-reduced-motion: reduce`, both duration tokens resolve to `1ms`. Feature code must also avoid
motion-dependent meaning and preserve immediate state feedback when motion is reduced.

## Responsive Workspace Rules

Studio is desktop-first, but token usage must not freeze the workspace at one width.

- Large layouts may show the fixed 52px activity rail, left panel, canvas, and inspector together.
- Medium layouts reduce side panels toward their documented minimums before reducing canvas space.
- Constrained layouts collapse an inactive side panel and may move the inspector to an accessible
  sheet or drawer.
- The canvas remains the priority and must retain its 420px minimum usable width where the viewport
  permits.
- Use logical properties so left-to-right and right-to-left layouts share the same token roles.
- Persisted panel sizes and collapsed state are workspace preferences, not design tokens and not
  paywall-document data.

## Component and Icon Boundaries

- shadcn primitives remain app-local in `apps/dashboard/src/components/ui` and use Base UI or an
  approved accessible custom primitive.
- Radix UI is prohibited.
- `@phosphor-icons/react` is the application icon library. Do not add Lucide imports.
- Business components remain feature-owned; token packages never contain paywall, protocol,
  product, preview, or editor behavior.
- Shared React patterns live in `@mosaic/design-system`. They compose children, do not duplicate
  shadcn primitives, and never own workspace state or supply application icons.

## Change Policy

Add a token only when at least two consumers share a stable semantic role or the approved Studio
contract names the role. Update light and dark behavior together, document the new role here, and
verify the dashboard build before removing an existing compatibility value.
