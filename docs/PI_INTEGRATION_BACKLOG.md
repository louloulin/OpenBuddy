# PI Integration Backlog — OpenBuddy 五期（plan4.1.md §2 差距表 → 可执行 backlog）

> 📅 2026-09-10 · 仓库 `louloulin/OpenBuddy` · 父任务 LUM-785
>
> 本文是 `plan4.1.md §2` 的 15 项 G-gap（真实差距矩阵）的执行级 backlog。
> 每项都给出：精确文件锚点、修复方向、可量化验收、估时、依赖、推荐 owner。
>
> **数据来源**：所有数字从 `scripts/audit/pi-sdk-usage.sh` + `scripts/audit/pi-bridge-dead-channels.sh` + `scripts/audit/canonical-packages-e2e.sh` 实测产出，与 plan4.1.md §1 / §2 一致。
>
> **状态约定**：⬜ 未启动 / 🟡 进行中（部分子任务已 commit）/ ✅ 已完成（PR merged）/ ⛔ 阻塞（依赖 owner 决定）。

---

## 0. 一页 backlog

| ID | 标题 | 文件锚点 | 估时 | 优先级 | Owner | 阻塞 | 状态 |
|---|---|---|---|---|---|---|---|
| **G1** | defineTool typed facade + apply-patch cast 替换（**PR 1 已落地**） | `plugin-host/src/typed-tool.ts`（新增 65 LOC）| 3 周 | P0 | runtime | — | **🟢 PR1** |
| **G2** | SettingsManager / DefaultResourceLoader 切到 pi | `storage/sqlite/settings-store.ts` (196 LOC) | 2 周 | P0 | runtime | G2 内部先跑通最小用例 | ⬜ |
| **G3** | DefaultPackageManager 替换 ProfilePackageManager | `plugin-host/src/profile-manager.ts:53-63` (806 LOC) | 2 周 | P0 | runtime | G2 | ⬜ |
| **G4** | pi-bridge 14 通道 13 死代码利用 | `pi-bridge/index.ts:36-121` vs `src/lib/agent/pi-client.ts:1460` | 2 周 | P0 | renderer | — | ⬜ |
| **G5** | generateBranchSummary 接管 branch-summary-format 自实现 | `host-modules/branch-summary-format.ts` | 1 周 | P1 | runtime | G2 | ⬜ |
| **G6** | initTheme / getMarkdownTheme 替换 ui-theme 自实现 | `packages/ui/openbuddy-ui-theme/` | 1 周 | P1 | ui | — | **🟢 PR1** |
| **G7** | shell helper 用 pi bash-executor + PowerShell config | `extensions/apply-patch.ts:39-40` | 1 周 | P1 | runtime | G1 | ⬜ |
| **G8** | 29 个 CANONICAL_PI_PACKAGES e2e 全覆盖 | `pi-extension-discovery.ts:20-50` | 3 周 | P1 | runtime + QA | — | ⬜ |
| **G9** | loadProjectContextFiles 接入（**PR 1 已落地**，include.ts 不动） | `plugin-host/src/resource-pi.ts`（新增 55 LOC）| 1 周 | P1 | runtime | **🟢 PR1** | ⬜ → 🟢 |
| **G10** | ExtensionFactory 注册简化（单文件入口） | `pi-extensions.ts` (1222 LOC) | 2 周 | P1 | runtime | G1 | ⬜ |
| **G11** | plugin manifest 解析切到 pi parseFrontmatter | `plugin-sdk/src/manifest.ts` | 1 周 | P0 | runtime | G4 | **🟢 PR1** |
| **G12** | pi-runtime-coordinator 复用 AgentSessionRuntime | `agent/pi-runtime-coordinator.ts` | 1 周 | P1 | runtime | G2 | ⬜ |
| **G13** | pi-session-runtime 评估可移除部分 | `agent/pi-session-runtime.ts` (~300 LOC) | 1 周 | P2 | runtime | G12 | ⬜ |
| **G14** | Harness server 评估 pi RPC 模式 | `electron/main/harness/harness-server.ts` (1327 LOC) | 2 周 | P2 | runtime | G2 | ⬜ |
| **G15** | AuthStorage PKCE 接管 deepseek-generic auth | `electron/main/deepseek-generic.ts` + `~/.openbuddy/auth.json` | 1 周 | P1 | runtime | G2 | ⬜ |

**总计**：P0 = 5 项（G1-G4, G11）= 11 周；P1 = 8 项 = 13 周；P2 = 2 项 = 3 周。sum 27 周 ≈ 7 月（与 plan4.1.md §3 路线 14 周一致，剩 7 周留 verification + GA gates）。

---

## 1. P0：阻塞生产可用的 5 项

### G1 — defineTool typed facade + apply-patch cast 替换（PR 1 已落地）

