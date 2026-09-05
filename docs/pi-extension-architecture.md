# OpenBuddy Pi Extension Architecture

## Decision

OpenBuddy embeds the Pi SDK in Electron main and keeps the WorkBuddy renderer as the UI. Pi extensions are therefore an agent-runtime extension seam, not a second application plugin system. Cordis remains the canonical service seam for persistent and cross-surface capabilities.

The distributed Buddy layer follows the same seam: `openbuddy-collaboration` is a separately loadable Cordis/Pi capability plugin. It receives a Main-owned `collaborationRuntimeBridge`, registers redacted snapshot/task/network tools through `pi.tools`, and disposes those registrations with the plugin fiber. The default profile enables it; disabling or reloading the entry does not require changing the existing Personal/Project/Skills/Mail navigation.

The profile manifest accepts either namespace:

```json
{
  "openbuddy": {
    "profile": {
      "piExtensions": [
        { "id": "openbuddy-pi-observability", "config": { "toolEvents": true } },
        { "id": "pi-context-prune", "source": "pi-context-prune", "enabled": false }
      ]
    }
  }
}
```

`openbuddy.profile.piExtensions` wins when it is non-empty; `dsh.profile.piExtensions` is the DeepSeek Harness-shaped fallback. A spec with a built-in `id` is resolved by the host. A spec with `source` is resolved from the profile package's dependency graph and passed to Pi as an extension path. Local profile installation materializes the package's resolvable dependency and peer-dependency closure into the staged package, then atomically activates it; registry installs and lifecycle scripts remain outside this API.

Profile packages can also use Pi's native package contract without an OpenBuddy wrapper:

```json
{
  "pi": { "extensions": ["./extensions"], "skills": ["./skills"] }
}
```

OpenBuddy passes the profile root and installed `node_modules` package roots that declare `pi` resources to Pi's `DefaultResourceLoader`. Pi then owns manifest globs, convention directories, extension module loading, cache invalidation, and project/global auto-discovery. This preserves native Pi package behavior while keeping profile installation and dependency resolution under OpenBuddy. A profile or package can be reloaded by changing its manifest/resources; the host waits for the current turn to become idle and performs Pi's session-wide reload transaction.

Profile resource discovery preserves Pi's package manifest semantics: omitted resource keys use the conventional directory, explicit paths are passed through as package roots or files, and glob/override patterns (`*`, `**`, `{a,b}`, `!`, `+`, `-`) are resolved before the resulting paths are handed to Pi. This keeps third-party packages' resource filters intact instead of treating every `pi` field as an unfiltered directory.

### Dynamic reload contract

OpenBuddy intentionally follows two different reload contracts instead of exposing a
misleading per-file hot unload:

- DeepSeek Harness/Cordis entries use `HarnessPluginLoader.replaceProfile()` and
  `loader.update()`. The loader emits `loader/config-update`, disposes affected fibers in
  reverse dependency order, starts the candidate tree, and restores the previous tree when
  an import or `apply()` fails. If a plugin registers effects before its `apply()` later
  fails, the newly-created Cordis scope is disposed before the failure is propagated; a
  failed batch therefore cannot leak event listeners, services, or cleanup fibers.
  Public Main-side loader mutations are serialized through one queue, matching the Renderer
  loader and preventing concurrent profile, group, enable, and config operations from
  interleaving entry/fiber state. Internal reconciliation uses non-queued primitives so
  nested group loads and rollback do not wait on their own transaction.
- Pi resources use `DefaultResourceLoader.reload()` followed by
  `AgentSession.reload()`. Pi owns extension shutdown, resource discovery, extension binding,
  and session-wide replacement. OpenBuddy serializes this operation with profile/package
  mutations and never calls the resource loader twice for one transaction.
- User overrides are persisted atomically. Cordis overrides and Pi extension overrides share
  `openbuddy-plugins.json` but use separate maps; a failed runtime mutation restores both the
  JSON snapshot and the active profile baseline.
- The Main inventory preserves package `version`, sanitized `diagnostics`, and a stable
  `disabledReason` (`user`, `policy`, or `load-failed`) for Pi extensions. The same fields are
  forwarded through preload and rendered in WorkBuddy, so a failed or disabled extension can be
  diagnosed without exposing arbitrary package output or requiring filesystem inspection in the
  renderer.

This boundary is the compatibility rule for third-party packages: a DeepSeek bundle can use
Cordis loader APIs and patch layers, while a native Pi package can use Pi's resource manifest
and reload lifecycle without being rewritten as a Cordis plugin.

The profile package manager accepts all three package classes: `dsh.bundle`/`openbuddy.bundle`, `dsh.client`/`openbuddy.client`, and native Pi packages with a `pi` manifest or convention resource directory. Only bundles are added to `profile.bundles`; Pi packages remain independently discoverable by Pi and are shown as `Pi` packages in the WorkBuddy plugin panel. This prevents a Pi extension package from being incorrectly booted as a Cordis bundle while still allowing one local install/remove workflow.

