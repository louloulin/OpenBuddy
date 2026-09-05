# OpenBuddy v0.1.0 — Full-stack foundation

First bottom-up cut of the OpenBuddy monorepo. 100 commits layer cleanly from
shared primitives up through the desktop and admin-portal applications.

## Bottom-up stack

| Layer | Packages |
|-------|----------|
| Shared | `shared/types`, `shared/logging-shared`, `shared/files-kb` |
| Runtime | `runtime/cordis`, `runtime/storage` (sqlite/files/secrets/observability), `runtime/plugin-host` |
| Filesystem | `fs/fs-local` |
| Auth | `auth/casdoor`, `auth/permission` (RBAC) |
| Webhook | `webhook-outbox` |
| Capability | `authorization`, `calendar`, `email`, `folder-trust`, `mcp-client` |
| Collaboration | `protocol`, `policy`, `room`, `task`, `evidence`, `network`, `inbox`, `coordinator` |
| Core | `logging-main`, `logging-renderer`, `session`, `payment`, `team`, `renderer-host` |
| Bundle | `bundle/base`, `bundle/desktop` |
| UI primitives | `primitives`, `theme`, `shared`, `runtime`, `modules`, `slots`, `layout`, `locale`, `markdown` |
| UI features | `shell`, `sidebar`, `home`, `conversation`, `account`, `files`, `experts`, `workbench`, `settings`, `settings-models`, `billing`, `email`, `collaboration`, `mcp`, `automation`, `hmr`, `dialogs` |
| Electron | `main` (storage/session/IPC/casdoor/deepseek/enterprise/agent/harness/security/collaboration/MCP), `preload` |
| Renderer (src/) | entry, styles, hooks, lib, stores, components, tests |
| Apps | `admin-portal`, CLI `bin/openbuddy`, service `casdoor-resource-gateway` |
| Eval | promptfoo, inspect_ai, deepeval, langfuse |
| Ops | `scripts/`, `deploy/`, `patches/` |
| Docs | README, ARCHITECTURE, CODEBASE_ANALYSIS, PERFORMANCE, PLUGIN_DEVELOPMENT, etc. |

## Verification

- `tests/electron` covers: chat-flow, workbench core + extended, MCP e2e,
  plugin hot-reload e2e, marketplace install + lifecycle, perf CDP baselines,
  bridge poisoning regression, optimistic rollback, session history load,
  sidebar multi-select, sync-core e2e, agent-died recovery, agent-minimax real
  roundtrip.
- UI primitives + renderer covered by `src/__tests__` and `packages/core/openbuddy-session/__tests__`.
- Storage + types covered by `packages/runtime/openbuddy-storage/__tests__` and
  `packages/shared/openbuddy-types/__tests__`.
