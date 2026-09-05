# OpenBuddy 产品视角 vs PI 分析视角对比矩阵（2026-08-31）

> 本文是 `docs/pi-analysis-critique.md`（PI 方法论批判）与
> `docs/openbuddy-capability-matrix.md`（OpenBuddy 产品力盘点）的**并列补充**，
> 主语从「以 Pi 集成为中心」反转为「以 OpenBuddy 产品 / 用户 / 客户为中心」。
>
> 基线文档：
> - `docs/pi-analysis-critique.md`（561 行）
> - `docs/openbuddy-capability-matrix.md`（630 行）
> - `docs/comet/changes/openbuddy-product-enterprise-audit/brief.md`（A1–A12 验收）
> - `docs/comet/changes/openbuddy-electron-pi-closure/brief.md:35-77`（PI 侧 A1–A15）
>
> 不修改任何源文件；所有论断引用 `文件:行号`。

---

## 0. 文档目的与方法

### 0.1 目的

PI 分析文档族（`pi-capability-gap-analysis.md` / `pi-core-capabilities.md` /
`pi-extension-architecture.md` / `pi-openbuddy-completeness-audit.md` /
`pi-real-plugin-compatibility.md` / `pi-runtime-next-roadmap.md` /
`pi-sdk-implementation-plan.md` / `migration-pi-electron.md` /
`full-pluginization-plan.md`）的主语反复以 **Pi / Pi extension / Pi
session / Pi-native** 为中心组织。`pi-analysis-critique.md:14-19`
总结为：「PI 分析是一份『Pi 集成工程实施记录』，不是『OpenBuddy 产品
路线图』」；`pi-capability-gap-analysis.md:1-9` 的 Goal 写明
"enumerate **every** Pi capability ... map it against every OpenBuddy
feature"，主语始终是 Pi，不是用户。

**本文不重写 PI 文档**，仅产出**并列的产品视角补充**：

1. 把 PI 的「以 Pi 为中心」陈述，按用户 / 客户视角**反转**为「以
   OpenBuddy 产品为中心」（§1 主语反转表，12 维）。
2. 把 PI 的 A1–A15 验收与本 change A1–A12 验收并列对照（§2 验收维度
   对照，10 行）。
3. 把 PI 与 6 份既有产品文档（casdoor / storage / commercial /
   distributed-buddy / expert-team / workbuddy-parity）的 8 类冲突
   显式落入决策表（§3 冲突点决策表，8 行）。
4. 把 `openbuddy-capability-matrix.md:474-494` 的 14 项缺口按
   **影响 × 工作量** 二维矩阵化（§4 差距矩阵）。
5. 把本 change 实施的 P0 4 项（A8–A11）落到具体文件 / 验收命令 / 风险
   （§5）。
6. 把 P1/P2 9 项仅作规划不实施（§6）。

### 0.2 方法

- **不修改源文件**：本文是调查产出，所有结论都引用绝对路径与行号。
- **每个论断都可由源文件复核**：`文件:行号` 是最低引用粒度，关键
  论断附原文片段（不超过 1 行）。
- **优先级口径**：P0 = 影响生产稳定性 / 合规 / 上架；P1 = 影响完整
  产品力；P2 = 增强体验 / DX（口径与 `openbuddy-capability-matrix.md:474`
  一致）。
- **未发现的事实**：统一标 `unknown / not-run`，绝不外推。

### 0.3 与既有产物关系

- `pi-analysis-critique.md`：提供 PI 视角盲点与冲突清单（§4 12 类、
  §6 8 类冲突、§7 10 条改造建议）。本文复用其冲突清单但**仅从产品
  视角补全解决方向**，不重复审计。
- `openbuddy-capability-matrix.md`：提供 OpenBuddy 已实现能力的
  真实证据（§2 能力矩阵、§3 设计系统、§4 企业级、§5 多租户、§6
  架构、§7 可观测性、§8 文档、§9 14 项缺口）。本文**不重写**，
  仅在主语反转表的「OpenBuddy 产品视角」列中**引用其证据**。

---

## 1. 主语反转表

> 列：**维度 / PI 分析视角（以 Pi 为主语） / OpenBuddy 产品视角（以用户 / 客户为主语） / 改造优先级**。
> 每行 PI 侧 1–2 句原文 + 出处；产品侧 1–2 句结论 + 出处。

### 1.1 产品定位与差异化

- **PI 视角**：「OpenBuddy embeds the Pi SDK in Electron main and keeps
  the WorkBuddy renderer as the UI. Pi extensions are therefore an
  agent-runtime extension seam, not a second application plugin system.」
  （`pi-extension-architecture.md:3-7`，引用见
  `pi-analysis-critique.md:29`）。WorkBuddy 在 4 份 PI 文档中仅作为
  "transition source" / "WorkBuddy Renderer" 出现（`pi-analysis-critique.md:209-214`）。
- **OpenBuddy 视角**：OpenBuddy 是 **企业级 AI Agent 桌面工作台**，
  README 写明 "Beyond the personal WorkBuddy-style surface, OpenBuddy
  ships a full enterprise control plane built around Casdoor ... and
  New API"（`README.md:299-411`）。WorkBuddy 是 UI 风格参照系，不是
  产品边界——产品边界由 **12 个企业面板 + 5 种 Casdoor Provider + 4
  个 systemd timer + 40 个 eval 脚本**共同定义
  （`openbuddy-capability-matrix.md:48-53`、`132-143`）。
- **优先级**：**P0**——叙事冲突会让销售 / 用户 / 工程团队三方认知
  错位（`pi-analysis-critique.md:194-198`）。

### 1.2 UX 与一致性（用户旅程 + WorkBuddy 风格保真）

- **PI 视角**：`pi-core-capabilities.md` 全文搜索 "user journey /
  onboarding / first-time / empty state" 均 0 处出现
  （`pi-analysis-critique.md:216-218`）；A1–A15 验收 0 个涉及 UX
  （`pi-analysis-critique.md:88`）。
- **OpenBuddy 视角**：OpenBuddy 已对齐 WorkBuddy 6/6 关键页面（Home /
  ChatView / Composer / Sidebar / Skills / Marketplace，
  `openbuddy-capability-matrix.md:156-188`），且保留 81 个顶层组件 +
  490 个 `--wb-*` 设计令牌 + 207 个图标（同 §3.1）。但
  `WORKBUDDY_UI_REFERENCE.md:108-116` 列 8 个待完善 UI 项，PI 集成
  引入新事件 / 新错误 / 新交互时**未评估其中任何一个对 Pi 集成的依赖**
  （`pi-analysis-critique.md:218`）。
- **优先级**：**P0**——若 "polished" 承诺无法兑现，会冲击 WorkBuddy
  品牌兼容性。

### 1.3 商业模型（计费、套餐、License、企业销售）

- **PI 视角**：`docs/pi-*.md` 全文搜索 "point / credit / wallet /
  SKU / billing / subscription / license / enterprise sale" 均 0 处
  出现（`pi-analysis-critique.md:222-225`）；"What we get for free"
  句式 9 次把 LOC 净下降当商业价值（`pi-core-capabilities.md:162,
  261, 297, 457, 530, 612, 683, 806, 832`，引用见
  `pi-analysis-critique.md:38-44`）。
