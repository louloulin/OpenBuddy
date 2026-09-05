# OpenBuddy Admin Portal · 独立 Web 管理控制台

> 推荐方案：基于 Resource Gateway REST API + Casdoor OIDC 的独立 Web 应用。
> 用于 OpenBuddy 桌面端的 **L3 企业管理**（财务/计费/对账/账户管理）。

## 1. 为什么独立 Web（而非继续塞进 Electron 客户端）

| 维度 | 客户端内嵌（当前） | 独立 Web Portal（推荐） |
|---|---|---|
| 安装包体积 | ~150 MB | 0（不安装） |
| Casdoor 字段升级 | 客户端+IPC+类型三处同步 | Portal 单独同步 |
| 财务/对账报表 | 受限于桌面 React 表格 | 原生支持 PDF/Excel |
| 多端一致性 | 仅 Electron | 平板/手机/网页一致 |
| WorkBuddy 哲学 | 重客户端 + 重云端 ❌ | 轻客户端 + 重云端 ✅ |

参考：[`docs/admin-console-architecture-decision.md`](../../docs/admin-console-architecture-decision.md)

## 2. 三层分工

```text
┌────────────────────────────────────────────────────────────┐
│ L1 · Casdoor / NewAPI 原生 web（直接跳转）                  │
│   账号绑定 · Webhook · 成员 · 角色 · 权限 · 群组 · 规则  │
│   资源目录 · Token 内省 · 租户策略                         │
├────────────────────────────────────────────────────────────┤
│ L2 · OpenBuddy Desktop 客户端（本地独有）                  │
│   会话管理 · 网关健康 · 智能体邮箱 · 通知中心 · 系统设置  │
├────────────────────────────────────────────────────────────┤
│ L3 · OpenBuddy Admin Portal（本仓库实现）                  │
│   企业计费 · 积分定价 · 成本对账 · 扣费账户 · 账户管理  │
└────────────────────────────────────────────────────────────┘
```

## 3. 技术栈

- **构建工具**：Vite 5.x
- **UI 框架**：React 18 + TypeScript
- **样式**：Tailwind CSS + `--wb-*` 设计令牌
- **状态管理**：Zustand
- **HTTP 客户端**：fetch + HMAC 验签
- **认证**：Casdoor OIDC PKCE（同 `electron/main/casdoor-auth.ts` 的桌面流程）
- **路由**：React Router 6.x
- **数据可视化**：Recharts

## 4. 目录结构

```text
apps/admin-portal/
├── README.md              本文件
├── package.json           Portal 独立依赖
├── vite.config.ts         Vite 构建配置（含 Gateway 代理）
├── tailwind.config.ts     设计令牌 + WB 主题
├── index.html             SPA 入口
├── src/
│   ├── main.tsx           React 挂载入口
│   ├── App.tsx            顶层路由
│   ├── auth/              Casdoor OIDC 集成（PKCE + sessionStorage）
│   │   ├── oidc-client.ts
│   │   ├── AuthGuard.tsx  路由守卫
│   │   ├── Login.tsx      登录页
│   │   └── Callback.tsx   OIDC 回调
│   ├── api/               Resource Gateway REST 客户端
│   │   └── gateway-client.ts
│   ├── pages/             7 个页面（全部已实现）
│   │   ├── Dashboard.tsx
│   │   ├── BillingPlans.tsx
│   │   ├── CreditPricing.tsx
│   │   ├── CreditReconciliation.tsx
│   │   ├── Wallets.tsx
│   │   ├── TenantPolicy.tsx
│   │   └── AuditLog.tsx
│   ├── components/
│   │   └── Layout.tsx     侧边栏 + 顶部状态条
│   └── styles/            全局 CSS
└── public/
```

## 5. 与 Resource Gateway 的契约

Portal 仅作为 Gateway REST 的 web client，不重复实现任何商业逻辑：

