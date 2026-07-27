# Mosaic Dashboard and Local Studio

The dashboard is a standalone TanStack Start application. Local Studio at `/studio` authors the
constrained Protocol 0.2 tree, validates it, and sends live revisions to the three native example
apps through the loopback preview relay.

Local Studio does not use accounts, hosted projects, cloud storage, remote publishing, analytics,
experiments, or real billing providers.

The separate hosted subtree starts at `/workspace` and covers Organizations, Projects,
Applications, Environments, environment-scoped API keys, memberships, and the project-wide
Catalog. Hosted REST calls use the generated client under `src/generated/api`; regenerate it from
the backend OpenAPI document after a contract change with `npm run generate:api`.

Hosted authentication is implemented. The login and signup forms in
`src/features/auth/components` validate with TanStack Form and call the Mosaic REST API, which
establishes an HttpOnly browser session cookie. `/_hosted` routes are guarded: an unauthenticated
visitor is redirected to `/login?returnTo=…` with a sanitized internal path, and the sidebar footer
provides sign-out. `/studio` remains account-free and needs no session.

## Analytics workspace

Hosted Analytics is direct-linkable at
`/organizations/:organizationId/projects/:projectId/analytics/:environmentId/:surface`, where the
surface is `overview`, `placements`, `paywalls`, `products`, `purchases`, or `data-privacy`.
Date, reporting timezone, platform, locale, application version, and the fixed event-count metric
basis are URL search state. Query cache keys include Project, Environment, and those filters.

The workspace keeps client-observed and provider-confirmed outcomes separate, reports unavailable
provider authority as unavailable rather than zero, and shows freshness, late-event policy,
low-data warnings, exact-correlation funnels, immutable Paywall Version comparisons, and safe
recovery links. No chart library or global analytics store is used.

Members may read Analytics. Owners and admins may export filtered events and change collection or
raw-event retention. Only owners may preview identities, export identity data, or request deletion.
Identity values are submitted only in POST bodies and never enter URLs, TanStack Query keys,
browser storage, logs, filenames, or public Asset URLs. Export and deletion are asynchronous and
surface queued, processing, completed, failed, retry, private download, and audit-summary states.

Public SDK keys created from API-key settings are bound to one registered Application for analytics
ingestion. Existing unbound public keys continue to support configuration delivery, but Analytics
shows them as legacy credentials and directs owners/admins to create a bound replacement. SDK event
payloads do not submit tenant or Application identifiers; trusted scope is derived from the key.

## Requirements

- Node.js 22.12 or newer
- npm 10 or newer

## Supported browsers

| Browser | Minimum |
| ------- | ------- |
| Chrome  | 111     |
| Edge    | 111     |
| Safari  | 16.4    |
| Firefox | 128     |

The floor is set by Tailwind CSS v4 (cascade layers and `@property`); older browsers render an
unusable layout rather than a degraded one. The matrix is encoded as `browserslist` in
`package.json`, so PostCSS and Tailwind target exactly these engines. No polyfills are shipped.

**HTTPS or `localhost` is required.** The session cookie is `Secure`, and clipboard access used to
copy correlation identifiers is restricted to secure contexts. Serving the dashboard over plain
`http://` on any other host produces a sign-in loop.

Viewport floors: Studio is **desktop-only** and requires at least 768 px of width, below which it
shows a desktop-required state that still allows a safe local export. The hosted workspace is
**desktop-first** — usable on a tablet, but its wide tables and panels are laid out for desktop
widths and it is not a supported phone experience.

## Runtime configuration

Configuration is read from the **server's** environment at render time and injected into the page as
`window.__MOSAIC_CONFIG__` before any application module executes. The shipped bundle contains no
baked-in API URL, so one image can be deployed against any API host without rebuilding.

| Variable                              | Default                       | Meaning                                                |
| ------------------------------------- | ----------------------------- | ------------------------------------------------------ |
| `MOSAIC_DASHBOARD_API_BASE_URL`       | `http://localhost:8080`       | Mosaic API origin. Absolute `http:`/`https:` URL.      |
| `MOSAIC_DASHBOARD_PREVIEW_URL`        | `ws://127.0.0.1:4317/preview` | Local Studio preview relay. Absolute `ws:`/`wss:` URL. |
| `MOSAIC_DASHBOARD_PREVIEW_SESSION_ID` | `session_local_01`            | Preview session identifier.                            |
| `PORT` / `HOST`                       | `3000` / `0.0.0.0`            | Listen address for the production server.              |

Values are validated in `src/config/environment.ts`. A missing, malformed, or wrong-protocol value
falls back to the documented default instead of throwing, so a misconfigured deployment still
renders a page that can explain the problem. Confirm the resolved values on `/diagnostics`.

