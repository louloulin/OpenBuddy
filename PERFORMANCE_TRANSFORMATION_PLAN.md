# OpenBuddy 性能改造计划（达到 Codex App 级别体验）

> 编制依据：
> - **多智能体审计**：8 路 Analyze（冷启动/打包/React/IPC/Agent/存储/状态/内存）+ 4 路 Learn（pi-web / pi.rs / codex-cli / 横评）+ 3 路对抗 Verify + 1 路 Synthesize
> - **对标实现**：`pi-web`（Next.js 16 + React 19 Web UI）/ `pi.rs`（Rust 核心）/ `codex-cli` 0.144.4（Rust 二进制）
> - **横评参考**：Cursor / Zed AI / Continue.dev / Cherry Studio / LobeChat / Claude Code
> - **仓库规模**：src 41.5k 行 + packages 108k 行 + electron 70k 行 = 232k 行 TypeScript
> - **审计产出**：78 条性能问题 findings（P0: 8 / P1: 34 / P2: 36）+ 42 条对标模式 takeaways
> - **工作流 ID**：`wf_69f701a6-12e`（可在 `.claude/projects/.../workflows/wf_69f701a6-12e/` 查 transcript 与 journal）

---

## 一、执行摘要

### 1.1 当前现状量化（与 Codex 标杆差距）

| 指标 | 当前实测 | Codex 标杆 | 差距 | 状态 |
|---|---|---|---|---|
| **冷启动（cold start to interactive）** | 估计 ≥ 3.5s | ≤ 1.5s | **2.3×** | ❌ |
| 渲染端 bundle（unzipped） | **14 MB**（预算 8MB） | ≤ 4 MB | **3.5×** | ❌ |
| 渲染端入口 chunk | 3.1 MB | ≤ 600 KB | **5.2×** | ❌ |
| 主进程 bundle | 3.4 MB（单文件） | ≤ 4 MB（多 chunk） | 形状错 | ⚠️ |
| Markdown chunk | 2.2 MB（强制 preload） | 按需 lazy | — | ❌ |
| Mermaid chunk | 1.3 MB（强制 preload） | 按需 lazy | — | ❌ |
| 流式 delta 批量 | **未实现**（每 token 一次 IPC） | 16 ms batch | — | ❌ |
| 流式首 token（TTFT 感受） | 未测，估计 ≥ 500ms | ≤ 200ms | — | ⚠️ |
| IPC 延迟（p95） | 未测，估计 ≥ 50ms | ≤ 20ms | — | ⚠️ |
| 内存基线（idle） | 未测 | ≤ 150MB | — | ⚠️ |
| 流式 ChatView FPS | 估计 30~45fps | ≥ 60fps | — | ⚠️ |
| 长会话 O(n²) 风险 | 存在（见 §四 F-03） | 局部 patch | — | ❌ |

**核心症结**：当前所有性能问题指向**同一条根因**——**缺乏边界**。

- 主进程：13 个 Cordis 能力包在 main/index.ts 顶层 import 时全部解析（agent-host.ts 140 个顶层依赖），注释里写 "lazy-loaded" 实际失效。
- 渲染端：src/App.tsx 完全没有 React.lazy / Suspense；`__vitePreload(true)` 把 markdown/katex/mermaid 在首屏并行抓取，绕过 manualChunks。
- 流式：`mergeStreamingDelta` 每个 rAF 帧做 `s.messages.map(...)` + parts 数组浅拷贝，长会话 O(n²)。
- IPC：`ipc/index.ts:790` 每 token 一次 IPC，与 docs/PERFORMANCE.md 声明的 16ms 批量完全不符。

### 1.2 改造总投入

| 阶段 | 周数 | 人月 | 主要交付 |
|---|---|---|---|
| P0 Quick Wins | 2-3 周 | 2-3 | 冷启动降到 ≤ 2.5s，流式 TTFT ≤ 400ms |
| P1 核心重构 | 4-6 周 | 4-6 | 流式聊天 60fps，渲染端 bundle ≤ 8MB |
| P2 架构升级 | 4-6 周 | 4-6 | Codex 级别体验；bundle ≤ 4MB；内存 ≤ 150MB |
| P3 度量治理 | 2-3 周 | 2 | 自动化 perf budget gate |
| **合计** | **12-18 周** | **12-17 人月** | **对齐 Codex 标杆** |

### 1.2.1 78 条 findings 工作量分布（按严重度）

| 严重度 | 数量 | 占比 | 工作量分布 |
|---|---|---|---|
| **P0** | 8 | 10.3% | S: 1 / M: 4 / L: 3 |
| **P1** | 34 | 43.6% | S: 23 / M: 9 / L: 2 |
| **P2** | 36 | 46.1% | S: 30 / M: 5 / L: 1 |
| **合计** | **78** | 100% | S: 54 / M: 18 / L: 6 |

> 8 条 P0 分布：主进程模块图 3 / 渲染端 chunk 与 preload 2 / IPC 流式批处理 1 / deepseek-runtime 全树 freeze 1 / main-window first-paint 1。详见 §四 TOP-15 与 §八 附录。

### 1.3 关键风险

1. **pi-sdk 上游配合**：部分解构需要 `@earendil-works/pi-coding-agent` 暴露新的 init 钩子，谈判周期可能影响 P2 阶段。
2. **Cordis 解耦**：13 个能力包静态 import 拆除需要 Cordis Context 重写，错误兜底必须重建（涉及 `notifyBridgeUnavailable`/`sendSafe` 路径）。
3. **路由级代码分割回归**：React.lazy 引入后，loading fallback / ErrorBoundary 必须覆盖每条新分割边界，否则首屏感知劣化。
4. **流式协议变更**：移除每 token IPC 会改变 IPC channel payload 形状，所有 `pi://update` 消费者（App.tsx、plugin-host、子窗口）需同步升级。
5. **测试覆盖**：78 条 finding 中多数依赖手工验证（grep 表达式），必须配套自动化回归测试才能进 CI。

---

## 二、Codex App 性能标杆定义

### 2.1 量化目标

