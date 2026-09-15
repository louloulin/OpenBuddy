# Glossary

Terms used across OpenBuddy's docs, code, and UI. Keep this up to date as new concepts emerge.

---

## English

### Core

| Term | Definition |
|---|---|
| **OpenBuddy** | The open-source desktop AI workspace this repo builds. |
| **OpenBuddy Pi** | The full product name, including the underlying Pi agent runtime attribution. |
| **Pi** | The agent runtime that powers OpenBuddy's prompt loop. |
| **Agent** | A Pi-managed entity that owns prompts, tools, permissions, plans, and tasks. |
| **Session** | A single conversation between a user and an agent. |
| **Cordis** | The dependency-injection framework OpenBuddy uses for its capability mesh. |
| **Context (Cordis)** | The shared service registry that all capabilities attach to. |

### Architecture

| Term | Definition |
|---|---|
| **Renderer** | The React + Vite UI process that runs in Electron's BrowserWindow. |
| **Main** | The Electron main process — hosts Cordis and + the IPC surface. |
| **Preload** | The Electron preload script — exposes the allowlisted `window.api` to the renderer. |
| **IPC** | Inter-process communication between renderer and main. OpenBuddy uses allowlisted channels. |
| **contextBridge** | Electron's safe API for exposing preload functions to a sandboxed renderer. |
| **moon** | The monorepo tool that orchestrates all build / test / dev / release tasks. |
| **Vite** | The build tool for the renderer. |
| **electron-vite** | The Vite-based bundler for main + preload + renderer in one orchestration. |

### Capabilities

| Term | Definition |
|---|---|
| **Capability** | A Cordis service that exposes a feature (`@openbuddy/capability-*`). |
| **Plugin** | A runtime-loadable Cordis service from `~/.openbuddy/plugins/` (no rebuild). |
| **Skill** | A Markdown file with YAML frontmatter that teaches the agent a new behavior. |
| **MCP** | Model Context Protocol — the standard for tool integration. |
| **MCP connector** | A registered MCP server, configured in OpenBuddy settings. |
| **Expert** | A persistent agent configuration (system prompt + tools). |
| **Task** | A sub-agent spawned by the main agent. |
| **Team** | A coordinated group of agents with shared rooms and inbox. |
| **Room** | A shared space for cross-agent messages. |
| **Inbox** | A cross-agent message queue. |
| **A2A** | Agent-to-agent — the protocol OpenBuddy uses for inter-agent communication. |

### User-facing features

| Term | Definition |
|---|---|
| **Plan mode** | A mode where the agent plans before executing, with user approval. |
| **Rewind** | Undo the last N steps in a session, optionally forking. |
| **Fork** | Branch a session at a rewind point. |
| **Slash command** | A `/-prefixed` shortcut in the composer (e.g. `/plan`, `/rewind`). |
| **Automation** | A scheduled task that runs the agent on a cron / event trigger. |
| **Notification** | An in-app or OS-level alert about agent activity. |
| **Memory** | Long-term context the agent can recall across sessions. |
| **Web search** | A provider-pluggable way for the agent to look things up online. |
| **Inspiration** | A prompt template / starter for common tasks. |

### Persistence

