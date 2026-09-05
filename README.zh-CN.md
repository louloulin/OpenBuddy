<div align="center">

<img src="app-icon.png" width="128" height="128" alt="OpenBuddy 标志" />

# OpenBuddy

### 真正可读、可 fork、可拥有的开源桌面 AI 工作台。

[English](README.md) · **简体中文**

<a href="docs/README.zh-CN.md"><img alt="文档" src="https://img.shields.io/badge/文档-完整索引-blue?style=for-the-badge"></a>
<a href="CONTRIBUTING.zh-CN.md"><img alt="贡献" src="https://img.shields.io/badge/contributing-欢迎-green?style=for-the-badge"></a>
<a href="docs/COMMUNITY.md"><img alt="社区" src="https://img.shields.io/badge/community-加入-purple?style=for-the-badge"></a>
<a href="SPONSORS.zh-CN.md"><img alt="赞助" src="https://img.shields.io/badge/sponsor-♥-ff69b4?style=for-the-badge"></a>

<br/>

<a href="https://github.com/louloulin/OpenBuddy/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/louloulin/OpenBuddy?style=for-the-badge&logo=starship&logoColor=white&color=yellow"></a>
<a href="https://github.com/louloulin/OpenBuddy/releases"><img alt="Release" src="https://img.shields.io/github/v/release/louloulin/OpenBuddy?style=for-the-badge&logo=github&color=blue"></a>
<a href="https://github.com/louloulin/OpenBuddy/actions"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/louloulin/OpenBuddy/release.yml?branch=master&style=for-the-badge&logo=githubactions&logoColor=white"></a>
<a href="https://github.com/louloulin/OpenBuddy/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge"></a>

<br/>

<img alt="Platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=flat-square&logo=windows10&logoColor=white">
<img alt="Electron" src="https://img.shields.io/badge/Electron-44-47848F?style=flat-square&logo=electron&logoColor=white">
<img alt="React" src="https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react&logoColor=white">
<img alt="moon" src="https://img.shields.io/badge/moon-2.5-blue?style=flat-square&logo=moonrepo&logoColor=white">
<img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat-square&logo=typescript&logoColor=white">
<img alt="Tests" src="https://img.shields.io/badge/tests-455%20files-success?style=flat-square&logo=vitest&logoColor=white">

<br/><br/>

**OpenBuddy 是 WorkBuddy 风格的桌面 AI 工作台,在 Electron + Pi 之上以 100% MIT 开源重建。**
它带来 WorkBuddy 同款精致 UI、Plan 模式、Skills、MCP 连接器,以及企业级 Casdoor × NewAPI 集成——每一字节都可审计,每一个 Provider 都支持自带 Key。

