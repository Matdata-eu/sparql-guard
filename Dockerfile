# syntax=docker/dockerfile:1

# ---- build -------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime -----------------------------------------------------------------
# distroless/nodejs runs as uid 65532 ("nonroot") and has no shell.
FROM gcr.io/distroless/nodejs22-debian12:nonroot

LABEL org.opencontainers.image.title="sparql-guard" \
      org.opencontainers.image.description="Store-neutral access-control proxy for SPARQL endpoints" \
      org.opencontainers.image.source="https://github.com/Matdata-eu/sparql-guard" \
      org.opencontainers.image.licenses="Apache-2.0"

WORKDIR /app
COPY --from=build /src/package.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/dist ./dist

# Mount the config and the policy files here (e.g. from a ConfigMap).
ENV SPARQL_GUARD_CONFIG=/config/sparql-guard.json
VOLUME ["/config"]
EXPOSE 8080

ENTRYPOINT ["/nodejs/bin/node", "/app/dist/cli.js"]
CMD ["serve"]