- **OpenBuddy 视角**：商业模型由 `openbuddy-commercial-model.md` 完整
  定义——`free` / `team` / `enterprise` 三档 SKU（§3），共享钱包 + 成员
  钱包双账户、退款 / 过期 / 对账流水（§3）；
  `services/casdoor-resource-gateway` 提供 25+ `handle*` 端点
  （`openbuddy-capability-matrix.md:11, 49-53`）。
- **优先级**：**P0**——PI 集成 ≠ 可商业化（`pi-analysis-critique.md:226-228`）。

### 1.4 企业级部署（私有化 / SLA / 审计 / 合规）

- **PI 视角**：`docs/pi-*.md` 全文搜索 "SLA / private deployment /
  on-premise / air-gap / SOC2 / ISO 27001 / 审计" 均 0 处出现
  （`pi-analysis-critique.md:230-233`）。
- **OpenBuddy 视角**：`deployment-guide.md`（README:350 引用）是 38 个
  环境变量、Postgres HA / backup / restore、SIEM (syslog / webhook /
  CSV)、Caddy + Let's Encrypt、Alertmanager rules 的 operations manual
  （`pi-analysis-critique.md:233-235`）。OpenBuddy 已落地 `verify-tenant-boundaries.sh`
  85 行 9 probe（`openbuddy-capability-matrix.md:51, 276-290`）。
- **优先级**：**P0**——企业客户无法基于 PI 分析判断合规能力。

### 1.5 多租户与组织管理（团队、角色、SSO、RBAC）

- **PI 视角**：`docs/pi-*.md` 全文搜索 "multi-tenant / RBAC / SSO /
  organization" 均 0 处出现；`team` 仅在 Subagents 章节作 agent
  概念（`pi-analysis-critique.md:237-242`）。
- **OpenBuddy 视角**：Casdoor OIDC + WeChat + SMS + GitHub / Google +
  Email Verification 5 种 Provider（`openbuddy-capability-matrix.md:50,
  132-143`）；12 个企业面板全部上线（`openbuddy-capability-matrix.md:53,
  188-194`）；`tenantContext.activeTenantId` 由 `casdoor-auth.ts:83`
  强制注入（`openbuddy-capability-matrix.md:62, 249-273`）。
- **优先级**：**P0**——PI 集成的「单进程 + Electron Main」假设无法
  满足多租户需求（`pi-analysis-critique.md:241`）。

### 1.6 数据安全与凭据（JSONL vs SQLite、Keychain、凭据隔离）

- **PI 视角**：`pi-openbuddy-completeness-audit.md:282-302` 把 Pi JSONL
  当作 system of record，自承"具备第一段 Harness 风格冷恢复语义
  ... 准备按 session id 独占"。`pi-core-capabilities.md:262-270` 暗示
  BYOK 隔离 bug 类消失 = 无平台风险。
- **OpenBuddy 视角**：`storage-architecture-audit.md:5-21` 明确分层——
  **SQLite = system of record**（catalog / state / migration /
  events / FTS），**Pi JSONL = 兼容 / 审计导入源**（双读 + shadow
  compare + 可回滚），**OS Keychain = API key / OAuth refresh token
  / cookie**（`packages/runtime/openbuddy-storage/src/secrets/secret-store.ts:55-89`）。
- **优先级**：**P0**——数据权威性冲突若不解决，会出现"两套事实源"
  （`pi-analysis-critique.md:335-339`）。

### 1.7 跨平台一致性（macOS / Windows / Linux）

- **PI 视角**：`pi-openbuddy-completeness-audit.md:744` 自承"Windows
  原生 PTY、Linux bubblewrap/Landlock 与真实 `dsh-sandbox-local`
  provider 的严格执行 ... 第三方插件全量矩阵仍需继续完成"。
- **OpenBuddy 视角**：Windows NSIS + MSI + macOS DMG + Linux AppImage
  三平台 `electron-builder.yml` 已配置；`build-windows` + `build-macos`
  在 `release.yml` 真实运行（`openbuddy-capability-matrix.md:236-238,
  390-393`）；Linux AppImage **CI 未自动跑**（`openbuddy-capability-matrix.md:478`）。
- **优先级**：**P0**——Linux CI 缺失会让 AppImage 出包回归无人把关
  （本 change A11）。

### 1.8 可观测性（事件 / 指标 / 审计 / 告警）

- **PI 视角**：A1–A15 验收 0 个涉及"用户首次开通 → 完成首次成功对话
  → 第一次邀请同事 → 第一次续费 → SLA 报告"的旅程验收
  （`pi-analysis-critique.md:16, 88`）；`pi-openbuddy-completeness-audit.md:530-548`
  的"已完成"也只列 6 项技术边界。
- **OpenBuddy 视角**：13 个事件源矩阵（`SessionEventLog` /
  `lifecycle-journal` / `EventStore` / `sync-event-collection` /
  `StorageMetricsRegistry` / 通知 / Casdoor audit / Harness RPC store /
  9 smoke / 40 eval 脚本 / 5 audit / Prometheus 8 指标族 / New API
  circuit metrics / W3C trace context，
  `openbuddy-capability-matrix.md:411-441`）。
- **优先级**：**P1**——技术可观测性已足够，企业级 SLA 报告能力由
  Resource Gateway 的 `/metrics` + `audit_events` + tracing 提供，
  需要新增产品层 SLA 报表 UI。

### 1.9 文档与社区（60 篇文档 + 内/外部分级）

- **PI 视角**：PI 文档族 8 份 + brief.md 2 份，文档主语反复以 Pi 为
  中心；`pi-analysis-critique.md:496-498` 自承 `docs/comet/changes/openbuddy-product-enterprise-audit/brief.md`
  仅空标题 9 行。
- **OpenBuddy 视角**：60 篇 `docs/*.md` + 2 份 HTML 模板
  （`openbuddy-capability-matrix.md:445-456`），且 README 商业定位
  + WORKBUDDY_UI_REFERENCE + `workbuddy-parity-matrix` 已形成外部
  参照系（`pi-analysis-critique.md:506-512` §7.10）。
- **优先级**：**P1**——文档治理（含 brief 不允许空模板）属体验提升。

### 1.10 长演进与债务（LOC / 依赖 / 上游 breaking）

- **PI 视角**：`pi-capability-gap-analysis.md:441` "Net TS LOC added:
  ~3,000. That's the win"；`pi-capability-gap-analysis.md:444` 风险表
  把 "Pi breaking changes" 仅标 Medium / 缓解为 "pin and document"。
- **OpenBuddy 视角**：`openbuddy-capability-matrix.md:557-561` 列 P2
  #12 "DSH 桥接的 stale 引用：`electron/main/agent-host.ts:3150-3180`
  中 21 个 `openbuddy-dsh-*` 包名是迁移期命名，未与 deepseek-harness
  上游版本对齐"。PI 上游 v0.84+ → 2026+ 迭代速度是产品风险
  （`pi-analysis-critique.md:182-189`）。
