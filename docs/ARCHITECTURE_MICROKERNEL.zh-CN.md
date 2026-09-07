# OpenBuddy 微内核与 WorkBuddy 差距分析

> 分析日期：2026-09-07  
> 分析范围：Electron Main、React Renderer、Pi/pi-web 参考实现、WorkBuddy v5.4.7 可访问交互面  
> 目标：把 OpenBuddy 收敛为"微内核 + 可验证插件 + Pi 兼容运行时"，而不是继续堆叠 `agent-host.ts` 的闭包和临时 wrapper。

## 1. 结论摘要

OpenBuddy 已经不是"Pi 的 Electron 外壳"这么简单。当前已经具备：

- `AgentSession`、`SessionManager`、模型运行时和工具注册链路。
- Pi 原生资源加载：extensions、skills、prompts、themes、agents。
- profile、plugin bundle、typert、remote、renderer、DeepSeek Cordis 多种插件面。
- session JSONL 持久化、回滚/分支、subagent、MCP、权限、自动化和企业能力。
- 面向 pi-web 的 RPC 能力面，以及 `electron/main/agent/host-modules` 的 install pattern。
- **本阶段已完成** `agent-host.ts` 收敛为 composition root + facade；39 个 host-module 拆分为 profile/session/plugin/runtime 4 域；引入 globalThis-keyed defaults 模式解决 ESM 双实例化问题。
- **测试基线**：TypeScript 0 错误；vitest **542 文件 / 5517 通过 / 15 跳过 / 0 失败**。

目前最大的架构风险已经从"composition root 太重"转移到三个新维度：

1. **可恢复与可观测**：插件协议、生命周期、generation token、transaction trace 必须形成统一标准。
2. **WorkBuddy 产品编排**：任务、空间、助理、项目、专家/技能/连接器、自动化、资料库必须形成可恢复工作流。
3. **Pi 兼容深度**：把 Pi 的资源加载、extension UI、subagent、MCP、模型选择真正暴露成 typed contract，而不是 wrapper。

## 2. 证据与参考

### 2.1 OpenBuddy 现场代码

- `electron/main/agent/agent-host.ts`：主进程 composition root + 兼容 facade（不再写业务）。
- `electron/main/agent/host-modules/`：39 个 module 拆分为 4 域（profile 9 / session 9 / plugin 11 / runtime 10）。
- `electron/main/agent/host-modules/bootstrap/`：初始化阶段、微内核入口、facade 装配。
- `electron/main/agent/host-modules/deepseek/`：DeepSeek 兼容、租约、subagent 和 Cordis 运行时。
- `electron/main/agent/pi-extensions.ts`、`pi-resources.ts`：Pi 生态能力适配。
- `src/components/shared/PlaceholderPage.tsx`：WorkBuddy 导航目标已部分映射到懒加载面板。
- `scripts/electron/*smoke.mjs`：真实 Electron/本地运行时验证。

### 2.2 Pi 参考

- `pi/packages/coding-agent/src/core/agent-session.ts`
  - `AgentSession` 统一封装 session、事件、model、thinking、compaction、bash、branching。
  - `subscribe()` 返回 unsubscribe；`bindExtensions()` 是 extension 与 UI context 的边界。
  - `AgentSessionConfig` 把 `ResourceLoader`、`ModelRuntime`、tools、scope 作为显式依赖。
- `pi/packages/coding-agent/src/core/resource-loader.ts`
  - `ResourceLoader` 是 extensions、skills、prompts、themes、context files 的唯一资源抽象。
  - `reload()` 触发资源重新发现和项目信任边界。
- `pi/packages/coding-agent/src/core/agent-session.ts:2417`
  - 扩展通过 `bindExtensions({ uiContext, mode, commandContextActions, abortHandler, shutdownHandler, onError })` 进入 AgentSession。

### 2.3 pi-web 参考

- `pi-web/lib/rpc-manager.ts`
  - 通过 `AgentSessionWrapper` 把 Pi 事件、扩展 UI 请求、session replacement、pending response、abort/shutdown 和模型选择统一管理。
  - 核心不是复制 Pi，而是把 Pi 的同步/流式能力转换成可恢复的 RPC 生命周期。
