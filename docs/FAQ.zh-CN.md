# Frequently Asked Questions

[English](FAQ.md) · **简体中文**

### 通用

#### OpenBuddy 是什么?

OpenBuddy 是一个 100% 开源(MIT)的桌面 AI 工作台。它有与腾讯 WorkBuddy 同款体验——精致 UI、Plan 模式、Skills、MCP 连接器——但代码完全可审计,自带 API Key,数据留在本地。

#### OpenBuddy 与 WorkBuddy 有什么不同?

| | WorkBuddy | OpenBuddy |
|---|---|---|
| 许可证 | 闭源 | MIT(开源) |
| 数据路径 | 腾讯后端 | 本地 + 你的网关 |
| Provider 选择 | 有限 | BYOK —— 任何 Provider |
| Plugin SDK | 闭源 | Cordis 开源能力网格 |
| 用户可见测试 | ❌ | 仓库中 309 个测试文件 |

完整对比见 [`workbuddy-parity-matrix.md`](workbuddy-parity-matrix.md)。

#### 这是腾讯官方项目吗?

**不是。** OpenBuddy 是独立、社区驱动的开源工作,与腾讯无关、未获其认可或赞助。WorkBuddy 的设计 tokens 与 207 图标是 OpenBuddy 在原许可证下复用的开源资源。

#### 谁在维护 OpenBuddy?