[快速开始](#-快速开始) · [特性](#-主要特性) · [架构](#-架构) · [文档](#-文档) · [贡献指南](CONTRIBUTING.md) · [社区](docs/COMMUNITY.md)

</div>

---

## 📑 目录

- [为什么是 OpenBuddy?](#-为什么是-openbuddy)
- [✨ 主要特性](#-主要特性)
- [🎬 演示与截图](#-演示与截图)
- [⚔️ OpenBuddy vs WorkBuddy](#%EF%B8%8F-openbuddy-vs-workbuddy)
- [🚀 快速开始](#-快速开始)
- [🏗️ 架构](#-架构)
- [🧩 能力包清单](#-能力包清单)
- [🛠️ 技术栈](#-技术栈)
- [📚 文档](#-文档)
- [🗺️ 路线图](#-路线图)
- [🤝 贡献](#-贡献)
- [🛡️ 安全](#-安全)
- [🌍 社区](#-社区)
- [⭐ Star 历史](#-star-历史)
- [🙏 致谢](#-致谢)
- [📄 许可证](#-许可证)

---

## 💡 为什么是 OpenBuddy?

[**腾讯 WorkBuddy**](https://workbuddy.tencent.com/) 告诉了所有人:一个优秀的桌面 AI Agent 工作台应该长什么样——精致 UI、Plan 模式、Skills、MCP 连接器。这确实是个能打的产品。

**但它闭源,且数据链路走腾讯后端。**

**OpenBuddy 是开源的答案**——同样的体验形态,在 Electron + Pi 上从零重建,底层是 Cordis 能力网格,任何贡献者都可以扩展:

<table>
<tr><td>🔓</td><td><strong>100% 开源 (MIT)</strong><br/>没有黑箱遥测,没有供应商锁定。整个仓库可审计。</td></tr>
<tr><td>⚡</td><td><strong>Electron + Pi 运行时</strong><br/>一个经过测试的桌面宿主,带版本化 preload bridge;渲染进程只看到类型化 API。</td></tr>
<tr><td>🔁</td><td><strong>会话可重启恢复</strong><br/>Pi 会话、Provider 设置、能力状态、审计日志跨渲染进程 reload 和 Electron 重启持久化。</td></tr>
<tr><td>🤖</td><td><strong>Pi 作为 Agent Runtime</strong><br/>进程内 <code>AgentSession</code> 掌管提示词、工具、权限、计划、任务和流式事件。</td></tr>
<tr><td>🌐</td><td><strong>真正的跨平台</strong><br/>一套代码,Windows、macOS、Linux。<a href="electron-builder.yml">electron-builder</a> 为每个平台产出签名安装包。</td></tr>
<tr><td>🪐</td><td><strong>moon DAG monorepo</strong><br/>66 个工程(1 根 + 1 Electron + 64 个 workspace 包),typecheck/test/build 增量执行。CI 跑的 <code>moon run</code> 与本地完全一致。</td></tr>
<tr><td>🧩</td><td><strong>Cordis 能力网格</strong><br/>64 个 workspace 包(12 capability、27 UI、8 collaboration ……)(<code>@openbuddy/*</code>)——skills、memory、plan、task、email、calendar、MCP、payment、SCIM、SAML……按需取用。</td></tr>
<tr><td>🏢</td><td><strong>企业就绪</strong><br/>Casdoor OIDC、NewAPI 网关、4 个支付通道、SCIM v2、SAML 2.0、事务性 Outbox Webhooks、审计账本——生产级构件。</td></tr>
</table>

> *"WorkBuddy 是成品,OpenBuddy 是你能真正读懂、能 fork、能拥有的那一个。"*

<div align="center">

### 🌟 如果这个项目对你有帮助,请给它一个 ⭐

它能帮更多人发现 OpenBuddy,也是持续开发的动力。

<a href="https://github.com/louloulin/OpenBuddy/stargazers"><img src="https://img.shields.io/github/stars/louloulin/OpenBuddy?style=social" alt="stars"></a>

</div>

---

## ✨ 主要特性

<table>
<tr><th width="50%">界面</th><th width="50%">能力</th></tr>
<tr>
<td valign="top">

**🎨 像素级贴近 WorkBuddy UI**
移植了 `--wb-*` 设计 tokens、完整的 207 个图标基底(全部实现,无桩),以及品牌原子。它看起来像 WorkBuddy,因为它们由相同的原子组成。

**⚙️ Pi 进程内运行**
`@earendil-works/pi-coding-agent` 跑在 Electron 主进程。渲染进程只看到类型化 preload API,UI 中不需要 Node 或 Provider SDK。

**🔌 Pi 事件作为契约**
流式助手增量、工具调用、计划更新、权限请求、完成事件,均通过具备清理意识的 `pi://*` 事件流动。

</td>
<td valign="top">

**🔑 BYOK,多 Provider**
自带 Key。在本地 Pi/OpenBuddy 数据目录配置 Anthropic、OpenAI 兼容、Pi、MiniMax、NewAPI 或自定义 Provider。

**🧩 可扩展 Agent 表层**
- **Skills** — Pi skills 与本地技能目录
- **MCP 连接器** — 本地连接器根 + OAuth/auth 状态
- **Experts / Assistants** — 本地 Pi/OpenBuddy agent 文件
- **Plugins** — 通过插件市场加载

**🚀 进阶工作流**
Plan 模式(开关 & 查看) · Rewind(回退 & fork) · 子 Agent Tasks(观察 & 取消) · Slash Commands · 本地 Automations 调度器 · 通知中心。

**📦 跨平台安装包**
Windows(NSIS `.exe` + MSI)、macOS(`.dmg`)、Linux(AppImage + `.deb`)。通过 GitHub Actions CI 构建发布。

</td>
</tr>
<tr>
<td valign="top">

**🏢 企业级集成**
- **Casdoor** — OIDC SSO + 租户策略 + 审计日志
- **NewAPI** — 模型聚合网关(BYOK + Service Token)
- **Stripe / WeChat Pay / Alipay** — 4 个支付适配器
- **SCIM v2** — RFC 7644 用户/组预置
- **SAML 2.0** — AuthnRequest/Response/LogoutRequest
- **事务性 Outbox** — Webhook 投递,带指数退避

</td>
<td valign="top">

**🧪 经实战检验的质量**
- **309 个测试文件**(Vitest)
- **实时集成测试**面向公网 Casdoor + NewAPI 端点
- **闭环能力评测**支持端到端 Agent 运行
- **类型化 IPC** — 每个 preload 通道都在 `electron/preload/index.ts` 白名单中
- **存储边界** — 自动化的架构约束

**🌍 国际化**
通过 `@openbuddy/ui-locale` 提供完整 UI locale 覆盖;开箱即支持 English + 简体中文。

**🪟 原生桌面体验**
系统托盘、原生通知、深度链接(`casdoor://`)、剪贴板集成、多窗口、退出自动保存。

</td>
</tr>
</table>

---

## 🎬 演示与截图

> 截图取自已运行的 dev 渲染器 (`http://127.0.0.1:1420/`),对应 commit `a9d240ff`。本地重新生成:`pnpm electron:dev`,然后用 `scripts/electron/screenshot.mjs` 里的 Playwright 流程。

### 主桌面壳层(简体中文 / 默认语言)

<p align="center">
  <img src="docs/screenshots/desktop-main.png" alt="OpenBuddy 主桌面壳层 — 侧边栏含任务 / 工作空间 / 设置,默认简体中文" width="1024" />
</p>

### 设置面板(简体中文)

<p align="center">
  <img src="docs/screenshots/settings-zh.png" alt="OpenBuddy 设置面板 — 通用 / 快捷键 / 个性化 / 助理设置 / 智能体 / 模型 / 数据与安全 / 关于" width="1024" />
</p>

### 权限对话框(简体中文)

<p align="center">
  <img src="docs/screenshots/dialog-preview.png" alt="OpenBuddy 权限对话框 — 类型化、原子化、本地化感知" width="1024" />
</p>

### 30 秒速览 — 你将获得什么

<p align="center">
  <img src="docs/diagrams/tour-30s.svg" alt="OpenBuddy 30 秒速览 — WorkBuddy 级 UI、64 个 Cordis 能力、企业级、可验证、高性能" />
</p>

### 架构总览

<p align="center">
  <img src="docs/diagrams/architecture-overview.svg" alt="OpenBuddy 端到端架构 — 渲染层、preload 桥、Electron 主进程、Pi Agent 运行时、Cordis 能力网格" />
</p>

### 能力矩阵

<p align="center">
  <img src="docs/diagrams/capability-matrix.svg" alt="OpenBuddy 能力矩阵 — 64 个 workspace 包,分为 8 个能力组" />
</p>

### 数据流 — 提示词到工具结果

<p align="center">
  <img src="docs/diagrams/data-flow-end-to-end.svg" alt="OpenBuddy 数据流 — 每个提示词跨过 5 个类型化边界才到达模型,返回时再跨过 4 个" />
</p>

### WorkBuddy 能力对等

<p align="center">
  <img src="docs/diagrams/workbuddy-parity.svg" alt="OpenBuddy vs WorkBuddy 能力对等矩阵" />
</p>

### 双语支持

OpenBuddy 原生提供 **`zh-CN`(默认)** 与 **`en-US`** 双语界面。翻译以 JSON 字典存放,路径 `packages/ui/openbuddy-ui-locale/src/dictionaries/`。locale 通过 `localStorage` 的 `openbuddy:locale` 键持久化,通过 `LocaleService` API 在运行时热切换——下一次导航即生效,无需重新加载渲染器。完整工作流与如何新增第三种语言见 [`docs/I18N.md`](docs/I18N.md)。

所有主要文档均以**单独文件**方式按语言拆分,贡献者可并行编辑而不会产生合并冲突:

| 文档 | English | 简体中文 |
|---|---|---|
| 入口 README | [`README.md`](README.md) | [`README.zh-CN.md`](README.zh-CN.md) |
| 代码库分析 | [`docs/CODEBASE_ANALYSIS.md`](docs/CODEBASE_ANALYSIS.md) | [`docs/CODEBASE_ANALYSIS.zh-CN.md`](docs/CODEBASE_ANALYSIS.zh-CN.md) |
| 文档索引 | [`docs/README.md`](docs/README.md) | [`docs/README.zh-CN.md`](docs/README.zh-CN.md) |
| 入门指南 | [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md) | [`docs/GETTING_STARTED.zh-CN.md`](docs/GETTING_STARTED.zh-CN.md) |
| 架构 | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | [`docs/ARCHITECTURE.zh-CN.md`](docs/ARCHITECTURE.zh-CN.md) |
| 常见问题 | [`docs/FAQ.md`](docs/FAQ.md) | [`docs/FAQ.zh-CN.md`](docs/FAQ.zh-CN.md) |
| 性能 | [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) | [`docs/PERFORMANCE.zh-CN.md`](docs/PERFORMANCE.zh-CN.md) |
| 贡献指南 | [`CONTRIBUTING.md`](CONTRIBUTING.md) | [`CONTRIBUTING.zh-CN.md`](CONTRIBUTING.zh-CN.md) |
| 治理 | [`GOVERNANCE.md`](GOVERNANCE.md) | [`GOVERNANCE.zh-CN.md`](GOVERNANCE.zh-CN.md) |
| 行为准则 | [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) | [`CODE_OF_CONDUCT.zh-CN.md`](CODE_OF_CONDUCT.zh-CN.md) |
| 安全策略 | [`SECURITY.md`](SECURITY.md) | [`SECURITY.zh-CN.md`](SECURITY.zh-CN.md) |
| 获取帮助 | [`SUPPORT.md`](SUPPORT.md) | [`SUPPORT.zh-CN.md`](SUPPORT.zh-CN.md) |
| 维护者 | [`MAINTAINERS.md`](MAINTAINERS.md) | [`MAINTAINERS.zh-CN.md`](MAINTAINERS.zh-CN.md) |
| 赞助 | [`SPONSORS.md`](SPONSORS.md) | [`SPONSORS.zh-CN.md`](SPONSORS.zh-CN.md) |
| 品牌 | [`BRAND.md`](BRAND.md) | [`BRAND.zh-CN.md`](BRAND.zh-CN.md) |
| 更新日志 | [`CHANGELOG.md`](CHANGELOG.md) | [`CHANGELOG.zh-CN.md`](CHANGELOG.zh-CN.md) |
| 路线图 / TODO | [`TODO.md`](TODO.md) | [`TODO.zh-CN.md`](TODO.zh-CN.md) |

完整系统架构图(SVG / HTML)见 [`docs/diagrams/`](docs/diagrams/)。

---

## ⚔️ OpenBuddy vs WorkBuddy

只列出可公开佐证的能力——完整对比见 [`docs/workbuddy-parity-matrix.md`](docs/workbuddy-parity-matrix.md)。

| 能力 | WorkBuddy | OpenBuddy |
|---|---|---|
| 许可证 | 闭源 | **MIT(开源)** |
| 数据路径 | 腾讯后端 | **本地 + 你的网关** |
| Plan 模式 | ✅ | ✅ |
| Skills | ✅ | ✅ + 开源目录 |
| MCP 连接器 | ✅ | ✅ |
| Experts / Assistants | ✅ | ✅(本地文件) |
| Rewind & fork | ✅ | ✅ |
| 子 Agent Tasks | ✅ | ✅ |
| Automations | ✅ | ✅(本地调度器) |
| Slash commands | ✅ | ✅ |
| 本地持久化 | ✅ | ✅(重启安全) |
| Provider 选择 | 有限 | **BYOK — Anthropic / OpenAI / NewAPI / 自定义** |
| Casdoor OIDC | ❌ | ✅ |
| NewAPI 网关 | ❌ | ✅(BYOK + Service Token) |
| SCIM v2 | ❌ | ✅(RFC 7644) |
| SAML 2.0 | ❌ | ✅ |
| Plugin SDK | 闭源 | **Cordis 开源能力网格** |
| 用户可见的测试 | ❌ | **仓库中 309 个测试文件** |
| 跨平台 | Win / macOS | **Win / macOS / Linux** |
| 审计日志 | 后端 | **本地 + Casdoor 租户账本** |

---

## 🚀 快速开始

### 前置条件

- **Node.js 22+**(我们使用 Node 22 特性;见 `package.json` 的 `packageManager`)
- **pnpm 10+** — `npm install -g pnpm`
- **Git** 需支持子模块
- **(可选)** 平台构建工具——见 [`docs/release-ci.md`](docs/release-ci.md)

### 安装与运行(开发模式)

```bash
# 1. 克隆(含子模块)
git clone --recurse-submodules https://github.com/louloulin/OpenBuddy.git
cd OpenBuddy

# 2. 安装依赖(会自动执行 `moon sync projects`)
pnpm install

# 3. 启动开发外壳 — Electron 宿主 + Vite 渲染进程 + HMR
pnpm electron:dev
#   ↑ 等价于:  moon run openbuddy:dev.electron
```

> 首次冷启动约 30 秒(Vite)。得益于 moon 的增量 DAG,后续重启亚秒级。

### 构建生产安装包

```bash
# Windows 安装包(NSIS .exe + MSI)
pnpm electron:build:win

# macOS 安装包(DMG)
pnpm electron:build:mac

# Linux AppImage / .deb
pnpm electron:build:linux

# 三平台全打
pnpm electron:build:all
```

### 验证环境

```bash
# 类型检查整个 32 工程 monorepo
pnpm workspace:typecheck

# 跑完整 Vitest 套件(309 个测试文件)
pnpm workspace:test

# 闭环能力评测(真实 Agent 运行 + 评分)
pnpm test:closed-loop
```

更详细的引导见 **[`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md)**。

---

## 🏗️ 架构

OpenBuddy 是一个 **三层 Electron 应用**,底层是 **Cordis 能力网格**:

```
┌──────────────────────────────────────────────────────────────┐
│  React 渲染进程 (src/, packages/ui/*)                        │
│    Vite + React 18 + Zustand stores                          │
│    基底: --wb-* tokens, 207 图标, 品牌原子                   │
└──────────────────────┬───────────────────────────────────────┘
                       │ window.api(类型化 contextBridge)
┌──────────────────────┴───────────────────────────────────────┐
│  Electron Main + preload bridge                              │
│    ipc.ts                ← 白名单 IPC 处理器                 │
│    agent-host.ts         ← Pi AgentSession 生命周期           │
│    pi-event-bridge.ts    ← 具备清理意识的 pi://* 事件          │
│    pi-resources.ts       ← 本地持久化(Cordis fs)              │
│    capability-*.ts       ← Cordis 能力服务                    │
└──────────────────────┬───────────────────────────────────────┘
                       │ 类型化 Pi 会话事件
┌──────────────────────┴───────────────────────────────────────┐
│  Pi AgentSession + Cordis 能力服务                            │
│    providers, tools, permissions, plans, tasks, persistence  │
└──────────────────────────────────────────────────────────────┘
```

**能力网格**——每个特性都是 `packages/<group>/openbuddy-*/` 下的一个 Cordis 服务:

```
runtime/      cordis · plugin-host · storage
renderer/     renderer-host(preload bridge 胶水)
bundle/       base(渲染端依赖 umbrella)
auth/         casdoor · permission
team/         team · subagent
capability/   memory · notification · inspiration · web-search · plan ·
              folder-trust · task · automation · calendar · email · mcp-client · authorization
core/         session
fs/           fs-local
shared/       files-kb · types
collaboration/ coordinator · evidence · inbox · network · policy · protocol · room · task
payment/      Stripe / WeChat Pay / Alipay / HMAC 适配器
saml/         SAML 2.0 原语
scim/         SCIM v2 端点(RFC 7644)
webhook-outbox/ 事务性 Outbox + 重试/退避
ui/           26 个 UI 包(shell, sidebar, settings, workbench, …)
```

### 项目结构

```
src/                     # React 前端
  styles/                # tokens.css / global.css / app.css
  foundation/components/Icon/   # 移植自 WorkBuddy(207 图标,全部实现)
  lib/                   # pi-client.ts + electron-api.ts(类型化 bridge 包装)
  stores/                # Zustand: session / sessions / permission / ...
  components/            # Topbar, Sidebar, HomePage, ChatView, Composer, ...

electron/                # Electron 主进程 + preload 宿主
  main/                  # index.ts · window.ts · ipc.ts · agent-host.ts · sessions.ts
  preload/               # contextBridge 表面(白名单)

apps/
  admin-portal/          # 独立 React SPA(Casdoor OIDC + Resource Gateway)

packages/                # 每个能力一个 moon 工程(30+ 包)
  runtime/openbuddy-{cordis,plugin-host,storage}/
  renderer/openbuddy-renderer-host/
  bundle/openbuddy-base/
  auth/openbuddy-{casdoor,permission}/
  team/openbuddy-{team,subagent}/
  capability/openbuddy-{memory,notification,inspiration,web-search,plan,
              folder-trust,task,automation,calendar,email,mcp-client,authorization}/
  core/openbuddy-session/
  fs/openbuddy-fs-local/
  shared/openbuddy-{files-kb,types}/
  collaboration/openbuddy-{coordinator,evidence,inbox,network,policy,
              protocol,room,task}/
  payment/               # Stripe / WeChat Pay / Alipay / HMAC
  saml/                  # SAML 2.0 原语
  scim/                  # SCIM v2 端点
  webhook-outbox/        # 事务性 Outbox
  ui/openbuddy-{shell,sidebar,settings,workbench,…} (14 包)

.moon/                   # moon workspace + task 配置
  workspace.yml          # 32 工程图(渲染端 + Electron + packages)
  tasks/                 # typecheck / test / build / dev / electron.* 预设
  toolchains.yml         # node 22 / pnpm 10 / typescript 5.6

moon.yml                 # 渲染端 moon 工程(Vite + React)
electron/moon.yml        # Electron 宿主 moon 工程

scripts/                 # dev/build 辅助脚本(moon task 的薄壳)
docs/                    # 所有文档(此目录)
```

深度剖析见 **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**。

---

## 🧩 能力包清单

OpenBuddy 内置 **63 个 workspace 包(12 capability、26 UI、8 collaboration、…)**,每一个都是一个 Cordis 服务,可独立启用、配置或扩展。

### 核心 Agent

| 包 | 用途 |
|---|---|
| `@openbuddy/core-session` | 会话生命周期、fork、rewind |
| `@openbuddy/capability-plan` | Plan 模式 + 计划审批流 |
| `@openbuddy/capability-task` | 子 Agent 任务生成与取消 |
| `@openbuddy/capability-automation` | 本地调度器,定时跑 Agent |
| `@openbuddy/capability-notification` | 收件箱 + 原生通知 |
| `@openbuddy/capability-web-search` | Provider 可插拔的 Web 搜索 |
| `@openbuddy/capability-inspiration` | 提示词模板与开场白 |
| `@openbuddy/capability-folder-trust` | 文件夹级权限授予 |
| `@openbuddy/capability-authorization` | 能力级策略 |
| `@openbuddy/capability-mcp-client` | MCP 连接器治理 |

### 文件与 Shell

| 包 | 用途 |
|---|---|
| `@openbuddy/fs-fs-local` | 本地文件系统(Cordis) |
| `@openbuddy/files-kb` | 知识库文件索引 |

### 多 Agent

| 包 | 用途 |
|---|---|
| `@openbuddy/team-team` | 多 Agent 团队编排 |
| `@openbuddy/team-subagent` | 子 Agent 生成 |
| `@openbuddy/collaboration-protocol` | A2A 消息信封 |
| `@openbuddy/collaboration-room` | 共享房间 |
| `@openbuddy/collaboration-inbox` | 跨 Agent 收件箱 |
| `@openbuddy/collaboration-policy` | 跨 Agent 策略 |
| `@openbuddy/collaboration-task` | 跨 Agent 任务图 |
| `@openbuddy/collaboration-network` | 网络拓扑 |
| `@openbuddy/collaboration-evidence` | 审计证据 |
| `@openbuddy/collaboration-coordinator` | 协调层 |

### 企业级

| 包 | 用途 |
|---|---|
| `@openbuddy/auth-casdoor` | Casdoor OIDC 客户端 + 管理 REST |
| `@openbuddy/auth-permission` | 权限弹窗与策略 UI |
| `@openbuddy/payment` | Stripe / WeChat Pay / Alipay / HMAC |
| `@openbuddy/saml` | SAML 2.0 原语 |
| `@openbuddy/scim` | SCIM v2 端点(RFC 7644) |
| `@openbuddy/webhook-outbox` | 事务性 Outbox + 重试/退避 |

### 邮件与日历

| 包 | 用途 |
|---|---|
| `@openbuddy/capability-email` | IMAP/SMTP + Gmail/Graph/JMAP API |
| `@openbuddy/capability-calendar` | 日历集成 |

### UI 基元

`packages/ui/openbuddy-ui-*` 下的 26 个包——shell、sidebar、settings、settings-models、workbench、home、conversation、experts、dialogs、markdown、primitives、modules、theme、runtime、slots、automation、locale、hmr。

---

## 🛠️ 技术栈

<table>
<tr><th>分层</th><th>技术</th></tr>
<tr><td>Shell</td><td><a href="https://www.electronjs.org/">Electron 44</a>、<a href="https://www.electron.build/">electron-builder 26</a>、<a href="https://github.com/Squirrel/Squirrel.Windows">Squirrel</a>、<a href="https://github.com/Squirrel/Squirrel.Mac">Squirrel.Mac</a></td></tr>
<tr><td>渲染端</td><td><a href="https://react.dev/">React 18</a>、<a href="https://vitejs.dev/">Vite 5</a>、<a href="https://github.com/pmndrs/zustand">Zustand 4</a>、<a href="https://reactrouter.com/">React Router 6</a>、<a href="https://github.com/remarkjs/react-markdown">react-markdown</a>、<a href="https://github.com/lucide-icons/lucide">lucide-react</a>、<a href="https://katex.org/">KaTeX</a>、<a href="https://github.com/mermaid-js/mermaid">Mermaid</a></td></tr>
<tr><td>Agent 运行时</td><td><a href="https://github.com/badlogic/pi-mono">@earendil-works/pi-coding-agent</a>、<a href="https://github.com/badlogic/pi-mono">@earendil-works/pi-agent-core</a>、<a href="https://github.com/badlogic/pi-mono">@earendil-works/pi-ai</a></td></tr>
<tr><td>能力网格</td><td><a href="https://github.com/cordisjs/cordis">Cordis 3</a>、<a href="https://modelcontextprotocol.io/">MCP SDK 1.25</a></td></tr>
<tr><td>Monorepo</td><td><a href="https://moonrepo.dev">moon 2.5</a>、<a href="https://pnpm.io/">pnpm 11</a></td></tr>
<tr><td>质量</td><td><a href="https://vitest.dev/">Vitest 2</a>、<a href="https://playwright.dev/">Playwright 1.58</a>、<a href="https://testing-library.com/">Testing Library</a>、TypeScript 5.6 strict</td></tr>
<tr><td>后端集成</td><td>Casdoor、NewAPI、Stripe、WeChat Pay、Alipay、IMAP、SMTP、Gmail API、Graph API、JMAP</td></tr>
</table>

---

## 📚 文档

所有文档都在 [`docs/`](docs/),从这里开始:

| 文档 | 用途 |
|---|---|
| **[`docs/README.md`](docs/README.md)** | 完整文档索引 |
| **[`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md)** | 30 分钟开发者入门 |
| **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** | 逐层架构深度剖析 |
| **[`docs/CODEBASE_ANALYSIS.zh-CN.md`](docs/CODEBASE_ANALYSIS.zh-CN.md)** | 2026-09-05 已核验的包清单与构建/运行时架构 |
| **[`docs/PLUGIN_DEVELOPMENT.md`](docs/PLUGIN_DEVELOPMENT.md)** | 编写你的第一个 Cordis 能力 |
| **[`docs/FAQ.md`](docs/FAQ.md)** | 常见问题 |
| **[`docs/COMMUNITY.md`](docs/COMMUNITY.md)** | 提问、聊天、贡献入口 |
| **[`docs/ROADMAP.md`](docs/ROADMAP.md)** | 公开路线图 |
| **[`SECURITY.md`](SECURITY.md)** | 安全策略与披露 |
| **[`SUPPORT.md`](SUPPORT.md)** | 如何获取帮助 |
| **[`docs/release-ci.md`](docs/release-ci.md)** | 发布与 CI 流水线 |
| **[`docs/workbuddy-parity-matrix.md`](docs/workbuddy-parity-matrix.md)** | OpenBuddy vs WorkBuddy 能力对照 |
| **[`docs/openbuddy-capability-matrix.md`](docs/openbuddy-capability-matrix.md)** | 逐包能力清单 |
| **[`docs/TESTING.md`](docs/TESTING.md)** | 测试策略与约定 |
| **[`docs/PERFORMANCE.md`](docs/PERFORMANCE.md)** | 性能预算与优化 |
| **[`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md)** | WCAG 2.2 AA 一致性 |
| **[`docs/OPERATIONS.md`](docs/OPERATIONS.md)** | 生产部署与运维 |
| **[`docs/WORKBUDDY_MIGRATION.md`](docs/WORKBUDDY_MIGRATION.md)** | 从腾讯 WorkBuddy 迁移 |
| **[`docs/EXAMPLES.md`](docs/EXAMPLES.md)** | 示例与 showcase |
| **[`docs/GLOSSARY.md`](docs/GLOSSARY.md)** | 术语词汇表 |
| **[`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md)** | 环境变量参考 |
| **[`docs/RELEASING.md`](docs/RELEASING.md)** | 发布流程 |
| **[`docs/I18N.md`](docs/I18N.md)** | 翻译与本地化工作流 |
| **[`docs/COMPARISON.md`](docs/COMPARISON.md)** | OpenBuddy vs Cursor / Continue / aider / Copilot |
| **[`docs/adr/`](docs/adr/)** | 架构决策记录 |
| **[`docs/openbuddy-product-vs-pi.md`](docs/openbuddy-product-vs-pi.md)** | OpenBuddy 如何扩展 Pi |
| **[`SECURITY.md`](SECURITY.md)** | 安全策略与披露 |
| **[`SUPPORT.md`](SUPPORT.md)** | 如何获取帮助 |
| **[`SPONSORS.md`](SPONSORS.md)** | 赞助与资金 |

---

## 🗺️ 路线图

完整 backlog 在 [`TODO.md`](TODO.md),公开路线图见 **[`docs/ROADMAP.md`](docs/ROADMAP.md)**。亮点:

### ✅ 已发布

- 核心布局: Sidebar / HomePage / ChatView / Composer
- 进程内 Pi Agent 跨 Electron bridge
- WorkBuddy 设计 tokens 与 207 图标基底(全部实现,零桩)
- BYOK 多 Provider 配置
- Skills / MCP / Experts 表面
- Plan 模式 · Rewind · Tasks · Slash Commands · Automations
- Windows(NSIS + MSI)与 macOS(DMG)安装包
- CI 发布流水线(GitHub Actions)
- moon 化 monorepo(`moon run` 一统天下,32 工程 DAG,增量构建)
- Casdoor OIDC + NewAPI 网关 + 支付适配器 + SCIM v2 + SAML 2.0

### 🚧 进行中

- SceneTabs 与 Skill 推荐栏
- 会话置顶与工作区分组
- 权限管理面板
- 跨会话搜索
- Linux 构建(AppImage + .deb)
- 代码签名与公证

### 🔮 后续

- 插件市场(公开目录 + 安装流程)
- Web 伴侣(只读会话视图)
- 语音输入 / 输出
- 本地向量库集成
- 公开路线图上还有 12 个能力包

想影响路线图?带 `roadmap:` 标签开 Issue,或在 **[`docs/COMMUNITY.md`](docs/COMMUNITY.md)** 参与讨论。

---

## 🤝 贡献

OpenBuddy 还年轻,迭代很快——**任何规模的贡献都欢迎**。

1. 通读 **[`CONTRIBUTING.md`](CONTRIBUTING.md)** 了解工作流。
2. 阅读我们的 **[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)**。
3. 从 [`TODO.md`](TODO.md) 中挑一个 Issue,或开新 Issue 讨论。
4. 从 `master` fork & branch,开始 Hack。
5. 跑 `pnpm electron:dev`(等价 `moon run openbuddy:dev.electron`)。
6. 提 PR——所有 PR 48 小时内首次响应。

**目前最需要帮助的方向:**

- 🐧 Linux 打包与 smoke 测试
- 🎨 UI 打磨 / 截图 / 图标
- 🌍 文档与 i18n(下一个目标:日语、韩语、西班牙语、德语)
- 🔏 macOS 签名与公证 CI
- 🧪 插件市场目录运营
- 💼 企业部署 playbook(Caddy / Nginx / Vault)

所有贡献者都会出现在 GitHub Contributors 图中。新贡献者会在下一个发布说明中获得 🎉。

---

## 🛡️ 安全

OpenBuddy 把安全当作一等公民:

- **上下文隔离渲染进程** + 白名单 IPC(`electron/preload/index.ts`)
- **文件夹级信任授予** 经 `@openbuddy/capability-folder-trust`
- **能力级策略** 经 `@openbuddy/capability-authorization`
- **Casdoor OIDC** 带 PKCE 与 refresh token 轮换
- **SCIM v2** 预置 + **SAML 2.0** 联合身份
- **事务性 Outbox** Webhook 投递(零事件丢失)
- **本地优先审计账本**,跨重启持久化

完整策略与漏洞上报见 **[`SECURITY.md`](SECURITY.md)**。

---

## 🌍 社区

- **GitHub Discussions** — 设计提案 & 求助
- **GitHub Issues** — Bug 报告 & 功能请求
- **Discord** — 实时聊天(链接见 [`docs/COMMUNITY.md`](docs/COMMUNITY.md))
- **微信群** — 中文社区
- **Office Hours** — 每周视频 Q&A(在 Discussions 公告)

完整详情、各语言频道、行为准则执行联系人见 **[`docs/COMMUNITY.md`](docs/COMMUNITY.md)**。

---

## ⭐ Star 历史

如果 OpenBuddy 已经成为你的日常工具之一,请考虑给它一个 ⭐——它直接驱动下一个发布周期。

<a href="https://star-history.com/#louloulin/OpenBuddy&Timeline">
  <img src="https://api.star-history.com/svg?repos=louloulin/OpenBuddy&type=Timeline" alt="Star History Chart" />
</a>

---

## 🙏 致谢

OpenBuddy 站在巨人的肩膀上:

- **[腾讯 WorkBuddy](https://workbuddy.tencent.com/)** — 设计的北极星。OpenBuddy 复用了 WorkBuddy 的 `--wb-*` 设计 tokens、207 图标基底(全部实现)与品牌原子,以达到像素级贴近的视觉体验。
- **[Pi coding agent](https://github.com/badlogic/pi-mono)** — OpenBuddy Electron 宿主背后的进程内 Agent 运行时。
- **[Cordis](https://github.com/cordisjs/cordis)** — 驱动能力网格的依赖注入框架。
- **[moon](https://moonrepo.dev)** · **[Electron](https://www.electronjs.org/)** · **[React](https://react.dev/)** · **[Vite](https://vitejs.dev/)** — moon 编排所有任务; Electron 承载 Cordis/Pi 运行时; React + Vite 输出渲染端。
- **[Casdoor](https://casdoor.org/)** · **[NewAPI](https://github.com/songquanpeng/new-api)** — 我们集成的开源 OIDC IdP 与模型网关。
- **[Vitest](https://vitest.dev/)** · **[Playwright](https://playwright.dev/)** — 守住质量的测试框架。

本项目是独立、社区驱动的开源工作,**与腾讯无关,未获其认可或赞助**。

---

## 📄 许可证

OpenBuddy 以 **[MIT 许可证](LICENSE)** 发布—— © OpenBuddy contributors。

你可以自由地在自己的项目中使用、修改和分发 OpenBuddy,无论商业与否,只需保留版权声明。