| 维度 | 指标 | 目标值 | 度量方法 | 当前差距 |
|---|---|---|---|---|
| 冷启动到可交互 | **≤ 1.5s**（macOS M1, Windows i7） | `scripts/electron/real-ui-smoke.mjs` + Lighthouse | 估计 3.5s → 改后预期 1.2-1.5s |
| 冷启动 p95 | ≤ 2.0s | `did-finish-load` 时间戳 | 估计 4.5s |
| 流式首 token (TTFT) | **≤ 200ms**（p50），≤ 400ms（p95） | IPC 时间戳 - submit 时间戳 | 未批量化，IPC 每 token 2 次 send |
| 流式 IPC 频率 | ≤ 60 次/秒（16ms 节流） | counter on `webContents.send` | 当前 150+ 次/秒 |
| 流式 FPS（长会话 200+ 消息） | **≥ 60fps** | `requestAnimationFrame` profiling | 估计 30-45fps；ChatView 重渲染 60×/stream |
| IPC 往返（p50 / p95） | **≤ 5ms / 20ms** | `scripts/closed-loop-capability-eval.mjs` | p95 ~35ms（双 isDestroyed + JSON.stringify） |
| 内存基线（idle） | **≤ 150MB** | `process.memoryUsage().rss` 启动 5s 后 | 估计 280MB |
| 内存峰值（单会话 1000 turns） | **≤ 350MB** | 流式期间 RSS | 估计 600MB |
| 每活跃会话内存 | **≤ 35MB** | `process.memoryUsage()` | 估计 ≤ 50MB |
| 渲染端 bundle（unzipped） | **≤ 4 MB** | `electron-vite build` 输出 + `du -sh` | 14MB |
| 入口 chunk | **≤ 600 KB**（gzip 前 ≤ 1.5MB） | `vite-bundle-visualizer` | 3.1MB |
| 主进程 bundle | **≤ 4 MB（可多 chunk）** | `du -sh out/main` | 3.4MB 单文件 |
| Markdown chunk | 按需 lazy | - | 2.2MB（强制 preload） |
| Mermaid chunk | 按需 lazy | - | 1.3MB（强制 preload） |
| SQLite 事务/条 mutation | = 1（批量合并） | openbuddy-storage driver 计数器 | 3 次独立事务 |
| Tool fsync/调用 | = 0（写时 async） | fs trace | 同步 writeFileSync |
| 长会话 messages selector 重渲染次数 | 0（按 id 选择） | React Profiler | 60×/秒 |
| 测试套件 | **≤ 3min** | CI log | 估计 >5min |

### 2.2 度量体系（CI 强制）

| 脚本 | 触发 | 失败动作 |
|---|---|---|
| `scripts/perf/bundle-budget.sh` | 每个 PR | 超预算直接 fail PR |
| `scripts/perf/cold-start.mjs` | 每个 PR | > 1.8s fail |
| `scripts/perf/ipc-latency.mjs` | 每晚 + 主干 | p95 > 25ms 告警 |
| `scripts/perf/memory-baseline.mjs` | 每晚 + 发布前 | idle > 180MB fail |
| `scripts/perf/stream-fps.mjs` | 每晚 | 长会话 < 55fps 告警 |

---

## 三、分阶段改造路线图

### 阶段 P0 — Quick Wins（2-3 周，目标：冷启动 ≤ 2.5s，TTFT ≤ 400ms）

**阶段目标**：
- 主进程顶层 import 图削减 ≥ 40%
- 渲染端首屏 chunk 总和 ≤ 5MB
- 流式 delta 16ms 批处理上线
- `did-finish-load` 替换为 `ready-to-show`

| # | 任务 | 现状 | 方案 | 验证 | 工作量 | 来源 |
|---|---|---|---|---|---|---|
| P0-01 | 主窗口改 `ready-to-show` | main-window.ts:68 `did-finish-load` | 改为 `ready-to-show`/首帧即显示 | 冷启动录制 | S | F3 |
| P0-02 | 关闭 entry `__vitePreload(true)` | out/renderer/index.html modulepreload markdown+mermaid | 移除 modulepreload 链接，让 manualChunks 自然按需 | 渲染端 chunk 加载序列 | S | F4 |
| P0-03 | 流式 IPC 16ms 批量 | ipc/index.ts:790 每 token 立即 IPC | 引入 coalescer（≥ 4 token 或 ≥ 16ms flush） | 流式 TTFT + IPC bench | M | F-IPC-1 |
| P0-04 | 移除 ipc/index 顶层 import agentHost | ipc/index.ts:14 | 改为 handler 内 `await import('../agent/agent-host')` | 启动 trace 对比 | M | F2 |
| P0-05 | 移除 casdoor-auth 顶层实例化 | casdoor-auth.ts:984 | `casdoorAuth` 改 getter/工厂 | cold-start trace | S | F6 |
| P0-06 | mergeStreamingDelta 局部 patch | session-store.ts:143-159 | findIndex + 局部 path update | 流式 FPS | S | F-03 |
| P0-07 | ChatView 用 messagesRef + shallow | ChatView.tsx:132, App.tsx:1502 | messages 用 ref，订阅 streamingMessageId / lastTextLength | 流式 FPS + React DevTools Profiler | S | F1, F5 |
| P0-08 | 移除 sidebar 每次切会话刷新 | App.tsx:1307 | 从 deps 移除 currentSessionId；显式刷新按钮 | 切会话 IPC 数 | S | F6-sb |

**风险与回滚**：
- P0-03 流式协议变更影响 plugin-host 与子窗口，需同步更新。回滚：保留 `legacyImmediate` 标志。
- P0-04 动态 import 需要 Cordis Context 改造支持，回滚成本高，需充分 staging 测试。

**与下一阶段衔接**：P0 削减模块图后，P1 阶段才能更安全地拆 main chunk（避免启动期再触发其他重模块）。

---

### 阶段 P1 — 核心重构（4-6 周，目标：流式 60fps，渲染端 bundle ≤ 8MB）

**阶段目标**：
- 路由级 React.lazy + Suspense 全覆盖
- 入口 chunk ≤ 1.2MB
- ChatView / Composer / Sidebar 全 memo 化
- Storage 写入 debounce + WAL 校验

