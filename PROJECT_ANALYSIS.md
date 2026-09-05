# OpenBuddy 项目全面分析文档

> 📅 生成日期: 2026-09-04 | 🔍 分析范围: 全代码库 | 📦 版本: 0.14.0

---

## 📑 目录

1. [项目概述](#1-项目概述)
2. [技术栈总览](#2-技术栈总览)
3. [三层架构详解](#3-三层架构详解)
4. [前端层 (React Renderer)](#4-前端层-react-renderer)
5. [中间层 (Electron Main + Preload)](#5-中间层-electron-main--preload)
6. [底层 (Pi Agent + Cordis 能力网格)](#6-底层-pi-agent--cordis-能力网格)
7. [核心包矩阵 (63个包)](#7-核心包矩阵-63个包)
8. [数据流分析](#8-数据流分析)
9. [持久化模型](#9-持久化模型)
10. [测试体系](#10-测试体系)
11. [构建与部署](#11-构建与部署)
12. [安全模型](#12-安全模型)
13. [企业集成](#13-企业集成)
14. [项目统计](#14-项目统计)

---

## 1. 项目概述

**OpenBuddy** 是一个 100% 开源 (MIT) 的桌面 AI 工作区，对标腾讯 WorkBuddy 的产品形态，基于 **Electron + Cordis + Pi** 重建。

### 核心定位
- 🎯 **WorkBuddy 风格 UI** — 移植 `--wb-*` 设计令牌，207 图标体系（全部实现，零存根）
- ⚡ **进程内 Pi Agent** — `@earendil-works/pi-coding-agent` 运行在 Electron Main 中
- 🔌 **Cordis 能力网格** — 63 个 workspace 包，每个都是可独立启用/配置/扩展的 Cordis 服务
- 🏢 **企业级** — Casdoor OIDC、NewAPI 网关、4 个支付通道、SCIM v2、SAML 2.0
- 🧪 **309 个测试文件** — Vitest + Playwright 全覆盖

### 项目结构概览
```
OpenBuddy/
├── src/                        # React 前端 (渲染层)
├── electron/                   # Electron 主进程 + preload
│   ├── main/                   # 主进程逻辑
│   │   ├── agent/              # Pi AgentSession 生命周期
│   │   ├── ipc/                # IPC 处理器（白名单）
│   │   ├── casdoor/            # Casdoor 认证
│   │   ├── collaboration/      # 协作运行时
│   │   ├── deepseek/           # DeepSeek 兼容层
│   │   ├── harness/            # Harness 服务器
│   │   └── security/           # 安全模块
│   └── preload/                # contextBridge 桥接
├── packages/                   # 63 个 workspace 包
│   ├── runtime/                # 运行时核心
│   ├── auth/                   # 认证与权限
│   ├── capability/             # 能力服务
│   ├── collaboration/          # 协作层
│   ├── core/                   # 核心服务
│   ├── fs/                     # 文件系统
│   ├── shared/                 # 共享类型
│   ├── payment/                # 支付
│   ├── saml/                   # SAML 2.0
│   ├── scim/                   # SCIM v2
│   ├── webhook-outbox/         # Webhook 事务箱
│   └── ui/                     # UI 组件包 (26个)
├── apps/
│   └── admin-portal/           # 管理后台 SPA
├── evals/                      # 评测套件
├── scripts/                    # 构建/测试脚本
└── docs/                       # 文档
```

---

## 2. 技术栈总览

| 层级 | 技术 | 版本 |
|------|------|------|
| **Shell** | Electron | 44 |
| **构建** | electron-builder | 26 |
| **渲染** | React | 18 |
| **打包** | Vite | 5 |
| **状态管理** | Zustand | 4 |
| **路由** | React Router | 6 |
| **Markdown** | react-markdown + remark-gfm + rehype-highlight | - |
| **数学公式** | KaTeX + remark-math + rehype-katex | - |
| **图表** | Mermaid | 11 |
| **图标** | lucide-react | 0.460 |
| **Agent 运行时** | Pi coding-agent / agent-core / pi-ai | 0.84 |
| **能力框架** | Cordis | 3 |
| **MCP** | @modelcontextprotocol/sdk | 1.25 |
| **Monorepo** | moon | 2.5 |
| **包管理** | pnpm | 11 |
| **测试** | Vitest + Playwright + Testing Library | 2 / 1.58 |
| **类型** | TypeScript (strict) | 5.6 |

---

## 3. 三层架构详解

```
┌──────────────────────────────────────────────────────────────────┐
│  Layer 1: React Renderer (src/, packages/ui/*)                   │
│    Vite + React 18 + Zustand stores                              │
│    Foundation: --wb-* tokens, 207-icon set, brand atoms          │
└───────────────────────────┬──────────────────────────────────────┘
                            │ window.api (typed contextBridge)
┌───────────────────────────┴──────────────────────────────────────┐
│  Layer 2: Electron Main + preload bridge                         │
│    ipc.ts                ← 白名单 IPC 处理器                     │
│    agent-host.ts         ← Pi AgentSession 生命周期              │
│    pi-event-bridge.ts    ← 清理感知的 pi://* 事件                 │
│    pi-resources.ts       ← 本地持久化 (Cordis fs)                │
│    capability-*.ts       ← Cordis 能力服务                       │
└───────────────────────────┬──────────────────────────────────────┘
                            │ 类型化 Pi 会话事件
┌───────────────────────────┴──────────────────────────────────────┐
│  Layer 3: Pi AgentSession + Cordis 能力服务                      │
│    providers, tools, permissions, plans, tasks, persistence      │
└──────────────────────────────────────────────────────────────────┘
```

### 层间通信机制

| 层级 | → 下层 | → 上层 |
|------|--------|--------|
| Renderer → Main | `window.api.invoke(channel, args)` | `pi://*` 事件流 |
| Main → Pi | `AgentSession.prompt()` / Cordis 服务调用 | `AgentSessionEvent` 回调 |
| Main → Renderer | - | `webContents.send(channel, data)` |

---

## 4. 前端层 (React Renderer)

### 4.1 目录结构
```
src/
├── App.tsx                     # 根组件 (2090行，Shell 主体)
├── main.tsx                    # Vite 入口
├── styles/
│   ├── tokens.css              # --wb-* 设计令牌
│   ├── global.css              # Reset + 基础样式
│   └── app.css                 # App 布局
├── foundation/
│   └── components/Icon/        # 207 图标集
├── lib/
│   ├── platform/
│   │   ├── electron-api.ts     # 类型化 window.api 包装器
│   │   ├── app-version.ts      # 版本信息
│   │   └── platform.ts         # 平台检测
│   ├── agent/
│   │   ├── pi-client.ts        # 流式事件客户端
│   │   ├── subagents.ts        # 子代理管理
│   │   └── session-artifacts.ts
│   ├── billing/                # 计费相关
│   ├── casdoor/                # Casdoor 客户端
│   ├── collaboration/          # 协作投影
│   ├── email/                  # 邮件相关
│   ├── runtime/                # 渲染器插件运行时
│   └── stream/                 # 流处理
├── stores/                     # Zustand 状态管理
│   ├── session-store.ts        # 当前会话状态
│   ├── sessions-store.ts       # 会话列表
│   ├── permission-store.ts     # 权限提示
│   ├── feedback-store.ts       # 反馈
│   ├── toast-store.ts          # Toast 通知
│   ├── projects-store.ts       # 项目管理
│   ├── subagent-store.ts       # 子代理
│   └── ...
├── components/                 # UI 组件
│   ├── ErrorBoundary.tsx
│   ├── StatusIndicator.tsx
│   └── shared/
│       ├── PlaceholderPage.tsx
│       └── Toast.tsx
└── locales/                    # i18n 消息
```

### 4.2 核心组件

| 组件 | 来源包 | 职责 |
|------|--------|------|
| `TitleBar` | `@openbuddy/ui-shell` | 标题栏 + 拖拽区域 |
| `Sidebar` | `@openbuddy/ui-sidebar` | 侧边栏导航 |
| `HomePage` | `@openbuddy/ui-settings` | 首页/设置 |
| `ChatView` | `@openbuddy/ui-conversation` | 聊天视图 |
| `TopbarActions` | `@openbuddy/ui-shell` | 顶部操作栏 |
| `SettingsPanel` | `@openbuddy/ui-settings` | 设置面板 |
| `SearchOverlay` | `@openbuddy/ui-workbench` | 搜索覆盖层 |
| `TasksPanel` | `@openbuddy/ui-automation` | 任务面板 |

### 4.3 状态管理 (Zustand Stores)

| Store | 文件 | 职责 |
|-------|------|------|
| `useSessionStore` | `session-store.ts` | 当前活跃会话、消息、流式状态 |
| `useSessionsStore` | `sessions-store.ts` | 会话列表、归档、置顶 |
| `usePermissionStore` | `permission-store.ts` | 权限请求弹窗 |
| `useFeedbackStore` | `feedback-store.ts` | 用户反馈 |
| `useToastStore` | `toast-store.ts` | Toast 通知队列 |
| `useProjectsStore` | `projects-store.ts` | 项目元数据 |
| `useSubagentStore` | `subagent-store.ts` | 子代理任务 |
| `useMessageQueueStore` | `message-queue-store.ts` | 消息队列 |
| `useQuestionStore` | `question-store.ts` | 用户提问 |
| `usePendingExpertStore` | `pending-expert-store.ts` | 待加载专家 |

### 4.4 Electron API 桥接

`src/lib/platform/electron-api.ts` 提供类型化的 IPC 包装器：

```typescript
// 核心 API
export async function invoke<T>(channel: string, args?: unknown): Promise<T>
export async function invokeWithTimeout<T>(channel: string, args?: unknown, timeoutMs?: number): Promise<T>
export async function listen<T>(channel: string, handler: (data: T) => void): Promise<UnlistenFn>
export async function listenSafe<T>(channel: string, handler: (data: T) => void): Promise<UnlistenFn>
export function rpcRequest<T>(message: unknown): Promise<T>

// 对话框
export async function open(options: Record<string, unknown>): Promise<string | string[] | null>
export async function save(options: Record<string, unknown>): Promise<string | null>

// 窗口
export function getCurrentWindow(): ElectronWindowApi["window"]
export function convertFileSrc(filePath: string): string
```

### 4.5 设计令牌

```css
/* src/styles/tokens.css */
:root {
  --wb-font-family: ...;
  --wb-radius-sm: ...;
  --wb-color-primary: ...;
  --wb-shadow-...: ...;
  /* 200+ 令牌 */
}
```

### 4.6 图标系统

207 个图标，全部实现（零存根），位于 `foundation/components/Icon/`。

---

## 5. 中间层 (Electron Main + Preload)

### 5.1 主进程入口

**`electron/main/index.ts`** — 应用生命周期入口

```typescript
// 关键流程
1. app.setName("OpenBuddy")
2. 懒加载 agent-host（138 个顶级导入，延迟加载避免阻塞首屏）
3. 安装应用菜单
4. 注册 IPC 处理器
5. 启动 Harness 服务器
6. 初始化 Casdoor 认证
7. 创建主窗口
```

### 5.2 Agent Host

**`electron/main/agent/agent-host.ts`** — 3479 行，Pi AgentSession 生命周期管理

核心职责：
- 创建 `AgentSession`（Pi SDK 进程内运行）
- 管理 Provider 注册表
- 加载 Pi 扩展（9 个 Pi 扩展 + 10 个 Host 模块）
- 处理工具调用
- 管理会话生命周期

```typescript
// 创建 AgentSession
const session = createAgentSession({
  extensions: [...piExtensions, ...hostModules],
  resourceLoader: new DefaultResourceLoader(),
  // ...
});
```

### 5.3 IPC 白名单

**`electron/preload/index.ts`** — 484 行

所有 IPC 通道显式枚举：

```typescript
const allowedInvokeChannels = new Set([
  // Agent 控制
  "agent:abort", "agent:init", "agent:prompt", "agent:set-model",
  
  // Casdoor 认证
  "casdoor:authorize", "casdoor:login", "casdoor:logout",
  "casdoor:status", "casdoor:sync-workbench-scope",
  
  // 会话管理
  "session:list", "session:fork", "session:search", "session:rewind",
  "session:archive", "session:pin", "session:set-expert",
  
  // 记忆
  "memory:get", "memory:save", "memory:recall",
  
  // 技能
  "skills:list", "skills:add", "skills:remove",
  
  // 任务
  "tasks:list", "tasks:add", "tasks:cancel",
  
  // 日历
  "calendar:list", "calendar:create", "calendar:update",
  
  // 邮件
  "email:drafts", "email:send", "email:search",
  
  // 文件系统
  "shellfs:read-text", "shellfs:write-text", "shellfs:stat",
  
  // 对话框
  "dialog:open", "dialog:save",
  
  // 协作
  "collaboration:snapshot", "collaboration:task-control",
  
  // ...更多
]);
```

### 5.4 Pi 事件桥接

**`electron/main/agent/pi-event-bridge.ts`** — 清理感知的事件转发

```typescript
// Pi AgentSession 事件 → Renderer
session.on("pi://message-delta", (data) => {
  mainWindow.webContents.send("pi:message-delta", data);
});

session.on("pi://done", () => {
  mainWindow.webContents.send("pi:done");
});

session.on("pi://tool-call", (data) => {
  mainWindow.webContents.send("pi:tool-call", data);
});
```

### 5.5 预加载桥接

```typescript
// electron/preload/index.ts — contextBridge 暴露
contextBridge.exposeInMainWorld("api", {
  invoke: (channel: string, args?: unknown) => ipcRenderer.invoke(channel, args),
  on: (channel: string, handler: Function) => { /* 白名单检查 + 注册 */ },
  removeListener: (channel: string, handler: Function) => { /* 清理 */ },
  window: { minimize, maximize, close, isMaximized },
  webview: { ... },
  openExternal: (url: string) => shell.openExternal(url),
});
```

---

## 6. 底层 (Pi Agent + Cordis 能力网格)

### 6.1 Cordis 框架

**`@openbuddy/cordis`** — 对 `@cordisjs/core` 的薄封装

```typescript
// 核心类
export class OpenBuddyService<T> extends CordisService<T> {
  static override provide: any;
  constructor(ctx: Context, name?: string) {
    super(ctx, name ?? "openbuddy");
  }
}

// 工具函数
export function brand<B>(value: string): Branded<B>
export function debug(ctx: Context, tag: string): (msg: string) => void
export function forEach<T>(ctx: Context, pick: Function, handler: Function): () => void
```

### 6.2 存储层

**`@openbuddy/storage`** — 基于 SQLite 的本地持久化

核心组件：
- `StorageGateway` — 存储网关
- `SqliteDriver` — SQLite 驱动
- `SessionCatalog` — 会话目录
- `MemoryIndex` — 记忆索引
- `TaskCatalog` — 任务目录
- `ApprovalCatalog` — 审批目录
- `EventStore` — 事件存储
- `ContentAddressedObjectStore` — 内容寻址对象存储

### 6.3 会话管理

**`@openbuddy/core-session`** — 会话清单 + 元数据

```typescript
interface SessionSummary {
  sessionId: string;
  title: string;
  updatedAt?: string;
  cwd: string;
  isGitRepo?: boolean;
  pinned?: boolean;
  archived?: boolean;
  currentModelId?: string;
  expertId?: string;
  expertName?: string;
  expertAvatar?: string;
}
```

数据源：
- Pi JSONL 树：`~/.pi/agent/sessions/<encoded-cwd>/*.jsonl`
- SQLite 会话目录：`~/.config/openbuddy/sessions.db`
- JSON 兼容镜像：`~/.pi/openbuddy-state.json`

### 6.4 文件系统

**`@openbuddy/fs-fs-local`** — 本地文件系统 Cordis 服务

```typescript
// 核心 API
readFile(path: string): Promise<string>
writeFile(path: string, content: string): Promise<void>
stat(path: string): Promise<PathStat>
listDirectory(path: string): Promise<DirEntry[]>
watchFile(path: string, callback: Function): FSWatcher
```

### 6.5 插件主机

**`@openbuddy/plugin-host`** — 插件发现 + 热重载

核心功能：
- `HarnessPluginLoader` — 插件加载器
- `RendererPluginLoader` — 渲染器插件加载器
- `composePluginPatches()` — 插件补丁组合
- `manifestToBundle()` — 清单到包转换
- `createPluginStateStore()` — 插件状态存储

### 6.6 渲染器主机

**`@openbuddy/renderer-host`** — 渲染器侧插件运行时

```typescript
// 核心类
class RendererContributionRegistry { /* UI 贡献点注册 */ }
class RendererEventRegistry { /* 渲染器事件总线 */ }
class RendererPluginLoader { /* 插件生命周期管理 */ }

// 传输层
interface HarnessTransport { /* WebSocket/SSE 传输 */ }
```

### 6.7 Bundle Base

**`@openbuddy/bundle-base`** — 应用包清单

声明所有插件：
- 10+ 主进程能力插件
- 11 渲染器插件
- 工厂函数：`createOpenBuddyProfile()`, `createOpenBuddyRendererProfile()`

---

## 7. 核心包矩阵 (63个包)

### 7.1 运行时层 (3 包)

| 包名 | 职责 |
|------|------|
| `@openbuddy/cordis` | Cordis 框架封装，OpenBuddyService 基类 |
| `@openbuddy/plugin-host` | 插件发现、加载、热重载 |
| `@openbuddy/storage` | SQLite 持久化，会话/任务/记忆存储 |

### 7.2 认证层 (2 包)

| 包名 | 职责 |
|------|------|
| `@openbuddy/auth-casdoor` | Casdoor OIDC 客户端 + 管理 REST |
| `@openbuddy/auth-permission` | 权限提示 & 策略 UI |

### 7.3 能力层 (6 包)

| 包名 | 职责 |
|------|------|
| `@openbuddy/capability-authorization` | 能力级策略 |
| `@openbuddy/capability-calendar` | 日历集成 |
| `@openbuddy/capability-email` | IMAP/SMTP + Gmail/Graph/JMAP API |
| `@openbuddy/capability-folder-trust` | 文件夹级权限授权 |
| `@openbuddy/capability-mcp-client` | MCP 连接器治理 |
| `@openbuddy/capability-web-search` | 提供者可插拔的 Web 搜索 |

### 7.4 协作层 (8 包)

| 包名 | 职责 |
|------|------|
| `@openbuddy/collaboration-protocol` | A2A 消息信封，共享词汇表 |
| `@openbuddy/collaboration-room` | 共享房间 |
| `@openbuddy/collaboration-inbox` | 跨代理收件箱 |
| `@openbuddy/collaboration-policy` | 跨代理策略 |
| `@openbuddy/collaboration-task` | 跨代理任务图 |
| `@openbuddy/collaboration-network` | 网络拓扑、对等发现、信任 |
| `@openbuddy/collaboration-evidence` | 审计证据 |
| `@openbuddy/collaboration-coordinator` | 协调层 |

### 7.5 核心层 (4 包)

| 包名 | 职责 |
|------|------|
| `@openbuddy/core-session` | 会话生命周期、分叉、回退 |
| `@openbuddy/logging-main` | 主进程日志 |
| `@openbuddy/logging-renderer` | 渲染器日志 |
| `@openbuddy/logging-shared` | 共享日志工具 |

### 7.6 文件系统 (1 包)

| 包名 | 职责 |
|------|------|
| `@openbuddy/fs-fs-local` | 本地文件系统 Cordis 服务 |

### 7.7 共享层 (3 包)

| 包名 | 职责 |
|------|------|
| `@openbuddy/files-kb` | 知识库文件索引 |
| `@openbuddy/types` | 跨包类型定义 |
| `@openbuddy/logging-shared` | 日志级别、追踪 ID、脱敏 |

### 7.8 企业层 (4 包)

| 包名 | 职责 |
|------|------|
| `@openbuddy/payment` | Stripe / 微信支付 / 支付宝 / HMAC |
| `@openbuddy/saml` | SAML 2.0 原语 |
| `@openbuddy/scim` | SCIM v2 端点 (RFC 7644) |
| `@openbuddy/webhook-outbox` | 事务性发件箱 + 重试/退避 |

### 7.9 UI 层 (26 包)

| 包名 | 职责 |
|------|------|
| `@openbuddy/ui-shell` | 应用外壳、标题栏 |
| `@openbuddy/ui-sidebar` | 侧边栏 |
| `@openbuddy/ui-settings` | 设置面板 |
| `@openbuddy/ui-workbench` | 工作台 |
| `@openbuddy/ui-conversation` | 对话视图 |
| `@openbuddy/ui-experts` | 专家管理 |
| `@openbuddy/ui-dialogs` | 对话框 |
| `@openbuddy/ui-markdown` | Markdown 渲染 |
| `@openbuddy/ui-primitives` | 基础 UI 原语 |
| `@openbuddy/ui-theme` | 主题系统 |
| `@openbuddy/ui-runtime` | UI 运行时 |
| `@openbuddy/ui-automation` | 自动化 UI |
| `@openbuddy/ui-locale` | 国际化 |
| ... | 更多 UI 包 |

---

## 8. 数据流分析

### 8.1 典型 Prompt 流程

```
用户在 Composer.tsx 输入 "总结这个文件"
         │
         ▼
1. Composer 调 window.api.invoke("agent:prompt", { text, context })
         │
         ▼
2. preload/index.ts 转发到 ipc.ts 处理器
         │
         ▼
3. agent-host.ts 调用 Pi AgentSession.prompt()
         │
         ▼
4. Pi 决策: "调 read_file(path=...) 工具"
         │
         ▼
5. AgentSession 调 Cordis 上下文 plugin(FileService).read(path)
         │
         ▼
6. FileService 用 @openbuddy/fs-fs-local 从磁盘读
         │
         ▼
7. 权限检查: 路径在用户已授权信任的文件夹内吗?
   ├─ 是 → 继续
   └─ 否 → 发出 permission:request 事件 → 渲染端弹模态框
         │
         ▼
8. Pi 用结果调 LLM (Anthropic / OpenAI / NewAPI)
         │
         ▼
9. LLM 流式返回总结
         │
         ▼
10. AgentSession 发出 pi://message-delta 事件
         │
         ▼
11. pi-event-bridge 经 webContents.send 转发给渲染端
         │
         ▼
12. ChatView.tsx 把 delta 追加到可见消息
         │
         ▼
13. 完成时 AgentSession 发出 pi://done
         │
         ▼
14. Composer 把结果存进 @openbuddy/capability-memory
```

### 8.2 事件流

```
Pi AgentSession Events
  ├── pi://message-delta    → 消息增量
  ├── pi://tool-call        → 工具调用
  ├── pi://tool-result      → 工具结果
  ├── pi://plan-update      → 计划更新
  ├── pi://permission       → 权限请求
  ├── pi://done             → 完成
  └── pi://error            → 错误
```

---

## 9. 持久化模型

### 9.1 数据存储位置

| 数据 | 位置 | 格式 | 同步? |
|------|------|------|-------|
| 会话 | `~/.config/openbuddy/sessions/` | JSONL | 可选 |
| Providers | `~/.config/openbuddy/providers.json` | JSON | 否 |
| 技能 | `~/.config/openbuddy/skills/` | Markdown + JSON | 可选 |
| MCP 配置 | `~/.config/openbuddy/mcp.json` | JSON | 否 |
| 专家 | `~/.config/openbuddy/experts/` | Markdown frontmatter | 否 |
| 记忆 | `~/.config/openbuddy/memory.db` | SQLite | 可选 |
| 审计日志 | `~/.config/openbuddy/audit.log` | JSONL append-only | 可选 |
| 插件 | `~/.config/openbuddy/plugins/` | JS bundles | 可选 |
| Casdoor token | OS keychain | 加密 | 是 (refresh) |

### 9.2 存储保证

- ✅ 原子写入 (`tmp` + rename)
- ✅ 仅追加审计日志 + 哈希链
- ✅ Schema 版本化 + 自动迁移
- ✅ 存储边界（能力代码未经显式授权不能读其他能力的数据）

---

## 10. 测试体系

### 10.1 测试类型

| 类型 | 位置 | 命令 |
|------|------|------|
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

### 10.2 测试统计

- **309 个测试文件**
- **Vitest** 用于单元/集成测试
- **Playwright** 用于 E2E/smoke 测试
- **Testing Library** 用于组件测试

### 10.3 评测套件

- `eval:gaia-local` — GAIA 基准测试
- `eval:agentbench-tools-local` — AgentBench 工具测试
- `eval:agentdojo-safety-local` — AgentDojo 安全测试
- `eval:top-tier-local` — 顶级本地评测
- `eval:mt-bench-style` — MT-Bench 风格测试
- `eval:bfcl-style` — BFCL 风格测试
- `eval:nl2bash-style` — NL2Bash 风格测试
- `eval:swe-bench-style` — SWE-Bench 风格测试

---

## 11. 构建与部署

### 11.1 开发环境

```bash
# 前置条件
Node.js 22+, pnpm 10+, Git (with submodule support)

# 安装
git clone --recurse-submodules https://github.com/louloulin/OpenBuddy.git
cd OpenBuddy
pnpm install

# 开发模式
pnpm electron:dev  # 等价于: moon run openbuddy:dev.electron
```

### 11.2 生产构建

```bash
# Windows
pnpm electron:build:win    # NSIS .exe + MSI

# macOS
pnpm electron:build:mac    # DMG

# Linux
pnpm electron:build:linux  # AppImage + .deb

# 全平台
pnpm electron:build:all
```

### 11.3 构建流水线

```
Renderer (Vite)     ─┐
                     ├─→ electron-builder → 安装包
Main + preload      ─┘   (NSIS/DMG/AppImage)
(electron-vite)
```

### 11.4 CI/CD

- GitHub Actions
- `moon run` 命令与本地一致
- 自动更新：`electron-updater` + GitHub Releases

---

## 12. 安全模型

### 12.1 渲染器隔离

```typescript
// electron/main/window.ts
new BrowserWindow({
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    preload: preloadPath,
  },
});
```

### 12.2 IPC 白名单

所有 IPC 通道显式枚举在 `electron/preload/index.ts`，未列出的通道调用会抛错。

### 12.3 存储边界

- 能力代码不能读其他能力的数据
- `@openbuddy/storage` 强制边界检查
- `scripts/storage/check-architecture-boundaries.mjs` 自动验证

### 12.4 权限系统

- **文件夹信任** — `@openbuddy/capability-folder-trust`
- **能力级策略** — `@openbuddy/capability-authorization`
- **Casdoor OIDC** — PKCE + refresh token 轮换
- **SCIM v2** — 用户/组供应
- **SAML 2.0** — 联邦认证

---

## 13. 企业集成

### 13.1 Casdoor (OIDC)

- SSO 单点登录
- 租户策略
- 审计日志
- 账户链接

### 13.2 NewAPI (模型网关)

- BYOK (Bring Your Own Key)
- Service Token
- 多模型聚合

### 13.3 支付

- Stripe (国际)
- 微信支付 (中国)
- 支付宝 (中国)
- HMAC 签名

### 13.4 企业特性

- SCIM v2 用户供应 (RFC 7644)
- SAML 2.0 联邦认证
- 事务性 Webhook 发件箱
- 本地审计账本

---

## 14. 项目统计

### 14.1 代码规模

| 指标 | 数值 |
|------|------|
| Workspace 包 | 63 |
| 测试文件 | 309 |
| 主进程入口 | 3479 行 (agent-host.ts) |
| App.tsx | 2090 行 |
| IPC 处理器 | 966 行 |
| Preload 桥接 | 484 行 |
| 图标 | 207 个 (全部实现) |
| UI 包 | 26 个 |
| 能力包 | 12 个 |
| 协作包 | 8 个 |

### 14.2 依赖统计

- **运行时依赖**: ~50 个
- **开发依赖**: ~20 个
- **内部包**: 63 个

### 14.3 平台支持

| 平台 | 安装包格式 |
|------|-----------|
| Windows | NSIS .exe + MSI |
| macOS | DMG |
| Linux | AppImage + .deb |

---

## 📚 参考文档

| 文档 | 用途 |
|------|------|
| [README.md](README.md) | 项目首页 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 架构深度解析 |
| [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) | 30 分钟开发者设置 |
| [docs/PLUGIN_DEVELOPMENT.md](docs/PLUGIN_DEVELOPMENT.md) | 插件开发指南 |
| [docs/TESTING.md](docs/TESTING.md) | 测试策略 |
| [docs/FAQ.md](docs/FAQ.md) | 常见问题 |

---

*本文档由 AtomCode (mimo-v2.5-pro) 自动生成，基于对整个代码库的全面分析。*
