# Architecture

[English](ARCHITECTURE.md) · **简体中文**

### 鸟瞰

```
┌──────────────────────────────────────────────────────────────┐
│  React 渲染端 (src/, packages/ui/*)                          │
│    Vite + React 18 + Zustand stores                          │
│    基底: --wb-* tokens, 207 图标, 品牌原子                   │
└──────────────────────┬───────────────────────────────────────┘
                       │  window.api(类型化 contextBridge)
┌──────────────────────┴───────────────────────────────────────┐
│  Electron Main + preload bridge                              │
│    ipc.ts                ← 白名单 IPC 处理器                 │
│    agent-host.ts         ← Pi AgentSession 生命周期           │
│    pi-event-bridge.ts    ← 具备清理意识的 pi://* 事件          │
│    pi-resources.ts       ← 本地持久化(Cordis fs)              │
│    capability-*.ts       ← Cordis 能力服务                    │
└──────────────────────┬───────────────────────────────────────┘
                       │  类型化 Pi 会话事件
┌──────────────────────┴───────────────────────────────────────┐
│  Pi AgentSession + Cordis 能力服务                            │
│    providers, tools, permissions, plans, tasks, persistence  │
└──────────────────────────────────────────────────────────────┘
```

### 第 1 层 — React 渲染端

**位置:** `src/` 与 `packages/ui/openbuddy-ui-*`

**职责:**

