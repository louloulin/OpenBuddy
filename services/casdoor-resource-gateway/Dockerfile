# Build stage — install only what the gateway needs (TypeScript + dev deps).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --ignore-scripts --no-audit --no-fund
COPY src ./src
RUN npm run build

# Runtime stage — slimmer image with optional SQL drivers as separate layers.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    RESOURCE_GATEWAY_DATA_DIR=/var/lib/openbuddy-resource-gateway

RUN addgroup -S openbuddy && adduser -S -G openbuddy openbuddy \
  && mkdir -p /var/lib/openbuddy-resource-gateway \
  && chown -R openbuddy:openbuddy /var/lib/openbuddy-resource-gateway /app

COPY --from=build /app/dist ./dist
COPY package.json ./

# Optional production-only drivers. Pass `--build-arg INCLUDE_SQL_DRIVERS=true`
# to enable postgres / mysql support. Layered so the default image stays small.
ARG INCLUDE_SQL_DRIVERS=false
RUN if [ "$INCLUDE_SQL_DRIVERS" = "true" ]; then \
      npm install --omit=dev --no-audit --no-fund pg mysql2; \
    fi

USER openbuddy
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -q -O - http://127.0.0.1:8787/readyz >/dev/null || exit 1
CMD ["node", "dist/index.js"]