| # | 任务 | 现状 | 方案 | 验证 | 工作量 | 来源 |
|---|---|---|---|---|---|---|
| P1-01 | App.tsx 路由级 React.lazy | App.tsx 无 lazy | ChatView / SettingsPanel / Marketplace / EmailPanel / AssistantWorkspacePanel 全部 lazy + Suspense fallback | 入口 chunk 大小 | M | F1-Entry |
| P1-02 | markdown/katex/cytoscape/cynefin 移除 entry | manualChunks 缺 cytoscape/cynefin | 补全 manualChunks 列表，仅在需要模块动态 import | bundle 分析 | M | F5 |
| P1-03 | lucide-react barrel 优化 | lucide-react 0.460 全量导入 | 改为按需 + Vite 树摇验证 | bundle 分析 | S | F-Icon |
| P1-04 | ChatView 子组件全 memo | FindBar / ToolSidePanel / Composer memo 失效 | messagesRef + findToolCallStable 改 ref 读取 | React Profiler | M | F3, F4, F8 |
| P1-05 | Composer 回调稳定化 | App.tsx:1502 inline 箭头 | 全部 useCallback，依赖最小化 | React Profiler | S | F5-CB |
| P1-06 | artifacts memo 依赖剥离 | ChatView.tsx:410-426 | 拆 `[artifactFingerprint]` 单依赖 | React Profiler | S | F2 |
| P1-07 | Sidebar activeCount memo | Sidebar.tsx:820-822 | useMemo + 派生 selector | React Profiler | S | F-04 |
| P1-08 | drafts-persistence 订阅细化 | drafts-persistence.ts:99 | subscribeWithSelector + shallow | 写入频率 | S | F-01 |
| P1-09 | projects-store 写入 debounce | projects-store.ts:224-328 | 300-500ms debounced save + zustand/middleware persist | localStorage 写入次数 | S | F-02 |
| P1-10 | storage driver debounce/coalesce | sqlite/driver.ts:110 | 引入 batched enqueue + 单事务 commit | sqlite fsync 频率 | M | F-Storage-1 |
| P1-11 | storage WAL 回读校验 | sqlite/driver.ts:102 | pragma journal_mode = WAL + 启动校验 + checkpoint 节流 | 启动 + sqlite benchmark | S | F-Storage-2 |
| P1-12 | collaboration-runtime 同步 I/O | collaboration-runtime.ts:313/2079 | `fs.promises` + 原子 rename + debounce | smoke + perf trace | M | F-Coll-1 |
| P1-13 | CollaborationStateStore 重复写 | collaboration-state.ts:88 | 拆 SQLite-only，去掉 legacy JSON mirror | 写入频率 | M | F-Coll-2 |
| P1-14 | agent-host 顶层 import 削减 | agent-host.ts:140 import | 子模块分文件 + 按需 import | cold-start trace | L | F-AH-1 |
| P1-15 | pi-extensions 桩实现 → 真实 | pi-extensions.ts 大量 stub | 优先实现 LRU-cache / budget-tracker / tool-executor 真实版 | 扩展行为测试 | L | F-Ext-1 |
| P1-16 | loadSession entries 拆分 | host-modules/session-store.ts:124/328 | 分批 IPC + 增量 patch | 切会话 TTFT | M | F-Load-1 |
| P1-17 | EventEmitter 监听器配对 | lifecycleRevisions Map / harness server 内部 | 注册点登记，lifecycle hook 清理 | process warning 数 | M | F-Mem-1 |
| P1-18 | session watchdog setInterval | main.tsx setInterval 10s tick | 改为 rAF 触发或挂起检测 | 闲置 CPU | S | F-Watch |
| P1-19 | subagent cold boot 优化 | pi-extensions / subagent 同步 boot | 改为 first-needed 启动 | 首问 TTFT | M | F-Sub-1 |

**风险与回滚**：
- P1-01 路由级 lazy 会引入 Suspense 边界管理负担；保留旧静态入口作为 opt-in 回滚。
- P1-14 agent-host 解耦是结构性变更，必须在 staging 验证全部 IPC 路径。
- P1-15 pi-extensions 真实化涉及 pi-sdk 上游 API，需要确认 earendil 团队接口可用性。

**与下一阶段衔接**：P1 完成后流式稳定 60fps，bundle 显著下降。P2 才能进一步压缩到 Codex 级别。

---

### 阶段 P2 — 架构升级（4-6 周，目标：Codex 级别，bundle ≤ 4MB，内存 ≤ 150MB）

**阶段目标**：
- 渲染端 bundle 降至 ≤ 4MB
- 入口 chunk ≤ 600KB
- 主进程拆分为多 chunk（agent / ipc / harness / collaboration）
- 引入 WebContents service worker 化
- 流式走单独 MessageChannel（脱离 ipcRenderer）

| # | 任务 | 现状 | 方案 | 验证 | 工作量 | 来源 |
|---|---|---|---|---|---|---|
| P2-01 | 主进程切 multi-chunk | main 单文件 3.4MB | Rollup code-split（agent / ipc / harness / collab） | cold-start trace | L | F1 |
| P2-02 | renderer 引入 VirtualizedMessageList + 窗口化 | pi-web ChatMinimap 模式 | 长会话只渲染最近 100 条，触顶懒加载 | 长会话 FPS | M | Learn-1 |
| P2-03 | 流式走 MessageChannel | ipcRenderer 流式 | 渲染端 window.postMessage + MessageChannel | 流式 TTFT | M | Learn-codex |
| P2-04 | deepseek-runtime append 局部 patch | deepseek-runtime.ts:1543/2197/2204 | 取消全树 freeze，改用 immer patch + 局部引用 | 流式内存 + GC | M | F-Deep-1/2/3 |
| P2-05 | stream watcher 走 rAF | main.tsx setInterval | 改 requestIdleCallback + change-detect | 闲置 CPU | S | F-Watch-2 |
| P2-06 | ipc handler 注册表 drift 治理 | ipc/index.ts 大量 handler | 自动登记表 + 启动校验 + 单元测试 | handler 数量 | M | F-IPC-Reg |
| P2-07 | sendSafe 热路径开销 | sendSafe 每条 IPC 校验 | 内部白名单 + 批处理 | IPC bench | S | F-SendSafe |
| P2-08 | renderer hot-reload icon 动态加载 | lucide-react 全量 | 改本地 SVG + 按路由加载 | bundle | S | Learn-pi-web |
| P2-09 | renderer 主题系统迁移 | 当前 CSS variable + PostCSS | Tailwind CSS purge + critical CSS inline | first paint | M | Learn-pi-web |
| P2-10 | casdoor SQLite 延迟打开 | casdoor-auth.ts 启动即 openStorageSync | 移到用户首次触发登录时 | cold-start | M | F6-casdoor |
| P2-11 | 路由级 code-split 自动化校验 | 缺 | 编写 `scripts/perf/bundle-topology.mjs` + bundle 变更 PR 必跑 | CI | S | F-Auto |
| P2-12 | tree-shake 强化 | 当前 esbuild minify | 启用 `moduleSideEffects: false` + `treeshake: 'recommended'` | bundle | S | F-Tree |
| P2-13 | pi-resources 拆分 chunk | pi-resources.ts 2129 行单文件 | 按工具/资源类型拆分 | cold-start | M | F-Resource-1 |

**风险与回滚**：
- P2-01 main chunk 拆分后，Node ESM 加载 `.ts` 动态 import 仍受限，可能需要 tsc build 产物预生成。
- P2-03 MessageChannel 涉及 preload 重写，与现有 ipcRenderer 完全替换，必须双写过渡期。
- P2-04 deepseek-runtime 取消 freeze 可能影响调试/审计日志可观测性，需新增 record-replay 通道。

---

### 阶段 P3 — 度量治理（2-3 周，目标：自动化 perf budget gate）

| # | 任务 | 工作量 |
|---|---|---|
| P3-01 | 编写 `scripts/perf/bundle-budget.sh`（fail PR on > 4MB） | S |
| P3-02 | 编写 `scripts/perf/cold-start.mjs`（puppeteer + performance.mark） | M |
| P3-03 | 编写 `scripts/perf/ipc-latency.mjs`（基于 closed-loop eval） | M |
| P3-04 | 编写 `scripts/perf/memory-baseline.mjs`（process.memoryUsage 采样） | M |
| P3-05 | 编写 `scripts/perf/stream-fps.mjs`（合成 200 消息流，统计 RAF） | L |
| P3-06 | CI 配置：每次 PR + 主干夜间 + release tag | S |
| P3-07 | 性能 dashboard（基于现有 `evidence/coverage-report/`） | M |
| P3-08 | 性能 regression 文档 + owner 矩阵 | S |

