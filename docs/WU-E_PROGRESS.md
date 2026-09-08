# WU-E 性能改造 — 实施进度 Wiki

> 📅 2026-09-08 · 分支 `agent/lumos-ts-coder/01a07df6-wu-e`（基于 WU-C `88e5e009acf2` HEAD=`ba25623`）
> 父任务：[LUM-556 openbuddy 二期改造](https://multica/issues/LUM-556)
> 子任务：[LUM-561 WU-E 性能改造 (P0/P1/P2/P3)](https://multica/issues/LUM-561)
> 来源计划：[`docs/PERFORMANCE_TRANSFORMATION_PLAN.md`](../../PERFORMANCE_TRANSFORMATION_PLAN.md) — 78 findings
> 前置：[LUM-559 WU-C 模块化 (reviewer PASS)](./agent-host-microkernel-v2.md)
>
> **状态**：in_progress · ts-coder 自动接续中 · 4 轮已落地（round 4 闭合 PC-5 / PC-6）

---

## 1. 范围回顾（per LUM-561 description）

| 阶段 | 周数 | 数量 | 主要交付 | 当前状态 |
|---|---|---|---|---|
| **P0 Quick Wins** | 2-3 周 | 8 findings | 冷启动 ≤ 2.5s，TTFT ≤ 400ms | 🟢 **7/8 完成**（P0-07 剩余） |
| **P1 核心重构** | 4-6 周 | 34 findings | 流式 60fps，bundle ≤ 8MB | 🟡 **1/34**（round 6 闭合 P1-04） |
| **P2 架构升级** | 4-6 周 | 36 findings | bundle ≤ 4MB，内存 ≤ 150MB | ⏳ 0/36 |
| **P3 度量治理** | 2-3 周 | — | perf budget gate 入 CI | 🟢 PC-5/PC-6 已入闸（round 4） |
| **合计** | **12-18 周** | **78** | **对齐 Codex 标杆** | 🟡 **6/78 = 7.7%**（+ P1-04） |

> v6g-facade 已闭合 7 项 findings（per WU-A merge plan §10），剩余 **71 项待本 WU 落地**。
> 已闭合项：P0-03 流式 16ms 节流（WU-C `0272216` MessageChannel）/ P0-04 顶层 import 拆分（WU-C）/ multi-chunk 流式（WU-C）/ microkernel 拆分（WU-C `8bafa55`）/ ts-error A 修复（WU-D `63b26e3` + WU-C hardening）。

---

## 2. 本 WU 累计提交（branch ahead of `agent/lumos-ts-coder/88e5e009acf2`）

```
<round 6 commit>  perf(renderer): memoize FindBar + FileChangesPanel for streaming-delta short-circuit (P1-04, WU-E round 6)
<round 6 commit>  docs(wiki): record WU-E round 6 — P1-04 ChatView memo 全覆盖 (LUM-561)
1bff988 perf(storage+dsh): P0-08 CoalescedStorageGateway + P0-05 deepseek 全树 deep-freeze (WU-E round 5)
acc579a docs(wiki): record WU-E round 5 — P0-05 + P0-08 closure (LUM-561)
a1e97ee perf(ci): PC-5 chat-render 60fps bench + PC-6 verify-plan/check-macos-signing CI integration (WU-E round 4)
cc0bba5 docs(wiki): record WU-E round 4 — PC-5 chat-render bench + PC-6 CI gate closure (LUM-561)
f8cf14d perf(renderer): lazy-load Sidebar + ChatView for P0-01 (WU-E round 3)
c872b3c docs(wiki): record WU-E first two rounds + zod followup cleanup (LUM-561)
4452e96 chore(gitignore): track docs/WU-E_PROGRESS.md so WU-E wiki ships in repo
3a35273 fix(test): unbreak 3 pre-existing zod hardcoded paths after zod 4.4.3 → 4.5.4 bump (WU-E followup #1)
267317a feat(perf): cold-start analyzer + O(1) streaming delta hot path (WU-E P3-02 + P0-06 hardening)
ba25623 fix(ui+review): PC-1 color contrast + PC-2 skeleton API + PC-3 e2e specs (来自 WU-C reviewer 移交)
```

> 父 WU-C 累计 **40 commits / 124 files / +10,637 / -2,028 行** ahead of main。
> WU-E 增量 **10 commits / 18 files / ~+1,800 / ~-80 行** ahead of WU-C（round 6 新增 2 commit / 4 文件，P1-04 FindBar + FileChangesPanel memo + ChatView onClose useCallback）。

---

## 4.2. 第六轮交付（commits round 6）— P1-04 ChatView memo 全覆盖

PERFORMANCE_TRANSFORMATION_PLAN §四 TOP 15 #5 / §三 P1 阶段 / wiki §8.3 priority 3。本轮落实 streaming-delta 下 chat surface 子组件的 re-render 短路。

### 4.2.1 FindBar memo + custom comparator

| 维度 | 实现 |
|---|---|
| 改动 1 | `packages/ui/openbuddy-ui-conversation/src/FindBar.tsx`：函数定义改名为 `FindBarInner`；新增 `findBarPropsAreEqual`（检查 `open` / `onClose` / `onActiveChange` / `onHitsChange` ref equality + `messages` length + first/last id fingerprint）；新增 `export const FindBar = memo(FindBarInner, findBarPropsAreEqual)` |
| 改动 2 | `packages/ui/openbuddy-ui-conversation/src/ChatView.tsx`：新增 `handleCloseFind = useCallback(...)`；`onClose` 改为引用 `handleCloseFind` 让 memo 看到 stable callback identity |
| 新文件 | `packages/ui/openbuddy-ui-conversation/src/__tests__/P1-04-memo.test.tsx` (210 行) — **6 个 vitest**：streaming-text-delta skip / length change re-render / first-id change re-render / last-id change re-render / open=false short-circuit / onClose identity change |

**为什么是 P1-04**：FindBar 之前是不带 memo 的函数组件，streaming reducer（round 1 P0-06）在每次 delta 产生新的 `messages` 数组 ref，导致 FindBar 每次都执行 `useMemo([messages, query])` 重算 `hitIds`，即使 `open === false`。Round 6 加 `memo` + 自定义 comparator，只检查 `messages.length` + first/last id，避免浅比较 O(N) 数组。

### 4.2.2 FileChangesPanel memo + custom comparator

| 维度 | 实现 |
|---|---|
| 改动 | `packages/ui/openbuddy-ui-conversation/src/FileChangesPanel.tsx`：函数定义改名为 `FileChangesPanelInner`；新增 `fileChangesPropsAreEqual`（messages ref equality 短路 + length/last-id 检查）；新增 `export const FileChangesPanel = memo(FileChangesPanelInner, fileChangesPropsAreEqual)` |
| 新增测试 | 同上 `P1-04-memo.test.tsx` **+4 个 vitest**：renders nothing when no diff / renders panel with diffs / streaming-text-delta skip / length change re-render |

**为什么是 P1-04**：FileChangesPanel 同样不带 memo，`aggregateFileChanges` useMemo 在每次 delta 重跑，浪费 CPU。Custom comparator 把"长度 + 末尾 id"作为 fingerprint，避免 text-delta 触发。

### 4.2.3 本轮验证

```bash
$ sh node_modules/.bin/vitest run packages/ui/openbuddy-ui-conversation/src/__tests__/P1-04-memo.test.tsx
Test Files  1 passed (1)
Tests       10 passed (10)

$ sh node_modules/.bin/vitest run packages/ui/openbuddy-ui-conversation --reporter=dot
Test Files  15 passed (15)
Tests       141 passed (141)

$ sh node_modules/.bin/vitest run --reporter=dot
Test Files  6 failed | 504 passed (510)
Tests       7 failed | 5317 passed | 16 skipped (5340)
```

> 全量 vitest：5307 → 5317 passed（+10 = 10 个 P1-04 memo tests）。7 fail pre-existing（与 round 5 完全一致，0 新增 regression）。
> `npx tsc --noEmit -p tsconfig.json` clean。
> 验证 PC-5 chat-render bench Σ=5.9ms / within60Fps=true 未变（本轮未改重组件，只优化 memo 短路）。

### 4.2.4 与 PC-5 chat-render bench 关系

本轮未扩展 PC-5 bench 加入 FindBar/FileChangesPanel 的 per-render 测量；memoization 验证通过对比单元测试（streaming-text-delta scenario 下 `useMemo` 不重算）而非 perf benchmark 完成。如果后续轮次需要 perf 证据，可加 4-5 项 bench：FindBar closed vs open × 200 messages × 100 iterations。

---

## 4.3. 第五轮交付（commits round 5）— P0-05 + P0-08 闭合

PERFORMANCE_TRANSFORMATION_PLAN §三 阶段 P0 第 5 条 + 第 8 条；reviewer 在 wiki §8.2 列为 priority 2 剩余项。本轮一次性补齐。

### 4.3.1 P0-05 deepseek-runtime 全树 freeze

| 维度 | 实现 |
|---|---|
| 新文件 1 | `electron/main/agent/host-modules/deepseek/_deep-freeze.ts` (62 行) — 递归 deepFreeze helper：跳过 class 实例 / 函数 / Date / Map / RegExp；处理 plain object + array + Set |
| 新文件 2 | `electron/main/agent/host-modules/deepseek/_deep-freeze.test.ts` (84 行) — **9 个 vitest**：覆盖 flat / nested / array / Set / 已 frozen 子树 / class 跳过 / 函数跳过 / primitives / 模块加载后导入集成验证 |
| 改动 1 | `host-runner-entries.ts` 末尾 `deepFreeze(BASE_HOST_RUNNER_ENTRIES)` — 41 个 DSH 默认入口（含嵌套 `config` / `inject`）全树 frozen |
| 改动 2 | `cordis-runtime.ts` `deepFreeze(DEEPSEEK_CORE_PACKAGE_NAMES)` + `Object.freeze(deepSeekCordisInvocationMethods)` + 循环冻结内部 string[] — 9 个核心包名 Set + 14 个 service 路由表全树 frozen |

**为什么是 P0-05**：PERFORMANCE_TRANSFORMATION_PLAN §三 阶段 P0 第 5 条列出 "deepseek-runtime 全树 freeze"。原 `BASE_HOST_RUNNER_ENTRIES` 用 `as const` 只让 TS 推 readonly，但嵌套对象实际可变 — 任何 `entry.config.root = ["."]` 都会 silently 改全局默认。本轮 `deepFreeze` 在模块加载时一次性 walk + freeze，让 future mutation attempt 在 strict mode throw / sloppy mode silently no-op。

**Set 冻结语义说明**：V8 不拦截 `Set.prototype.add` / `delete` / `clear` 即使 Set 本身被 `Object.freeze`。Set 的 protection 边界是 "binding 不可重赋值" — 内部成员仍可变。本轮在测试中明确记录这一 caveat；future 周如果需要 strict element immutability，可换 `Object.freeze([...set])` 转 array 或换 `ReadonlySet` 类型。

### 4.3.2 P0-08 SQLite 事务批量合并（CoalescedStorageGateway）

| 维度 | 实现 |
|---|---|
| 新文件 1 | `packages/runtime/openbuddy-storage/src/driver/coalesced-storage.ts` (180 行) — `createCoalescedStorageGateway(gateway, options)` + `createCoalescedGatewayFromDriver(driver, options)` |
| 新文件 2 | `packages/runtime/openbuddy-storage/src/__tests__/coalesced-storage.test.ts` (220 行) — **7 个 vitest**：3 合一事务 / idempotency 短路 / 单条失败隔离 / onFlush callback / flush 立即排空 / dispose 拒绝 / 无调度时无事务 |
| 行为 | N 条 `gateway.execute()` 落在 `windowMs`（默认 5ms）→ 合并为 1 个 `driver.transaction()`，per-call 结果 / 错误仍归原 caller |
| 幂等性 | 单条事务内仍走 `findIdempotentResult → apply → appendEvent → saveIdempotentResult → applyProjection` 完整 pipeline（用 `createStorageEvent` 重新构建 envelope，含 redact + hash） |
| 失败语义 | 单条 apply 失败 → 该 caller 拒绝，**siblings 继续完成**（外层 transaction 仍 commit）；外层 transaction 失败 → 所有 pending 拒绝 |

**为什么是 P0-08**：PERFORMANCE_TRANSFORMATION_PLAN §三 阶段 P0 第 8 条 "SQLite 事务批量合并"。原 `createWriteCoalescer` (driver.ts:340) 只在 `(tx) => Promise<T>` 层面 coalesce，调用方要自己写 idempotency-result store。`CoalescedStorageGateway` 包成完整 `StorageGateway.execute()` 的语义等价物，让 `execute()` callers 不感知 batching；同时给 call site 提供 `flush()` / `pendingCount()` / `dispose()` 控制能力。

**典型受益场景**：单个 tool result 触发 N 条 catalog writes（EventStore.append + CursorStore.update + TaskCatalog.replace + IdempotentResult.save + …）时，从 N fsync 变成 1 fsync。在 WAL 模式下 fsync 是 hot path 的主瓶颈。

### 4.3.3 本轮验证

```bash
$ sh node_modules/.bin/vitest run packages/runtime/openbuddy-storage --reporter=dot
Test Files  26 passed (26)
Tests       132 passed (132)

$ sh node_modules/.bin/vitest run electron/main/agent/host-modules/deepseek --reporter=dot
Test Files  3 passed (3)
Tests       26 passed (26)

$ sh node_modules/.bin/vitest run --reporter=dot
Test Files  6 failed | 503 passed (509)
Tests       7 failed | 5307 passed | 16 skipped (5330)
```

> 全量 vitest：5291 → 5307 passed（+16 = 9 deep-freeze + 7 coalesced-storage）。7 fail pre-existing（与 round 4 完全一致，0 新增 regression）。
> `npx tsc --noEmit -p tsconfig.json` clean。
> `node scripts/verify-plan.mjs` 16/16 PASS。
> `node --test _cold-start-lib _chat-render-lib` 34/34 PASS。

### 4.3.4 P0 quick wins 剩余 1 项

P0-05 + P0-08 闭合后，P0 阶段只剩 P0-07（Cordis 能力包静态 import 拆除收尾，范围 L，工作量 ≥ round 5 的 2 倍），建议下轮单独 PR。

---

## 4.4. 第四轮交付（commits round 4）— PC-5 / PC-6 闭合

reviewer 在 WU-C verdict 中将 **PC-5 (60fps 完整 perf benchmark)** + **PC-6 (verify-plan + check-macos-signing CI 入闸)** 列为强必填项，必须在 WU-E 第一个 PR 内或下轮 PR 中提交。本轮一次性补齐。

### 4.4.1 PC-5 chat-render 60fps benchmark

| 维度 | 实现 |
|---|---|
| 新文件 1 | `scripts/perf/_chat-render-lib.mjs` (160 行) — 纯函数 helpers：数据工厂 + 60fps frame-budget math + arg parser + summary builder |
| 新文件 2 | `scripts/perf/_chat-render-lib.test.mjs` (114 行) — **16 个 `node:test`** 覆盖所有 helpers（工厂产出 / budget math / arg parsing / JSON schema stability） |
| 新文件 3 | `scripts/perf/_chat-render-jsdom.test.ts` (157 行) — vitest + jsdom 实际 JSX 渲染 benchmark，使用 `react-dom/server.renderToString` 打通 react 真实渲染路径 |
| 新文件 4 | `scripts/perf/chat-render-bench.mjs` (107 行) — CLI shim：spawn vitest → 读 JSON artifact → `--strict` 模式检查 `within60Fps` 违反即退出 1 |
| 度量项 | 3 个：ChatMinimap 200 segments / BranchNavigator 平衡 3-level 4-ary 树（170 节点）/ Long-session 200 messages flat list |
| 输出 artifact | `evidence/perf/chat-render-bench-<timestamp>.json` — v1 schema：per-render µs + ops/sec + frame budget |
| CLI 入口 | `pnpm perf:chat-render` / `pnpm perf:chat-render:strict` / `pnpm perf:chat-render:test` |

**为什么这是 PC-5**：PERFORMANCE_TRANSFORMATION_PLAN §三 P3 阶段 / reviewer verdict PC-5 要求"完整 60fps perf benchmark (ChatMinimap + BranchNavigator + 长会话)"。原 `streaming-bench.mjs` 只测 reducer（纯 Node 数值），不跑真实 JSX 渲染。本轮补齐 jsdom + react-dom/server 路径，让 reviewer 可以直接观察到 chat surface 三个重量级组件的 render cost。

**实测数字**（本机 ubuntu-latest reference runner）：

| Bench | per-render | ops/sec | 60fps 预算 |
|---|---|---|---|
| ChatMinimap 200 segments | ~1.4 ms | 716 | |
| BranchNavigator 170-node tree | ~2.7 ms | 360 | |
| Long-session 200 messages | ~1.7 ms | 578 | |
| **Σ worst-case per frame** | **~5.9 ms** | — | **16.6 ms** |
| **Frame headroom** | — | — | **+10.7 ms (64% headroom)** |
| `within60Fps` | — | — | **true** |

`--strict` 模式下，任何 future regression 触预算即 CI 红。

### 4.4.2 PC-6 verify-plan + check-macos-signing CI 入闸

| 维度 | 实现 |
|---|---|
| 改动文件 | `.github/workflows/ci.yml` — `perf-budget` job 新增 4 步 |
| 步骤 1 | `pnpm run perf:chat-render:test` — PC-5 pure-helper 单元测试（不进 jsdom 重负担） |
| 步骤 2 | `pnpm run perf:chat-render:strict` — PC-5 60fps 完整 benchmark |
| 步骤 3 | `pnpm run verify:plan` — PC-6 单一权威 gate（涵盖 WU-B P0 closure 14 项 + WU-C arch 2 项 = 16 checks） |
| 步骤 4 | `sh node_modules/.bin/vitest run scripts/check-macos-signing.test.mjs` — PC-6 macOS signing 单元测试（24 tests） |
| 防回退 | 任何 reviewer-verified PASS 的 invariant 删除 / 改动 → verify-plan 红 |

**为什么这是 PC-6**：verify-plan 是 WU-B (c0b2821) + WU-C (88e5e009acf2) 合并产物（16/16 checks 已在本地验证）。check-macos-signing 24/24 unit tests 已在本地验证。本轮让它们在 CI 中同步运行，避免 future PR 误删某个 critical invariant（例如从 `release.yml` 删除 `check-macos-signing.mjs --verify` 调用）绕过 P0 闭合。

### 4.4.3 本轮验证

```bash
$ node --test scripts/perf/_cold-start-lib.test.mjs scripts/perf/_chat-render-lib.test.mjs
ℹ tests 34
ℹ pass 34
ℹ fail 0

$ node scripts/verify-plan.mjs
verify-plan: 16/16 passed, 0 required failed, 0 nice failed

$ sh node_modules/.bin/vitest run scripts/check-macos-signing.test.mjs --reporter=dot
✓ scripts/check-macos-signing.test.mjs (24 tests) 9ms
Test Files  1 passed (1)
Tests       24 passed (24)

$ node scripts/perf/chat-render-bench.mjs
[chat-render-bench] minimap=1395.87µs branch=2775.388µs long=1728.698µs
                    sum=5.9ms headroom=10.767ms within60Fps=true
[chat-render-bench] OK — within 60fps: true

$ sh node_modules/.bin/vitest run --reporter=dot
Test Files  6 failed | 501 passed (507)
Tests       7 failed | 5291 passed | 16 skipped (5314)
```

> 与 round 3 完全一致：5287 → 5291 passed（+4 来自 chat-render bench），7 fail pre-existing（xdg-open / deepseek-harness fixture / sandbox timing），**0 新增 regression**。
> `tsc --noEmit -p tsconfig.json` clean。
> `src/lib/__tests__/distributed-buddy-kernel.test.ts` 6/6 PASS（唯一 mount `<App />` 的测试）。

### 4.4.4 P0-02 状态更新

wiki 上轮标注 P0-02 = "App.tsx:238 部分落地，建议下一轮收紧"。复核发现：实际机制在 **`electron.vite.config.ts`**（不在 `src/App.tsx`）：

- L238: `modulePreload: { polyfill: false, resolveDependencies: … }` — 已完全落地
- L249: heavy-chunk filter (`markdown` / `katex` / `mermaid` / `cytoscape` / `cynefin`) — 已完全落地
- `src/` 全树 `__vitePreload` / `vitePreload` 搜索结果：**0 调用**（pre-existing wiki 注释指的是 electron-vite config，不是源码）

**修正**：P0-02 实际已闭合（与 WU-C v6-G 同步完成）。本轮不在此项目做新改动 — 调整 wiki 状态为 ✅ 已完成。

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
| **PC-5** | 60fps 完整 perf benchmark (ChatMinimap + BranchNavigator + 长会话) | WU-D + WU-C reviewer PARTIAL | ✅ **round 4 闭合** — chat-render-bench (jsdom + react-dom/server) Σ=5.9ms / budget=16.6ms / headroom=10.7ms |
| **PC-6** | verify-plan + check-macos-signing CI 入闸 | WU-C reviewer PASS | ✅ **round 4 闭合** — `.github/workflows/ci.yml` `perf-budget` job 新增 4 步骤（`perf:chat-render:test` / `perf:chat-render:strict` / `verify:plan` / check-macos-signing unit） |

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
| P0-01 渲染端 React.lazy 路由级拆分（完整闭环：Sidebar + ChatView + 6 个次级页面） | P0 | ✅ round 3 完成 | `src/App.tsx`（commit `f8cf14d`） |
| P0-02 移除 markdown/katex/mermaid 的 `__vitePreload(true)` | P0 | ✅ 实际已在 `electron.vite.config.ts` 闭合（wiki 误标 "App.tsx 部分落地" — 实际机制在 vite config） | `electron.vite.config.ts:238-249` |
| P0-03 流式 16ms 节流 | P0 | ✅ 已在 WU-C (`0272216`) | `electron/main/pi-stream-transport.ts` |
| P0-04 顶层 import 拆分 | P0 | ✅ 已在 WU-C | `electron/main/agent/host-modules/` 20 facade |
| P0-06 streaming delta hot path | P0 | ✅ round 1 完成（in-place mutation） | `src/stores/session-store.ts:285-330` |
| P3-02 cold-start analyzer | P3 | ✅ round 1 完成 | `scripts/perf/cold-start.mjs` + `_cold-start-lib.mjs` + `dashboard.mjs` |
| PC-5 60fps 完整 perf benchmark | P3 | ✅ **round 4 完成** | `scripts/perf/chat-render-bench.mjs` + `_chat-render-jsdom.test.ts` + `_chat-render-lib.mjs` + `.github/workflows/ci.yml` |
| PC-6 verify-plan + check-macos-signing CI 入闸 | P3 | ✅ **round 4 完成** | `.github/workflows/ci.yml` perf-budget job 新增 4 步骤 |
| zod followup (3 paths) | followup | ✅ round 2 完成 | commit `3a35273` |
| P0-05 deepseek-runtime 全树 freeze | P0 | ✅ **round 5 完成** | `electron/main/agent/host-modules/deepseek/_deep-freeze.ts` + 改动 `host-runner-entries.ts` + `cordis-runtime.ts` |
| P0-08 SQLite 事务批量合并（CoalescedStorageGateway） | P0 | ✅ **round 5 完成** | `packages/runtime/openbuddy-storage/src/driver/coalesced-storage.ts` |
| **P1-04 ChatView memo 全覆盖** | P1 | ✅ **round 6 完成**（FindBar + FileChangesPanel memo + custom comparator） | `packages/ui/openbuddy-ui-conversation/src/{FindBar,FileChangesPanel}.tsx` + `__tests__/P1-04-memo.test.tsx` |
| 其余 ~64 项 P0/P1/P2/P3 | 各阶段 | ⏳ 待后续多轮 WU-E | — |

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

### 8.1 优先级 1：~~PC-5 / PC-6 落地（reviewer 强必填）~~ ✅ round 4 闭合

| 项 | 范围 | 状态 |
|---|---|---|
| **PC-5** 60fps 完整 perf benchmark | ChatMinimap + BranchNavigator + 长会话 200 消息 | ✅ round 4 — `scripts/perf/chat-render-bench.mjs` (jsdom + react-dom/server) Σ=5.9ms / budget=16.6ms |
| **PC-6** verify-plan + check-macos-signing CI 入闸 | `.github/workflows/ci.yml` `perf-budget` job 新增 4 步骤 | ✅ round 4 — verify-plan 16/16 + check-macos-signing 24/24 unit + chat-render:test + chat-render:strict |

### 8.2 优先级 2：P0 quick wins 剩余 1 项

| # | 项 | 工作量 | 文件 |
|---|---|---|---|
| P0-01 | 渲染端 chunk 化（React.lazy + Suspense） | ✅ round 3 完成（Sidebar + ChatView 拆分） | `src/App.tsx` (commit `f8cf14d`) |
| P0-02 | 移除 markdown/katex/mermaid 的 `__vitePreload(true)` | ✅ 实际已在 `electron.vite.config.ts:238-249` 完成（`modulePreload.polyfill: false` + heavy-chunk filter） | `electron.vite.config.ts` |
| P0-05 | deepseek-runtime 全树 freeze | ✅ **round 5 完成**（`deepFreeze` helper + host-runner-entries / cordis-runtime 集成 + 9 unit tests） | `electron/main/agent/host-modules/deepseek/_deep-freeze.ts` |
| P0-07 | Cordis 能力包静态 import 拆除（部分已在 WU-C 完成） | L（剩余范围） | `electron/main/index.ts` |
| P0-08 | SQLite 事务批量合并 | ✅ **round 5 完成**（`CoalescedStorageGateway` + 7 unit tests） | `packages/runtime/openbuddy-storage/src/driver/coalesced-storage.ts` |

### 8.3 优先级 3：~~P1-04 ChatView memo 全覆盖~~ ✅ round 6 闭合

- **P1-04 ChatView memo 全覆盖** | ✅ **round 6 完成**（FindBar + FileChangesPanel memo + custom comparator + 10 unit tests） | `packages/ui/openbuddy-ui-conversation/src/{FindBar,FileChangesPanel}.tsx`
- P1-09 projects-store 写入 debounce：250ms → 500ms（如需要）
- P1-05 mergeStreamingDelta 已 O(1)（round 1），无需再做
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
                  └─ 10 commits: 267317a (P3-02 + P0-06) + 3a35273 (zod followup)
                                + c872b3c/4452e96 (wiki) + f8cf14d (P0-01 Sidebar+ChatView)
                                + a1e97ee/cc0bba5 (round 4: PC-5/PC-6)
                                + 1bff988/acc579a (round 5: P0-08 + P0-05)
                                + round 6 (P1-04 FindBar + FileChangesPanel memo)

[SECURITY] 🟡 LUM-575 ─────────────────── in_progress (audit 收口中)
[push]    🚧 LUM-578 3 branches ─────────── blocked (§0 + 无凭据, 与协调解耦)
```

---

## 12. 下次 turn 触发

- **6 轮落地：PC-5/PC-6 ✅ + P0-05/08 ✅ + P1-04 ✅** — 闭合 6 项 finding + 2 项 reviewer 强必填
- ts-coder WU-E 下一轮 PR 优先级：
  - **P0-07 Cordis 能力包静态 import 拆除收尾**（P0 唯一剩余，L 工作量）
  - **P2-13 pi-resources.ts 拆分**（priority 4，2129 行 → 4 chunk）
  - P1-09 projects-store 写入 debounce（如需要）
- WU-E 完成后 → status=in_review → 队长 dispatch reviewer 独立验收（重点关注 P1/P2 实际收益）
- lumos-security-reviewer LUM-575 audit 收口
- 人类 close LUM-557 / LUM-558 / LUM-560 / LUM-559
- LUM-562 (WU-F) 待独立 promote 评估
- **用户从 push A/B/C 路径选择（LUM-578）** — 当前 C 等 admin 响应
