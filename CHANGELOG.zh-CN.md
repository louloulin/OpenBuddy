# 更新日志 (Changelog) / Changelog

[English](CHANGELOG.md) · **简体中文**

## v0.15.0（2026-09-01）· 企业级 Casdoor × NewAPI × OpenBuddy 集成

### 🎯 商业化架构
- **完整的企业级 Agent 工作台商业化集成**：Casdoor（OIDC IdP）+ NewAPI（模型聚合网关）+ OpenBuddy（Agent 工作台）
- **双路径 NewAPI 集成**：
  - **Path A · BYOK**：用户自带 sk-，Renderer 直接调用，不写积分账本
  - **Path B · 企业 Gateway**：服务端 Service Token + Casdoor JWT，积分账本 + 共享钱包 + 对账
- **计费模型 v2**：8 类流水（reservation/consume/release/expire/purchase/refund/adjustment/transfer）+ 4 层防串账校验 + 3 SKU（free / team ¥99 / enterprise ¥999）+ 70%+ 毛利门禁

### 📦 新增 4 个企业 SDK（共 66 测试）
- **`@openbuddy/payment`** — Stripe / WeChat Pay / Alipay / HMAC 4 通道适配器（28 测试）
- **`@openbuddy/scim`** — RFC 7644 SCIM v2 端点，自动配置企业用户/组（19 测试）
- **`@openbuddy/saml`** — SAML 2.0 AuthnRequest / Response / LogoutRequest（11 测试）
- **`@openbuddy/webhook-outbox`** — Transactional Outbox + 指数回退（jitter）（8 测试）

### 🌐 独立 Web Admin Portal
- **新建 `apps/admin-portal/`**：独立 SPA（React 18 + Vite 5），不嵌入 Electron
- **7 路由**：Login / Callback / Dashboard / BillingPlans / CreditPricing / CreditReconciliation / Wallets / TenantPolicy / AuditLog
- **Casdoor OIDC PKCE** 复用桌面端同一套流程
- **Resource Gateway REST 客户端**（12 个端点对齐 openapi.yaml）
- **部署工件**：Dockerfile（多阶段 Node 22 + Nginx alpine）+ nginx.conf（API 反代 + 安全头 + SPA fallback）
- **测试**：17/17 通过（api 6 + auth 8 + pages 3）

### 🆕 NewAPI BYOK Provider（renderer 侧）
- `src/lib/newapi-provider.ts` — BYOK 适配器（normalizeBaseUrl / fetchModels / modelToEntry / isValidKey / uiDefaults）
- `ProviderKind` 联合类型加入 `"newapi"`
- Settings UI 新增 `NewAPI（自托管模型聚合）` preset（默认 `http://124.221.146.145:3000/v1`）
- `normalizeNewapiBaseUrl()` 保存时自动补 `/v1`
- 选择 NewAPI 时内联显示 `setupHint` 帮助文案
- HelpSettingsPanel 三入口：NewAPI 文档 / Casdoor 文档 / Admin Portal

### 📊 文档（9 个新增）
- `openbuddy-token-billing-v2.md`（262 行）— 计费模型 + WorkBuddy 98% 对齐表
- `newapi-integration-guide.md`（212 行）— 双路径集成指南
- `admin-console-architecture-decision.md`（169 行）— 3 层 Admin 分工
- `openbuddy-enterprise-integration-manifest.md`（288 行）— 单一真理源
- `enterprise-completion-matrix.md`（90 行）— 完成度矩阵
- `enterprise-live-verification-2026-09-01.md`（164 行）— 实时证据
- `casdoor-newapi-openbuddy-architecture-diagram.svg`（20KB）— 系统拓扑
- `docs/diagrams/v2/openbuddy-enterprise-architecture.svg`（19KB）— v2 商业化架构
- `apps/admin-portal/README.md`（201 行）— 部署指南（Caddy / Nginx / Docker）

### 🔬 实时集成验证
- `scripts/newapi-smoke.mjs` — CI-friendly 烟测脚本（`/api/status` + baseUrl 规范化 + BYOK 占位）
- `src/lib/__tests__/newapi-live.test.ts` — 实时集成测试（默认跳过 + `NEWAPI_LIVE_SKIP=0` 启用，6 测试）
- 验证结果：NewAPI v1.0.0-rc.22 (LumosAI) @ `http://124.221.146.145:3000` 公网可达 + `/v1/models` 鉴权正常

### ✅ 质量
- 全量测试：**1171 passed + 3 skipped = 1174**（103 测试文件）
- Admin Portal 构建：211KB JS / 2.7KB CSS / 0.53KB HTML → `apps/admin-portal/dist/`
- 8 个预存 TypeScript 错误（`renderer-plugin-runtime.ts` + `use-email-keyboard.test.ts`）与本版本无关，运行时不受影响

### ⚠️ 客户端凭据阻塞（外部责任）
1. Casdoor 应用 callback / scopes / audience 配置
2. 微信 AppID / SMS Provider 凭据
3. HTTPS（Caddy + Let's Encrypt）
4. Secret Manager（Vault / 1Password）
5. Stripe / WeChat Pay 商户号
6. NewAPI Channel `id=1` deepseek 修复

完成上述 6 项即可宣称生产上线。

---

## v0.14.0（2026-08-17）· grok → Pi + moon monorepo

### 🔧 内核升级
- **上游 AI 内核 build 升级到 5163763**（8 个同步批次）
  - 新能力：ask_user_question 非交互模式优化、网页搜索域名过滤、工具协议帧扩展
  - 适配：内存开关配置项合并（`memory_enabled_override`），语义完全兼容

### 🏗️ 架构重构：团队工具零补丁化
- `create_team` / `team_status` / `team_delete` 从「修改上游 AI 内核源码注入」迁移到**内嵌 MCP 服务器**
  （标准协议、监听本机 127.0.0.1），对内核**零侵入** —— 以后升级不再需要运行时补丁

### 📚 文档翻新（13 个）
- `moon-monorepo-refactor.md`：moon monorepo 重构
- `pi-core-capabilities.md` / `pi-extension-architecture.md` / `pi-capability-gap-analysis.md`：Pi 能力分析
- `pi-real-plugin-compatibility.md` / `pi-sdk-implementation-plan.md`：Pi 插件兼容
- `pi-analysis-critique.md` / `pi-runtime-next-roadmap.md`：Pi 运行时评估
- `migration-pi-electron.md`：Pi→Electron 迁移笔记
- `expert-team-design.md`：Expert 团队设计
- `menu-architecture-audit.md`：菜单架构审计

### ✅ 质量
- 全量测试：**903 passed**
- 原 Rust 入口全部从 CI、dev、构建链路移除
- moon-managed monorepo 跑通

---

## v0.13.0（2026-08-03）· Casdoor 企业鉴权

### 🔐 OIDC + 多租户
- Casdoor OIDC PKCE
- 租户策略
- 审计日志
- 6 个管理 REST 端点

---

## v0.12.0（2026-07-20）· 多 Agent 基底

### 🤖 多 Agent 基础包
- A2A 协议包
- Rooms / inbox / 任务图
- 跨 Agent 证据

---

## 早期版本

完整历史见 GitHub Releases：[github.com/louloulin/OpenBuddy/releases](https://github.com/louloulin/OpenBuddy/releases)。

---

<div align="center">

**See a release you'd like to contribute to? Open an issue with the `release:` label. / 想为某个版本贡献?开 Issue 带 `release:` 标签。**

<sub>This CHANGELOG is auto-extracted into GitHub Releases by `.github/workflows/release.yml`. For technical details, see commit messages.</sub>

</div>