### Unified package contract

Profile package inventory exposes one normalized `openbuddy.plugin.v1` manifest for all three package families. The manifest records `namespaces`, declared `surfaces` (`bundle`, `pi`, `renderer`, `remote`, `typert`), and runtime `loaded`/`missing` surfaces. `openbuddy` and `dsh` metadata remain source-compatible; native Pi packages may use either the `pi` manifest or convention directories such as `extensions/` and `skills/`. Main computes runtime state after profile reconciliation, preload forwards the typed shape, and the WorkBuddy plugin panel renders it without inspecting package JSON in the renderer. This keeps discovery, diagnostics, permission work, and future install/update flows on one contract while preserving the existing Pi and Harness loaders.

When a profile directly declares a package in `dependencies` or `optionalDependencies`, OpenBuddy automatically adds that package to the bundle layer if its manifest declares `dsh.bundle` or `openbuddy.bundle`. The explicit `dsh.profile.bundles`/`openbuddy.profile.bundles` list remains first and authoritative; discovered direct dependencies are appended in manifest declaration order, de-duplicated, and bundle-less or transitive dependencies are not activated as Cordis layers. This mirrors Harness profile installation without requiring users to maintain a second bundle list.

The browser face follows the same package boundary but a separate lifecycle: `dsh.client`/`openbuddy.client` requires `exports["./client"]`, `external` is an exact module-table dependency edge, and the host topologically loads suppliers before consumers. Client bundles register factories through `window.__ModuleLoader__.load({ id, factory })`; factories resolve only static compatibility modules or registered module-table entries. A missing external, cycle, duplicate factory, or failed replacement aborts the new graph and preserves the previous Renderer graph. UI contributions still enter OpenBuddy's WorkBuddy registries, so Harness package contracts do not replace the existing product shell.

Installed profile packages are also the module-resolution boundary for DeepSeek Harness faces. Main-process `dsh` plugins are imported through the profile package graph after the built-in OpenBuddy ABI aliases are checked; renderer packages are scanned independently for `dsh.client`/`openbuddy.client`, even when they do not contribute a Cordis entry. This matches Harness's dual-face package model: server composition and browser composition share package identity and dependency declarations, but each face is loaded by its own lifecycle.

Profile installation follows the same package-manager boundary as Harness: local directories retain OpenBuddy's atomic copy/materialize path, while npm, git, tarball, `file:` and registry sources are delegated to `pnpm add --ignore-scripts` in the profile directory. The resulting direct dependency is re-scanned for bundle/client/remote/typert/Pi capabilities and bundle packages are appended to the profile layer list in declaration order. Unsupported results roll back the profile manifest and package-manager install; removal likewise updates the layer list transactionally and disables release-age checks only for the cleanup command so newly published packages cannot make uninstall fail. The package-manager hook is injectable for deterministic host tests and embedded deployments.

Renderer client bundles also follow Harness style ownership: styles created while a module factory materializes are tagged with that module id, included in the module record, and removed when the module or any dependent consumer is invalidated. This keeps profile reload/HMR from leaving stale plugin CSS in the WorkBuddy shell. `npm:` aliases are resolved by both dependency key and installed manifest name, so inventory and removal remain stable even when a registry alias points at a differently named package.

DeepSeek session compatibility uses one OpenBuddy service instance with two lookup names: the Harness-standard `ctx.sessions` and the historical OpenBuddy `ctx.session` alias. The alias is lifecycle-bound and is removed together with the service; it never creates a second session store. The built-in `@deepseek-ai/dsh-session/types` and `@deepseek-ai/dsh-session/surface` faces are also available to host/client imports, with browser-safe surface predicates and folding helpers kept separate from the Node session store.

The built-in `@deepseek-ai/dsh-workspace` face now exposes `ctx.workspaceRegistry` and the standard `WorkspaceRegistry`/`WorkspaceId` exports. It stores stable workspace records in the Pi agent directory, canonicalizes existing directories with `realpath`, supports idempotent `create`, ordered `list`, `get`, `resolveByPath`, `delete`, title changes, and session ordering, and exposes `./types`, `./client`, `./remote`, and `./invariant` entry points. This is intentionally a small host-side facade over OpenBuddy/Pi state; it does not start DeepSeek's storage-domain runtime or duplicate the Pi session store. The full Harness archive/event projection and RPC UI contract remain follow-up work.