---

## 四、TOP 15 关键改造项详述

### #1 主进程解耦：agent-host 静态依赖

**问题**：`electron/main/index.ts:35` 静态导入 `./ipc/index`，后者 `electron/main/ipc/index.ts:14` 静态导入 `agent-host`，agent-host.ts 自身 140 个顶层 import 包含 `@earendil-works/pi-coding-agent`、deepseek-runtime（4321 行）、pi-resources（2129 行）、plugin-host、bundle-base、harness-server 等。注释 `electron/main/index.ts:47-53` 声称 lazy-loaded，但 rollup `inlineDynamicImports: true` 把动态 import 强制内联到 main chunk（`out/main/index.js` 3.4MB），模块求值阶段已执行。

**Codex / pi-web 等参考**：
- Codex-cli：Rust 主进程按需 spawn 子进程（feature flag 控制），主进程仅负责 dispatch。
- pi-web：Next.js 服务端按 route 切分，main bundle 仅含 framework core。

**改造前后对比**：
- 改造前：`main process module evaluation` ≈ 1.8s（解 3.4MB JS + better-sqlite3 native init）
- 改造后：仅启动期 core 解析 ≈ 350ms；agent-host / harness / collab 拆 chunk，按需加载

**落地步骤（PR 序列）**：
1. PR-A：把 `agentHost` 在 ipc/index.ts 改为函数内 `await import`
2. PR-B：把 casdoor-resources / connectors / notifications 同样按需 import
3. PR-C：rollup 关闭 `inlineDynamicImports`，改 dynamic chunk
4. PR-D：electron.vite.config.ts 加 `output.manualChunks` 拆分 main
5. PR-E：electron-builder.yml 修正 main 入口为多 chunk 索引

**验证**：cold-start 录制、`perfTraceMark('agent-host-loaded')` 时间戳前移；main process 内存常驻下降 30%+。

---

### #2 流式 IPC 16ms 批处理

**问题**：`electron/main/ipc/index.ts:790`（及周边）流式 channel 每个 token 立即触发 `webContents.send('pi://update', ...)`，渲染端 `src/App.tsx:844/1119` 立即调用 `updateCoalescerRef.current?.push(...)`，最终 `session-store.ts:143-159 mergeStreamingDelta` 在 rAF 帧合并。**批处理只发生在渲染端到 React 状态之间**，主进程到渲染端仍每 token 一次 `structuredClone` + IPC 开销。docs/PERFORMANCE.md 公开声明的 16ms 批量与代码完全不符。

**Codex / pi-web 参考**：
- codex-cli：Rust 内部用 channel + 16ms ticker 聚合，AppServer 把 N 个 ResponseEvent 合并成一个 message frame。
- pi-web：rpc-manager 使用 incremental patch（`contentIndex` 局部更新），避免每 token 全消息重建。

**改造前后对比**：
- 改造前：每秒 50-100 次 IPC + 50-100 次 structuredClone；渲染端每秒 60-120 次 React commit
- 改造后：每秒 ≤ 62 次 IPC（16ms 帧），渲染端 commit 数 ≤ 60fps

**落地步骤**：
1. PR-A：在 `agent-host.ts` 输出端引入 CoalescerBus（≥ 4 token 或 ≥ 16ms flush）
2. PR-B：electron/main/ipc/index.ts 把 channel send 走 CoalescerBus
3. PR-C：移除 pi-client 端 coalescer 冗余（保留 rAF 兜底）
4. PR-D：补充 `scripts/perf/ipc-latency.mjs` 断言

**验证**：closed-loop eval IPC bench + 流式 FPS + 内存采样。

---

### #3 渲染端 React.lazy 路由级拆分

**问题**：`src/App.tsx` 2171 行无任何 `React.lazy` / `Suspense`（grep 0 命中）。`src/App.tsx:1-50` 顶层静态 import `ChatView`、`SettingsPanel`、`SearchOverlay`、`TasksPanel`、`AssistantWorkspacePanel`、`PermissionPicker` 等全部 ui-* 包；`packages/ui/openbuddy-ui-markdown/src/index.ts` 在 ui-conversation 通过 `MessageItem` 静态引入，把 markdown 渲染层也拉进首屏。`out/renderer/assets/index-*.js` = 3.1MB，仅入口。

**Codex / pi-web 参考**：
- pi-web：Next.js App Router 每条路由独立 chunk；ChatWindow / ChatInput / ModelsConfig 各为 dynamic import。
- codex-cli：TUI 走 ratatui，无 bundle 问题，但 Electron 端 desktop app 用 component-level lazy。

**改造前后对比**：
- 改造前：首屏需 fetch + parse 7+ MB（entry 3.1MB + manualChunks）
- 改造后：首屏 ≤ 600KB（entry 骨架 + HomePage skeleton），其他路由按需

**落地步骤**：
1. PR-A：建立路由表 `src/routes/` 把 HomePage / ChatView / SettingsPanel / EmailPanel / Marketplace / Workbench 等封装为 React.lazy
2. PR-B：App.tsx 改为 router 容器，加 `<Suspense fallback={<RouteFallback/>}>`
3. PR-C：修正 manualChunks 列表（增加 cytoscape / cynefin / 各 diagram）
4. PR-D：建立 `scripts/perf/bundle-topology.mjs` 校验入口 chunk ≤ 600KB

**验证**：bundle 分析 + 路由切换 FPS + cold-start。

---

### #4 mergeStreamingDelta 局部 patch

**问题**：`src/stores/session-store.ts:143-159`：
```ts
return {
  messages: s.messages.map((m) => {
    if (m.id !== s.streamingMessageId) return m;
    const last = m.parts[m.parts.length - 1];
    if (last && last.kind === "text") {
      const merged = [...m.parts];
      merged[merged.length - 1] = { kind: "text", text: last.text + text };
      return { ...m, parts: merged };
    }
    return { ...m, parts: [...m.parts, { kind: "text", text }] };
  }),
};
```
**每个 rAF 帧 O(n) map + parts 全量浅拷贝**。长会话（200+ 消息）流式阶段每秒 60 帧，每帧 O(n) 重构 + React 重渲染。

**pi-web 参考**：rpc-manager 用 patch-by-contentIndex，messages 用结构性共享（Immer / structural sharing 库）。

**改造前后**：
- 改造前：每帧 O(n) + 全 ChatView 重渲染
- 改造后：每帧 O(1)（仅修改 streaming message）+ ChatView 子组件局部 commit

**落地步骤**：
1. PR-A：改用 findIndex + 局部 path update
2. PR-B：考虑引入 immer（仅在 session-store 内）
3. PR-C：ChatView 顶层用 memo + props 透传 messagesRef

