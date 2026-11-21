# 功能状态总表（唯一事实来源）

> 本文是 OpenBuddy 功能可用性的**唯一事实来源**。README、用户手册、更新说明若与本文冲突，以本文为准。

## 为什么需要这张表

OpenBuddy 的渲染层不硬编码功能开关。启动时它会调用 `host_capabilities`，询问当前连接的主进程支持哪些命令和事件；界面只展示宿主真的能服务的入口（见 `apps/web/src/app/state/capabilities-store.ts`）。

因此，"可用" 有两层含义：

1. **代码已实现**：命令在 `packages/protocol/src/commands.ts` 中注册，界面与宿主处理均已落地。
2. **当前构建可验证**：在真实 Electron 构建中跑通，并有截图 / 契约矩阵作为证据。

浏览器预览（`pnpm dev`）没有宿主能力，绝大多数入口会隐藏——这是设计如此，不是故障。

## 状态定义

| 状态 | 含义 |
| :--- | :--- |
| 可用 | 命令已注册，真实 Electron 走查有证据 |
| 条件可用 | 依赖外部条件（宿主命令、网关、模型能力、手动配置） |
| 部分可用 | 主体可用，子能力仍缺 |
| 暂缓 | 有明确 `not_implemented` 错误，或尚未接线 |
| 未验证 | 代码存在，但尚无公开可复跑证据 |

## 能力矩阵

| 能力 | 状态 | 证据 / 依赖 |
| :--- | :--- | :--- |
| 对话、流式输出、Markdown / 表格 / 代码块 | 可用 | E2E `02-chat-markdown.png` |
| 会话列表、恢复、分叉、重试、压缩 | 可用 | `08`、`11`–`13`、`20`–`21` |
| 工具审批与分级授权（本次 / 会话 / 始终 / 拒绝） | 可用 | `03-approval.png`、`56`、`62` |
| 受保护路径强制拒绝 | 可用 | `packages/kernel` 参数校验，E2E `56` |
| 模型服务商、BYOK、本地模型 | 可用 | `07-settings-model.png`、`77-local-model.png` |
| 思考档位随模型能力变化 | 可用 | E2E `21-mode-restored.png` |
| 产物工作台、文件预览、检查点与还原 | 可用 | `05`、`11`–`13` |
| 专家、专家包导入、团队 / 子会话 | 条件可用 | 依赖 `agents_*` / `experts_*` 命令；`28`–`36b` |
| 技能与指令、能力包逐项开关 | 条件可用 | 依赖 `skills_*` / `prompts_*`；`23`、`25*` |
| 连接器与 MCP 配置、OAuth 授权尝试 | 部分可用 | 目录 / 配置 / 尝试可用；CLI 登录暂缓，`66-mcp-deferred.png` |
| 自动化（日/周/月/小时 + 文件触发、修订号、重试） | 条件可用 | `43`–`55` |
| 办公产物 `ob_docx` / `ob_xlsx` / `ob_pptx` | 已验证 | `36c-office-xlsx.png` |
| 手机接入与配对管理 | 条件可用 | 需自配网关地址与令牌；`apps/mobile` |
| 会话 JSONL 导入导出、全量备份恢复 | 可用 | `docs/user-guide.md` §6 |
| 诊断报告（本机生成、脱敏、不上传） | 可用 | `58-diagnostics.png` |
| 自定义 TUI 组件 | 暂缓 | SDK 能力未接入桌面 |
| 云存储、团队云协作、邀请与上传 | 暂缓 | 返回 `not_implemented` |
| 应用内静默自动更新 | 暂缓 | 只读取发布清单并打开下载页 |
| macOS 签名 / 公证、Windows 代码签名 | 未完成 | 需要独立凭据与真机验证 |
| Linux 安装包 | 不产出 | 仅在 CI 跑验证 |

证据截图位于 `docs/plan/shots-20261121-*/`，精选集位于 `docs/screenshots/`；运行验证记录见 `release/contract-matrix.json`（构建后生成）。

## 如何自己核实

```sh
pnpm test              # 单元与边界检查
pnpm check:docs        # 文档链接与结构
pnpm audit:ipc         # IPC 契约审计
pnpm build:electron
pnpm test:electron-ui  # 真实 Electron 走查（本地 fixture，无用户凭据）
pnpm verify:e2e        # 截图回归
```

运行时可在设置 →「关于」查看宿主上报的能力；命令行场景可调用 `host_capabilities` 读取当前宿主的命令 / 事件集合。

## 版本口径

- `package.json` 中的 `1.0.0` 是版本号，**不代表已发布正式版**。
- CI 只产出未签名审核包；tag 构建会挂载 Release 产物，但签名、公证与跨平台安装验证仍需单独执行。
- `[CHANGELOG.md](../CHANGELOG.md)` 中的 v0.9–v0.15 是 Electron 迁移前的历史记录，其内核与当前分支不同。
