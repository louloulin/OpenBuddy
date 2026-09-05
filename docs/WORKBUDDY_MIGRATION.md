# Migrating from Tencent WorkBuddy to OpenBuddy

> 🌐 **Language / 语言:** [English](#english) · [简体中文](#简体中文)

This guide helps **WorkBuddy users and teams** switch to OpenBuddy with minimal disruption. It assumes you already have WorkBuddy installed and configured.

---

<a id="english"></a>
## 🇬🇧 English

### Why migrate?

WorkBuddy is a great product. It's polished, fast, and has features OpenBuddy is still catching up on. So why switch?

| Reason | Details |
|---|---|
| 🔓 **Open source (MIT)** | Audit every line. No black box. |
| 🔑 **BYOK, any provider** | Use Anthropic, OpenAI, NewAPI, or any OpenAI-compatible API. |
| 🏢 **Self-hostable** | Run on-prem with Casdoor OIDC + NewAPI gateway. |
| 📦 **Plugin SDK** | Extend with Cordis capabilities — no app rebuild. |
| 🧪 **Open test suite** | 309 test files, all visible in the repo. |
| 🌐 **Linux support** | First-class Linux builds. |
| 💾 **Local-first** | Sessions, providers, and audit log all stay on your disk. |

### What's the same

OpenBuddy intentionally mirrors WorkBuddy's UX:

- ✅ Same `--wb-*` design tokens and 207-icon foundation
- ✅ Same Sidebar / HomePage / ChatView / Composer layout
- ✅ Same plan mode, rewind, fork, sub-agent tasks
- ✅ Same slash commands and automations
- ✅ Same notification center
- ✅ Same MCP connector governance
- ✅ Same skills / experts / plugins surface

If you've used WorkBuddy, you'll feel at home in OpenBuddy on day one.

### What changes

| WorkBuddy | OpenBuddy | Notes |
|---|---|---|
| Closed-source license | MIT | Auditable |
| Data goes through Tencent backend | Local-first + your gateway | Provider keys stay on disk (OS keychain) |
| Built-in provider list | Bring-your-own-key | Configure in Settings → Providers |
| macOS / Windows only | Windows / macOS / Linux | AppImage + .deb on Linux |
| Tencent authentication | Casdoor OIDC (or local) | Optional enterprise SSO |
| No plugin SDK | Cordis capability mesh | Write your own `@openbuddy/*` packages |
| No visible tests | 309 test files in the repo | `pnpm workspace:test` |
| Proprietary updates | Open auto-updater | `electron-updater` against GitHub releases |

### Step-by-step migration

#### 1. Export your WorkBuddy data

WorkBuddy stores its data in:

| Data | Location |
|---|---|
| Sessions | `%APPDATA%\WorkBuddy\sessions\` (Windows) / `~/Library/Application Support/WorkBuddy/sessions/` (macOS) |
| Provider keys | OS keychain (encrypted) |
| Skills | `%APPDATA%\WorkBuddy\skills\` |
| MCP configs | `%APPDATA%\WorkBuddy\mcp.json` |
| Experts | `%APPDATA%\WorkBuddy\experts\` |

Use WorkBuddy's "Export" feature (Settings → Data → Export) to dump everything to a `.zip`.

#### 2. Install OpenBuddy

```bash
# Pick your platform
# Windows
winget install openbuddy
# macOS
brew install openbuddy
# Linux
sudo dpkg -i openbuddy_0.15.0_amd64.deb
```

Or download from [GitHub Releases](https://github.com/louloulin/OpenBuddy/releases).

#### 3. Launch & first-run wizard

OpenBuddy's first-run wizard will:

1. Detect any existing WorkBuddy data (if available).
2. Offer to import sessions, skills, experts, and MCP configs.
3. Let you configure your first provider (BYOK).

#### 4. Import your data

In OpenBuddy, go to **Settings → Data → Import** and select your WorkBuddy export `.zip`. OpenBuddy will:

- Copy sessions to `~/.config/openbuddy/sessions/`
- Copy skills to `~/.config/openbuddy/skills/`
- Copy experts to `~/.config/openbuddy/experts/`
- Copy MCP configs to `~/.config/openbuddy/mcp.json`
- Re-encrypt provider keys with the new OS keychain slot

> **Note**: API keys themselves are NOT exported by WorkBuddy. You'll need to re-enter them in OpenBuddy.

#### 5. Re-enter API keys

**Settings → Providers → Add Provider**, then add each provider:

- **Anthropic** — paste your `sk-ant-…` key
- **OpenAI** — paste your `sk-…` key
- **NewAPI** — paste your self-hosted key (BYOK)
- **Custom** — any OpenAI-compatible base URL + key

Keys are encrypted via Electron `safeStorage` and stored in your OS keychain.

#### 6. Verify the migration

For each session you imported:

1. Open the session in OpenBuddy.
2. Check the conversation history is intact.
3. Click "Continue chat" to verify the agent can resume.

For each skill / expert you imported:

1. **Settings → Skills** — verify the skill appears and is enabled.
2. **Settings → Experts** — verify the expert appears.

For MCP connectors:

1. **Settings → MCP Connectors** — verify each server is listed.
2. Click "Test" to verify connectivity.

#### 7. (Optional) Self-host Casdoor + NewAPI

If you want full enterprise control:

1. Self-host Casdoor: <https://casdoor.org/docs/>
2. Self-host NewAPI: <https://github.com/songquanpeng/new-api>
3. Configure OpenBuddy: **Settings → Authentication → Casdoor** and **Settings → Providers → NewAPI** with your instance URLs.

See [`newapi-integration-guide.md`](newapi-integration-guide.md) and [`casdoor-enterprise-auth.md`](casdoor-enterprise-auth.md) for details.

#### 8. Uninstall WorkBuddy

Once everything is verified:

- **Windows**: Settings → Apps → WorkBuddy → Uninstall
- **macOS**: `sudo /usr/local/binwork-un-uninstall` or drag to Trash

You can keep WorkBuddy around for a few weeks as a fallback until you've validated everything in OpenBuddy.

### Feature parity

See [`workbuddy-parity-matrix.md`](workbuddy-parity-matrix.md) for the full matrix. Highlights:

- ✅ Implemented: Plan mode, Rewind, Tasks, Skills, MCP, Experts, Automations, Slash commands, Notification center
- 🚧 In progress: SceneTabs, Pinned sessions, Workspace grouping
- ❌ Not yet: Tencent-specific enterprise features (HRBP integrations, internal SSO with corporate IdP)

### Common questions

#### Will my sessions work offline?

Yes — sessions are stored locally. The agent itself needs network access to call LLM providers, but you can browse and edit sessions offline.

#### Can I run OpenBuddy alongside WorkBuddy?

Yes. They use different data directories (`~/.config/openbuddy/` vs `%APPDATA%\WorkBuddy\`). You can install both and switch.

#### Can I roll back if I don't like OpenBuddy?

Yes. Your WorkBuddy data is untouched. Just uninstall OpenBuddy and re-open WorkBuddy — everything is where you left it.

#### How long does migration take?

- **Personal use, < 100 sessions**: ~15 minutes
- **Team, < 1000 sessions**: ~1 hour + communication overhead
- **Enterprise, > 1000 sessions**: ~1 day + Casdoor SSO setup

#### Is there a CLI migration tool?

For scripted / bulk migration, use the bundled export importer in the Settings panel:

1. **Settings → Data → Export** in your existing WorkBuddy installation.
2. Drop the resulting `.zip` into OpenBuddy's import dialog.
3. OpenBuddy runs the same code paths as the in-app importer.

The `WorkBuddy import` IPC handler is implemented in `electron/main/workbookd-import.ts` (verified by `electron/main/workbookd-import.test.ts`). For team-wide scripted migration, contact `migrate@openbuddy.dev` — we provide a managed import runbook.

### Get help

- **GitHub Discussions**: <https://github.com/louloulin/OpenBuddy/discussions>
- **Discord**: <https://discord.gg/openbuddy>
- **Email (English)**: `migrate@openbuddy.dev`
- **Email (中文)**: `迁移@openbuddy.dev`

---

<a id="简体中文"></a>
## 🇨🇳 简体中文

### 为什么迁移?

WorkBuddy 是个优秀的产品。它精致、快,且有一些 OpenBuddy 还在追赶的特性。那为什么还要切换?

| 原因 | 细节 |
|---|---|
| 🔓 **开源 (MIT)** | 每行都可审计。无黑箱。 |
| 🔑 **自带 Key,任意 Provider** | 用 Anthropic、OpenAI、NewAPI 或任何 OpenAI 兼容 API。 |
| 🏢 **可自托管** | 用 Casdoor OIDC + NewAPI 网关跑在本地。 |
| 📦 **Plugin SDK** | 用 Cordis 能力扩展 —— 无需重建 App。 |
| 🧪 **开放的测试套件** | 309 个测试文件,全部在仓库可见。 |
| 🌐 **Linux 支持** | 一等公民 Linux 构建。 |
| 💾 **本地优先** | 会话、Provider、审计日志全留在你的磁盘上。 |

### 哪些不变

OpenBuddy 故意贴近 WorkBuddy 的 UX:

- ✅ 同样的 `--wb-*` 设计 tokens 与 207 图标基底
- ✅ 同样的 Sidebar / HomePage / ChatView / Composer 布局
- ✅ 同样的 Plan 模式、Rewind、fork、子 Agent 任务
- ✅ 同样的 slash 命令与 automations
- ✅ 同样的通知中心
- ✅ 同样的 MCP 连接器治理
- ✅ 同样的 skills / experts / plugins 表面

用过 WorkBuddy,第一天用 OpenBuddy 就上手。

### 哪些变了

(同英文表格)

### 分步迁移

#### 1. 导出 WorkBuddy 数据

WorkBuddy 数据存在:

| 数据 | 位置 |
|---|---|
| 会话 | `%APPDATA%\WorkBuddy\sessions\`(Windows)/ `~/Library/Application Support/WorkBuddy/sessions/`(macOS) |
| Provider key | OS 钥匙串(加密) |
| Skills | `%APPDATA%\WorkBuddy\skills\` |
| MCP 配置 | `%APPDATA%\WorkBuddy\mcp.json` |
| Experts | `%APPDATA%\WorkBuddy\experts\` |

用 WorkBuddy 的 "Export" 功能(Settings → Data → Export)把全部导出成 `.zip`。

#### 2. 安装 OpenBuddy

```bash
# 按平台
# Windows
winget install openbuddy
# macOS
brew install openbuddy
# Linux
sudo dpkg -i openbuddy_0.15.0_amd64.deb
```

或从 [GitHub Releases](https://github.com/louloulin/OpenBuddy/releases) 下载。

#### 3. 启动 & 首次运行向导

OpenBuddy 首次运行向导会:

1. 检测现有 WorkBuddy 数据(若可用)
2. 询问是否导入会话、skills、experts、MCP 配置
3. 让你配置首个 Provider(BYOK)

#### 4. 导入数据

在 OpenBuddy 中,**Settings → Data → Import**,选 WorkBuddy 导出 `.zip`。OpenBuddy 会:

- 复制会话到 `~/.config/openbuddy/sessions/`
- 复制 skills 到 `~/.config/openbuddy/skills/`
- 复制 experts 到 `~/.config/openbuddy/experts/`
- 复制 MCP 配置到 `~/.config/openbuddy/mcp.json`
- 用新 OS 钥匙串 slot 重新加密 Provider key

> **注意**:WorkBuddy 不导出 API key 本身。你需要在 OpenBuddy 中重新输入。

#### 5. 重新输入 API Key

**Settings → Providers → Add Provider**,加每个 Provider:

- **Anthropic** —— 粘贴 `sk-ant-…` key
- **OpenAI** —— 粘贴 `sk-…` key
- **NewAPI** —— 粘贴自托管 key(BYOK)
- **Custom** —— 任何 OpenAI 兼容 base URL + key

Key 经 Electron `safeStorage` 加密存在 OS 钥匙串。

#### 6. 验证迁移

对每个导入的会话:

1. 在 OpenBuddy 打开会话。
2. 检查对话历史完整。
3. 点 "Continue chat" 验证 Agent 能续上。

对每个导入的 skill / expert:

1. **Settings → Skills** —— 验证 skill 出现并启用。
2. **Settings → Experts** —— 验证 expert 出现。

对 MCP 连接器:

1. **Settings → MCP Connectors** —— 验证每个 server 列出。
2. 点 "Test" 验证连通性。

#### 7.(可选)自托管 Casdoor + NewAPI

想要完全企业掌控:

1. 自托管 Casdoor:<https://casdoor.org/docs/>
2. 自托管 NewAPI:<https://github.com/songquanpeng/new-api>
3. 配置 OpenBuddy:**Settings → Authentication → Casdoor** 与 **Settings → Providers → NewAPI** 填你的实例 URL。

详见 [`newapi-integration-guide.md`](newapi-integration-guide.md) 与 [`casdoor-enterprise-auth.md`](casdoor-enterprise-auth.md)。

#### 8. 卸载 WorkBuddy

一切验证通过后:

- **Windows**:Settings → Apps → WorkBuddy → Uninstall
- **macOS**:`sudo /usr/local/binwork-un-uninstall` 或拖到废纸篓

可以保留 WorkBuddy 几周作为后备,直到 OpenBuddy 全部验证完毕。

### 功能对等

完整矩阵见 [`workbuddy-parity-matrix.md`](workbuddy-parity-matrix.md)。要点:

- ✅ 已实现:Plan 模式、Rewind、Tasks、Skills、MCP、Experts、Automations、Slash 命令、通知中心
- 🚧 进行中:SceneTabs、会话置顶、工作区分组
- ❌ 暂无:腾讯特有的企业特性(HRBP 集成、企业 IdP 内部 SSO)

### 常见问题

#### 我的会话能离线用吗?

可以 —— 会话存在本地。Agent 本身需要网络访问 LLM Provider,但你可以离线浏览和编辑会话。

#### 能同时跑 OpenBuddy 与 WorkBuddy 吗?

可以。它们用不同数据目录(`~/.config/openbuddy/` vs `%APPDATA%\WorkBuddy\`)。可以同时安装,随时切换。

#### 不喜欢 OpenBuddy 能回退吗?

可以。你的 WorkBuddy 数据原封不动。卸载 OpenBuddy,重新打开 WorkBuddy —— 一切还在原地。

#### 迁移要多久?

- **个人,< 100 会话**:约 15 分钟
- **团队,< 1000 会话**:约 1 小时 + 沟通成本
- **企业,> 1000 会话**:约 1 天 + Casdoor SSO 配置

#### 有 CLI 迁移工具吗?

脚本化 / 批量迁移:

```bash
pnpm migrate:workbuddy /path/to/workbuddy-export.zip
```

见上方步骤 3 描述的 in-app import 流。

### 获取帮助

(同英文列表)

---

<div align="center">

**Welcome to the open side. / 欢迎来到开源这端。**

<sub>迁移有困难?开 [Discussion 标签 `migration`](https://github.com/louloulin/OpenBuddy/discussions)。</sub>

</div>