OpenBuddy now also exposes the same Pi-backed Harness connection through a loopback HTTP/WebSocket carrier. Electron Main starts an ephemeral `127.0.0.1` server, publishes its address and per-process bearer token through the preload bridge, serves typed unary RPC under `/api/<endpoint>`, serves independent `/api/events.mux` and `/api/events.host` downlinks, and accepts interaction responses through `/api/respond`. Renderer compatibility modules select this carrier when the address is available and retain IPC as the fallback for standalone tests and previews. The server is downlink-only over WebSocket, reuses the Main `dispatchHarnessRpc`/Remote dispatcher, supports legacy numeric `?since=<sequence>` and Harness-shaped URL-encoded `?since={"sessionId":lastSeq}` reconnect cursors, emits a `session/subscribed` baseline for every known session before replay, uses `-1` for an empty session log, filters mux history by session-local sequence, buffers live frames while bounded replay is delivered, and closes with the Electron lifecycle. Renderer transport carries per-session cursors into the next socket generation while retaining the legacy single-session numeric form. HTTP/SSE requests use the bearer token, and only idempotent read endpoints reuse the same `rpcId` after a transport failure.

## Capability boundaries

| Pi extension surface | OpenBuddy owner | Integration rule |
| --- | --- | --- |
| Agent/session/model/tool lifecycle | Pi extension registry | Forward typed lifecycle events to Cordis and renderer event logs. |
| Context accounting and compaction hooks | Pi extension registry | May observe or transform Pi context; emit diagnostics and preserve session replay. |
| Provider payload and model hooks | Pi extension registry | Use for provider-specific metadata, never create a second model runtime. |
| MCP servers | `openbuddy-mcp-client` | Adapt Pi MCP extensions to this service or do not load both. |
| Web search/fetch | `openbuddy-web-search` | Reuse the canonical service and credentials; do not load a second web stack by default. |
| Permissions/folder trust | `openbuddy-permission` + `folder-trust` | Pi permission extensions need an adapter to the OpenBuddy policy engine. |
| Todo/plan/subagent/team | OpenBuddy capability/team packages | Keep one state store and one runner; use Pi hooks only as façades. |
| Session persistence and metadata | Pi session manager plus OpenBuddy session service | Pi owns conversation JSONL; OpenBuddy owns renderer and product metadata. |
| Terminal-only widgets and TUI renderers | WorkBuddy renderer | Do not load automatically; adapt status/messages to IPC first. |

## Built-ins

The host currently provides three deliberately small built-ins:

- `openbuddy-pi-observability`: bridges agent, model, session, and optional tool lifecycle events into the existing OpenBuddy event log.
- `openbuddy-pi-context-status`: bridges context and compaction events for renderer/DeepSeek consumers.
- `openbuddy-pi-context-guard`: follows Pi's official threshold-compaction pattern and requests native `ctx.compact()` after a configured token threshold is crossed.

These are intentionally not replacements for MCP, web, permission, todo, or team packages. They establish the safe adapter pattern for future built-ins.

## Ecosystem review

The current high-signal ecosystem candidates were inspected by registry metadata, package manifests, published entry points, and source layout on 2026-08-28. This is a compatibility audit, not approval to install or execute third-party code:

| Candidate | Version | Native Pi contract | Runtime finding | OpenBuddy decision |
| --- | --- | --- | --- | --- |
| `pi-mcp-adapter` | `2.30.0` | `pi.extensions: ["./index.ts"]` | MCP tools, OAuth, commands, `process.cwd()` and filesystem config | **Adapter-backed**: OpenBuddy registers `/mcp`, `/pi-mcp`, `/mcp-auth` on Pi and projects them onto `openbuddy-mcp-client`/authorization without starting a second MCP backend. |
| `pi-web-access` | `0.26.0` | `pi.extensions: ["./index.ts"]` | Search/fetch tools, many provider credentials, terminal widgets and local config | **Adapter-backed**: OpenBuddy registers `/websearch`, `/curator`, `/google-account`, `/search` on Pi and projects them onto `openbuddy-web-search`, preserving one credential and event owner. |
| `pi-messenger` | `0.15.2` | Pi package metadata published | Multi-agent reservations and workflow state | **Optional workflow adapter**: map to `openbuddy-team` only after a shared reservation protocol. |
| `pi-intercom` | `0.12.0` | Pi package metadata published | Inter-session communication | **Optional session adapter**: map to OpenBuddy session references/events; no second broker. |
| `pi-context-prune` | `1.3.0` | `pi.extensions: ["./index.ts"]` | Context hook/tool/command package; uses `~/.pi/agent/context-prune`; command UI includes `ctx.ui.custom()` | **Optional native load**; OpenBuddy now supplies the official RPC-safe `custom()` fallback, but package-specific session replay remains to be verified. |
| `pi-permission-system` | `0.8.0` | Pi package metadata published | Owns permission policy and prompts | **Adapter-backed**: OpenBuddy registers `/permission-system` on Pi and projects it onto `openbuddy-authorization`; OpenBuddy folder trust remains canonical. |
| `pi-review-loop` | `0.4.4` | Pi package metadata published | Persistent review/fix workflow | **Optional workflow adapter** after task/team event mapping. |
| `@arvoretech/pi-plan-mode` | `1.0.1` | `pi.extensions: ["./dist/index.js"]` | Uses `setActiveTools`, `ctx.ui.custom()`, `.pi/plans`, and terminal editor spawning | **Native load only with UI adapter**; RPC-safe UI calls are covered, while OpenBuddy plan state remains canonical and terminal editor behavior still needs an adapter. |
| `pi-interactive-shell` | ecosystem candidate | not verified here | Full-screen terminal interaction | **Do not load** without an explicit WorkBuddy terminal surface. |