**Owner**：runtime team
**依赖**：—
**估时**：3 周
**状态**：🟢 **PR 1 已落地**（2026-09-11 Round 13）；PR 2（apply-patch.ts 实际改造）+ PR 3（清理）待 dev-env

**修复方向**（**修订后**）：
- 新建 `packages/runtime/openbuddy-plugin-host/src/typed-tool.ts`（PR 1 ✅ 65 LOC）：typed facade 包装 pi 的 `defineTool` + TypeBox `TSchema`/`Static`/`InferParams` + `objectParams()` helper
- 拆 `extensions/apply-patch.ts` 228 LOC → ~200 LOC（**PR 2 待写**）：用 `defineTool<Type.Object({...})>` 替换两个工具的 `parameters` literal + 删除 execute 函数里 ~30 LOC 的 `(params as {...})` cast + `String(p.x ?? "")` runtime guards
- pi 0.85.1 **无** `createBashTool` 等公开工厂（spec 误估）；真实 win 是 typed safety 而非 LOC 压缩
- `pi-extensions.ts` 注册新 builtin extension `openbuddy-pi-tools`（**G10 PR 2 待做**）

**PR 1 验证**（2026-09-11）：
- `tsc -p packages/runtime/openbuddy-plugin-host/tsconfig.json --noEmit` exit 0 ✅
- `vitest run packages/runtime/openbuddy-plugin-host/src/__tests__/typed-tool.test.ts` 4/4 ✅
- `pnpm install --filter @openbuddy/plugin-host` ✅（typebox 1.3.7 加入 plugin-host deps，与 pi 上游锁一致）
- apply-patch.ts **未改动**（0 LOC 差异）

**PR 2 待做**：apply-patch.ts 引入 typed-tool facade；跑 apply-patch-r2.test.ts 验证；GA gate 从 LOC 228→<100 调整为 **typed safety**（删除 unsafe cast）。

**关联脚本**：`bash scripts/audit/pi-sdk-usage.sh --json` 中 `hotspots.applyPatch=228` 必须降到 < 100（PR 2 后达成）。

---

### G2 — SettingsManager / DefaultResourceLoader 切到 pi

**Owner**：runtime team
**依赖**：—
**估时**：2 周
**关联脚本**：`bash scripts/audit/pi-sdk-usage.sh --json` 中 `hotspots.settingsStore=196` 必须降到 ≤ 50（保留 OpenBuddy typed facade）。

**修复方向**：
- `packages/runtime/openbuddy-storage/src/sqlite/settings-store.ts` 196 LOC：内部改用 `SettingsManager.create()`；导出 OpenBuddy typed API（不破坏调用方）
- `host-modules/models-config.ts`：同样切到 `SettingsManager` schema
- 保留 OpenBuddy `settings-backend.ts` 作为 facade（与 `packages/capability/openbuddy-folder-trust/src/settings-backend.ts` 对齐）

**验收**：
- 所有 settings schema 校验由 pi 完成
- OpenBuddy 现有调用方零修改
- 减少 ≥ 150 LOC 自实现（脚本自动断言）

---

### G3 — DefaultPackageManager 替换 ProfilePackageManager

**Owner**：runtime team
**依赖**：G2
**估时**：2 周
**关联脚本**：`bash scripts/audit/pi-sdk-usage.sh --json` 中 `hotspots.profileManager=806` 必须降到 ≤ 200。

**修复方向**：
- `packages/runtime/openbuddy-plugin-host/src/profile-manager.ts:53-63` 自定义 `ProfilePackageManager` 接口
- 接入 pi `DefaultPackageManager`（npm install / git install / tarball install / signature 校验）
- 保留 `ProfilePackageManager` 作为 typed facade（不变 OpenBuddy 业务调用方）

**验收**：
- npm install pi-mcp-adapter 能被 OpenBuddy 直接消费（端到端 + manifest）
- profile-manager.ts 行数 ≤ 200（脚本自动断言）

---

### G4 — pi-bridge 14 通道 13 死代码利用

**Owner**：renderer team
**依赖**：—
**估时**：2 周
**关联脚本**：`bash scripts/audit/pi-bridge-dead-channels.sh --json` 中 `utilizationPct` 必须从 7% 提到 ≥ 80%。

**修复方向**（按 dead-channel 列表，每条 1 个 PR）：
- G4.1 `bridge.text.stripFrontmatter` → `plugin-sdk/src/manifest.ts`（替换自定义 YAML parser）
- G4.2 `bridge.text.truncateHead/Tail` → `MessageList.tsx` + `attachment/preview.ts`
- G4.3 `bridge.text.truncateLine` → `attachment/preview.ts`
- G4.4 `bridge.text.generateDiff` → `ToolCallCard.tsx` + `DiffView.tsx`
- G4.5 `bridge.text.generatePatch` → `ToolCallCard.tsx`（apply_patch preview）
- G4.6 `bridge.image.detectMime` → `attachment/upload.ts`（paste image）
- G4.7 `bridge.image.resize/resize-file/convertToPng` → `attachment/upload.ts`
- G4.8 `bridge.skills.load/loadFromDir/formatForPrompt` → `plugin-host/src/skills.ts`（renderer 端调用栈）

