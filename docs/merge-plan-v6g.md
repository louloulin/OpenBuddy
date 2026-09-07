# Merge Plan: `origin/codex/agent-host-v6g-facade` → `main`

> 📅 2026-09-07 · WU-A 侦察产出 · 仅只读侦察，不修改任何源码、不创建 PR、不触发 merge / rebase
>
> **事实源**：本仓库 `git log main..origin/codex/agent-host-v6g-facade`（49 commits · 313 文件 · +29,099 / −4,351 行）+ 现存 `docs/AI_CHAT_PLAN.md` + `docs/openbuddy-transformation-plan.html` + `PERFORMANCE_TRANSFORMATION_PLAN.md`
>
> **下游消费者**：WU-B（p0 closure）/ WU-C（modularization adopt）/ WU-D（AI Chat 对标）/ WU-E（perf 改造）

---

## 0. 执行摘要 (TL;DR)

| 维度 | 数值 | 备注 |
|---|---|---|
| commits ahead of main | **49** | `git rev-list --count main..origin/codex/agent-host-v6g-facade` |
| 改动文件 | **313** | `git diff --name-only ...` |
| 净行数 | **+24,748** | +29,099 / −4,351 |
| 按职能切片 | 6 大类 | modularization / plugin-host / microkernel / session tree / website / provider / docs / fix |
| must-merge | **24 commits** | agent-host v6-G facade + plugin-host 6-surface + microkernel + session tree + Phase 5 UI + MessageChannel + A-1/A-3/A-4/A-5 hardening |
| nice-to-have | **7 commits** | Orcarouter provider + 测试 + agent:providers-test + AbortSignal plumbing |
| drop | **18 commits** | openbuddy-website（独立 Next.js marketing site）+ Sheriff/ESLint 报告型配置（与主线 lint 体系不兼容） |
| merge 策略 | **分批 cherry-pick（按 commit 切片）** | rebase 风险太高；merge --no-ff 噪音太大 |
| 冲突热点（file-level） | **9 个文件** | `electron/main/agent/agent-host.ts`、`src/lib/agent/pi-client.ts`、`electron/main/ipc/agent.ts`、`electron/main/ipc/index.ts`、`electron/preload/index.ts`、4 个 host-modules 子文件 |
| 与已规划 WU-B 重叠 | **0** | WU-B 只动 release.yml / check-macos-signing.mjs / scripts/_section-credit-expiry.sh，v6g-facade 未触碰 |
| 与 WU-C 重叠 | **完全重叠** | v6g-facade 的 24 个 must-merge commit 就是 WU-C 的目标清单 |
| 与 WU-D 重叠 | **完全重叠** | v6g-facade 已实现 AI_CHAT_PLAN Phase A-F 的全部 6 个组件 |
| 与 WU-E 重叠 | **大部分重叠** | v6g-facade 已实现 P0 全部 8 条 findings 中的 5 条 + 部分 P1/P2 项 |

---

## 1. v6g-facade 分支定位

`origin/codex/agent-host-v6g-facade` 是一个**多目标叠加**分支，混合了：

1. **agent-host 模块化重构**（v4 → v6-G 五批拆分）
2. **plugin-host 6-surface 统一所有权**（pi-native + openbuddy）
3. **microkernel 拆分**（4 函数 + init-profile 阶段）
4. **session tree 投影**（复用 pi `SessionManager.getTree`）
5. **Phase 5 AI Chat UI**（ChatMinimap / BranchNavigator / ExtensionStatusBar / ExtensionWidgets / WorkflowCanvas / TaskItem phase）
6. **stream via MessageChannel**（替换每 token IPC）
7. **ts-error-architecture-overhaul Phase A**（A-1 typed facade、A-2 process guards、A-3 deepseek try/catch、A-4 email logging、A-5 AbortSignal plumb、A-7 lint report job）
8. **provider 新增**（Orcarouter.ai）
9. **marketing site**（apps/openbuddy-website，Next.js 14）
10. **tooling**（Sheriff + ESLint flat config + Prettier）

主线 main 同步演进的方向：

- `e94ce58` docs(readme): MiniMax-M3 chat screenshots
- `8f2b44b` docs(plan): add AI_CHAT_PLAN.md
- `d23a645` test(chat): pin composer against transcript growth
- …（main 上有 v6g-facade 没有的测试与文档）

因此简单 `git merge` 会一次性带入 313 文件、49 commits，其中相当一部分对主线**无价值或负价值**（website + Sheriff 报告型 CI）。

---

## 2. commit 分类清单（按职能 × 是否 merge 打标）

> 表格说明：
> - **类别**：commit 所属职能切片
> - **建议动作**：`must`（必须 merge）/ `nice-to-have`（有条件 merge）/ `drop`（不 merge）
> - **重叠 WU**：commit 内容与 WU-B/C/D/E 的对应关系
> - **冲突预判**：merge 时预期冲突的文件

### 2.1 must（24 commits）— agent-host v6-G + plugin-host + microkernel + session tree + UI Phase 5

