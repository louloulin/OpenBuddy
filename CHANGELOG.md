# 更新日志 (Changelog) / Changelog

**English** · [简体中文](CHANGELOG.zh-CN.md)

### v0.16.0 (2026-09-22) — Microkernel slots, plugin trust, and a self-updating desktop

#### 🧩 Microkernel slot surface reaches zero dead ends

- **Every declared slot now has a consumer**: the `placeholder.*` family (11 slots) plus the last 4 dead slots (shell replacement / What's New / feedback / data dir) are wired, so "declared but nobody consumes it" is 0.
- **New three-state slot audit** (`scripts/ui-slot-coverage.mjs` + `ui-slot-audit.mjs`): static scan of declared → registered → consumed, with a CI guard that fails when type holes appear or wiring regresses.
- **Slot-driven surfaces**: Office preview (Workbench) takeover, `editor.draft` new-draft entry (`⌘⇧D`), `view` / `approvals` conversation surfaces, details rail, `files.tree` virtualization, and `plugin.command` in both `⌘K` and the composer's `/` menu.
- **Microkernel health panel** in Settings → System info (registered / consumed / missing counts, with the off-by-one `size()` / `snapshot()` bug fixed).

#### 🔐 Plugin trust and a working marketplace

- **Plugin integrity badge**: new browser-safe `plugin:hash-content` IPC bridge + SHA-256 badge in the OpenBuddy plugin panel, so a plugin's identity is visible before it runs.
- **Pi extension marketplace**: multi-source index (host / env / file), source management UI (add / edit / remove / probe), per-entry action predicates, uninstall, and search / filter over the catalog.
- **Expert Marketplace Bridge**: expert cards gain a "view on pi.dev" link; the bridge resolves remote expert contributions instead of silently rendering an empty state.
- **Bundled starter experts**: an in-repo starter-expert catalog materializes into `<agentHome>/experts` on first run, so an open-source first launch no longer depends on an external WorkBuddy data directory.

#### 🔄 Auto-update and privacy

- **`electron-updater` wired at app start**: the `publish:` block drives feeds; update events are logged and broadcast to renderer windows. `autoDownload=false` (no silent bandwidth use), `autoInstallOnAppQuit=true`.
- **Unsigned DMG profile** (`electron-builder.unsigned.yml`): a credential-free local macOS package path for contributors without a Developer ID.
- **Privacy surface**: `docs/PRIVACY.md` bundled as `extraResources/PRIVACY.md` with a Help-menu entry, an AI privacy section in settings, and localized provider test status.

#### 🏗️ Architecture: the renderer contract gets a single source of truth

- **4 contract packages** — `@openbuddy/ui-contract`, `@openbuddy/platform`, `@openbuddy/agent-rpc`, `@openbuddy/ui-state` — with `package.json#exports` as the only source of truth for aliases.
- **Module migration**: ~76 renderer modules move out of `src/lib` into those packages, with import rewriting verified by a scanner (batches that broke `pi-client`'s sibling imports were rolled back rather than force-landed).
- **tsconfig collapse**: 67 per-package `tsconfig.json` files reduce to `{ "extends": "…/tsconfig.package-base.json" }`; `vite` / `electron-vite` / `vitest` all derive aliases via `vite-tsconfig-paths`, so `scripts/sync-ui-aliases.mjs` and `packages/ui/alias-list.json` are gone.
- **`pnpm-workspace.yaml` glob fix**: flat packages (`packages/payment`, `packages/saml`, `packages/scim`, `packages/webhook-outbox`) were silently excluded from the workspace; bare directory globs now match them.

#### 📦 Build output moves to `dist/`

- **Single build output directory**: `electron-vite` writes `dist/{main,preload,renderer}`, `electron-builder` packages from it, and `package.json#main` points at `./dist/main/index.js`. The old `out/` directory is gone from config, `moon.yml` inputs/outputs, `.gitignore`, and the release scripts.
- **134 stray emit artifacts deleted**: `.js` files next to `src/*.ts` and `__tests__/*.test.ts` (leftovers from an earlier `tsc -b` experiment) are removed, with a `packages/**/__tests__/**/*.test.js` ignore rule as a defense. Hand-written fixtures and `.d.ts` shims preserved.
- **Convention documented** in `docs/build-output-conventions.md`.
- **Typecheck repaired**: the solution-style `tsc -b` refactor was reverted to `tsc --noEmit` (3774 errors → 0) and ~50 real type errors surfaced by the stricter paths were fixed.

#### ✅ Quality

- Typecheck: **0 errors** (`tsc --noEmit`, renderer + electron main/preload).
- Test suite: **855 test / spec files** across the workspace; CI gates run typecheck → workspace typecheck → tests → build.
- `macOS` end-to-end verified: `pnpm electron:build:mac` produces `release/OpenBuddy-0.16.0-{arm64,x64}.dmg`.

#### 🧰 New release tooling

- **`scripts/bump-version.mjs`** — one command bumps the version across **88 files** (74 `package.json` manifests + `hostVersion` + website JSON-LD / installer filenames / i18n chips + example plugin manifests), with `--dry-run`, `--json`, `--current`, and a post-write self-check.
- Release note extraction fixed to match the CHANGELOG's actual heading depth (`### vX.Y.Z`), so the GitHub Release body is the release section rather than a generated commit list.

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

#### Milestone (2026-08-17) — grok → Pi + moon monorepo

- **`grok-build` upgraded to 5163763** (xai-grok-shell 1.0.0 → 1.0.4; 8 sync batches upstream).
  - New capabilities: `ask_user_question` non-interactive optimization, web search domain filter, tool protocol frame extension.
  - Adaptation: memory switch config merged (`memory_enabled_override`), semantically compatible.
- **Team tooling zero-patch refactor** — `create_team` / `team_status` / `team_delete` moved from "modify grok source" to **embedded MCP server** (standard protocol, listens on `127.0.0.1`), zero intrusion into the grok kernel — future grok upgrades no longer require runtime patches.

#### Milestone (2026-08-03) — Casdoor enterprise auth

- OIDC PKCE for desktop.
- Tenant policy + audit log.
- 6 admin REST endpoints.

#### Milestone (2026-07-20) — Multi-agent foundation

- A2A protocol package.
- Rooms / inbox / task graph.
- Cross-agent evidence.

### Earlier releases

See the [Chinese section below](#简体中文) for full release history.
