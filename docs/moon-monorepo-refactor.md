# OpenBuddy moon monorepo guide

> 状态：**已落地**。`docs/moon-monorepo-refactor.md` 的早期版本是分析
> 与建议；本文档描述仓库当前如何用 moon 管理构建。

## 1. 项目图

`.moon/workspace.yml` 用 `globFormat: source-path` + `sources.openbuddy`
把仓库分成 19 个 moon 项目：

| ID | 源 | 角色 |
|---|---|---|
| `openbuddy` | `.` | React 渲染层（Vite + tsc + vitest） |
| `app-desktop` | `electron/` | Electron 主进程 + 预加载（tsc） |
| `packages/runtime/openbuddy-cordis` | … | Cordis 框架基座 |
| `packages/runtime/openbuddy-plugin-host` | … | Pi 插件加载器 |
| `packages/bundle/openbuddy-base` | … | Bundle 入口 |
| `packages/renderer/openbuddy-renderer-host` | … | 渲染层 Cordis context |
| `packages/core/openbuddy-session` | … | 会话服务 |
| `packages/fs/openbuddy-fs-local` | … | 本地 fs Provider |
| `packages/team/openbuddy-team` | … | 多 agent 编排 |
| `packages/team/openbuddy-subagent` | … | Subagent 服务 |
| `packages/capability/openbuddy-memory` | … | 跨会话记忆 |
| `packages/capability/openbuddy-notification` | … | 通知队列 |
| `packages/capability/openbuddy-inspiration` | … | Prompt 种子 |
| `packages/capability/openbuddy-web-search` | … | Web 搜索 |
| `packages/capability/openbuddy-plan` | … | Plan 模式 |
| `packages/capability/openbuddy-folder-trust` | … | 文件夹信任 |
| `packages/capability/openbuddy-task` | … | Session 任务表 |
| `packages/capability/openbuddy-automation` | … | 定时/触发任务 |
| `packages/auth/openbuddy-permission` | … | 权限规则 |

## 2. 任务图

每个包在自己的 `moon.yml` 暴露 `typecheck` + `test`，并通过 `dependsOn`
声明依赖关系（在 `electron/moon.yml` 中显式列出 16 个上游 Cordis 包）。
`openbuddy` 与 `app-desktop` 暴露 `build.renderer`、`electron.build.*`、
`dev`、`dev.electron` 等高层任务。

```
openbuddy:build         ──▶ openbuddy:typecheck ─▶ openbuddy:build.renderer
                          ─▶ app-desktop:typecheck

openbuddy:electron.build ──▶ openbuddy:build

app-desktop:build       ──▶ app-desktop:typecheck
                          ─▶ 所有 packages/*:typecheck（transitively）
```

## 3. 常用命令

```bash
# 全工作区
pnpm moon:sync                              # 同步项目图（CI 必跑）
pnpm moon:query                              # JSON dump
pnpm moon:graph                              # 浏览器可视化依赖图
pnpm dev:renderer                            # 启动 Vite renderer
pnpm dev                                     # Renderer + Electron 主进程
pnpm build                                   # typecheck + electron-vite build
pnpm test                                    # 全部 vitest 用例
pnpm electron:build                          # 全平台打包
pnpm electron:build:win                      # 仅 Windows
pnpm electron:build:mac                      # 仅 macOS

# 也可以用根 npm scripts（全部 forward 到 moon run）
pnpm dev                                   # = moon run openbuddy:dev
pnpm build                                 # = moon run openbuddy:build
pnpm test                                  # = moon run openbuddy:test
pnpm electron:build                        # = moon run openbuddy:electron.build
```

## 4. CI

`.github/workflows/release.yml` 已经全部用 moon：

1. `ci` job：在 ubuntu runner 上跑 `moon sync projects` →
   `moon run openbuddy:typecheck app-desktop:typecheck packages/*:typecheck`
   → `moon run openbuddy:test` → `moon run openbuddy:build.renderer`。
2. `build-windows` / `build-macos` 仅跑 `moon run openbuddy:electron.build.win|mac`，
   `deps: ["~:build"]` 保证增量复用。
3. `publish-release` 仅做产物收集 + GitHub Release 描述。

## 5. 设计选择记录

| # | 选择 | 原因 |
|---|---|---|
| 1 | monorepo 工具：moon | Rust 引擎 + 增量缓存 + 19 包规模下足够快；nx/turborepo 不需要额外的 plugin 生态 |
| 2 | 包管理器：pnpm | 保持与原 `pnpm-workspace.yaml` 一致；`moon` 自带 `pnpm` 工具链 |
| 3 | Task 命令实现：`script:` 而非 `command:` | 跳过 moon 对 `vite build` 等智能 `args`/path 注入，避免与原生 CLI 冲突 |
| 4 | 关闭 `syncProjectReferences` | 让 `tsc --build` 不被 moon 强制转成 composite 引用，保留现有 `tsconfig.json` |
| 5 | 任务 `script: "tsc --noEmit"` | 不依赖 composite，避免必须先 `dist/` |
| 6 | `app-desktop` ID（而非 `openbuddy-desktop`） | moon 在 CLI 通配早期版本下对长 ID 解析不稳定，简化命名可避免歧义 |
