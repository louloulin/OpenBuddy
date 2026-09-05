# Operations Guide

> 🌐 **Language / 语言:** [English](#english) · [简体中文](#简体中文)

This guide covers **deploying and operating OpenBuddy in production** — for self-hosters, IT teams, and enterprise admins. For developer setup, see [`GETTING_STARTED.md`](GETTING_STARTED.md). For CI/release workflow, see [`release-ci.md`](release-ci.md).

---

<a id="english"></a>
## 🇬🇧 English

### Deployment topology

A full OpenBuddy enterprise deployment has three layers:

```
┌─────────────────────────────────────────────────────────┐
│  Client devices                                         │
│    Windows / macOS / Linux OpenBuddy app                │
│    (auto-update from GitHub Releases)                   │
└──────────────────────┬──────────────────────────────────┘
                       │ OIDC (Casdoor) + REST (NewAPI)
┌──────────────────────┴──────────────────────────────────┐
│  Identity & gateway tier                                │
│    Casdoor (OIDC IdP)         — SSO, tenants, audit     │
│    NewAPI (model gateway)     — BYOK + Service Token    │
│    Casdoor Resource Gateway   — billing, credits, plans │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTPS
┌──────────────────────┴──────────────────────────────────┐
│  LLM providers                                          │
│    Anthropic / OpenAI / OpenAI-compatible / self-hosted  │
└─────────────────────────────────────────────────────────┘
```

### Reference deployments

| Scenario | Components | Reference |
|---|---|---|
| **Personal** | OpenBuddy app + 1 BYOK provider | — |
| **Team (10–50)** | OpenBuddy app + Casdoor (self-host) + NewAPI (self-host) | [`casdoor-enterprise-auth.md`](casdoor-enterprise-auth.md) |
| **Enterprise (50+)** | All of the above + Casdoor Resource Gateway + Admin Portal + SAML/SCIM | [`enterprise-casdoor-newapi-openbuddy-architecture.md`](enterprise-casdoor-newapi-openbuddy-architecture.md) |

### Casdoor (OIDC IdP)

#### Self-host with Docker

```bash
# Clone the recommended config
git clone https://github.com/casdoor/casdoor.git
cd casdoor

# Edit conf/app.conf
#   appname = openbuddy-prod
#   casdoorEndpoint = https://casdoor.your-domain.com
#   copyDbIp = false  # set to true for HA

# Run
docker-compose up -d
```

For OpenBuddy to use it:

1. Create an OIDC application in Casdoor.
2. Copy the `Client ID` and `Client Secret`.
3. In OpenBuddy: **Settings → Authentication → Casdoor**:
   - Endpoint: `https://casdoor.your-domain.com`
   - Client ID: (paste)
   - Client Secret: (paste)
   - Redirect URI: `casdoor://oauth/callback`
4. Click "Sign in".

#### HA setup

For high availability:

- PostgreSQL (not SQLite) as the Casdoor backend
- ≥ 2 Casdoor instances behind a load balancer
- Shared session store (Redis)

See the [Casdoor HA docs](https://casdoor.org/docs/).

### NewAPI (model gateway)

#### Self-host with Docker

```bash
git clone https://github.com/songquanpeng/new-api.git
cd new-api
docker-compose up -d
```

#### Add channels

NewAPI aggregates multiple LLM providers ("channels"):

1. **Settings → Channels → Add**:
   - **Anthropic**: name + base URL + `sk-ant-…` key
   - **OpenAI**: name + base URL + `sk-…` key
   - **OpenAI-compatible** (Together, Groq, etc.): custom base URL
2. Set per-channel rate limits and priority.
3. Enable the channels you want.

#### Issue a Service Token

For OpenBuddy to call NewAPI on behalf of users:

1. **Settings → Tokens → Add Token**.
2. Set name (`openbuddy-prod`), unlimited, no expiration.
3. Restrict to OpenBuddy's IP range.
4. Copy the `sk-…` value into OpenBuddy: **Settings → Providers → NewAPI → Service Token**.

### Resource Gateway (billing + admin)

The Resource Gateway is the REST backend for the Admin Portal. It's at [`services/casdoor-resource-gateway/`](../../services/casdoor-resource-gateway/) and runs separately from OpenBuddy.

#### Deploy

```bash
cd services/casdoor-resource-gateway
# Configure
cp .env.example .env
$EDITOR .env
# Run
docker-compose -f docker-compose.production.yml up -d
```

Reference: `services/casdoor-resource-gateway/Caddyfile`, `Dockerfile`, `docker-compose.production.yml`.

#### Endpoints

12 endpoints, all behind OIDC:

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/auth/login` | OIDC login (proxy to Casdoor) |
| `POST /api/v1/auth/callback` | OIDC callback |
| `GET /api/v1/billing/plans` | List billing plans |
| `POST /api/v1/billing/plans` | Upsert plan |
| `GET /api/v1/billing/orders` | List orders |
| `POST /api/v1/billing/orders` | Create order |
| `POST /api/v1/billing/orders/:id/refund` | Refund order |
| `POST /api/v1/billing/orders/:id/expire` | Expire order |
| `GET /api/v1/credits/:userId` | User credit balance |
| `POST /api/v1/credits/grant` | Grant credits |
| `GET /api/v1/credits/ledger` | Credit ledger |
| `GET /api/v1/wallets/:tenantId` | Tenant wallet |

See `services/casdoor-resource-gateway/openapi.yaml` for the full OpenAPI spec.

### Admin Portal

The Admin Portal is at [`apps/admin-portal/`](../../apps/admin-portal/). It's a standalone React SPA that calls the Resource Gateway.

#### Build

```bash
cd apps/admin-portal
pnpm install
pnpm build
```

Output: `apps/admin-portal/dist/` (211 KB JS / 2.7 KB CSS).

#### Deploy

`apps/admin-portal/` ships with:

- `Dockerfile` — multi-stage (Node 22 build → Nginx alpine runtime)
- `nginx.conf` — API reverse-proxy + SPA fallback + security headers
- `Caddyfile` — alternative reverse proxy

Reference: [`apps/admin-portal/README.md`](../../apps/admin-portal/README.md).

### SAML 2.0 + SCIM v2

For enterprise federation:

#### SAML 2.0

1. Configure your IdP (Okta, Azure AD, etc.) with OpenBuddy's ACS URL: `https://casdoor.your-domain.com/api/saml/acs`.
2. Download the IdP metadata XML.
3. Upload to Casdoor: **Authentication → SAML**.
4. Map IdP claims to Casdoor attributes.

OpenBuddy uses `@openbuddy/saml` for AuthnRequest/Response/LogoutRequest primitives.

#### SCIM v2

OpenBuddy's `@openbuddy/scim` exposes RFC 7644 SCIM v2 endpoints for automated user/group provisioning.

```
GET    /scim/v2/Users
GET    /scim/v2/Users/{id}
POST   /scim/v2/Users
PUT    /scim/v2/Users/{id}
PATCH  /scim/v2/Users/{id}
DELETE /scim/v2/Users/{id}

GET    /scim/v2/Groups
POST   /scim/v2/Groups
PATCH  /scim/v2/Groups/{id}
DELETE /scim/v2/Groups/{id}
```

Configure your IdP to point at `https://casdoor.your-domain.com/scim/v2` with a SCIM bearer token.

### Payment integrations

OpenBuddy's `@openbuddy/payment` ships adapters for 4 channels:

| Channel | Use case |
|---|---|
| **Stripe** | International cards, Apple Pay, Google Pay |
| **WeChat Pay** | China consumer payments |
| **Alipay** | China consumer payments |
| **HMAC** | Custom gateway integration |

Each adapter implements:

```typescript
interface PaymentAdapter {
  createOrder(input: CreateOrderInput): Promise<Order>;
  capturePayment(orderId: string): Promise<CaptureResult>;
  refund(orderId: string, amount?: number): Promise<RefundResult>;
  verifyWebhook(payload: string, signature: string): WebhookEvent;
}
```

#### Stripe example

```typescript
import { StripeAdapter } from "@openbuddy/payment";

const stripe = new StripeAdapter({
  apiKey: process.env.STRIPE_API_KEY!,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
});

const order = await stripe.createOrder({
  amount: 9999,        // cents
  currency: "usd",
  customerId: user.id,
  metadata: { plan: "team" },
});
```

#### Webhook delivery (transactional outbox)

All payment webhooks go through `@openbuddy/webhook-outbox`:

1. Webhook received → stored in outbox table with `idempotency_key`.
2. Worker retries with exponential backoff + jitter.
3. Max 8 retries → marked `dead_letter` for manual handling.
4. Webhook signature verified by adapter (`StripeAdapter.verifyWebhook`).

### Audit log shipping

For SOC2 / GDPR compliance, ship OpenBuddy's audit log to your SIEM:

```bash
# Tail the audit log
tail -f ~/.config/openbuddy/audit.log

# Or use the audit log shipping agent (a thin shell wrapper is provided):
node scripts/audit-enterprise-release.mjs --audit-shipping \
  --endpoint https://splunk.your-domain.com:8088 \
  --token "$SPLUNK_TOKEN"
```

For production use, ship via your standard log forwarder (`fluentd`, `vector`, `filebeat`) reading the JSONL ledger — OpenBuddy keeps it append-only and hash-chained for tamper evidence.

Audit log fields:

```typescript
interface AuditEntry {
  ts: string;              // ISO 8601
  actor: string;           // user ID or "system"
  capability: string;      // e.g. "openbuddy.capability.email"
  action: string;          // e.g. "send", "read", "delete"
  resource: string;        // e.g. "mailto:foo@example.com"
  result: "success" | "denied" | "error";
  reason?: string;         // human-readable
  evidence?: object;       // arbitrary structured data
  prevHash: string;        // hash chain
  hash: string;            // SHA-256 of this entry + prevHash
}
```

The hash chain makes tampering detectable.

### Backups

| Data | Backup strategy |
|---|---|
| Local sessions | `~/.config/openbuddy/sessions/` → nightly rsync to NAS |
| Audit log | Ship to SIEM (see above) |
| Casdoor DB | `pg_dump` daily, retain 30 days |
| NewAPI DB | `mysqldump` daily, retain 30 days |
| Resource Gateway | Stateless; redeploy from Docker image |

### Disaster recovery

| Scenario | RTO | RPO | Recovery |
|---|---|---|---|
| Casdoor DB loss | 4 h | 24 h | Restore from `pg_dump` |
| NewAPI DB loss | 4 h | 24 h | Restore from `mysqldump` |
| OpenBuddy app broken | 30 min | n/a | Auto-update to previous version |
| Network partition | n/a | n/a | OpenBuddy falls back to offline mode (read-only sessions) |
| Resource Gateway down | 1 h | n/a | Redeploy from Docker image; sessions continue |

### Monitoring

Recommended metrics (Prometheus):

- `openbuddy_app_active_users_total`
- `openbuddy_app_session_count`
- `openbuddy_ipc_roundtrip_seconds` (p50, p95, p99)
- `openbuddy_capability_invocation_total{capability, result}`
- `openbuddy_audit_log_entries_total{result}`
- `openbuddy_storage_bytes{path}`

Recommended alerts:

- IPC p95 > 50 ms (page on-call)
- Audit log entry denied rate > 10% (notify security)
- Storage growth > 1 GB/day (notify ops)
- Auto-update failure rate > 5% (notify release team)

### Cost optimization

| Tip | Impact |
|---|---|
| Use prompt caching | 50–80% cost reduction on long contexts |
| Route small models for simple tasks | 5–10× cheaper for routing |
| Set per-user rate limits | Prevent runaway costs |
| Enable NewAPI channel priority | Use cheapest channel first |
| Audit log retention: 90 days | Bound storage growth |

---

<a id="简体中文"></a>
## 🇨🇳 简体中文

### 部署拓扑

完整的 OpenBuddy 企业部署有三层:

```
┌─────────────────────────────────────────────────────────┐
│  客户端                                                  │
│    Windows / macOS / Linux OpenBuddy App                │
│    (从 GitHub Releases 自动更新)                          │
└──────────────────────┬──────────────────────────────────┘
                       │ OIDC (Casdoor) + REST (NewAPI)
┌──────────────────────┴──────────────────────────────────┐
│  身份 & 网关层                                            │
│    Casdoor (OIDC IdP)         —— SSO、租户、审计          │
│    NewAPI (模型网关)          —— BYOK + Service Token    │
│    Casdoor Resource Gateway   —— 计费、积分、套餐         │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTPS
┌──────────────────────┴──────────────────────────────────┐
│  LLM Provider                                            │
│    Anthropic / OpenAI / OpenAI 兼容 / 自托管              │
└─────────────────────────────────────────────────────────┘
```

### 参考部署

(同英文表格)

### Casdoor(OIDC IdP)

#### 用 Docker 自托管

(代码同英文版)

#### HA 配置

(同英文版)

### NewAPI(模型网关)

#### 用 Docker 自托管

(代码同英文版)

### Resource Gateway(计费 + 管理)

Resource Gateway 是 Admin Portal 的 REST 后端,在 [`services/casdoor-resource-gateway/`](../../services/casdoor-resource-gateway/),独立于 OpenBuddy 跑。

(其余内容同英文版)

### 支付集成

(同英文版)

### 审计日志外发

(同英文版)

### 备份

(同英文版)

### 灾备

(同英文版)

### 监控

(同英文版)

### 成本优化

(同英文版)

---

<div align="center">

**Operate OpenBuddy like production software — because it is. / 像生产软件一样运维 OpenBuddy —— 它就是。**

</div>