**验收**：
- 14 通道中 ≥ 12 个（≥85%）有真实 renderer 消费者
- 脚本自动断言 `utilizationPct ≥ 80`

---

### G11 — plugin manifest 解析切到 pi parseFrontmatter

**Owner**：runtime team
**依赖**：G4.1（先在 renderer 跑通）
**估时**：1 周
**状态**：**🟢 PR 1 已落地（Round 10, 2026-09-11）** — `parsePluginManifestFromString` 函数 + 8 个 vitest 用例通过，pi `parseFrontmatter` / `stripFrontmatter` 在 plugin-sdk 层首次 runtime 接入。

**修复方向**：
- `packages/runtime/openbuddy-plugin-sdk/src/manifest.ts` 自实现 YAML parser
- 改为 `parseFrontmatter` + `stripFrontmatter`（通过 `bridge.text.parseFrontmatter`）
- 删除自定义 YAML 解析逻辑（约 80 LOC）

**验收**：
- manifest 解析走 pi
- plugin load 路径 vitest 全过

---

## 2. P1：体验升级 8 项

### G5 — generateBranchSummary 接管 branch-summary-format 自实现

**Owner**：runtime team
**依赖**：G2
**估时**：1 周

**修复方向**：
- `electron/main/agent/host-modules/branch-summary-format.ts` 注释明确 NOT using `generateBranchSummary`
- 接入 pi `generateBranchSummary`（需要 model 调用 + keychain 凭据）
- 保留 fallback formatter（offline mode）

**验收**：branch summary 行为与 pi 默认一致；offline 模式仍工作。

### G6 — initTheme / getMarkdownTheme 替换 ui-theme 自实现

**Owner**：ui team
**依赖**：—
**估时**：1 周
**状态**：**🟢 PR 1 已落地（Round 11, 2026-09-11）** — `theme-pi.ts` typed facade + 5 个 vitest 用例通过。spec 校对：pi 实际 API 与 spec §2 不一致（`initTheme` positional args；`getSettingsListTheme` 不存在 → `getEditorTheme`）；ui-theme 实际只是 56 LOC 类型 + 130 LOC state mgmt（**没有** token 系统也没有 dark/light CSS 切换）。

**修复方向**：`packages/ui/openbuddy-ui-theme/` 切到 pi `initTheme` + `getMarkdownTheme`，保留 `--wb-*` token 作为 base layer。

### G7 — shell helper 用 pi bash-executor + PowerShell config

**Owner**：runtime team
**依赖**：G1
**估时**：1 周

**修复方向**：`extensions/apply-patch.ts:39-40` `node:child_process.execFile` → pi `getShellConfig / getPowerShellConfig / bash-executor`。

### G8 — 29 个 CANONICAL_PI_PACKAGES e2e 全覆盖

**Owner**：runtime team + QA
**依赖**：—
**估时**：3 周
**关联脚本**：`bash scripts/audit/canonical-packages-e2e.sh --json` 中 `covered` 必须从 0 到 29。

**修复方向**（按 package 名 1 个 e2e）：
- `tests/integration/real-pi-package-pi-mcp-adapter.test.ts`
- `tests/integration/real-pi-package-pi-plan-mode.test.ts`
- ...（共 29 个，由脚本 `--json` 输出驱动）
- 每个测试用真实 `pnpm install <pkg>` + 装 + 触发 + 卸载

**验收**：
- 29 个 e2e 全过
- 脚本断言 `covered == 29`

### G9 — loadProjectContextFiles 接入（PR 1 已落地，include.ts 不动）

**Owner**：runtime team
**依赖**：—
**估时**：1 周
**状态**：🟢 **PR 1 已落地**（2026-09-11 Round 12）；PR 2 待 pi-runtime-coordinator 接入

**修复方向**（**修订后**）：不替换 `include.ts`（**spec 错估——include.ts 实际是 128 LOC Cordis harness plugin entry loader，不是 350 LOC context loader**）。改为**新增** `resource-pi.ts` typed facade（55 LOC）：
- re-export pi 的 `DefaultResourceLoader` + 6 个类型（`ResourceLoader` / `PathMetadata` / `ResolvedPaths` / `ResolvedResource` / `ResourceCollision` / `ResourceDiagnostic`）
- named-arg adapter `loadProjectContextFiles(projectRoot, agentDir)` 映射到 pi 的 `loadProjectContextFiles({ cwd, agentDir })`（**spec 错估——pi 是同步 + 单 options bag + 无 patterns 参数**）

