# Architecture

**English** · [简体中文](ARCHITECTURE.zh-CN.md)

### Bird's-eye view

```
┌──────────────────────────────────────────────────────────────┐
│  React Renderer (src/, packages/ui/*)                        │
│    Vite + React 18 + Zustand stores                          │
│    Foundation: --wb-* tokens, 207-icon set, brand atoms      │
└──────────────────────┬───────────────────────────────────────┘
                       │  window.api  (typed contextBridge)
┌──────────────────────┴───────────────────────────────────────┐
│  Electron Main + preload bridge                              │
│    ipc.ts                ← allowlisted IPC handlers          │
│    agent-host.ts         ← Pi AgentSession lifecycle         │
│    pi-event-bridge.ts    ← cleanup-aware pi://* events       │
│    pi-resources.ts       ← local persistence (Cordis fs)     │
│    capability-*.ts       ← Cordis capability services        │
└──────────────────────┬───────────────────────────────────────┘
                       │  typed Pi session events
┌──────────────────────┴───────────────────────────────────────┐
│  Pi AgentSession + Cordis capability services                │
│    providers, tools, permissions, plans, tasks, persistence  │
└──────────────────────────────────────────────────────────────┘
```

### Layer 1 — React Renderer

**Location:** `src/` and `packages/ui/openbuddy-ui-*`

**Responsibilities:**

