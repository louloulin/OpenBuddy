# OpenBuddy Admin Portal · Dockerfile
# 多阶段构建：先构建静态文件，再放入 Nginx

# === Stage 1: build ===
FROM node:22-alpine AS builder
WORKDIR /app
# 仅复制必要文件（依赖 + 源码）
COPY apps/admin-portal/package.json apps/admin-portal/package.json
COPY apps/admin-portal/tsconfig.json apps/admin-portal/tsconfig.json
COPY apps/admin-portal/vite.config.ts apps/admin-portal/vite.config.ts
COPY apps/admin-portal/index.html apps/admin-portal/index.html
COPY apps/admin-portal/src apps/admin-portal/src
COPY apps/admin-portal/public apps/admin-portal/public

# 共享根 node_modules（用于解析依赖）
COPY package.json package.json
COPY pnpm-workspace.yaml pnpm-workspace.yaml
COPY node_modules node_modules
COPY packages packages

# 构建
WORKDIR /app/apps/admin-portal
RUN npx vite build --config vite.config.ts

# === Stage 2: serve ===
FROM nginx:alpine
COPY --from=builder /app/apps/admin-portal/dist /usr/share/nginx/html
COPY apps/admin-portal/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost/ > /dev/null || exit 1