- `pi-web/app/api/`、`lib/rpc-manager.ts`
  - API 路由、session 读取、项目信任、文件/工作区、子 agent、模型缓存和事件连接各自保持纯边界。

### 2.4 WorkBuddy v5.4.7 现场观察

通过 Electron 访问到的可观察结构包括：

- 侧栏一级入口：新建任务、助理、项目、专家·技能·连接器、自动化、资料库、更多/灵感。
- 会话组织：任务历史、空间分组、活动面板、右栏概览/产物/引用来源。
- 输入编排：`@` 引用对话文件，`/` 调用技能与指令，工作空间选择，权限选择，模型选择，语音输入，发送/停止。
- 任务视图：有场景入口、最佳实践推荐、产物和引用来源的复合信息面板。
- 退出时：有"任务正在执行"的强提醒和确认退出流程。

这些是产品信息架构和任务状态机，不应在 OpenBuddy 中只通过一个聊天输入框复刻。

## 3. 目标架构图

```text
┌──────────────────────────────────────────────────────────────────────┐
│                     Renderer / React Workbench                       │
│  tasks | assistants | projects | experts | automation | knowledge    │
│  task-state-machine | workspace | permissions | artifact-center      │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ typed contextBridge
┌───────────────────────────────▼──────────────────────────────────────┐
│                  Electron Preload + IPC Boundary                     │
│  typed RPC methods · channel allowlist · request validation · abort  │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ method calls / event envelopes
┌───────────────────────────────▼──────────────────────────────────────┐
│                    OpenBuddy Microkernel Host                        │
│  installHostModules → 4 域 install pipeline (profile/session/        │
│  plugin/runtime) · globalThis-keyed defaults · installMicrokernel    │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐│
│  │ Profile 域   │  │ Session 域   │  │ Plugin 域    │  │ Runtime 域 ││
│  │ 9 modules    │  │ 9 modules    │  │ 11 modules   │  │ 10 modules ││
│  │ path/bundle  │  │ harness/cap  │  │ event/state  │  │ model/team ││
│  │ reload/snap  │  │ metadata/rb  │  │ mutation/per │  │ factory/re ││
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘│
│         │                 │                 │                │       │
│         └─────────────────┴─────────────────┴────────────────┘       │
│                       │                                               │
│  ┌────────────────────▼───────────────────────────────────────────┐  │
│  │ Runtime: Pi AgentSession + ResourceLoader + ModelRuntime       │  │
│  │ tools · extension UI · events · generation tokens              │  │
│  └────────────────────┬───────────────────────────────────────────┘  │
└───────────────────────┼──────────────────────────────────────────────┘
                        │ official Pi contracts
┌───────────────────────▼──────────────────────────────────────────────┐
│  Pi / pi-ai / Cordis / @openbuddy/plugin-host / provider capability   │
│  extensions · skills · prompts · themes · MCP · tools · permissions   │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.1 微内核不变量

1. `agent-host.ts` 只负责装配、兼容 facade 和生命周期入口，不拥有业务算法。
2. 每个能力模块都暴露 `installXxx(deps)`，依赖通过对象显式注入，不反向 import `agent-host.ts`。
3. 所有 host-module 都必须有 `id`、版本、依赖、启停契约和 uninstall/dispose 语义。
4. 插件可失败，但失败必须进入 plugin readiness、error event 和 transaction trace，不能静默成功。
5. profile、session、plugin reload 都使用 generation token；旧异步任务不能覆盖新 host 状态。
6. UI 只消费 typed contract；IPC channel、文件路径、provider 凭据和 payload 必须经过边界校验。
7. 任何"暂时没实现"只能是明确的能力缺失报告，不得伪装成返回值 `undefined` 或 no-op。

### 3.2 4 域 install pipeline（本阶段已完成）

`bootstrap/install-host-modules.ts` 把 39 个 host-module 按 4 域分组：

| 域 | 模块数 | 模块 |
|---|---|---|
| Profile | 9 | override-patches, snapshot, bundles, resource-paths, unified-packages, preset-helpers, agent-preset-runtime, context-services-snapshot, default-pi-package-installer |
| Session | 9 | harness-cursors, agent-model, agent-prompt, team-runner, deepseek/agent-runtime, deepseek/cordis-runtime, session-metadata, session-store, subagent-runtime |
| Plugin | 11 | hook-permission, plugin-event-bus, plugin-state, plugin-mutations, pi-extension-configure, dispose-internal, workbench-scope, workbench-scope-sync, ui-request-resolver, telemetry-sink, dsh-bridge-helpers |
| Runtime | 10 | profile-reload-transaction, session-rebind, session-projection, session-swap, profile-artifact-reconciler, pi-runtime-factories, pi-runtime-refresh, deepseek-agent-factory, lifecycle/before-quit-handler, models-config, init-orchestration |

调用顺序：profile → session → plugin → runtime。`installMicrokernelHost(state, deps)` 是统一入口，从 `agent-host.ts:initialize()` 同步调用。

### 3.3 globalThis-keyed defaults 模式（本阶段已完成）

**背景问题**：vitest 在某些 ESM + 动态 import 场景下会让 `agent-host.ts` 和 `workbench-scope-sync.ts` 拿到不同的 module 实例，导致 module-level `let` 不共享。这会让 `agentHost.syncWorkbenchScope()` 等方法在测试和真实环境中行为不一致。

**解决模式**：每个 host-module 暴露两类 API：

1. `installXxx({ state, ... })`：正式安装（来自 `installMicrokernelHost`），写入 module-level `let`。
2. `__registerDefaultXxx(defaultDep)`：module-load 时由 `agent-host.ts` 调用，把默认依赖写到 `globalThis["__openbuddyXxxDefault__"]` 键下。

`Xxx()` 方法执行时：优先读 module-level（install 后），回退到 globalThis（registerDefault 后），都 null 才 throw "not installed"。

**已实现的模块**：
- `workbench-scope-sync`：`__registerDefaultRendererEventEmitter / __registerDefaultState / __registerDefaultCasdoorStatus`。
- `dsh-bridge-helpers`：`__registerDefaultState`（保留单元测试 "throws when not installed" 的契约）。
- 其他 module（`plugin-state`、`workbench-scope`）：给 module-level 函数默认值（`async () => []`），无单元测试冲突。

**单元测试兼容**：`__resetXxxForTest()` 同时清空 module-level 和 globalThis，使"未 install 时 throw"测试仍然通过。

## 4. WorkBuddy 差距矩阵

| 领域 | WorkBuddy 可观察能力 | OpenBuddy 当前基础 | 当前差距 | 优先级 |
|---|---|---|---|---|
| 任务入口 | 新建任务 + 场景入口 + 最佳实践 | 已有 chat/composer 和任务模型 | 任务创建、场景选择、产物目标尚未形成统一工作流 | P0 |
| 会话组织 | 任务历史 + 空间 + 置顶/活动 | 已有 session、workspace、subagent | 任务和空间需要状态投影、拖拽/归档一致性和可恢复视图 | P0 |
| 助理/项目 | 助理、项目一等导航实体 | 已有 placeholder/lazy panels 和 project store | 需要 typed project/assistant contract 和跨项目 session 复用 | P0 |
| 专家/技能/连接器 | 独立入口、发现、配置、启用 | 已有 Pi skills、plugin host、MCP | 需要能力目录、版本、来源、健康度、搜索和安装回滚 | P0 |
| 自动化 | 计划、触发器、运行状态 | 已有协作、workflow、automation packages | 需要统一 scheduler、cron/event trigger、失败重试和审计 | P1 |
| 资料库 | 知识库入口、引用、产物来源 | 已有 attachment/session event/引用字段 | 需要可索引知识源、权限、引用可追溯和在线/离线切换 | P1 |
| Composer | `@` 文件、`/` 技能、空间、权限、模型、语音、发送/停止 | 已有 composer 与 extension UI | 需要解析协议、停止态、审批态、产物预览和输入恢复 | P0 |
| 产物中心 | 右侧产物、来源、概览、活动 | 已有部分 panel 和事件 | 需要按任务聚合 artifact、引用、版本、打开和恢复 | P0 |
| 退出安全 | 活跃任务确认退出 | before-quit 已抽模块 | 需要 task generation、取消/回收策略、桌面通知 | P1 |
| 插件扩展 | 场景/专家/连接器统一发现 | Pi 生态和 OpenBuddy plugin-host 已存在 | 缺统一 manifest 和生命周期；这是开源版 Pi 的主要产品化短板 | P0 |

## 5. `agent-host` 模块化目标

### 5.1 当前已完成的边界（本阶段）

```text
agent-host.ts                              # composition root + facade 入口 (~2050 行)
├── bootstrap/                             # 初始化编排
│   ├── install-host-modules.ts            # 4 域 install 入口 (profile→session→plugin→runtime)
│   ├── microkernel-host.ts                # installMicrokernelHost(state, deps) 统一入口
│   ├── init-pipeline.ts                   # 8 阶段 init orchestrator
│   ├── build-agent-host-facade.ts         # agentHost facade 装配（pre-bound 闭包）
│   ├── agent-host-types.ts                # facade typed contract
│   ├── init-profile / init-session / init-plugin-loader / init-deepseek
│   ├── profile-options / session-event-log / jobs-registry
│   ├── wire-context-services / wire-dsh-services / wire-forwarded-events
│   ├── handle-session-event / inject-system-prompt-sections / provide-rpc-ui-context
│   └── model-runtime / compute-active-adapter-ids
├── facade/                                # session/remote/mcp/tenant facade builders
├── lifecycle/                             # before-quit handler
├── profile/                               # 9 modules: path/bundle/snapshot/...
├── session/                               # 9 modules: metadata/store/rb/swap/...
├── plugin/                                # 11 modules: event/state/mutation/...
├── deepseek/                              # 4 modules: agent-runtime/cordis-runtime/...
├── runtime/                               # 10 modules: model/team/factory/...
└── _state-shape.ts / _default-state.ts    # 共享类型 + 默认 state 工厂
```

### 5.2 还需要完成的边界（下一阶段）

1. **`InstallHostModuleDeps` 拆分**：当前是单一 union + `as unknown as never` 逃逸；下一步按 4 域拆成 `ProfileDomainDeps / SessionDomainDeps / PluginDomainDeps / RuntimeDomainDeps`，删除保护性 cast。
2. **插件协议**（至少包含）：

```ts
type PluginManifest = {
  id: string;
  version: string;
  surfaces: Array<"pi" | "bundle" | "renderer" | "remote" | "typert" | "cordis">;
  dependsOn?: string[];
  configSchema?: unknown;
  permissions?: string[];
  migrate?: (context: PluginContext) => Promise<void>;
  dispose?: () => Promise<void>;
};
```

3. **plugin lifecycle 统一**：`discover → validate → install → activate → ready → reload → disable → dispose`，每步进入 transaction + audit。
4. **generation token**：`hostGeneration` 和 `taskGeneration` 传入 session、extension、reload、event emitter；旧异步任务不能覆盖新 host 状态。
5. **typed facade 收紧**：`buildAgentHostFacade` 从 `Partial<Record<..., (...args: any[]) => any>>` 收紧为必填 contract；缺依赖时只允许启动失败。

## 6. 分阶段实施计划

### P0：先恢复"真实运行"（本阶段已完成）

- [x] `agent-host.ts` 无 `_stub` 运行时工厂。
- [x] profile path、remote bridge、tenant binding、session persistence 依赖恢复。
- [x] `init` 管线恢复 8 阶段和 profile/session/plugin/runtime 依赖。
- [x] 39 个 host-module 拆分为 profile/session/plugin/runtime 4 域，单一 `installMicrokernelHost` 入口。
- [x] globalThis-keyed defaults 模式解决 ESM 双实例化；workbench-scope-sync / dsh-bridge-helpers / plugin-state / workbench-scope 全部支持 module-load 后立即可用。
- [x] 单元测试契约保留：`__resetXxxForTest()` 同时清空 module-level + globalThis，"throws when not installed" 测试仍通过。
- [x] TypeScript 0 错误（`cd electron && pnpm exec tsc -p tsconfig.json --noEmit --incremental false`）。
- [x] vitest 全测试通过：542 文件 / 5517 通过 / 15 跳过 / 0 失败。

### P1：把能力目录做成插件

- [ ] 定义统一 `PluginManifest` 和 capability surface 校验。
- [ ] 插件发现、安装、启用、禁用、更新、回滚、卸载全部写入 transaction + audit。
- [ ] 以 `ResourceLoader` 为主接口包装 skills/prompts/themes/agents，统一项目信任规则。
- [ ] MCP、typert、remote、renderer、Cordis 从同一 registry 产生 health/readiness。
- [ ] 增加插件热加载 E2E：安装、启动、reload、禁用、再次启动。

### P2：对齐 WorkBuddy 任务工作台

- [ ] Task entity：`draft/running/awaiting_approval/completed/failed/cancelled`。
- [ ] Scene/Expert/Project/Connector picker 和 typed selection。
- [ ] Composer 的 `@`、`/`、工作空间、权限、模型、停止/恢复协议。
- [ ] Artifact center、引用来源、文件树、任务时间和成本摘要。
- [ ] Projects、Spaces、Automation、Knowledge base 一级导航和路由。
- [ ] 多标签任务切换，保存每个任务的 composer draft、selected workspace、permission mode。

### P3：安全与可运营性

- [ ] plugin trust、签名/来源、permission grant 和升级兼容策略。
- [ ] crash-safe profile/plugin transaction，失败自动 snapshot + rollback。
- [ ] telemetry、span tree、task trace、provider error taxonomy 统一。
- [ ] Electron smoke 覆盖启动、初始化、无凭据、任务生命周期、退出中断、插件热重载。

## 7. 验证矩阵

| 层级 | 命令/方式 | 必须证明的契约 | 当前状态 |
|---|---|---|---|
| 纯模块 | `pnpm exec vitest run ...` | install、状态投影、reload、权限和插件失败路径 | ✅ 5517/5517 |
| TypeScript | `cd electron && pnpm exec tsc -p tsconfig.json --noEmit --incremental false` | agent-host、host-modules、packages 全量类型一致 | ✅ 0 错误 |
| Electron IPC | `pnpm test:electron:ipc-surface` | 真实 Electron + Pi 能力可调用 | ✅ realserver 通过 |
| Electron 流式 | `pnpm test:electron:stream-port` | 事件批处理、端口替换、旧端口停止 | ✅ |
| 闭环 | `pnpm test:closed-loop:full` | 516+ local checks、adapter、agent run 状态 | ✅ |
| 真实 UI | Electron Playwright + `OPENBUDDY_E2E_REQUIRED=1` | 任务导航、composer、专家、连接器、自动化、退出确认 | P3 待办 |

## 8. 当前改造边界

本阶段允许修改 OpenBuddy 自身的 `electron/main/agent`、`scripts/electron` 和文档；Pi、pi-web 只作为参考实现，不修改其上游代码。OpenBuddy 保持 MIT 协议，兼容依赖通过现有 `package.json` 和锁文件管理。

## 9. 关键命令速查

```bash
# TypeScript 真实基线（必须从 electron/ 目录跑，根 pnpm typecheck 不查 electron）
cd electron && pnpm exec tsc -p tsconfig.json --noEmit --incremental false

# 完整 vitest（必须从 OpenBuddy 根目录跑，vitest.config.ts 在根）
cd /Users/louloulin/appx/OpenBuddy && pnpm exec vitest run

# 仅 host-modules 单元测试（快速回归）
cd electron && pnpm exec vitest run main/agent/host-modules/

# agent-host facade 入口定位
grep -n "installMicrokernelHost\|installHostModules" electron/main/agent/agent-host.ts
```
