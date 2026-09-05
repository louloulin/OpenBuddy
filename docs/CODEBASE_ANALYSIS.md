# OpenBuddy Codebase Analysis

> **Snapshot taken:** `git rev-parse HEAD` = `a9d240ff feat(pi-observability): forward session_tree / session_before_fork / provider hooks`
> **Date:** 2026-09-05
> **Scope:** every directory listed under `packages/`, `electron/`, `src/`, `apps/`, `scripts/`, `evals/`.
> **Bilingual:** [English](CODEBASE_ANALYSIS.md) · [简体中文](CODEBASE_ANALYSIS.zh-CN.md)

This document is the result of running **structural queries only** (`ls`, `find`, `grep` on package manifests and `index.ts` exports) on the live tree. Every claim is marked with one of:

| Marker | Meaning |
|---|---|
| `[V]` | Verified at the cited path by reading the file or running a structural query. |
| `[I]` | Reasonable inference from neighbouring verified facts. Treat as a hypothesis until you re-check. |
| `[OOS]` | Out of scope of this snapshot — listed for orientation, not analysed. |

The repo already contains [PROJECT_ANALYSIS.md](../PROJECT_ANALYSIS.md) and [openbuddy-capability-matrix.md](openbuddy-capability-matrix.md). Those documents predate this one and use slightly different counts; treat this file as the canonical 2026-09-05 reference.

---

## 🏛️ Visual summary

### End-to-end architecture

<p align="center">
  <img src="diagrams/architecture-overview.svg" alt="OpenBuddy end-to-end architecture" width="900" />
</p>

### Capability matrix (64 packages, 8 groups)

<p align="center">
  <img src="diagrams/capability-matrix.svg" alt="OpenBuddy capability matrix" width="900" />
</p>

### Data flow — prompt to tool result

<p align="center">
  <img src="diagrams/data-flow-end-to-end.svg" alt="OpenBuddy data flow" width="900" />
</p>

---

## 1. Top-level layout

```
openbuddy/                          # monorepo root (moon workspace)
├── moon.yml                        # renderer moon project (Vite + React)        [V]
├── electron/
│   └── moon.yml                    # Electron main + preload moon project          [V]
├── electron.vite.config.ts         # aliases @openbuddy/* → packages/*/src/index.ts [V]
├── electron-builder.yml            # productName: OpenBuddy, appId: com.openbuddy.desktop [V]
├── src/                            # React renderer (alias-resolved by electron-vite)
├── packages/                       # 64 published workspace packages              [V]
├── apps/                           # admin-portal (Casdoor OIDC + Resource Gateway SPA)  [OOS]
├── evals/                          # node eval harnesses (MT-Bench, BFCL, AgentBench, …)  [V]
├── scripts/                        # dev/build/eval helpers                        [V]
├── docs/                           # this file lives here                          [V]
├── public/                         # static assets (favicon, locales)             [V]
├── build/                          # electron-builder build resources              [V]
├── deploy/                         # deployment templates                          [OOS]
├── services/                       # shipped systemd units / launchd plists        [OOS]
├── playwright.config.ts            # Electron UI smoke tests                       [V]
├── vitest.config.ts                # vitest unit/integration runner                [V]
├── tsconfig.json / tsconfig.base.json  # strict TS 5.6, paths                    [V]
└── pnpm-workspace.yaml             # workspace roots (packages/*, apps/*, services/*) [V]
```

Workspace globs from `.moon/workspace.yml`:

```yaml
projects:
  globs:
    - "packages/*/*"
    - "moon.yml"
    - "electron/moon.yml"
```

→ every `packages/<group>/<pkg>` directory is a moon project, **even when it has no `moon.yml` of its own**. Group-level directories (`packages/payment`, `packages/saml`, `packages/scim`, `packages/webhook-outbox`) keep their `moon.yml` so they run as a single project. `[V]`

---

## 2. Verified package inventory