- **优先级**：**P2**——短期影响低，长期需建立版本兼容矩阵 + 上游变更
  响应 SOP（`pi-analysis-critique.md:7.5`）。

### 1.11 失败模式与边界（fixture vs real-external / 已验证分级）

- **PI 视角**：`pi-openbuddy-completeness-audit.md:113` "由于当前环境
  没有安装 `pi-context-prune`、`pi-mcp-adapter` 或 `pi-web-access`，
  这些外部包的真实第三方 E2E 仍待单独运行，不能由 fixture 证据替代"
  ；但 `pi-real-plugin-compatibility.md:8-22` 的 6 个 Pi 包验证全部标
  为"已验证"，未区分 "profile 安装 + extension 绑定" 与 "实际功能交付"
  （`pi-analysis-critique.md:201-205`）。
- **OpenBuddy 视角**：`openbuddy-capability-matrix.md:53` 给出真实 / 
  fixture / 限制 / 缺口 4 列矩阵，`workbuddy-parity-matrix.md:7-22`
  已有规范「不把 fixture smoke 当成外部模型通过」。OpenBuddy 5 个
  audit 脚本（commercial-model / capability-matrix / official-benchmarks /
  evidence-artifacts / evaluation-suite）跨层级强制校验
  （`openbuddy-capability-matrix.md:441-447`）。
- **优先级**：**P1**——分级阈值 SOP 缺失会让"已通过"含义不一致
  （`pi-analysis-critique.md:206`）。

### 1.12 WorkBuddy 私有能力（不伪造 + 不推测）

- **PI 视角**：`pi-capability-gap-analysis.md:229` "WorkBuddy's
  'inspiration' appears to be: spin up a side session ... We can implement
  it as a Pi extension that calls `pi.sendMessage()`"——直接推测 WorkBuddy
  内部行为；`pi-capability-gap-analysis.md:235` 把 experts.rs + 
  connectors_catalog.rs + skills_catalog.rs 当作"需要 port" 的 gap
  column（`pi-analysis-critique.md:170-178`）。
- **OpenBuddy 视角**：`workbuddy-parity-matrix.md:11` 第 9 行明确
  "WorkBuddy 私有云 / 商业账号：未实现、未伪造、不纳入真实通过项、
  需要公开协议或用户账号授权、**否（不纳入本 change）**"；本 change
  brief 的 Non-goals 同源（`brief.md:21-31`）。
- **优先级**：**P0**——推测 + 排除并存的冲突会让 PI 集成团队基于推测
  实现 inspiration / 团队 / 技能 / marketplace，可能侵犯 WorkBuddy
  版权 / 商业秘密（`pi-analysis-critique.md:175-178`）。

---

## 2. 验收维度对照

> 列：**验收主题 / PI A1–A15 现状 / OpenBuddy 产品 A1–A12（本 change 新增）/ 关系**。
> PI A1–A15 出处：`docs/comet/changes/openbuddy-electron-pi-closure/brief.md:35-77`
> （`pi-analysis-critique.md:88, 495`）；OpenBuddy A1–A12 出处：
> `docs/comet/changes/openbuddy-product-enterprise-audit/brief.md` §
> Acceptance examples。

| # | 验收主题 | PI A1–A15 现状 | OpenBuddy 产品 A1–A12 | 关系 |
| -: | --- | --- | --- | --- |
| 2.1 | 集成工程基线（Electron + IPC + Pi + MiniMax） | A1–A10 全覆盖：Electron 启动 / IPC allowlist / Pi event log / real MiniMax 多轮（`brief.md:35-77`，引用见 `pi-analysis-critique.md:88`） | A12 含 `_electron.launch()` smoke 闭环 + Vitest + typecheck + IPC contract test（`brief.md` §Acceptance A12） | **并列**：PI 验证 IPC 链路；OpenBuddy 验证产物（报告 / HTML / smoke）。不重复也不替代。 |
| 2.2 | 真实 MiniMax 对话验证 | A11 单 LLM 5 轮流式（`brief.md:60`） | A12 含 i18n locale + `agent:mode-set` 5 档切换 + `agent:provider-set` minimax smoke（`brief.md` §A12） | **延伸**：PI 验证 5 轮 base；OpenBuddy 验证 5 档 PermissionMode + minimax 统一后的新 smoke。 |
| 2.3 | 跨分支融合（codex/casdoor/codex-storage/openbuddy） | A12 仅 IPC 维度（`pi-analysis-critique.md:88`） | A8 transformation-plan.html + 4 项 P0 落地 = 跨子系统产品融合（`brief.md` §A8） | **超越**：PI 仅 IPC；OpenBuddy 涵盖 PI × Permission UI × Provider × i18n × CI。 |
| 2.4 | AI Agent 全功能矩阵 smoke | A13 仅 capability → IPC → smoke 维度（`pi-analysis-critique.md:88`） | A5–A7 覆盖核心能力 / 设计系统 / 企业级 3 大矩阵（`brief.md` §A5–A7） | **并列**：PI 列 13 capability；OpenBuddy 列 22 企业能力 + 10 维度评分。 |
| 2.5 | 顶级测试集接入 | A14 AgentBench-tools / AgentDojo-safety / GAIA-style（`brief.md:60`，但 PI 自承 `pi-openbuddy-completeness-audit.md:546` 未单独执行） | A12 全量 Vitest + Electron smoke + IPC contract（`brief.md` §A12） | **独立**：PI 列入但未执行；OpenBuddy 不依赖 PI 验收这条线。 |
| 2.6 | UX 一致性 | **0 个**（`pi-analysis-critique.md:88`） | A5 核心能力矩阵 + A6 设计系统盘点 + A7 企业级能力矩阵（`brief.md` §A5–A7） | **补全**：PI 0；OpenBuddy 6 页面 + 490 令牌 + 207 图标 + 81 组件全部对齐（`openbuddy-capability-matrix.md:159-188`）。 |
| 2.7 | 用户旅程（首次开通 → 首次成功 → 邀请 → 续费 → SLA） | **0 个**（`pi-analysis-critique.md:16`） | A12 smoke 含 `agent:mode-set` + `agent:provider-set` + i18n locale 切换 + Permission UI 5 档（`brief.md` §A12） | **补全**：PI 0；OpenBuddy 通过 IPC + UI smoke 覆盖关键切换点（用户旅程剩余段留给后续 change）。 |
| 2.8 | 商业计费 / Wallet / SKU / 退款 / 过期流水 | **0 个**（`pi-analysis-critique.md:222-225`） | A1 / A2 报告层（critique + matrix）+ A7 企业级矩阵覆盖 Credit / Billing / Wallet / Resource Catalog / Webhook（`openbuddy-capability-matrix.md:188-194`，`brief.md` §A2） | **补全**：PI 0；OpenBuddy 已落地（`services/casdoor-resource-gateway/src/index.ts:2659-2713, 3769-4078, 4078-4213, 4213-4364`，`openbuddy-capability-matrix.md:44-49`）。 |
| 2.9 | 多租户 / RBAC / SSO / Provider | **0 个**（`pi-analysis-critique.md:237-242`） | A7 22 项企业级能力矩阵 + A12 smoke（`brief.md` §A7, A12）；`verify-tenant-boundaries.sh` 9 probe（`openbuddy-capability-matrix.md:51, 276-290`） | **补全**：PI 0；OpenBuddy 5 种 Casdoor Provider + 12 面板 + 9 probe。 |
| 2.10 | 跨平台 parity（Mac/Win/Linux） | **0 个**（`pi-analysis-critique.md:86, 204-205` 仅子节提及 PTY / bubblewrap） | A11 `build-linux` job + macOS 真签名 / 公证草案（`brief.md` §A11） | **新增**：本 change A11 显式补齐 Linux CI 与 macOS 真签名草案。 |
| 2.11 | 数据权威性 / 凭据隔离 | **冲突**：PI 把 Pi JSONL 当 system of record；storage-audit 把 SQLite 当 system of record（`pi-analysis-critique.md:335-339`） | A1 critique + A2 matrix 把冲突显式列入（`brief.md` §A1, A2） | **独立 reconciliation**：PI 与 Storage 各退一步，OpenBuddy 已落地的分层架构是事实源（§3.1）。 |
| 2.12 | 文档 / brief / 治理 | **缺失**：`openbuddy-product-enterprise-audit/brief.md` 仅 9 行空标题（`pi-analysis-critique.md:496-498`） | A8 transformation-plan.html + A1–A4 4 份报告（critique / matrix / vs-pi / transformation-plan） | **新增**：本 change 强制 brief 非空（`pi-analysis-critique.md:498-500` §7.9）。 |

