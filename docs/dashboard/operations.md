# Dashboard Operations

Operating the Mosaic dashboard: packaging, configuration, browser support, and
troubleshooting. The dashboard is a TanStack Start application that server-renders
and then hydrates in the browser. It holds no data of its own; every hosted view is
a read of the Mosaic API.

## Container image

The dashboard ships as its own image. It listens on **port 3000**.

```bash
docker build \
  -f apps/dashboard/Dockerfile \
  --build-arg VERSION=1.0.0-rc.1 \
  --build-arg COMMIT="$(git rev-parse --short HEAD)" \
  -t mosaic-dashboard:1.0.0-rc.1 \
  .
```

The build context is the **repository root**, because the dashboard consumes the
local `file:` packages under `packages/` and imports the generated protocol browser
bundle from `protocol/browser`. Context exclusions come from
`apps/dashboard/Dockerfile.dockerignore`, which BuildKit prefers over the
repository-root `.dockerignore` for this Dockerfile.

Properties of the image:

- Multi-stage: a Node 22.12 build stage, then a Node 22.12 runtime stage carrying
  only `dist/`, production `node_modules`, the manifest, and the local packages.
- Runs as the unprivileged `node` user and never writes to its own filesystem.
- `HEALTHCHECK` performs a plain `GET /` against itself. It deliberately does not
  probe the Mosaic API: the dashboard must stay up in order to _report_ an API
  outage, not fail alongside it.
- `NODE_ENV=production` at runtime, and the build step forces
  `NODE_ENV=production` as well. Building with a development `NODE_ENV` emits the
  development JSX runtime and the server then fails with
  `TypeError: jsxDEV is not a function`.

### Deterministic build

- Dependencies install with `npm ci`, which installs exactly the locked tree or
  fails; it never resolves a new version.
- `SOURCE_DATE_EPOCH` (build arg and environment variable), when set, is used for
  the embedded build timestamp so two builds of the same commit produce the same
  stamp.
- `MOSAIC_COMMIT` / the `COMMIT` build arg supplies the revision, because the image
  build context contains no `.git` directory.
- The version comes from `apps/dashboard/package.json`.

### Source-map policy

Source maps are **not** emitted or shipped (`build.sourcemap: false` in
`vite.config.ts`). Publishing them would hand Mosaic's client source to every
visitor, and Mosaic sends no client error reports anywhere, so there is nothing on
the receiving end that would consume them. Reproduce a client problem against a
local development build instead.

## Runtime configuration

Configuration is read from the server's environment at render time and injected
into the page as `window.__MOSAIC_CONFIG__` before the application modules run.
The shipped bundle therefore contains **no baked-in API URL**: the same image can
be deployed against any API host without rebuilding.

| Variable                              | Required    | Default                       | Meaning                                                                |
| ------------------------------------- | ----------- | ----------------------------- | ---------------------------------------------------------------------- |
| `MOSAIC_DASHBOARD_API_BASE_URL`       | Recommended | `http://localhost:8080`       | Origin of the Mosaic API. Must be an absolute `http:` or `https:` URL. |
| `MOSAIC_DASHBOARD_PREVIEW_URL`        | No          | `ws://127.0.0.1:4317/preview` | Local Studio preview relay. Must be an absolute `ws:` or `wss:` URL.   |
| `MOSAIC_DASHBOARD_PREVIEW_SESSION_ID` | No          | `session_local_01`            | Preview session identifier used by the native example apps.            |
| `PORT`                                | No          | `3000`                        | Listen port.                                                           |
| `HOST`                                | No          | `0.0.0.0`                     | Listen address.                                                        |

Validation rules (`apps/dashboard/src/config/environment.ts`):

- Each value must parse as an absolute URL with an allowed protocol.
- A missing, malformed, or wrong-protocol value falls back to the documented
  default rather than throwing. A misconfigured deployment must still render a
  page that can _explain_ the problem, not a blank screen. Check the API base URL
  on the Diagnostics page whenever hosted views fail.
- The build-time `VITE_API_BASE_URL`, `VITE_MOSAIC_PREVIEW_URL`, and
  `VITE_MOSAIC_PREVIEW_SESSION_ID` remain as **development** fallbacks only.

These are dashboard-owned variables. The two the Compose stack needs to wire the
dashboard container — `MOSAIC_DASHBOARD_PORT` and `MOSAIC_DASHBOARD_API_BASE_URL`
— are declared in the repository-root `.env.example` alongside the backend
variables, because Compose is what injects them. `MOSAIC_DASHBOARD_PREVIEW_URL`
and `MOSAIC_DASHBOARD_PREVIEW_SESSION_ID` are Studio-local and are deliberately
absent from it; set them in the dashboard service environment when you need a
non-default preview relay.

Three dashboard behaviours ship documented rather than fixed for v1. Read them
before filing a defect against any of them, in
[`docs/known-limitations.md`](../known-limitations.md):

- "Server-rendered HTML is always the anonymous view (SSR cookie caveat)".
- "The hosted workspace is desktop-first".
- "No client-side error reporting, by design".