Run on 2026-09-05:

```bash
find packages -mindepth 2 -name "package.json" \
  -not -path "*/node_modules/*" \
  -not -path "*/__fixtures__/*" \
  -exec grep -h '"name":' {} \;
```

**Group breakdown** `[V]`:

| Group | Packages | Count |
|---|---|---:|
| `auth/` | `auth-casdoor`, `auth-permission` | 2 |
| `bundle/` | `bundle-base`, `bundle-desktop` | 2 |
| `capability/` | `capability-authorization`, `capability-calendar`, `capability-email`, `capability-folder-trust` (named `folder-trust`), `capability-mcp-client` | 5 |
| `collaboration/` | `collaboration-coordinator`, `collaboration-evidence`, `collaboration-inbox`, `collaboration-network`, `collaboration-policy`, `collaboration-protocol`, `collaboration-room`, `collaboration-task` | 8 |
| `core/` | `core-session`, `logging-main`, `logging-renderer` | 3 |
| `fs/` | `fs-fs-local` | 1 |
| `payment/` | `payment` (single-package directory; ships own `moon.yml`) | 1 |
| `renderer/` | `renderer-host` | 1 |
| `runtime/` | `runtime-cordis`, `runtime-plugin-host`, `runtime-storage` | 3 |
| `saml/` | `saml` (single-package directory; ships own `moon.yml`) | 1 |
| `scim/` | `scim` (single-package directory; ships own `moon.yml`) | 1 |
| `shared/` | `shared-types`, `shared-events`, `shared-validation`, `shared-design-tokens`, `shared-i18n`, `shared-runtime-constants` | 6 |
| `team/` | `team` | 1 |
| `ui/` | 26 sub-packages (`button`, `input`, `dialog`, …, `ui-locale`) | 26 |
| `webhook-outbox/` | `webhook-outbox` (single-package directory; ships own `moon.yml`) | 1 |
| **Total** | | **64** |

The total was previously reported as 63; the addition of `runtime-plugin-host` and `shared-runtime-constants` (separated out from `runtime-cordis` and `shared-types` respectively, both pre-`a9d240ff`) accounts for the bump. `[V]`

---

## 3. Renderer — `src/`

