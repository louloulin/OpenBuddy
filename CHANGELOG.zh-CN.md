# 更新日志 (Changelog) / Changelog

[English](CHANGELOG.md) · **简体中文**

## v0.16.0（2026-09-22）· 微内核槽位收口 × 插件信任 × 自更新桌面端

### 🧩 微内核槽位面「零悬挂」

- **所有声明过的槽位都有消费者**：`placeholder.*` 家族 11 个 + 最后 4 个 dead 槽（整壳替换 / 更新摘要 / 反馈 / 数据目录）全部接线，「声明了却没人消费」归零
- **新增槽位三态审计**（`scripts/ui-slot-coverage.mjs` + `ui-slot-audit.mjs`）：静态扫描「声明 → 注册 → 消费」，并加 CI 守卫 —— 出现类型漏洞或接线回退就失败
- **槽位驱动的界面**：Office 三件套预览接管、`editor.draft` 新建草稿入口（`⌘⇧D`）、`view` / `approvals` 会话面、右侧助理导轨、`files.tree` 虚拟化、`⌘K` 与 Composer `/` 菜单里的 `plugin.command`
- **微内核健康面板**：设置 → 系统信息（注册 / 消费 / 缺失计数，并修掉 `size()` / `snapshot()` 差 1 的 bug）

### 🔐 插件信任与真正可用的市场

- **插件完整性徽章**：新增浏览器安全的 `plugin:hash-content` IPC 桥 + OpenBuddy 插件面板里的 SHA-256 徽章，插件身份在运行前可见
- **Pi 扩展市场**：多源索引（宿主 / 环境变量 / 文件）、源管理 UI（增删改 + 探活）、逐条目动作谓词、卸载、目录搜索与过滤
- **Expert Marketplace Bridge**：专家卡片加「在 pi.dev 查看」链接；远端专家贡献真的会被解析，不再静默渲染空态
- **内置起步专家**：仓库内起步专家目录在首启物化到 `<agentHome>/experts`，开源首启不再依赖外部 WorkBuddy 数据目录

### 🔄 自动更新与隐私

- **`electron-updater` 在应用启动时接通**：`publish:` 块驱动更新源；更新事件写日志并广播到渲染窗口。`autoDownload=false`（不偷跑流量），`autoInstallOnAppQuit=true`
- **未签名 DMG 构建档**（`electron-builder.unsigned.yml`）：没有 Developer ID 的贡献者也能本地出 macOS 包
- **隐私面**：`docs/PRIVACY.md` 打包为 `extraResources/PRIVACY.md` 并接入帮助菜单、设置里新增 AI 隐私区块、provider 测试状态本地化

### 🏗️ 架构：渲染层契约收敛到单一来源

- **4 个契约包** —— `@openbuddy/ui-contract`、`@openbuddy/platform`、`@openbuddy/agent-rpc`、`@openbuddy/ui-state` —— 以 `package.json#exports` 作为别名的唯一真源
- **模块迁移**：约 76 个渲染层模块从 `src/lib` 迁入契约包；改写后的导入由扫描器校验（破坏 `pi-client` 兄弟导入的批次被回滚，而不是硬着头皮落地）
- **tsconfig 收拢**：67 个包级 `tsconfig.json` 缩成 `{ "extends": "…/tsconfig.package-base.json" }`；`vite` / `electron-vite` / `vitest` 统一用 `vite-tsconfig-paths` 派生别名，`scripts/sync-ui-aliases.mjs` 与 `packages/ui/alias-list.json` 随之删除
- **`pnpm-workspace.yaml` glob 修复**：扁平包（`packages/payment`、`packages/saml`、`packages/scim`、`packages/webhook-outbox`）此前被静默排除在 workspace 之外，现在用裸目录 glob 正确匹配

### 📦 构建产物迁移到 `dist/`

- **唯一构建输出目录**：`electron-vite` 写 `dist/{main,preload,renderer}`，`electron-builder` 从它打包，`package.json#main` 指向 `./dist/main/index.js`；旧的 `out/` 从配置、`moon.yml` 输入输出、`.gitignore`、发布脚本中全部移除
- **删除 134 个游离编译产物**：`src/*.ts`、`__tests__/*.test.ts` 旁边的 `.js`（早期 `tsc -b` 实验的残留）清掉，并加 `packages/**/__tests__/**/*.test.js` 忽略规则兜底；手写 fixture 与 `.d.ts` 垫片保留
- **约定文档化**：`docs/build-output-conventions.md`
- **修复类型检查**：solution-style `tsc -b` 重构回退为 `tsc --noEmit`（3774 错误 → 0），并修掉更严格 paths 暴露出的约 50 个真实类型错误

### ✅ 质量

- 类型检查：**0 错误**（`tsc --noEmit`，覆盖渲染层 + Electron 主进程/preload）
- 测试规模：全仓 **855 个 test / spec 文件**；CI 门禁依次跑 typecheck → workspace typecheck → tests → build
- **macOS 端到端验证**：`pnpm electron:build:mac` 产出 `release/OpenBuddy-0.16.0-{arm64,x64}.dmg`

### 🧰 新增发布脚本

- **`scripts/bump-version.mjs`** —— 一条命令改完 **88 个文件**（74 个 `package.json` + `hostVersion` + 官网 JSON-LD / 安装包文件名 / i18n 版本 chip + 示例插件 manifest），支持 `--dry-run`、`--json`、`--current`，并在落盘后自检
- 修复 Release note 抽取：现在匹配 CHANGELOG 真实的标题层级（`### vX.Y.Z`），GitHub Release 正文是真的发布段落，而不是自动生成的提交列表

---

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

### 里程碑（2026-08-17）· grok → Pi + moon monorepo

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

### 里程碑（2026-08-03）· Casdoor 企业鉴权

### 🔐 OIDC + 多租户
- Casdoor OIDC PKCE
- 租户策略
- 审计日志
- 6 个管理 REST 端点

---

### 里程碑（2026-07-20）· 多 Agent 基底

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