## Browser support

| Browser | Minimum |
| ------- | ------- |
| Chrome  | 111     |
| Edge    | 111     |
| Safari  | 16.4    |
| Firefox | 128     |

The floor is set by Tailwind CSS v4, which requires modern cascade-layer and
`@property` support; older browsers render an unusable layout rather than a
degraded one. The matrix is encoded as `browserslist` in
`apps/dashboard/package.json`.

**HTTPS or `localhost` is required.** The Mosaic session cookie is `Secure`, and
clipboard access (used to copy correlation identifiers) is restricted to secure
contexts. Serving the dashboard over plain `http://` on any host other than
`localhost` produces a sign-in loop.

Viewport floors:

- **Studio is desktop-only** and requires at least 768 px of width. Below that it
  shows a desktop-required state that still allows a safe local export.
- The **hosted workspace is desktop-first**. It remains usable on a tablet, but
  wide tables and the Studio-adjacent panels are laid out for desktop widths and
  are not a supported phone experience.

## Error-reporting policy

Mosaic ships **no client-side error reporting** — no Sentry, no telemetry beacon,
no automatic crash upload. This is a deliberate privacy decision: an operator who
self-hosts Mosaic must not have their users' browsing silently forwarded to a third
party, and Mosaic has no service to forward it to.

What replaces it:

- Every API failure carries an `X-Request-ID` correlation identifier. The dashboard
  surfaces it in error boundaries and on the Diagnostics page, with a copy control
  and a selectable fallback for browsers without clipboard access.
- User-facing copy never contains raw server messages or stack traces
  (`describeApiError` in `src/lib/api/errors.ts` maps failures onto Mosaic-owned
  text). Server detail stays in the API logs, where it is already correlated by the
  same identifier.
- The Diagnostics page (`/diagnostics`) reports the dashboard version, commit,
  build time, resolved API base URL, session state, and an on-demand API liveness
  probe.

To diagnose a report: ask for the correlation ID and the Diagnostics values, then
search the API logs for that request ID.

## Troubleshooting

### Blank page

1. Check the browser console for a module load failure. A stale HTML document
   referencing deleted hashed assets is the usual cause after a deploy; hard-reload.
2. Confirm the container is healthy (`docker compose ps`) and that `GET /` returns
   200 from inside the network.
3. If the server log shows `jsxDEV is not a function`, the image was built with a
   development `NODE_ENV`. Rebuild; the Dockerfile pins `NODE_ENV=production` for
   the build step.
4. Compare the `mosaic:dashboard-version` `<meta>` tag in the page source against
   the version you expect to be running.

### Sign-in loop (repeated 401)

1. The dashboard is being served over plain `http://` on a non-`localhost` host.
   The session cookie is `Secure` and the browser silently discards it. Put the
   dashboard behind TLS.
2. The API and dashboard are on different sites and the cookie's `SameSite`
   attribute prevents it from being sent. Serve both from the same site, or from
   the same origin behind one reverse proxy.
3. The API base URL points at a different API instance than the one that issued
   the session. Verify it on `/diagnostics`.

### CORS errors in the console

The API must list the dashboard's exact origin (scheme, host, and port) in its
allowed origins, and must allow credentials — the dashboard sends
`credentials: include` on every request. A wildcard origin cannot be combined with
credentials and will fail. Check the API's CORS configuration, not the dashboard.

### Cookie is never set

Confirm all of: the response carries `Set-Cookie`; the connection is HTTPS or
`localhost`; the cookie domain covers the dashboard host; and no browser setting or
extension is blocking cookies for that site.

### Wrong API URL

`/diagnostics` shows the resolved value. If it is not what you configured, the
environment variable was not visible to the dashboard **server** process (it is
read server-side, not by the browser), or the value failed validation and fell back
to the default. Values must be absolute URLs with an `http:`/`https:` scheme.

### SSR cookie caveat

The server render never sees the browser's session cookie, so the server-rendered
HTML is always the anonymous view; the authenticated view appears after hydration.
Two consequences:

- Session-scoped data is not prefetched during SSR. Hosted routes fetch on the
  client.
- The `_hosted` route guard runs on the client only. A server-side guard would
  redirect every authenticated operator to the sign-in page.

This is a known limitation, not a defect: it is safe (no tenant data can be
rendered for the wrong session) and its only cost is that hosted pages show their
loading state briefly.

## Commands

```bash
npm run check   # format check, lint, typecheck, tests, relay tests, build
```

`npm run check` is the single gate for dashboard changes and is what CI runs. It
runs `test` (Vitest) and `test:relay` as separate, explicit steps.

`test:relay` exercises the local Studio preview relay over a real WebSocket on
loopback. It needs to bind an ephemeral TCP port on `127.0.0.1`; in a sandbox
that forbids listening sockets it fails on bind rather than on behaviour. Run it
on a host with loopback networking, and do not remove it from `check` — it is the
only coverage of the relay's message flow.
