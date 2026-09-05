# OpenBuddy 全面插件化 — 借鉴 DeepSeek Harness 架构

**LUM-37 终极目标**。从"13 扩展"升级到"55+ Cordis 包 + bundle + 渲染层 Cordis",彻底对齐 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的设计。

> 已 clone `deepseek-ai/deepseek-harness@master` 到 `study/deepseek-harness/`(91M),用于源码研读。

## 1. DeepSeek Harness 关键架构模式

### 1.1 五件套

来自 [cordis-primer.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md):

1. **Service base class** — 子类 `super(ctx, name)` 自动注册到 `ctx.<name>`,卸载时自动注销
2. **Capability seam** — Service Definition / Service Provider / Consumer 三角色
3. **`inject` 依赖声明** — 数组声明其他服务,自动等齐
4. **Typed events** — `declare module` 合并到 `Context.Events`,4 种 dispatch mode(emit / waterfall / parallel / serial)
5. **Reversible effects** — `ctx.effect()` / `ctx.on()` / `registry.register()` 都返回 disposer

### 1.2 包结构(55 个 @deepseek-ai/dsh-*)

```
packages/
  core/        agent / agent-loop / system-prompt / tools / scope / session
  llm/         llm stream + adapter
  fs/          fs + fs-local + fs-observation-policy + fs-sandbox
  shell/       bash + shell consumers
  skill/       skill + skill-filesystem + tool-skill
  mcp/         mcp-client
  session/     session-persistence + session-titles
  plan/ todo/ subagent/ schedule/ preset/ guard/
  sandbox/ e2b/ terminal/ subprocess/ lsp/ attachment/ compaction/
  hooks/ interaction/ identity/ settings/ credentials/
  bundle/      base + web-app + headless
  boot/        app-bin glue
  sdk/         JSON-RPC + TS client
  examples/    demo bundles
```

每个包:
- `@deepseek-ai/dsh-<name>`,ESM,`type: "module"`
- `src/index.ts` + `src/types.ts` + `src/invariant.ts`(可选)
- `package.json` 中 `dsh.bundle` 或 `dsh.profile` 字段声明 bundle/profile 元数据

### 1.3 Bundle 层叠(顺序应用)

```
empty entry list
  → bundle[0]  (e.g. dsh-base)
  → bundle[1]  (e.g. dsh-web-app / dsh-headless)
  → profile.cordis.patch.yml
  → home/.dsh/cordis.patch.yml
  → --patch overlay
```

每个 patch 按 id 替换整行 config,或插入新行。

### 1.4 4 种 dispatch mode

| Mode | Awaited | Order | Has Return |
|---|---|---|---|
| `emit` | no | registration | no |
| `waterfall` | no | registration | yes |
| `parallel` | yes | parallel | no |
| `serial` | yes | registration | yes |

### 1.5 模型可见 ⟺ 已记录

任何到模型的输入必须能从 session log 重建。`SessionEventMap` 用 `declare module` 合并,新增事件需要更新合并。

## 2. 借鉴到 OpenBuddy 的对应结构

### 2.1 当前状态 vs 目标状态

| 当前 | 目标 |
|---|---|
| 13 个 `extensions/openbuddy/<name>/` 扁平目录 | 30+ 个 `packages/<group>/openbuddy-<name>/` 命名包 |
| 扩展用 `register(pi)` 函数 + Cordis adapter | 每个扩展是 `Service` 子类 + `declare module` 合并 |
| 单一 Electron `main/index.ts` | `apps/desktop` + `packages/runtime/openbuddy-runtime` + `packages/runtime/openbuddy-pi-bridge` + `packages/runtime/openbuddy-ipc` |
| React `src/App.tsx` 自由组合 | 渲染层也是 Cordis 插件(`@openbuddy/renderer-host`) |
| 无 bundle | `packages/bundle/{base,desktop,headless}` |
| 无 cordis.yml | `cordis.yml` + `--patch` overlay |

### 2.2 目标 package 布局(30+ 包)