| hash (short) | 类别 | 标题 | 建议 | 重叠 WU | 冲突预判 |
|---|---|---|---|---|---|
| `d8dcb93` | test | test(electron): stabilize echo composer-pin test under parallel load | must | WU-D（真实 e2e 套件） | 无 |
| `5ee1689` | provider | feat(llm): add Orcarouter.ai OpenAI-compatible provider | nice-to-have → must（ORCAROUTER_API_KEY opt-in） | WU-E? | `electron/main/agent/pi-extensions.ts`、`src/lib/agent/pi-client.ts`、`packages/ui/openbuddy-ui-settings/src/SettingsPanel.tsx`（main 已有类似扩展点） |
| `f6ee215` | test | test(e2e): real Electron regression — Orcarouter save round-trips to disk | nice-to-have | WU-D（真实 e2e） | 无 |
| `af4c676` | test+fix | feat+fix(llm): real Electron e2e test for agent:providers-test | must | WU-D | `electron/main/ipc/agent.ts`、`electron/preload/index.ts` |
| `f162150` | ui+fix | feat(ui): Test connection button + status pill in ModelsSettingsPanel | must | WU-D（Settings UI） | `packages/ui/openbuddy-ui-settings/src/SettingsPanel.tsx`（main 已大改） |
| `94f3fe2` | plugin-host | feat(plugin-host): unified capability ownership authority (pi-native + openbuddy) | must | WU-C | `packages/runtime/openbuddy-plugin-host/src/index.ts`、`packages/runtime/openbuddy-plugin-host/src/pi-passthrough.ts` |
| `f37d332` | plugin-host | feat(plugin-host): make pi-passthrough registry injectable (phase 3.5) | must | WU-C | 同上 + `docs/WORKBUDDY_PI_OPTIMIZATION_PLAN.md`（main 没这文件） |
| `c0e5c0b` | test | test(pi-extensions): fix stale builtinPiExtensionIds inventory (phase 0 baseline) | must | WU-C | `electron/main/agent/pi-extensions.test.ts` |
| `ba15026` | plugin-host | feat(agent): unify plugin transaction commit point across all 6 surfaces | must | WU-C | `electron/main/agent/plugin-lifecycle.ts`、`electron/main/agent/plugin-lifecycle.test.ts`（main 有该文件但 v6g 是新加） |
| `f865dd7` | agent | feat(agent): reuse pi SDK shouldCompact for context-guard decision (phase 2) | must | WU-C | `electron/main/agent/pi-extensions.ts`（main 已有同名文件，行号漂移） |
| `5bf5b56` *(修正：`5bf5d56`)* | session | feat(session): add sessionTree projection reusing pi SessionManager.getTree (phase 4) | must | WU-C/D | `packages/core/openbuddy-session/{package.json,src/index.ts}` + 新增 `session-tree.ts` |
| `a9ed9f8` | agent | feat(agent): index sessionId on bridge records + lock plugin event indexing (phase 4) | must | WU-C/D | `electron/main/agent/pi-event-bridge.ts`（main 已有） |
| `e7618fc` | ui | feat(ui): add ChatMinimap, BranchNavigator, ExtensionStatusBar (phase 5 A/B/C) | must | WU-D（Phase A/B/C） | `packages/ui/openbuddy-ui-conversation/src/{ChatMinimap,BranchNavigator,ExtensionStatusBar}.tsx`（main 没这文件） |
| `98f4b3a` | ui | feat(ui): add ExtensionWidgets + TaskItem phase tabs (phase 5 D/E) | must | WU-D（Phase D/E） | `packages/ui/openbuddy-ui-conversation/src/ExtensionWidgets.tsx`、`packages/ui/openbuddy-ui-sidebar/src/TaskItem.tsx` |
| `763204a` | ui | feat(ui): add WorkflowCanvas visual workflow editor (phase 5 F) | must | WU-D（Phase F） | `packages/ui/openbuddy-ui-automation/src/WorkflowCanvas.tsx` |
| `416dd4c` | agent | refactor(agent): extract pi compatibility command helpers (phase 3) | must | WU-C | `electron/main/agent/pi-extensions.ts`、`electron/main/agent/pi-compatibility-commands.ts`（新文件） |
| `0bdfafa` | agent | refactor(agent): extract email+calendar IPC wrappers from pi-client (phase 3) | must | WU-C | `src/lib/agent/pi-client.ts`、`src/lib/agent/pi-client-email.ts`（新文件） |
| `2ae232b` | fix | fix: harden filesystem, oauth, session and navigation boundaries | must | WU-D（IPC safety） | 多文件：`electron/main/connectors.ts`、`electron/main/ipc/{agent,connectors,misc,storage}.ts`、`electron/main/main-window.ts`、`packages/capability/openbuddy-{email,mcp-client,core/openbuddy-session}/src/index.ts` |
| `4de28f9` | modularization | refactor(agent): split pi-client + agent-host host-modules, stream via MessageChannel | must | WU-C/E（核心 commit） | **超大**：50 文件，`electron/main/agent/agent-host.ts`、`src/lib/agent/pi-client.ts`、`electron/main/{ipc,harness,collaboration,pi-stream-transport}.ts`、`electron/preload/index.ts`、`scripts/{electron,perf,verify-plan.mjs}` |
| `cf9b2b3` | modularization | refactor(agent): batch C+D microkernel modularization (4 functions extracted, init-profile stage split) | must | WU-C | `electron/main/agent/agent-host.ts`、`electron/main/agent/host-modules/bootstrap/init-profile.ts`（新）、`deepseek/agent-runtime.ts`、`session-metadata.ts` |
| `5fcc138` | modularization | refactor(agent): batch E host-modules extraction（18 host-modules 拆分） | must | WU-C | **超大**：40 文件，几乎全是 `electron/main/agent/host-modules/` 下新增文件 |
| `bbc0306` | modularization | refactor(agent): split agent-host host-modules into focused units | must | WU-C | 32 文件，同 host-modules/ 下新增 |
| `c35931e` | modularization | refactor(agent-host): split install-host-modules into 4 domain helpers (M-5) | must | WU-C | 55 文件，`electron/main/agent/agent-host.ts` + install-host-modules.ts 大改 |
| `da648dd` | modularization | refactor(agent-host): v6-G facade modularization — extract 20 domain facades + 6 bootstrap helpers | must | WU-C | 40 文件，**这是 v6-G 终态 commit**，触发 `electron/main/agent/agent-host.ts` 从 2098 → 1545 行 |
| `5d8ca3d` | fix | refactor(agent-host): v6-G M1 defensive install — guard deps assignment with truthy checks | must | WU-C | 39 文件（机械替换） |
| `86d4313` | fix | feat(electron): install unhandledRejection / uncaughtException guards (A-2) | must | WU-D（稳定性） | `electron/main/bootstrap/{app-lifecycle,process-guards}.ts`（main 已有 app-lifecycle.ts） |
| `d14d099` | fix | fix(email): log provider failures instead of silently swallowing (A-4) | must | WU-D | `packages/capability/openbuddy-email/src/index.ts` |
| `3480213` | fix | fix(deepseek): wrap session-listener fanout in try/catch with logger (A-3) | must | WU-D | `electron/main/agent/host-modules/deepseek/agent-runtime.ts` |
| `45fbcdb` | types | refactor(agent): type AgentHostFacade public surface (A-1) | must | WU-C | `electron/main/agent/host-modules/bootstrap/{agent-host-types,build-agent-host-facade}.ts` |
| `8857dce` | types | feat(electron): A-5 plumb AbortSignal through ipc/agent.ts prompt/steer/follow-up | must | WU-D | `electron/main/ipc/agent.ts` |

