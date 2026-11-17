# The OpenBuddy gateway, as one image.
#
# The gateway is a Bun program; the image carries the Bun runtime and the
# source, and the entrypoint runs it. Two build stages keep the runtime image
# small: the first resolves the dependencies, the second copies only what the
# server needs.
#
#   docker build -t openbuddy-gateway packages/gateway
#   docker run --rm -p 8787:8787 \
#     -e GATEWAY_ADMIN_TOKEN=... -e GATEWAY_AGENT_TOKEN=... \
#     -v openbuddy-gateway:/data openbuddy-gateway
#
# The database lives on a volume so a restart keeps the paired devices.

FROM oven/bun:1.4.2-alpine AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

FROM oven/bun:1.4.2-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    GATEWAY_HOST=0.0.0.0 \
    GATEWAY_PORT=8787 \
    GATEWAY_DB=/data/openbuddy.sqlite

# The runtime image keeps the source: the gateway reads its own files
# (embedded UI assets, migrations) from disk.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
COPY tsconfig.json ./

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "const r = await fetch('http://127.0.0.1:' + (process.env.GATEWAY_PORT ?? 8787) + '/health'); process.exit(r.ok ? 0 : 1)"

ENTRYPOINT ["bun", "run", "src/index.ts"]
