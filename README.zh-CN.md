# OpenBuddy

OpenBuddy 正迁移为 Electron + Pi 的 React 桌面工作区。MVP 范围包括聊天、会话、工具、工作区文件、模型/BYOK、权限、MCP 配置、技能和通知。当前分支为迁移实现，package.json 的版本号不表示已经发布。

[English](README.md)

## 开发与构建

需要 Node.js >=22.19.0（建议 Node 24）与 pnpm 10.29.3。已向 npm registry 核实并精确固定 Electron 45.3.0、Pi SDK 1.5.2；本机 arm64 二进制实测为 Electron 45.3.0 / Node 24.22.2 / Chromium 156.0.8078.96。

```sh
pnpm install --frozen-lockfile
pnpm dev:electron
pnpm test
pnpm build:electron
pnpm pack:electron
pnpm dist:electron
```

`pnpm dev` 仅启动浏览器 Vite 页面，本地能力需 `dev:electron`。修改主进程或 preload 后需重启开发命令。默认打包当前平台，`pnpm dist:mac` 生成 DMG，`pnpm dist:win` 生成 NSIS，产物位于 `release/`。各平台仍需在相应系统安装验证。

## 架构与安全

React 通过受限的 `window.openbuddy` 访问主进程；IPC 校验发送窗口、顶层 frame、命令白名单与参数。渲染进程启用 contextIsolation 与 sandbox，关闭 nodeIntegration，设置 CSP，限制导航与新窗口，外链只允许 HTTP/HTTPS。导出文件必须使用原生保存对话框授权的路径。

Pi 在主进程运行。配置和会话位于 Electron `userData/pi/`，默认不访问 `~/.pi`。API Key 使用 safeStorage 加密；配置文件不能当作认证备份。旧 Tauri/ACP 会话尚无自动导入功能。

### 代码结构

仓库是 pnpm workspace。各包以 TypeScript 源码形式被引用：`tsconfig.base.json` 的 paths 以及 Vite / Vitest / esbuild 的别名把 `@openbuddy/<包>[/<子路径>]` 映射到 `packages/<包>/src/…`，不需要单独构建包。

```text
apps/desktop      Electron 宿主：main/、preload/、ipc/register.ts、scripts/（构建、开发、界面检查）
apps/web          React 渲染层：src/app（外壳、命令面板、路由）、src/features/*、src/shared/*
packages/protocol IPC 契约（命令、事件）与 DTO 类型
packages/services 配置、模型提供商、MCP、技能、文件、预览（Node）
packages/engine   Pi 会话引擎、权限、扩展 UI 桥、检查点、产物（Node）
packages/host     IPC 命令处理与文件/工作区访问校验（Node）
packages/client   渲染层 IPC 客户端
packages/chat-core 无 UI 的对话逻辑：回合分组、工具摘要、diff、导出、错误文案
packages/platform 平台工具（剪贴板、平台识别）
packages/ui       图标、Toast、ImageLightbox、ThemeProvider、设计 token
packages/markdown Markdown 渲染管线与代码块操作
tools/            边界检查、搬家 codemod、IPC 审计、验证脚本
```

依赖方向由 `tools/check-boundaries.mjs` 约束。它在 `pnpm test` 中运行；分层、禁用模块、直接访问桥接、跨功能依赖、循环、不可达文件、超长文件中任一类数量超过 `tools/boundaries-baseline.json` 时测试失败。Electron 专属 API 只能放在 `apps/desktop`；`protocol`、`client`、`chat-core` 不依赖 Node 和 React，以便 Web 或手机端外壳复用。

```sh
pnpm typecheck          # 渲染层 + 主进程类型检查
pnpm check:boundaries   # 对照基线检查模块边界
pnpm verify:e2e         # 真实 Electron 走查，使用本地夹具（需先 pnpm build:electron；Linux 需 xvfb）
```

## 功能与本地验证

模型按提供商与模型组成的完整身份选择，支持按实际模型能力调整思考等级；会话切换和恢复读取引擎的真实模型状态。Pi 扩展的 input/select/confirm/editor 使用桌面表单，队列使用 Pi 的 steering/follow-up，支持空闲时分叉会话。自定义 TUI 组件不受支持。

附件仅来自原生文件选择或真实 File 拖放授权：图片验证魔数、实际解码和文件身份，限制单图 10 MiB、总量 20 MiB、最多 8 个；UTF-8 文本单份最多 256 KiB。扩展默认禁用，需用户主动添加路径并显式启用，未知项目扩展不会自动执行。项目协作、云端邀请和上传仍是暂缓能力。

```sh
pnpm audit:ipc
pnpm build:electron
pnpm test:electron-ui
# 打包后也可验证 ASAR 内真实主进程与界面：
pnpm test:electron-ui --main=release/mac-arm64/OpenBuddy.app/Contents/Resources/app.asar/dist-electron/main.js
```

覆盖矩阵写到 `release/contract-matrix.json`，区分静态调用、路由可达性和运行验证。功能脚本启动真实 Electron，通过临时 bootstrap 选独立 userData 并加载指定 main，以本地 HTTP fixture 验证模型选择、思考、提问、图片、队列和分叉，不使用用户凭据；这不是安装、公证或 Gatekeeper 验收。`--native-dialogs` 需要操作者确认真实原生对话框。真实 `.app` 可执行文件另用 `OPENBUDDY_SMOKE_TEST=1` 启动并自动退出，截图和日志会标出临时目录。

## MVP 边界与发布状态

专家/市场、自动化、连接器 CLI、插件、云存储、团队/子代理、计划模式、rewind 暂缓。不可用命令返回明确的 `not_implemented` 错误。Electron 版安装包和内存占用会高于旧 Rust 外壳。

打包配置包含 hardened runtime entitlement 与 Pi 资源。当前 CI 只生成未签名的审核产物，不自动创建发布。macOS 签名/公证、Windows 签名需要单独配置凭据并实际安装验证；本文不声称公证、签名、跨平台安装或付费模型对话已经成功。

迁移说明见 [CHANGELOG.md](CHANGELOG.md)，发布前检查见 [TODO.md](TODO.md)。历史日志保留旧版本信息。

## 许可证

MIT，见 [LICENSE](LICENSE)。