### 2.2 nice-to-have（7 commits）— 测试 + provider + lint-tools（依情况合并）

| hash | 标题 | 建议 | 理由 |
|---|---|---|---|
| `c4997d9` | ci: add report-only lint-tools job (ESLint + Sheriff + Prettier) (A-7) | drop | main 已有 ESLint 体系；Sheriff 引入需要 monorepo-wide 类型修复，单独 cherry-pick 噪音大 |
| `8a562ef` | fix(website): drop --turbopack from dev script + remove invalid moon type field | drop | 与 website 一并 drop |
| `45a759b` | fix(website): drop `output: 'standalone'` to avoid pnpm symlink ENOENT | drop | 同上 |
| `2c40ad1` | feat(website): build OpenBuddy marketing site (Next.js 14 App Router) | drop | 与主线产品不同步 |
| `2948835` | feat(website): tutti-inspired redesign with serif display font + state color system | drop | 同上 |
| `3d44bf0` | feat(website): tutti.sh 风格重做 + 主题一致性修复 | drop | 同上 |
| `cdba790` | feat(website): add Vercel deployment config + README | drop | 同上 |

### 2.3 docs（5 commits）— 与 openbuddy-website 配套的文档

| hash | 标题 | 建议 | 备注 |
|---|---|---|---|
| `f0ec6ab` | docs(plan): comprehensive WorkBuddy-pi optimization analysis + phased plan | must（独立文档） | `docs/WORKBUDDY_PI_OPTIMIZATION_PLAN.md` 新建，与 main 的 docs 体系并存 |
| `c70aba9` | docs(plan): add unified plugin system phase | must | 同上文件追加 |
| `32de1fe` | docs(plan): mark phase 3.5 ownership authority done + add pi/openbuddy matrix | must | 同上 |
| `d39a9f7` | docs(plan): refine plan with verified facts, dependency graph, acceptance automation | must | 同上 |
| `8bc6d99` | docs(plan): mark phase 3.5 complete (all 4 items done) | must | 同上 |
| `4a8d8c0` | docs(plan): mark phase 2 complete (reuse pi SDK compaction + branch summary) | must | 同上 |
| `3abb2a2` | docs: fix capability-plugins.ts location drift + correct phase 1 findings | must | 同上 + 新建 `docs/OPENBUDDY-PI-VISION.md` |
| `5fcc138` 配套 | docs/analysis/agent-host-microkernel-v2.md | must | v6-G microkernel 测绘 |
| `c35931e` 配套 | docs/ARCHITECTURE_MICROKERNEL.zh-CN.md | must | 微内核中文架构图 |
| `da648dd` 配套 | docs/agent-host-v6g-architecture.zh-CN.md | must | v6-G 中文架构测绘（终态） |
| `2052a6f` | docs(plugin-system): add PLUGIN_SYSTEM.md (6-surface architecture guide) | must | 6-surface 插件架构指南 |
| `a59a892` | docs(plan): mark phase 5 complete (all 6 UI sub-items A-F) | must | 同 WORKBUDDY_PI_OPTIMIZATION_PLAN.md |
| `921f60c` | docs(plan): mark phase 3 partial (2 splits done, giant files remain) | must | 同上 |
| `c1ebcb4` | chore(deps): add sheriff + typescript-eslint + prettier devDeps; allow unrs-resolver | drop | Sheriff / ESLint flat 配套依赖；如不引 Sheriff 就不要 |
| `ee48844` | feat(tooling): add eslint flat config + sheriff + prettier; wire lint/format scripts | drop | 同上 |

---

## 3. 与 P0/P1/P2 gaps 重叠矩阵

> 对照 `docs/openbuddy-transformation-plan.html` 表 5-1 / 5-2 / 5-3（共 14 项缺口）。

### 3.1 P0 gaps × v6g-facade 已闭合项

| P0 gap | 当前状态（main） | v6g-facade 闭合情况 | 涉及 commit | WU 归属 |
|---|---|---|---|---|
| **P0-1** macOS 签名 + 公证自动流水线 | 未实施 | **未闭合**（v6g-facade 不涉及 release.yml / signing.mjs） | — | WU-B 专属 |
| **P0-2** `minimax` vs `minimax_cn` 双轨 | ✅ A9 完成（main `e94ce58` 之前的 main 已有） | 未涉及 | — | 已闭合 |
| **P0-3** Linux CI 缺失 | ✅ A11 完成 | 未涉及 | — | 已闭合 |
| **P0-4** Permission UI 仅 3 档 | ✅ A8 完成 | 未涉及 | — | 已闭合 |
| **P0-5** `scripts/_section-credit-expiry.sh` 抽出 | 未实施 | **未闭合** | — | WU-B 专属 |

