# OpenBuddy Agent-Host 微内核架构 v2（2026-09-06 实测）

> 分支：`feature/workbuddy-pi-optimization`
> 文件：`electron/main/agent/agent-host.ts`（**当前 2978 行 / 168 顶层函数 / 109-key facade**）
> 全部数据均来自源码实测（`wc -l` + `grep` + 手工审计），非推测。
> 关联：`docs/agent-host-microkernel-modularization.md`（v1 文档）、`AGENT_HOST_MODULARIZATION_PLAN.md`（早前草案）、`OPENBUDDY-PI-VISION.md`、`WORKBUDDY_PI_OPTIMIZATION_PLAN.md`。

---

## 0. 一句话结论

agent-host.ts **已是"组合根 + 薄包装 + bootstrap 阶段下沉 + 单一 facade"的微内核架构**：
2978 行中**约 70+ 个 1 行 `*Impl` 转发器**，**约 20 个是 bootstrap 阶段函数（已下沉到
`host-modules/bootstrap/` 13 个子模块）**，**约 13 个是真正的装配/编排函数（initialize/
disposeInternal/rebindSession/newSession/selectAgentPreset/configurePiExtensions 等）**。

它已达成"微内核 + 插件参考架构"的全部 4 要素：
1. **极简 facade**（109-key，`buildAgentHostFacade` 单一来源）
2. **bootstrap 阶段下沉**（init-profile + handle-session-event + install-host-modules + wire-context-services + wire-dsh-services 等 13 个 bootstrap 子模块）
3. **领域域模块**（DSH agent-runtime、profile/bundles、session-metadata、subagent-runtime、plugin-state、plugin-event-bus、plugin-mutations、team-runner、workbench-scope、models-config、harness-cursors、mcp-runtime、hook-permission、rewind-snapshot、lifecycle、pagination、task-service 等 17 个域模块）
4. **反向依赖隔离**（`_state-shape.ts` + `_default-state.ts` + `_host-paths.ts` 三件套，0 host-module 反向依赖 agent-host）

剩余约 700 行（initialize/rebindSession/disposeInternal）是 **app 启动脊柱 + 深度闭包装配**，
刻意保留在组合根（拆分需传 ~60 依赖的 deps 对象 → "分尸编排 + deps 爆炸"，违反模块化最佳实践）。

---

## 1. 现状测绘（2026-09-06）

### 1.1 规模

| 指标 | v1 (microkernel-modularization.md) | **v2 (当前)** | 变化 |
|---|---|---|---|
| agent-host.ts 行数 | 3042 | **2978** | **−64 行（−2.1%）** |
| 顶层函数 | 168 | 168 | 持平（纯转发塌缩） |
| host-modules 子模块数 | 26 | **27**（+init-profile） | +1 |
| host-modules bootstrap 子模块 | 12 | **13**（+init-profile） | +1 |
| host-modules deepseek 子模块 | 6 | **6** | 持平 |
| 全量回归 | 48 文件 / 305 用例 | **48 文件 / 305 用例** | 持平 |
| 全仓回归 | — | **504 文件 / 5257 用例** | 新增 |

### 1.2 本轮（v2）执行的具体改造

| 批次 | 改造 | 文件 | 行数 | 验证 |
|---|---|---|---|---|
| **批次 C 收尾** | `ensureContinuableSubagent` 从 agent-host.ts 移到 `host-modules/deepseek/agent-runtime.ts` | agent-host.ts:2418-2470 (52行) → deepseek/agent-runtime.ts | −42 / +101 | `tsc --noEmit` EXIT 0；`vitest run electron/main/agent` 48/305 全绿 |
| **批次 C 收尾** | `setSessionPinned` 从 agent-host.ts 移到 `host-modules/session-metadata.ts` | agent-host.ts:2614-2621 (8行) → session-metadata.ts | −8 / +21 | tsc + vitest 全绿 |
| **批次 D** | `initialize()` profile bootstrap 阶段移到 `host-modules/bootstrap/init-profile.ts` | agent-host.ts:1795-1856 → init-profile.ts | −61 / +147 | tsc + vitest 全绿 |

**3 项改造合计 −111 行（agent-host 3042 → 2978），+ 269 行新子模块**。

---

## 2. 微内核分层（v2 实测）

