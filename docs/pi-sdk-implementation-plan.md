# OpenBuddy Pi — Pi SDK implementation plan

> Status: **complete plan, ready for execution**. Companion to `docs/migration-pi-electron.md` and `docs/pi-capability-gap-analysis.md`.
> Tracking issue: LUM-37.
> Approach: **embed `pi-coding-agent` via SDK in the Electron main process** (in-process). No `pi --rpc` subprocess; no NDJSON framing; no `extension_ui_request` JSON frames. Direct TypeScript method calls + event subscription.

## Why SDK embed (vs `--mode rpc`)

| Concern | SDK embed | `pi --rpc` subprocess |
|---|---|---|
| Latency | Direct function calls | JSON round-trip per call |
| Type safety | Full TS types from `@mariozechner/pi-coding-agent` | Manual schema mirroring |
| Crash isolation | Agent crashes take down Electron main | Agent runs in own OS process |
| Bundle size | Adds ~3–5 MB npm deps | Adds ~3–5 MB + spawns subprocess |
| Debuggability | Node DevTools, source maps | Two-process trace stitching |
| Hot reload | Reload Vite + restart Electron | Same |
| Compatibility with `--mode rpc-ui` extensions | N/A (host controls UI directly) | Requires `extension_ui_request` handling |
| v0.14.0's `grok://agent-died` semantics | Detected via `session.subscribe` `agent_end` with error + try/catch | Detected via subprocess `exit` event |

We pick **SDK embed**. Crash isolation is sacrificed; mitigation = `agent_end` with error event surfaces to UI as `grok://agent-died` (same UX as today). If reliability proves insufficient in Phase 2 testing, we revisit by switching `electron/main/agent-host.ts` to spawn `pi-coding-agent`'s CLI mode and re-implement the IPC layer.

## Key APIs (verified from `earendil-works/pi` v0.84.1)

```ts
import {
  createAgentSession,
  SessionManager,
  AuthStorage,
  ModelRegistry,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolDefinition,
  type AgentSession,
  type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const { session } = await createAgentSession({
  cwd: "/abs/path",
  sessionManager: SessionManager.inMemory(), // or .create({ cwd }) for on-disk
  authStorage: new AuthStorage(),
  modelRegistry: new ModelRegistry(authStorage),
});

// session methods
await session.prompt("user text");                       // main entry
session.subscribe((event) => { /* see event union */ }); // returns unsubscribe()
await session.abort();                                   // cancel running turn
await session.setModel(model);                           // switch model
await session.steer("mid-turn message");                 // queue steer
await session.followUp("next-turn message");             // queue follow-up
await session.fork();                                    // create new session from current branch
await session.compact();                                 // manual context compaction
await session.tree();                                    // navigate entry tree

// Extension API (for OpenBuddy-specific tools / events)
const ext = {
  init(ctx: ExtensionContext) {
    ctx.api.registerTool(toolDef);
    ctx.api.registerCommand({ name, description, handler });
    ctx.api.on("event_name", handler);
  },
} satisfies { init: (ctx: ExtensionContext) => void };

const tool: ToolDefinition = {
  name: "my_tool",
  label: "My Tool",
  description: "...",
  parameters: Type.Object({ ... }), // @sinclair/typebox JSON schema
  execute: async (toolCallId, args, signal) => {
    return {
      content: [{ type: "text", text: "result text" }],
      details: { /* arbitrary JSON for the renderer */ },
    };
  },
};
```

Event types emitted by `subscribe`:
- `agent_start` / `agent_end` (with all new messages; errors surfaced here)
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end` (assistant delta via `assistantMessageEvent.text_delta`)
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end`

Sources: `earendil-works/pi` v0.84.1 `packages/coding-agent/docs/sdk.md`, `packages/coding-agent/src/core/agent-session.ts`, `packages/agent/src/agent-loop.ts`.

## Architecture