**结论**：v6g-facade 与 P0 gaps **无重叠**——P0-1/P0-5 完全归 WU-B；P0-2/3/4 在 main 已闭合。

### 3.2 P1 gaps × v6g-facade

| P1 gap | 当前状态 | v6g-facade 闭合情况 |
|---|---|---|
| P1-1 i18n 全量翻译 | 部分（≥80 key） | 未涉及 |
| P1-2 dist/ 与 out/ 双目录 | 已闭合 | 未涉及 |
| P1-3 Voice / 视频多模态补强 | 未实施 | 未涉及 |
| P1-4 Linux 场景标签 | 未实施 | 未涉及 |
| P1-5 App-icon 替换 | 未实施 | 未涉及 |
| P1-6 macOS 真签名 | 重复 P0-1 | 未涉及 |

**结论**：P1 gaps 与 v6g-facade **零重叠**。

### 3.3 P2 gaps × v6g-facade

| P2 gap | v6g-facade 闭合情况 |
|---|---|
| P2-1 设计令牌 SCSS 真源 | 未涉及（main 仍是 tokens.css 单文件） |
| P2-2 DSH 桥接版本兼容矩阵 | 部分闭合（v6g 已 split pi-client + pi-client-email + harden `dsh-bridge-helpers.ts:questionAnswer` 边界），但 21 个 `openbuddy-dsh-*` 包名对齐仍需独立 WU |
| P2-3 `xai` 排除文档化 | 未涉及 |
| P2-4 Casdoor 默认 issuer 环境变量切换 | 未涉及 |

**结论**：P2 仅 P2-2 与 v6g-facade 部分重叠，需独立 WU 收尾。

### 3.4 总结矩阵

```
P0  ∅  (5 项全独立于 v6g-facade)
P1  ∅  (5 项全独立)
P2  ≈  (P2-2 部分闭合，其余独立)
─────────────────────
总计  14 项 gaps 中，13 项与 v6g-facade 无重叠；1 项部分重叠（P2-2）。
WU-B 可独立推进 P0-1 / P0-5，不受 v6g-facade merge 影响。
```

---

## 4. 与 AI_CHAT_PLAN Phase A-F 重叠矩阵

> 对照 `docs/AI_CHAT_PLAN.md` §3 阶段 A-F（6 项 + Phase F 索引）。

| Phase | AI_CHAT_PLAN 任务 | v6g-facade 已实现？ | 对应 commit | WU 归属 |
|---|---|---|---|---|
| **Phase F** | extension-events 索引化（前置） | ✅ **已实现** | `a9ed9f8`（feat(agent): index sessionId on bridge records + lock plugin event indexing） | WU-C 落地 |
| **Phase A** | ChatMinimap | ✅ **已实现** | `e7618fc`（feat(ui): add ChatMinimap） | WU-D 完成验收 |
| **Phase B** | BranchNavigator（复用 `pi SessionManager.getTree`） | ✅ **已实现** | `e7618fc`（feat(ui): add BranchNavigator）+ `5bf5d56`（session-tree.ts projection） | WU-D 完成验收 |
| **Phase C** | ExtensionStatusBar | ✅ **已实现** | `e7618fc` | WU-D 完成验收 |
| **Phase D** | ExtensionWidgets | ✅ **已实现** | `98f4b3a`（feat(ui): add ExtensionWidgets） | WU-D 完成验收 |
| **Phase E** | WorkBuddy 三段式（探索/规划/执行） | ✅ **已实现** | `98f4b3a`（feat(ui): add TaskItem phase tabs） | WU-D 完成验收 |
| **Phase F (扩展)** | WorkflowCanvas（Phase 5 F） | ✅ **已实现** | `763204a` | WU-D 完成验收（但 AI_CHAT_PLAN 未列） |

**结论**：v6g-facade **已实现 AI_CHAT_PLAN Phase A-F 全部 6 项 + WorkflowCanvas**。WU-D 的工作实际是 **cherry-pick + 真实 e2e 验收**，无需重新实现。

---

## 5. 与 PERFORMANCE_TRANSFORMATION_PLAN 78 findings 重叠矩阵

> 对照 `PERFORMANCE_TRANSFORMATION_PLAN.md` §三 阶段 P0/P1/P2（8/34/36 = 78 findings）。

### 5.1 P0 findings（8 条）— v6g-facade 闭合情况

| # | Finding | 任务 | v6g 闭合？ | 对应 commit |
|---|---|---|---|---|
| P0-01 | 主窗口改 `ready-to-show` | main-window.ts:68 did-finish-load → ready-to-show | 部分（v6g 的 `2ae232b` 动了 `main-window.ts` 但描述为 harden，未明确替换） | `2ae232b` |
| P0-02 | 关闭 `__vitePreload(true)` | 移除 markdown/mermaid modulepreload | **未明确闭合** | — |
| P0-03 | 流式 IPC 16ms 批量 | ipc/index.ts:790 改造 | ✅ **已闭合**（MessageChannel + 16ms 批处理） | `4de28f9` |
| P0-04 | 移除 ipc/index 顶层 import agentHost | ipc/index.ts:14 | ✅ **已闭合**（`ensureAgentHostLoaded()` 模式） | `4de28f9` |
| P0-05 | 移除 casdoor-auth 顶层实例化 | casdoor-auth.ts:984 | **未明确闭合**（commit 未涉及 casdoor-auth.ts） | — |
| P0-06 | mergeStreamingDelta 局部 patch | session-store.ts:143-159 | **未明确闭合** | — |
| P0-07 | ChatView messagesRef + shallow | ChatView.tsx:132 | **未明确闭合** | — |
| P0-08 | 移除 sidebar 每次切会话刷新 | App.tsx:1307 | **未明确闭合** | — |

