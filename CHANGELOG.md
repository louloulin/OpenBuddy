# 更新日志 (Changelog) / Changelog

**English** · [简体中文](CHANGELOG.zh-CN.md)

### v0.15.1 (2026-09-07) — P0 缺口闭合 (macOS 真签名 + scripts 抽出)

#### 🔐 macOS 真签名 / 公证自动流水线（P0-1）

- `scripts/check-macos-signing.mjs` 新增 `--verify <artifact>` 模式：不仅守护环境变量存在，还对签名后产物跑 `codesign -dv`（检测 `Developer ID Application` authority + `runtime` hardened flag）→ `spctl --assess --type execute`（Gatekeeper 接受）→ `xcrun stapler validate`（仅 `.dmg` / `.pkg`）。失败码：`1` = 签名/公证失败，`2` = `codesign` 不在主机上。
- 新增 `--allow-unsigned` 模式：fork CI 可以在缺 Apple secrets 时跳过公证，仅以 warning 允许通过。
- `.github/workflows/release.yml` `build-macos` job 拆为 `import-cert` / `import-notary` 两个有输出的步骤；后续 `Build macOS DMG` / `Verify signed macOS artifact` / `Mark DMG as unsigned` 步骤根据两者输出动态决策。仓库级别 `vars.OPENBUDDY_ALLOW_UNSIGNED_MAC=1` 控制是否进入未签名分支。
- `docs/release-ci.md` 重写：补全 secrets 草案 + 「在缺少 secret 时跳过 notarize 但记录 warning」行为矩阵 + codesign 后置校验详细说明 + Gatekeeper 拒绝后的回滚步骤。
- `electron-builder.yml` 既有 `mac.hardenedRuntime: true` / `mac.notarize: true` 不变。

#### 🧪 scripts 提取 + P0 闭合守卫（P0-5）

- `scripts/verify-plan.mjs` 新建：14 项 transformation-plan 闭合检查（`scripts/check-macos-signing.mjs --verify` 接入、`docs/release-ci.md` 文档化、`.github/workflows/release.yml` 含 `OPENBUDDY_ALLOW_UNSIGNED_MAC`、`scripts/_section-credit-expiry.sh` 存在并声明 `run_credit_expiry_check` 等），可被 `pnpm verify:plan` / `pnpm verify:plan:json` 调用。
- `.github/workflows/release.yml` `ci` job 加 `Verify transformation-plan invariants (P0 closure guard)` 步骤：在任何 build job 之前跑 `pnpm verify:plan`；一旦 `_section-credit-expiry.sh` 或任何 P0 闭合证据被破坏，发布流水线在 ci job 阶段红灯。
- `package.json` 加 `verify:plan` / `verify:plan:json` 两个 npm script。
- `scripts/check-macos-signing.test.mjs` 新增 24 个单测（环境变量探测 / `codesign` 输出解析 / `verifySignedArtifact` 各路径）。
- `scripts/verify-plan.test.mjs` 新增 10 个单测（仓库现状 / 空仓库失败 / 回归检测 / `--only` 过滤）。
- `docs/openbuddy-transformation-plan.html` 表 5-1 更新：P0-1 / P0-5 标记为「✅ WU-B 完成」；5/5 P0 全部闭环。
- `docs/openbuddy-product-vs-pi.md` / `docs/deployment-guide.md` 同步更新。

#### ✅ Quality

- `pnpm verify:plan` → 14/14 passed。
- `scripts/*.test.mjs` → 87/87 passed（新增 34 个，全部绿色）。
- `pnpm typecheck -p tsconfig.json` / `pnpm typecheck -p electron/tsconfig.json` → 0 error。
- `pnpm build` (`electron-vite build`) → `✓ built in 14.07s`。
- 不引入新 npm 依赖。

---

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
