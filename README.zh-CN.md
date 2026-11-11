# OpenBuddy

OpenBuddy 正迁移为 Electron + Pi 的 React 桌面工作区。MVP 范围包括聊天、会话、工具、工作区文件、模型/BYOK、权限、MCP 配置、技能和通知。当前分支为迁移实现，package.json 的版本号不表示已经发布。

[English](README.md)

## 开发与构建

需要 Node.js >=22.19.0（建议 Node 24）与 pnpm 10.29.3。已向 npm registry 核实并精确固定 Electron 45.3.0、Pi SDK 1.5.2；内置 Node 版本以 Electron 二进制运行结果为准。

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

## MVP 边界与发布状态

专家/市场、自动化、连接器 CLI、插件、云存储、团队/子代理、计划模式、rewind 暂缓。不可用命令返回明确的 `not_implemented` 错误。Electron 版安装包和内存占用会高于旧 Rust 外壳。

打包配置包含 hardened runtime entitlement 与 Pi 资源。当前 CI 只生成未签名的审核产物，不自动创建发布。macOS 签名/公证、Windows 签名需要单独配置凭据并实际安装验证；本文不声称公证、签名、跨平台安装或付费模型对话已经成功。

迁移说明见 [CHANGELOG.md](CHANGELOG.md)，发布前检查见 [TODO.md](TODO.md)。历史日志保留旧版本信息。

## 许可证

MIT，见 [LICENSE](LICENSE)。