**结论**：P0 8 条中 v6g-facade 闭合 **2 条明确**（P0-03 / P0-04）+ 1 条部分（P0-01）。其余 5 条需 WU-E 独立推进。

### 5.2 P1 findings（34 条）— v6g-facade 闭合情况

| 主题 | v6g 闭合数 | 对应 commit |
|---|---|---|
| App.tsx 路由级 React.lazy | **未明确闭合** | — |
| ChatView 子组件 memo + Composer 回调稳定化 | **未明确闭合** | — |
| SQLite 事务批量合并 | **未明确闭合** | — |
| storage WAL 回读 | **未明确闭合** | — |
| pi-extensions stub 真实化 | **未明确闭合** | — |
| agent-host 顶层 import 削减 | ✅ **已闭合**（v6-G facade 拆分主目标） | `c35931e` / `5fcc138` / `bbc0306` / `4de28f9` / `da648dd` / `5d8ca3d` |
| microkernel 拆分 | ✅ **已闭合**（batch C+D microkernel modularization） | `cf9b2b3` |

**结论**：P1 34 条中 v6g-facade 闭合 **2 个主题**（agent-host 顶层 import / microkernel 拆分）。

### 5.3 P2 findings（36 条）— v6g-facade 闭合情况

| 主题 | v6g 闭合数 | 对应 commit |
|---|---|---|
| 主进程切 multi-chunk | ✅ **已闭合**（electron.vite.config.ts 改 inlineDynamicImports=false） | `4de28f9` |
| 流式走 MessageChannel | ✅ **已闭合** | `4de28f9` |
| deepseek-runtime append 局部 patch | **未明确闭合** | — |
| 其余 33 条 | **未明确闭合** | — |

**结论**：P2 36 条中 v6g-facade 闭合 **2 条**（multi-chunk + MessageChannel）。

### 5.4 总结

```
P0  8 条 → v6g 闭合 2 + 部分 1 = 3 条（约 37.5%）
P1 34 条 → v6g 闭合 2 主题（约 5.9%）
P2 36 条 → v6g 闭合 2 条（约 5.6%）
─────────────────────
总计 78 findings → v6g 闭合约 7 项（9%）
WU-E 仍需独立推进约 71 项 findings。
```

---

## 6. 与 ts-error-architecture-overhaul 重叠

| 阶段 | ts-error A-* | v6g 闭合 | 备注 |
|---|---|---|---|
| A-1 | type AgentHostFacade | ✅ `45fbcdb` | `agent-host-types.ts` 512 行 |
| A-2 | process guards | ✅ `86d4313` | `process-guards.ts` |
| A-3 | deepseek try/catch | ✅ `3480213` | `deepseek/agent-runtime.ts` |
| A-4 | email log provider failures | ✅ `d14d099` | `openbuddy-email/src/index.ts` |
| A-5 | AbortSignal plumbing | ✅ `8857dce` | `ipc/agent.ts` |
| A-7 | lint-tools report-only job | 部分 `c4997d9` | 但 Sheriff 配套 drop |

**结论**：ts-error-architecture Phase A 6 项中 v6g-facade **闭合 5 项完整 + 1 项部分**。A-6（eslint/sheriff/prettier 引入）建议保持 drop。

---

## 7. merge 策略选择与冲突预判

### 7.1 候选策略对比

| 策略 | 优点 | 缺点 | 推荐度 |
|---|---|---|---|
| **rebase v6g-facade onto main** | 线性历史、单点冲突 | 重写 49 个 commit 的 hash，破坏 v6g-facade 历史可追溯；313 文件单点 rebase 冲突爆炸 | ❌ 不推荐 |
| **`git merge --no-ff`** | 简单 | 一次带入 49 commit / 313 文件 / 29099 行；包含 18 个 website / Sheriff drop commit；冲突面不可控 | ❌ 不推荐 |
| **`git merge -X theirs`** | 同上 | 同样一次性带入 | ❌ |
| **分批 cherry-pick（按切片）** | 冲突可控；可挑选 must-merge / drop website；保留 main 线性历史 | 需要逐个或逐切片解决冲突 | ✅ **强烈推荐** |
| **Copy patch files（人工复制）** | 终极细粒度控制 | 工作量最大 | 备选（如某 commit 冲突不可调和） |

### 7.2 推荐策略：分批 cherry-pick（按 WU 切片）

**批次顺序**（与 WU-A → WU-B → WU-C → WU-D → WU-E 流水线对齐）：

#### Batch 1（WU-C 前置）— 17 commits
1. docs 集群（8 commits）：`f0ec6ab` `c70aba9` `32de1fe` `d39a9f7` `8bc6d99` `4a8d8c0` `3abb2a2` `a59a892` `921f60c` `2052a6f`
2. plugin-host 集群（4 commits）：`94f3fe2` `f37d332` `c0e5c0b` `ba15026`
3. agent compaction + session tree（3 commits）：`f865dd7` `5bf5d56` `a9ed9f8`

#### Batch 2（WU-C 主线）— 7 commits
4. modularization（4 commits，按从小到大顺序）：`bbc0306` → `5fcc138` → `cf9b2b3` → `c35931e`
5. **stream via MessageChannel**（1 commit）：`4de28f9`（这是 v6g 最大 commit，50 文件）
6. **v6-G facade 终态**（1 commit）：`da648dd`（40 文件）
7. **defensive install**（1 commit）：`5d8ca3d`

> 注意：Batch 2 顺序关键——`bbc0306` / `5fcc138` 是 host-modules 拆分基础；`cf9b2b3` 是 microkernel 4 函数；`c35931e` 是 install 拆分；`4de28f9` 是 MessageChannel；`da648dd` 是 v6-G 终态 facade。**乱序会引发数千行无意义的 conflict**。