### 2026-08-29 real profile verification

The opt-in `OPENBUDDY_REAL_PI_E2E=1` profile test now installs exact versions into an isolated temporary profile and verifies the complete Pi resource lifecycle: package installation, `DefaultResourceLoader.reload()`, `AgentSession.bindExtensions()`, command/tool discovery, session reload, and package removal. The verified set is:

| Package | Version | Verified surface | Result |
| --- | --- | --- | --- |
| `pi-context-prune` | `1.3.0` | extension, tools, reload | passed |
| `pi-mcp-adapter` | `2.31.0` | extension, MCP stdio tool, reload | passed |
| `pi-web-access` | `0.27.0` | extension, commands, reload | passed |
| `pi-goal` | `0.1.7` | extension, goal tools, reload | passed |
| `pi-plan-mode` | `0.4.8` | extension, command, reload | passed |
| `pi-subagents` | `0.59.0` | extension, skills, prompts, reload | passed |
| `pi-lens` | `4.1.3` | bundled extension, `lens-*` commands, skills, reload | passed |
| `pi-hermes-memory` | `0.9.7` | TypeScript extension, memory commands/tools, reload, removal | passed |

`pi-lens` publishes a bundled `dist/index.js` and a `skills/` directory. Its manifest's relative skill entry is stale in the published package, so OpenBuddy ignores missing declared entries and falls back to the package's conventional `skills/` directory when it exists. This is implemented generically in profile resource discovery, not as a package-specific exception. `pi-hermes-memory` uses `better-sqlite3` and shutdown child-model flushing; the verification fixture disables only those model-dependent flush/review options in its isolated agent directory, while still exercising its SQLite-backed extension load and tools. Production users retain the package's documented defaults.

### Compatibility levels

- **Native load** means Pi can discover the package from its published `pi.extensions` manifest and OpenBuddy can resolve its runtime dependencies from the profile/host graph. It does not promise identical terminal UI.
- **Optional native load** means the extension's core hooks are compatible, but interactive commands require an RPC-safe `select`/`input`/`editor` fallback before product enablement.
- **Adapter-only** means the extension overlaps an existing OpenBuddy capability owner and is not executed as a second backend.
- **Adapter-backed** means the package declaration is accepted, exposed in the Pi inventory, and projected to the named OpenBuddy capability owner. The adapter factory also registers slash commands with the same names as the third-party package (`/mcp`, `/mcp-auth`, `/websearch`, `/permission-system`, etc.); the command handlers delegate to the canonical OpenBuddy service via `options.resolveService(owner)` and surface results through `ctx.ui.notify`. The published third-party module itself is not imported.
- Every profile-installed third-party package remains opt-in, exact-version reviewed, and visible in the Pi inventory. OpenBuddy never silently installs a registry package.