[OpenBuddy contributors](https://github.com/louloulin/OpenBuddy/graphs/contributors) —— 全球开源开发者群体。其后没有单一公司。

---

### 安装

#### 支持哪些平台?

- **Windows** —— Windows 10+(NSIS `.exe` 与 MSI 安装包)
- **macOS** —— macOS 11 Big Sur+(`.dmg`,Intel + Apple Silicon)
- **Linux** —— Ubuntu 22.04+、Fedora 38+(AppImage 与 `.deb`,RPM 即将推出)

#### 不构建安装包,能从源码跑吗?

可以。见 [`GETTING_STARTED.md`](GETTING_STARTED.md)。大约 5 分钟即可启动开发环境。

#### 最低硬件要求是什么?

- 4 GB 内存(多 Agent 工作流推荐 8 GB)
- 2 GB 可用磁盘空间
- 2018 年后发布的任何 x86_64 或 arm64 CPU

---

### Provider 与 API Key

#### 必须用特定 Provider 吗?

不必。OpenBuddy 支持:

- **Anthropic**(Claude 3.5 Sonnet、Claude 3 Opus……)
- **OpenAI**(GPT-4o、GPT-4-turbo、o1……)
- **OpenAI 兼容**(Azure OpenAI、Together、Groq……)
- **NewAPI**(自托管模型聚合,BYOK)
- **Custom**(任何 base URL + key)

在 **Settings → Providers** 配置。Key 通过 Electron `safeStorage` 加密存在 OS 钥匙串。

#### 我的 API Key 存在哪?

存在 OS 钥匙串(Windows Credential Manager / macOS Keychain / Linux Secret Service),通过 Electron `safeStorage` API。它们从不明文写盘。

#### 能同时用多个 Provider 吗?

可以。在 Settings 可配置无限个 Provider,按会话选择当前激活的。

#### OpenBuddy 会记录我的 prompt 吗?

OpenBuddy **只**对特权操作(文件访问、网络调用、权限授予)写本地审计日志(`~/.config/openbuddy/audit.log`)。审计日志永远不会离开你的机器,除非你显式配置 Casdoor 同步。

实际的 prompt 内容只留在 `~/.config/openbuddy/sessions/` 下的本地会话 JSONL 文件中。

---

### 功能

#### OpenBuddy 支持 Plan 模式吗?

支持。在 Composer 切换 **Plan Mode**。Agent 会先规划,你批准后再执行。

#### 能用 skills 吗?

可以。Skills 是带 YAML frontmatter 的 Markdown 文件,存在 `~/.config/openbuddy/skills/`。OpenBuddy 自动发现并列出。写自己的 skill 见 [`PLUGIN_DEVELOPMENT.md`](PLUGIN_DEVELOPMENT.md)。

#### 能接 MCP 服务器吗?

可以。打开 **Settings → MCP Connectors** 添加服务器。支持 stdio、SSE、HTTP 传输,以及 OAuth。

#### OpenBuddy 支持子 Agent 吗?

支持。OpenBuddy 有完整多 Agent 运行时:子 Agent、团队、房间、收件箱、A2A 协议。见 [`distributed-buddy-network-architecture.md`](distributed-buddy-network-architecture.md)。

#### 我能扩展 OpenBuddy 吗?

可以。三种方式:

1. **能力包** —— 加到 `packages/` 并回馈上游(适合仓库内特性)
2. **插件** —— 在 `~/.config/openbuddy/plugins/` 写运行时加载的插件(适合私有特性)
3. **Fork** —— fork 仓库,发布你自己的变体(适合大幅分歧)

详见 [`PLUGIN_DEVELOPMENT.md`](PLUGIN_DEVELOPMENT.md)。

---

### 架构与代码

#### 为什么不选 Tauri 而是 Electron?

Tauri 是最初的选择,我们迁移到 Electron 因为:

- 对依赖注入需求(Cordis)生态支持更好
- 对我们所需的 IPC 流式模式一等公民支持
- 跨平台安装包(electron-builder)工具成熟
- 通过 Chrome DevTools 更容易调试

完整迁移故事见 [`tauri-grok-removal-and-cordis-adoption.md`](tauri-grok-removal-and-cordis-adoption.md)。

#### 为什么不选 Turborepo / Nx 而是 moon?

- moon 的 DAG 显式且可检查(`moon project-graph --json`)
- moon 的任务系统在 CI 与本地一致(无需独立 CI 运行器)
- moon 的缓存更可预测(无意外失效)
- moon 任务可针对特定工程(`moon run openbuddy:dev.electron`)

完整理由见 [`moon-monorepo-refactor.md`](moon-monorepo-refactor.md)。

#### 为什么不选纯 DI 而是 Cordis?

- Cordis 提供插件生命周期(init → ready → dispose)
- 服务销毁自动且整洁
- 插件隔离防止意外跨服务耦合
- Config 类型化,启动时校验

---

### 企业

#### 能自托管 Casdoor 吗?

可以。Casdoor 是开源的:[casdoor.org](https://casdoor.org/)。OpenBuddy 出厂包含完整的客户端 + 管理 REST 集成。

#### 能用自托管 LLM 网关吗?

可以。NewAPI 是开源的:[github.com/songquanpeng/new-api](https://github.com/songquanpeng/new-api)。把 OpenBuddy 的 NewAPI preset 指向你的实例即可 BYOK。

#### OpenBuddy 支持 SSO 吗?

支持。Casdoor OIDC + SAML 2.0 + SCIM v2 全部支持。见 [`casdoor-enterprise-auth.md`](casdoor-enterprise-auth.md) 与 [`enterprise-casdoor-newapi-openbuddy-architecture.md`](enterprise-casdoor-newapi-openbuddy-architecture.md)。

#### 能在 CI 里跑 OpenBuddy 测试吗?

可以。`pnpm test:closed-loop` 让 Agent 在固定 fixture 上跑并打分。对 CI 友好,无 UI 依赖。见 [`electron-testing.md`](electron-testing.md)。

---

### 排错

#### Electron 窗口空白

1. 打开 DevTools(View → Toggle Developer Tools),看 Console。
2. 单独跑 `pnpm dev:renderer` 确认 Vite 在跑。
3. 检查 5173 端口是否空闲。

#### `pnpm install` 报 EACCES

加入 `dialout` 组(Linux),或修复 npm prefix 权限(macOS/Linux):

```bash
mkdir -p ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH
```

#### electron-builder 下载失败

设置 npmmirror 镜像环境变量(见 `electron-builder.yml`):

```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
```

#### 测试报 "Cannot find module '@openbuddy/...'"

```bash
rm -rf node_modules .moon/cache
pnpm install
pnpm moon:sync
```

#### Pi agent 卡住

1. 在 Settings 检查你的 API Key。
2. 验证网络出口:`curl https://api.anthropic.com/v1/messages`。
3. 看审计日志:`~/.config/openbuddy/audit.log`。

#### 我的问题这里没有

开 [GitHub Discussion › Q&A](https://github.com/louloulin/OpenBuddy/discussions/categories/q-a) 或加入 [Discord](https://discord.gg/openbuddy)。

---

<div align="center">

**Still curious? / 还有问题?** 开 [Discussion](https://github.com/louloulin/OpenBuddy/discussions) 或 [Discord](https://discord.gg/openbuddy)。

</div>