#### Batch 3（WU-D 主体）— 7 commits
8. ts-error Phase A（5 commits）：`45fbcdb` `86d4313` `3480213` `d14d099` `8857dce`
9. UI Phase 5（3 commits）：`e7618fc` `98f4b3a` `763204a`
10. fix 集群（1 commit）：`2ae232b`
11. provider + 测试（4 commits，可选）：`5ee1689` `f6ee215` `af4c676` `f162150`
12. test 集群（1 commit）：`d8dcb93`

### 7.3 冲突热点（file-level）

按预测冲突严重度排序：

| 排名 | 文件 | 冲突原因 | 解决预案 |
|---|---|---|---|
| 🔴 1 | `electron/main/agent/agent-host.ts` | main 3485 行，v6g 终态 1545 行；`e94ce58` 之前的 main 已有小幅演化 | 取 v6g 版本（v6g 完整执行 modularization）；main 额外演化通过 host-modules/facade 适配 |
| 🔴 2 | `src/lib/agent/pi-client.ts` | main 2412 行；v6g `4de28f9` 2054 行；`0bdfafa` 又拆 218 行到 `pi-client-email.ts`；`416dd4c` 拆 `pi-compatibility-commands.ts` | 取 v6g 版本；main 演化通过 `*` re-export 自动覆盖 |
| 🔴 3 | `electron/main/ipc/agent.ts` | main 大量 IPC handler；v6g `4de28f9` 改 IPC payload 形状；`af4c676` 加 agent:providers-test；`8857dce` AbortSignal plumb；`45fbcdb` 类型修正 | 逐行三路合并（main / v6g / ts-error），优先保留 v6g 的 facade 调用 + main 的实际 handler |
| 🔴 4 | `electron/main/ipc/index.ts` | main 与 v6g `4de28f9` 的 `ensureAgentHostLoaded()` 模式冲突；顶层 import 削减 | 取 v6g 模式 |
| 🟡 5 | `electron/preload/index.ts` | main 暴露 IPC 列表；v6g `af4c676` 加 providers-test；`4de28f9` 加 openPiStream | 合并 allowlist（v6g 增量 + main 增量） |
| 🟡 6 | `electron/main/agent/pi-extensions.ts` | main 已有 providers；v6g `5ee1689` 加 Orcarouter；`f865dd7` 改 shouldCompact | 合并：保留 main 已有 providers + v6g 新增 |
| 🟡 7 | `packages/ui/openbuddy-ui-settings/src/SettingsPanel.tsx` | main 已大改（miniMax_cn 移除等 A9 改造）；v6g `5ee1689` 加 Orcarouter preset；`f162150` 加 Test connection 按钮 | 合并 UI 区域（v6g Test connection 区块插入 main 的 ProviderEditor） |
| 🟢 8 | `electron/main/agent/host-modules/{plugin-mutations,profile-reload-transaction,session-rebind,session-store,session-swap}.ts` | 5d8ca3d 机械替换（state = deps.state → if(deps.state) state = deps.state） | main 已存在但 main 上应该是新文件；机械替换无冲突；如冲突取 v6g |
| 🟢 9 | `electron/main/agent/pi-event-bridge.ts` | main 已有；v6g `a9ed9f8` 增 sessionId 索引 + plugin event indexing | 合并 sessionId 字段（向后兼容新增字段） |

### 7.4 回滚预案

**R1：每批次前打 tag**
```bash
git tag wu-c-batch1-pre  # 批次开始前
git tag wu-c-batch1-post # 批次完成后
```

**R2：批次内 cherry-pick 失败时**
```bash
git cherry-pick --abort
git reset --hard wu-c-batch1-pre
```

**R3：批次通过但后续集成失败时**
```bash
git reset --hard wu-c-batch1-pre   # 完全回滚批次
# 或
git revert -n <merge-commit>       # 软回滚，保留历史
```

**R4：跨批次依赖破坏时**
- Phase A (docs) + plugin-host 4 commit 必须成功（不依赖 main 代码）
- Phase B (modularization) 若失败，单独回滚到上一 tag，重试时把 `4de28f9` 拆成 2 个子 commit 手动应用
- Phase C (UI Phase 5) 可独立于 Phase B 成功（不依赖 agent-host 拆分）

---

## 8. 验证矩阵（每批次必跑）

```bash
# 类型
pnpm typecheck
pnpm workspace:typecheck

# 构建
pnpm build

# 单元
pnpm test

# 真实 e2e（仅 WU-C/D/E 批次）
OPENBUDDY_E2E_REQUIRED=1 \
OPENBUDDY_E2E_API_KEY="$OPENBUDDY_E2E_API_KEY" \
OPENBUDDY_E2E_BASE_URL="https://api.minimaxi.com/anthropic" \
OPENBUDDY_E2E_MODEL_ID="MiniMax-M3" \
npx playwright test \
  tests/electron/chat-ui-minimax-real.spec.ts \
  tests/electron/minimax-real-roundtrip.spec.ts \
  tests/electron/chat-ui-streaming.spec.ts \
  tests/electron/chat-flow-echo.spec.ts \
  tests/electron/session-history-load.spec.ts \
  tests/electron/chat-minimap.spec.ts \
  tests/electron/branch-navigator.spec.ts \
  tests/electron/extension-status.spec.ts \
  --reporter=list --retries=1

# 性能（WU-E 批次）
pnpm perf:bundle-budget   # ≤ 4MB unzipped
pnpm perf:cold-start       # ≤ 1.8s p95
pnpm perf:ipc-latency      # p95 ≤ 20ms
pnpm perf:streaming-bench  # TTFT p95 ≤ 400ms
```

