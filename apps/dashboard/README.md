# Mosaic Dashboard

The Phase 0 dashboard is a standalone TanStack Start application. It intentionally contains only
the route shell, provider composition, shared feedback primitives, and HTTP/query boundaries needed
for later vertical slices.

## Requirements

- Node.js 22.12 or newer
- npm 10 or newer

## Setup

```bash
cd apps/dashboard
npm install
npm run dev
```

The development server listens on `http://localhost:3000`.

Set `VITE_API_BASE_URL` to change the dashboard REST base URL. The default is
`http://localhost:8080/api/v1/dashboard/`.

## Commands

```bash
npm run dev           # start the local development server
npm run build         # create the production client and server bundles
npm run start         # serve the production build
npm run format        # format local files
npm run format:check  # verify formatting
npm run lint          # run ESLint
npm run typecheck     # run TypeScript without emitting files
npm run test          # run Vitest once
npm run test:watch    # run Vitest in watch mode
npm run check         # run all repository-local dashboard checks
```

## UI components

`components.json` uses shadcn/ui's `base-nova` style. Components added to
`src/components/ui/` must use `@base-ui/react` or an approved accessible custom primitive. Radix UI
packages are prohibited.

Run shadcn commands from this directory so aliases and the Tailwind CSS entry point resolve locally.