| `pi-subagents` / `@tintinweb/pi-subagents` / `pi-subagent` | various | Pi package metadata published | Single-agent delegation, multi-agent scripting, depth-controlled subagents | **Adapter-backed**: OpenBuddy registers `/subagent` and `/subagents` on Pi and projects them onto the `openbuddy-subagent` service. |
| `pi-hermes-memory` / `@remnic/plugin-pi` | various | Pi package metadata published | Persistent memory, session search, secret scanning | **Adapter-backed**: OpenBuddy registers `/memory` on Pi and projects it onto the `openbuddy-memory` service. |
| `pi-goal` / `pi-goal-x` / `@narumitw/pi-goal` | various | Pi package metadata published | Autonomous single-objective goal completion, loop audit | **Adapter-backed**: OpenBuddy registers `/goal` on Pi and projects it onto the `openbuddy-team` runner. |
| `pi-plan-mode` / `@narumitw/pi-plan-mode` / `@arvoretech/pi-plan-mode` / `@plannotator/pi-extension` | various | `pi.extensions` and package metadata published | Read-only plan collaboration, plan annotation, plan review | **Adapter-backed**: OpenBuddy registers `/plan` on Pi and projects it onto the `openbuddy-plan` service. |
| `pi-todo` / `pi-tasks` / `pi-tasklist` / `@narumitw/pi-todo` / `@anthropic/pi-todo` | various | Pi package metadata published | Per-session task tracking, CRUD task list, structured progress | **Adapter-backed**: OpenBuddy registers `/tasks` and `/todo` on Pi and projects them onto the `openbuddy-task` service. |
| `pi-automation` / `pi-workflow` / `pi-cron` / `pi-schedule` / `@anthropic/pi-automation` | various | Pi package metadata published | Scheduled automation, cron workflows, lifecycle pause/resume | **Adapter-backed**: OpenBuddy registers `/automation` and `/workflow` on Pi and projects them onto the `openbuddy-automation` service. |
| `pi-folder-trust` / `pi-trust` / `pi-security` / `pi-permission-folder` / `@anthropic/pi-folder-trust` | various | Pi package metadata published | Per-folder trust dialogs, grant/revoke/check folders, persistent trusted roots | **Adapter-backed**: OpenBuddy registers `/trust` on Pi and projects it onto the `openbuddy-folder-trust` service. |
| `pi-inspiration` / `pi-prompt-seeds` / `pi-prompts` / `pi-ideas` / `@anthropic/pi-inspiration` | various | Pi package metadata published | Random prompt seeds, build-in catalog, no LLM cost | **Adapter-backed**: OpenBuddy registers `/inspiration` on Pi and projects it onto the `openbuddy-inspiration` service. |
| `pi-notification` / `pi-notifications` / `pi-notify` / `pi-toast` / `@anthropic/pi-notification` | various | Pi package metadata published | Append-only notification log, FIFO cap, mark-read lifecycle | **Adapter-backed**: OpenBuddy registers `/notify` and `/notifications` on Pi and projects them onto the `openbuddy-notification` service. |
| `pi-session` / `pi-sessions` / `pi-history` / `pi-bookmark` / `pi-session-manager` / `@anthropic/pi-session` | various | Pi package metadata published | Session ledger, pin/archive lifecycle, workspace grouping | **Adapter-backed**: OpenBuddy registers `/sessions` and `/history` on Pi and projects them onto the `openbuddy-session` service. |
| `pi-fs` / `pi-filesystem` / `pi-fs-tools` / `pi-file-tools` / `pi-filetree` / `@anthropic/pi-fs` | various | Pi package metadata published | Workspace-scoped filesystem facade, stat/read/list/open/reveal/mkdir verbs | **Adapter-backed**: OpenBuddy registers `/fs` and `/files` on Pi and projects them onto the `openbuddy-fs-local` service. |

### Adapter projection inventory

The compatibility adapter now projects twenty-five slash commands onto Pi (fourteen adapter families: thirteen from the previous seven families, plus `tasks`/`todo` from task, `automation`/`workflow` from automation, `trust` from trust, `inspiration` from inspiration, `notify`/`notifications` from notification, `sessions`/`history` from session, and `fs`/`files` from fs). The static inventory is exported as `describeCompatibilityAdapterCommands()` for documentation and tests; each entry carries `name`, `description`, optional `argumentHint`, and a `describeInvocation(service, args)` delegate that runs against the OpenBuddy canonical service resolved through `options.resolveService`. The service resolver tries `serviceKey` first (e.g. `mcpClient`, `webSearch`, `subagent`) and falls back to `owner` (e.g. `openbuddy-mcp-client`, `openbuddy-subagent`).

| Package family | Capability | OpenBuddy owner | Cordis service key | Projected commands |
| --- | --- | --- | --- | --- |
| `pi-mcp-adapter` | mcp | `openbuddy-mcp-client` | `mcpClient` | `/mcp`, `/pi-mcp`, `/mcp-auth` |
| `pi-web-access` / `@diegopetrucci/pi-web-access` | web | `openbuddy-web-search` | `webSearch` | `/websearch`, `/curator`, `/google-account`, `/search` |
| `pi-permission-system` | permission | `openbuddy-authorization` | `permission` | `/permission-system` |
| `pi-subagents` / `@tintinweb/pi-subagents` / `pi-subagent` | subagent | `openbuddy-subagent` | `subagent` | `/subagent`, `/subagents` |
| `pi-hermes-memory` / `@remnic/plugin-pi` | memory | `openbuddy-memory` | `memory` | `/memory` |
| `pi-goal` / `pi-goal-x` / `@narumitw/pi-goal` | goal | `openbuddy-team` | `team` | `/goal` |
| `pi-plan-mode` / `@narumitw/pi-plan-mode` / `@arvoretech/pi-plan-mode` / `@plannotator/pi-extension` | plan | `openbuddy-plan` | `plan` | `/plan` |
| `pi-todo` / `pi-tasks` / `pi-tasklist` / `@narumitw/pi-todo` / `@anthropic/pi-todo` | task | `openbuddy-task` | `task` | `/tasks`, `/todo` |
| `pi-automation` / `pi-workflow` / `pi-cron` / `pi-schedule` / `@anthropic/pi-automation` | automation | `openbuddy-automation` | `automation` | `/automation`, `/workflow` |
| `pi-folder-trust` / `pi-trust` / `pi-security` / `pi-permission-folder` / `@anthropic/pi-folder-trust` | trust | `openbuddy-folder-trust` | `folder-trust` | `/trust` |
| `pi-inspiration` / `pi-prompt-seeds` / `pi-prompts` / `pi-ideas` / `@anthropic/pi-inspiration` | inspiration | `openbuddy-inspiration` | `inspiration` | `/inspiration` |
| `pi-notification` / `pi-notifications` / `pi-notify` / `pi-toast` / `@anthropic/pi-notification` | notification | `openbuddy-notification` | `notification` | `/notify`, `/notifications` |
| `pi-session` / `pi-sessions` / `pi-history` / `pi-bookmark` / `pi-session-manager` / `@anthropic/pi-session` | session | `openbuddy-session` | `sessions` | `/sessions`, `/history` |
| `pi-fs` / `pi-filesystem` / `pi-fs-tools` / `pi-file-tools` / `pi-filetree` / `@anthropic/pi-fs` | fs | `openbuddy-fs-local` | `fsLocal` | `/fs`, `/files` |