```
┌──────────────────────────── Electron main process ────────────────────────────┐
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ agent-host.ts (Phase 2)                                                │  │
│  │                                                                        │  │
│  │  createAgentSession({ cwd, sessionManager: .create({cwd}) })           │  │
│  │         │                                                              │  │
│  │         ├─► session.subscribe(emitToRenderer)                          │  │
│  │         │                                                              │  │
│  │         ├─► extensions loaded:                                         │  │
│  │         │     • openbuddy/team-tools       (create_team, ...)          │  │
│  │         │     • openbuddy/memory           (cross-session memory)      │  │
│  │         │     • openbuddy/tasks            (background tasks)          │  │
│  │         │     • openbuddy/plan-mode        (plan toggle)               │  │
│  │         │     • openbuddy/folder-trust     (folder trust dialog)       │  │
│  │         │     • openbuddy/inspiration      (inspiration generate)      │  │
│  │         │     • openbuddy/notifications    (OS notification log)       │  │
│  │         │     • openbuddy/automations      (local scheduler trigger)   │  │
│  │         │     • openbuddy/subagents        (subagent depth config)     │  │
│  │         │     • openbuddy/websearch-toggle (web search toggle)         │  │
│  │         │                                                              │  │
│  │         └─► ipcMain.handle("agent:*", ...)  (renderer-facing API)      │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│         │                                                                     │
│         ├─► sessions.ts          (filesystem: list, pin, archive, expert)    │
│         ├─► providers.ts         (read/write ~/.pi/agent/models.json)        │
│         ├─► permissions.ts       (read/write ~/.pi/agent/settings.json)      │
│         ├─► skills.ts            (read SKILL.md files from ~/.pi/agent/skills)│
│         ├─► mcp.ts               (read/write ~/.pi/agent/mcp.json)          │
│         ├─► agents.ts            (read/write ~/.pi/agent/agents/*.md)        │
│         ├─► experts.ts           (browse + convert to agents/*.md)           │
│         ├─► connectors.ts        (browse + convert to mcp.json)              │
│         ├─► notifications.ts     (Electron Notification API + log file)     │
│         ├─► automations.ts       (Node-cron scheduler + JSON store)          │
│         ├─► shell-fs.ts          (Node fs/promises + shell.openExternal)     │
│         └─► shell.ts             (open_url, open_path, reveal_in_folder)     │
│                                                                              │
│  ┌── main/index.ts (Phase 1) ──────────────────────────────────────────────┐  │
│  │   app.whenReady → BrowserWindow (frameless, transparent)               │  │
│  │   loadFile dist/index.html (prod) / VITE_DEV_URL (dev)                │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
              ▲                                       ▲
              │ ipcRenderer.invoke / on                │ contextBridge
              │                                       │
┌──────────────────── Electron renderer (React) ────────────────────────────────┐
│  preload/index.ts → contextBridge exposes window.api                         │
│  src/lib/agent/pi-client.ts (renamed from grok-client.ts) wraps window.api.*       │
│  src/components/* unchanged                                                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Phases (refined from migration-pi-electron.md)

### Phase 0 — Foundation (DONE in PR #1)
- This PR scaffolded: `electron/`, `electron-builder.yml`, `docs/migration-pi-electron.md`, `docs/pi-capability-gap-analysis.md`, `package.json` deps.

### Phase 1 — Electron shell alongside Tauri (LUM-38)

**Goal**: Electron launches the existing React UI in a frameless window. Tauri still works.

**Files added** (new):
- `electron/main/index.ts` (already scaffolded, needs filling) — `BrowserWindow` with `titleBarStyle: "hidden"`, `titleBarOverlay` for macOS, drag region CSS.
- `electron/preload/index.ts` (already scaffolded, needs filling) — `contextBridge` exposing `window.api.platform`, `window.api.versions`, `window.api.shell.openExternal`.
- `electron/main/window.ts` — custom titlebar drag region helper.
- `electron/styles/drag-region.css` — `-webkit-app-region: drag` styles, injected via preload.

**Files changed**:
- `package.json` — add `electron-devtools-installer` (optional, dev-only) for the same DevTools UX as Tauri.

**Exit criteria**:
- `pnpm dev:electron` opens the existing UI in an Electron window.
- Custom titlebar drag region matches Tauri behavior (verified manually on macOS + Windows).
- Tauri `pnpm tauri dev` still works unchanged.
- CI matrix builds both shells.

### Phase 2 — Pi SDK embed + team extension (LUM-39)

**Goal**: First real agent integration. Spawn a single Pi `AgentSession`, wire streaming to renderer via IPC, port `team_mcp.rs` to a Pi extension. Confirm the architecture works end-to-end before fanning out the other 9 extensions.

**Files added**:
- `electron/main/agent-host.ts` — owns the `createAgentSession` lifecycle. Methods: `init`, `newSession`, `loadSession`, `listSessions`, `prompt`, `abort`, `setModel`, `shutdown`, `subscribe`.
- `electron/main/ipc/index.ts` — `ipcMain.handle("agent:*", ...)` for all session operations + `webContents.send("agent:event", ...)` for streaming.
- `electron/main/sessions.ts` — file ops on `~/.pi/agent/sessions/<encoded-cwd>/*.jsonl` (list, pin, archive, expert bindings to `~/.pi/openbuddy-state.json`).
- `extensions/openbuddy/team-tools/index.ts` — `create_team` / `team_status` / `team_delete` tools. Storage: `~/.pi/openbuddy-teams.json`.
- `extensions/openbuddy/team-tools/migrate.ts` — one-time migration script reading `~/.grok/openbuddy-teams.json` if present.

**Files changed**:
- `electron/preload/index.ts` — extend `window.api` with `agent.*`, `teams.*`.
- `src/lib/grok-client.ts` → renamed to `src/lib/agent/pi-client.ts`. Switch from `invoke<…>("grok_*")` to `invoke<…>("agent:*")`. Renderer callers of `grokNewSession`, `grokSend`, `grokCancel`, etc. swap to `piNewSession`, `piSend`, `piCancel`. The streaming events (`grok://update` → `pi://update`, etc.) rename at the preload boundary; React component code stays unchanged.
- `src/lib/types.ts` — adapter types to Pi's `AgentMessage` / `AgentSessionEvent` shapes (mostly additive).

**Exit criteria**:
- Electron + Pi boots, shows "ready" badge.
- New session → send message → response streams into the chat.
- `create_team` tool works (callable by the agent, persists to `~/.pi/openbuddy-teams.json`).
- All 14 `grok://*` events still fire from the React side (just renamed to `pi://*`).
- 2-day soak test: no crashes, no event-leaks (every `subscribe` paired with `unsubscribe`).

**Risk**:
- SDK API may shift between pi-* versions — pin in `package.json` (`"@mariozechner/pi-coding-agent": "~0.84.1"`).
- Type definitions may be incomplete — fallback to `(event as any).type === "…"` narrowing where needed.

### Phase 3 — Capability port (LUM-40 through LUM-48, one per extension)

**Goal**: Replace the rest of the grok-only commands with Pi-native or extension-backed implementations.

**Files added (per extension)**:
- `extensions/openbuddy/memory/index.ts` — memory_list/get/save/delete/rewrite/flush
- `extensions/openbuddy/tasks/index.ts` — tasks_list/task_kill + `grok://task-update` event
- `extensions/openbuddy/plan-mode/index.ts` — toggle_plan_mode + `grok://plan-mode` event
- `extensions/openbuddy/folder-trust/index.ts` — folder_trust_respond + `grok://folder-trust` event
- `extensions/openbuddy/inspiration/index.ts` — inspiration_generate (uses `session.sendMessage` on a side-session)
- `extensions/openbuddy/notifications/index.ts` — notification_append/list/mark_read/mark_all_read/clear
- `extensions/openbuddy/automations/index.ts` — local scheduler trigger via `session.prompt(...)`
- `extensions/openbuddy/subagents/index.ts` — subagent depth config + spawn helpers
- `extensions/openbuddy/websearch-toggle/index.ts` — session-level web search toggle

**Files added (electron main)**:
- `electron/main/providers.ts` — read/write `~/.pi/agent/models.json`
- `electron/main/permissions.ts` — read/write `~/.pi/agent/settings.json` permissions block
- `electron/main/skills.ts` — read SKILL.md files from `~/.pi/agent/skills`
- `electron/main/mcp.ts` — read/write `~/.pi/agent/mcp.json`
- `electron/main/agents.ts` — read/write `~/.pi/agent/agents/*.md`
- `electron/main/experts.ts` — directory browse + convert to agents/*.md
- `electron/main/connectors.ts` — directory browse + convert to mcp.json
- `electron/main/connectors-cli.ts` — CLI-driven external auth (stays Node, not Pi)
- `electron/main/shell-fs.ts` — Node `fs/promises` + `electron.shell`
- `electron/main/notifications.ts` — Electron `Notification` API + log
- `electron/main/automations.ts` — Node scheduler (use `node-cron` or `cron` npm package)
- `electron/main/context-usage.ts` — derive `SessionInfoResponse` / `SessionUsage` from `SessionManager` tree
- `electron/main/inspiration.ts` — spawn side-session for inspiration (or delegate to extension)
- `electron/main/tasks.ts` — background task queue
- `electron/main/plan-mode.ts` — plan mode toggle (or delegate to extension)
- `electron/main/account.ts` — read/write API keys in `settings.json`
- `electron/main/sessions-meta.ts` — pin/archive/expert bindings to `~/.pi/openbuddy-state.json`
- `electron/main/automations-store.ts` — `~/.pi/openbuddy-automations.json` CRUD

**Files removed**:
- `src-tauri/` (~14K LOC) — deleted after Phase 4 (along with `patches/`, `Cargo.*`, `rust-toolchain.toml`)
- `vendor/grok-build/` submodule

**Migration scripts**:
- `scripts/migrate-grok-config.mjs` — read `~/.grok/openbuddy-*.json`, write `~/.pi/openbuddy-*.json`
- `scripts/migrate-models.mjs` — read `~/.grok/config.toml [model.*]`, write `~/.pi/agent/models.json`
- `scripts/migrate-skills.mjs` — read grok skill format, write SKILL.md
- `scripts/migrate-agents.mjs` — read `~/.grok/agents/*.md`, write `~/.pi/agent/agents/*.md`

**Exit criteria per LUM-40+PR**:
- Each PR migrates one domain end-to-end (host + extension if needed + renderer's event handlers).
- Old `grok_*` Tauri command paths fully removed.
- Vitest coverage on the migrated domain.

### Phase 4 — Cleanup & rename (LUM-49)

**Goal**: Delete Tauri entirely, ship as `OpenBuddy Pi` v1.0.0.

**Files removed**:
- `src-tauri/` (entire directory)
- `patches/` (entire directory)
- `rust-toolchain.toml`
- `Cargo.*` (none in root, but `src-tauri/Cargo.*`)
- `scripts/build.ps1`, `scripts/build.sh` (replaced by `electron-builder`)
- `scripts/setup.ps1`, `scripts/setup.sh` (replaced by `pnpm install`)
- `tauri.conf.json` reference (if any)

**Files changed**:
- `package.json` — `productName: "OpenBuddy Pi"`, `name: "openbuddy-pi"`, version `1.0.0`
- `electron-builder.yml` — already targets OpenBuddy Pi; finalize `appId: com.openbuddy-pi.desktop`
- `README.md` / `README.zh-CN.md` — rebrand, link to new docs
- `CHANGELOG.md` — add `v1.0.0 (2026-MM-DD)` entry: "Pi core + Electron shell"
- `index.html` — `<title>OpenBuddy Pi</title>`
- `.github/workflows/release.yml` — replace Tauri build steps with `pnpm electron:build:win` / `:mac`

**Exit criteria**:
- `pnpm electron:build` produces signed NSIS installer + DMG.
- `pnpm tauri dev` no longer in package.json scripts.
- CI matrix only runs Electron builds.
- First v1.0.0 release cut.

## Milestone matrix

| LUM | Phase | Scope | PR | LOC (net) |
|---|---|---|---|---|
| 37 | 0 | Scaffold + docs | #1 (open) | +530 (docs only) |
| 38 | 1 | Electron shell | next | ~+500 / -0 |
| 39 | 2 | Pi SDK embed + team extension | tbd | ~+1200 / -0 |
| 40 | 3a | memory extension | tbd | ~+200 / -50 |
| 41 | 3b | tasks extension | tbd | ~+200 / -50 |
| 42 | 3c | plan-mode extension | tbd | ~+150 / -30 |
| 43 | 3d | folder-trust extension | tbd | ~+100 / -30 |
| 44 | 3e | inspiration extension | tbd | ~+150 / -50 |
| 45 | 3f | notifications host | tbd | ~+200 / -80 |
| 46 | 3g | automations host + extension | tbd | ~+500 / -200 |
| 47 | 3h | subagents + websearch extensions | tbd | ~+200 / -50 |
| 48 | 3i | providers / permissions / mcp / agents / experts / connectors / shell-fs hosts | tbd | ~+1500 / -200 |
| 49 | 4 | Cleanup + v1.0.0 release | tbd | -14000 / +300 |

**Net**: -14000 Rust LOC, +5200 TS LOC. ~24K to ~5K lines, mostly TypeScript.

## Test strategy

| Layer | Tool | Coverage |
|---|---|---|
| Renderer (existing) | `vitest` | 813 tests preserved (rename `grok-client` → `pi-client` in test imports) |
| Electron main | `vitest` + `@vitest/electron` | New tests per module (sessions.ts, providers.ts, permissions.ts, etc.) |
| Pi extensions | `vitest` with `createAgentSession({ sessionManager: SessionManager.inMemory() })` | Unit tests for each extension's tool + command handlers |
| Smoke E2E | `playwright` driving the actual Electron build | 1 happy path: launch → new session → send → receive → close |
| Migration | `node --test` scripts in `scripts/migrate-*.mjs` | Run against fixtures of old `~/.grok/` data |

## Open decisions (carried from migration doc)

1. Pi source: upstream npm dep `~0.84.1` (Phase 0). Document upgrade path in `docs/pi-versioning.md` (TBD).
2. Bundle size: accept Electron regression.
3. Brand: rename to **OpenBuddy Pi** at Phase 4.
4. Session compatibility: do not migrate old grok sessions — README notes no session migration.
5. BYOK path: migrate `~/.grok/openbuddy-teams.json` → `~/.pi/openbuddy-teams.json` via `scripts/migrate-grok-config.mjs` (Phase 2).
6. SDK vs RPC: **decided** — SDK embed.

## References

- [Pi SDK docs (earendil-works/pi v0.84.1)](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/docs/sdk.md)
- [ExtensionAPI reference](https://mintlify.wiki/badlogic/pi-mono/api/coding-agent/extension-api)
- [Pi session format](http://pi.dev/docs/latest/session-format)
- [Pi RPC mode docs](http://pi.dev/docs/latest/rpc) (still relevant if Phase 2 testing forces a fallback to subprocess mode)
- [Agent Loop & State Machine (DeepWiki)](https://deepwiki.com/badlogic/pi-mono/3.1-agent-state-management)
- [pi-coding-agent npm](https://www.npmjs.com/package/@mariozechner/pi-coding-agent)
- [从底层看懂 Pi-Mono: Agent 与 AI 核心机制揭秘](https://juejin.cn/post/7644856152429641779)
- Companion: [`docs/migration-pi-electron.md`](./migration-pi-electron.md)
- Companion: [`docs/pi-capability-gap-analysis.md`](./pi-capability-gap-analysis.md)