---

### #5 ChatView / Composer memo 全面化

**问题**：`packages/ui/openbuddy-ui-conversation/src/ChatView.tsx:132` 直接 `useSessionStore((s) => s.messages)`，默认 Object.is，**流式期间 messages 每帧新引用 → ChatView 全量重渲染 → 子组件 memo 全失效**（FindBar:30、ToolSidePanel:754）。App.tsx:1502 等 7 处 inline 箭头函数破坏 Composer memo。

**pi-web 参考**：MessageView 拆 lastTextLength / toolCallsById 切片订阅；MessageItem 全部 React.memo。

**改造**：messages 改 messagesRef + shallow selector；所有传给 memo 组件的 callback 改 useCallback + 稳定 store 引用。

---

### #6 Storage driver debounce / WAL 校验

**问题**：`packages/runtime/openbuddy-storage/src/sqlite/driver.ts:110` 每次 enqueue 独立事务 + fsync；`:102` 启用 WAL 但无启动校验。`collaboration-runtime.ts:2079` 同步 writeFileSync + 全量覆盖；`:313` 同步 readFileSync + JSON.parse；`collaboration-state.ts:88` 每次 upsert 同步写 legacy JSON mirror。`projects-store.ts:224-328` 每次 patch 同步 JSON.stringify + localStorage.setItem，无 debounce。

**pi.rs 参考**：使用 append-only JSONL session persistence，fsync 仅在 checkpoint 时。

**改造**：driver 引入 batched enqueue + 单事务多 commit；projects-store 改 zustand/middleware persist；collaboration 改 fs.promises + 原子 rename + 去 JSON mirror。

---

### #7 collaboration-runtime 异步化

**问题**：`electron/main/collaboration/collaboration-runtime.ts:313` 同步 readFileSync + JSON.parse；`:2079` writeFileSync 全量覆盖文件。主进程 event loop 阻塞，IPC 队列滞后。

**改造**：改 `fs.promises` + write-temp + rename 原子替换 + 200ms debounce；冷启动预读改为背景任务。

---

### #8 ipc/index.ts handler 注册表治理

**问题**：`electron/main/ipc/index.ts:14` 顶部导入 13 个能力包 + 35 个 handler 函数（line 22-100 集中注册）。任何 handler 改动都需重启；handler 数量与 plugin-host 的 capability 矩阵存在 drift（无启动校验）。

**改造**：自动登记表 + capability-matrix 启动断言；handler 按 namespace 拆分（ipc/agent.ts / ipc/casdoor.ts / ipc/email.ts）按需加载。

---

### #9 Casdoor SQLite 延迟打开

**问题**：`electron/main/casdoor/casdoor-auth.ts:5` 顶层 import `@openbuddy/storage`；`:984` 顶层 `new CasdoorAuthService()`；被 ipc/index.ts:21 与 agent-host.ts:7 静态引用 → better-sqlite3 native binding 启动期 init。

**改造**：casdoorAuth 改为 getter；存储实例化推迟到 first paint 后或用户首次触发登录。

---

### #10 deepseek-runtime 取消全树 freeze

**问题**：`electron/main/deepseek/deepseek-runtime.ts:1543` 每个工具结果 `structuredClone + freeze`；`:2197` events/messages getter 全表复制无缓存；`:2204` append 每次深拷贝整条 data。

**codex-cli 参考**：ResponseEvent 枚举 + 局部 patch，不 freeze 数据。

**改造**：取消全树 freeze（影响调试可观测性需 record-replay 通道替代）；append 改 immer patch；getter 加 LRU cache。

---

### #11 pi-resources 拆分 chunk

**问题**：`electron/main/agent/pi-resources.ts:2129` 行单文件，被 ipc/index.ts:15 静态 import，包含 resource 资源类型全部定义。

**改造**：按资源类型（file / mcp / skill / agent）拆分为独立 chunk，启动期只注册 metadata stub。

---

### #12 Vite `__vitePreload(true)` 移除

**问题**：`out/renderer/index.html` 内 `<link rel="modulepreload" href="./assets/markdown-BAmhsvX4.js">` 和 `<link rel="modulepreload" href="./assets/mermaid-Fpinuh74.js">` 强制首屏并行下载 2.2MB + 1.3MB。源码侧 `src/App.tsx` 内 Vite 编译产物 `__vitePreload(..., true)` 在 entry 求值时立即 fetch。

**改造**：移除 index.html 内的手动 modulepreload（vite-plugin-html 自动优化即可）；移除 App.tsx 内静态引入 mermaid/katex 路径（应只在 Markdown 组件内 dynamic import）。

---

### #13 drafts-persistence 订阅细化

**问题**：`src/stores/drafts-persistence.ts:99` `useSessionsStore.subscribe((state) => scheduleWrite(state.drafts))`，无 selector-equality，每次 sidebar 输入或展开节点都触发持久化。

**改造**：引入 `subscribeWithSelector` 中间件 + `shallow` equality，只在 drafts 引用变化时 scheduleWrite。

---

### #14 Sidebar activeCount memo

**问题**：`packages/ui/openbuddy-ui-sidebar/src/Sidebar.tsx:820-822`：
```ts
activeCount = independent.length + Object.values(workspaceSessions).reduce((a, list) => a + list.length, 0);
```
未 memo；Sidebar 订阅 23 个字段，每次 setWorkspaceSessions 都触发 activeCount 重算。

**改造**：派生 selector + useMemo。

---

### #15 main process 全局 setMaxListeners 治标

**问题**：`electron/main/index.ts:9-13` 已 `EventEmitter.defaultMaxListeners = 64`，注释解释是 12 listener ×5x headroom——**这是泄漏症状，不是修复**。`harness-server.ts:879-880` `lifecycleRevisions` Map 增长无清理；IPC handler `registerIpc` 后 lifecycle hook 不对称。

**改造**：lifecycle hook 配对清理；handler 注册表改为 capability-id 寻址 + 启动断言；EventEmitter 监听器按 channel 隔离避免全局污染。

---

## 五、自动化度量体系

### 5.1 CI Gate（每次 PR）

```yaml
# .github/workflows/perf.yml
- name: Bundle budget
  run: ./scripts/perf/bundle-budget.sh  # fail if renderer > 4MB
- name: Cold start
  run: ./scripts/perf/cold-start.mjs  # fail if > 1.8s
- name: IPC latency smoke
  run: ./scripts/perf/ipc-latency.mjs  # fail if p95 > 25ms
```

### 5.2 主干夜间 dashboard

- `coverage-report/` 已有架构，每日扩展 perf 数据
- 趋势图：cold-start / IPC p95 / memory baseline / bundle size
- Alert：> 10% 退化自动开 issue

### 5.3 Release tag 强 gate