The official Pi examples also provide reusable patterns for protected paths, git checkpoints, handoff, custom compaction, provider payloads, dynamic tools, file triggers, status lines, and session persistence. The implementation should reuse those patterns while replacing terminal-only UI calls with OpenBuddy IPC/UI contributions.

## Loading and lifecycle rules

1. Resolve profile declarations before creating `AgentSession`.
2. Resolve package sources from the profile `package.json`, not the host's current working directory.
3. Keep `openbuddy-pi-tools` first so Cordis capability tools remain available to Pi extensions.
4. Treat disabled, unresolved, and Pi factory-load failures as observable `pi/extension-*` events; do not silently continue.
5. On profile reload, re-materialize extension declarations and call Pi `session.reload()` after the Cordis profile is replaced.
6. Never pass renderer objects, Electron handles, secrets, or live `AbortSignal` instances through structured-cloned plugin payloads.
7. Third-party extensions must be exact-version pinned, license-checked, and reviewed for terminal assumptions before enabling.
8. A subagent uses the same approved extension set only when the extension is deterministic and headless-safe; UI-only extensions stay in the primary session.
9. Profile package installation is local-copy based, does not execute package lifecycle scripts, and materializes dependencies already resolvable from the source package, the selected profile, or explicit anchors.
10. Treat `pi.registerProvider` / native provider registration as a first-class profile capability: capture the pending extension path before binding drains it, expose only non-secret attribution metadata, and remove provider rows atomically when the owning Pi profile is reloaded. Missing direct dependencies fail before activation; optional and unresolved peer dependencies may be left for the host compatibility layer.

## Dynamic loading semantics

Pi's dynamic model is a transactional resource reload, not independent hot-plugging of one extension instance:

1. `DefaultResourceLoader.reload()` reloads settings/package sources, clears the extension module cache, resolves enabled paths, loads path extensions and inline factories, and records per-path errors.
2. `AgentSession.reload()` first emits `session_shutdown`, invalidates the old extension runner and all captured extension contexts, reloads the resource loader, builds a new runner, then emits `session_start` with `reason: "reload"` and re-discovers resources.
3. Pi's extension docs explicitly require code after `ctx.reload()` to treat the old context as stale; reload handlers should return immediately after awaiting reload.
4. Project-local extensions are gated by Pi's project-trust pass. OpenBuddy profile extensions are resolved from the trusted profile package anchor instead of implicitly loading arbitrary project-local code.
5. Extension factory failures do not abort the whole resource load; Pi returns `LoadExtensionsResult.errors`. OpenBuddy promotes those errors to `pi/extension-failed` and the unified plugin inventory.

OpenBuddy therefore exposes one safe operation for Pi extensions: update the profile/override declaration, wait for an idle session, and invoke the native `session.reload()` transaction. Cordis plugin enable/reload remains independently reversible because its loader owns per-fiber lifecycle. The two systems share profile persistence, event logging, IPC, DeepSeek inventory, and renderer observation, but do not pretend that Pi supports per-extension hot-unload.

### OpenBuddy dynamic-loading contract

The two runtimes use different reload units and must not be collapsed into one generic hot-loader:

| Surface | Discovery unit | Reload unit | Failure behavior |
| --- | --- | --- | --- |
| Pi | `DefaultResourceLoader` paths, package manifests, and trusted project/global locations | Whole `AgentSession` extension runner | Keep diagnostics in the resource result; stale extension contexts are invalidated |
| Main Cordis/Harness | Profile bundle entries and patch layers | Individual plugin fiber or profile transaction | Loader rollback restores affected fibers |
| Renderer `dsh.client` | Installed package metadata plus `exports["./client"]` | Entire dependency-ordered client graph | Validate the new graph first; on load failure restore the previous graph and boot globals |

