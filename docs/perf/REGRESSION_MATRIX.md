# Performance Regression Matrix

> 🌐 [English](#english) · [简体中文](#简体中文)

This document is the **ground-truth companion** to `docs/PERFORMANCE.md`.
Where that file describes aspirational budgets, this one describes the
**actually-runnable commands, the actually-measured baselines, and the
specific code paths most likely to regress** when each script's
thresholds start to bite.

Last reviewed against: `codex/0902` (commits through P3-07 dashboard).

---

<a id="english"></a>

## 🇬🇧 English

### The four perf scripts

All live under `scripts/perf/`. Each one writes a JSON artifact to
`evidence/perf/` so the dashboard can aggregate trend data.

| Script | What it measures | Pass/fail | Used by |
|---|---|---|---|
| `bundle-topology.mjs --strict` | Entry chunk ≤ 4 MB; total ≤ 13 MB; heavy chunks (markdown/katex/mermaid/cytoscape/cynefin) split & lazy | **Fails CI on violation** | `.github/workflows/ci.yml → perf-budget` |
| `bundle-baseline.mjs --include-main --json=…` | Raw / gzip / brotli size of every renderer/main/preload chunk | Reporter only — never fails | Manual, dashboard ingest |
| `ipc-latency.mjs --json=…` | Per-call cost of `validateRpcRequestPayload + rpcPayload` | Reporter only | Manual, dashboard ingest |
| `dashboard.mjs` | Aggregates everything above into a single Markdown report | Reporter only | Manual review |

### Measured baselines (Apple M-class, Node 24, 3000 samples × 200 inner ops)

| Workload | Per-op cost | Notes |
|---|---|---|
| `host.describe` (empty payload) | **~0.12 µs** | Early-return path — allowed field list is empty |
| `agent.init` (2-field payload) | **~0.10 µs** | Short whitelist scan |
| `session.list` (with `cwd`) | **~3.0 µs** | Required+optional string checks |
| `plugin.snapshot` (large whitelist) | **~3.1 µs** | ~12 allowed keys to scan per call |
| `rpcPayload({})` extraction only | **<0.1 µs** | Cheap shape check |

These are the **floor cost** of `dispatchTypedRpc` — any wrapper code
added between the renderer call and `validateRpcRequestPayload` will
show up here as additional µs/op.

### Bundle topology budget (P3-01 CI gate)

| Chunk type | Budget | Today |
|---|---|---|
| Entry chunk (`index-<hash>.js`) | ≤ 4 MB raw | ~3.1 MB |
| Renderer total | ≤ 13 MB raw | ~12 MB |
| Heavy chunks (markdown / katex / mermaid / cytoscape / cynefin) | Must exist AND must NOT be in entry's static graph or `<link rel="modulepreload">` | split + lazy |

Budget history is documented in the comment block at the top of
`scripts/perf/bundle-topology.mjs`. We deliberately set the entry
budget to today's value + 25% so the gate catches *unexpected*
regressions but doesn't block on already-known debt (the 1.5 MB
target requires route-level code-splitting and is tracked separately).

### Regression matrix — "what to check when you change X"

| Change | Likely regression | How to detect | Where to look |
|---|---|---|---|
| Add a new field to an RPC method's `fields` map in `packages/runtime/openbuddy-plugin-host/src/rpc-contract.ts` | Per-call cost grows ~0.05 µs per new field | `node scripts/perf/ipc-latency.mjs` — `plugin.snapshot` row | `rpc-contract.ts:284` |
| Add a new heavy dependency in renderer code | Entry chunk grows | CI fails `perf-budget` job | `.github/workflows/ci.yml:113` |
| Switch `import` to `await import(...)` for a heavy module | First IPC call after switch is ~10–50 ms slower (cold load) | Manually time `host.describe` first call | NAPI native bindings — already gated behind lazy imports |
| Add a `useEffect` that mutates a Zustand store on every render | Streaming FPS drops | Manual profiling | `packages/ui/*/src/**/*Store.ts` |
| Add `JSON.stringify` on a hot IPC payload | ~5–50 µs per call depending on payload size | `node scripts/perf/ipc-latency.mjs` — payload-extraction row | Avoid; use structured clone |
| Add a `try/catch` around a synchronous hot path | <1 µs — negligible | Don't bother measuring | — |
| Increase `overscan` in `VirtualizedMessageList` | Memory grows proportionally; visible FPS unchanged | Profile with DevTools | `packages/ui/openbuddy-ui-conversation/src/VirtualizedMessageList.tsx` |
| Pin a new package at top of `electron/main/agent/pi-resources.ts` | Entry chunk grows | CI fails `perf-budget` job | Sub-modules in `electron/main/agent/pi-resources/` keep each domain lazy |
| Increase `console.log` verbosity in production | ~50–200 µs per log in Electron 44 | Don't; strip via `node --no-warnings` or build flag | `electron/main/index.ts` |
| Add a new IPC handler in `electron/main/ipc/*.ts` | Registry drift test fails on duplicate channels or bad names | `pnpm exec vitest run electron/main/ipc/__tests__/registry-drift.test.ts` | `electron/main/ipc/__tests__/registry-drift.test.ts` |

