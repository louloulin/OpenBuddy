# Public Roadmap

> 🌐 **Language / 语言:** [English](#english) · [简体中文](#简体中文)

This is the **public roadmap** for OpenBuddy. It is updated quarterly and reflects what the maintainer team plans to ship in the next 3 release cycles. For the full backlog see [`../TODO.md`](../TODO.md).

**Last updated:** 2026-09-01 · **Next refresh:** 2026-12-01

---

<a id="english"></a>
## 🇬🇧 English

### At a glance

```
2026 Q3 ──────────────────────────────────────────►
   ▲
   │ ✅ v0.15 — Casdoor × NewAPI × OpenBuddy (you are here)
   │ 🚧 v0.16 — Linux builds + permission panel
   │ 🔮 v0.17 — Plugin marketplace + voice input
```

### Themes

We're organizing the roadmap around 5 themes. Each theme is owned by a maintainer.

1. **Open the desktop** — Linux builds, native notifications, accessibility
2. **Power the agent** — better plan mode, rewind UI, prompt caching
3. **Strengthen the mesh** — plugin marketplace, capability versioning
4. **Harden the platform** — code signing, notarization, audit log shipping
5. **Grow the community** — docs i18n, regional meetups, OpenBuddyCon

### v0.16 — Linux first-class (target: 2026 Q4)

| Theme | Item | Status |
|---|---|---|
| 🐧 Linux | AppImage + .deb installers | 🚧 in progress |
| 🐧 Linux | Ubuntu 22.04 / Fedora 38 smoke harness in CI | planned |
| 🔏 Signing | macOS notarization automation | planned |
| 🔏 Signing | Windows EV certificate integration | planned |
| 🪟 Permissions | Permission management panel | planned |
| 🪟 Permissions | Per-session permission overrides | planned |
| 📚 Docs | Japanese, Korean localization | planned |
| 📚 Docs | Architecture deep-dive video | planned |
| 🧪 Tests | Bump to 1,300+ tests | planned |

### v0.17 — Marketplace + Voice (target: 2027 Q1)

| Theme | Item | Status |
|---|---|---|
| 🧩 Marketplace | Public plugin catalog | planned |
| 🧩 Marketplace | One-click install in app | planned |
| 🧩 Marketplace | Capability versioning (semver) | planned |
| 🎤 Voice | Whisper.cpp voice input | planned |
| 🎤 Voice | Kokoro / Piper TTS output | planned |
| 🪟 UX | SceneTabs & skill recommendation bar | planned |
| 🪟 UX | Pinned sessions & workspace grouping | planned |
| 🔎 Search | Cross-session full-text search | planned |
| 🧪 Tests | Bump to 1,500+ tests | planned |

### v0.18 — Multi-agent at scale (target: 2027 Q2)

| Theme | Item | Status |
|---|---|---|
| 🤖 Agents | Distributed Buddy network (rooms, inbox, A2A) GA | planned |
| 🤖 Agents | Cross-agent task graph | planned |
| 🤖 Agents | Evidence audit log shipping to SIEM | planned |
| 🪟 UX | Web companion (read-only session view) | planned |
| 📦 Storage | Local vector store (LanceDB) | planned |
| 🌐 i18n | Spanish, German localization | planned |
| 🧪 Tests | Bump to 1,700+ tests | planned |

### Beyond v0.18

We're tracking longer-horizon ideas in GitHub Discussions with the `roadmap-far` label. Some favorites:

- 📱 **OpenBuddy Mobile** — iOS / Android companion (read-only)
- 🧠 **Local-only mode** — fully offline, no network calls
- 🎨 **Custom themes** — user-contributed `--wb-*` token sets
- 🔬 **Eval suite v2** — GAIA + AgentBench + AgentDojo integration
- 🤝 **Bounty program** — funded issues for high-impact features

### How we choose

Every item on the roadmap has a maintainer sponsor. We evaluate candidates quarterly against:

1. **User impact** — how many active users benefit?
2. **Maintenance cost** — does it add ongoing support burden?
3. **Strategic fit** — does it advance one of the 5 themes?
4. **Community energy** — is there a contributor willing to shepherd it?
5. **Risk** — what's the worst-case blast radius if we get it wrong?

To propose a new item, open a [GitHub Discussion](https://github.com/louloulin/OpenBuddy/discussions) with the `roadmap:` label.

### Recently shipped (last 4 releases)

#### ✅ v0.15 (2026-09-01) — Casdoor × NewAPI × OpenBuddy

- Casdoor OIDC + admin REST
- NewAPI gateway (BYOK + Service Token)
- 4 payment adapters (Stripe / WeChat Pay / Alipay / HMAC)
- SCIM v2 + SAML 2.0
- Admin Portal SPA
- 309 → 400 tests added

#### ✅ v0.14 (2026-08-17) — grok → Pi + moon

- In-process Pi agent over Electron bridge
- 32-project moon DAG monorepo
- Plugin-host + plugin discovery
- Tauri removal (gated by moon migration)

#### ✅ v0.13 (2026-08-03) — Casdoor enterprise auth

- OIDC PKCE
- Tenant policy
- Audit log
- 6 admin REST endpoints

#### ✅ v0.12 (2026-07-20) — Multi-agent foundation

- A2A protocol package
- Room / inbox / task graph
- Cross-agent evidence

### Deprecation policy

Items marked **deprecated** stay functional for at least 2 minor releases before removal. Deprecations are announced in the [CHANGELOG](../CHANGELOG.md) and via the `announce@openbuddy.dev` mailing list.

---

<a id="简体中文"></a>
## 🇨🇳 简体中文

### 一览

```
2026 Q3 ──────────────────────────────────────────►
   ▲
   │ ✅ v0.15 — Casdoor × NewAPI × OpenBuddy(你在这里)
   │ 🚧 v0.16 — Linux 构建 + 权限面板
   │ 🔮 v0.17 — 插件市场 + 语音输入
```

### 主题

我们把路线图围绕 5 个主题组织。每个主题由一位维护者负责。

1. **开放桌面** —— Linux 构建、原生通知、可访问性
2. **强化 Agent** —— 更好的 Plan 模式、Rewind UI、prompt 缓存
3. **巩固能力网格** —— 插件市场、能力版本化
4. **硬化平台** —— 代码签名、公证、审计日志外发
5. **壮大社区** —— 文档 i18n、地区聚会、OpenBuddyCon

### v0.16 — Linux 一等公民(目标:2026 Q4)

| 主题 | 项 | 状态 |
|---|---|---|
| 🐧 Linux | AppImage + .deb 安装包 | 🚧 进行中 |
| 🐧 Linux | CI 中 Ubuntu 22.04 / Fedora 38 smoke harness | 计划 |
| 🔏 签名 | macOS 公证自动化 | 计划 |
| 🔏 签名 | Windows EV 证书集成 | 计划 |
| 🪟 权限 | 权限管理面板 | 计划 |
| 🪟 权限 | 单会话权限覆盖 | 计划 |
| 📚 文档 | 日语、韩语本地化 | 计划 |
| 📚 文档 | 架构深度视频 | 计划 |
| 🧪 测试 | 提到 1,300+ 测试 | 计划 |

### v0.17 — 市场 + 语音(目标:2027 Q1)

| 主题 | 项 | 状态 |
|---|---|---|
| 🧩 市场 | 公开插件目录 | 计划 |
| 🧩 市场 | App 中一键安装 | 计划 |
| 🧩 市场 | 能力版本化(semver) | 计划 |
| 🎤 语音 | Whisper.cpp 语音输入 | 计划 |
| 🎤 语音 | Kokoro / Piper TTS 输出 | 计划 |
| 🪟 UX | SceneTabs 与 Skill 推荐栏 | 计划 |
| 🪟 UX | 会话置顶与工作区分组 | 计划 |
| 🔎 搜索 | 跨会话全文搜索 | 计划 |
| 🧪 测试 | 提到 1,500+ 测试 | 计划 |

### v0.18 — 多 Agent 规模化(目标:2027 Q2)

| 主题 | 项 | 状态 |
|---|---|---|
| 🤖 Agents | Distributed Buddy 网络(rooms、inbox、A2A)GA | 计划 |
| 🤖 Agents | 跨 Agent 任务图 | 计划 |
| 🤖 Agents | 证据审计日志外发 SIEM | 计划 |
| 🪟 UX | Web 伴侣(只读会话视图) | 计划 |
| 📦 存储 | 本地向量库(LanceDB) | 计划 |
| 🌐 i18n | 西语、德语本地化 | 计划 |
| 🧪 测试 | 提到 1,700+ 测试 | 计划 |

### v0.18 之后

我们在 GitHub Discussions 里用 `roadmap-far` 标签跟踪更长远的想法。亮点:

- 📱 **OpenBuddy Mobile** —— iOS / Android 伴侣(只读)
- 🧠 **本地模式** —— 完全离线,无网络调用
- 🎨 **自定义主题** —— 用户贡献的 `--wb-*` token 集
- 🔬 **评测套件 v2** —— GAIA + AgentBench + AgentDojo 集成
- 🤝 **赏金计划** —— 为高价值 Issue 提供资金

### 如何选择

路线图上的每项都有维护者发起人。我们每季度评估候选:

1. **用户影响** —— 多少活跃用户受益?
2. **维护成本** —— 是否带来持续支持负担?
3. **战略契合** —— 是否推进 5 大主题之一?
4. **社区能量** —— 是否有贡献者愿意推进?
5. **风险** —— 最坏情况的影响半径多大?

提出新项:在 [GitHub Discussion](https://github.com/louloulin/OpenBuddy/discussions) 加 `roadmap:` 标签。

### 最近发布(过去 4 个版本)

#### ✅ v0.15(2026-09-01)— Casdoor × NewAPI × OpenBuddy

- Casdoor OIDC + 管理 REST
- NewAPI 网关(BYOK + Service Token)
- 4 个支付适配器(Stripe / WeChat Pay / Alipay / HMAC)
- SCIM v2 + SAML 2.0
- Admin Portal SPA
- 新增 309 → 400 测试

#### ✅ v0.14(2026-08-17)— grok → Pi + moon

- 进程内 Pi Agent 跨 Electron bridge
- 32 工程 moon DAG monorepo
- Plugin-host + 插件发现
- Tauri 移除(在 moon 迁移后)

#### ✅ v0.13(2026-08-03)— Casdoor 企业鉴权

- OIDC PKCE
- 租户策略
- 审计日志
- 6 个管理 REST 端点

#### ✅ v0.12(2026-07-20)— 多 Agent 基底

- A2A 协议包
- Room / inbox / 任务图
- 跨 Agent 证据

### 废弃策略

标记为 **deprecated** 的项在移除前至少保留 2 个次版本。废弃信息在 [CHANGELOG](../CHANGELOG.md) 与 `announce@openbuddy.dev` 邮件列表公布。

---

<div align="center">

**The roadmap is a living document. / 路线图是活的文档。**

<sub>想影响路线图?开 [Discussion 标签 `roadmap:`](https://github.com/louloulin/OpenBuddy/discussions)。</sub>

</div>