- Render the WorkBuddy-style UI (Topbar, Sidebar, HomePage, ChatView, Composer, …).
- Maintain UI state via [Zustand](https://github.com/pmndrs/zustand) stores in `src/stores/`.
- Provide the typed bridge wrapper in `src/lib/electron-api.ts` that hides `window.api.invoke(...)` calls behind strongly-typed functions.
- Subscribe to streaming `pi://*` events from the main process.

**Constraints:**

- **No Node integration** — `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` (see `electron/main/window.ts`).
- **No provider SDK** — all provider calls go through the Pi runtime in main.
- **No direct filesystem access** — must invoke IPC handlers like `shellfs:read-text`.
- **No CSS-in-JS** — use `--wb-*` design tokens from `src/styles/tokens.css`.

**Folder structure:**

```
src/
├── App.tsx                     # Root component
├── main.tsx                    # Vite entry
├── styles/
│   ├── tokens.css              # --wb-* design tokens
│   ├── global.css              # Reset + base
│   └── app.css                 # App layout
├── foundation/
│   └── components/Icon/        # 207-icon set
├── lib/
│   ├── pi-client.ts            # Streaming event client
│   ├── electron-api.ts         # Typed window.api wrapper
│   └── newapi-provider.ts      # NewAPI BYOK adapter
├── stores/
│   ├── session.ts              # Active session
│   ├── sessions.ts             # Session list
│   ├── permission.ts           # Permission prompts
│   └── …
├── components/
│   ├── Topbar.tsx
│   ├── Sidebar.tsx
│   ├── HomePage.tsx
│   ├── ChatView.tsx
│   └── Composer.tsx
└── locales/                    # i18n messages
```

### Layer 2 — Electron Main + Preload

**Location:** `electron/main/`, `electron/preload/`

**Responsibilities:**

- Own the `BrowserWindow` lifecycle (`window.ts`).
- Host the Cordis context and load capability services (`capability-*.ts`).
- Run the Pi `AgentSession` (`agent-host.ts`) and forward streaming events to the renderer (`pi-event-bridge.ts`).
- Persist session/provider/capability state to local files (`pi-resources.ts`).
- Expose an **allowlisted** IPC surface via `contextBridge` (`preload/index.ts`).

**IPC contract:**

Every IPC channel is explicitly enumerated in `electron/preload/index.ts`. The renderer can ONLY call channels in this allowlist; everything else throws an error in main.

```typescript
// electron/preload/index.ts
const allowedInvokeChannels = new Set([
  "agent:abort", "agent:init", "agent:prompt", …
  "casdoor:authorize", "casdoor:login", …
  "collaboration:snapshot", "collaboration:task-control", …
  "session_fork", "session_search", …
  "memory:get", "memory:save", …
  "skills:list", "skills:add", …
  "tasks:list", "tasks:add", …
  "calendar:list", "calendar:create", …
  "email:drafts", "email:send", …
  "shellfs:read-text", "shellfs:write-text", …
  "dialog:open", "dialog:save", …
]);
```

When you add a new IPC channel:

1. Add it to `allowedInvokeChannels`.
2. Implement the handler in `electron/main/ipc/index.ts`.
3. Add a typed wrapper in `src/lib/electron-api.ts`.
4. Run `pnpm test:electron:ipc-surface` to update the auto-generated surface matrix.

**Folder structure:**

```
electron/
├── main/
│   ├── index.ts                # App lifecycle entry
│   ├── window.ts               # BrowserWindow factory
│   ├── ipc.ts                  # IPC handlers (single file aggregating all)
│   ├── agent-host.ts           # Pi AgentSession lifecycle
│   ├── pi-event-bridge.ts      # pi://* event emitter
│   ├── pi-resources.ts         # Cordis fs persistence
│   ├── capability-*.ts         # One file per Cordis capability
│   ├── security/               # sandbox, CSP helpers
│   ├── collaboration/               # A2A message handlers
│   ├── session/                # session storage
│   └── __tests__/              # Vitest specs for main
├── preload/
│   └── index.ts                # contextBridge surface (allowlist)
├── collaboration-process.vite.config.ts
└── moon.yml                    # Electron host moon project
```

### Layer 3 — Pi Agent + Cordis Mesh

**Location:** `packages/runtime/openbuddy-{cordis,plugin-host,storage}` and 63 workspace packages (12 capability, 26 UI, 8 collaboration, …) under `packages/<group>/openbuddy-*/`

**Responsibilities:**

- Own the prompt → tool-call → response loop.
- Resolve provider/model configurations from the local data directory.
- Dispatch tool calls through Cordis services.
- Enforce permissions, plan mode, task spawning, memory writes.

**Cordis in 60 seconds:**

Cordis is a dependency-injection framework for TypeScript. A "capability" is a service that gets injected into a shared `ctx` (context). Services can depend on other services. Disposal is automatic.

```typescript
// A typical capability
import { Context, OpenBuddyService } from "@openbuddy/cordis";

export interface Config {
  defaultTimeoutMs: number;
}

export class MemoryService extends OpenBuddyService {
  static config: Config = {
    defaultTimeoutMs: 30_000,
  };

  constructor(ctx: Context, options?: Partial<Config>) {
    super(ctx, "openbuddy.capability.memory", options);
    this.cache = new Map();
  }

  async recall(query: string): Promise<string[]> {
    return this.cache.get(query) ?? [];
  }

  async remember(key: string, value: string) {
    this.cache.set(key, [value]);
    this.ctx.emit("memory:written", { key, value });
  }
}

export default function apply(ctx: Context) {
  ctx.plugin(MemoryService, ctx.config);
}
```

The renderer reaches the service via IPC; IPC handlers in `electron/main/` look up the service on the Cordis context.

**Folder structure:**

```
packages/
├── runtime/
│   ├── openbuddy-cordis/       # Cordis helpers, shared context
│   ├── openbuddy-plugin-host/  # plugin discovery + hot reload
│   └── openbuddy-storage/      # local fs persistence with audit
├── renderer/
│   └── openbuddy-renderer-host/# preload bridge glue
├── bundle/
│   └── openbuddy-base/         # umbrella for renderer-only deps
├── auth/
│   ├── openbuddy-casdoor/      # OIDC client + admin REST
│   └── openbuddy-permission/   # permission prompts & policy
├── core/
│   └── openbuddy-session/      # session lifecycle
├── team/
│   ├── openbuddy-team/         # multi-agent team
│   └── openbuddy-subagent/     # sub-agent spawning
├── capability/
│   ├── openbuddy-memory/       # long-term memory
│   ├── openbuddy-notification/ # inbox + native notifications
│   ├── openbuddy-plan/         # plan mode
│   ├── openbuddy-task/         # sub-agent tasks
│   ├── openbuddy-automation/   # local scheduler
│   ├── openbuddy-web-search/   # provider-pluggable web search
│   ├── openbuddy-inspiration/  # prompt templates
│   ├── openbuddy-folder-trust/ # per-folder permissions
│   ├── openbuddy-authorization/# capability-level policy
│   ├── openbuddy-mcp-client/   # MCP connector governance
│   ├── openbuddy-calendar/     # calendar
│   └── openbuddy-email/        # email
├── fs/
│   └── openbuddy-fs-local/     # local fs via Cordis
├── shared/
│   ├── openbuddy-files-kb/     # knowledge-base file indexing
│   └── openbuddy-types/        # cross-package types
├── collaboration/
│   ├── openbuddy-coordinator/  # coordination layer
│   ├── openbuddy-evidence/     # audit evidence
│   ├── openbuddy-inbox/        # cross-agent inbox
│   ├── openbuddy-network/      # network topology
│   ├── openbuddy-policy/       # cross-agent policy
│   ├── openbuddy-protocol/     # A2A message envelopes
│   ├── openbuddy-room/         # shared rooms
│   └── openbuddy-task/         # cross-agent task graph
├── payment/                    # Stripe / WeChat Pay / Alipay / HMAC
├── saml/                       # SAML 2.0 primitives
├── scim/                       # SCIM v2 endpoints
├── webhook-outbox/             # transactional outbox
└── ui/                         # 26 UI packages
```

### Data flow — a typical prompt

Here's what happens when a user types "summarize this file" in OpenBuddy:

```
1. User types in Composer.tsx
2. Composer calls window.api.invoke("agent:prompt", { text, context })
3. preload/index.ts forwards to ipc.ts handler "agent:prompt"
4. agent-host.ts invokes the Pi AgentSession.prompt() method
5. Pi decides: "call tool `read_file(path=…)/..."
6. AgentSession calls Cordis context.plugin(FileService).read(path)
7. FileService uses @openbuddy/fs-fs-local to read from disk
8. Permission check: is path inside a folder the user has granted trust for?
   ├─ Yes → proceed
   └─ No → emit permission:request event → renderer shows modal
9. Pi calls LLM (Anthropic / OpenAI / NewAPI) with the result
10. LLM streams back the summary
11. AgentSession emits pi://message-delta events
12. pi-event-bridge forwards to renderer via webContents.send
13. ChatView.tsx appends the delta to the visible message
14. AgentSession emits pi://done when finished
15. Composer stores the result in @openbuddy/capability-memory
```

### Persistence model

OpenBuddy persists **everything locally first**, with optional enterprise sync to Casdoor:

| Data | Location | Format | Synced? |
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

All persistence goes through `@openbuddy/storage`, which enforces:

- Atomic writes (`tmp` + rename)
- Append-only audit log with hash chain
- Schema versioning + auto-migration
- Storage boundaries (capability code can't read each other's data without explicit grant)

### Build & deploy

- **Renderer** bundled by Vite (`moon run openbuddy:build.bundle`).
- **Main + preload** bundled by electron-vite (`moon run openbuddy:build.bundle`).
- **Production installer** produced by electron-builder (`moon run openbuddy:electron.build.{win,mac,linux}`).
- **CI** runs the same `moon run` commands locally (`pnpm electron:dev`, `pnpm workspace:typecheck`, etc.).
- **Auto-updates** delivered by `electron-updater` against GitHub Releases.

### Test layout

| Type | Where | Command |
|---|---|---|
| Renderer unit | `src/**/__tests__/*.test.ts(x)` | `pnpm workspace:test` |
| Renderer component | `src/**/__tests__/*.test.tsx` | `pnpm workspace:test` |
| Main unit | `electron/main/__tests__/*.test.ts` | `pnpm workspace:test` |
| Package unit | `packages/**/__tests__/*.test.ts` | `pnpm workspace:test` |
| Electron smoke | `scripts/electron/*-smoke.mjs` | `pnpm test:electron` |
| Surface regression | `scripts/electron/surface-regression.mjs` | `pnpm test:electron:surface` |
| IPC surface | `scripts/electron/ipc-surface-smoke.mjs` | `pnpm test:electron:ipc-surface` |
| Real-UI smoke | `scripts/electron/real-ui-smoke.mjs` | `pnpm test:electron:real-ui` |
| Closed-loop eval | `scripts/electron/closed-loop-*.mjs` | `pnpm test:closed-loop` |
| Storage boundaries | `scripts/storage/check-architecture-boundaries.mjs` | `pnpm storage:boundaries` |
| External evals | `evals/node/run_*.mjs` | `pnpm eval:*` |