### How to run a perf check before opening a PR

```bash
# 1. Build the renderer (needed for bundle-topology + bundle-baseline)
pnpm install --frozen-lockfile
pnpm moon:sync
pnpm exec electron-vite build

# 2. Bundle topology — CI-gate quality check
node scripts/perf/bundle-topology.mjs --strict

# 3. Bundle baseline — produces a JSON artifact for trend tracking
node scripts/perf/bundle-baseline.mjs --include-main \
  --json=evidence/perf/bundle-baseline-$(date +%s).json

# 4. IPC latency — measures per-call validator cost
node scripts/perf/ipc-latency.mjs \
  --iterations=3000 --inner=200 \
  --json=evidence/perf/ipc-latency-$(date +%s).json

# 5. Aggregate everything
node scripts/perf/dashboard.mjs --since-days=7
```

Attach the dashboard output to the PR description so reviewers can see
before/after numbers. The dashboard itself does not gate — only
`bundle-topology.mjs --strict` does.

### When the CI gate fails

`bundle-topology.mjs --strict` runs in `.github/workflows/ci.yml →
perf-budget`. Typical failures and the fix:

| Failure | Root cause | Fix |
|---|---|---|
| `entry chunk X MB > 4 MB` | New top-level import in `electron/main/` or a new React entry dependency | Move the import behind `await import(...)` in the handler that needs it |
| `total X MB > 13 MB` | New chunk added without splitting | Add it to the `HEAVY_CHUNK_NAMES` array in `bundle-topology.mjs` if it's a heavy library that should be lazy |
| `<chunk> STATIC-IMPORT` | A heavy chunk is now eagerly imported from the entry | Find the import site; switch to dynamic `import()` |

### When the IPC latency regresses by >5%

`dashboard.mjs` flags mean regressions >5% with a ⚠️ marker. Typical causes:

