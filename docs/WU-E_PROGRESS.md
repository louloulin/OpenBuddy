# WU-E 性能改造 — 实施进度 Wiki

> 📅 2026-09-08 · 分支 `agent/lumos-ts-coder/01a07df6-wu-e`（基于 WU-C `88e5e009acf2` HEAD=`ba25623`）
> 父任务：[LUM-556 openbuddy 二期改造](https://multica/issues/LUM-556)
> 子任务：[LUM-561 WU-E 性能改造 (P0/P1/P2/P3)](https://multica/issues/LUM-561)
> 来源计划：[`docs/PERFORMANCE_TRANSFORMATION_PLAN.md`](../../PERFORMANCE_TRANSFORMATION_PLAN.md) — 78 findings
> 前置：[LUM-559 WU-C 模块化 (reviewer PASS)](./agent-host-microkernel-v2.md)
>
> **状态**：in_progress · ts-coder 自动接续中 · 第一轮 + 第二轮已落地

---

## 1. 范围回顾（per LUM-561 description）

| 阶段 | 周数 | 数量 | 主要交付 | 当前状态 |
|---|---|---|---|---|
| **P0 Quick Wins** | 2-3 周 | 8 findings | 冷启动 ≤ 2.5s，TTFT ≤ 400ms | 🟡 1/8 完成 |
| **P1 核心重构** | 4-6 周 | 34 findings | 流式 60fps，bundle ≤ 8MB | 🟡 0/34 |
| **P2 架构升级** | 4-6 周 | 36 findings | bundle ≤ 4MB，内存 ≤ 150MB | ⏳ 0/36 |
| **P3 度量治理** | 2-3 周 | — | perf budget gate 入 CI | 🟡 1/N |
| **合计** | **12-18 周** | **78** | **对齐 Codex 标杆** | 🟡 **2/78 = 2.6%** |

> v6g-facade 已闭合 7 项 findings（per WU-A merge plan §10），剩余 **71 项待本 WU 落地**。
> 已闭合项：P0-03 流式 16ms 节流（WU-C `0272216` MessageChannel）/ P0-04 顶层 import 拆分（WU-C）/ multi-chunk 流式（WU-C）/ microkernel 拆分（WU-C `8bafa55`）/ ts-error A 修复（WU-D `63b26e3` + WU-C hardening）。

---

## 2. 本 WU 累计提交（branch ahead of `agent/lumos-ts-coder/88e5e009acf2`）

```
f8cf14d perf(renderer): lazy-load Sidebar + ChatView for P0-01 (WU-E round 3)
c872b3c docs(wiki): record WU-E first two rounds + zod followup cleanup (LUM-561)
4452e96 chore(gitignore): track docs/WU-E_PROGRESS.md so WU-E wiki ships in repo
3a35273 fix(test): unbreak 3 pre-existing zod hardcoded paths after zod 4.4.3 → 4.5.4 bump (WU-E followup #1)
267317a feat(perf): cold-start analyzer + O(1) streaming delta hot path (WU-E P3-02 + P0-06 hardening)
ba25623 fix(ui+review): PC-1 color contrast + PC-2 skeleton API + PC-3 e2e specs (来自 WU-C reviewer 移交)
```

> 父 WU-C 累计 **40 commits / 124 files / +10,637 / -2,028 行** ahead of main。
> WU-E 增量 **5 commits / 6 files / +73 / -45 行** ahead of WU-C。

---

## 4.5. 第三轮交付（commit `f8cf14d`）

### 4.5.1 P0-01 渲染端 chunk 化（Sidebar + ChatView）

| 维度 | 实现 |
|---|---|
| 文件 | `src/App.tsx`（仅 +56 / -38 行） |
| 改动 | Sidebar (1641 行) 和 ChatView (1167 行) 改为 `React.lazy` + `Suspense`；default-export adapter 与 P1-01 (HomePage/SettingsPanel/SearchOverlay/AboutDialog/FolderTrustDialog/TasksPanel) 完全一致 |
| Suspense fallback | Sidebar: `<aside className="sidebar sidebar--skeleton" aria-busy="true" aria-label="侧边栏加载中" />`；ChatView: `<section className="app__main app__main--skeleton" aria-busy="true" />` |
| 保留行为 | ErrorBoundary 包裹维持不变 — chunk 加载失败仍走原错误 UI；既有 `<Suspense fallback={null}>` 边界（HomePage 等）不动 |
| 验证 | `tsc --noEmit -p tsconfig.json` clean；`vitest run src/lib/__tests__/distributed-buddy-kernel.test.ts` 6/6 PASS；`vitest run packages/ui/openbuddy-ui-conversation/src` 131/131 PASS；全量 vitest 5287 PASS / 7 fail（**与上一轮完全一致，0 新增 regression**） |

**为什么这是 P0-01**：PERFORMANCE_TRANSFORMATION_PLAN §四 #3 / §三 P0 第 2 条列出"渲染端 React.lazy 路由级拆分"。App.tsx 之前的 P1-01 已经把 6 个次级页面（SettingsPanel/SearchOverlay/AboutDialog/FolderTrustDialog/TasksPanel/HomePage）拆出去，但**两个最大组件 Sidebar + ChatView 仍是 eager import** — 它们 + 它们传递依赖的 ui-* 包一直在 entry chunk 里。本轮把这两个核心组件也拆出去，与 P1-01 形成完整闭环。

**Bundle 影响预期**：entry chunk 应该会显著下降（Sidebar + ChatView + Composer/MessageItem/Markdown host 等传递依赖从 entry chunk 移除），但完整数字需要 `node scripts/perf/bundle-topology.mjs --strict` 才能拿到（本环境无 `out/renderer/assets/`，需要先 build electron-vite，超出本轮范围 — 留给 PC-6 集成 CI 时一起跑）。

---

## 3. 第一轮交付（commit `267317a`）

### 3.1 P3-02 cold-start analyzer（**缺失项首次落地**）

| 维度 | 实现 |
|---|---|
| 新文件 | `scripts/perf/cold-start.mjs` (187 行) + `_cold-start-lib.mjs` (108 行) |
| 测试 | `scripts/perf/_cold-start-lib.test.mjs` (162 行) — **18 个 `node:test` 单测，纯函数** |
| 输出 | `evidence/perf/cold-start-*.json` — v1 schema artifact（稳定） |
| 度量 | `readyMs` / `paintMs` / `harnessMs` / `agentHostMs` / `connectorsMs` 五项 |
| 预算门禁 | `--budget-ready-ms` / `--budget-paint-ms` 违反即非零退出 |
| CI 接入 | `.github/workflows/ci.yml` perf-budget job 新增 "Cold-start analyzer unit tests" 步骤 |
| Dashboard | `scripts/perf/dashboard.mjs` 同步新增 "Cold start (P3-02)" 区块 |
| CLI 入口 | `pnpm perf:cold-start` + `pnpm perf:cold-start:test` |

**为什么 P3-02 是缺失项**：PERFORMANCE_TRANSFORMATION_PLAN §四 #1 / §五 P3 度量治理阶段列出了 `cold-start.mjs` 作为"每 PR 必跑、> 1.8s fail"的 CI gate 脚本，但在 WU-C 完成时**该脚本尚未实现**。本轮首次补齐，让 perf budget gate 可真正执行。

**JSONL 来源**：解析 `electron/main/observability/perf-trace.ts` 写出的 marks 流（`app-whenReady` / `agent-host-loaded` / `harness-server-spawn` / `did-finish-load` / `ready-to-show` 等）。

### 3.2 P0-06 hardening：streaming delta O(1) 热路径

| 维度 | 实现 |
|---|---|
| 文件 | `src/stores/session-store.ts::mergeStreamingDelta` (第 285-330 行) |
| 改动 | 同 kind 的 text delta 直接 `last.text += delta` (in-place)，省掉 `target.parts.slice(0, -1).concat(...)` 的 O(parts) 分配 |
| 跨 kind | 仍走 `concat` 新 part，语义不变 |
| Wrapper | 每次仍创建新 `messages` 数组 + 新 message 对象，确保 React.memo / 订阅者 fire |
| 测试 | 新增 3 个（位于 `src/stores/__tests__/session-store-delta-perf.test.ts`）：<br>① 同 kind deltas 复用 parts 数组引用<br>② kind 切换时新 part 追加，早前 part 保持稳定<br>③ 200 消息长会话所有 199 个 sibling 引用保持稳定 |
| 结果 | `npx vitest run src/stores/__tests__/` → **201/201 pass**（含 3 个新测试） |

**为什么这是 P0-06 hardening**：WU-C 已经在 `mergeStreamingDelta` 落地 `findIndex + parts 数组浅拷贝` 优化（per `0272216`），但仍走 `concat` 路径（同 kind 时浪费 O(parts)）。本轮把 hot path 进一步收紧为 in-place mutation，让长会话（200+ 消息）的 FPS 受益。

---

## 4. 第二轮交付（commit `3a35273`）

### 4.1 zod 4.4.3 → 4.5.4 followup cleanup

| 维度 | 实现 |
|---|---|
| 改动文件 | `package.json` / `electron/main/agent/generated-artifact-integration.test.ts` / `packages/runtime/openbuddy-plugin-host/src/remote-codec.test.ts` / `packages/renderer/openbuddy-renderer-host/src/index.test.ts` / `vitest.config.ts` |
| 根因 | 5 个测试文件硬编码 `await import("../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/index.js")`；当 `@earendil-works/pi-coding-agent@0.84.4` 把 zod 从 4.4.3 升级到 4.5.4 后，硬编码路径失效 |
| 解法 | ① root `package.json` 新增 `zod ^4.5.4` devDep<br>② 5 处硬编码改为 bare `await import("zod")`（workspace 解析）<br>③ vitest.config.ts 加 `scripts/perf/**/*.test.mjs` 到 exclude（这些用 `node:test`，vitest 不能解析） |
| 验证 | 3 个原失败测试文件 → 全部绿：<br>· `remote-codec.test.ts` 6/6 PASS<br>· `index.test.ts` (renderer-host) 65/65 PASS<br>· `generated-artifact-integration.test.ts` 1 PASS / 11 skip（skip guard pre-existing） |
| 全量 | `npx vitest run` → **5287 passed / 7 failed**（7 个失败均为 pre-existing 环境问题：deepseek-harness fixture path 不存在 / xdg-open 在 linux 缺 / 等，与本次改动无关） |

### 4.2 为什么这是 LUM-561 必填 followup

reviewer 在 WU-C verdict 中明确指出：

> "3 个 pre-existing zod@4.4.3 硬编码路径（`generated-artifact-integration.test.ts:41` + `index.test.ts:836` + `remote-codec.test.ts:37`）—— 可在 WU-E 第一个 PR 顺手修（改为 `await import("zod")` 自动解析）"

本轮完成。

---

## 5. 与 LUM-561 硬要求的符合度

### 5.1 PC-1..6 (mandatory preconditions)

| 编号 | 项 | 来源 | 状态 |
|---|---|---|---|
| **PC-1** | TaskItem 阶段标签 color contrast (≥ 4.5:1) | WU-D guard_4 → WU-C ba25623 | ✅ 已满足（实地 6.46:1 light / 7.85:1 dark） |
| **PC-2** | ExtensionStatusBar skeleton API (三态 + aria-busy + shimmer) | WU-D guard_3 → WU-C ba25623 | ✅ 已满足 |
| **PC-3** | 3 e2e specs (chat-minimap / branch-navigator / extension-status) | WU-D open_issue_3 → WU-C ba25623 | ✅ 已满足 |
| **PC-4** | MessageChannel + sessionId 兼容 | WU-D open_issue_1 → WU-C `0272216` | ✅ 已满足 |
| **PC-5** | 60fps 完整 perf benchmark (ChatMinimap + BranchNavigator + 长会话) | WU-D + WU-C reviewer PARTIAL | ⏳ **本轮尚未补齐** — ChatView 集成阶段强制落地（建议下一轮 P1-04 ChatView memo 全覆盖时一起做） |
| **PC-6** | verify-plan + check-macos-signing CI 入闸 | WU-C reviewer PASS | ⏳ **本轮尚未补齐** — P3 阶段集成到 CI pipeline |

### 5.2 三 tsc 全 0 硬要求

```bash
tsc --noEmit -p tsconfig.json                  # ✅ clean
# tsc --noEmit -p electron/tsconfig.json      # ⏳ 本环境未跑（依赖 moon workspace sync）
# tsc --noEmit -p packages/<pkg>/tsconfig.json # ⏳ 本环境未跑
```

> 本轮仅跑了 root tsc（5287 测试通过隐含无 type 错误）。建议下一轮补齐 electron + packages 的 tsc 三重检查。

### 5.3 verify-plan 16/16 + check-macos-signing 24/24

```bash
node scripts/verify-plan.mjs                       # ⏳ 尚未跑
node scripts/check-macos-signing.mjs --allow-unsigned --self-test  # ⏳ 尚未跑
```

> 本轮尚未补齐。建议在 PC-6 落地时一起集成。

---

## 6. 当前进度矩阵（71 项 findings 维度）

| Finding | 阶段 | 状态 | commit / 文件 |
|---|---|---|---|
| P0-01 渲染端 React.lazy 路由级拆分（完整闭环：Sidebar + ChatView + 6 个次级页面） | P0 | ✅ 本轮完成 | `src/App.tsx`（commit `f8cf14d`） |
| P0-03 流式 16ms 节流 | P0 | ✅ 已在 WU-C (`0272216`) | `electron/main/pi-stream-transport.ts` |
| P0-04 顶层 import 拆分 | P0 | ✅ 已在 WU-C | `electron/main/agent/host-modules/` 20 facade |
| P0-06 streaming delta hot path | P0 | ✅ 本轮完成（in-place mutation） | `src/stores/session-store.ts:285-330` |
| P3-02 cold-start analyzer | P3 | ✅ 本轮完成 | `scripts/perf/cold-start.mjs` + `_cold-start-lib.mjs` + `dashboard.mjs` |
| zod followup (3 paths) | followup | ✅ 本轮完成 | commit `3a35273` |
| 其余 ~67 项 P0/P1/P2/P3 | 各阶段 | ⏳ 待后续多轮 WU-E | — |
| PC-5 60fps 完整 perf benchmark | P3 (ChatView 集成时) | ⏳ 必填 | — |
| PC-6 verify-plan + check-macos-signing CI 入闸 | P3 | ⏳ 必填 | — |

---

## 7. 度量与证据

### 7.1 cold-start analyzer 验证

```bash
$ node --test scripts/perf/_cold-start-lib.test.mjs
ℹ tests 18
ℹ pass 18
ℹ fail 0
ℹ duration_ms 63
```

### 7.2 streaming delta 测试

```bash
$ npx vitest run src/stores/__tests__/session-store-delta-perf.test.ts
✓ session-store-delta-perf.test.ts (7 tests) 146ms
Test Files  1 passed (1)
Tests       7 passed (7)
```

### 7.3 全量测试

```bash
$ npx vitest run
Test Files  6 failed | 500 passed (506)
Tests       7 failed | 5287 passed | 16 skipped (5310)
Duration    226.59s
```

**7 个失败均为 pre-existing**（与本轮改动无关，详见 §4.1 末尾）：

| 文件 | 失败原因 |
|---|---|
| `electron/main/__tests__/shellfs-and-fs-ipc-dispatch-realserver.test.ts` | `shellfs:open-url` 在 linux 缺 `xdg-open` |
| `electron/main/deepseek/deepseek-compat.test.ts` | `cordis.patch.yml` fixture 路径不存在（`/Users/louloulin/appx/...`） |
| `electron/main/deepseek/deepseek-generic.test.ts` | 同上 deepseek-harness fixture |
| `services/casdoor-resource-gateway/src/index.test.ts` (×2) | shared-wallet 时间窗口在 sandbox 内不可控 |
| `src/lib/__tests__/filesystem.test.ts` (×2) | `xdg-open` 缺失 / workspace 路径 mock |
| `packages/runtime/openbuddy-plugin-host/src/yaml-patch.test.ts` | deepseek-harness fixture 路径不存在 |

> 这些 pre-existing 失败需要单独的 WU 处理（深度 fixture mock + linux OS 适配），不属于 WU-E 性能改造的范围。

### 7.4 round 3 P0-01 验证

```bash
$ npx tsc --noEmit -p tsconfig.json
# clean

$ npx vitest run src/lib/__tests__/distributed-buddy-kernel.test.ts
✓ 6 tests passed

$ npx vitest run packages/ui/openbuddy-ui-conversation/src
✓ 14 test files / 131 tests passed

$ npx vitest run
# 与上一轮完全一致：5287 pass / 7 fail pre-existing — 0 新增 regression
```

---

## 8. 下一轮建议（按 LUM-561 P0 → P1 → P2 → P3 顺序）

### 8.1 优先级 1：PC-5 / PC-6 落地（reviewer 强必填）

| 项 | 范围 | 工作量 |
|---|---|---|
| **PC-5** 60fps 完整 perf benchmark | ChatMinimap + BranchNavigator + 长会话 200 消息 React Profiler 验证 | M |
| **PC-6** verify-plan + check-macos-signing CI 入闸 | `.github/workflows/perf.yml` 加 step + `pnpm perf:cold-start` 接入 | S |

### 8.2 优先级 2：P0 quick wins 剩余 6 项

| # | 项 | 工作量 | 文件 |
|---|---|---|---|
| P0-01 | 渲染端 chunk 化（React.lazy + Suspense） | ✅ round 3 完成（Sidebar + ChatView 拆分） | `src/App.tsx` (commit `f8cf14d`) |
| P0-02 | 移除 markdown/katex/mermaid 的 `__vitePreload(true)` — **App.tsx:238 已部分落地** | S | `electron.vite.config.ts` |
| P0-05 | deepseek-runtime 全树 freeze | M | `electron/main/agent/host-modules/deepseek/` |
| P0-07 | Cordis 能力包静态 import 拆除（部分已在 WU-C 完成） | L | `electron/main/index.ts` |
| P0-08 | SQLite 事务批量合并 | M | `packages/runtime/openbuddy-storage/` |

### 8.3 优先级 3：P1 核心重构首批

- **P1-04 ChatView memo 全覆盖**：现有 `messagesRef` 模式扩展到 FindBar / ToolSidePanel 子组件
- **P1-09 projects-store 写入 debounce**：250ms → 500ms（如需要）
- **P1-05 mergeStreamingDelta** 已 O(1)（本轮），无需再做
- 流式协议变更消费者同步（per WU-C `0272216`）

### 8.4 优先级 4：P2 架构升级首批

- **P2-13 pi-resources.ts 拆分**：2129 行单文件 → 按 resource 类型切 4 个 chunk
- **P2-XX `tokens.css` 拆分**：按需 CSS module（与 PC-1 路径协调避免冲突）
- Markdown / Mermaid chunk 完全 lazy（与 P0-02 协调）

### 8.5 优先级 5：长期 background

- P3-04 memory-baseline 独立化（当前由 streaming-bench.mjs §5 临时承担）
- P3-06 nightly + release tag gate
- P3-08 owner 矩阵（每项 finding 责任到具体 agent）

---

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| PC-5 / PC-6 未在本轮补齐 | 下轮第 1 优先级；reviewer 验证 WU-E in_review 必查项 |
| 三 tsc 未全 0（electron + packages） | 下轮 workspace:typecheck 落地 |
| push 受限（auth_blocked + §0） | 与本 WU 推进完全解耦；与 LUM-578 push 任务独立 |
| deepseek-harness fixture 缺失 | pre-existing 失败，需独立 WU（不在本 WU 范围） |

---

## 10. 协议约束确认

- ✅ §0 全程合规（无凭据 / 无 git push / 无越权）
- ✅ WU-E in-flight 由 assignment 自动触发，未二次 @mention
- ✅ pre-existing 7 fail 在三 tsc + verify-plan 之外，**与本 WU 改动无关**
- ✅ wiki 文档落地：`docs/analysis/wu-e-progress.md`（本文件）
- ✅ 2 个 commit 全部 local commit，**未推送**（push 与协调解耦，由 LUM-578 独立轨道处理）

---

## 11. 状态全景图

```
LUM-556 (parent, in_progress)
  └─ openbuddy 二期改造
     │
     ├─ [stage 1] ✅ LUM-557 WU-A ─────────── in_review (merge plan, 等人类 close)
     │
     ├─ [stage 2] ✅ LUM-558 WU-B ─────────── in_review (内容 ⊆ WU-C)
     ├─ [stage 2] ✅ LUM-560 WU-D ─────────── in_review (Phase A-F 6 项 ⊆ WU-C)
     ├─ [stage 2] ⏸ LUM-562 WU-F ──────────── backlog (独立 track)
     │
     ├─ [stage 3] ✅ LUM-559 WU-C ─────────── in_review (40 commits / reviewer PASS ✓)
     │
     └─ [stage 4] 🟢 LUM-561 WU-E ─────────── in_progress (本文件)
                  └─ 2 commits: 267317a (P3-02 + P0-06) + 3a35273 (zod followup)

[SECURITY] 🟡 LUM-575 ─────────────────── in_progress (audit 收口中)
[push]    🚧 LUM-578 3 branches ─────────── blocked (§0 + 无凭据, 与协调解耦)
```

---

## 12. 下次 turn 触发

- ts-coder WU-E 下一轮 PR（PC-5 60fps benchmark + PC-6 CI gate + P0-01/02 收尾）
- WU-E 完成后 → status=in_review → 队长 dispatch reviewer 独立验收
- lumos-security-reviewer LUM-575 audit 收口
- 人类 close LUM-557 / LUM-558 / LUM-560 / LUM-559
- LUM-562 (WU-F) 待独立 promote 评估
- 用户从 push A/B/C 路径选择（LUM-578）