The build-time `VITE_API_BASE_URL`, `VITE_MOSAIC_PREVIEW_URL`, and `VITE_MOSAIC_PREVIEW_SESSION_ID`
remain **development** fallbacks only.

`MOSAIC_DASHBOARD_PORT` and `MOSAIC_DASHBOARD_API_BASE_URL` are declared in the repository-root
`.env.example` because the Compose stack injects them into the dashboard container.
`MOSAIC_DASHBOARD_PREVIEW_URL` and `MOSAIC_DASHBOARD_PREVIEW_SESSION_ID` are Studio-local and are
deliberately absent from it.

Three dashboard behaviours ship documented rather than fixed for v1 — the SSR cookie caveat, the
desktop-first workspace floor, and the absence of client-side error reporting. Each has an entry in
[`docs/known-limitations.md`](../../docs/known-limitations.md).

## Deployment

The dashboard ships as its own container image listening on **port 3000**:

```bash
docker build \
  -f apps/dashboard/Dockerfile \
  --build-arg VERSION=1.0.0-rc.1 \
  --build-arg COMMIT="$(git rev-parse --short HEAD)" \
  -t mosaic-dashboard:1.0.0-rc.1 \
  .
```

The build context is the repository root, because the dashboard consumes the local `file:` packages
under `packages/` and the generated protocol bundle under `protocol/browser`. Exclusions come from
`apps/dashboard/Dockerfile.dockerignore`. The image runs as the unprivileged `node` user, sets
`NODE_ENV=production`, installs with `npm ci` for a deterministic tree, and exposes a `HEALTHCHECK`
that requests `/` from itself without probing the Mosaic API.

Source maps are not emitted or shipped: they would publish Mosaic's client source to every visitor,
and Mosaic sends no client error reports anywhere that would consume them.

Full operational detail, including troubleshooting for blank pages, 401 loops, CORS, missing
cookies, a wrong API URL, and the SSR cookie caveat, is in
[`docs/dashboard/operations.md`](../../docs/dashboard/operations.md).

## Error-reporting policy

Mosaic ships **no client-side error reporting** — no Sentry, no telemetry beacon, no automatic crash
upload. This is deliberate: an operator who self-hosts Mosaic must not have their users' browsing
silently forwarded to a third party, and Mosaic has no service to forward it to.

What replaces it:

- Every API failure carries an `X-Request-ID` correlation identifier, surfaced in error boundaries
  and on `/diagnostics` with a copy control plus a selectable fallback for browsers without
  clipboard access.
- User-facing copy never contains raw server messages or stack traces. `describeApiError` in
  `src/lib/api/errors.ts` maps failures onto Mosaic-owned text; server detail stays in the API logs,
  already correlated by the same identifier.
- `/diagnostics` reports the dashboard version, commit, build time, resolved API base URL, session
  state, and an on-demand API liveness probe.

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

In development, `VITE_API_BASE_URL` still points the hosted REST workspace at an API; deployed
instances use `MOSAIC_DASHBOARD_API_BASE_URL` instead (see **Runtime configuration**). The default is
`http://localhost:8080`, and the generated client supplies the versioned `/v1/...` paths. Local
Studio itself does not require the API.

## Purchase setup

The existing project-wide `/catalog/providers` route is labeled **Purchase setup**. It separates:

- explicit active-provider selection for one Mosaic Environment and registered Application;
- built-in StoreKit for iOS and Google Play Billing for Android, neither of which creates a
  credential connection; and
- scoped RevenueCat or app-owned custom-provider Connections.

Purchase setup never defaults to Staging or the first Environment. Product detail uses the selected
Environment to show cross-platform coverage, then scopes StoreKit or Google Product/base-plan/offer
mapping forms to one Application. `No offer` is an explicit Google subscription choice; Mosaic does
not persist or guess an offer token.

Native mapping identifiers are configuration only. They become **Configured**, not verified, when
saved. Store context, test-client observations, metadata source, and freshness remain separate from
the Mosaic Environment. Observed provider metadata is read-only and must not enter a Paywall
document.

Publishing recovery carries the exact Product, Environment, and Application plus a validated
internal return path. Returning to Studio reopens and reruns Publish review against the current
Draft. StoreKit actions use restore/store-sync language; Google actions use active-purchase recovery
language.

## Commands

```bash
npm run dev           # start the local development server
npm run dev:studio    # start Studio and the loopback preview relay
npm run preview:relay # start only the loopback preview relay
npm run generate:api  # regenerate the REST client from docs/backend/openapi.yaml
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