1. **New required-string checks** added to a hot method.
2. **New required-integer checks** added to a hot method.
3. **Validator table grew** — more methods = slightly longer linear-scan
   worst case (not currently an issue: lookup is `Map[method]` so adding
   new methods doesn't slow existing ones).
4. **A wrapper layer** added to `dispatchTypedRpc` between the renderer
   call and `validateRpcRequestPayload`.

Fix by:
- Moving the check into a per-method handler (only the methods that
  need it pay the cost).
- Switching from string-trim checks to type-only checks (`typeof === "string"`).
- Batching required+optional field lookups.

### Out of scope (deliberately)

These are documented in `PERFORMANCE_TRANSFORMATION_PLAN.md` but were
rejected as too high-risk or out of scope for the current cycle:

- **P2-01** multi-chunk vendor split (Vite already handles this via default `splitChunks`).
- **P2-03** MessageChannel-based renderer ↔ main streaming (bypasses IPC for stream deltas; deferred).
- **P2-08** lucide-react → local SVG (reverted per user feedback — added weight without measurable benefit).
- **P2-09** Tailwind purge audit (no Tailwind in renderer).
- **P3-02** Puppeteer-driven perf CI (slow + flaky in CI).
- **P3-05** Real-time stream-FPS dashboard (requires real UI; deferred to closed-loop eval).
- **P2-13 step 3** — completed. `electron.vite.config.ts` now uses `inlineDynamicImports: false`; the main entry and AgentHost/capability ESM chunks are emitted separately. `scripts/perf/check-main-chunks.mjs` and the CI `perf-budget` job guard this topology. The remaining work is reducing the entry's synchronous dependency graph without regressing startup behavior.

---

<a id="简体中文"></a>

## 🇨🇳 简体中文

### 四个 perf 脚本

全部位于 `scripts/perf/`,都会往 `evidence/perf/` 写 JSON 产物供 dashboard 聚合趋势。

| 脚本 | 测什么 | 通过/失败 | 谁调用 |
|---|---|---|---|
| `bundle-topology.mjs --strict` | 入口 chunk ≤ 4 MB;总 ≤ 13 MB;heavy chunks(markdown/katex/mermaid/cytoscape/cynefin)分割且懒加载 | **违反即失败** | `.github/workflows/ci.yml → perf-budget` |
| `bundle-baseline.mjs --include-main --json=…` | 每个 renderer/main/preload chunk 的 raw / gzip / brotli 大小 | 仅报告,不失败 | 手动、dashboard |
| `ipc-latency.mjs --json=…` | 每次调用 `validateRpcRequestPayload + rpcPayload` 的开销 | 仅报告 | 手动、dashboard |
| `dashboard.mjs` | 把以上所有聚合到一份 Markdown 报告 | 仅报告 | 手动 review |

### 实测基线(Apple M 系列,Node 24,3000 样本 × 200 内循环)

| 工作负载 | 单次开销 | 备注 |
|---|---|---|
| `host.describe`(空 payload) | **~0.12 µs** | 早返回路径 —— allowed field 列表为空 |
| `agent.init`(2 字段 payload) | **~0.10 µs** | 短 whitelist 扫描 |
| `session.list`(带 `cwd`) | **~3.0 µs** | 必填+可选字符串检查 |
| `plugin.snapshot`(大 whitelist) | **~3.1 µs** | 每次调用扫描 ~12 个 allowed key |
| `rpcPayload({})` 仅提取 | **<0.1 µs** | 廉价 shape 检查 |

这些是 `dispatchTypedRpc` 的**地板成本** —— 渲染端调用和 `validateRpcRequestPayload` 之间加任何包装代码都会在这里显示为额外的 µs/op。

### Bundle topology 预算(P3-01 CI 门禁)

| Chunk 类型 | 预算 | 当前 |
|---|---|---|
| 入口 chunk(`index-<hash>.js`) | ≤ 4 MB raw | ~3.1 MB |
| Renderer 总体 | ≤ 13 MB raw | ~12 MB |
| Heavy chunks(markdown / katex / mermaid / cytoscape / cynefin) | 必须存在且不能出现在入口的静态图或 `<link rel="modulepreload">` | 已分割+懒加载 |

预算历史记录在 `scripts/perf/bundle-topology.mjs` 顶部注释里。我们刻意把入口预算设成当前值 + 25%,这样门禁能抓住**意外**回退,但不会因为已知债务阻塞(1.5 MB 的目标需要路由级代码分割,另列追踪)。

### 回归矩阵 —— "改 X 之前要检查什么"

| 改动 | 可能回退 | 怎么发现 | 看哪里 |
|---|---|---|---|
| 在 `packages/runtime/openbuddy-plugin-host/src/rpc-contract.ts` 的 `fields` map 里加新字段 | 单次成本随字段数增长 ~0.05 µs | `node scripts/perf/ipc-latency.mjs` —— `plugin.snapshot` 行 | `rpc-contract.ts:284` |
| 在 renderer 代码里加新的重依赖 | 入口 chunk 增长 | CI `perf-budget` job 失败 | `.github/workflows/ci.yml:113` |
| 把 `import` 换成 `await import(...)` 加载重模块 | 切换后首次 IPC 调用慢 ~10–50 ms(冷加载) | 手动计时 `host.describe` 首次调用 | NAPI native 绑定 —— 已在懒 import 后门之后 |
| 加 `useEffect` 在每次渲染时变更 Zustand store | 流式 FPS 下降 | 手动 profiling | `packages/ui/*/src/**/*Store.ts` |
| 在热 IPC payload 上 `JSON.stringify` | 每次 ~5–50 µs,视 payload 大小 | `node scripts/perf/ipc-latency.mjs` —— payload-extraction 行 | 避免;用 structured clone |
| 同步热路径外面包 `try/catch` | <1 µs —— 可忽略 | 不用测 | — |
| 增大 `VirtualizedMessageList` 的 `overscan` | 内存成比例增长;可见 FPS 不变 | DevTools profile | `packages/ui/openbuddy-ui-conversation/src/VirtualizedMessageList.tsx` |
| 在 `electron/main/agent/pi-resources.ts` 顶层 pin 新包 | 入口 chunk 增长 | CI `perf-budget` job 失败 | `electron/main/agent/pi-resources/` 下的子模块各自保持懒加载 |
| 生产环境 `console.log` 加详细 | Electron 44 下每次 ~50–200 µs | 别加;用 `node --no-warnings` 或构建 flag 剥掉 | `electron/main/index.ts` |
| 在 `electron/main/ipc/*.ts` 加新 IPC handler | Registry drift 测试失败(重复 channel 或命名不规范) | `pnpm exec vitest run electron/main/ipc/__tests__/registry-drift.test.ts` | `electron/main/ipc/__tests__/registry-drift.test.ts` |

### 提 PR 前怎么跑 perf 检查

```bash
# 1. 构建 renderer(bundle-topology + bundle-baseline 需要)
pnpm install --frozen-lockfile
pnpm moon:sync
pnpm exec electron-vite build

# 2. Bundle topology —— CI 门禁质量检查
node scripts/perf/bundle-topology.mjs --strict

# 3. Bundle baseline —— 生成 JSON 产物用于趋势追踪
node scripts/perf/bundle-baseline.mjs --include-main \
  --json=evidence/perf/bundle-baseline-$(date +%s).json

# 4. IPC latency —— 单次验证器开销
node scripts/perf/ipc-latency.mjs \
  --iterations=3000 --inner=200 \
  --json=evidence/perf/ipc-latency-$(date +%s).json

# 5. 聚合
node scripts/perf/dashboard.mjs --since-days=7
```

把 dashboard 输出贴到 PR 描述里,reviewer 能直接看到 before/after 数字。dashboard 本身不设门禁 —— 只有 `bundle-topology.mjs --strict` 设。

### CI 门禁失败时

`bundle-topology.mjs --strict` 在 `.github/workflows/ci.yml → perf-budget` 里跑。常见失败和修法:

| 失败 | 根因 | 修法 |
|---|---|---|
| `entry chunk X MB > 4 MB` | `electron/main/` 顶层新 import 或 React 入口新依赖 | 把 import 移到具体 handler 的 `await import(...)` 后面 |
| `total X MB > 13 MB` | 新增 chunk 但没分割 | 如果是应该懒加载的重库,加到 `bundle-topology.mjs` 的 `HEAVY_CHUNK_NAMES` 数组里 |
| `<chunk> STATIC-IMPORT` | 入口现在急切 import 了一个 heavy chunk | 找到 import 位置;换成动态 `import()` |

### IPC 延迟回退 >5% 时

`dashboard.mjs` 用 ⚠️ 标记 mean 回退 >5%。常见原因:

1. 给热方法加了新的必填字符串检查。
2. 给热方法加了新的必填整数检查。
3. 验证器表变大 —— 更多方法 = 线性扫描最坏情况略长(目前不是问题:查找是 `Map[method]`,加方法不会拖慢旧方法)。
4. 在 `dispatchTypedRpc` 渲染端调用和 `validateRpcRequestPayload` 之间加了包装层。

修法:
- 把检查移到具体方法 handler 里(只有需要的方法付成本)。
- 字符串 trim 检查换成纯类型检查(`typeof === "string"`)。
- 批量必填+可选字段查询。

### 故意不做

这些在 `PERFORMANCE_TRANSFORMATION_PLAN.md` 里列了但被否决,因为风险太高或超出本周期范围:

- **P2-01** 多 chunk vendor 分割(Vite 默认 `splitChunks` 已经处理)。
- **P2-03** 基于 MessageChannel 的 renderer ↔ main 流式(绕过 IPC 走 stream delta;延期)。
- **P2-08** lucide-react → 本地 SVG(按用户反馈已回退 —— 加权但没有可量化收益)。
- **P2-09** Tailwind purge 审计(renderer 里没有 Tailwind)。
- **P3-02** Puppeteer 驱动的 perf CI(CI 里又慢又飘)。
- **P3-05** 实时 stream-FPS dashboard(需要真实 UI;延期到 closed-loop eval)。
- **P2-13 step 3** —— 已完成。`electron.vite.config.ts` 已使用 `inlineDynamicImports: false`，主进程入口与 AgentHost/能力模块分别输出 ESM chunks；`scripts/perf/check-main-chunks.mjs` 及 CI `perf-budget` job 负责守住该拓扑。后续重点是继续缩小入口同步依赖图，同时不回退启动行为。

---

<div align="center">

**A budget you don't measure is a budget you don't keep.** / **不度量的预算等于不存在的预算。**

</div>
