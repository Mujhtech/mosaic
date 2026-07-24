FROM golang:1.26.2-alpine AS build
WORKDIR /src/apps/api
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download
COPY apps/api/ ./
RUN CGO_ENABLED=0 go build -o /out/api ./cmd/api && \
    CGO_ENABLED=0 go build -o /out/migrate ./cmd/migrate && \
    CGO_ENABLED=0 go build -o /out/worker ./cmd/worker

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/api /usr/local/bin/api
COPY --from=build /out/migrate /usr/local/bin/migrate
COPY --from=build /out/worker /usr/local/bin/worker
COPY protocol/schema/v0.2/paywall.schema.json /usr/share/mosaic/paywall-v0.2.schema.json
COPY protocol/schema/commerce-provider/v1/contract.schema.json /usr/share/mosaic/commerce-provider-v1.schema.json
COPY protocol/schema/commerce-configuration/v1/configuration.schema.json /usr/share/mosaic/commerce-configuration-v1.schema.json
ENV MOSAIC_PROTOCOL_V02_SCHEMA_PATH=/usr/share/mosaic/paywall-v0.2.schema.json
ENV MOSAIC_COMMERCE_PROVIDER_SCHEMA_PATH=/usr/share/mosaic/commerce-provider-v1.schema.json
ENV MOSAIC_COMMERCE_CONFIGURATION_SCHEMA_PATH=/usr/share/mosaic/commerce-configuration-v1.schema.json
USER nonroot:nonroot
ENTRYPOINT ["/usr/local/bin/api"]
