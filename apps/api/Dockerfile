FROM golang:1.26.5-alpine AS build
ARG VERSION=dev
ARG COMMIT=""
ARG BUILD_DATE=""
WORKDIR /src/apps/api
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download
COPY apps/api/ ./
# Protocol schemas are embedded in the binaries (internal/platform/protocolschema),
# so the runtime image needs no schema files and cannot drift from the contract.
RUN LDFLAGS="-s -w \
      -X github.com/Mujhtech/mosaic/apps/api/internal/platform/buildinfo.version=${VERSION} \
      -X github.com/Mujhtech/mosaic/apps/api/internal/platform/buildinfo.commit=${COMMIT} \
      -X github.com/Mujhtech/mosaic/apps/api/internal/platform/buildinfo.date=${BUILD_DATE}" && \
    CGO_ENABLED=0 go build -trimpath -ldflags "${LDFLAGS}" -o /out/api ./cmd/api && \
    CGO_ENABLED=0 go build -trimpath -ldflags "${LDFLAGS}" -o /out/migrate ./cmd/migrate && \
    CGO_ENABLED=0 go build -trimpath -ldflags "${LDFLAGS}" -o /out/worker ./cmd/worker && \
    CGO_ENABLED=0 go build -trimpath -ldflags "${LDFLAGS}" -o /out/keyring ./cmd/keyring && \
    CGO_ENABLED=0 go build -trimpath -ldflags "${LDFLAGS}" -o /out/loadgen ./cmd/loadgen && \
    CGO_ENABLED=0 go build -trimpath -ldflags "${LDFLAGS}" -o /out/healthcheck ./cmd/healthcheck

FROM gcr.io/distroless/static-debian12:nonroot
ARG VERSION=dev
ARG COMMIT=""
LABEL org.opencontainers.image.title="Mosaic API" \
      org.opencontainers.image.source="https://github.com/Mujhtech/mosaic" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${COMMIT}"
COPY --from=build /out/api /usr/local/bin/api
COPY --from=build /out/migrate /usr/local/bin/migrate
COPY --from=build /out/worker /usr/local/bin/worker
COPY --from=build /out/keyring /usr/local/bin/keyring
COPY --from=build /out/loadgen /usr/local/bin/loadgen
# The distroless base has no shell, curl, or wget; container healthchecks use
# this probe binary instead.
COPY --from=build /out/healthcheck /usr/local/bin/healthcheck
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/api"]