Renderer client graphs have explicit ownership: replacing a graph disposes the previous `ClientModuleSystem`, including module-owned styles and cached factories; a failed candidate graph is disposed before the previous graph is restored.

Renderer graph reload is intentionally cache-busted, but it is not an implicit remote-code fetch. Main resolves only installed profile packages and approved built-in aliases; the renderer receives controlled `file:` module URLs. A profile change therefore follows this sequence:

1. Re-materialize the profile and discover the next client manifest.
2. Validate external dependencies, self-requests, cycles, and module URLs before starting the new graph.
3. Keep the old graph and `__ModuleLoader__`/`__DSH_BOOT__` projections until the new graph and its immediate modules load successfully.
4. Remove and load renderer fibers only after validation; if any step fails, restore the old graph, globals, and discovered entries atomically.
5. Emit `profile/reload-failed` or `renderer/profile-reload-failed` without destroying a previously working UI.

This gives OpenBuddy dynamic Pi loading without claiming that Pi extensions are independently unloadable. Pi remains the source of truth for agent-runtime extension lifecycle; Harness remains the source of truth for composable services; the browser graph remains a compatibility boundary for DeepSeek-style client packages.

## Unified inventory

`agent:plugin-inventory` is the authoritative OpenBuddy projection for runtime plugins and installed package capabilities:

```ts
{
  entries: CordisPluginStatus[];
  piExtensions: PiExtensionStatus[];
  renderers: RendererPluginManifestEntry[];
  packages: ProfilePackageInfo[];
}
```

The WorkBuddy plugin panel consumes this projection directly. `packages` is the installed profile-package capability index: each row records whether the package contributes a bundle, Renderer client, Pi resource, generated Remote face, or generated Typert host face. The DeepSeek host runner exposes the same Pi/Cordis/package rows plus renderer entries, while the legacy `agent:plugin-list` endpoint remains Cordis-only for older callers. Renderer entries are discovered from `dsh.client` or `openbuddy.client` package metadata and are loaded through the existing dependency-ordered browser boot graph.

The browser module graph follows Harness's fail-loud contract: a declared `external` request must resolve to either a static shared module or another discovered client package, and self-requests/cycles are rejected before a bundle is loaded. A client declaration without `exports["./client"]` is also rejected during manifest discovery instead of producing a partially bootable row. Pi's native skills, prompt templates, and themes are exposed through `agent:resource-inventory` as resource data and diagnostics; they remain owned by Pi's `DefaultResourceLoader`, not by the Cordis plugin list.

Generated Harness Remote artifacts are handled at the IPC boundary rather than by sending live schema objects through Electron. Harness's generated `TYPERT_REMOTE` descriptors may contain Zod v4 runtime codecs; OpenBuddy converts supported Zod definitions into a validated, structured-clone-safe `RemoteSchema` AST before Main registration and Renderer registration. Main and Renderer then validate the same AST independently. Unsupported or non-wire-safe schemas fail loudly with the package/descriptor path; they are not silently downgraded to `src-json`.

Packages that publish `exports["./remote"]` are discovered independently of Cordis bundle entries. Main imports the generated artifact from the profile package graph, verifies `TYPERT_REMOTE.package`, serializes its descriptors, and owns registration in `RemoteDispatcher`. Renderer receives only the serialized contribution and installs a local client projection; profile reload reconciles additions/removals transactionally and leaves built-in remotes untouched. This mirrors Harness's explicit gateway imports while allowing OpenBuddy profiles to add generated remotes without a hand-maintained package list.

The remaining transport parity work is intentionally explicit: signed cross-process resume tokens, durable replay across Main restarts, and the full Typert authority/claim/interceptor transaction model are not implied by the loopback carrier and remain separate follow-up milestones. The carrier now supports both WebSocket downlinks and opt-in SSE GET streams; the current cursor is a monotonic in-process sequence, while the per-process bearer token binds the carrier to the current Electron Main instance.

## Provider registration and model attribution

Pi extensions can extend the model surface at runtime with `pi.registerProvider(name, config)` or the native-provider overload. The native Pi runtime correctly applies these registrations to `ModelRuntime`, but its pending registration queue is drained during `AgentSession.bindExtensions()`; after that point a generic provider catalog cannot tell which profile package introduced a provider.

OpenBuddy keeps that attribution explicit:

1. During `initialize()`, OpenBuddy wraps the active `ModelRuntime` registration methods with `installProviderRegistryTracker()`.
2. Before `bindExtensions()` drains Pi's queue, OpenBuddy snapshots `resourceLoader.getExtensions().runtime.pendingProviderRegistrations`, preserving `extensionPath` for each registration.
3. The runtime wrapper records live additions/removals and emits `plugin/provider-registry-changed` through the existing Harness-style plugin event stream.
4. `agent:plugin-inventory` exposes `providers[]` with `id`, `source` (`pi-extension`, `user-config`, or `builtin`), and optional `extensionPath`; `providerCatalog()` uses the same source projection for the settings UI.
5. Re-registering an existing provider preserves its prior extension path; unregistering removes its attribution. Reinitializing a session clears the old runtime map and rebuilds it from the new profile, preventing stale providers after profile replacement.