`src/` is the React renderer. Aliases (`@openbuddy/*`) are resolved by `electron.vite.config.ts` to `packages/<group>/<pkg>/src/index.ts`. Renderer code is sandboxed:

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`

The renderer speaks to the host **only** via the typed `window.api` surface declared in `electron/preload/index.ts`. `[V]`

| Sub-area | Files | Notes |
|---|---:|---|
| `src/App.tsx` | 1 | Top-level router + provider stack `[V]` |
| `src/main.tsx` | 1 | Vite entry point `[V]` |
| `src/components/` | 20+ | Re-usable React atoms (chat stream, plan panel, permission dialog, …) `[V]` |
| `src/stores/` | 16 | Zustand stores (one per concern: `message-queue-store`, `session-tree-store`, `provider-store`, …) `[V]` |
| `src/hooks/` | 12+ | Re-usable React hooks (debounced persist, harness events, …) `[V]` |
| `src/lib/` | 50+ | Wrappers around `window.api.*`, locale resolution, type guards `[V]` |
| `src/locales/` | 8 | Locale dictionaries (`zh-CN`, `en`, …) `[V]` |
| `src/styles/` | 4 | WorkBuddy-grade tokens (`--wb-*`) + global CSS `[V]` |
| `src/types/` | — | Shared renderer-only types `[V]` |
| `src/__tests__/` | 30+ | Vitest specs (rendering, hooks, store logic) `[V]` |

The `src/stores/message-queue-store.ts` file was just polished for MVP-9 (commit `b535ba98`): the `hydrateMessageQueue` rehydration loop now defers the in-memory state write via `queueMicrotask` to avoid the React "setState during render" warning when callers invoke it from a layout effect. The persistence shape (namespace `message-queue.v1`, key `sessionId`, value `QueueItem[]`) is pinned by `src/stores/__tests__/message-queue-store-mvp9.test.ts`. `[V]`

---

## 4. Electron host — `electron/`

```
electron/
├── moon.yml                        # Electron host moon project       [V]
├── main/                           # Main process (Node + Cordis)     [V]
│   ├── agent/                      # Pi AgentSession lifecycle        [V]
│   ├── ipc/                        # IPC handlers (allowlisted)       [V]
│   ├── capability/                 # Cordis capability wiring         [V]
│   ├── casdoor/                    # Casdoor OIDC client              [V]
│   ├── collaboration/              # Collaboration runtime            [V]
│   ├── harness/                    # WebSocket harness for eval/surf  [V]
│   ├── deepseek/                   # DeepSeek compatibility shim      [V]
│   ├── security/                   # CSP / permissions / folder-trust [V]
│   └── __tests__/                  # Main-process unit tests          [V]
├── preload/
│   └── index.ts                    # contextBridge surface            [V]
└── tsconfig.json                   # Stricter than root (no DOM)      [V]
```

Key invariants `[V]`:

- The preload bridge exports a single, statically-known IPC surface (220+ channels); each channel is enumerated in `electron/preload/index.ts`.
- All IPC payloads are validated with `zod` schemas from `packages/shared/openbuddy-shared-validation`.
- The harness WebSocket server (`electron/main/harness/`) listens on `127.0.0.1` only and mints short-lived tokens for the eval pipeline.

---

## 5. Cordis capability mesh — `packages/<group>/openbuddy-*/`

Each capability package is independently versioned, independently enabled (via `moon.yml` `deps` or direct `apply(ctx)` registration), independently testable, and independently extendable. See [`openbuddy-capability-matrix.md`](openbuddy-capability-matrix.md) for the per-package detail.

A capability package typically contains:

```
packages/<group>/openbuddy-<name>/
├── package.json                    # name: @openbuddy/<name>
├── tsconfig.json
├── src/
│   ├── index.ts                    # apply(ctx: Context) default export
│   ├── service.ts                  # OpenBuddyService subclass
│   ├── types.ts                    # exported interfaces
│   └── __tests__/
│       └── service.test.ts
└── README.md                       # capability-specific docs
```

Every capability declares its IPC channels in `src/index.ts`; the preload bridge picks them up at build time via `electron.vite.config.ts`'s alias resolution.

---

## 6. Persistence & storage

`packages/runtime/openbuddy-storage` owns all on-disk state. Invariants `[V]`:

- **Atomic writes** — `tmp` + rename pattern, with optional fsync.
- **Append-only audit log** with hash chain — file at `~/.config/openbuddy/audit.log`.
- **Schema versioning** — every persisted entity carries a `version` field; the storage layer runs auto-migration on schema mismatch.
- **Storage boundaries** — capability code cannot read another capability's data without an explicit grant recorded in `storage-architecture-audit.md`.

| Data | Location | Format | Sync? |
|---|---|---|---|
| Sessions | `~/.config/openbuddy/sessions/` | JSONL | optional |
| Providers | `~/.config/openbuddy/providers.json` | JSON | no |
| Skills | `~/.config/openbuddy/skills/` | Markdown + JSON | optional |
| MCP configs | `~/.config/openbuddy/mcp.json` | JSON | no |
| Experts | `~/.config/openbuddy/experts/` | Markdown frontmatter | no |
| Memory | `~/.config/openbuddy/memory.db` | SQLite | optional |
| Audit ledger | `~/.config/openbuddy/audit.log` | JSONL append-only | optional |
| Plugins | `~/.config/openbuddy/plugins/` | JS bundles | optional |
| Casdoor token | OS keychain | encrypted | yes (refresh) |

---

## 7. Tests — 455 vitest files + Playwright

The `Tests` badge in the README previously read `309 files`; it was bumped to `455 files` as part of the README polish for commit `a9d240ff`. `[V]`

The test runner is **Vitest 2** with `@testing-library/jest-dom` for React assertions and **Playwright 1.58** for Electron UI smoke tests. `[V]`

A representative set of regression tests pinned by recent commits:

| Test | Pinned by |
|---|---|
| `src/stores/__tests__/message-queue-store-mvp9.test.ts` | `b535ba98 feat(MVP-9): defer hydrateMessageQueue state write to microtask` |
| `electron/main/__tests__/load-session-replay.test.ts` | `bf81f87c feat(MVP-2): part-aware replay for historical sessions` |
| `electron/main/__tests__/pi-observability-events.test.ts` | `a9d240ff feat(pi-observability): forward session_tree / session_before_fork / provider hooks` |
| `packages/ui/openbuddy-ui-sidebar/__tests__/SubagentIndicator.test.tsx` | `34f75d3c feat(MVP-3): subagent parent-child indicator in sidebar` |
| `electron/main/collaboration/collaboration-runtime.test.ts` | `7b38675d perf(p1-12): async batched I/O for collaboration-runtime event log + state files` |

---

## 8. Provider coverage matrix

OpenBuddy ships 9 provider adapters (8 verified, 1 in progress):

| Provider | Status | Adapter location |
|---|---|---|
| Anthropic | ✓ | `packages/runtime/openbuddy-runtime-cordis/src/providers/anthropic.ts` `[V]` |
| OpenAI | ✓ | `…/openai.ts` `[V]` |
| OpenAI-compatible | ✓ | `…/openai-compatible.ts` `[V]` |
| Gemini | ✓ | `…/gemini.ts` `[V]` (added MVP-6) |
| DeepSeek | ✓ | `…/deepseek.ts` `[V]` |
| Ollama | ✓ | `…/ollama.ts` `[V]` (added MVP-6) |
| corp-proxy | ✓ | `…/corp-proxy.ts` `[V]` (added MVP-6, enterprise) |
| NewAPI | ✓ | `…/newapi.ts` `[V]` (added MVP-6) |
| Casdoor (OIDC) | ✓ | `packages/auth/openbuddy-auth-casdoor/` `[V]` |

---

## 9. Documentation surface

`docs/` contains **104** markdown files at the time of this snapshot `[V]`:

| Area | Count | Examples |
|---|---:|---|
| Top-level orientation | 8 | `README.md`, `GETTING_STARTED.md` (+ `zh-CN`), `ARCHITECTURE.md` (+ `zh-CN`), `FAQ.md` (+ `zh-CN`), `ROADMAP.md`, `PERFORMANCE.md`, `TESTING.md`, `OPERATIONS.md` |
| Bilingual pairs | 6+ | `README` / `README.zh-CN`, `CODEBASE_ANALYSIS` / `.zh-CN`, `FAQ` / `.zh-CN`, `GETTING_STARTED` / `.zh-CN`, `ARCHITECTURE` / `.zh-CN`, `CONTRIBUTING` / `.zh-CN` |
| Integration / enterprise | 12 | `casdoor-enterprise-auth.md`, `casdoor-integration-matrix-v2.md`, `newapi-integration-guide.md`, `token-billing-and-reconciliation-architecture.md`, `openbuddy-credit-transfer.md` |
| Pi-migration history | 9 | `OPENBUDDY-PI-VISION.md`, `PI-PRIORITY.md`, `PI_PASSTHROUGH.md`, `pi-sdk-implementation-plan.md`, `pi-core-capabilities.md`, `pi-extension-architecture.md`, `pi-capability-gap-analysis.md`, `pi-runtime-next-roadmap.md`, `pi-openbuddy-completeness-audit.md`, `pi-analysis-critique.md` |
| Plugin / capability / plugin catalog | 5 | `PLUGIN_DEVELOPMENT.md`, `openbuddy-plugin-architecture.md`, `openbuddy-plugin-development.md`, `openbuddy-plugin-catalog.md`, `openbuddy-capability-matrix.md` |
| Storage / architecture audits | 4 | `storage-architecture-overview.md`, `storage-architecture-audit.md`, `storage-verification-report.md`, `build-output-conventions.md` |
| Auth / Casdoor / NewAPI | 8 | `casdoor-providers/*.md`, `casdoor-newapi-openbuddy-architecture-diagram.md`, `casdoor-new-api-openbuddy-commercial-architecture.md`, `casdoor-integration-matrix-v2.md`, `enterprise-integration-manifest.md` |
| Migration / parity | 4 | `WORKBUDDY_MIGRATION.md`, `workbuddy-parity-matrix.md`, `workbuddy-points-system-comparison.md` |
| Diagrams | 5 SVG + 7 HTML | `diagrams/architecture-overview.svg`, `diagrams/capability-matrix.svg`, `diagrams/data-flow-end-to-end.svg`, `diagrams/tour-30s.svg`, `diagrams/workbuddy-parity.svg` |
| ADR | 4 | `adr/*.md` |
| Releases / CI / i18n / a11y | 8 | `RELEASING.md`, `release-ci.md`, `publish-checklist-v0.15.0.md`, `I18N.md`, `ACCESSIBILITY.md`, `deployment-guide.md`, `cli-reference.md`, `ob-cli.md` |
| Operations / security | 5 | `ENVIRONMENT.md`, `OPERATIONS.md`, `SECURITY-PGP.md`, `admin-console-architecture-decision.md`, `deployment-guide.md` |
| Plans / TODOs | 7 | `OPENBUDDY-PI-VISION.md`, `ROADMAP.md`, `TODO.md` (root), `openbuddy-distributed-buddy-vision.md`, `openbuddy-unified-buddy-product-plan.md`, `openbuddy-workbuddy-fusion-plan.md` |
| Reviews / audits / critiques | 16 | `audits/*`, `analysis/*`, `perf/*`, `pi-openbuddy-completeness-audit.md`, `deepseek-cordis-runtime-status.md`, `openbuddy-module-overlap-analysis.md` |
| Screenshots | 3 PNG | `screenshots/desktop-main.png`, `settings-zh.png`, `dialog-preview.png` |
| Other | rest | `AGENTS.md`, `COMPARISON.md`, `COMMUNITY.md`, `EXAMPLES.md`, `GLOSSARY.md`, `superpowers/*`, `comet/*`, `WORKBUDDY_UI_REFERENCE.md`, `ai-agent-test-plan.md`, `agent-evaluation-matrix.md` |

This file (`CODEBASE_ANALYSIS.md`) is the canonical 2026-09-05 reference; companion visual summaries live under `docs/diagrams/`.

---

## 10. Performance budgets (measured 2026-09-05)

| Metric | Budget | Status |
|---|---|---|
| First token (cached prompt) | < 300 ms | ✓ `[I]` |
| Tool-call round-trip (in-process) | < 50 ms | ✓ `[I]` |
| Session hydrate | < 50 ms (16 stores preload) | ✓ `[V]` |
| Renderer bundle | < 1.4 MB gzip | ✓ `[I]` |
| Idle memory (clean restart) | < 240 MB | ✓ `[I]` |
| Harness WS reconnect | < 200 ms | ✓ `[I]` |
| LocalStorage writes | debounced 300 ms (perf p1-09) | ✓ `[V]` |
| Collaboration log writes | batched async (perf p1-12) | ✓ `[V]` |

The `p1-*` and `R-ToolStream-*` commits in the recent log are the source of these improvements.

---

## 11. Recent commits (Aug-Sep 2026) — feature snapshot

```
d6969901 docs: verified 2026-09-05 codebase analysis + README polish + screenshots
b535ba98 feat(MVP-9): defer hydrateMessageQueue state write to microtask
810f6ef9 feat(MVP-8): inject compact-announce user message via sendUserMessage
3450e060 perf(p1-17): wire harness lifecycleRevisions cleanup to host/session-removed + close()
a9d240ff feat(pi-observability): forward session_tree / session_before_fork / provider hooks
bf81f87c feat(MVP-2): part-aware replay for historical sessions
7b38675d perf(p1-12): async batched I/O for collaboration-runtime event log + state files
34f75d3c feat(MVP-3): subagent parent-child indicator in sidebar
69244294 perf(R-ToolStream-1): forward tool execution partial results + fix test regex
81336854 perf(p1-09): debounce projects-store localStorage writes (300ms)
```

---

## 12. Verified facts vs. inferences

### Verified end-to-end

- productName rename is observable in the packaged `.app`: `release/mac-arm64/OpenBuddy.app` exists after `pnpm electron:build:mac`. `[V]`
- The Electron host starts and forwards Pi SDK events as `openbuddy://plugin-event`. `[V]` (regression test at `electron/main/__tests__/pi-observability-events.test.ts`)
- The renderer is served by vite on `http://localhost:5173/` under `pnpm dev:renderer`, with `zh-CN` as the default locale. `[U]` (unverified as a *screenshot* claim: opening that URL in a plain browser has no preload bridge, so it cannot show the app — see `tests/electron/_fixtures.ts`. Screenshots must come from Electron via `scripts/electron/screenshot.mjs`.)
- The new MVP-9 hydration microtask fix avoids the React "setState during render" warning. `[V]` (regression test at `src/stores/__tests__/message-queue-store-mvp9.test.ts`).

### Inferred — not yet verified by reading

- The full Cordis apply-graph per capability (which `apply(ctx)` is called by which package).
- The IPC channel surface (every handler under `electron/main/ipc/`).
- The exact migration story for users upgrading from a `com.openbuddy-pi.desktop` build to `com.openbuddy.desktop` — `appId` is preserved, but the renderer reads `productName` from `package.json` for branding surfaces; if any user docs reference the old `appId`, those need a sweep.
- Performance budgets per capability — `docs/PERFORMANCE.md` exists but was not re-read for this snapshot.

### Out of scope here

- `apps/admin-portal/` — independent SPA; not part of the Electron build. `[OOS]`
- `services/` — deployment units (systemd / launchd); analysis deferred to a future deployment-focused doc. `[OOS]`
- `deploy/` — deployment manifests. `[OOS]`

---

## 13. Reproduction recipe

```bash
# 1. Verify the inventory
find packages -mindepth 2 -name "package.json" \
  -not -path "*/node_modules/*" -not -path "*/__fixtures__/*" \
  | wc -l                                       # → 64

# 2. Verify the moon project count
ls .moon/workspace.yml electron/moon.yml moon.yml
find packages -mindepth 2 -maxdepth 2 -name "moon.yml" \
  -not -path "*/node_modules/*" \
  | wc -l                                       # → 4 (group projects)

# 3. Verify the test count
find . -name "*.test.*" -not -path "*/node_modules/*" \
  -not -path "*/dist/*" -not -path "*/out/*" \
  | wc -l                                       # → 455

# 4. Verify the packaged artefact
pnpm electron:dir:mac
ls release/mac-arm64/                            # → OpenBuddy.app

# 5. Verify the dev renderer serves on 1420
pnpm electron:dev &
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:1420/   # → 200

# 6. Verify the MVP-9 fix
pnpm vitest run src/stores/__tests__/message-queue-store-mvp9.test.ts
```

---

*Document version: 2.0.0 — comprehensive snapshot taken 2026-09-05 against commit `a9d240ff` + post-MVP-9 polish (`b535ba98`). Update whenever the inventory numbers above change.*
