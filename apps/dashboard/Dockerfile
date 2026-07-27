# Mosaic dashboard image.
#
# Build context is the repository root, because the dashboard consumes the
# local `file:` packages under packages/. Paths are excluded through
# apps/dashboard/Dockerfile.dockerignore, which BuildKit prefers over the
# repository-root .dockerignore for this Dockerfile.
#
#   docker build -f apps/dashboard/Dockerfile -t mosaic-dashboard:dev .
#
# The runtime serves the TanStack Start server on port 3000.

FROM node:22.12-alpine AS build
ARG VERSION=dev
ARG COMMIT=""
ARG SOURCE_DATE_EPOCH=""
ENV MOSAIC_COMMIT=${COMMIT} \
    SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}
WORKDIR /src

# Manifests first so dependency installation is cached independently of source.
COPY apps/dashboard/package.json apps/dashboard/package-lock.json ./apps/dashboard/
COPY packages/design-system/package.json ./packages/design-system/
COPY packages/design-tokens/package.json ./packages/design-tokens/
# `npm ci` is deterministic: it installs exactly the locked tree or fails.
# --include=dev is explicit so the build toolchain is present regardless of the
# base image's NODE_ENV.
RUN cd apps/dashboard && npm ci --include=dev

# The dashboard imports the generated protocol browser bundle directly.
COPY protocol/ ./protocol/
COPY packages/ ./packages/
COPY apps/dashboard/ ./apps/dashboard/
# NODE_ENV must be production for this step: building with a development
# NODE_ENV emits the development JSX runtime, which then fails at runtime
# against production react-dom with "jsxDEV is not a function".
# Source maps are intentionally not emitted (see vite.config.ts).
RUN cd apps/dashboard && NODE_ENV=production npm run build

# Reinstall production dependencies only, for the runtime layer.
RUN cd apps/dashboard && npm ci --omit=dev

FROM node:22.12-alpine AS runtime
ARG VERSION=dev
ARG COMMIT=""
LABEL org.opencontainers.image.title="Mosaic Dashboard" \
      org.opencontainers.image.source="https://github.com/Mujhtech/mosaic" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${COMMIT}"

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
WORKDIR /app

COPY --from=build /src/apps/dashboard/dist ./dist
COPY --from=build /src/apps/dashboard/node_modules ./node_modules
COPY --from=build /src/apps/dashboard/package.json ./package.json
COPY --from=build /src/packages ../packages

# The node image ships an unprivileged `node` user; the dashboard never needs
# to write to its own filesystem.
USER node
EXPOSE 3000

# The server answers GET / with the SSR shell; a 200 means the Node process and
# the built bundle are both healthy. It intentionally does not probe the Mosaic
# API: the dashboard must stay up and report API problems, not fail with them.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start"]