| Term | Definition |
|---|---|
| **Pi data directory** | Where Pi stores its config (provider keys, etc.). |
| **OpenBuddy data directory** | `~/.config/openbuddy/` on Linux/macOS, `%APPDATA%\openbuddy\` on Windows. |
| **Session JSONL** | Append-only JSON-lines file per session. |
| **Audit ledger** | Append-only, hash-chained log of privileged operations. |
| **Folder trust** | A user-granted permission for the agent to access a folder. |
| **safeStorage** | Electron API for encrypting secrets in the OS keychain. |

### Providers

| Term | Definition |
|---|---|
| **Provider** | An LLM API that OpenBuddy can call (Anthropic, OpenAI, NewAPI, …). |
| **BYOK** | "Bring Your Own Key" — user supplies their own API key. |
| **Service Token** | A server-side token for OpenBuddy to call NewAPI on behalf of a user. |
| **NewAPI** | The self-hosted model aggregator we integrate with. |
| **Anthropic** | Maker of Claude. |
| **OpenAI** | Maker of GPT-4 / o1. |
| **NewAPI channel** | A single LLM provider registered inside a NewAPI instance. |

### Enterprise

| Term | Definition |
|---|---|
| **Casdoor** | The OIDC IdP we ship a full client + admin REST for. |
| **OIDC** | OpenID Connect — the SSO protocol OpenBuddy uses. |
| **PKCE** | Proof Key for Code Exchange — OIDC extension for desktop apps. |
| **SAML** | Security Assertion Markup Language — federation protocol. |
| **SCIM** | System for Cross-domain Identity Management — provisioning protocol. |
| **OIDC tenant** | An isolated Casdoor organization with its own users / policies. |
| **Audit log shipping** | Streaming the audit ledger to a SIEM. |
| **Transactional outbox** | Pattern for at-least-once webhook delivery. |

### Development

| Term | Definition |
|---|---|
| **moon project** | One unit of the monorepo DAG (renderer / Electron / 30+ packages). |
| **moon task** | A script that runs against a project (e.g. `dev`, `build`, `test`). |
| **Vitest** | The test runner. |
| **Playwright** | The browser-automation tool used for Electron smoke tests. |
| **Zustand** | The state-management library for the renderer. |
| **Cordis plugin** | A `Service` subclass that gets injected into a context. |
| **IPC channel** | A named string like `"agent:prompt"` that bridges renderer ↔ main. |

### Build / ship

| Term | Definition |
|---|---|
| **NSIS** | The Windows installer format OpenBuddy uses. |
| **DMG** | The macOS installer format. |
| **AppImage** | The portable Linux installer format. |
| **electron-builder** | The tool that produces cross-platform installers. |
| **electron-updater** | The auto-update library that talks to GitHub Releases. |
| **Notarization** | Apple's process for verifying that a binary is safe to run. |
| **Code signing** | Cryptographically signing a binary to prove its origin. |

---

## 简体中文

### 核心

| 术语 | 定义 |
|---|---|
| **OpenBuddy** | 本仓库构建的开源桌面 AI 工作台。 |
| **OpenBuddy Pi** | 完整产品名称,包含底层 Pi agent runtime 归属。 |
| **Pi** | 驱动 OpenBuddy prompt 循环的 agent runtime。 |
| **Agent** | 由 Pi 管理的实体,拥有 prompt、工具、权限、计划、任务。 |
| **Session** | 用户与 agent 之间的单次对话。 |
| **Cordis** | OpenBuddy 用于能力网格的依赖注入框架。 |
| **Context (Cordis)** | 所有能力挂载的共享服务注册表。 |

### 架构

| 术语 | 定义 |
|---|---|
| **Renderer** | 运行在 Electron BrowserWindow 中的 React + Vite UI 进程。 |
| **Main** | Electron 主进程 —— 承载 Cordis 与 IPC 表面。 |
| **Preload** | Electron preload 脚本 —— 把白名单 `window.api` 暴露给 renderer。 |
| **IPC** | renderer 与 main 之间的进程间通信。OpenBuddy 仅使用白名单通道。 |
| **contextBridge** | Electron 用于把 preload 函数安全暴露给沙箱化 renderer 的 API。 |
| **moon** | 编排所有 build / test / dev / release 任务的 monorepo 工具。 |
| **Vite** | renderer 的构建工具。 |
| **electron-vite** | 一次性编排 main + preload + renderer 的 Vite 打包器。 |

### 能力

| 术语 | 定义 |
|---|---|
| **Capability** | 暴露某项特性的 Cordis 服务(`@openbuddy/capability-*`)。 |
| **Plugin** | 从 `~/.openbuddy/plugins/` 运行时加载的 Cordis 服务(无需重新构建)。 |
| **Skill** | 带 YAML frontmatter 的 Markdown 文件,教会 agent 新行为。 |
| **MCP** | Model Context Protocol —— 工具集成的标准协议。 |
| **MCP connector** | 在 OpenBuddy 设置中注册的 MCP server。 |
| **Expert** | 持久化的 agent 配置(系统 prompt + 工具集)。 |
| **Task** | 由主 agent 创建的子 agent。 |
| **Team** | 共享房间与收件箱的协同 agent 组。 |
| **Room** | 跨 agent 消息的共享空间。 |
| **Inbox** | 跨 agent 消息队列。 |
| **A2A** | Agent-to-Agent —— OpenBuddy 用于 agent 间通信的协议。 |

### 用户面功能

| 术语 | 定义 |
|---|---|
| **Plan mode** | agent 在执行前先制定计划,经用户批准的模式。 |
| **Rewind** | 撤销 session 中最近 N 步,可选 fork 出新分支。 |
| **Fork** | 在 rewind 点 fork 出新的 session。 |
| **Slash command** | composer 中 `/-前缀` 的快捷方式(如 `/plan`、`/rewind`)。 |
| **Automation** | 按 cron 或事件触发运行 agent 的定时任务。 |
| **Notification** | 关于 agent 活动的应用内或系统级提醒。 |
| **Memory** | agent 可在 session 之间回忆的长期上下文。 |
| **Web search** | 由 provider 插拔实现的网络搜索能力。 |
| **Inspiration** | 常见任务的 prompt 模板 / 起点。 |

### 持久化

| 术语 | 定义 |
|---|---|
| **Pi data directory** | Pi 存储配置的位置(provider key 等)。 |
| **OpenBuddy data directory** | Linux/macOS 上为 `~/.config/openbuddy/`,Windows 上为 `%APPDATA%\openbuddy\`。 |
| **Session JSONL** | 每个 session 的 append-only JSON-lines 文件。 |
| **Audit ledger** | append-only、hash-chained 的特权操作日志。 |
| **Folder trust** | 用户授予的、允许 agent 访问某文件夹的权限。 |
| **safeStorage** | Electron 提供的、把密钥加密到系统 keychain 的 API。 |

### Provider

| 术语 | 定义 |
|---|---|
| **Provider** | OpenBuddy 可调用的 LLM API(Anthropic、OpenAI、NewAPI 等)。 |
| **BYOK** | "Bring Your Own Key" —— 用户自带 API 密钥。 |
| **Service Token** | 服务端 token,允许 OpenBuddy 代表用户调用 NewAPI。 |
| **NewAPI** | 我们集成的自托管 model aggregator。 |
| **Anthropic** | Claude 的出品方。 |
| **OpenAI** | GPT-4 / o1 的出品方。 |
| **NewAPI channel** | 在 NewAPI 实例内注册的单个 LLM provider。 |

### 企业

| 术语 | 定义 |
|---|---|
| **Casdoor** | 我们提供完整 client + admin REST 的 OIDC IdP。 |
| **OIDC** | OpenID Connect —— OpenBuddy 使用的 SSO 协议。 |
| **PKCE** | Proof Key for Code Exchange —— 面向桌面应用的 OIDC 扩展。 |
| **SAML** | Security Assertion Markup Language —— 联邦身份协议。 |
| **SCIM** | System for Cross-domain Identity Management —— 配置供应协议。 |
| **OIDC tenant** | 拥有独立用户 / 策略的 Casdoor 组织。 |
| **Audit log shipping** | 将 audit ledger 流式推送到 SIEM。 |
| **Transactional outbox** | at-least-once webhook 投递模式。 |

### 开发

| 术语 | 定义 |
|---|---|
| **moon project** | monorepo DAG 中的一个单元(renderer / Electron / 30+ 包)。 |
| **moon task** | 针对 project 运行的脚本(如 `dev`、`build`、`test`)。 |
| **Vitest** | 测试运行器。 |
| **Playwright** | 用于 Electron 烟雾测试的浏览器自动化工具。 |
| **Zustand** | renderer 的状态管理库。 |
| **Cordis plugin** | 会被注入到 context 中的 `Service` 子类。 |
| **IPC channel** | 形如 `"agent:prompt"` 的具名字符串,桥接 renderer ↔ main。 |

### 构建 / 发布

| 术语 | 定义 |
|---|---|
| **NSIS** | OpenBuddy 使用的 Windows 安装包格式。 |
| **DMG** | macOS 安装包格式。 |
| **AppImage** | Linux 便携式安装包格式。 |
| **electron-builder** | 产出跨平台安装包的工具。 |
| **electron-updater** | 与 GitHub Releases 通信的自动更新库。 |
| **Notarization** | Apple 用于验证二进制安全性的流程。 |
| **Code signing** | 对二进制进行密码学签名以证明其来源。 |

---

<div align="center">

**A shared vocabulary prevents confusion. / 共同词汇库,避免误解。**

<sub>Missing a term? Open a PR editing this file. / 缺词条?开 PR 编辑此文件。</sub>

</div>