```
packages/
  core/
    openbuddy-session/        # Session 服务 + event log
    openbuddy-agent/          # Agent 抽象 + lifecycle events
    openbuddy-agent-loop/     # Pi SDK 驱动的 agent loop 适配
    openbuddy-system-prompt/  # 提示段组装
    openbuddy-tools/          # 工具注册表 + 执行管线
    openbuddy-scope/          # per-agent scope

  llm/
    openbuddy-llm/            # 流式 + 适配器接口
    openbuddy-pi-bridge/      # 把 Pi SDK 适配到 ctx.llm

  fs/
    openbuddy-fs/             # 文件系统 Service Definition
    openbuddy-fs-local/       # 本地 fs Provider(workspace 边界)
    openbuddy-fs-policy/      # observation policy(perms)

  shell/
    openbuddy-shell/          # bash 能力定义
    openbuddy-shell-local/    # local bash provider

  skill/
    openbuddy-skill/          # skill 注册表 Service
    openbuddy-skill-filesystem/  # 本地 skill provider

  mcp/
    openbuddy-mcp-client/     # MCP 服务器管理

  session/
    openbuddy-session-persistence/  # JSONL 持久化
    openbuddy-session-titles/       # 自动标题

  capability/
    openbuddy-automation/     # 定时 + 触发任务
    openbuddy-notification/   # 通知队列
    openbuddy-memory/         # 跨会话记忆
    openbuddy-task/           # per-session task list
    openbuddy-plan/           # plan-mode 状态机
    openbuddy-folder-trust/   # 受信任文件夹列表
    openbuddy-web-search/     # web search 适配器
    openbuddy-inspiration/    # 内置 prompt 种子

  team/
    openbuddy-team/           # 子 agent 编排
    openbuddy-subagent/       # subagent 委派

  auth/
    openbuddy-permission/     # 权限规则 + mode
    openbuddy-credentials/    # API key 管理

  runtime/
    openbuddy-runtime/        # Cordis host + 服务暴露
    openbuddy-ipc/            # ipcMain.handle 注册
    openbuddy-event-bus/      # 跨扩展事件

  renderer/
    openbuddy-renderer-host/  # 渲染层 Cordis context
    openbuddy-renderer-api/   # window.api.* 形状定义

  bundle/
    openbuddy-base/           # 所有 profile 的基础层
    openbuddy-desktop/        # Electron desktop profile
    openbuddy-headless/       # CLI / JSON-RPC profile

  boot/
    openbuddy-app-boot/       # dsh boot 模拟
```

### 2.3 bundle 入口

```yaml
# packages/bundle/base/cordis.yml
- id: openbuddy-session
  name: '@openbuddy/core-session'
  config: {}

- id: openbuddy-fs
  name: '@openbuddy/fs-fs'
  config: { defaultMode: 'auto' }

- id: openbuddy-memory
  name: '@openbuddy/capability-memory'
  config: { storageDir: '~/.openbuddy/memory' }

# ... 30+ entries
```

```yaml
# packages/bundle/desktop/cordis.yml
- id: openbuddy-desktop-shell
  name: '@openbuddy/desktop-shell'
  config: { window: { frameless: true }, ... }
```

### 2.4 Service class 模式(以 session 为例)

```ts
// packages/core/openbuddy-session/src/index.ts
import { Context, OpenBuddyService } from '@openbuddy/cordis'

export class Session extends OpenBuddyService {
  static provide = 'sessions'
  private current?: SessionHandle
  private listeners = new Set<(e: SessionEvent) => void>()

  constructor(ctx: Context) {
    super(ctx, 'sessions')
    ctx.effect(() => this.loadActive())
  }

  list(): SessionSummary[] { ... }
  create(opts: CreateOptions): SessionHandle { ... }
  load(id: SessionId): SessionHandle { ... }
  archive(id: SessionId): void { ... }
}

declare module '@openbuddy/cordis' {
  interface Context {
    sessions: Session
  }
  interface Events {
    'session/created'(handle: SessionHandle): void
    'session/archived'(id: SessionId): void
    'session/event'(event: SessionEvent): void
  }
}
```

## 3. 执行计划(commit 切分)