| Gateway 端点 | Portal 用途 |
|---|---|
| `POST /v1/tenants/{id}/billing/plans` | 列出/创建/修改计费套餐 |
| `POST /v1/tenants/{id}/billing/orders` | 创建订单 + HMAC 回调 |
| `GET /v1/tenants/{id}/credits/pricing` | 列出模型定价 |
| `PATCH /v1/tenants/{id}/credits/pricing` | 调价（带脏值追踪） |
| `GET /v1/tenants/{id}/credits/reconciliation` | 成本对账报告（按模型/成员） |
| `GET /v1/tenants/{id}/credits/ledger` | 不可变流水 |
| `GET /v1/tenants/{id}/wallets` | 共享钱包列表 |
| `POST /v1/tenants/{id}/wallets` | 创建共享钱包 |
| `PATCH /v1/tenants/{id}/policy` | 租户策略（killSwitch / allowlist） |
| `GET /v1/tenants/{id}/audit` | 审计流 |
| `GET /healthz` · `GET /metrics` | 健康检查 + Prometheus |

## 6. 部署

Portal 是个静态 SPA，可独立部署到任何 CDN/对象存储/Caddy/Nginx：

```bash
# 1. 构建（输出 dist/ 静态文件）
node apps/admin-portal/scripts/build.mjs
# 或
npx vite build --config apps/admin-portal/vite.config.ts

# 2. 产物
apps/admin-portal/dist/  # 纯静态文件
```

### 6.1 反向代理（生产推荐 · Caddy）

```caddyfile
admin.openbuddy.com {
  root * /var/www/openbuddy-admin-portal
  encode gzip zstd
  file_server
  @spa path /login /callback /billing/* /wallets /reconciliation /policy /audit
  handle @spa {
    rewrite * /index.html
  }
  # /api/gateway → Resource Gateway
  reverse_proxy /api/gateway localhost:8787
  # /api/casdoor → Casdoor IDP
  reverse_proxy /api/casdoor localhost:8000
}
```

### 6.2 Nginx（生产推荐 · 备选）

```nginx
server {
  listen 443 ssl http2;
  server_name admin.openbuddy.com;
  root /var/www/openbuddy-admin-portal;
  index index.html;

  location /api/gateway/ { proxy_pass http://localhost:8787/; }
  location /api/casdoor/ { proxy_pass http://localhost:8000/; }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

### 6.3 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `VITE_GATEWAY_URL` | `http://localhost:8787` | Resource Gateway 地址 |
| `VITE_CASDOOR_ISSUER` | `http://localhost:8000` | Casdoor IDP 地址 |
| `VITE_CASDOOR_CLIENT_ID` | `005d6839fe25abd6696f` | Casdoor 应用 client id |
| `VITE_CASDOOR_REDIRECT_URI` | `${window.location.origin}/callback` | OIDC 重定向 URI |

### 6.4 推荐部署位置

- **生产**：`https://admin.openbuddy.com/`
- **内网**：`https://openbuddy-admin.internal/`
- **开发**：`http://localhost:5173/`（Vite dev server）

### 6.5 Docker 镜像（备选）

```dockerfile
FROM nginx:alpine
COPY dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

构建：

```bash
docker build -t openbuddy/admin-portal:0.1.0 -f apps/admin-portal/Dockerfile .
```

## 7. 与 Electron 客户端的协作

- Electron 客户端的 `casdoor:billing-*` / `casdoor:credits-*` IPC **保持不变**
- Electron 客户端通过 `casdoor:open-management` 调起 Portal 页面
- Portal 与 Electron 客户端共享同一份 Casdoor OIDC session（通过 cookie 或 PKCE）

## 8. 开发进度

- ✅ README + 目录结构
- ✅ 基础设施：Vite 5 + React 18 + Tailwind + React Router 6
- ✅ Casdoor OIDC PKCE 集成（Login / Callback / AuthGuard / oidc-client）
- ✅ Resource Gateway REST 客户端（gateway-client.ts）
- ✅ 7 个页面：Dashboard / BillingPlans / CreditPricing / CreditReconciliation / Wallets / TenantPolicy / AuditLog
- ✅ 单元测试：17/17 通过（api + auth + pages）
- ✅ 构建脚本：`scripts/build.mjs`
- ✅ 部署文档（§6 Caddy / Nginx / Docker）

### 测试覆盖

| 范围 | 测试 | 状态 |
|---|---:|:-:|
| `apps/admin-portal/src/api/__tests__/gateway-client.test.ts` | 6 | ✅ |
| `apps/admin-portal/src/auth/__tests__/oidc-client.test.ts` | 5 | ✅ |
| `apps/admin-portal/src/auth/__tests__/Callback.test.tsx` | 3 | ✅ |
| `apps/admin-portal/src/auth/__tests__/AuthGuard.test.tsx` | 3 | ✅ |
| **Portal 合计** | **17** | **✅** |