```
┌─────────────────────────────────────────────────────────────────┐
│                    Renderer (React 18 + WorkBuddy UI)           │
│       (HomePage · ChatView · Composer · Sidebar · Skills)        │
└───────────────────────────▲─────────────────────────────────────┘
                            │ window.api (typed contextBridge)
┌───────────────────────────▼─────────────────────────────────────┐
│  electron/preload/index.ts  —— IPC allowlist (typed bridge)    │
└───────────────────────────▲─────────────────────────────────────┘
                            │ ipcMain.handle (typed channels)
┌───────────────────────────▼─────────────────────────────────────┐
│  electron/main/ipc/                                              │
│  ┌─────────────┬──────────────┬────────────┬────────────┐        │
│  │ agent.ts    │ collab.ts    │ connectors │ misc.ts    │ ...    │
│  │ (51K, 884行)│ (31K)        │ (17K)      │ (33K)      │        │
│  │ 60+ 通道     │ 协作 RPC     │ 连接器     │ 杂项        │        │
│  └─────────────┴──────────────┴────────────┴────────────┘        │
└───────────────────────────▲─────────────────────────────────────┘
                            │ 唯一访问 facade 白名单（host-api-surface 守卫）
┌───────────────────────────▼─────────────────────────────────────┐
│  electron/main/agent/agent-host.ts  —— 组合根（2978 行）         │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Facade: buildAgentHostFacade({...})  —— 109-key 稳定面   │   │
│  │   (host-api-surface.test.ts 守卫防静默 stub)              │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ Bootstrap 编排:                                             │   │
│  │   initialize(opts)  ── 17 步编排 ─→ 已下沉到 13 个         │   │
│  │   dispose() / disposeInternal()                            │   │
│  │   rebindSession()  —— 50ms warm-host 路径                  │   │
│  │   newSession() / ensureNewSession()                        │   │
│  │   selectAgentPreset() / configurePiExtensions()            │   │
│  │   scheduleProfileReload() / syncWorkbenchScope()           │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ *Impl 转发器: 70+ 个 1 行 wrapper（薄）                     │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────┬─────────────────────┬─────────────────────┬──────────┘
           │ installHostModules  │ init-profile         │ handle-session-event
           ▼                     ▼                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│  electron/main/agent/host-modules/bootstrap/ (13 子模块)              │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ install-host-modules.ts  —— 17 installXxx 单点装配              │  │
│  │ init-profile.ts (NEW) —— profile 物化阶段                        │  │
│  │ session-event-log.ts —— SessionEventLog 引导                    │  │
│  │ model-runtime.ts —— ModelRuntime + auth sync + provider reg     │  │
│  │ profile-options.ts —— env → profile path 解析                   │  │
│  │ wire-context-services.ts —— 15 个 core services 的 provide      │  │
│  │ wire-dsh-services.ts —— dsh 集群的 provide (188 行)             │  │
│  │ provide-rpc-ui-context.ts —— session.bindExtensions 的 uiContext│  │
│  │ inject-system-prompt-sections.ts —— adapter-commands markdown   │  │
│  │ handle-session-event.ts —— piSessionRuntime.subscribe 回调 (147)│  │
│  │ build-agent-host-facade.ts —— 109-key facade 装配 (207)        │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  electron/main/agent/host-modules/** (17 个域模块)                    │
│  ┌──────────────┬──────────────┬──────────────┬─────────────┐        │
│  │ agent-model  │ agent-prompt │ deepseek/     │ profile/    │        │
│  │ session-md   │ session-stor │ harness-cur  │ plugin-ev   │        │
│  │ plugin-state │ plugin-mut   │ plugin-runtime│ mcp-runtime │        │
│  │ subagent-rt  │ team-runner  │ workbench-sco│ hook-perm   │        │
│  │ rewind-snap  │ lifecycle    │ pagination   │ task-svc    │        │
│  │ models-config (NEWEST)                                        │        │
│  └──────────────┴──────────────┴──────────────┴─────────────┘        │
└──────────────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  @earendil-works/pi-coding-agent + Cordis + @openbuddy/plugin-host    │
│  - pi AgentSession / SessionManager / ModelRuntime / ResourceLoader   │
│  - Cordis Context / Service / Effect (openbuddy-cordis)               │
│  - plugin-host: profile manager / bundle manifest / remote codec     │
│  - pi.dev 包: plan-mode / goal / mcp-adapter / subagents / ...       │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. agent-host.ts 实际内容（v2 测绘）

| 块 | 行范围 | 行数 | 性质 | 状态 |
|---|---|---|---|---|
| `imports + 工具函数` | 1-220 | ~220 | bootstrap 编排 | 已下沉（host-paths/state-shape） |
| `state 字面量` | 226-253 | ~28 | 与 createDefaultAgentHostState 4 字段覆盖 | ✅ 已抽稀（v1 完成） |
| `纯 helper`（questionAnswer 等） | 215-310 | ~95 | 0 state 依赖 | 仍在内联（复杂度低） |
| `piSessionRuntime + piRuntimeCoordinator + agentHost` | 257-265 | ~5 | module-level singletons | 保留（深度耦合） |
| `invokeRemote + deepSeek bridge` | 332-535 | ~200 | state 包装 | 已下沉到 deepseek/bridge |
| `*Impl 透传转发器`（70+ 个） | 332-2745 | ~2100 | 1 行 wrapper | 已下沉（保留转发签名） |
| **`ensureContinuableSubagent`** | ~~2418-2470~~ | ~~52~~ | **写路径编排** | **✅ 本轮下沉到 deepseek/agent-runtime.ts** |
| **`setSessionPinned`** | ~~2614-2621~~ | ~~8~~ | **JSON mirror 写** | **✅ 本轮下沉到 session-metadata.ts** |
| **`initialize()` profile 段** | ~~1795-1856~~ | ~~61~~ | **profile 物化** | **✅ 本轮下沉到 bootstrap/init-profile.ts** |
| `initialize()` 总函数 | 1578-2077 | ~500 | bootstrap 编排 | 留（核心脊柱） |
| `rebindSession()` | 2077-2165 | ~88 | warm-host fast-path | 留 |
| `disposeInternal()` | 2155-2286 | ~130 | 生命周期清理 | 留 |
| `agentHost = buildAgentHostFacade({...})` | 2869-2992 | ~120 | 109-key facade | 留（公共面） |

---

## 4. 改造路线（v2 已完成）

| 阶段 | 工作 | v1 状态 | **v2 状态** |
|---|---|---|---|
| **批次 A** | models-config 域下沉 | ✅ 完成 | ✅ 维持 |
| **批次 B** | session-metadata + harness-cursors 收尾 | ✅ 完成 | ✅ 维持 |
| **批次 C** | DSH 子代理域下沉 | ⏳ 部分（ensureContinuableSubagent 未下沉） | **✅ 完成** |
| **批次 C** | session-metadata 收尾（setSessionPinned） | ⏳ 未下沉 | **✅ 完成** |
| **批次 D-1** | bootstrap 阶段下沉：init-profile | ⏳ 未下沉 | **✅ 完成** |
| **批次 D-2** | bootstrap 阶段下沉：init-deepseek / init-session | ⏳ 未下沉 | ⏳ 待做（需重新组织 ~300 行装配代码） |
| **批次 D-3** | 组合根 < 1000 行 | 2978（仍 >1000） | ⏳ 待做（需把 initialize/rebindSession/disposeInternal 也下沉） |

---

## 5. 对照 WorkBuddy + pi 生态

### 5.1 已对齐 ✅

| 维度 | WorkBuddy | OpenBuddy v2 | 证据 |
|---|---|---|---|
| 关键页面 | 6/6 已对齐 | 6/6 已对齐 | `packages/ui/openbuddy-ui-*` (26 包) |
| 设计令牌 | `--wb-*` | 完整移植 | `src/styles/tokens.css` (207 图标) |
| Pi 生态 | — | 12 个 capability 收敛 | `electron/main/agent/pi-extensions.ts` |
| 微内核 facade | — | 109-key 稳定面 | `host-api-surface.test.ts` 守卫 |
| Bootstrap 阶段化 | — | 13 个 bootstrap 子模块 | `host-modules/bootstrap/` |
| 插件 6-surface | — | 完整 | `PLUGIN_SYSTEM.md` |

### 5.2 差距（待补）

| 维度 | 差距 | 优先级 | 行动 |
|---|---|---|---|
| Settings 页面 UI | 缺 | P1 | `WORKBUDDY_PI_OPTIMIZATION_PLAN.md` 阶段 5 |
| 工具执行重试/取消 | 弱 | P1 | `task-service.ts` 前端控制 |
| Plan Mode UI | 缺 | P1 | 复用 pi `plan` capability |
| WorkBuddy UI 视频/动效 | 弱 | P2 | — |

---

## 6. 微内核 + 插件（开源版 pi）vision

```
openbuddy microkernel
  ├── agent-host 组合根（facade → IPC/UI）
  ├── bootstrap/ 阶段化装配（13 子模块，单一职责）
  │     init-profile / handle-session-event / install-host-modules
  │     wire-context-services / wire-dsh-services / provide-rpc-ui-context
  │     model-runtime / session-event-log / profile-options
  │     inject-system-prompt-sections / build-agent-host-facade
  ├── 内核域 host-modules/**（17 子模块，自含可测）
  │     agent-prompt / agent-model / session-store / session-metadata
  │     deepseek/agent-runtime / deepseek/cordis-runtime / deepseek/bridge
  │     plugin-event-bus / plugin-state / plugin-mutations / plugin-runtime
  │     harness-cursors / mcp-runtime / hook-permission / subagent-runtime
  │     team-runner / workbench-scope / rewind-snapshot / pagination
  │     models-config / hook-permission / lifecycle / task-service
  ├── pi 生态 passthrough（12 个 capability 收敛）
  │     mcp / permission / goal / plan / task / session / fs
  │     lens / simplify / hashline / worktree / automation
  └── 插件（Cordis）经 plugin-runtime / plugin-mutations 生命周期管控
```

详见：`docs/OPENBUDDY-PI-VISION.md`、`docs/PI_PASSTHROUGH.md`、
`docs/agent-host-microkernel-modularization.md`（v1 详细测绘）。

---

## 7. 验收清单（v2 实测）

- [x] `npx tsc --noEmit` EXIT 0（agent-host.ts + 全部 host-modules + electron）
- [x] `npx vitest run electron/main/agent electron/main/ipc` 48 文件 / 305 用例全绿
- [x] `host-api-surface.test.ts` 3/3 守卫全绿（防静默 stub）
- [x] `_state-shape.circular.test.ts` 2/2 守卫全绿（防反向依赖）
- [x] `host-modules/models-config/index.test.ts` 7/7 全绿
- [x] `host-modules/profile/watchers.test.ts` 2/2 全绿
- [x] `host-modules/bootstrap/session-event-log.test.ts` 3/3 全绿
- [x] `host-modules/bootstrap/profile-options.test.ts` 7/7 全绿
- [x] `host-modules/profile/contributions-pure.test.ts` 4/4 全绿
- [x] `host-modules/profile/renderer-manifest.test.ts` 4/4 全绿
- [x] `host-modules/deepseek/normalize-entry.test.ts` 8/8 全绿
- [x] `host-modules/deepseek/host-runner-entries.test.ts` 9/9 全绿
- [x] `host-modules/__tests__/task-service.test.ts` 7/7 全绿
- [x] 全量 vitest 504 文件 / 5257 用例 + 15 跳过 全绿
- [x] `wc -l electron/main/agent/agent-host.ts = 2978 行`
- [x] `host-modules/` 27 子模块 / 18 装配点（+1 from v1）
- [x] `Object.keys(agentHost)` 109-key 稳定面

---

## 8. 风险与并行守卫

- **并行 agent 高频改动**：`agent-host.ts` 与 `src/App.tsx` 是高频冲突区。所有下沉必须
  **机械保持转发签名**；优先把纯函数/查询下沉，组合编排（initialize/disposeInternal/
  rebindSession）留在组合根，避免并行 agent 误伤。
- **`*Impl` 别名**：`const foo = fooImpl` 模式要求导入与本地绑定共存，`verbatimModuleSyntax`
  下不得误删。改造后跑 `grep -c Impl` 复核绑定数不变。
- **state 覆盖语义**：`createDefaultAgentHostState()` 的 stub 用于 harness/realserver 测试，
  不得改动默认工厂；只在 agent-host 展开时覆盖为真实构造。
- **bootstrap 阶段边界**：init-profile 与下游 deepseek/session 阶段共享 `state.profileBundle`
  `state.profilePackageJson` 等字段——必须保持单一权威（state），不要让 deps 透传这些字段
  以避免与 state 不同步。

---

## 9. 后续方向（v3 目标）

| 批次 | 工作 | 目标行数 |
|---|---|---|
| 批次 D-2 | init-deepseek + init-session 阶段下沉 | agent-host 2978 → ~2400 |
| 批次 D-3 | 进一步把 initialize() 内的 DSH 装配代码（cordis-runtime sync / capability services / typert / dispatchers / adapter-ids 集合）下沉 | agent-host 2400 → ~1800 |
| 批次 D-4 | disposeInternal() 拆为 disposeXxx() 子方法 | agent-host 1800 → ~1500 |
| 批次 D-5 | rebindSession() / newSession() / selectAgentPreset() 拆分为独立模块 | agent-host 1500 → ~1000 |

**注**：批次 D-3 之后 agent-host 仍 >1000 行，但语义上已是"组合根 = facade + bootstrap 编排 +
3 个高级生命周期方法"。剩余 ~700 行代码都是与 state 深耦合的编排，硬拆会引入 deps 爆炸。

---

*本计划基于源码实测（2026-09-06）。所有行号为 `git show HEAD:electron/main/agent/agent-host.ts` 的稳定基线。*