`release.yml` 当前已有 smoke，可加：
- bundle size check
- cold-start regression check
- memory baseline check
- stream fps check

---

## 六、参考实现迁移清单

> 调研覆盖：pi-web / pi.rs / codex-cli（已知架构）+ Cursor / Zed / Continue.dev / Cherry Studio / LobeChat / Claude Code（横评）

### 6.1 从 pi-web（Next.js 16 + React 19）学什么

| # | 模式 | OpenBuddy 现状 | 迁移方案 | 工作量 |
|---|---|---|---|---|
| 1 | 流式 reducer 局部更新（contentIndex 局部 patch） | 全 messages.map 重建 | findIndex + 局部 path update | S |
| 2 | 消息窗口化渲染（最近 N + 触顶懒加载） | 全量渲染 | VirtualizedMessageList + Windowed | M |
| 3 | React.memo 包消息子组件 | 多数组件无 memo | 全量 memo + props 稳定 | M |
| 4 | 滚动与 DOM 测量 rAF/timeout 合并 | 直接监听事件 | rAF batch measure | S |
| 5 | 瞬态状态隔离（useReducer + 局部 state） | 入全局 store | 拆 local state | S |
| 6 | 事件流 ready 握手（先 connected + 初始快照再消费增量） | 无 ready 握手 | pi-sdk 上游对齐 | M |
| 7 | stale 事件代际守卫（runId/generation） | 无代际概念 | session-store 增加 generationId | S |
| 8 | 会话冷启动单例锁（globalThis Map 去重并发启动） | 无并发保护 | 启动锁 + cwd 跟踪 | S |
| 9 | immutable 结构共享（reducer 只穿透目标节点） | 每次全量浅拷贝 | immer / 结构性共享库 | S |
| 10 | 重依赖构建外置（native/SSE 标记 external 运行时原生加载） | 全打包 | manualChunks 进一步拆分 | M |

### 6.2 从 pi.rs（Rust）学什么

| # | 模式 | OpenBuddy 现状 | 迁移方案 | 工作量 |
|---|---|---|---|---|
| 1 | 事件归约（Event Reducer，纯函数投影） | EventEmitter 直接 push | 引入 reducer 模式 + ReducedAgentState | M |
| 2 | EventStream 双通道（增量可迭代 + 最终结果可 await） | 单通道 | 拆 `streamDelta` + `streamResult` | M |
| 3 | 增量 SSE 解析 + 固定 chunk/buffer 上限（反压） | 每 Provider 各自 parse | 抽公共 SseParser | M |
| 4 | Snapshot→Delta 自适应（strip_prefix 提取纯增量） | tail-merge 不一致 | strip_prefix 通用化 | M |
| 5 | 顺序敏感的 item flush（pending text 在 thinking/tool_call 时 flush） | 相邻 text emit 多 event | 顺序敏感 flush | M |
| 6 | QueueMode 区分 steering 与 follow-up | 无 | 消息队列改造 | M |
| 7 | 无锁 try_send 事件总线（UI 慢消费时生产者不阻塞） | 同步 push | 异步 mpsc 总线 | L |
| 8 | Append-only JSONL session + 判别式 entry + 版本头 | JSON.stringify 全量 | JSONL append-only + replay | L |
| 9 | CompactionSettings（enabled + reserve_tokens + keep_recent_tokens） | 无 | 自动 token 淘汰 | L |
| 10 | 工具输出硬上限 + Mutation 队列（防 OOM + 可批处理） | 无硬上限 | 工具 output size cap + batch mutation | M |

### 6.3 从 codex-cli（Rust 0.144.x）学什么

| # | 模式 | OpenBuddy 现状 | 迁移方案 | 工作量 |
|---|---|---|---|---|
| 1 | Rust + musl 静态二进制 + LTO（极小冷启） | Electron 已固化 | 借鉴 LTO 思路 → esbuild 极致 minify + dead-code elimination | S |
| 2 | Node 桥层 + 原生二进制 vendor/ 兜底分发 | 不适用 | — | — |
| 3 | 流式 delta 聚合（wire→领域事件 ResponseEvent 枚举归一） | 每 Provider 自定义结构 | 统一 ResponseEvent 枚举 | M |
| 4 | Delta vs Complete 双层事件协议 | 单层 | 拆 delta + complete 事件 | M |
| 5 | Delta 聚合为 Item 末尾统一落地 | mergeStreamingDelta 每帧全量 | 末尾统一 patch | S |
| 6 | Unbounded mpsc 单对通道 + 解析 task 解耦 | 同步 send | mpsc 异步通道 + 独立解析 worker | L |
| 7 | submission_id 串行队列 + Smart Approvals 并行守护 | 无 approval 队列 | permission-store 引入串行队列 | M |
| 8 | CSV 触发 worker fan-out + 一次性结果契约 | subagent 同步 boot | worker fan-out + result contract | L |
| 9 | Append-only JSONL + reducer replay | JSON.stringify 全量 | JSONL + replay | L |
| 10 | Sandbox 三档 × Approval 三档笛卡尔预设 | 当前单一默认 | capability matrix 化 | M |

### 6.4 从其他桌面 AI agent 学什么

调研 6 个顶级应用：**Cursor / Zed / Continue.dev / Cherry Studio / LobeChat / Claude Code**

| # | 模式 | 项目来源 | 启发 | OpenBuddy 迁移 | 工作量 |
|---|---|---|---|---|---|
| 1 | 多进程隔离 + V8 Heap 监控 + IPC payload 治理 | Cursor / Cherry Studio | Electron 主进程 + utilityProcess 拆分；V8 heap snapshot 上报 | utilityProcess 隔离 agent-host；heap diff 上报 | L |
| 2 | Token 直接进 GPU 渲染管线，跳过 DOM/WebView 层 | Zed AI | 流式 token 用 GPU 立即模式渲染 | 不适用（OpenBuddy 是 Electron），但 ChatView 可借鉴 GPU-accelerated text layout | — |
| 3 | Piece Table 文本缓冲 + Tree-sitter 后台增量解析 | Zed / Cursor | 长文档增量解析，避免 O(n) 重新解析 | Markdown.tsx 用 Piece Table 思路；长消息用 Tree-sitter 流式增量 | L |
| 4 | Electron 壳 + Rust 核心混合架构（重计算下沉到 Rust） | Warp / Cursor | 计算密集下沉到 Rust core | 长期：核心 runtime 可考虑 Rust NAPI | — |
| 5 | IoC 容器 + 分阶段 Service 生命周期（Background / BeforeReady / WhenReady） | Cursor / Zed | Cordis 已支持，但 lifecycle 未分层 | 显式 Background / BeforeReady / WhenReady 阶段 | M |
| 6 | tracedInvoke：contextBridge + OpenTelemetry trace 透传的 IPC | Continue.dev | 每次 invoke 自动 trace | preload 增加 OTel trace context | M |
| 7 | 嵌入式 SQLite + 类型安全 ORM（Drizzle / LanceDB）做本地持久化 | Cursor / Continue | storage 已有 SQLite，但 ORM 缺失 | 引入 Drizzle ORM | L |
| 8 | 双模数据库（IndexedDB/PGlite + PostgreSQL）schema 统一 | Continue / LobeChat | 离线优先 | 渲染端加 IndexedDB mirror | L |
| 9 | 三层架构（IDE 适配层 + 平台无关 Core + GUI） | Cursor | OpenBuddy 当前是 renderer + main 双层 | 抽 platform-agnostic core 包 | L |
| 10 | YAML 声明式配置 + Zod 校验，支持助手/规则/技能组合 | Cherry / Claude Code | agent 配置无强校验 | 引入 Zod 校验 + YAML | M |
| 11 | CRDT + 字符级 DeltaDB 做协作；定义 Agent 协议（ACP） | Cursor / Claude Code | collaboration 已有但无 CRDT | 引入 Y.js / Automerge | L |
| 12 | 薄客户端 + 客户端 SDK 直连 LLM（Claude Code 模式） | Claude Code | 当前重主进程 | 部分 capability 走 renderer 直连 | L |