---

## 3. 关键冲突点决策表

> 列：**冲突主题 / PI 侧主张 / 其他文档主张 / 解决方向（接受 PI / 接受 OpenBuddy / 独立 reconciliation）**。
> 8 类冲突直接来自 `pi-analysis-critique.md:559-560` 的总结；其他文档
> 主张引用原文。

| # | 冲突主题 | PI 侧主张 | 其他文档主张 | 解决方向 |
| -: | --- | --- | --- | --- |
| 3.1 | 数据权威性（session transcript） | `pi-openbuddy-completeness-audit.md:282-302` 自承「Pi JSONL 现在已经具备第一段 Harness 风格冷恢复语义 ... 准备按 session id 独占」（引用见 `pi-analysis-critique.md:335-339`） | `storage-architecture-audit.md:5-21`：「JSONL 是 transcript 权威源；SQLite 是 pinned / archived / expert 等 metadata system of record」分层架构（`pi-analysis-critique.md:336`） | **独立 reconciliation**：保留 Pi JSONL 作为兼容 / 审计导入源；OpenBuddy SQLite 接管 catalog / state / events / FTS；`packages/runtime/openbuddy-storage` SQLite-first adapter 已落地（`openbuddy-capability-matrix.md:24-28, 117-122`）。 |
| 3.2 | 多租户 / RBAC / SSO | **0 处出现**「tenant / RBAC / SSO」（`pi-analysis-critique.md:237-242`） | `casdoor-enterprise-auth.md:18-25` 列 5 类 Casdoor Provider（微信开放平台 / 微信公众号 / 阿里云短信 / 腾讯云短信 / GitHub OAuth）+ README:358-380 列 7 个 Provider 模板（`pi-analysis-critique.md:390-393`） | **接受 OpenBuddy**：PI 0 是事实，OpenBuddy Casdoor OIDC + PKCE + JWT + tenantContext.activeTenantId 是事实源（`casdoor-auth.ts:83`，`openbuddy-capability-matrix.md:62`）。 |
| 3.3 | 商业计费 / Wallet / SKU | **0 处出现**「point / credit / wallet / SKU / billing / 财务」（`pi-analysis-critique.md:222-225`） | `openbuddy-commercial-model.md:69-94` §3 套餐和钱包 + `workbuddy-points-system-comparison.md:11-15` 注册即得免费额度 / 过期失效 / 退款 / 过期流水 / 对账 / 自动降级（`pi-analysis-critique.md:394-396`） | **接受 OpenBuddy**：PI 0 是事实；OpenBuddy Resource Gateway 25+ `handle*` 端点 + 共享钱包 + 成员钱包双账户 + CreditLedgerEntry 哈希链（`services/casdoor-resource-gateway/src/index.ts:2659-2713, 3769-4078, 4078-4213, 4213-4364, 4448-4533`）是事实源。 |
| 3.4 | 分布式协作 | `pi-extension-architecture.md:7` 仅 1 段提及「openbuddy-collaboration 插件」（`pi-analysis-critique.md:341-348`） | `distributed-buddy-network-architecture.md` 是 4 个 Phase 的事实源；统一对象模型 `BuddyIdentity → Room → Capability → Task → Policy → Workflow → Evidence → Verification`（`pi-analysis-critique.md:342-345`） | **接受 OpenBuddy**：PI 假设单进程；OpenBuddy 9 个协作包（`@openbuddy/collaboration-room` / `-policy` / `-inbox` / `-task` / `-coordinator` / `-evidence` / `-protocol` / `-network`）覆盖 Room / Policy / Task / Inbox / Coordinator 5 层（`openbuddy-capability-matrix.md:236, 240-244, 247-248`）。 |
| 3.5 | WorkBuddy 私有能力 | `pi-capability-gap-analysis.md:229, 235` 把 experts.rs / connectors_catalog.rs / skills_catalog.rs 当作"需要 port"（`pi-analysis-critique.md:170-178, 355-358`） | `workbuddy-parity-matrix.md:11` 第 9 行「未实现、未伪造、不纳入真实通过项、需要公开协议或用户账号授权、**否（不纳入本 change）**」+ `brief.md:21-31` Non-goals 同源（`pi-analysis-critique.md:170-172`） | **接受 OpenBuddy**：PI 的 "appears to be" 推测与 parity-matrix 的明确排除并存是冲突；遵循 `workbuddy-parity-matrix.md:11` 的「不伪造」边界，禁止 PI 集成团队基于推测实现 inspiration / 团队 / 技能 / marketplace。 |
| 3.6 | 专家 / 技能 / 连接器缓存与路由 | `pi-capability-gap-analysis.md:232-243` §2.8 「agents_list / get / save / delete / template — Port → `~/.pi/agent/agents/*.md`」+ `pi-core-capabilities.md:625-639` Settings `agents: []` + `pi-extension-architecture.md:62-92` Profile packages（`pi-analysis-critique.md:364-368`） | `expert-team-design.md:94-117` §1.5.3 路由配置 + §1.5.4 4 层缓存（本地目录 / Marketplace / 路由配置 / 工作空间）+ §3 G1–G13 13 类差距（场景化首页、置顶会话、同事面板提升、Subagent 硬拦截等，`pi-analysis-critique.md:367-372`） | **独立 reconciliation**：PI 简化版（扁平 markdown）作为底层存储；OpenBuddy 4 层缓存 + 路由配置 + 13 类差距作为产品层语义。`~/.pi/agent/agents/*.md` 与 `~/.workbuddy/plugins/{cache,marketplaces,connectors-marketplace,app/cache/experts,experts/custom,extensions}/` 形成存储与语义映射（`expert-team-design.md:1.5.4`）。 |
| 3.7 | Casdoor Provider & WeChat / SMS | **0 处出现**「WeChat / SMS / OAuth Provider」（`pi-analysis-critique.md:390-392`） | `casdoor-enterprise-auth.md:18-25` 5 类 Provider（微信开放平台 / 微信公众号 / 阿里云短信 / 腾讯云短信 / GitHub OAuth / Google OIDC / 邮箱验证码）+ README:358-380 7 个模板（`pi-analysis-critique.md:390-391`） | **接受 OpenBuddy**：PI 0 是事实；OpenBuddy Casdoor Provider 模板已落地（`docs/casdoor-providers/{github,google,email-verification,wechat-open,wechat-official,alicloud-sms,tencentcloud-sms}.json`，`openbuddy-capability-matrix.md:89`）。 |
| 3.8 | 财务 / 退款 / 过期流水 | **0 处出现**「billing order / refund / expire / financial / 财务」（`pi-analysis-critique.md:394-396`） | `openbuddy-commercial-model.md:124-144` §4 生产发布门禁 + 退款 / 过期 / 对账 / 自动降级 + 财务流水（`pi-analysis-critique.md:394-396`） | **接受 OpenBuddy**：PI 0 是事实；OpenBuddy 订单状态 `pending → paid → refunded` / `pending → expired | failed | cancelled` + CreditLedgerEntry SHA-256 哈希链（`openbuddy-commercial-model.md:§3`）是事实源。 |

