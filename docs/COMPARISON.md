# OpenBuddy vs Peer AI Tools

> 🌐 **Language / 语言:** [English](#english) · [简体中文](#简体中文)

A side-by-side comparison of OpenBuddy against the most popular AI coding / agent tools. Every row is something we can publicly substantiate — see linked docs for evidence.

---

<a id="english"></a>
## 🇬🇧 English

### TL;DR

| Tool | Form factor | Primary use | Open source | License |
|---|---|---|---|---|
| **OpenBuddy** | Desktop (Electron) | AI workspace + coding | ✅ | MIT |
| [Cursor](https://cursor.sh/) | IDE fork | AI code editor | ❌ | Proprietary |
| [Windsurf](https://codeium.com/windsurf) | IDE fork | AI code editor | ❌ | Proprietary |
| [Continue](https://www.continue.dev/) | VS Code / JetBrains plugin | AI code assistant | ✅ | Apache 2.0 |
| [Cody](https://sourcegraph.com/cody) | VS Code / JetBrains plugin | AI code assistant | ✅ (client) | Apache 2.0 |
| [aider](https://aider.chat/) | CLI | AI pair programming | ✅ | Apache 2.0 |
| [GitHub Copilot](https://github.com/features/copilot) | Editor plugin | AI code completion | ❌ | Proprietary |
| [Tabnine](https://www.tabnine.com/) | Editor plugin | AI code completion | ❌ | Proprietary |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | CLI | AI coding agent | ❌ | Proprietary |
| [OpenHands](https://www.all-hands.dev/) | CLI / Web | Autonomous coding agent | ✅ | MIT |
| [Zed](https://zed.dev/) | Standalone editor | AI-assisted editor | ✅ | GPL/AGPL/Apache |

### Feature comparison

#### Core capabilities

| Feature | OpenBuddy | Cursor | Continue | aider | Copilot | Claude Code |
|---|---|---|---|---|---|---|
| Local desktop app | ✅ Electron | ❌ cloud IDE | ❌ editor plugin | ❌ CLI | ❌ plugin | ❌ CLI |
| Open source | ✅ MIT | ❌ | ✅ Apache 2.0 | ✅ Apache 2.0 | ❌ | ❌ |
| Self-hostable LLM | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| BYOK (any provider) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ Anthropic only |
| Multi-provider router | ✅ NewAPI | ❌ | partial | partial | ❌ | ❌ |
| Plan mode | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Rewind & fork | ✅ | partial | ❌ | ❌ | ❌ | ❌ |
| Sub-agents / tasks | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Skills / plugins | ✅ open catalog | ❌ | ❌ | ❌ | ❌ | ❌ |
| MCP support | ✅ | ✅ | ✅ | partial | partial | ✅ |
| Persistent memory | ✅ | ✅ | partial | ❌ | ❌ | ❌ |
| Automation / scheduling | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Notification center | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Slash commands | ✅ | ✅ | partial | ✅ | ❌ | ✅ |
| Multi-agent teams | ✅ rooms + A2A | ❌ | ❌ | ❌ | ❌ | ❌ |
| Local audit ledger | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

#### Enterprise & ops

| Feature | OpenBuddy | Cursor | Continue | aider | Copilot | Claude Code |
|---|---|---|---|---|---|---|
| OIDC SSO (Casdoor) | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| SAML 2.0 | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| SCIM v2 provisioning | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| Self-hosted gateway (NewAPI) | ✅ | ❌ | partial | ❌ | ❌ | ❌ |
| Payment integrations | ✅ 4 channels | ❌ | ❌ | ❌ | ❌ | ❌ |
| Webhook outbox | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Web admin portal | ✅ separate SPA | partial | ❌ | ❌ | partial | ❌ |
| Tenant policy | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| Audit log shipping | ✅ | partial | ❌ | ❌ | ✅ | ❌ |

#### Developer experience

| Feature | OpenBuddy | Cursor | Continue | aider | Copilot | Claude Code |
|---|---|---|---|---|---|---|
| First-class monorepo tool | ✅ moon 2.5 | ❌ | ❌ | ❌ | ❌ | ❌ |
| Cross-platform desktop | ✅ Win/macOS/Linux | ❌ | n/a | n/a | n/a | n/a |
| Native installers | ✅ NSIS/MSI/DMG/AppImage | n/a | n/a | n/a | n/a | n/a |
| Auto-updater | ✅ electron-updater | ✅ | ❌ | ❌ | ✅ | ❌ |
| Plugin SDK | ✅ Cordis | ❌ | ❌ | ❌ | ❌ | ❌ |
| Hot-reload plugins | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Open test suite | ✅ 309 test files | ❌ | ✅ | ✅ | ❌ | ❌ |
| Open evaluation suite | ✅ GAIA-style | ❌ | partial | ✅ | ❌ | ❌ |

### What OpenBuddy is best at

1. **Enterprise AI workspaces.** Casdoor OIDC + NewAPI gateway + 4 payment adapters + SCIM v2 + SAML 2.0 + transactional outbox — out of the box.
2. **Plugin / capability ecosystem.** A 30+ package Cordis mesh any contributor can extend, with a runtime plugin loader for hot-install.
3. **Multi-agent.** Full A2A protocol, rooms, inbox, task graph, evidence audit. The only open-source desktop tool with a complete multi-agent runtime.
4. **Open the whole stack.** MIT license, 309 visible test files, GAIA-style eval harness, monorepo tooling — every byte auditable.
5. **WorkBuddy parity.** Pixel-close UI without vendor lock-in.

### What we're not (yet)

- ❌ **Not an IDE replacement.** OpenBuddy is a chat workspace that *integrates with* your editor, not a VS Code fork. If you want in-editor AI, use [Continue](https://www.continue.dev/).
- ❌ **Not a CLI tool.** OpenBuddy is desktop-first. For CLI pair programming, use [aider](https://aider.chat/) or [Claude Code](https://docs.anthropic.com/en/docs/claude-code).
- ❌ **Not a code-only tool.** OpenBuddy handles email, calendar, files, web — it's a workspace, not a code editor.

### When to use what

| You want to… | Use |
|---|---|
| Edit code with AI inline in your existing IDE | [Continue](https://www.continue.dev/) / [Copilot](https://github.com/features/copilot) |
| Pair-program from the terminal | [aider](https://aider.chat/) / [Claude Code](https://docs.anthropic.com/en/docs/claude-code) |
| Run autonomous coding tasks | [OpenHands](https://www.all-hands.dev/) |
| Replace your IDE with AI at the core | [Cursor](https://cursor.sh/) / [Windsurf](https://codeium.com/windsurf) |
| **Build a full AI workspace that owns files, email, calendar, agents, and integrates with enterprise SSO** | **OpenBuddy** |

### Sources

- OpenBuddy features: [`workbuddy-parity-matrix.md`](workbuddy-parity-matrix.md), [`openbuddy-capability-matrix.md`](openbuddy-capability-matrix.md)
- Cursor features: <https://cursor.sh/features>
- Continue features: <https://docs.continue.dev/>
- aider features: <https://aider.chat/docs/features>
- Copilot features: <https://github.com/features/copilot>
- Claude Code features: <https://docs.anthropic.com/en/docs/claude-code>
- OpenHands features: <https://docs.all-hands.dev/>

Last verified: 2026-09-01. If you spot a stale claim, open an issue labeled `docs`.

---

<a id="简体中文"></a>
## 🇨🇳 简体中文

### 一句话总结

| 工具 | 形态 | 主要用途 | 开源 | 许可证 |
|---|---|---|---|---|
| **OpenBuddy** | 桌面(Electron) | AI 工作台 + 编程 | ✅ | MIT |
| [Cursor](https://cursor.sh/) | IDE fork | AI 代码编辑器 | ❌ | 专有 |
| [Windsurf](https://codeium.com/windsurf) | IDE fork | AI 代码编辑器 | ❌ | 专有 |
| [Continue](https://www.continue.dev/) | VS Code / JetBrains 插件 | AI 代码助手 | ✅ | Apache 2.0 |
| [Cody](https://sourcegraph.com/cody) | VS Code / JetBrains 插件 | AI 代码助手 | ✅(客户端) | Apache 2.0 |
| [aider](https://aider.chat/) | 命令行 | AI 结对编程 | ✅ | Apache 2.0 |
| [GitHub Copilot](https://github.com/features/copilot) | 编辑器插件 | AI 代码补全 | ❌ | 专有 |
| [Tabnine](https://www.tabnine.com/) | 编辑器插件 | AI 代码补全 | ❌ | 专有 |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | 命令行 | AI 编程 agent | ❌ | 专有 |
| [OpenHands](https://www.all-hands.dev/) | 命令行 / Web | 自主编程 agent | ✅ | MIT |
| [Zed](https://zed.dev/) | 独立编辑器 | AI 辅助编辑器 | ✅ | GPL/AGPL/Apache |

(完整对比表与英文版相同,见上方。)

### OpenBuddy 最强的地方

1. **企业 AI 工作台**。Casdoor OIDC + NewAPI 网关 + 4 个支付适配器 + SCIM v2 + SAML 2.0 + 事务性 Outbox——开箱即用。
2. **插件 / 能力生态**。30+ 包 Cordis 网格,任何贡献者可扩展,带运行时热加载。
3. **多 Agent**。完整 A2A 协议、rooms、inbox、任务图、证据审计。唯一带完整多 Agent 运行时的开源桌面工具。
4. **整栈开源**。MIT 许可、309 个可见测试文件、GAIA 风格评测 harness、monorepo 工具——每一字节可审计。
5. **WorkBuddy 兼容**。像素级贴近 UI,但无供应商锁定。

### 我们还不做的

- ❌ **不替代 IDE**。OpenBuddy 是聊天工作台,*配合* 你的编辑器使用,不是 VS Code fork。要编辑器内 AI?用 [Continue](https://www.continue.dev/)。
- ❌ **不是 CLI 工具**。OpenBuddy 桌面优先。要 CLI 结对编程,用 [aider](https://aider.chat/) 或 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)。
- ❌ **不只面向代码**。OpenBuddy 处理邮件、日历、文件、Web——是工作台,不是代码编辑器。

### 何时用哪个

| 你想…… | 用 |
|---|---|
| 在已有 IDE 内联 AI 编辑代码 | [Continue](https://www.continue.dev/) / [Copilot](https://github.com/features/copilot) |
| 终端结对编程 | [aider](https://aider.chat/) / [Claude Code](https://docs.anthropic.com/en/docs/claude-code) |
| 跑自主编程任务 | [OpenHands](https://www.all-hands.dev/) |
| 把 IDE 替换成 AI 为核心 | [Cursor](https://cursor.sh/) / [Windsurf](https://codeium.com/windsurf) |
| **构建一个拥有文件、邮件、日历、Agent 的完整 AI 工作台,并接入企业 SSO** | **OpenBuddy** |

---

<div align="center">

**Pick the right tool for the job. / 按需选型。**

<sub>发现过时?开 [Issue 标签 `docs`](https://github.com/louloulin/OpenBuddy/issues/new?labels=docs)。</sub>

</div>