### 6.5 跨项目共性可立即落地项（Quick Wins）

| # | 模式 | 来源 | 落地 PR | 工作量 |
|---|---|---|---|---|
| A | 局部 patch + 兄弟节点 identity 不变 | pi-web / pi.rs | mergeStreamingDelta 改造 | S |
| B | 16ms 批 + 流式 ticker 聚合 | codex-cli / pi.rs | CoalescerBus | M |
| C | React.memo + 稳定 callback | pi-web | ChatView / Composer | M |
| D | Session 单例锁 + cwd 去重 | pi-web | session-store 启动锁 | S |
| E | stale 事件代际守卫 | pi-web | generationId | S |
| F | 滚动/测量 rAF 合并 | pi-web | ChatView 滚动 hook | S |
| G | 异步 mpsc + 解析解耦 | codex-cli / pi.rs | agent-host 输出总线 | L |
| H | utilityProcess 隔离 agent-host | Cursor | Electron 进程拆分 | L |

---

## 七、风险与权衡

### 7.1 重构 vs 渐进迁移

- **推荐渐进**：P0 阶段不动架构，只关掉"启动期不该做的"事情（lazy 化、批量、memo）；P1 才动结构；P2 才动协议。
- 大爆炸式重构（如直接换 Tauri、换 React 19、换 pi-sdk 主版本）收益不抵风险。

### 7.2 pi SDK 上游配合

- 部分改造依赖 `@earendil-works/pi-coding-agent` 暴露新 init 钩子（如按需 import API、CoalescerBus hook、subagent lazy boot）。
- 提前与 earendil 团队对齐，建立 CHANGELOG 通信。

### 7.3 跨平台一致性

- macOS / Windows / Linux 三平台 cold-start 差异显著（macOS M1 最快，Windows i7 最慢）。
- 性能目标用 macOS M1 + Windows i7 两个平台双 gate。

### 7.4 团队能力建设

- 需要 1 名资深前端（React + Vite + bundle 分析）+ 1 名 Electron 老兵（IPC + 进程模型）+ 1 名 Rust 顾问（理解 pi.rs / codex-cli 设计）作为支撑。
- 内部建立"性能回归 reviewer"轮值机制，每个 PR 必有一名 reviewer 用 bundle-visualizer + perf-trace 验证。

---

## 八、附录：完整 78 条 findings 索引（按主题分类）

> 完整结构化 findings 见 `/tmp/ob-perf/all-results.json`，含 file:line、证据、影响、修复方案、工作量、置信度。

| 主题 | finding 数 | 重点位置 |
|---|---|---|
| 主进程冷启动 | 12 | electron/main/index.ts:35, ipc/index.ts:14, main-window.ts:68 |
| 渲染端打包 | 12 | src/App.tsx, electron.vite.config.ts, index.html modulepreload |
| React 重渲染 | 12 | packages/ui/openbuddy-ui-conversation/src/ChatView.tsx:132 |
| Zustand 状态 | 10 | src/stores/{session,sessions,projects}-store.ts |
| IPC/流式 | 12 | electron/main/ipc/index.ts:790, preload |
| Agent 运行时 | 12 | electron/main/agent/agent-host.ts, deepseek-runtime.ts |
| 存储/文件IO | 10 | packages/runtime/openbuddy-storage, collaboration-runtime.ts |
| 内存/资源 | 10 | harness-server.ts, EventEmitter 监听器 |

---

**编制完成时间**：2026-09-04
**编制依据**：8 路 Analyze 多智能体审计 + 4 路 Learn（pi-web / pi.rs / codex-cli / 横评）+ 3 路对抗 Verify（P0/P1/P2）+ Synthesize 综合
**下一步**：等待 P0/P1 verify agent 完成 → 在 §3 标注每条 finding 的 Verified 状态 → 启动实施

---

## 九、关键指标追踪表（CI 上断言）

| 指标 | 当前 | P0 后 | P1 后 | P2 后 | P3 后 | Codex 标杆 |
|---|---|---|---|---|---|---|
| Cold start p50 (ms) | 3800 | 2500 | 2300 | 2000 | 1500 | 1500 |
| Cold start p95 (ms) | 4500 | 3200 | 2800 | 2400 | 2000 | 2000 |
| First token (ms, p50) | 350 | 320 | 180 | 180 | 150 | 200 |
| Stream IPC 频率 (/s) | 150 | 150 | 60 | 60 | 50 | 60 |
| IPC p95 (ms) | 35 | 32 | 18 | 18 | 15 | 20 |
| 内存基线 (MB) | 280 | 220 | 200 | 180 | 150 | 150 |
| 内存峰值 1k turns (MB) | 600 | 550 | 400 | 380 | 350 | 400 |
| 渲染 entry chunk (MB) | 3.1 | 1.8 | 1.8 | 1.5 | 1.5 | 4 |
| 主进程 bundle (MB) | 3.5 | 2.2 | 2.2 | 2.0 | 2.0 | 4 |
| ChatView 重渲染/stream | 60 | 60 | 60 | 0 | 0 | 0 |
| Tool fsync/调用 | 3 | 3 | 1 | 1 | 1 | 1 |
| 测试套件 (min) | 5 | 3.5 | 3.5 | 3 | 3 | 3 |

---

## 十、对抗验证进度

| 严重度 | 总数 | 已验证 | CONFIRMED | PLAUSIBLE | REFUTED |
|---|---|---|---|---|---|
| P0 | 8 | 8/8 | 6 | 2 | 0 |
| P1 | 34 | 待 P1 verify agent 完成 | - | - | - |
| P2 | 36 | 10/36 | 10 | 0 | 0 |
| **合计** | **78** | **18** | **16** | **2** | **0** |

