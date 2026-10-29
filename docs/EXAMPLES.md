# Examples & Showcase

A curated list of plugins, integrations, and projects built with OpenBuddy. **Want to add yours?** Open a PR editing this file.

---


### Official packages

These are maintained by the OpenBuddy core team.

#### Capabilities

| Package | What it does |
|---|---|
| `@openbuddy/capability-email` | IMAP/SMTP + Gmail/Graph/JMAP API |
| `@openbuddy/capability-calendar` | Calendar integration |
| `@openbuddy/capability-mcp-client` | MCP connector governance |
| `@openbuddy/capability-authorization` | Capability-level authorization gate |
| `@openbuddy/folder-trust` | Per-folder permission grants |

> Plan mode, sub-agent tasks, local automations and web search are **Pi
> extensions** (`electron/main/agent/pi-extensions.ts`), not packages. The
> `@openbuddy/capability-{plan,task,automation,web-search,inspiration}` names
> previously listed here never existed.

See [`openbuddy-capability-matrix.md`](openbuddy-capability-matrix.md) for the full list.

#### UI primitives

36 packages under `packages/ui/openbuddy-ui-*` — see [`PLUGIN_DEVELOPMENT.md`](PLUGIN_DEVELOPMENT.md).

#### Enterprise

| Package | What it does |
|---|---|
| `@openbuddy/auth-casdoor` | Casdoor OIDC + admin REST |
| `@openbuddy/auth-permission` | Permission prompts UI |
| `@openbuddy/auth-policy` | Tenant + capability policy evaluation |
| `@openbuddy/capability-authorization` | Capability-level authorization gate |

#### Apps

| App | What it is |
|---|---|
| `apps/admin-portal` | Web admin SPA (Casdoor OIDC + Resource Gateway) |
| `services/casdoor-resource-gateway` | Billing + admin REST backend |

### Community plugins

> These are not yet published. Once the public marketplace ships in v0.15.0, they'll live at <https://openbuddy.dev/marketplace>.

>>
->
- 🚧 _(empty — be the first!)_

See [`openbuddy-plugin-catalog.md`](openbuddy-plugin-catalog.md) for the catalog schema.

### Built with OpenBuddy

> Apps, integrations, and projects that use OpenBuddy. Not necessarily packaged plugins — could be anything.

| Project | Description | Author | License |
|---|---|---|---|
| _(empty — be the first!)_ | | | |

Add your project by opening a PR with one row in this table. Required columns:

```markdown
| [Project Name](https://github.com/your/project) | One-line description | `@your-handle` | MIT (or whatever) |
```

### Example code

The best way to learn OpenBuddy's extension model is by example. Here are complete, runnable examples.

#### Counter capability

