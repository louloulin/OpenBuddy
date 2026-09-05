# 更新日志 (Changelog) / Changelog

**English** · [简体中文](CHANGELOG.zh-CN.md)

### v0.15.0 (2026-09-01) — Enterprise Casdoor × NewAPI × OpenBuddy integration

#### 🎯 Commercial architecture

- **End-to-end enterprise agent workbench**: Casdoor (OIDC IdP) + NewAPI (model aggregator gateway) + OpenBuddy (agent workbench).
- **Dual-path NewAPI integration**:
  - **Path A · BYOK**: user-supplied `sk-…`, renderer-direct, no credits ledger.
  - **Path B · Enterprise Gateway**: server-side service token + Casdoor JWT, credits ledger + shared wallet + reconciliation.
- **Billing model v2**: 8 ledger flows (reservation / consume / release / expire / purchase / refund / adjustment / transfer) + 4-layer cross-accounting guards + 3 SKUs (free / team ¥99 / enterprise ¥999) + 70%+ margin gate.

#### 📦 4 new enterprise SDKs (66 tests total)

- **`@openbuddy/payment`** — Stripe / WeChat Pay / Alipay / HMAC adapters (28 tests).
- **`@openbuddy/scim`** — RFC 7644 SCIM v2 endpoints for enterprise user/group provisioning (19 tests).
- **`@openbuddy/saml`** — SAML 2.0 AuthnRequest / Response / LogoutRequest (11 tests).
- **`@openbuddy/webhook-outbox`** — transactional outbox with exponential backoff + jitter (8 tests).

#### 🌐 Standalone Web Admin Portal

- New `apps/admin-portal/`: independent SPA (React 18 + Vite 5), not embedded in Electron.
- 7 routes: Login / Callback / Dashboard / BillingPlans / CreditPricing / CreditReconciliation / Wallets / TenantPolicy / AuditLog.
- Casdoor OIDC PKCE reuses the desktop flow.
- Resource Gateway REST client (12 endpoints aligned to `openapi.yaml`).
- Deployment artifacts: multi-stage Dockerfile (Node 22 + Nginx alpine) + `nginx.conf` (API reverse-proxy + security headers + SPA fallback).
- Tests: 17/17 pass (6 api + 8 auth + 3 pages).

#### 🆕 NewAPI BYOK provider (renderer side)

- `src/lib/newapi-provider.ts` — BYOK adapter (`normalizeBaseUrl` / `fetchModels` / `modelToEntry` / `isValidKey` / `uiDefaults`).
- `ProviderKind` union now includes `"newapi"`.
- Settings UI adds the `NewAPI (self-hosted model aggregator)` preset (default `http://124.221.146.145:3000/v1`).
- `normalizeNewapiBaseUrl()` auto-appends `/v1` on save.
- Inline `setupHint` shown when NewAPI is selected.
- HelpSettingsPanel gains three entries: NewAPI docs / Casdoor docs / Admin Portal.

#### 📊 Documentation (9 new files)

- `openbuddy-token-billing-v2.md` (262 lines) — billing model + 98% WorkBuddy parity table.
- `newapi-integration-guide.md` (212 lines) — dual-path integration guide.
- `admin-console-architecture-decision.md` (169 lines) — 3-tier Admin split.
- `openbuddy-enterprise-integration-manifest.md` (288 lines) — single source of truth.
- `enterprise-completion-matrix.md` (90 lines) — completion matrix.
- `enterprise-live-verification-2026-09-01.md` (164 lines) — live evidence.
- `casdoor-newapi-openbuddy-architecture-diagram.svg` (20 KB) — system topology.
- `docs/diagrams/v2/openbuddy-enterprise-architecture.svg` (19 KB) — v2 commercial architecture.
- `apps/admin-portal/README.md` (201 lines) — deployment guide (Caddy / Nginx / Docker).

#### 🔬 Live integration verification

- `scripts/newapi-smoke.mjs` — CI-friendly smoke script (`/api/status` + baseUrl normalization + BYOK placeholder).
- `src/lib/__tests__/newapi-live.test.ts` — live integration tests (default skipped + `NEWAPI_LIVE_SKIP=0` enabled, 6 tests).
- Verified: NewAPI v1.0.0-rc.22 (LumosAI) at `http://124.221.146.145:3000` reachable from public internet + `/v1/models` auth works.

#### ✅ Quality

- Full test suite: **1,171 passed + 3 skipped = 1,174** (103 test files).
- Admin Portal build: 211 KB JS / 2.7 KB CSS / 0.53 KB HTML → `apps/admin-portal/dist/`.
- 8 pre-existing TypeScript errors (`renderer-plugin-runtime.ts` + `use-email-keyboard.test.ts`) unrelated to this release; runtime unaffected.

#### ⚠️ Client-side credential blockers (external dependencies)

1. Casdoor app callback / scopes / audience config.
2. WeChat AppID / SMS provider credentials.
3. HTTPS (Caddy + Let's Encrypt).
4. Secret manager (Vault / 1Password).
5. Stripe / WeChat Pay merchant accounts.
6. NewAPI channel `id=1` deepseek fix.

Once those 6 are done, declare production-ready.

---

### v0.14.0 (2026-08-17) — grok → Pi + moon monorepo

- **`grok-build` upgraded to 5163763** (xai-grok-shell 1.0.0 → 1.0.4; 8 sync batches upstream).
  - New capabilities: `ask_user_question` non-interactive optimization, web search domain filter, tool protocol frame extension.
  - Adaptation: memory switch config merged (`memory_enabled_override`), semantically compatible.
- **Team tooling zero-patch refactor** — `create_team` / `team_status` / `team_delete` moved from "modify grok source" to **embedded MCP server** (standard protocol, listens on `127.0.0.1`), zero intrusion into the grok kernel — future grok upgrades no longer require runtime patches.

### v0.13.0 (2026-08-03) — Casdoor enterprise auth

- OIDC PKCE for desktop.
- Tenant policy + audit log.
- 6 admin REST endpoints.

### v0.12.0 (2026-07-20) — Multi-agent foundation

- A2A protocol package.
- Rooms / inbox / task graph.
- Cross-agent evidence.

### Earlier releases

See the [Chinese section below](#简体中文) for full release history.