This is intentionally host-side metadata: secrets and provider credentials never cross the plugin inventory boundary. The provider remains owned and executed by Pi's `ModelRuntime`; OpenBuddy only makes the origin, lifecycle, and UI observability explicit.

Packages that publish `exports["./typert"]` are loaded into the Main-side Typert registry as host-face contributions. OpenBuddy retains generated schemas, package reflection, local invocation descriptors, `hasSeen` withdrawal history, and lookup/context registries; generated invocations are also projected to the existing Remote dispatcher when no separate `./remote` artifact is present. A package with schemas but no invocations is valid and is not forced through the Remote dispatcher.

Generated Main artifacts are imported with a profile-reload generation query so a replaced `file:` module cannot be served from Node's ESM module cache. The reconciliation test fixture installs an actual package with `exports["./typert"]` and `exports["./remote"]`, dynamically imports both generated-like files, validates Zod v4 codecs, invokes the Main Remote dispatcher, mounts the serialized contribution through the Renderer client, and verifies package removal.

Pi extensions discovered by Pi itself from `~/.pi/agent/extensions`, trusted project `.pi/extensions`, or Pi package settings are also projected when the ResourceLoader reports them. These rows are marked `managed: false`: they remain observable but cannot be changed through OpenBuddy's profile override IPC. Profile-declared extensions are `managed: true` and support the existing enable/config/reset flow.

### Unified readiness observation

OpenBuddy exposes a versioned `plugin/readiness` snapshot across Main, preload, and Renderer. It combines Cordis/Harness entry counts with Pi ResourceLoader extension counts and reports `idle`, `loading`, `ready`, `degraded`, or `failed`. Profile/plugin transactions include a generation and transaction identity, so the UI and third-party renderer plugins can distinguish a completed reload from a still-running Pi `AgentSession.reload()` instead of inferring readiness from one `plugin/loaded` event.

The snapshot is available through `agent:plugin-readiness`, is included in `capability.snapshot.pluginReadiness`, and is replayed on the existing `openbuddy://plugin-event` / Harness carrier as `plugin/readiness`.

### Unified cross-surface plugin snapshot

Readiness answers whether the current reload phase has settled; it does not prove that every profile package has all of its declared faces. OpenBuddy therefore exposes a versioned `plugin.snapshot` contract built from the ordered profile package inventory. Each package records its expected and loaded `bundle`, `pi`, `renderer`, `remote`, and `typert` surfaces, plus missing faces and package health. The snapshot also aggregates per-surface counts and a serializable `consistency` result with actionable issue strings.

Main publishes the snapshot through `agent:plugin-snapshot` and the typed `plugin.snapshot` RPC, while the preload bridge and Renderer runtime expose the same object. Snapshot updates use the existing `plugin/snapshot` event carrier, so WorkBuddy UI and third-party Harness-style client modules observe the same generation and cross-face state. A package is not considered complete merely because it was discovered: every declared face must be loaded, and failed readiness or degraded Pi extensions keep consistency incomplete.

The WorkBuddy plugin panel also exposes the resolved profile package name for each Pi extension when its `sourceBaseDir` is inside the installed profile graph. This keeps bundled extensions such as `pi-lens` and `pi-hermes-memory` traceable from runtime command/tool counts back to the package that supplied them, without exposing package secrets or requiring the renderer to resolve filesystem paths.

WebSearch's host policy is now a shared cross-surface configuration: the Cordis service enforces `allowedHosts` / `blockedHosts` before every search or fetch, the Main IPC validates arrays and persists the configuration, and the Settings panel edits the same runtime object. An empty allowlist means unrestricted hosts; blocked hosts win; only `http:` and `https:` are accepted.

## Recommended adoption order

1. Run `pi-context-prune` against session replay/compaction tests now that the RPC-safe UI fallback is covered by a real Pi session fixture.
2. Exercise the MCP adapter against a real profile-installed `pi-mcp-adapter` package and verify tool/authorization lifecycle parity.
3. Exercise the Web adapter against a real profile-installed `pi-web-access` package and verify search/fetch event parity.
4. Add session/team adapters for messenger/intercom semantics, with path reservations and cancellation owned by OpenBuddy.
5. Add review-loop orchestration after task/team lifecycle events have a stable renderer contract.

The current implementation intentionally stops at the registry and adapter seam; it does not silently install third-party packages or run duplicate capability backends.

The base profile now registers `web_search` and `web_fetch` as Pi tools through that Web adapter. Both tools call the mounted `webSearch` service, so the renderer's configuration, enablement state, endpoint policy, and event stream remain the single source of truth.
