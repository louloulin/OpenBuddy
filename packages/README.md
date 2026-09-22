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

## 未接线包（NOT WIRED）

以下包**没有外部消费者**：全仓只被它们自身的文档注释提及，没有任何调用方
`import` 它们。这类包此前因 `pnpm-workspace.yaml` 的 glob 写成
`packages/<name>/*`（只匹配子目录，如 `src`）而**连 workspace 成员都不是**；
glob 已修正为裸目录名，因此它们现在是正式 workspace 成员、可被 typecheck/test，
但**仍未接线**。

| 包                     | 行数  | 状态                             |
| ---------------------- | ----: | -------------------------------- |
| `@openbuddy/payment`   | 1,214 | 未接线（企业计费路线图资产）     |
| `@openbuddy/saml`      |   355 | 未接线（企业 SSO 路线图资产）    |
| `@openbuddy/scim`      |   379 | 未接线（企业 IdP 自动配置资产）  |
| `@openbuddy/webhook-outbox` |   426 | 未接线（webhook 持久化重试资产） |

接线时请同步删除本表对应行与该包 `src/index.ts` 头部的 `NOT WIRED` 标注。

## Conventions

- Package name: `@openbuddy/<group>-<name>` (e.g. `@openbuddy/core-session`)
- ESM only (`"type": "module"`)
- Extends [`./tsconfig.base.json`](./tsconfig.base.json)
- `src/index.ts` is the public surface; declare module `@openbuddy/cordis`
  inside it to type `ctx.<service>` and `Events`
- A plugin must be reversible — registrations go through `ctx.effect()` or
  `ctx.on()`