**PR 1 验证**（2026-09-11）：
- `tsc -p packages/runtime/openbuddy-plugin-host/tsconfig.json --noEmit` exit 0 ✅
- `vitest run packages/runtime/openbuddy-plugin-host/src/__tests__/resource-pi.test.ts` 3/3 ✅
- include.ts **未改动**（1 LOC 差异都没有）

**PR 2 待做**：pi-runtime-coordinator 在多 session 启动时调用 `loadProjectContextFiles(projectRoot, agentDir)` 注入 pi AGENTS.md/CLAUDE.md 到 session 上下文。

### G10 — ExtensionFactory 注册简化

**Owner**：runtime team
**依赖**：G1
**估时**：2 周

**修复方向**：`pi-extensions.ts` 1222 LOC → 单文件 `registerBuiltinExtension(factory)` 入口；文档化最小模板。

### G12 — pi-runtime-coordinator 复用 AgentSessionRuntime

**Owner**：runtime team
**依赖**：G2
**估时**：1 周

**修复方向**：`electron/main/agent/pi-runtime-coordinator.ts` 自实现多 session 协调 → 复用 `AgentSessionRuntime.newSession/switchSession/fork`。

### G15 — AuthStorage PKCE 接管 deepseek-generic auth

**Owner**：runtime team
**依赖**：G2
**估时**：1 周

**修复方向**：`electron/main/deepseek-generic.ts` + `~/.openbuddy/auth.json` → pi `AuthStorage` + PKCE。

---

## 3. P2：可观测与可运营 2 项

### G13 — pi-session-runtime 评估可移除部分

**Owner**：runtime team
**依赖**：G12
**估时**：1 周

### G14 — Harness server 评估 pi RPC 模式

**Owner**：runtime team
**依赖**：G2
**估时**：2 周

**修复方向**：`electron/main/harness/harness-server.ts` 1327 LOC → 评估 pi `runRpcMode/RpcClient`；可选采纳 `pi-mcp-adapter` 替代自实现 MCP。

---

## 4. 与脚本的对应关系（验收命令速查）

```bash
# 跑全部 audit，把数字填进 §0 表格的对应行
bash scripts/audit/pi-sdk-usage.sh --json          # hotspots.applyPatch / settingsStore / profileManager
bash scripts/audit/pi-bridge-dead-channels.sh --json # utilizationPct
bash scripts/audit/canonical-packages-e2e.sh --json   # covered / missing

# CI 应做的硬断言（plan4.1.md §5 GA gates）
jq '.hotspots.applyPatch < 100'      /tmp/audit-pi.json   # G1
jq '.hotspots.settingsStore <= 50'    /tmp/audit-pi.json   # G2
jq '.hotspots.profileManager <= 200'  /tmp/audit-pi.json   # G3
jq '.utilizationPct >= 80'            /tmp/audit-dead.json # G4
jq '.covered == 29'                   /tmp/audit-canon.json # G8
```

---

## 5. 风险登记（与 plan4.1.md §7 同步）

| 风险 | 影响 | 触发条件 |
|---|---|---|
| R1 Pi 升级破坏 API | G1-G3 全部需要回头 | pi-coding-agent 升级到 0.86.x |
| R11 pi-bridge 通道继续死代码 | G4 永远修不完 | renderer team 不接任务 |
| R12 29 个 pi 包永远只是"声明可发现" | G8 永远修不完 | QA 不接任务 |
| R13 apply-patch 228 LOC 永远不被替换 | G1 永远修不完 | runtime team 不接任务 |
| R14 G2 SettingsManager 改造破坏调用方 | OpenBuddy 启动失败 | 旧 typed facade 未保留 |
| R15 G14 Harness 协议与 pi 上游 RPC 不兼容 | 替换需重写客户端 | pi RPC 模式评估结果为"不兼容" |

---

## 6. Owner 决策待办（不是 dev agent 能决定的）

| 待决 | 备选 | 推荐 |
|---|---|---|
| G2 是否保留 `settings-backend.ts` 作为 typed facade | (a) 完全切 pi；(b) 保留 facade | (b) — 不破坏调用方 |
| G4 是否要全 14 通道利用 | (a) ≥80%；(b) 100% | (a) — skills 通道 renderer 调用栈暂无意义 |
| G14 是否替换 harness server | (a) 替换；(b) 仅评估 | (b) — 高风险，需先评估兼容性 |

---

## 7. 进度更新

每个 PR 完成后更新本文 §0 状态列（⬜ → 🟡 → ✅ / ⛔）。周会 review backlog。
