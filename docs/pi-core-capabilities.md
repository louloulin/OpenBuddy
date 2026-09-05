# Pi core capabilities — what OpenBuddy Pi inherits for free

> Status: **canonical inventory**. Companion to `docs/migration-pi-electron.md`, `docs/pi-capability-gap-analysis.md`, `docs/pi-sdk-implementation-plan.md`.
> Tracking issue: LUM-37.
> Target Pi version: **`@mariozechner/pi-coding-agent` v0.84.x** (npm package; was renamed to `@earendil-works/pi-coding-agent` later in the 0.8x series, but v0.84.x is still on the `@mariozechner/*` namespace per npm).
> Approach: in-process SDK in Electron main — no subprocess; no NDJSON; no protocol re-implementation.

This doc enumerates **what we get for free** when we embed Pi in-process. The goal: keep the migration surface narrow. Anything Pi already provides natively becomes an Electron-side thin host module (read/write JSON files on disk) plus a preload `window.api.*` wrapper. Anything Pi **doesn't** provide becomes a Pi extension (≈50 LOC each).

## 1. Agent session lifecycle

### `createAgentSession(opts)` — the only constructor

```ts
import {
  createAgentSession,
  SessionManager,
  AuthStorage,
  ModelRegistry,
} from "@mariozechner/pi-coding-agent";

const { session } = await createAgentSession({
  cwd,                                          // required: working dir
  sessionManager: SessionManager.create({ cwd }) // or .inMemory()
              || SessionManager.inMemory(),
  authStorage:   new AuthStorage(),             // or AuthStorage.create()
  modelRegistry: new ModelRegistry(authStorage), // or .create(authStorage)
  extensions:    [myExtension, ...],            // optional
  initialModel:  "anthropic/claude-sonnet-4-5", // optional override
  initialMessages: [...],                        // optional seeding
});
```

Returns `{ session, modelRegistry, authStorage, ... }`. We hold `session` directly in Electron main; it is a single `AgentSession` instance bound to that `SessionManager`.

### `AgentSession` — full method list (verified v0.84.x)

| Method | Purpose |
|---|---|
| `prompt(text \| Message)` | Send a user turn; returns when turn completes. Calls `subscribe` listeners along the way. |
| `steer(text)` | Queue a message into the *current* running turn (delivered at the next safe point; aborts the current tool). |
| `followUp(text)` | Queue a message into the *next* turn (delivered after the current turn ends). |
| `abort()` | Cancel the running turn / tool. Triggers `agent_end` with `reason: "aborted"`. |
| `setModel(model)` | Switch provider/model mid-session. Persists `model_change` entry to the session tree. |
| `setThinkingLevel(level)` | `"off" \| "low" \| "medium" \| "high"`. Persists `thinking_level_change` entry. |
| `fork()` / `clone()` | `fork()` — new session file from a previous user message (`/fork` cmd). `clone()` — duplicate current branch into new session file (`/clone` cmd). |
| `compact(prompt?)` | Manually trigger context compaction with optional custom instructions (`/compact [prompt]`). |
| `tree()` | Navigate session tree: search, fold/unfold, branch jump, label jump (`/tree` cmd). |
| `label(text)` | Add a bookmark to the current entry (`/label` cmd). |
| `reload()` | Hot-reload extensions, skills, prompts, themes, keybindings, context files (`/reload`). |
| `subscribe(listener) => unsubscribe` | Returns the unsubscribe function. **Pair every subscribe with the unsubscribe** to avoid leaks (critical in Electron where renderer reloads). |
| `getSessionInfo()` | Returns `{ id, file, messageCount, tokens, cost }` (powers `/session` cmd). |
| `getMessages()` | Read full in-memory message list (active branch). |
| `getBranches()` | Enumerate all branches with their entry counts. |
| `getContextUsage()` | Current context-window utilization → drives OpenBuddy's "context pill". |

### Implementation notes

- All methods are **synchronous-call, async-return**; no need for `LocalSet`/`!Send` workarounds (the old `MvpAgent !Send` constraint that drove `bridge.rs` 796 lines is **gone**).
- `prompt()` does NOT return a Promise that resolves when the message is *sent*; it resolves when the turn completes. To send + continue, just call `prompt()` and let `subscribe` handle streaming.
- `steer()` and `followUp()` are queue-only; safe to call from anywhere, including from inside extension event handlers.
- `compact()` is idempotent — safe to call from a UI button or from the model's own decision.

Sources: [`packages/coding-agent/docs/sdk.md`](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/docs/sdk.md), [`packages/coding-agent/src/core/agent-session.ts`](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/src/core/agent-session.ts).

## 2. Event types — full `AgentSessionEvent` union

`session.subscribe((event) => ...)` receives this discriminated union:

### Lifecycle

| Event | Payload | When |
|---|---|---|
| `agent_start` | `{}` | First turn of the session |
| `agent_end` | `{ reason?: "stop"\|"aborted"\|"error", error?: Error }` | Session ends. **`reason: "error"` is our `grok://agent-died` signal.** |
| `turn_start` | `{ turnIndex: number }` | Each new turn begins |
| `turn_end` | `{ turnIndex, stopReason, usage }` | Each turn completes. `stopReason` is `"end_turn"` / `"tool_use"` / `"max_tokens"` / `"aborted"` / `"error"`. |
| `message_start` | `{ message: Message }` | User or assistant message begins |
| `message_update` | `{ message, event: AssistantMessageEvent \| ToolMessageEvent }` | Streaming delta for an assistant or tool message. For assistant text, the inner event is `assistantMessageEvent.text_delta` with `{ delta: string }`. |
| `message_end` | `{ message: Message }` | Message finalized |

### Tools

| Event | Payload | When |
|---|---|---|
| `tool_execution_start` | `{ toolCallId, toolName, args }` | LLM emitted a tool call; extension/built-in tool is about to execute |
| `tool_execution_update` | `{ toolCallId, partialResult }` | Streaming partial result (only for tools that emit updates) |
| `tool_execution_end` | `{ toolCallId, toolName, result, isError }` | Tool execution finished (or failed) |

### Session