A minimal capability that increments a counter. Full walkthrough in [`PLUGIN_DEVELOPMENT.md`](PLUGIN_DEVELOPMENT.md#step-3--write-the-service).

```typescript
// packages/capability/openbuddy-counter/src/index.ts
import { Context, OpenBuddyService } from "@openbuddy/cordis";

export class CounterService extends OpenBuddyService {
  private count = 0;

  constructor(ctx: Context) {
    super(ctx, "openbuddy.capability.counter");
  }

  get value() { return this.count; }

  increment(by = 1) {
    this.count += by;
    this.ctx.emit("counter:changed", { value: this.count });
    return this.count;
  }
}

export default function apply(ctx: Context) {
  ctx.plugin(CounterService);
}
```

#### Greeting skill

A minimal skill that greets the user.

```markdown
<!-- ~/.config/openbuddy/skills/greet.md -->
---
name: greet
description: Greet the user in their preferred language
triggers:
  - greet me
  - say hello
  - 打个招呼
---

# Greet

When the user says "greet me" or similar:

1. Look at their preferred language (Settings → Locale).
2. Respond with a culturally-appropriate greeting:

   - `en` → "Hello! How can I help you today?"
   - `zh-CN` → "你好!今天有什么可以帮你的?"
   - `ja` → "こんにちは!何をお手伝いしましょうか?"
   - `es` → "¡Hola! ¿En qué puedo ayudarte hoy?"

3. Offer a follow-up: "Want to start a new session, or pick up where you left off?"
```

#### MCP connector

A minimal MCP server config that adds a search tool.

```json
// ~/.config/openbuddy/mcp.json
{
  "servers": {
    "tavily": {
      "command": "npx",
      "args": ["-y", "tavily-mcp"],
      "env": {
        "TAVILY_API_KEY": "tvly-…"
      },
      "auth": "env"
    }
  }
}
```

OpenBuddy will auto-discover this on startup and expose `tavily.search` and `tavily.extract` as tools.

#### Expert definition

A minimal expert that specializes in TypeScript refactoring.

```markdown
<!-- ~/.config/openbuddy/experts/typescript-refactor.md -->
---
name: typescript-refactor
description: Expert in TypeScript refactoring
system_prompt: |
  You are an expert TypeScript refactorer.
  - Prefer readonly over mutability
  - Use Result types over throw
  - Maintain strict mode
  - Add tests with every refactor
---

# TypeScript Refactor Expert

When activated:
- Always check for existing tests before refactoring
- Prefer small, surgical changes
- Run `pnpm workspace:test` after each change
- Update CHANGELOG.md with breaking changes
```

<!-- doc-pkg-claims: allow @openbuddy/agent -->

### Integration examples

> **Corrected 2026-10-29.** The examples previously in this section imported
> `@openbuddy/agent` and `automation` / `notification` from `@openbuddy/cordis`.
> **Neither exists** — there is no `@openbuddy/agent` package, and
> `@openbuddy/cordis` exports only `Context`, `OpenBuddyService`, `Plugin`,
> `brand`, `debug`, `forEach` plus the raw `@cordisjs/core` surface. The old
> snippets could not have compiled. What actually exists is below.

#### Extension point 1 — Pi extensions (agent-facing tools)

Agent tools live in `electron/main/agent/pi-extensions.ts`. Each entry
registers a tool the model can call, and can subscribe to Pi lifecycle events:

```typescript
// electron/main/agent/pi-extensions.ts (shape of a real entry)
{
  name: "openbuddy_plan",
  description: "Enter / exit plan mode for the current session.",
  parameters: { /* JSON schema */ },
  execute: async (args, ctx) => { /* … */ },
  on: {
    context: (payload) => { /* lifecycle hook */ },
  },
}
```

Registered tool names today: `openbuddy_mcp`, `openbuddy_permissions`,
`openbuddy_goals`, `openbuddy_plan`, `openbuddy_sessions`, `openbuddy_fs`,
`openbuddy_lens`, `openbuddy_simplify`, `openbuddy_hashline_edit`,
`openbuddy_worktree`, `openbuddy_automation`.

#### Extension point 2 — Cordis capability packages

A capability is a plain `@openbuddy/*` package exporting `apply(ctx)` plus a
service class — see [`PLUGIN_DEVELOPMENT.md`](PLUGIN_DEVELOPMENT.md) for the
full walkthrough and a working test harness.

#### Extension point 3 — Renderer events (main → UI)

The main process pushes events to the renderer through
`electron/main/agent/host-modules/bootstrap/lifecycle-public.ts`
(`bindRendererEventEmitter` / `emitRendererEvent`). That is the supported way
to surface agent progress in the UI; there is no public `agent.on(...)` API.

### Demos & tutorials

- **[`dialog-preview.html`](../dialog-preview.html)** — interactive demo of the ChatView component
- **[`scripts/electron/real-ui-smoke.mjs`](../scripts/electron/real-ui-smoke.mjs)** — scriptable UI screenshots
- **[`scripts/electron/closed-loop-capability-eval.mjs`](../scripts/electron/closed-loop-capability-eval.mjs)** — end-to-end agent demo

### Add your project

Have you built something with OpenBuddy? Add it to the showcase!

1. Fork the repo.
2. Edit `docs/EXAMPLES.md`.
3. Open a PR with title `docs(examples): add <your project>`.

We'll review within 48 hours and merge if it fits.

---


### 官方包

这些由 OpenBuddy 核心团队维护。

#### 能力

(同英文)

#### UI 基元

`packages/ui/openbuddy-ui-*` 下 19 个包 —— 见 [`PLUGIN_DEVELOPMENT.md`](PLUGIN_DEVELOPMENT.md)。

#### 企业级

(同英文)

#### App

(同英文)

### 社区插件

> 这些还未发布。公开市场将在 v0.15.0 上线,届时会放在 <https://openbuddy.dev/marketplace>。

(表格待填充)

### 用 OpenBuddy 构建的

> 使用 OpenBuddy 的 App、集成与项目。不一定是打包好的插件 —— 可以是任何东西。

(表格待填充)

通过开 PR 加一行来添加你的项目。必填列:

```markdown
| [项目名](https://github.com/your/project) | 一句话描述 | `@你的账号` | MIT(或其他) |
```

### 示例代码

学习 OpenBuddy 扩展模型最好的方式是看示例。

#### Counter 能力

最小能力,自增计数器。完整演练见 [`PLUGIN_DEVELOPMENT.md`](PLUGIN_DEVELOPMENT.md#第-3-步--写服务)。

(代码同英文)

#### 问候 skill

最小 skill,问候用户。

(代码同英文)

#### MCP 连接器

最小 MCP server 配置,加搜索工具。

(代码同英文)

#### Expert 定义

最小 expert,专攻 TypeScript 重构。

(代码同英文)

### 集成示例

#### OpenBuddy + Slack 通知

长任务完成时发 Slack 通知:

(代码同英文)

#### OpenBuddy + GitHub Issues

Agent 出错时自动建 GitHub Issue:

(代码同英文)

#### OpenBuddy + Postgres

事件流到 Postgres 做分析:

(代码同英文)

### Demo 与教程

- **[`dialog-preview.html`](../dialog-preview.html)** —— ChatView 组件交互式 demo
- **[`scripts/electron/real-ui-smoke.mjs`](../scripts/electron/real-ui-smoke.mjs)** —— 可脚本化 UI 截图
- **[`scripts/electron/closed-loop-capability-eval.mjs`](../scripts/electron/closed-loop-capability-eval.mjs)** —— 端到端 agent demo

### 添加你的项目

用 OpenBuddy 做了东西?加到 showcase!

1. Fork 仓库。
2. 编辑 `docs/EXAMPLES.md`。
3. 开 PR,标题 `docs(examples): add <你的项目>`。

我们 48 小时内审,通过即合。

---

<div align="center">

**Built something with OpenBuddy? Show it off. / 用 OpenBuddy 做了东西?亮出来。**

<sub>PR title: `docs(examples): add <name>` · auto-merged if it fits. / PR 标题 `docs(examples): add <name>`,通过即合。</sub>

</div>