---

## 4. 差距矩阵（Gap × 影响 × 工作量 × 优先级）

> 14 项缺口直接取自 `openbuddy-capability-matrix.md:474-494`。
> 影响维度：合规 / 上架 / 产品完整 / DX / 长期；工作量：S ≤ 0.5d /
> M 1–3d / L ≥ 3d（基于 capability-matrix 描述与 brief Constraints）。

| # | 缺口（capability-matrix §9） | 产品影响 | 工程工作量 | 优先级 |
| -: | --- | --- | --- | --- |
| 4.1 | P0#1 macOS 签名 + 公证自动流水线（`openbuddy-capability-matrix.md:476`） | 影响上架 + 公证完整性；脚本守护未自动化（`scripts/check-macos-signing.mjs`） | **M**（新增 `macos-latest` runner + 真签名 job + notarize） | **P0**（本 change A11） |
| 4.2 | P0#2 `minimax` vs `minimax_cn` 双轨（`openbuddy-capability-matrix.md:477`） | 用户认知 + Provider UI 出现两条 MiniMax 入口；`agent-host.ts.bak` 与 `agent-host.ts` 不一致 | **S**（单 Kind `minimax` + `minimax_cn` 仅作 alias） | **P0**（本 change A9） |
| 4.3 | P0#3 Linux CI 缺失（`openbuddy-capability-matrix.md:478`） | AppImage 出包回归无人把关；`moon.yml electron.build.linux` 任务未触发 | **S**（新增 `build-linux` job + AppImage 校验） | **P0**（本 change A11） |
| 4.4 | P0#4 Permission UI 仅 3 档（`openbuddy-capability-matrix.md:479`） | Pi 原生 5 档（`default/acceptEdits/dontAsk/plan/bypassPermissions`）仅暴露 ask/auto/always-approve；Plan / Bypass 不可用 | **M**（PermissionPicker 扩档 + `permission:mode-get/set` IPC） | **P0**（本 change A8） |
| 4.5 | P0#5 `_section-credit-expiry.sh` 抽出（`openbuddy-capability-matrix.md:480`） | CHANGELOG v0.15.0 §9 已记录但目录未独立化（`scripts/audit-commercial-model.mjs` 已存在） | **S**（独立脚本 + 单测） | **P1**（升级自原 P0，因 audit 兜底已就位） |
| 4.6 | P1#6 i18n 资源缺失（`openbuddy-capability-matrix.md:484`） | renderer 仅少量助手文案 + `assistant-badges.ts`；缺 zh-CN / en-US 资源文件 | **M**（≥ 80 key + `src/lib/i18n.ts` + 10 个组件消费） | **P0**（本 change A10） |
| 4.7 | P1#7 `dist/` 与 `out/` 双目录（`openbuddy-capability-matrix.md:485`） | 出包构建混淆；`dist/` 历史内容是否保留需要厘清 | **S**（`git ls-files dist/` + 文档说明） | **P2**（DX / 长期治理） |
| 4.8 | P1#8 Voice / 视频 多模态弱（`openbuddy-capability-matrix.md:486`） | `voice-contract.ts` 仅接口；视频无内置播放器 | **L**（voice streaming + video player） | **P1** |
| 4.9 | P1#9 Linux 场景标签 + 技能推荐栏部分 TODO（`openbuddy-capability-matrix.md:487`） | `WORKBUDDY_UI_REFERENCE.md §6` 列 5 项待完善中的搜索 / 动画未实现 | **M**（搜索 + 动画） | **P1** |
| 4.10 | P1#10 `app-icon.png` 仍为原 WorkBuddy 借用图（`openbuddy-capability-matrix.md:488`） | 品牌 / 上架；527 KB PNG | **S**（替换 + 多尺寸 export） | **P1** |
| 4.11 | P2#11 设计令牌 SCSS 真源缺失（`openbuddy-capability-matrix.md:491`） | `tokens.css` 单文件 490+ 行膨胀 | **L**（SCSS 真源 + `scripts/build-tokens.ts`） | **P2** |
| 4.12 | P2#12 DSH 桥接 stale 引用（`openbuddy-capability-matrix.md:492`） | `agent-host.ts:3150-3180` 中 21 个 `openbuddy-dsh-*` 包名未与 deepseek-harness 上游对齐 | **M**（版本兼容矩阵） | **P2** |
| 4.13 | P2#13 `xai` 排除未文档化（`openbuddy-capability-matrix.md:493`） | `agent-host.ts:4608` 显式排除 xai 但 README 未说明原因 | **S**（README 1 段说明） | **P2** |
| 4.14 | P2#14 Casdoor 默认 issuer 硬编码（`openbuddy-capability-matrix.md:494`） | `casdoor-auth.ts:30` 默认 `http://124.221.146.145:8000`；dev / prod 未区分 | **S**（环境变量切换） | **P2** |

**矩阵化结论**：本 change 优先实施 4 项 P0（4.1 / 4.3 macOS+Linux CI、4.2 minimax、4.4 Permission UI、4.6 i18n），其余 10 项归 §6 P1/P2 路线。

---

## 5. P0 改造路线（本 change 实施）

> 本 change brief 验收映射：A8 = §5.1、A9 = §5.2、A10 = §5.3、A11 = §5.4。
> 每项 1 节，含现状证据（文件:行号）/ 改造范围 / 验收命令 / 已知风险。