- 渲染 WorkBuddy 风格 UI(Topbar、Sidebar、HomePage、ChatView、Composer……)
- 通过 [Zustand](https://github.com/pmndrs/zustand) store 维护 UI 状态(`src/stores/`)
- 在 `src/lib/electron-api.ts` 提供类型化 bridge 包装,把 `window.api.invoke(...)` 隐藏在强类型函数之后
- 订阅主进程的 `pi://*` 流式事件

**约束:**

- **无 Node 集成** — `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`(见 `electron/main/window.ts`)
- **无 Provider SDK** — 所有 Provider 调用走主进程的 Pi 运行时
- **不能直接访问文件系统** — 必须调 IPC 处理器(如 `shellfs:read-text`)
- **无 CSS-in-JS** — 用 `src/styles/tokens.css` 中的 `--wb-*` 设计 tokens

### 第 2 层 — Electron Main + Preload

**位置:** `electron/main/`、`electron/preload/`

**职责:**

- 持有 `BrowserWindow` 生命周期(`window.ts`)
- 托管 Cordis 上下文,加载能力服务(`capability-*.ts`)
- 跑 Pi `AgentSession`(`agent-host.ts`),把流式事件转发给渲染端(`pi-event-bridge.ts`)
- 将会话/Provider/能力状态持久化到本地文件(`pi-resources.ts`)
- 通过 `contextBridge` 暴露**白名单** IPC 表面(`preload/index.ts`)

**IPC 契约:**

每个 IPC 通道都显式枚举在 `electron/preload/index.ts` 中。渲染端**只能**调白名单里的通道;其他一律在主进程抛错。

加新 IPC 通道时:

1. 加进 `allowedInvokeChannels`
2. 在 `electron/main/ipc/index.ts` 实现处理器
3. 在 `src/lib/electron-api.ts` 增加类型化包装
4. 跑 `pnpm test:electron:ipc-surface` 更新自动生成的 surface 矩阵

### 第 3 层 — Pi Agent + Cordis 网格

**位置:** `packages/runtime/openbuddy-{cordis,plugin-host,storage}` 以及 `packages/<group>/openbuddy-*/` 下的 63 个 workspace 包(12 capability、26 UI、8 collaboration、…)

**职责:**

- 拥有 prompt → 工具调用 → 响应 的循环
- 从本地数据目录解析 Provider/model 配置
- 通过 Cordis 服务分派工具调用
- 强制权限、Plan 模式、子任务生成、记忆写入

**Cordis 60 秒入门:**

Cordis 是 TypeScript 的依赖注入框架。"能力"是一个被注入到共享 `ctx`(上下文)中的服务。服务可以依赖其他服务。销毁是自动的。

```typescript
import { Context, OpenBuddyService } from "@openbuddy/cordis";

export class MemoryService extends OpenBuddyService {
  constructor(ctx: Context, options?: Partial<Config>) {
    super(ctx, "openbuddy.capability.memory", options);
    this.cache = new Map();
  }

  async recall(query: string): Promise<string[]> {
    return this.cache.get(query) ?? [];
  }

  async remember(key: string, value: string) {
    this.cache.set(key, [value]);
    this.ctx.emit("memory:written", { key, value });
  }
}

export default function apply(ctx: Context) {
  ctx.plugin(MemoryService, ctx.config);
}
```

渲染端通过 IPC 抵达服务;`electron/main/` 里的 IPC 处理器在 Cordis 上下文上查找服务。

### 数据流 — 一次典型的 prompt

用户在 OpenBuddy 输入 "总结这个文件" 时:

```
1. 用户在 Composer.tsx 输入
2. Composer 调 window.api.invoke("agent:prompt", { text, context })
3. preload/index.ts 转发到 ipc.ts 处理器 "agent:prompt"
4. agent-host.ts 调用 Pi AgentSession.prompt()
5. Pi 决策: "调 read_file(path=…) 工具"
6. AgentSession 调 Cordis 上下文 plugin(FileService).read(path)
7. FileService 用 @openbuddy/fs-fs-local 从磁盘读
8. 权限检查:路径在用户已授权信任的文件夹内吗?
   ├─ 是 → 继续
   └─ 否 → 发出 permission:request 事件 → 渲染端弹模态框
9. Pi 用结果调 LLM(Anthropic / OpenAI / NewAPI)
10. LLM 流式返回总结
11. AgentSession 发出 pi://message-delta 事件
12. pi-event-bridge 经 webContents.send 转发给渲染端
13. ChatView.tsx 把 delta 追加到可见消息
14. 完成时 AgentSession 发出 pi://done
15. Composer 把结果存进 @openbuddy/capability-memory
```

### 持久化模型

OpenBuddy 一切**本地优先**持久化,可选企业同步到 Casdoor:

| 数据 | 位置 | 格式 | 同步? |
|---|---|---|---|
| 会话 | `~/.config/openbuddy/sessions/` | JSONL | 可选 |
| Providers | `~/.config/openbuddy/providers.json` | JSON | 否 |
| Skills | `~/.config/openbuddy/skills/` | Markdown + JSON | 可选 |
| MCP 配置 | `~/.config/openbuddy/mcp.json` | JSON | 否 |
| Experts | `~/.config/openbuddy/experts/` | Markdown frontmatter | 否 |
| Memory | `~/.config/openbuddy/memory.db` | SQLite | 可选 |
| 审计账本 | `~/.config/openbuddy/audit.log` | JSONL append-only | 可选 |
| 插件 | `~/.config/openbuddy/plugins/` | JS bundles | 可选 |
| Casdoor token | OS keychain | 加密 | 是(refresh) |

全部持久化走 `@openbuddy/storage`,强制:

- 原子写(`tmp` + rename)
- 仅追加 + 哈希链的审计日志
- Schema 版本化 + 自动迁移
- 存储边界(能力代码未经显式授权不能读其他能力的数据)

### 构建与部署

- **渲染端** 由 Vite 打包(`moon run openbuddy:build.bundle`)
- **Main + preload** 由 electron-vite 打包(`moon run openbuddy:build.bundle`)
- **生产安装包** 由 electron-builder 产出(`moon run openbuddy:electron.build.{win,mac,linux}`)
- **CI** 跑与本地相同的 `moon run` 命令
- **自动更新** 通过 `electron-updater` 对接 GitHub Releases

### Plugin priority matrix (Phase I 增量)

OpenBuddy 同时支持自有 Cordis capability 服务 + 上游 pi.dev 原生扩展。
同一 capability 下两者的优先级由 `<profile.dir>/package.json →
manifest.openbuddy.profile.piExtensions` 显式声明驱动,详见
[PI-PRIORITY.md](./PI-PRIORITY.md)。决策矩阵:

| `profile.piExtensions` 声明 | pi 包已装? | 运行时行为 |
| --- | --- | --- |
| ✗ 不声明 | — | 跑 OpenBuddy adapter(完全 Cordis fallback) |
| ✓ 声明 | ✗ 不装 | loader 找不到 spec → fallback adapter 报错或 skip |
| ✓ 声明 | ✓ 装了 | **跑原生 pi 包**,Cordis 服务被 `recordPassthrough` short-circuit |

marketplace install / uninstall 会自动同步 `profile.piExtensions`(Phase I.2),
用户感知通过 toast 反馈(Phase I.3)。

### 测试布局

| 类型 | 位置 | 命令 |
|---|---|---|
| 渲染端单元 | `src/**/__tests__/*.test.ts(x)` | `pnpm workspace:test` |
| 渲染端组件 | `src/**/__tests__/*.test.tsx` | `pnpm workspace:test` |
| 主进程单元 | `electron/main/__tests__/*.test.ts` | `pnpm workspace:test` |
| 包单元 | `packages/**/__tests__/*.test.ts` | `pnpm workspace:test` |
| Electron smoke | `scripts/electron/*-smoke.mjs` | `pnpm test:electron` |
| Surface 回归 | `scripts/electron/surface-regression.mjs` | `pnpm test:electron:surface` |
| IPC 表面 | `scripts/electron/ipc-surface-smoke.mjs` | `pnpm test:electron:ipc-surface` |
| 真机 UI smoke | `scripts/electron/real-ui-smoke.mjs` | `pnpm test:electron:real-ui` |
| 闭环评测 | `scripts/electron/closed-loop-*.mjs` | `pnpm test:closed-loop` |
| 存储边界 | `scripts/storage/check-architecture-boundaries.mjs` | `pnpm storage:boundaries` |
| 外部评测 | `evals/node/run_*.mjs` | `pnpm eval:*` |

---

<div align="center">

**Architecture is a conversation, not a document. / 架构是对话,不是文档。**

<sub>发现过时或有歧义?开 Issue 标签 `docs`,或在 [Discussions](https://github.com/louloulin/OpenBuddy/discussions) 讨论。</sub>

</div>
