# Mosaic Dashboard and Local Studio

The dashboard is a standalone TanStack Start application. Phase 2 adds an account-free Local Studio
at `/studio`: choose a paywall template, edit the constrained Protocol 0.1 block tree, validate it,
and send live revisions to native example apps through the loopback preview relay.

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

Native clients use session `session_local_01` and WebSocket subprotocol
`mosaic.local-preview.v0.1` by default. Override the Studio connection with:

```bash
VITE_MOSAIC_PREVIEW_URL=ws://127.0.0.1:4317/preview
VITE_MOSAIC_PREVIEW_SESSION_ID=session_local_01
```

The relay binds only to a loopback interface. A preview client must report its identity and
capabilities before Studio sends the current draft and mock-commerce state. Reconnects use bounded
backoff, and the last draft is replayed after the client reports capabilities again.

## Local files and recovery

- Autosave uses browser storage key `mosaic:local-project:v0.1` after a 500 ms debounce.
- The autosave wrapper preserves the document, locale, text scale, revision, and mock-commerce state.
- Invalid but schema-shaped drafts remain resumable so validation fixes are not lost.
- **Import JSON** accepts only a raw, valid Mosaic Protocol 0.1 paywall document under 1 MB.
- **Export** writes only a canonical raw paywall document (`*.mosaic.json`), never the autosave
  wrapper.
- Imported products receive matching `unavailable/notConfigured` mocks until the user binds local
  test values.

Undo and redo cover document edits. `Cmd/Ctrl+Z` undoes, `Cmd/Ctrl+Shift+Z` or `Ctrl+Y` redoes,
`Cmd/Ctrl+Arrow` reorders the selected block, and Delete/Backspace removes it when focus is outside
an editing field.

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

## UI components

`components.json` uses shadcn/ui's `base-nova` style. Components added to
`src/components/ui/` must use `@base-ui/react` or an approved accessible custom primitive. Radix UI
packages are prohibited.

Run shadcn commands from this directory so aliases and the Tailwind CSS entry point resolve locally.