| Commit | 内容 |
|---|---|
| 1(本 commit) | 计划 doc + clone 链接 |
| 2 | pnpm workspaces + 30+ 包骨架 + tsconfig.base |
| 3 | `packages/runtime/openbuddy-cordis`(vendor @cordisjs/core,提供 OpenBuddy 自己的 `openbuddy/cordis` 别名) |
| 4 | `packages/core/openbuddy-session`(从 extensions/openbuddy/sessions 迁移,改为 Service class) |
| 5 | `packages/capability/openbuddy-memory`(从 extensions/openbuddy/memory 迁移) |
| 6 | `packages/capability/openbuddy-notification`(从 extensions/openbuddy/notifications 迁移) |
| 7 | `packages/capability/openbuddy-automation`(从 extensions/openbuddy/automations 迁移) |
| 8 | `packages/fs/openbuddy-fs-local`(从 extensions/openbuddy/shell-fs 迁移,加 fs seam 拆分) |
| 9 | `packages/capability/{openbuddy-task, openbuddy-plan, openbuddy-folder-trust, openbuddy-permission, openbuddy-web-search, openbuddy-inspiration}` 6 个迁移 |
| 10 | `packages/team/openbuddy-team`(从 extensions/openbuddy/team-tools 迁移) |
| 11 | `packages/llm/openbuddy-pi-bridge`(把 Pi SDK 包成 ctx.llm 适配器) |
| 12 | `packages/runtime/openbuddy-ipc`(38 IPC 通道 → ipc plugin) |
| 13 | `packages/runtime/openbuddy-runtime`(Cordis host + bundle 加载) |
| 14 | `packages/bundle/openbuddy-base`(cordis.yml + 30 行) |
| 15 | `packages/bundle/openbuddy-desktop`(cordis.yml + Electron shell) |
| 16 | `packages/bundle/openbuddy-headless`(cordis.yml + CLI) |
| 17 | `electron/main/index.ts` 改成读 cordis.yml 启动 |
| 18 | `src/lib/agent/pi-client.ts`(渲染适配层,从 src/ 移到 packages/renderer) |
| 19 | 删 `src/lib/grok-client.ts` + 21 个 `from "@tauri-apps/*"` import 替换 |
| 20 | 删 `src-tauri/`(整目录,3.2M,83 文件) |
| 21 | 删 `extensions/openbuddy/*`(13 个旧目录,迁移到 packages/) |
| 22 | 删 `scripts/build*.{ps1,sh}`、`dev.bat`、`rust-toolchain.toml` |
| 23 | 关 PR #1 / #2 / #3 |
| 24 | 文档同步(README、CLAUDE.md、docs/AGENTS.md) |

**总计 24 commits,跨 `agent/chong/full-pluginization` 单分支。**

## 4. 不做

- ❌ 不重命名 13 扩展的 IPC 通道名(`shellfs:*` / `sessions:*` 等保留,renderer 端无须改)
- ❌ 不动 Electron + Vite + pnpm + TypeScript 现有工具链
- ❌ 不动 `docs/migration-pi-electron.md` 等历史设计文档(只追加新 doc)
- ❌ 不重写 Pi SDK 的 agent loop(只把它的 `ExtensionAPI` 适配成 Cordis Service)
- ❌ 不复制 vendored Cordis 源码 — 我们的 `@openbuddy/cordis` 就是 `@cordisjs/core@^3.18.1` 的别名

## 5. 风险

- **包数量大**:30+ 包 = 30+ `package.json` + `tsconfig.json`,需要 monorepo 工具链
- **TypeScript 项目引用**:每个包独立 tsconfig,workspace 用 `references` 串起来
- **pnpm 安装**:本机无 `node_modules`,CI 装依赖后才能 tsc 验证
- **bundle 加载顺序**:`cordis.yml` 的 include 必须严格按依赖拓扑排序
- **存量代码兼容**:13 个旧扩展 → 30+ 个新包,API 形状变化大,需要并行运行一段时间

## 6. 验证清单

每个 commit 之后:
- [ ] `pnpm install`(CI 跑)
- [ ] `pnpm -r typecheck`(全 workspace)
- [ ] `pnpm -r test`(vitest 单测)
- [ ] `pnpm --filter @openbuddy/desktop build`(bundle 构建)
- [ ] `pnpm --filter @openbuddy/desktop dev`(Electron + Vite + Cordis boot)
- [ ] `pnpm dsh --profile desktop --dump-config`(看 bundle 树)

---

**第一步**:已 clone `deepseek-harness`(study/),接下来按 commit 2-24 顺序推进。

---

## 7. 参考资料

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [Cordis Primer](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md)
- [Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- [Capability Seams](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/capability-seams.md)
- [Cordis Tutorial](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-tutorial/index.md)
- [Session Subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md)
- [Agent Lifecycle](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/agent-lifecycle.md)
- [Tool Execution Pipeline](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/tool-execution-pipeline.md)
- [Event Producer/Consumer](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/event-producer-consumer.md)
- [Cordis 微内核](https://cordis.js.org/)
- [@cordisjs/core on npm](https://yarnpkg.com/package?name=@cordisjs/core)