| Event | Payload | When |
|---|---|---|
| `session_start` | `{}` | Session file opened (also on `resume`) |
| `session_shutdown` | `{}` | Session being closed (before `app.quit()` / window unload) |
| `session_before_switch` | `{ fromCwd, toCwd }` | CWD change about to happen (extension can cancel) |
| `session_before_compact` | `{ tokensBefore, firstKeptEntryId }` | Compaction about to happen (extension can supply custom summary) |
| `session_compacted` | `{ summary, tokensBefore, firstKeptEntryId }` | Compaction done |

### Model & input

| Event | Payload | When |
|---|---|---|
| `model_select` | `{ model: Model }` | Model being selected (extension can override) |
| `input` | `{ prompt: string }` | Raw user input before being delivered (extension can intercept/transform) |

### Streaming text

The single most important pattern for the React renderer:

```ts
session.subscribe((event) => {
  if (event.type === "message_update") {
    const inner = event.event;
    if (inner.type === "assistantMessageEvent") {
      if (inner.assistantMessageEvent.type === "text_delta") {
        const delta = inner.assistantMessageEvent.delta; // <- string chunk
        // forward to renderer via webContents.send("pi://update", { kind: "text_delta", delta })
      }
    }
  }
});
```

In OpenBuddy Pi, `electron/main/agent-host.ts` owns this loop and converts `AgentSessionEvent` → the same `pi://*` channel surface the React UI already expects.

