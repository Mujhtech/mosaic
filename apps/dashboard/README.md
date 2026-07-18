# Mosaic Dashboard and Local Studio

The dashboard is a standalone TanStack Start application. Local Studio at `/studio` authors the
constrained Protocol 0.2 tree, validates it, and sends live revisions to the three native example
apps through the loopback preview relay.

Local Studio does not use accounts, hosted projects, cloud storage, remote publishing, analytics,
experiments, or real billing providers.

## Requirements

- Node.js 22.12 or newer
- npm 10 or newer

## Setup

```bash
cd apps/dashboard
npm install
npm run dev:studio
```

This starts both:

- Studio at `http://localhost:3000/studio`
- the local WebSocket relay at `ws://127.0.0.1:4317/preview`

Native clients use session `session_local_01`. Studio and the relay use the single
`mosaic.local-preview.v0.2` contract. Override the Studio connection with:

```bash
VITE_MOSAIC_PREVIEW_URL=ws://127.0.0.1:4317/preview
VITE_MOSAIC_PREVIEW_SESSION_ID=session_local_01
```

The relay binds only to a loopback interface. A preview client must report its identity and
capabilities before Studio sends the current draft and mock-commerce state. Reconnects use bounded
backoff, and the last draft is replayed after the client reports capabilities again.

## Local files and recovery

- Autosave uses browser storage key `mosaic:local-project:v0.2` after a 500 ms debounce.
- The autosave wrapper preserves the document, locale, text scale, revision, and mock-commerce state.
- Invalid but schema-shaped drafts remain resumable so validation fixes are not lost.
- **Import JSON** accepts a raw, valid Mosaic Protocol 0.2 paywall document under 1 MB.
- **Export** writes only a canonical raw paywall document (`*.mosaic.json`), never the autosave
  wrapper.
- Imported products receive matching `unavailable/notConfigured` mocks until the user binds local
  test values.

Undo and redo cover document edits. `Cmd/Ctrl+Z` undoes, `Cmd/Ctrl+Shift+Z` or `Ctrl+Y` redoes,
`Alt+Arrow` reorders the selected layer, `Cmd/Ctrl+D` duplicates it, and Delete/Backspace removes
it when focus is outside an editing field. The complete shortcut list is available from the Layers
help tooltip rather than occupying permanent panel space.

Layers is the structural editing surface: drag a row from anywhere on the row, rename it inline,
or open the same contextual actions with right-click or the ellipsis menu. Duplicate and delete
remain contextual; nest and outdent appear only when the current position allows them. Canvas
content is not draggable and uses protocol-appropriate HTML such as headings, paragraphs, lists,
fieldsets, radios, figures, and native buttons.

The property inspector uses compact contextual sections. Common content, layout, appearance,
typography, visibility, localization, and accessibility fields are grouped by component, while
uncommon contract details remain under Advanced. Protocol 0.2 adds generalized vertical or
horizontal Stack, Carousel, Switch, Countdown, constrained color and box styling, and Product Card
Default/Selected state editing with explicit inheritance and reset controls. Width and height each
offer Fit, Fill, or a fixed layout-unit value; unbounded vertical Fill recovers to Fit. Backgrounds
can use colour, linear or radial gradients, image assets, video assets with poster/fallback, or a
reusable Design System style. Linear-gradient angles are physical and never mirrored in RTL: 0° is
left-to-right and 90° is top-to-bottom. Supported components also expose custom or reusable shadow
styles.

The Design System tool authors reusable colours, backgrounds, and shadows in the paywall document.
Design colours appear first in every colour picker, linked style edits update all usages, and style
deletion requires replacing references or detaching their resolved values. The Assets tool authors
remote HTTPS or bundled image/video sources used by content and media backgrounds.

Studio workspace preferences use the separate versioned key `mosaic:studio:workspace:v1`. The
value contains validated panel sizes/collapse state, the active tool, canvas preview settings,
Studio-only layer metadata, and recent insertions. It never enters undo history, document autosave,
preview document payloads, or exported JSON. An incomplete, incompatible, malformed, non-finite, or
out-of-range value restores the complete default workspace; the diagnostics height is also checked
against the current `45vh` limit at read time.