### 5.1 A8 — Permission UI 5 档对齐

#### 现状证据

- Pi 原生 5 档 `default / acceptEdits / dontAsk / plan / bypassPermissions`
  定义于 `packages/auth/openbuddy-permission/src/index.ts:43-54`
  （`openbuddy-capability-matrix.md:18-20, 92-93`）。
- 当前 renderer 收成 3 档：`MODES = ask / auto / always-approve`
  （`src/components/PermissionPicker.tsx:22-26`，引用见
  `openbuddy-capability-matrix.md:92`、`559`）。
- `src/lib/agent/pi-client.ts:1666-1675` 同步只暴露 3 档（`openbuddy-capability-matrix.md:76`）。
- 缺失档：`bypassPermissions / plan / dontAsk / acceptEdits`（`openbuddy-capability-matrix.md:479`）。

#### 改造范围

- 文件级：
  - `src/components/PermissionPicker.tsx`：5 档 MODES + 弹层 UI
  - `src/components/PermissionDialog.tsx`：Pi 风格权限弹窗触发按钮文案更新
  - `src/lib/agent/pi-client.ts:1666` 附近：renderer PermissionMode 3 → 5 档迁移
  - `electron/main/ipc/index.ts`：新增 `permission:mode-get` / `permission:mode-set` handler
  - `electron/main/pi-event-bridge.ts`：permission 事件 5 档映射
- 不动：`packages/auth/openbuddy-permission/src/index.ts`（5 档类型签名保持）
- 不引入废弃名 `ask / auto / always-approve` 在 UI / IPC 边界（brief Constraints）

#### 验收命令

```bash
pnpm typecheck
pnpm workspace:typecheck
pnpm build
pnpm test
pnpm electron smoke   # 含 agent:mode-set 5 档切换
```

#### 已知风险

- `src/lib/agent/pi-client.ts:1666-1675` 与 `electron/main/agent-host.ts` 旧
  `ask / auto / always-approve` 引用需 grep 全面排查，避免遗漏 IPC 边界
  字符串。
- 5 档语义差异（`acceptEdits` 自动批 / `bypassPermissions` 高风险 /
  `dontAsk` 静默）需在 UI 显式区分，避免用户误用。

### 5.2 A9 — `minimax` / `minimax_cn` Provider 统一

#### 现状证据

- `ProviderKind` 联合类型覆盖 `minimax` + `minimax_cn` 双轨
  （`src/lib/agent/pi-client.ts:1204-1214`，`openbuddy-capability-matrix.md:48, 128-131`）。
- `electron/main/agent-host.ts:4611-4613` 当前仅识别 `minimax_cn`
  （`openbuddy-capability-matrix.md:130`），`.bak` 文件保留旧 `id.startsWith("minimax-") ? "minimax"` 映射（`openbuddy-capability-matrix.md:129, 477`）。
- `electron/main/ipc/index.ts:2365-2377` 嗅探 `anthropic / custom_anthropic / minimax_cn`
  自动切 header（`openbuddy-capability-matrix.md:135`）。

#### 改造范围

- 文件级：
  - `electron/main/agent-host.ts:4605-4635`：`providerKind` 推导从
    `[..., "minimax_cn", ...]` 改为 `[..., "minimax", ...]`
  - `electron/main/agent-host-provider-registry.ts`：`ProviderRegistryRecord`
    kind 字段统一
  - `electron/main/ipc/index.ts:2365-2377`：`minimax_cn` 嗅探迁移为 `minimax`
  - `src/lib/agent/pi-client.ts:1204-1214`：`ProviderKind` 联合类型 + UI label
  - `README.md` / `CHANGELOG.md` / `Settings UI`：文案统一为 "MiniMax"
- 保留：`minimax_cn` 仅作遗留 alias（不在 UI 出现），brief Constraints
  显式禁止出现在 Settings UI / 主入口 / Provider label / CHANGELOG 用户可见处。

#### 验收命令

```bash
pnpm typecheck
pnpm workspace:typecheck
pnpm build
pnpm test
pnpm electron smoke   # 含 agent:provider-set minimax
```

#### 已知风险

- 旧 Provider 配置（`minimax_cn` 字面量）需兼容映射，避免用户配置迁移
  时丢数据。
- OpenAI-compatible 协议默认 base URL 不可破坏（brief Constraints）。
- README「MiniMax / Anthropic / OpenAI / DeepSeek / 自定义 OpenAI-compatible」
  叙述需同步统一（`openbuddy-capability-matrix.md:477`）。

### 5.3 A10 — renderer i18n 基础（zh-CN / en-US, ≥ 80 key）

#### 现状证据

- `src/` 仅少量助手文案 + `assistant-badges.ts` key 抽象
  （`openbuddy-capability-matrix.md:199`）。
- 缺完整 zh-CN / en-US 资源文件（`openbuddy-capability-matrix.md:484`）。
- 无 `src/lib/i18n.ts` 单文件、无 `src/locales/{zh-CN,en-US}.json`
  资源（`openbuddy-capability-matrix.md:199, 484`）。

#### 改造范围

- 文件级：
  - 新建 `src/lib/i18n.ts`（`t(key, locale)` + `useLocale()` hook +
    `localStorage` 持久化，默认 `zh-CN`）
  - 新建 `src/locales/zh-CN.json`、`src/locales/en-US.json`（**≥ 80 key**）
  - 至少 10 个关键组件消费 i18n key：
    `PermissionPicker`、`ConversationList`、`PinnedSection`、`SceneTabs`、
    `SkillCard`、`Composer`、`MarketplaceCard`、`TenantMembersPanel`、
    `BillingPanel`、`AboutDialog`（brief A10）
- 不引入 `react-i18next` / `lingui` 等运行时 i18n 框架（brief Constraints，
  避免 bundle + 配置复杂度）

#### 验收命令

```bash
pnpm typecheck
pnpm workspace:typecheck
pnpm build
pnpm test
pnpm electron smoke   # 含 i18n locale 切换 + 默认 zh-CN 渲染
```

#### 已知风险

- 文案中英翻译一致性需逐 key 校对（≥ 80 key 工作量约 1d）。
- 默认 locale `zh-CN` + 切换 `localStorage` 持久化需在 PermissionPicker
  等组件的 5 档迁移同步推进（避免同 PR 内 UI 文案硬编码）。

### 5.4 A11 — Linux CI + macOS 真签名 / 公证草案

#### 现状证据

- `electron-builder.yml linux.target: AppImage[x64]` 已配置
  （`openbuddy-capability-matrix.md:392-393`）；`moon.yml electron.build.linux`
  task 已声明（`openbuddy-capability-matrix.md:393, 478`）。
- `.github/workflows/release.yml` 218 行：ci → build-windows → build-macos →
  publish-release，**无 build-linux job**（`openbuddy-capability-matrix.md:444-447, 478`）。
- macOS：`hardenedRuntime: true` + `notarize: true` 已配置；
  `scripts/check-macos-signing.mjs` 仅守护环境变量，**未自动化真签名 + notarize job**
  （`openbuddy-capability-matrix.md:237, 476`）。