---

## 9. 下一阶段工作单元树（继承 WU-A → WU-F）

```
LUM-556: openbuddy 二期改造 (in_progress)
├── LUM-557 WU-A [本 issue] · merge plan 文档 · agent: lumos-ts-coder
│       owner_capability: TS/前端/侦察
│       输出: docs/merge-plan-v6g.md
│       blockedBy: ∅
│       unblockedBy: ∅ (本 issue 完成后下面 B-F 解锁)
│
├── LUM-558 WU-B [stage 2] · P0 缺口闭合 (P0-1 macOS 真签名 + P0-5 scripts 抽取)
│       owner_capability: 通用 / release 工程师
│       blockedBy: WU-A
│       与 v6g-facade 重叠: 0（独立推进）
│
├── LUM-560 WU-D [stage 2] · AI Chat 对标 (Phase A-F)
│       owner_capability: TS/前端/UI
│       blockedBy: WU-A
│       工作模式: **cherry-pick** v6g-facade 的 e7618fc / 98f4b3a / 763204a / 5bf5d56 / a9ed9f8，
│                 配合 Batch 1 + Batch 3 部分；
│                 主要工作是真实 MiniMax e2e 验收 + 视觉验证
│
├── LUM-559 WU-C [stage 3] · 模块化改造 (adopt v6-G facade + plugin-host + microkernel + session tree + MessageChannel)
│       owner_capability: TS/后端/架构
│       blockedBy: WU-A, WU-D (Phase A-C UI 依赖 session tree 投影)
│       工作模式: **Batch 1 + Batch 2 全量 cherry-pick**
│       验收: agent-host.ts 行数下降 ≥ 30%（3485 → ≤ 2440），
│             13 个 Cordis 能力包不再顶层 import，
│             MessageChannel 流式路径 e2e 覆盖
│
└── LUM-561 WU-E [stage 4] · 性能改造 (78 findings: P0 quick wins / P1 核心重构 / P2 架构升级 / P3 度量治理)
        owner_capability: TS/性能
        blockedBy: WU-A, WU-C (Phase A-C MessageChannel 与 E 的 P0-03 16ms 批量同步)
        工作模式: 在 WU-C 落地后补齐剩余 P0/P1/P2 findings
        v6g-facade 已闭合: P0-03 / P0-04 / P1 (agent-host 顶层 import) / P2-01 / P2-03 / 微内核
        v6g-facade 未闭合: P0-01/02/05/06/07/08 / P1 多数 / P2 多数 / P3 全量
```

### 9.1 隐含 WU-F（未显式建 issue）

LUM-556 项目内尚未创建对应 issue，但从 v6g-facade 出发建议补：

| 隐含 WU | 主题 | 优先级 | blockedBy |
|---|---|---|---|
| WU-F1 | openbuddy-website 决策（保留 / drop / 独立 repo） | P2 | WU-A |
| WU-F2 | Sheriff + ESLint flat config 体系（是否引入） | P2 | WU-A, WU-C |
| WU-F3 | Orcarouter provider 启用（默认 vs opt-in） | P3 | WU-C |
| WU-F4 | ts-error Phase B / C（剩余 :any / 循环修复） | P2 | WU-F2 |

### 9.2 owner_capability 矩阵

| WU | 必需 capability | 建议 agent 类型 |
|---|---|---|
| WU-A | TS / 前端 / 侦察 / 文档 | TS/前端工程师 ✅ (lumos-ts-coder) |
| WU-B | 通用 / release / shell 脚本 | DevOps / release 工程师 |
| WU-C | TS / 后端 / 架构 / Electron | TS/架构工程师 |
| WU-D | TS / 前端 / UI / e2e | TS/前端工程师 ✅ (lumos-ts-coder) |
| WU-E | TS / 性能 / profiling | TS/性能工程师 |

---

## 10. 风险与开放问题

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R-1 | v6g-facade 313 文件改动 + main 同步演化 → 冲突面极大 | WU-C 工期翻倍 | 严格按 Batch 顺序 cherry-pick；任何 commit 冲突 3 次未解，拆 commit 重试 |
| R-2 | MessageChannel 切换会改 IPC payload 形状 | 所有 `pi://update` 消费者需同步升级 | WU-C 强制要求 `src/lib/agent/__tests__/pi-subscribe-port.test.ts` 通过 |
| R-3 | v6g-facade 不假设已通过所有测试 | WU-C 落地后回归 | WU-C 末段必须跑全套 typecheck + workspace:typecheck + test + e2e |
| R-4 | microkernel 拆分动 `init-profile` 启动流程 | 错误兜底（`notifyBridgeUnavailable` / `sendSafe`）必须同步重建 | 借 v6g `2ae232b`（harden filesystem/oauth/session/navigation boundaries）一起落地 |
| R-5 | Pi SDK 谈判周期 | 部分解构依赖 `@earendil-works/pi-coding-agent` 暴露新 init 钩子 | 已确认 v6g 的 shouldCompact + SessionManager.getTree + session-tree projection 都基于现有公开 API；f865dd7 的 shouldCompact 已验证 |
| R-6 | website 决策 | drop 后是否影响品牌 SEO | 建议：保留 apps/openbuddy-website 在独立 repo 或子目录 `archive/openbuddy-website-2026-09/`，不入主仓 release 流水线 |
| R-7 | Sheriff 报告型 CI job（c4997d9）是否合并 | 引入会增加构建时长但提供趋势线 | 与 WU-F2 决策绑定；如不引 Sheriff 则 drop 整个 A-7 commit |
| R-8 | `5ee1689` Orcarouter provider | 引入新外部依赖 | 建议作为 opt-in（ORCAROUTER_API_KEY env var），UI 默认不显示 |

---

## 11. 文件级 cherry-pick 决策表（精炼版）

