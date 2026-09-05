# Examples & Showcase

> 🌐 **Language / 语言:** [English](#english) · [简体中文](#简体中文)

A curated list of plugins, integrations, and projects built with OpenBuddy. **Want to add yours?** Open a PR editing this file.

---

<a id="english"></a>
## 🇬🇧 English

### Official packages

These are maintained by the OpenBuddy core team.

#### Capabilities

| Package | What it does |
|---|---|
| `@openbuddy/capability-plan` | Plan mode + plan approval UI |
| `@openbuddy/capability-task` | Sub-agent task spawning & lifecycle |
| `@openbuddy/capability-automation` | Local scheduler for recurring agent runs |
| `@openbuddy/capability-web-search` | Provider-pluggable web search |
| `@openbuddy/capability-inspiration` | Prompt templates & starters |
| `@openbuddy/capability-email` | IMAP/SMTP + Gmail/Graph/JMAP API |
| `@openbuddy/capability-calendar` | Calendar integration |
| `@openbuddy/capability-folder-trust` | Per-folder permission grants |

See [`openbuddy-capability-matrix.md`](openbuddy-capability-matrix.md) for the full list.

#### UI primitives

19 packages under `packages/ui/openbuddy-ui-*` — see [`PLUGIN_DEVELOPMENT.md`](PLUGIN_DEVELOPMENT.md).

#### Enterprise

| Package | What it does |
|---|---|
| `@openbuddy/auth-casdoor` | Casdoor OIDC + admin REST |
| `@openbuddy/auth-permission` | Permission prompts & policy UI |
| `@openbuddy/payment` | Stripe / WeChat Pay / Alipay / HMAC adapters |
| `@openbuddy/saml` | SAML 2.0 primitives |
| `@openbuddy/scim` | SCIM v2 endpoints (RFC 7644) |
| `@openbuddy/webhook-outbox` | Transactional outbox + retry/backoff |

#### Apps

| App | What it is |
|---|---|
| `apps/admin-portal` | Web admin SPA (Casdoor OIDC + Resource Gateway) |
| `services/casdoor-resource-gateway` | Billing + admin REST backend |

### Community plugins

> These are not yet published. Once the public marketplace ships in v0.17, they'll live at <https://openbuddy.dev/marketplace>.

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

### Integration examples

#### OpenBuddy + Slack notifications

Send a Slack notification when a long-running task finishes:

```typescript
import { automation, notification } from "@openbuddy/cordis";
import { WebClient } from "@slack/web-api";

const slack = new WebClient(process.env.SLACK_TOKEN);

automation.on("task:completed", async (task) => {
  if (task.duration > 5 * 60 * 1000) {
    await slack.chat.postMessage({
      channel: "#openbuddy",
      text: `✅ Task "${task.name}" finished in ${task.duration / 1000}s`,
    });
  }
});
```

#### OpenBuddy + GitHub Issues

Auto-create a GitHub issue when an agent hits an error:

```typescript
import { Octokit } from "@octokit/rest";
import { agent } from "@openbuddy/agent";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

agent.on("agent:error", async ({ sessionId, error }) => {
  if (error.severity === "critical") {
    await octokit.issues.create({
      owner: "your-org",
      repo: "your-repo",
      title: `OpenBuddy agent error in session ${sessionId}`,
      body: `\`\`\`\n${error.stack}\n\`\`\``,
      labels: ["bug", "openbuddy"],
    });
  }
});
```

#### OpenBuddy + Postgres

Stream events to Postgres for analytics:

```typescript
import { Pool } from "pg";
import { agent } from "@openbuddy/agent";

const pool = new Pool({ connection:String: process.env.DATABASE_URL });

agent.on("agent:*", async (event) => {
  await pool.query(
    "INSERT INTO openbuddy_events (ts, session_id, type, payload) VALUES ($1, $2, $3, $4)",
    [new Date(), event.sessionId, event.type, JSON.stringify(event.payload)]
  );
});
```

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

<a id="简体中文"></a>
## 🇨🇳 简体中文

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

> 这些还未发布。公开市场将在 v0.17 上线,届时会放在 <https://openbuddy.dev/marketplace>。

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