#### 改造范围

- 文件级：
  - `.github/workflows/release.yml`：新增 `build-linux` job
    （`ubuntu-latest` + `moon run openbuddy:electron.build.linux` + AppImage 校验）
  - `.github/workflows/release.yml`：macOS job 补充 `macos-latest`
    真签名 + notarize 步骤草案（secrets 列表：
    `CSC_LINK` / `CSC_KEY_PASSWORD` / `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`）
  - 新建 `docs/release-ci.md`：完整 CI 矩阵描述（ci / build-windows /
    build-macos / build-linux / publish-release）
- 范围：Linux CI 仅作为 build 验收任务，**不要求 macOS-only 签名 / 公证步骤
  在 Linux 上跑通**（brief Constraints）

#### 验收命令

```bash
pnpm typecheck
pnpm build
# CI 验证（推送后）：
# - build-linux job 跑通且产出 AppImage artifact
# - macOS job 草案注释 + secrets 列表完整
```

#### 已知风险

- 真签名 / notarize 需要 Apple Developer 账号 + 证书，CI secrets 配置
  错误会让 macOS job 失败；草案需明确"无 secrets 时跳过 notarize"。
- Linux AppImage 在 macOS 兼容层不可跑，CI 矩阵必须 ubuntu-latest。
- `build-linux` 与 `build-macos` / `build-windows` job 并行时间窗需评估，
  publish-release job 依赖三者全部完成。

---

## 6. P1/P2 路线（本 change 不实施，仅规划）

> 共 9 项：capability-matrix §9 的 P1#5（4.5）+ P1#7–10（4.7–4.10）+ P2#11–14
> （4.11–4.14）。P0#1（macOS）+ P0#3（Linux）的扩展部分（Linux 标签栏 /
  推荐栏 + macOS 草案补强）也归此处。

### 6.1 P1（5 项）

1. **P1#5 `_section-credit-expiry.sh` 独立化**（`openbuddy-capability-matrix.md:480`）：
   抽 CHANGELOG v0.15.0 §9 引用为 `scripts/section-credit-expiry.sh` 独立脚本 + 单测，
   工作量 S；当前 `scripts/audit-commercial-model.mjs` 已兜底，可下个 release 窗口补齐。
2. **P1#8 Voice / 视频多模态补强**（`openbuddy-capability-matrix.md:486`）：
   `voice-contract.ts` 加 streaming 集成 + 内置视频播放器；工作量 L；需独立 change。
3. **P1#9 Linux 场景标签 + 技能推荐栏 TODO**（`openbuddy-capability-matrix.md:487`）：
   `WORKBUDDY_UI_REFERENCE.md §6` 列 5 项待完善中的搜索功能 + 更多动画；
   工作量 M；与 Linux sidebar 适配同步。
4. **P1#10 `app-icon.png` 替换**（`openbuddy-capability-matrix.md:488`）：
   527 KB WorkBuddy 借用图换 OpenBuddy 标识 + 多尺寸 export；
   工作量 S；上架前必做。
5. **P1 可观测性 SLA 报告 UI**：基于 Resource Gateway `/metrics` +
   `audit_events` + W3C trace（`openbuddy-capability-matrix.md:439-441`）；
   工作量 L；企业 SLA 合同必备。

### 6.2 P2（4 项）

6. **P2#11 设计令牌 SCSS 真源**（`openbuddy-capability-matrix.md:491`）：
   `tokens.css` 单文件 490+ 行膨胀，引入 SCSS 真源 + `scripts/build-tokens.ts`；
   工作量 L；DX 提升。
7. **P2#12 DSH 桥接版本兼容矩阵**（`openbuddy-capability-matrix.md:492`）：
   `agent-host.ts:3150-3180` 21 个 `openbuddy-dsh-*` 包名与 deepseek-harness
   上游版本对齐；工作量 M；长期债务治理。
8. **P2#13 `xai` 排除文档化**（`openbuddy-capability-matrix.md:493`）：
   `agent-host.ts:4608` 显式排除 xai 但 README 未说明原因；工作量 S。
9. **P2#14 Casdoor 默认 issuer 环境变量切换**（`openbuddy-capability-matrix.md:494`）：
   `casdoor-auth.ts:30` 硬编码 `http://124.221.146.145:8000`；工作量 S；
   区分 dev / prod。

---

## 7. 证据索引

> 每条论断引用具体 `文件:行号`。本文论断 ≥ 30 个引用。