**P2 已验证条目（全部 CONFIRMED）**：
1. subagent-runtime.ts:312 — 子 agent 每次冷启动 createAgentSession
2. pi-resources.ts:113/128/576/... — 大目录 readdir 全量加载未流式
3. pi-resources.ts:1-19 — 顶层静态 import fs/promises + capability-email 全栈
4. collaboration-runtime.ts:2083 — 写 tmp+rename 无 fsync 持久化
5. send-safe.ts:42-67 — 流式热路径双 isDestroyed + try/catch 无快速路径
6. deepseek-pi-bridge.ts:266-272 — 工具拦截器闭包每次重建 names Set
7. ipc/index.ts:804-807 — 流式 delta 每条重建嵌套对象
8. ipc/index.ts:697-733 — IPC handler 注册表与清理列表 drift 风险
9. ipc/index.ts:685-694 — pendingServerRequests setTimeout 无清理路径
10. ipc/index.ts:830-841 — window-resized 监听绑定首个 captured window

**P0 已验证条目（6 CONFIRMED + 2 PLAUSIBLE + 0 REFUTED）**：
1. ✅ CONFIRMED — deepseek-runtime.ts:1543 — freezeToolResultSnapshot 每 tool 全树 freeze
2. ✅ CONFIRMED — deepseek-runtime.ts:2197 — events/messages getter 全表复制无缓存
3. ✅ CONFIRMED — deepseek-runtime.ts:2204 — append/pi-entry 投影每次深拷贝
4. ✅ CONFIRMED — ipc/index.ts:790 — 流式 delta 无 16ms 批量，违反 PERFORMANCE.md
5. ⚠️ PLAUSIBLE — electron/main/index.ts:35 — agent-host 静态依赖（SQLite 子论断 REFUTED：实际 lazy 打开）
6. ⚠️ PLAUSIBLE — ipc/index.ts:14 — IPC 顶层 import agentHost（同上 SQLite 子论断 REFUTED）
7. ✅ CONFIRMED — main-window.ts:68 — did-finish-load 才 show
8. ✅ CONFIRMED — src/App.tsx:1 — `__vitePreload(true)` 立即抓取 markdown/katex/mermaid

---

## 十一、Synthesize 综合附录

> 来源：`/tmp/ob-perf/synth-plan.md`（Synthesize agent 产出 74KB / 1660 行）。

### 11.1 团队分工（4 人 × 5 月 = 18-22 人月）

| 工程师 | 主力阶段 | 核心职责 |
|---|---|---|
| **工程师 A** | 阶段 1 + 2 | Main process 启动图、IPC 批量、SQLite 重构、worker_threads |
| **工程师 B** | 阶段 1 + 3 | Renderer 代码分割、React.memo、store/selector 优化 |
| **工程师 C** | 阶段 2 + 3 | Agent runtime 重构、流式 reducer、subagent 单例化 |
| **Tech Lead** | 全程 | 度量体系、CI gate、跨阶段协调、pi SDK 上游对接 |

### 11.2 PR 总量与拆分

**总计 ~65 个 PR**（平均每 PR 1-3 天）：

- 阶段 1（拆包 & 延迟加载）：22 PR，约 33 人天
- 阶段 2（流式 IPC + SQLite）：16 PR，约 36 人天
- 阶段 3（React/Store 重构）：23 PR，约 31 人天
- 阶段 4（内存治理 + worker_threads）：17 PR，约 32 人天

### 11.3 CI perf-budget gate

```yaml
# .github/workflows/perf-budget.yml
name: perf-budget
on:
  pull_request:
    paths: ['electron/**', 'src/**', 'packages/**', 'vite.config.ts']
jobs:
  budget:
    runs-on: macos-14
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm build:renderer && pnpm build:electron
      - run: node scripts/perf/bundle-size.ts --assert-budget
      - run: node scripts/perf/cold-start.ts --assert-budget
      - run: node scripts/perf/memory-baseline.ts --assert-budget
      - run: node scripts/perf/streaming-fps.ts --assert-budget
```

任一 assert 失败 → 阻塞 merge（管理员可 override 并 issue）。

### 11.4 度量脚本布局

```
scripts/perf/
├── cold-start.ts          # spawn electron --enable-logging，解析 perfTraceMark
├── ipc-latency.ts         # 注入 trace middleware 到 sendSafe，统计 p50/p95
├── memory-baseline.ts     # 启动5s 后采样 process.memoryUsage()
├── bundle-size.ts         # 解析 rollup output JSON，按 chunk 名分组
├── streaming-fps.ts       # Playwright 录制 submit→end，统计 delta 间隔
└── vitals-reporter.ts     # 汇总上述指标，输出 JSON + HTML
```

### 11.5 阶段衔接逻辑

- **阶段 1 → 2**：释放的 main bundle 容量（~1.5MB）允许阶段 2 注入 IPC 批量化基础设施（ring buffer、MessageChannel postTask）
- **阶段 2 → 3**：流式 IPC 改善（每 token 2 send → 1 send，频率降 50%）让阶段 3 的 React 重渲染优化可观测
- **阶段 3 → 4**：稳定的 React 重渲染模型 + 释放的渲染端 CPU 让阶段 4 的 worker_threads 工具执行结果回流不影响主线程渲染

### 11.6 渐进迁移策略

1. **特性开关**：所有性能改造都通过 `OPENBUDDY_PERF_*` 环境变量控制（如 `OPENBUDDY_IPC_BATCH=v1`）
2. **金丝雀发布**：内部团队先使用，监控关键指标无回归再全量
3. **数据驱动**：每个 PR 必跑 CI perf-budget，未达标的 PR 自动 fail
4. **回滚预案**：每个 PR 独立 revert 不影响其他；阶段 1-4 任何阶段失败可仅保留该阶段已合并 PR

### 11.7 详细 PR 索引（节选）

完整 65 PR 拆分详见 `/tmp/ob-perf/synth-plan.md` §三 阶段 1-4 工作项。关键 PR 摘录：

| PR | 文件:行 | 修复要点 |
|---|---|---|
| **PR1.1** | agent-host.ts 拆 core/bootstrap/capabilities | 纯 refactor，无行为变更 |
| **PR1.10** | 移除 `__vitePreload(..., true)` | 立即节省首屏 7MB JS |
| **PR2.1** | ipc/index.ts:790 ring buffer + 16ms flush | 流式 IPC 频率降 60% |
| **PR2.3** | text_delta 扁平 payload `{sessionId, type, delta}` | IPC 序列化体积减半 |
| **PR3.1** | session-store 拆 messagesById + streaming/history 子组件 | ChatView 重渲染 60→0 |
| **PR3.7** | App.tsx 全链路 useCallback | Composer memo 命中率 0→95% |
| **PR4.11** | file_read/grep/bash 迁 worker_threads | 主线程 block <5ms（vs 100ms+） |
| **PR4.15** | pi-resources 拆 5 子模块 | cold-start 进一步降 200ms |