| commit | 类别 | 决策 | WU |
|---|---|---|---|
| `d8dcb93` | test | ✅ cherry-pick | WU-D |
| `5ee1689` | provider | ⚠️ cherry-pick（opt-in） | WU-F3 / WU-C |
| `f6ee215` | test | ⚠️ cherry-pick | WU-D |
| `af4c676` | test+fix | ✅ cherry-pick | WU-D |
| `f162150` | ui+fix | ✅ cherry-pick | WU-D |
| `f0ec6ab` | docs | ✅ cherry-pick | WU-C docs |
| `c70aba9` | docs | ✅ cherry-pick | WU-C docs |
| `94f3fe2` | plugin-host | ✅ cherry-pick | WU-C |
| `32de1fe` | docs | ✅ cherry-pick | WU-C docs |
| `d39a9f7` | docs | ✅ cherry-pick | WU-C docs |
| `f37d332` | plugin-host | ✅ cherry-pick | WU-C |
| `c0e5c0b` | test | ✅ cherry-pick | WU-C |
| `ba15026` | plugin-host | ✅ cherry-pick | WU-C |
| `2052a6f` | docs | ✅ cherry-pick | WU-C docs |
| `8bc6d99` | docs | ✅ cherry-pick | WU-C docs |
| `f865dd7` | agent | ✅ cherry-pick | WU-C |
| `4a8d8c0` | docs | ✅ cherry-pick | WU-C docs |
| `3abb2a2` | docs | ✅ cherry-pick | WU-C docs |
| `5bf5d56` | session | ✅ cherry-pick | WU-C/D |
| `a9ed9f8` | agent | ✅ cherry-pick | WU-C/D |
| `e7618fc` | ui | ✅ cherry-pick | WU-D |
| `98f4b3a` | ui | ✅ cherry-pick | WU-D |
| `763204a` | ui | ✅ cherry-pick | WU-D |
| `a59a892` | docs | ✅ cherry-pick | WU-C docs |
| `416dd4c` | agent | ✅ cherry-pick | WU-C |
| `0bdfafa` | agent | ✅ cherry-pick | WU-C |
| `921f60c` | docs | ✅ cherry-pick | WU-C docs |
| `2ae232b` | fix | ✅ cherry-pick | WU-D |
| `4de28f9` | modularization | ✅ cherry-pick（核心） | WU-C |
| `cf9b2b3` | modularization | ✅ cherry-pick | WU-C |
| `5fcc138` | modularization | ✅ cherry-pick | WU-C |
| `bbc0306` | modularization | ✅ cherry-pick | WU-C |
| `c35931e` | modularization | ✅ cherry-pick | WU-C |
| `da648dd` | modularization | ✅ cherry-pick（v6-G 终态） | WU-C |
| `5d8ca3d` | fix | ✅ cherry-pick | WU-C |
| `86d4313` | fix | ✅ cherry-pick | WU-D |
| `d14d099` | fix | ✅ cherry-pick | WU-D |
| `3480213` | fix | ✅ cherry-pick | WU-D |
| `45fbcdb` | types | ✅ cherry-pick | WU-C |
| `8857dce` | types | ✅ cherry-pick | WU-D |
| `2c40ad1` | website | ❌ drop | WU-F1 |
| `2948835` | website | ❌ drop | WU-F1 |
| `3d44bf0` | website | ❌ drop | WU-F1 |
| `45a759b` | website fix | ❌ drop | WU-F1 |
| `8a562ef` | website fix | ❌ drop | WU-F1 |
| `cdba790` | website+vercel | ❌ drop | WU-F1 |
| `ee48844` | tooling | ❌ drop | WU-F2 |
| `c1ebcb4` | deps | ❌ drop | WU-F2 |
| `c4997d9` | ci lint-tools | ❌ drop | WU-F2 |

**统计**：49 commits = 30 cherry-pick + 11 drop(website) + 4 drop(tooling) + 4 cherry-pick(测试/provider 边缘)。

---

## 12. 落地后验收指标（继承 LUM-559 / 561 验收）

| 指标 | v6g-facade 当前 | main 当前 | WU-C 目标 | WU-E 目标 |
|---|---|---|---|---|
| agent-host.ts 行数 | 1,545（v6g）| 3,485 | ≤ 2,440（−30%） | ≤ 2,000 |
| host-modules 子文件数 | 130+ | 60 | 130+ | 130+ |
| Cordis 能力包顶层 import 数 | 0 | 13 | 0 | 0 |
| 每 token IPC 数 | 0（走 MessageChannel）| 1 | 0 | 0 |
| 真实 e2e specs | 0（v6g 不带 MiniMax）| 23 | 23 | 23 + perf |
| bundle unzipped | 14MB | 14MB | 14MB | ≤ 4MB |
| 冷启动 p95 | 未测 | 未测 | ≤ 2.5s | ≤ 1.5s |

---

## 13. 引用

- `git log main..origin/codex/agent-host-v6g-facade --reverse --stat` （本 issue 生成）
- `docs/AI_CHAT_PLAN.md` §2-3（Phase A-F）
- `docs/openbuddy-transformation-plan.html` §5（14 项缺口 P0/P1/P2）
- `PERFORMANCE_TRANSFORMATION_PLAN.md` §三（78 findings P0/P1/P2/P3）
- LUM-556（openbuddy 二期改造）、LUM-557（WU-A · 本 issue）、LUM-558/559/560/561（WU-B/C/D/E）

---

> **作者注**：本文件为只读侦察产出（WU-A），仅记录决策与冲突预判，不修改任何源码、不创建 PR、不调用 `git merge` / `git rebase`。下游 WU-B/C/D/E 在拿到本文件后按 §7.2 批次顺序执行 cherry-pick。