The browser preview is a full React Flow surface: every authored screen or sheet has its own device
frame, navigate-to buttons form visible connections between frames, and the selected frame controls
the Layers and property context. Add Screen/Sheet creates a new destination frame and a navigate-to
button from the focused source; non-initial destinations can be converted between screen and sheet.
Pan or zoom the canvas, drag a device from its status bar or hardware frame, and use the floating
bottom toolbar for device, orientation, zoom, fit, and secondary preview settings. Simulator-style
chrome includes device-specific bezels,
hardware buttons, safe areas, iOS Dynamic Island or iPad camera treatment, Android punch-hole
cameras, system status indicators, and gesture bars. The catalog currently covers iPhone 17,
iPhone 17 Pro/Pro Max, 11- and 13-inch iPad Pro, Pixel 10/10 Pro/10 Pro XL, and Galaxy S26/S26+/
S26 Ultra. Legacy `iphone`, `android`, and `tablet` workspace values migrate to an equivalent
current preset without discarding the rest of the saved workspace.

The 52px activity rail stays outside the upstream `react-resizable-panels` groups. The left,
properties, and diagnostics panels expose named keyboard-accessible separators and keep upstream
pointer, min/max, Enter collapse/expand, and double-click reset behavior. At compact widths the
properties inspector moves to a Base UI sheet; below 768px Studio preserves safe local export behind
a desktop-required state.

Open the command palette with `Cmd/Ctrl+Shift+K`. Tool chords are `G` then `L`, `C`, `P`, or `O` for
Layers, Components, Products, or Localization. `F` fits the canvas, `Shift+0` resets zoom,
`Shift+A` changes canvas appearance, and `[`, `]`, or `\` toggles the left, properties, or
diagnostics panel. Global shortcuts pause while an input, textarea, select, contenteditable, or
command search owns focus.

Set `VITE_API_BASE_URL` only for the existing REST-backed dashboard/authentication scaffolding. The
default is `http://localhost:8080/api/v1/dashboard/`; Local Studio itself does not require the API.

## Commands

```bash
npm run dev           # start the local development server
npm run dev:studio    # start Studio and the loopback preview relay
npm run preview:relay # start only the loopback preview relay
npm run build         # create the production client and server bundles
npm run start         # serve the production build
npm run format        # format local files
npm run format:check  # verify formatting
npm run lint          # run ESLint
npm run typecheck     # run TypeScript without emitting files
npm run test          # run Vitest and relay integration tests once
npm run test:relay    # run relay protocol/routing integration tests
npm run test:watch    # run Vitest in watch mode
npm run check         # run all repository-local dashboard checks
```

The automated Studio acceptance test exercises the complete local journey, including resize and
reload restoration:

```bash
npx vitest run src/features/paywall-editor/components/studio-automated-workflow.test.tsx
```

## UI components

`components.json` uses shadcn/ui's `base-nova` style. Components added to
`src/components/ui/` must use `@base-ui/react` or an approved accessible custom primitive. Radix UI
packages are prohibited.

Run shadcn commands from this directory so aliases and the Tailwind CSS entry point resolve locally.

## Design-system packages

The dashboard installs `@mosaic/design-tokens` and `@mosaic/design-system` from `../../packages`
through explicit local `file:` dependencies. `src/styles/globals.css` imports the token entry and
then the component styles once, while Tailwind theme mappings and application base rules stay
app-local.

Use the documented `--mosaic-*` roles for shared Studio styling. The existing unprefixed variables
remain compatibility inputs for shadcn and Tailwind. See
[`docs/architecture/design-system.md`](../../docs/architecture/design-system.md) for the inventory,
accessibility, reduced-motion, responsive, icon, and component-boundary rules.

The React package exposes only `ToolbarGroup`, `PanelSection`, and `StatusMessage`. These are generic
compositional patterns: features provide their children, visible headings or labels, status text,
and Phosphor icons. React is a peer dependency; TypeScript resolves the app-side package link, and
Vite and Vitest share the dashboard's single React runtime.