Sources: [`packages/coding-agent/src/core/agent-session.ts`](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/src/core/agent-session.ts), [Pi events reference](https://github.com/earendil-works/pi/blob/HEAD/packages/coding-agent/docs/extensions.md).

## 3. Session storage — JSONL tree

### Path & file naming

- **Location**: `~/.pi/agent/sessions/<encoded-cwd>/<sessionId>.jsonl`
- **`<encoded-cwd>`**: working directory with `/` replaced by `-` (so `/Users/me/work` → `-Users-me-work`). This isolates sessions per project.
- **`<sessionId>`**: 26-char ULID (`01J…`), generated when `SessionManager.create({ cwd })` is called the first time.

### Schema versions

| Version | Notes | Migration |
|---|---|---|
| **v1** | Linear sequence. Old format. | Auto-migrated on load to v2. |
| **v2** | Tree structure via `id`/`parentId` linking. | Active. |
| **v3** | Renamed `hookMessage` role to `custom` (for extension-unification). | Active (current default). |

`SessionManager` auto-migrates older files on first load.

### Entry types

```jsonl
{"type":"message","id":"abc","parentId":null,"role":"user","content":"..."}
{"type":"message","id":"def","parentId":"abc","role":"assistant","content":[...]}
{"type":"toolResult","id":"ghi","parentId":"def","toolName":"bash","content":[...],"isError":false}
{"type":"thinking_level_change","id":"jkl","parentId":"def","level":"high"}
{"type":"model_change","id":"mno","parentId":"abc","model":"anthropic/claude-sonnet-4-5"}
{"type":"compaction","id":"pqr","parentId":"abc","summary":"...","firstKeptEntryId":"xyz","tokensBefore":120000}
{"type":"branch_summary","id":"stu","parentId":"abc","summary":"..."}
{"type":"label","id":"vwx","parentId":"def","label":"bookmark-name"}
{"type":"custom","id":"yza","parentId":"def","customType":"team_status","data":{...}}
{"type":"session_info","id":"bcd","parentId":null,"version":3,"cwd":"...","createdAt":...}
```

### What we get for free (vs the current `sessions.rs` 686 lines)

- `/tree` — full tree UI with search, fold/unfold, branch jump, label jump. Built-in.
- `/fork` — clone-and-edit-prompt UX.
- `/clone` — duplicate current branch into new file.
- `/compact` — context compression with custom instructions.
- Auto-compaction when context approaches limits.
- Labels / bookmarks (`/label foo`).
- Branch summary entries.
- **No need to implement `grok_session_search` / `grok_session_fork` / `grok_rewind_*` / `grok_session_rename` — all native.**

What OpenBuddy still needs to layer on top:
- Pinned / archived / expert-binding metadata → `~/.pi/openbuddy-state.json` (parallel file, separate from the JSONL).
- Session listing (we already have it via `SessionManager.list()`; just adapt the renderer's expected response shape).

Sources: [`pi.dev/docs/latest/session-format`](http://pi.dev/docs/latest/session-format), [`packages/coding-agent/src/core/session-manager.ts`](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/src/core/session-manager.ts).

## 4. Providers

### Built-in providers (v0.84.x, 19+)

#### Subscriptions (OAuth, no API key needed)

| Provider | Notes |
|---|---|
| Anthropic (Claude Pro/Max) | PKCE flow; manual paste |
| OpenAI (ChatGPT Plus/Pro, Codex) | PKCE + local callback on `127.0.0.1:1455` |
| GitHub Copilot | Device code flow (polling) |
| xAI (Grok/X subscription) | OAuth-minted key |
| OpenRouter | OAuth-minted key |
| Radius | Dynamic pi-messages gateway |

#### API key providers (env-var fallback to `~/.pi/agent/auth.json`)

| Provider | Env var |
|---|---|
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Google Gemini | `GEMINI_API_KEY` |
| Google Vertex | (workload identity / service account JSON) |
| Amazon Bedrock | `AWS_BEARER_TOKEN_BEDROCK` |
| Mistral | `MISTRAL_API_KEY` |
| Groq | `GROQ_API_KEY` |
| Cerebras | `CEREBRAS_API_KEY` |
| xAI | `XAI_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |
| Kimi For Coding | `KIMI_API_KEY` |
| MiniMax / MiniMax (China) | `MINIMAX_API_KEY` / `MINIMAX_CN_API_KEY` |
| Qwen Token Plan (Global / China) | `QWEN_TOKEN_PLAN_API_KEY` / `…_CN_API_KEY` |
| ZAI Coding Plan (Global / China) | `ZAI_API_KEY` / `ZAI_CODING_CN_API_KEY` |
| NVIDIA NIM | `NVIDIA_API_KEY` |
| Azure OpenAI Responses | `AZURE_OPENAI_API_KEY` |
| Cloudflare AI Gateway / Workers AI | `CLOUDFLARE_API_KEY` |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` |
| OpenCode Zen / OpenCode Go | `OPENCODE_API_KEY` |
| Hugging Face | `HF_TOKEN` |
| Fireworks | `FIREWORKS_API_KEY` |
| Together AI | `TOGETHER_API_KEY` |
| Baseten | `BASETEN_API_KEY` |
| Xiaomi MiMo (4 endpoints: Global, China, Amsterdam, Singapore) | `XIAOMI_API_KEY` / `XIAOMI_TOKEN_PLAN_*` |
| Ant Ling | `ANT_LING_API_KEY` |

#### Local inference

- **llama.cpp** router server (`/login llama.cpp`, `/llama`)

### Custom providers via `~/.pi/agent/models.json`

```jsonc
{
  "<provider-name>": {
    "type": "openai" | "anthropic-messages" | "google-generative-ai",
    "baseUrl": "https://my-llm.example.com/v1",   // required for openai / anthropic-messages
    "apiKey":  "sk-...",                            // optional if env var supplies it
    "models": {
      "my-custom-model": {
        "name":             "my-custom-model",
        "maxTokens":        8192,
        "contextWindow":    200000,
        "maxOutputTokens":  16384,
        // provider-specific extras:
        "temperature":      true,                   // openai: supports temperature
        "system":           true,                   // openai: supports system messages
        "thinkingBudget":   8192,                   // google: extended thinking budget
        "topP":             true,
        "topK":             true,
        "safety":           [...],                  // google: safety settings
        "mimeType":         true,                   // google: per-message mime overrides
        // anthropic-messages: prompt caching supported by default
      }
    }
  }
}
```

- Pi falls back to the built-in registry for any model ID not in this file.
- Vertex AI shape: `"type": "google-generative-ai"`, `"vertexai": true`, add `"project"` + `"location"` fields.

### What we get for free (vs `providers.rs` 1281 lines + `providers_save_provider` × 8 commands)

- All 19+ providers ship with Pi; OpenBuddy's `providers_save_*` / `providers_delete_*` / `providers_fetch_models` all map to `~/.pi/agent/models.json` read/write + the built-in registry.
- **The BYOK-isolation bug class (`byok_isolate` ~80 LOC) disappears entirely** — Pi has no "default internal model" to clash with.

What OpenBuddy layers on:
- A friendly "Add Provider" form in the Settings UI that writes `models.json`.
- Re-rendering the model picker after a save (just call `modelRegistry.reload()`).

Sources: [`pi.dev/docs/latest/providers`](http://pi.dev/docs/latest/providers), [`packages/ai/src/providers/`](https://github.com/earendil-works/pi/tree/v0.84.1/packages/ai/src/providers).

## 5. Built-in tools — the four core tools

Pi ships exactly **four** core tools by default (Zechner's "4 tools, no more" philosophy). Anything else (memory, web search, todo widget, …) is an extension.

| Tool | Params | Notes |
|---|---|---|
| **read** | `path` (required), `offset`/`startLine`, `limit`/`endLine` | Text + images (jpg/png/gif/webp sent as model attachments). Default 2000 lines; lines >2000 chars truncated. |
| **write** | `path`, `content` | Creates parents if missing. Overwrites. |
| **edit** | `path`, `oldText`, `newText` | Surgical replacement. Fails if `oldText` matches 0 or >1 places. |
| **bash** | `command`, `timeout?` | Returns stdout/stderr. Optional timeout in seconds (no default). |

CLI flags to tune the tool set:

```bash
pi                                   # default: read, bash, edit, write
pi --tools read,grep,find,ls -p      # read-only mode
pi --tools read,bash                 # custom subset
pi --no-builtin-tools                # disable built-ins, keep extensions
pi --no-tools                        # disable all tools by default
```

### Read-only siblings (`grep`, `find`, `ls`)

Available via `--tools read,grep,find,ls` or via the `--read-only` flag in some clients. They are **not** in the default four.

### What we get for free

- The four tools give the agent the full file + shell loop that OpenBuddy's current `MvpAgent` provides via grok's source.
- No need to wrap them — extension tools go *beside* the four, not replacing them.

What OpenBuddy layers on (extensions):
- `memory_*` (read/write across-session memory)
- `create_team` / `team_status` / `team_delete` (multi-agent team runtime)
- `inspiration_generate` (side-session for inspiration prompts)
- `folder_trust_respond` (project trust prompt)
- `permission_respond` (mapped onto Pi's native permission system, see §8)
- `toggle_plan_mode` (mapped onto Pi's native plan mode or `@arvoretech/pi-plan-mode` extension)
- MCP server tools (auto-registered per server from `~/.pi/agent/mcp.json`).

Sources: [`packages/coding-agent/src/core/tools/`](https://github.com/earendil-works/pi/tree/v0.84.1/packages/coding-agent/src/core/tools).

## 6. Extensions API — the OpenBuddy extension surface

### `ExtensionAPI` shape

```ts
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";

const extension: { init: (ctx: ExtensionContext) => void } = {
  init(ctx) {
    // 1. Register custom tools
    ctx.api.registerTool({
      name: "openbuddy_create_team",      // snake_case; used by LLM
      label: "Create Team",                // human-readable
      description: "Spin up a multi-agent team to tackle a complex task …",
      parameters: Type.Object({
        goal: Type.String({ description: "What the team should accomplish" }),
        size: StringEnum(["small", "medium", "large"] as const),
        isolation: Type.Optional(StringEnum(["shared", "worktree"] as const)),
      }),
      execute: async (toolCallId, args, signal, onUpdate, ctx) => {
        const team = await createTeam(args.goal, args.size);
        return {
          content: [{ type: "text", text: `Team ${team.id} created.` }],
          details: { teamId: team.id, members: team.members },
        };
      },
      // optional TUI rendering (we ignore — host UI does not use TUI)
      // renderCall: (args, theme) => …,
      // renderResult: (result, opts, theme) => …,
    });

    // 2. Register slash commands
    ctx.api.registerCommand({
      name: "memory",                    // invoked as `/memory`
      description: "List/save cross-session memory",
      shortcut: "ctrl+m",
      handler: async (args, cmdCtx) => {  // cmdCtx: ExtensionCommandContext
        const list = await memoryList();
        cmdCtx.sendUserMessage(`/memory\n${list.map(m => `- ${m.title}`).join("\n")}`);
      },
    });

    // 3. Register keyboard shortcuts
    ctx.api.registerShortcut("ctrl+shift+r", async () => { /* … */ });

    // 4. Subscribe to events
    ctx.api.on("agent_end", (event) => {
      if (event.reason === "error") emitToRenderer("pi://agent-died", { error: String(event.error) });
    });

    // 5. Push messages from outside
    ctx.api.sendUserMessage("System: scheduled task fired");
    ctx.api.sendMessage({ role: "assistant", content: "…" });

    // 6. Trigger UI dialogs (no-op in -p / JSON mode; only TUI / our host)
    if (ctx.hasUI) {
      const choice = await ctx.ui.select({
        message: "Approve file deletion?",
        options: ["Yes", "No", "Show diff first"],
      });
    }
  },
};
```

### `ExtensionContext` fields

```ts
interface ExtensionContext {
  api: ExtensionAPI;
  cwd: string;                            // working dir of the session
  modelRegistry: ModelRegistry;            // for resolving models by id
  authStorage: AuthStorage;                // for API-key lookups
  session: AgentSession;                  // bound session (for steer/followUp/abort)
  hasUI: boolean;                          // false in -p / JSON mode
  ui: ExtensionUI;                         // see below
}

interface ExtensionUI {
  select<T>(opts: { message: string; options: (T | { label: string; value: T; description?: string })[]; initial?: T }): Promise<T>;
  input(opts: { message: string; placeholder?: string; default?: string; password?: boolean }): Promise<string>;
  editor(opts: { message: string; default?: string }): Promise<string>;
  confirm(opts: { message: string; default?: boolean }): Promise<boolean>;
  notify(message: string, level?: "info" | "warning" | "error"): void;
  setStatus(key: string, value: string | undefined): void;
  setWidget(key: string, component: Component | undefined): void;
  setFooter(component: Component | undefined): void;
  setTitle(title: string): void;
  custom(component: Component): Promise<void>;
  setEditorComponent(component: Component | undefined): void;
}
```

### Events extensions can subscribe to

The full set: `agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `tool_call`, `tool_result`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `session_start`, `session_shutdown`, `session_before_switch`, `session_before_compact`, `input`, `model_select`.

For OpenBuddy Pi, the Electron host:
1. Spawns extensions via `extensions: [...]` in `createAgentSession(opts)`.
2. **Or** loads extensions from a directory: `~/.pi/agent/extensions/*.ts` or `~/.pi/agent/extensions/*/index.ts` (project-local: `.pi/extensions/`).
3. Our extensions live in `extensions/openbuddy/*/index.ts` — shipped inside the Electron bundle.
4. For tool-call UI dialogs, we need a host-side implementation that overrides `ctx.ui.*` to render in the renderer (Electron) instead of the TUI. Implementation note: capture `ctx.ui.*` calls and forward to renderer via `webContents.send("pi://question", …)`; renderer shows a modal; answer is delivered back via a new IPC `pi:question:reply`.

Sources: [`pi.dev/packages/ExtensionAPI`](https://mintlify.wiki/badlogic/pi-mono/api/coding-agent/extension-api), [`packages/coding-agent/docs/extensions.md`](https://github.com/earendil-works/pi/blob/HEAD/packages/coding-agent/docs/extensions.md).

## 7. MCP integration — `~/.pi/agent/mcp.json`

### Config shape

```jsonc
{
  "mcpServers": {
    "<server-name>": {
      "command": "node",
      "args": ["path/to/server.js", "--flag"],
      "env": { "API_KEY": "${ENV_VAR_NAME}" },     // env-var interpolation
      "cwd": "/abs/path",                          // optional
      "transport": "stdio"                         // default
    },
    "<server-http>": {
      "url": "https://mcp.example.com/mcp",
      "transport": "streamable-http",             // or "sse"
      "headers": { "Authorization": "Bearer …" }
    }
  }
}
```

Supported transports: **`stdio`** (default), **`streamable-http`**, **`sse`**, plus community **`websocket`** via `0xKobold/pi-mcp`.

### Behavior

- Connects at session start; auto-reconnects on disconnect.
- Sends `tools/list_changed` notifications to the agent.
- `notifications/tools/list_changed` → agent re-fetches tool definitions.
- Each MCP tool is exposed to the agent as `mcp__<server>__<tool>` (Claude-style namespacing).
- Env vars are interpolated at load time; restart session to re-interpolate.

### Slash commands

`/mcp list`, `/mcp connect`, `/mcp status`, `/mcp discover`, `/mcp add`, `/mcp filter allow|deny`, `/mcp import`.

### What we get for free

- **Auto-discovery** of MCP servers (eliminates `mcp_auth_status` / `connectors_cli_*` polling).
- **Tool caching** + **reconnect** are native; we don't need to wrap.
- The renderer's `mcp_list` / `mcp_upsert` / `mcp_toggle` simply read/write `mcp.json`; the agent sees the change next turn.

What OpenBuddy layers on:
- Connector marketplace browsing (`connectors_default_root`, `connectors_list_roots`, `connectors_load`, `connectors_read_mcp_config`) — pure filesystem reads, no agent interaction.
- CLI-based auth for OAuth-required connectors (`connectors_cli_auth`, `connectors_cli_unauth`) — Node-side subprocess spawn, no agent involvement.

Sources: [`github.com/0xKobold/pi-mcp`](https://github.com/0xKobold/pi-mcp), [`packages/coding-agent/src/core/mcp/`](https://github.com/earendil-works/pi/tree/v0.84.1/packages/coding-agent/src/core/mcp).

## 8. Permissions — `~/.pi/agent/settings.json`

### Schema (top-level)

```jsonc
{
  // Model selection
  "model": {
    "provider":    "anthropic",
    "name":        "claude-sonnet-4-5",
    "thinkingLevel": "medium"
  },

  // Permissions (rules: deny > ask > allow)
  "permissions": {
    "defaultMode": "default",            // default | acceptEdits | dontAsk | plan | bypassPermissions
    "allow":       ["Bash(npm test)", "Read", "Read(./docs/**)"],
    "ask":         ["Bash(git push *)"],
    "deny":        ["Read(./.env)", "Bash(rm *)", "Bash(curl * | sh)"]
  },

  // UI / shortcuts
  "shortcuts": {},
  "themes":    { "current": "dark" },

  // Skills (alternative to on-disk skills/)
  "skills":    ["path/to/skill1", "dir/of/skills"],

  // Extensions (alternative to extensions/*.ts)
  "extensions": ["path/to/ext1.ts"],

  // Agents / subagents (alternative to ~/.pi/agent/agents/*.md)
  "agents":    [],

  // Misc
  "enableSkillCommands": true,
  "share":                false,
  "copySelection":        true
}
```

### Permission modes

| Mode | Behavior |
|---|---|
| `default` | Read-only tools run directly; mutating tools prompt. |
| `acceptEdits` | Auto-accept file edits; prompt for shell + writes. |
| `dontAsk` | Skip the prompt; deny unless `allow` matches. |
| `plan` | Plan mode — agent proposes, user accepts before execution. |
| `bypassPermissions` | Allow everything (CI / trusted env). |

### Rule precedence

`deny → ask → allow`. First match wins.

Rule shapes:
- `"Read"` — all reads
- `"Read(./.env)"` — glob match on the arg
- `"Bash(git push *)"` — bash with the matching pattern
- `"Bash"` — all bash

### What we get for free

- The full `default` / `acceptEdits` / `plan` UX with per-tool and per-arg rules.
- `bypassPermissions` for CI / trusted scripts.

What OpenBuddy layers on:
- A friendly Settings UI form for `permissions.allow/ask/deny` arrays.
- Project `.pi/settings.json` overlay (more specific than user settings).

Sources: [`pi.dev/packages/@bacnh85/pi-permission`](http://pi.dev/packages/@bacnh85/pi-permission), [`packages/coding-agent/src/core/permissions/`](https://github.com/earendil-works/pi/tree/v0.84.1/packages/coding-agent/src/core/permissions).

## 9. Skills — `SKILL.md`

### Discovery locations (later wins on collision)

- **Global**: `~/.pi/agent/skills/`, `~/.agents/skills/`
- **Project**: `.pi/skills/`, `.agents/skills/` (walked up to git root)
- **Packages**: `skills/` dir or `pi.skills` array in `package.json`
- **Settings**: `settings.json` `skills` array (files or directories)
- **CLI**: `pi --skill <path>` (repeatable, additive with `--no-skills`)

### SKILL.md format

```markdown
---
name: my-skill                   # required, max 64 chars, lowercase a-z, 0-9, hyphens
description: What this skill does and when to use it. Be specific.   # required, max 1024 chars
license: MIT                     # optional
compatibility: Pi >= 1.0         # optional, max 500 chars
metadata:                        # optional, arbitrary KV
  author: your-name
  version: "1.0"
allowed-tools: bash read write   # optional, space-delimited (experimental)
disable-model-invocation: false  # optional, hides from system prompt if true
---

# My Skill

## Setup
```bash
cd /path/to/skill && npm install
```

## Usage
```bash
./scripts/process.sh arg1 arg2
```
```

### Directory structure

```
my-skill/
├── SKILL.md          # required
├── scripts/          # optional: process.sh, helpers
├── references/       # optional: detailed docs (loaded on demand)
└── assets/           # optional: templates, configs, static files
```

### Loading model

**Progressive disclosure**:
1. At startup, Pi scans locations and extracts `name + description`.
2. System prompt includes the list of available skills (XML format).
3. When a task matches, the agent uses `read` to load the full `SKILL.md`.
4. Agent follows instructions; can use `read` again to load `references/`.

### Manual invocation

```
/skill:brave-search
/skill:pdf-tools extract
```

(Requires `"enableSkillCommands": true` in `settings.json`.)

### Differences from the Agent Skills standard

- Pi allows skill `name` to differ from the parent directory name.
- Pi has **no Skill tool** — the LLM reads skills via the `read` tool.
- Validation is **lenient** — most violations warn but still load.

### What we get for free

- The entire skills system replaces OpenBuddy's `skills.rs` (159 LOC) + `skills_catalog` (file-on-disk).
- The renderer just needs a settings tab that writes `SKILL.md` files.

Sources: [`packages/coding-agent/docs/skills.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md), [`mintlify.wiki/badlogic/pi-mono/guides/creating-skills`](https://mintlify.wiki/badlogic/pi-mono/guides/creating-skills).

## 10. Slash commands — full built-in list

### Authentication

| Cmd | Effect |
|---|---|
| `/login` | Manage OAuth / API-key credentials |
| `/logout` | Clear credentials |

### Session branching & navigation

| Cmd | Effect |
|---|---|
| `/tree` | In-place tree navigation: search, fold/unfold, jump to any entry, switch between branches. **Single JSONL file.** |
| `/fork` | Create a **new session file** from a previous user message. Opens selector, copies the active path up to that point, places the selected prompt in the editor for modification. |
| `/clone` | Duplicate the **current active branch** into a new session file. Keeps full active-path history; opens with empty editor. |
| `/compact [prompt]` | Manually compact context, optionally with custom instructions. Long sessions can exhaust context windows — compaction summarizes older messages while keeping recent ones. |
| `/label [text]` | Bookmark the current entry with a label. |
| `/new` | Start a new session. |
| `/resume` | Pick from previous sessions. |
| `/name` | Set session display name. |
| `/session` | Show session info (file, ID, messages, tokens, cost). |
| `-c` (CLI) | Continue most recent session. |
| `-r` (CLI) | Browse and select from past sessions. |
| `--no-session` (CLI) | Ephemeral mode (don't save). |
| `--session <id>` (CLI) | Use a specific session file or ID. |
| `--fork<id>` (CLI) | Fork a session into a new session file. |

> **Note**: there is **no `/branch`** command — branching is handled by `/tree` (in-place navigation across the session tree) and `/fork` / `/clone` (creating new session files from branches).

### Skills & reload

| Cmd | Effect |
|---|---|
| `/skill:name` | Invoke a skill (auto-registered from `~/.pi/agent/skills/`, `~/.agents/skills/`, `.pi/skills/`, `.agents/skills/`). Example: `/skill:brave-search`. |
| `/reload` | Reload keybindings, extensions, skills, prompts, themes, and context files. (Themes hot-reload automatically.) |

### Model management

| Cmd | Effect |
|---|---|
| `/model` | Open model selector |
| `/scoped-models` | Manage models available via Ctrl+P cycling |
| `/llama` | Manage llama.cpp local models |

### Content operations

| Cmd | Effect |
|---|---|
| `/copy` | Copy last assistant message to clipboard |
| `/export [file]` | Export session to HTML or JSONL |
| `/import` | Import and resume a session from a JSONL file |
| `/share` | Upload as private GitHub gist with shareable HTML link |

### Settings

| Cmd | Effect |
|---|---|
| `/settings` | Open settings panel |
| `/trust` | Save project trust decision |
| `/hotkeys` | Show keyboard shortcuts |
| `/changelog` | Display version history |
| `/quit` / `/exit` | Quit pi |

### What we get for free

- **Every single session lifecycle command OpenBuddy currently has**: `grok_new_session`, `grok_load_session`, `grok_list_sessions`, `grok_rename_session`, `grok_delete_session`, `grok_set_model`, `grok_auth_status`, `grok_init`, `grok_shutdown`, `grok_send`, `grok_cancel` — all are direct calls to `session.*` methods or built-in slash commands.

Sources: [`pi.dev/docs/latest/usage`](https://pi.dev/docs/latest/usage), [`github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/usage.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/usage.md).

## 11. Subagents — **still no native**, but rich community

Pi has **no built-in subagent concept** in v0.84.x (Zechner's "4 tools" philosophy). However, the community has filled the gap with several mature extensions:

| Package | Approach |
|---|---|
| `@ferris1225/pi-subagents` | Single task → `"shared"`; parallel worker tasks → `"worktree"` isolation. Requires `pi >= 0.80.6`. |
| `@ifi/pi-extension-subagents` | Per-task agent definition, depth limit, worktree pool. |
| `pi-subagents-lite` | Foreground vs background execution; persistent status bar widget. |
| `pi-ultracode` | Bounded JS workflows with parallel subagents + isolated worktrees + structured output + durable resume + live progress. **Explicitly tested with Pi 0.84.** |
| `pi-agent-squad` | Delegation via `subagent` tool with `sync` and `background async:true`; configurable timeouts (default 6 h, max 3 d). |
| `@esso0428/pi-patty-bg-tasks` | `bash_bg` tool + `run_in_background` param + auto-backgrounding after 120 s. |
| `@kmmuntasir/pi-nested-subagents` | Cron schedules, intervals ("5m", "1h"), one-shots ("+10m", ISO timestamp). |
| `oira666_pi-subagent` | Each subagent runs as a separate pi process; OS-level isolation; CPU parallelism. Config via `PI_SUBAGENT_MAX_PARALLEL_TASKS`, `PI_SUBAGENT_MAX_CONCURRENCY`, `PI_SUBAGENT_MAX_DEPTH`. |

### OpenBuddy strategy

- **Don't vendor any of these directly** — they are designed for TUI workflows and our Electron renderer is the UI.
- **Implement `create_team` / `team_status` / `team_delete` as our own Pi extension** (`extensions/openbuddy/team-tools/index.ts`) — same surface as v0.14.0's MCP server, but the team runtime is in-process (sub-sessions that share Pi's auth + extension host).
- The team members are themselves `AgentSession` instances, spawned with `SessionManager.inMemory()` to keep them transient.

Sources: [`pi.dev/packages/@ferris1225/pi-subagents`](https://pi.dev/packages/@ferris1225/pi-subagents), [`npmjs.com/package/pi-ultracode`](https://www.npmjs.com/package/pi-ultracode).

## 12. Web search — community extensions, not native

Pi itself has **no web search tool**. The community packages fill it:

| Package | Notes |
|---|---|
| `pi-web-search` (v1.3.1) | Detects current provider and uses native search: Gemini grounding, OpenAI Responses web search, Anthropic Messages web search. Up to 20 additional URLs. Config in `~/.pi/agent/web-search.json`. |
| `pi-gemini-search` | Gemini-grounded search + research. |
| `@narumitw/pi-google-genai` | Gemini Search + Maps + URL Context grounding. |
| `pi-web-access` / `@diegopetrucci/pi-web-access` | Multi-provider (OpenAI, Anthropic, Gemini, Brave, Exa, Perplexity, Tavily, SearXNG). |

### OpenBuddy strategy

- Bundle `pi-web-search` as a dependency of our Electron app (`extensions/openbuddy/websearch-bridge/` is a thin wrapper).
- Toggle: `~/.pi/agent/web-search.json` with `{ provider, model }` (or `{ disabled: true }`).
- Maps cleanly onto OpenBuddy's `web_search_config_get` / `web_search_config_save` commands.

Sources: [`pi.dev/packages/pi-web-search`](https://pi.dev/packages/pi-web-search?page=6).

## 13. Plan mode — community packages, no native

Pi itself has **no built-in plan mode** in v0.84.x. The community provides:

| Package | Notes |
|---|---|
| `@arvoretech/pi-plan-mode` | Cursor-style plan mode. Tab toggle. Persists plans to `.pi/plans/*.md`. |
| `@pi9/todo` | Replaces a hand-written plan UI with a Todo widget (○ ◐ ✓ ⊘ states + phase progress). |
| `@burneikis/pi-nolo` | "No-YOLO" mode: Enter/Esc dialog + diff preview. |

### OpenBuddy strategy

- Wire `@arvoretech/pi-plan-mode` as our `toggle_plan_mode` extension (Pi extension, not Electron main).
- The toggle's UI dialog reuses `ctx.ui.confirm` for the prompt.
- Persistence is `.pi/plans/*.md`; renderer reads via `fs/promises`.

Sources: [`pi.dev/packages/@arvoretech/pi-plan-mode`](https://pi.dev/packages/@arvoretech/pi-plan-mode).

## 14. Auth & account — `AuthStorage`

### Storage

- **File**: `~/.pi/agent/auth.json` (mode `0o600`).
- **Locking**: `proper-lockfile` for concurrent file locking during token refresh.

### Backends

- `FileAuthStorageBackend` — persistent, reads `~/.pi/agent/auth.json`.
- `InMemoryAuthStorageBackend` — for tests.

### Credential types

```json
{
  "anthropic": {
    "type":  "oauth",
    "access":  "...",
    "refresh": "...",
    "expires": 1712345678000
  },
  "openai": {
    "type":  "api_key",
    "key":   "sk-..."
  }
}
```

### Resolution priority

```
Runtime override (CLI --api-key)
  → auth.json (api_key OR oauth with auto-refresh)
    → Environment variable (ANTHROPIC_API_KEY, etc.)
      → Custom fallback resolver (models.json)
```

### OAuth flows

| Provider | Flow | Callback port |
|---|---|---|
| Anthropic (Claude Pro/Max) | PKCE / manual paste | — |
| Google Gemini CLI | PKCE + local callback | `127.0.0.1:8085` |
| Google Antigravity | PKCE + local callback | `127.0.0.1:51121` |
| GitHub Copilot | Device code flow (polling) | — |
| OpenAI Codex (ChatGPT Plus/Pro) | PKCE + local callback | `127.0.0.1:1455` |

### PKCE pattern

1. `generatePKCE()` → verifier + challenge.
2. Start local HTTP server on `127.0.0.1:PORT`.
3. Open auth URL with challenge via system browser (`open` / `start` / `xdg-open`).
4. User approves.
5. Provider redirects to local callback with code.
6. Token exchanged + persisted to `auth.json`.

### What we get for free

- The whole auth flow for Anthropic, OpenAI, Google, Copilot.
- `account_get_api_key` / `account_set_api_key` become trivial: read/write `auth.json`.

What OpenBuddy layers on:
- The Electron renderer needs a "Add Account" UX that calls into `authStorage.login("anthropic")` and renders the system browser.
- For OAuth flows that need a local callback server, Electron's `app.whenReady().then(() => { httpServer.listen(127.0.0.1:1455); })` pattern.

Sources: [`deepwiki.com/agentic-dev-io/pi-agent/3.4-authentication-and-oauth`](https://deepwiki.com/agentic-dev-io/pi-agent/3.4-authentication-and-oauth), [`packages/coding-agent/src/core/auth-storage.ts`](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/src/core/auth-storage.ts).

## 15. ModelRegistry

### What it does

`ModelRegistry` resolves a model id string (`"anthropic/claude-sonnet-4-5"`, `"openai/gpt-5"`, `"google/gemini-2.5-pro"`, `"xai/grok-4"`, …) into a `Model` object with provider-specific metadata (`maxTokens`, `contextWindow`, `cost`, `supportsTools`, `supportsImages`, `supportsPromptCache`, `reasoning`).

### Key API

```ts
const registry = new ModelRegistry(authStorage);
const model = registry.find("anthropic/claude-sonnet-4-5");    // built-in
const custom = registry.find("my-local/llama-3.1");            // from models.json
registry.reload();                                              // after writing models.json
```

### What we get for free

- The `setModel(model)` call persists a `model_change` entry to the JSONL tree and updates the in-memory model in one step.
- The renderer just calls `piSetModel({ modelId: "anthropic/claude-sonnet-4-5" })` and the registry does the rest.

Sources: [`packages/coding-agent/src/core/model-registry.ts`](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/src/core/model-registry.ts).

## 16. Settings — full schema

See §8 for the permission-relevant fields. The full `settings.json` shape:

```jsonc
{
  "model": { "provider": "...", "name": "...", "thinkingLevel": "..." },

  "permissions": { "defaultMode": "...", "allow": [...], "ask": [...], "deny": [...] },

  "shortcuts": { "<key-combo>": "<command-name>" },

  "themes": { "current": "dark" | "light" | "<theme-name>" },

  "skills":     ["path1", "dir/of/skills"],
  "extensions": ["path/to/ext.ts"],
  "agents":     [],                         // custom agent definitions

  "enableSkillCommands": true,
  "share":                false,
  "copySelection":        true,

  "shareBaseUrl":         "https://share.example.com"   // override default gist host
}
```

Project-local `.pi/settings.json` overlays the user one (more specific wins).

## 17. ACP / RPC fallback — still available

Pi can speak ACP (`Agent Client Protocol`) via the `omp acp` subprocess command. This lets editor integrations (Zed, JetBrains AI, custom tools) connect to Pi as an ACP agent.

- `omp acp` — start an ACP-over-JSON-RPC subprocess on stdio.
- Compatible with editors that already speak ACP (Zed, marimo, etc.).
- **Not used in OpenBuddy Pi** — we embed directly. Documented as a future option if someone wants to drive OpenBuddy Pi from another editor.

The old `pi --mode rpc` and `pi --mode rpc-ui` modes also still exist (we evaluated them in §1 of `docs/pi-sdk-implementation-plan.md`; chose SDK embed).

Sources: [`agentclientprotocol.com`](https://agentclientprotocol.com/), [`pi.dev/docs/latest/rpc`](http://pi.dev/docs/latest/rpc).

## 18. Community extensions OpenBuddy Pi will bundle

Rather than re-implement these, we ship them as bundled dependencies (no vendoring; pin versions in `package.json`):

| Capability | Pi extension / package | Why we bundle |
|---|---|---|
| Question dialog | `@juicesharp/rpiv-ask-user-question` | Already wraps `ctx.ui.select/input/editor/confirm`; our host routes to renderer modal. |
| Plan mode | `@arvoretech/pi-plan-mode` | Cursor-style toggle; persists plans to `.pi/plans/*.md`. |
| Todo widget | `@pi9/todo` | Replaces hand-written plan UI. |
| No-YOLO mode | `@burneikis/pi-nolo` | Replaces always-approve mode with diff preview. |
| Web search | `pi-web-search` | Provider-native search. |
| Permission layers | `@bacnh85/pi-permission` | Adds layered rules (project > user > deny default). |
| Subagents | `@ferris1225/pi-subagents` | If `create_team` needs to spawn Pi sub-sessions with worktree isolation. |
| MCP client / extras | `0xKobold/pi-mcp` | WebSocket transport + extra commands. |
| Background tasks | `@esso0428/pi-patty-bg-tasks` | `bash_bg` for long shell pipelines. |

All installed via `npm install <pkg>` + listed in `createAgentSession({ extensions: [...] })` from `electron/main/agent-host.ts`.

## 19. What's NOT in Pi → our 10 Pi extensions

| OpenBuddy capability | Why Pi doesn't cover it | Our extension |
|---|---|---|
| `memory_list/get/save/delete/rewrite/flush` | Pi has memory, but no CRUD surface | `extensions/openbuddy/memory/` |
| `tasks_list` / `task_kill` | Pi has no background-task concept | `extensions/openbuddy/tasks/` |
| `toggle_plan_mode` | Pi has no native plan mode (use community pkg, but we own the UX) | `extensions/openbuddy/plan-mode/` |
| `folder_trust_respond` | Pi has `/trust` slash cmd, but we need renderer-driven dialog | `extensions/openbuddy/folder-trust/` |
| `create_team` / `team_status` / `team_delete` | Pi has no team runtime (community pkgs are TUI-only) | `extensions/openbuddy/team-tools/` |
| `inspiration_generate` | Pi has no inspiration concept | `extensions/openbuddy/inspiration/` |
| `notification_append/list/mark_read/mark_all_read/clear` | Pure UI concern; we want a log file | `extensions/openbuddy/notifications/` |
| Automations cron | Pi has no scheduler | `extensions/openbuddy/automations/` |
| Subagent config surface | Pi has no subagent UI; we expose depth/parallel to the user | `extensions/openbuddy/subagents/` |
| Web search toggle | Bundle `pi-web-search`; we own the toggle UX | `extensions/openbuddy/websearch-toggle/` |

Plus 10 host modules in `electron/main/` for things Pi doesn't do at all:

| Module | Purpose |
|---|---|
| `shell-fs.ts` | Node `fs/promises` + `electron.shell` (open URL / reveal in folder) |
| `mcp.ts` | Read/write `~/.pi/agent/mcp.json`; connector marketplace browsing |
| `skills.ts` | Read `SKILL.md` files; render preview |
| `agents.ts` | Read/write `~/.pi/agent/agents/*.md`; expert/agent marketplace browsing |
| `experts.ts` | Convert `expert/*.md` → `agents/*.md` |
| `connectors.ts` | Convert `connector/*.json` → `mcp.json` entry |
| `connectors-cli.ts` | CLI-based OAuth flow for connectors that require external auth |
| `sessions-meta.ts` | Pinned / archived / expert-binding metadata in `~/.pi/openbuddy-state.json` |
| `automations-store.ts` | `~/.pi/openbuddy-automations.json` CRUD |
| `ipc.ts` | `ipcMain.handle("agent:*", …)` + `webContents.send("pi://*", …)` |

## 20. Net result for the OpenBuddy Pi migration

| Item | v0.14.0 | OpenBuddy Pi v1.0 |
|---|---|---|
| Agent core LOC | 14,237 (Rust) | ~0 (npm dep) |
| Desktop shell LOC | Tauri 2 + lib.rs | Electron 31 + window.ts (~300) |
| Built-in tools | 4 (grok-equivalent) | **4 + community extensions** |
| LLM providers | ~6 (Anthropic / OpenAI / Google / Groq / xAI / Mistral + BYOK) | **19+ built-in + custom via models.json** |
| Session mgmt | Custom (sessions.rs 686 lines) | **Native JSONL tree + slash commands** |
| MCP transports | stdio only | **stdio + SSE + streamable-http + WebSocket** |
| Skills | Custom (skills.rs 159 lines) | **Native SKILL.md loader** |
| Permissions | Custom (permission_config.rs 513 lines) | **Native settings.json + rules** |
| BYOK isolation | Manual bug fixes (byok_isolate ~80 LOC) | **Gone — Pi is BYOK-first** |
| Plan mode | Manual UX | **Community extension** |
| Web search | Custom config | **Community extension (provider-native)** |
| Subagents | MCP server (team_mcp.rs 686 lines) | **Our own Pi extension (~150 LOC)** |
| Memory | Manual CRUD | **Our own Pi extension (~100 LOC)** |
| Account / OAuth | Custom (account.rs) | **Native AuthStorage** |
| **Total OpenBuddy-only code** | **~14K Rust** | **~5K TS** (host + 10 extensions) |

The whole point of the migration: every capability OpenBuddy has today maps onto either **(a) Pi native**, **(b) bundled Pi community extension**, or **(c) our 10 thin Pi extensions + 10 host modules**. The 14K Rust lines are gone.

## 21. References

- [pi-mono source (earendil-works/pi)](https://github.com/earendil-works/pi)
- [Pi SDK docs (v0.84.1)](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/docs/sdk.md)
- [Pi extensions reference](https://github.com/earendil-works/pi/blob/HEAD/packages/coding-agent/docs/extensions.md)
- [ExtensionAPI reference](https://mintlify.wiki/badlogic/pi-mono/api/coding-agent/extension-api)
- [Building extensions guide](https://mintlify.wiki/badlogic/pi-mono/guides/building-extensions)
- [Session format](http://pi.dev/docs/latest/session-format)
- [Providers](http://pi.dev/docs/latest/providers)
- [Pi usage docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/usage.md)
- [Skills](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md)
- [Creating skills](https://mintlify.wiki/badlogic/pi-mono/guides/creating-skills)
- [Authentication & OAuth (DeepWiki)](https://deepwiki.com/agentic-dev-io/pi-agent/3.4-authentication-and-oauth)
- [pi-mcp (0xKobold)](https://github.com/0xKobold/pi-mcp)
- [pi-web-search](https://pi.dev/packages/pi-web-search?page=6)
- [@arvoretech/pi-plan-mode](https://pi.dev/packages/@arvoretech/pi-plan-mode)
- [@burneikis/pi-nolo](https://pi.dev/packages/pi-nolo)
- [@ferris1225/pi-subagents](https://pi.dev/packages/@ferris1225/pi-subagents)
- [pi-ultracode (tested with Pi 0.84)](https://www.npmjs.com/package/pi-ultracode)
- [ACP spec](https://agentclientprotocol.com/)
- [Companion: `docs/migration-pi-electron.md`](./migration-pi-electron.md)
- [Companion: `docs/pi-capability-gap-analysis.md`](./pi-capability-gap-analysis.md)
- [Companion: `docs/pi-sdk-implementation-plan.md`](./pi-sdk-implementation-plan.md)