# OpenBuddy packages — capability seams

Mirrors [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)'s
package layout. Each package is a Cordis plugin authored as a `Service` subclass
with typed declaration merging into `@openbuddy/cordis` — see
[`docs/full-pluginization-plan.md`](../docs/full-pluginization-plan.md).

## Group index

| Group         | Purpose                                                            |
| ------------- | ------------------------------------------------------------------ |
| `core/`       | Session, agent loop, system prompt, tools, scope — product spine. |
| `capability/` | Notification, memory, task, plan, automation, web search, etc.    |
| `fs/`         | Filesystem capability seam (definition + local provider + policy).|
| `shell/`      | Bash capability seam.                                              |
| `skill/`      | Skill registry + filesystem provider.                              |
| `mcp/`        | MCP client.                                                        |
| `llm/`        | LLM stream + Pi SDK adapter (`openbuddy-pi-bridge`).               |
| `team/`       | Subagent orchestration.                                            |
| `auth/`       | Permission, credentials.                                           |
| `session/`    | Persistence, titles, telemetry.                                    |
| `runtime/`    | Cordis host, IPC, event bus.                                       |
| `renderer/`   | Renderer-side Cordis host + window.api shape.                      |
| `bundle/`     | `cordis.yml` patch-layer bundles (base, desktop, headless).        |
| `boot/`       | Application boot glue (`dsh boot` analogue).                       |

## Conventions

- Package name: `@openbuddy/<group>-<name>` (e.g. `@openbuddy/core-session`)
- ESM only (`"type": "module"`)
- Extends [`./tsconfig.base.json`](./tsconfig.base.json)
- `src/index.ts` is the public surface; declare module `@openbuddy/cordis`
  inside it to type `ctx.<service>` and `Events`
- A plugin must be reversible — registrations go through `ctx.effect()` or
  `ctx.on()`