1. `pi-analysis-critique.md:14-19` — PI 分析是 Pi 集成工程实施记录
2. `pi-analysis-critique.md:16` — 验收体系过度集中在 IPC / 桥接 / Pi-原语 / MiniMax smoke
3. `pi-analysis-critique.md:88` — A1-A15 中 0 个 acceptance 涉及 UX / 用户旅程 / 商业计费 / 企业 SLA / 多租户 RBAC / 跨平台 parity / 销售就绪度
4. `pi-analysis-critique.md:7.5` §7.5 — 改造建议：增加 Product Risks 与上游风险章节
5. `pi-analysis-critique.md:182-189` §3.8 — Pi 上游 breaking change 风险
6. `pi-analysis-critique.md:194-198` §3.10 — Pi 适配层 vs 企业级平台两种定位并存
7. `pi-analysis-critique.md:201-205` §3.11 — 已验证 / real-external / real-local / fixture-only 分级阈值不一致
8. `pi-analysis-critique.md:209-214` §4.1 — 产品定位与差异化盲点
9. `pi-analysis-critique.md:216-218` §4.2 — 用户旅程与 UX 一致性盲点
10. `pi-analysis-critique.md:222-225` §4.3 — 商业模型盲点
11. `pi-analysis-critique.md:230-233` §4.4 — 企业级部署盲点
12. `pi-analysis-critique.md:237-242` §4.5 — 多租户与组织管理盲点
13. `pi-analysis-critique.md:170-178` §3.9 — WorkBuddy 私有能力推测与排除并存
14. `pi-analysis-critique.md:335-339` — PI JSONL vs SQLite catalog-first 数据权威性冲突
15. `pi-analysis-critique.md:341-348` — 分布式协作冲突
16. `pi-analysis-critique.md:355-358` — WorkBuddy 私有能力冲突
17. `pi-analysis-critique.md:364-368` — 专家 / 技能 / 连接器缓存与路由语义冲突
18. `pi-analysis-critique.md:390-393` — Casdoor Provider & WeChat / SMS 冲突
19. `pi-analysis-critique.md:394-396` — 月度 / 财务 / 退款 / 过期流水冲突
20. `pi-analysis-critique.md:495-498` §7.9 — brief.md 必须包含具体内容，不允许空模板
21. `pi-analysis-critique.md:559-560` §9 — 8 类显式冲突总结
22. `openbuddy-capability-matrix.md:18-20` — PermissionMode 5 档类型定义
23. `openbuddy-capability-matrix.md:48` — ProviderKind 联合类型 10 类
24. `openbuddy-capability-matrix.md:53` — 12 个企业面板全部上线
25. `openbuddy-capability-matrix.md:62, 249-273` — 多租户权限架构
26. `openbuddy-capability-matrix.md:89, 199` — Casdoor Provider 模板 + i18n 缺口
27. `openbuddy-capability-matrix.md:117-122` — 凭据存储分层
28. `openbuddy-capability-matrix.md:128-135` — Provider 10 类现状
29. `openbuddy-capability-matrix.md:156-188` — WorkBuddy UI 6/6 页面对齐
30. `openbuddy-capability-matrix.md:236-238, 390-393` — 跨平台支持矩阵
31. `openbuddy-capability-matrix.md:411-441` — 13 事件源矩阵
32. `openbuddy-capability-matrix.md:445-456` — 60 篇文档 + 2 HTML 模板
33. `openbuddy-capability-matrix.md:474-480` — §9 P0 5 项缺口
34. `openbuddy-capability-matrix.md:484-488` — §9 P1 5 项缺口
35. `openbuddy-capability-matrix.md:491-494` — §9 P2 4 项缺口
36. `openbuddy-capability-matrix.md:557-561` — 一句话总结（含 P0/P1/P2 摘要）
37. `openbuddy-capability-matrix.md:611-619` — §11 关键数据快照（IPC 474 / 309 test / 125 docs / 490 tokens / 207 icons）
38. `workbuddy-parity-matrix.md:11` — WorkBuddy 私有云 / 商业账号不纳入本 change
39. `storage-architecture-audit.md:5-21` — SQLite = system of record / Pi JSONL = 兼容层
40. `openbuddy-commercial-model.md:69-94, 124-144` — 套餐 / 钱包 / 生产发布门禁
41. `casdoor-enterprise-auth.md:18-25` — 5 类 Casdoor Provider
42. `distributed-buddy-network-architecture.md:6-40` — 统一对象模型 + Phase 1 local-first
43. `expert-team-design.md:94-117` §1.5.3-1.5.4 — 路由配置 + 4 层缓存 + G1-G13
44. `workbuddy-points-system-comparison.md:11-15` — 免费额度 / 过期失效 / 退款
45. `packages/auth/openbuddy-permission/src/index.ts:43-54` — 5 档 PermissionMode 定义
46. `src/components/PermissionPicker.tsx:22-26` — 3 档 MODES（`ask / auto / always-approve`）
47. `electron/main/agent-host.ts:4611-4613` — `minimax_cn` 默认映射
48. `services/casdoor-resource-gateway/src/index.ts:2659-2713, 3769-4078, 4078-4213, 4213-4364, 4448-4533` — 25+ `handle*` 端点
49. `services/casdoor-resource-gateway/src/index.ts:469-475` — Prometheus 8 指标族 + W3C trace
50. `scripts/verify-tenant-boundaries.sh:1-85` — 9 个 probe
51. `scripts/check-macos-signing.mjs` — CI 守护签名（仅校验环境变量）
52. `.github/workflows/release.yml:1-218` — ci / build-windows / build-macos / publish-release
53. `moon.yml` `electron.build.linux` — task 已声明
54. `electron-builder.yml` `linux.target: AppImage[x64]` — 已配置
55. `packages/runtime/openbuddy-storage/src/secrets/secret-store.ts:55-89` — `PlatformKeychainSecretStore`
56. `pi-extension-architecture.md:3-7` — 「keeps the WorkBuddy renderer as the UI」原文
57. `pi-capability-gap-analysis.md:1-9` — Goal 主语是 Pi
58. `pi-capability-gap-analysis.md:441` — 「Net TS LOC added: ~3,000. That's the win」
59. `pi-core-capability.md:162, 261, 297, 457, 530, 612, 683, 806, 832` — 9 次 "What we get for free"
60. `pi-openbuddy-completeness-audit.md:113` — fixture ≠ real-external 声明
61. `pi-openbuddy-completeness-audit.md:282-302` — Pi JSONL 冷恢复语义自承
62. `pi-openbuddy-completeness-audit.md:530-548` — 6 项技术边界"已完成"
63. `pi-openbuddy-completeness-audit.md:543, 544, 546, 732, 741, 744` — 自承剩余边界
64. `pi-openbuddy-completeness-audit.md:575` — 「Pi-first 的 OpenBuddy 适配层」自承
65. `docs/comet/changes/openbuddy-electron-pi-closure/brief.md:35-77` — PI A1-A15 acceptance
66. `docs/comet/changes/openbuddy-product-enterprise-audit/brief.md` §Acceptance A1-A12
67. `README.md:299-411` — 「Beyond the personal WorkBuddy-style surface ... twelve enterprise control planes」
68. `README.md:358-380` — 7 个 Provider 模板 + import script
69. `WORKBUDDY_UI_REFERENCE.md:108-116` — 8 个待完善 UI 项
70. `WORKBUDDY_UI_REFERENCE.md:200-221` — Composer 结构 + 已完成 / 待完善

> 索引说明：`1-21` 引用 `pi-analysis-critique.md`；
> `22-38` 引用 `openbuddy-capability-matrix.md`；
> `39-44` 引用冲突解决方向对应的其他文档；
> `45-54` 引用具体源码 / 配置 / 脚本；
> `55-70` 引用 PI 侧源文档 + README / UI Reference 外部参照系。

---

## 8. 总结

PI 分析（8 份 PI 文档族 + `openbuddy-electron-pi-closure/brief.md` 的
A1–A15）的主语反复以 Pi 框架为中心，把 "Pi 提供的能力" 等同于
"OpenBuddy 应该做什么"，把 LOC 净下降当作商业价值，把单 LLM MiniMax
5 轮 smoke 当作产品验证。它与 `storage-architecture-audit` /
`casdoor-enterprise-auth` / `openbuddy-commercial-model` /
`distributed-buddy-network-architecture` / `workbuddy-parity-matrix` /
`workbuddy-points-system-comparison` / `expert-team-design` 等已有产品
/ 企业级分析存在 8 类显式冲突，15 项错误假设或夸大承诺，12 类盲点。

`openbuddy-capability-matrix.md`（630 行）从源码 / 配置 / 脚本 / 测试 /
文档 5 个维度盘点 OpenBuddy 已实现能力：10 维度评分 4.62/5、490 个
`--wb-*` 设计令牌、207 个图标、81 个顶层组件、474 个 IPC handler handler、
309 个测试文件、43 个 eval 脚本、12 个企业面板、5 种 Casdoor Provider、
4 个 systemd timer、60 篇文档、5 P0 + 5 P1 + 4 P2 缺口清单。

本文（`openbuddy-product-vs-pi.md`）不重写 PI 文档，仅做主语反转：§1
12 维反转表 + §2 10 行验收对照 + §3 8 类冲突决策 + §4 14 项差距矩阵
+ §5 4 项 P0 改造（A8–A11）实施范围 + §6 9 项 P1/P2 路线。

**所有论断均可由 §7 证据索引的 `文件:行号` 复核**；本文未修改任何源
文件，符合本 change brief 的 Non-goals。
