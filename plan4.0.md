# OpenBuddy 五期：细节问题清单与 UI 交互完善计划（Plan 4.0，v3 — Round 14 G1 PR 2 落地 + Round 15 全审计）

> 📅 2026-09-11 · 仓库 `louloulin/OpenBuddy` · 版本 `0.14.0` · 父任务 LUM-785
>
> 本文是 plan4.md 的下钻：不重复架构原则，只列出**实际阻碍 OpenBuddy 成为生产可用产品**的细节缺陷与对应的 UI 交互整改。
> 所有条目均给出 `path:line` 证据、可验证命令、可量化验收指标。已被 plan4/plan4.md 覆盖的架构级议题不在此处重复。
>
> **v2 增量**：基于 §1.8 的真实审计——`electron/main/agent/pi-bridge/index.ts` 注册 13 个 IPC 通道但 renderer 仅 1 个真实消费者（`parseSkillFrontmatter`）；追加 13 条整改项。
>
> **v3 增量（Round 14-15）**：
> - Round 14 完成 **G1 PR 2**——`apply-patch.ts` 引入 typed-tool.ts facade（257 LOC），**unsafe cast 8 → 0**，**runtime `String()` guard 6 → 0**。对应 §1.7（B1-B2 工具展示）的 Type.Object schema 与 TS 类型同源——加新字段 = 改一处 Type.Object；TS + JSON schema + validateParams 自动同步。
> - Round 15 全 pi-native 审计发现：pi 0.85.1 实际 **274 个 export**（v3.6 估 105 错估）；OpenBuddy 仅用 23 个 → **pi-native 复用度 8.4%**；**pi-bridge 14 通道仍仅 1 个有 renderer 消费者**（v2 估 13 错估）；**29 canonical pi 包 0 e2e**。详细见 §1.8 v3 增量 + plan4.1.md §9。

---

## 0. 一页摘要

OpenBuddy 已经到了"主链路闭环 + 测试基线 542 文件 / 5517 通过"的阶段，**距离生产可用还差最后一公里**：细节上的体验断裂、UI 与 Pi 事件语义不对齐、IPC 与 renderer 状态机不一致、可观测性缺失、错误恢复 UX 不闭环。

本计划按 **P0 必须修（阻塞产品）→ P1 体验升级 → P2 可观测与运营** 三档列出 60+ 条具体缺陷，每条都明确：

- **位置**：`file:line` 锚点
- **症状**：用户在什么场景下感知
- **修复方向**：具体到文件/函数/契约
- **验收命令**：可执行的 vitest / smoke / 人工 checklist

---

## 1. 细节问题清单（按主题分组）

### 1.1 Composer 与输入区（11 项）

| # | 位置 | 症状 | 修复方向 | 验收 |
|---|---|---|---|---|
| C1 | `packages/ui/openbuddy-ui-conversation/src/Composer.tsx`（1273 行）单文件承担 8 个子职责 | 重渲染范围广；`@` 引用与 `/` 命令搜索互相冲突；attachment chip 状态分散在 4 个 useState | 拆 `ComposerInput / SlashMenu / AttachmentTray / PermissionPicker / ModelPicker / VoiceButton / FollowUpQueue` 7 个 memo 子组件；统一走 `useComposerDraft()` reducer | 单测覆盖各子组件 reducer；UI 改一处不重渲染其余 |
| C2 | `Composer.tsx` 缺 `@` 模糊搜索的 fuzzy match | 用户输入 `@rea` 命中 `react` 时无相关度排序 | 引入 `fuse.js` 或自实现 `scoreByPrefix+tokenize` | vitest snapshot 5 用例 |
| C3 | `/` 命令面板缺少分类与最近使用排序 | 长 list 中常用命令难找 | 按 `slashCommandRegistry` 分类（builtin/extension/skill），置顶最近 3 个 | 手动 checklist |
| C4 | 输入区缺 `draftId` / `revision` 标识 | 流式中断时无法恢复草稿 | 每条 draft 生成 `draftId`（uuid v7），IPC 携带，恢复时按 `sessionId+draftId` 命中 | vitest + Playwright |
| C5 | 引用文件 `@` 缺权限预检 | 引用 `/etc/passwd` 时直接发送，等 Pi tool 执行才报错 | Composer 发送前调 `folderTrust.canReference(path)`，引用不可信路径变红 + tooltip | vitest + UI 测试 |
| C6 | 模型选择器无 `provider/model/tier` 三层维度 | 用户不知当前模型实际归属 | 改成 `Provider（图标）→ ModelFamily（族）→ Tier（quality/balanced/economy）` 三段式 | 手动 checklist |
| C7 | 权限模式（auto / on-request / folder-only）切换没有当前会话的覆盖说明 | 用户切到 `folder-only` 不清楚"本会话永久 vs 一次性" | 弹一个一次性解释 Modal + `applyTo: this-session \| all-sessions` | UI 测试 |
| C8 | 停止按钮（stop）有 bug：流式未达首个 token 时点 stop 不生效 | 测试覆盖不全 | `AbortController` 在 `MessageUpdate` 之前也可终止；UI 显示"已请求停止"中间态 | vitest mock + Playwright |
| C9 | 附件上传不支持 `paste image` 的二进制流 | 截图后粘贴只能贴文字 | 接 `clipboard.readImage()` + `electron/webContents.paste` IPC → renderer 走 `attachment.upload()` | e2e 测 |
| C10 | 发送按钮与键盘 Enter 行为不统一 | Enter 发送，Shift+Enter 换行；但 IME 组合中也会发出去 | 监听 `compositionstart/end`，组合中 Enter 不触发 | vitest |
| C11 | Composer 缺 `voice` 录音可视化 | 录音时无波形/时长反馈 | 接入 `MediaRecorder` + canvas waveform，30fps 节流 | 手动 checklist |

### 1.2 ChatView 与消息流（9 项）

| # | 位置 | 症状 | 修复方向 | 验收 |
|---|---|---|---|---|
| M1 | `ChatView.tsx`（1167 行）订阅 `useSubagentStore` 导致整段重渲染 | 切到子任务时主会话所有消息都重渲 | 用 selector 拆分 store：`useSessionMessages(sid)` + `useSubagents(sid)`；`React.memo` MessageItem | vitest + profiler 前后帧数对比 |
| M2 | 文本流式 `MessageUpdate` 不增量 patch | 每个 delta 重渲整条 message | `useMessageBuffer()` 维护 `text + committedLen`，仅渲染 `[committedLen, text.length)` 区间 | vitest 渲染次数 |
| M3 | `ToolCallCard` 折叠后无摘要信息 | 折叠看不到 tool 名称、耗时、状态 | collapsed header 显示 `toolName · 1234ms · ✓/✗/…` | UI 测试 |
| M4 | `PlanBanner` 没有 inline-diff 高亮 | plan 变更看不出哪些 step 改了 | 引入 `diff-match-patch`，新增 step 黄底、删除红线、修改蓝底 | UI snapshot |
| M5 | `MessageItem` 缺 `resend` / `edit` 操作 | 用户发现错误后无法改写上一条 | 工具栏加 `✏ edit / 🔁 resend / 📋 copy-id`；edit 走 diff 提交 | Playwright e2e |
| M6 | 流式中断时无"已接收多少 token"提示 | 用户不知道等多久 | 显示 "已接收 ~3,200 tokens · 流速 ~45 tok/s" 实时更新 | UI 测试 |
| M7 | `tool_execution_end` 结果超大时被截断无原文入口 | 工具结果 >1MB 后只看到省略号 | 加 `▸ 展开原文` 折叠，展开后走 `readArtifact(artifactId)` 单独拉 | vitest + 手动 |
| M8 | 思考（thinking）块和正文混在一起，无法隐藏 | 长 thinking 占屏 | 加 `🧠` toggle 折叠 thinking；默认展开可全局关闭 | UI 测试 |
| M9 | 用户消息缺 Markdown 渲染（富文本引用 / 代码块 / 表格） | 用户输入代码块显示为纯文本 | 接入与 assistant 一致的 markdown 渲染管线（含 sanitize） | snapshot |

### 1.3 Sidebar 与会话组织（8 项）

| # | 位置 | 症状 | 修复方向 | 验收 |
|---|---|---|---|---|
| S1 | `packages/ui/openbuddy-ui-sidebar/src/Sidebar.tsx`（1641 行）单文件 | 拖拽/归档/置顶逻辑混在视图组件 | 拆 `SidebarTree / PinnedSection / ActivityPanel / SearchBox` 4 子组件 | 单测 + 手动 |
| S2 | 任务分类侧栏只二段（探索/规划），缺 WorkBuddy 三段"探索/规划/执行" | 不符合 WorkBuddy 习惯 | 加 `executing` 段；状态由 task state machine 投影 | 手动 checklist |
| S3 | 会话拖拽排序无 undo | 用户误拖无法回退 | 操作进入 `sidebar.command-history`，Cmd+Z 撤销最近 10 步 | vitest + UI |
| S4 | 置顶（pin）会话只能 pin 整个会话，无法 pin 单条 message | 找不到重要产出 | 引入 `pinnedMessage` 概念，pin 后在会话头显示快速跳转 | 手动 |
| S5 | 会话搜索只匹配标题，不匹配内容 | 用户搜不到历史里的关键词 | 加 `session.fulltext` SQLite FTS5 索引；结果按相关性排序 | vitest + 手动 |
| S6 | Space（工作空间）切换会重置当前 session 选择 | 工作流被打断 | 保留每个 space 的"上次会话"记忆，下次进 space 自动恢复 | 手动 |
| S7 | 侧栏无键盘导航（↑↓/Enter/Esc） | 无障碍评分低 | 加 ARIA `role="tree"`，监听键盘事件 | axe-core a11y 测试 |
| S8 | 会话列表项的状态图标（running/done/failed/queued）只有颜色，没有形状区分 | 色弱用户不可分辨 | 加形态编码：●/◐/◌/✓/✗ | UI 测试 |

### 1.4 工具与权限 UX（7 项）

| # | 位置 | 症状 | 修复方向 | 验收 |
|---|---|---|---|---|
| T1 | `ToolCallCard` 缺"批准前预览" | shell 工具直接执行，用户来不及反应 | bash 类工具先弹"将执行: `rm -rf build/`，批准/拒绝/编辑" 模态 | Playwright e2e |
| T2 | `apply-patch.ts` 自实现，没用 Pi 的 `createEditTool` | 与 Pi 升级解耦差 | 接入 `createEditTool` 并设 OpenBuddy `folderTrust` adapter；diff 渲染统一走 `generateDiffString` | unit + e2e |
| T3 | 工具执行超时（>30s）无用户提示 | 用户以为卡死 | 30s 后显示 "工具运行中…可强制取消" + 取消按钮 | UI 测试 |
| T4 | 权限弹窗被多次触发时只显示最后一个 | 早期弹窗被覆盖 | 改用 `permission.queue`，按 FIFO 排队，每次展示一条 | vitest |
| T5 | 文件夹信任（folder trust）UI 缺失入口 | 用户不知当前工作空间是否已信任 | Settings 加"工作空间与信任"页：列出所有最近工作空间 + 状态 | UI 测试 |
| T6 | 工具结果中二进制（图片、PDF 截屏）显示为乱码 | 用户看到 base64 文字 | 检测 mime，预览走 `attachment.preview(mime)` → 缩略图 | 手动 |
| T7 | `ToolCallCard` 失败重试无指数退避提示 | 用户点 retry 立即失败再点 | 显示 "下次重试 2s 后 / 5s 后 / 10s 后" | UI 测试 |

### 1.5 状态、可恢复与生命周期（10 项）

| # | 位置 | 症状 | 修复方向 | 验收 |
|---|---|---|---|---|
| L1 | `before-quit` 检测 active task 但缺少"后台继续运行"选项 | 用户必须选择等/取消 | 加三选一 Modal："等待完成 / 后台继续（关闭后通知） / 强制取消" | Playwright e2e |
| L2 | 插件（plugin）reload 时旧 extension handler 未失效 | 切到新版 extension 旧 UI request 仍响应 | Pi `AgentSession.reload()` 后旧 `extensionContext` 标记 stale；UI bridge 拒绝 stale handler | vitest + 真实 smoke |
| L3 | 任务（task）恢复时无 "上次停在 X step" 提示 | 用户不知下一步该做什么 | 恢复后 ChatView 头显示 `📌 上次停在 step 3 - 等待你确认 plan` | 手动 |
| L4 | `generation` token 没有暴露给 UI | UI 收到旧 session 事件会"穿越" | event envelope 加 `generation`；UI store 用 `useGenerationGate` 丢弃过期 | vitest |
| L5 | 网络断开后流式静默停止 | 用户以为模型卡死 | IPC 健康检测 + UI "网络断开，正在重连…" toast；恢复后自动续传 | Playwright 模拟 |
| L6 | Electron renderer reload 时 Composer 草稿丢失 | 测试模式必现 | renderer 用 `sessionStorage` 缓存 draft；reload 后恢复 | Playwright |
| L7 | `panic` / 致命错误未触发"安全关闭"流程 | 用户强退会丢任务 | main 监听到 unhandledException 走 graceful shutdown：stop sessions → flush events → exit | 手动 + smoke |
| L8 | 任务运行中系统休眠（sleep）唤醒后流中断 | 长会话实测触发 | main 监听 `powerMonitor.on('resume')`，主动恢复流 | smoke |
| L9 | 多任务并发无视觉分组 | 两个任务交错时 UI 混乱 | Sidebar 按 task 分组，ChatView 头部加 task 切换器 | 手动 |
| L10 | 关闭最后一个标签页（标签式 UI）会退出应用 | 用户想"关闭当前" | 加 "是/否" 二次确认；Cmd+W 行为可设置 | 手动 |

### 1.6 IPC、Renderer 与 Pi 事件桥接（8 项）

| # | 位置 | 症状 | 修复方向 | 验收 |
|---|---|---|---|---|
| I1 | `electron/main/ipc/` 47 个 handlers 散在 8 文件（TODO.md:52） | 难以审计与权限收紧 | 按 domain 分 `agentHandlers / sessionHandlers / capabilityHandlers / pluginHandlers`；统一 `registerHandler(channel, schema, fn)` 注册 | tsc + smoke |
| I2 | preload allowlist 有 `console.*` 等调试通道泄漏到生产 | 安全审查会卡 | 区分 `dev/preload.ts` 与 `prod/preload.ts`；prod 仅暴露业务 channel | audit script |
| I3 | `pi-event-bridge.ts` 把 `pi://*` 全部透传到 renderer，无采样/分通道 | 高频事件压垮 renderer | 分 `pi://update`（批处理）/ `pi://lifecycle`（顺序敏感）/ `pi://error`（立即）三通道；前两者 16ms 合并 | perf bench |
| I4 | `pi://update` payload 超大时 IPC 直接序列化失败 | 测试偶尔报 `IPC channel destroyed` | 单 payload >256KB 走 `artifact.preview(id)` 拉取；事件 envelope 仅引用 | vitest |
| I5 | renderer 收到 Pi 事件后无 `version`/`schema` 校验 | 新旧协议混跑会崩 | envelope 强制 `{ schemaVersion, ... }`；不匹配走降级渲染 | unit |
| I6 | `MessageChannelMain` port 已实现但渲染端未默认启用 | 性能优化无效 | renderer `subscribePiEvents({ transport: "auto" })` 默认 port + IPC fallback | smoke benchmark |
| I7 | `cancel` 信号无统一传播 | 任务取消与流停止各做各的 | 引入 `GenerationGate` 统一管理 `abort/cancel/dispose`；每个长任务挂一个 child gate | unit + e2e |
| I8 | `electron/main/agent/agent-host.ts` facade 104 个字段（与 plan4.md:25 一致） | 调用方无法知道哪些稳定 | facade 拆 `agentHost.session / agentHost.runtime / agentHost.capabilities / agentHost.lifecycle / agentHost.observability` 5 个子命名空间 | tsc + 测试 |

### 1.7 设置与可观测性（7 项）

| # | 位置 | 症状 | 修复方向 | 验收 |
|---|---|---|---|---|
| O1 | Settings 缺"插件与扩展"专属页 | 用户找不着 disable 一个 extension 的位置 | Settings 加 Plugins 页：列表 + 启用/禁用/版本/权限/来源/日志 | UI 测试 |
| O2 | Settings 缺"诊断与支持"页 | 出问题无 self-serve | 加 Diagnostic 页：日志、错误统计、版本、build、复制支持包按钮 | UI 测试 |
| O3 | 缺 "OpenBuddy ↔ Pi 同步状态" 视图 | 用户不知当前是 fallback 还是真链路 | Settings 加 status row：`Agent: Pi 0.85.1 · Bridge: in-process · Generation: 17` | 手动 |
| O4 | 缺 `metrics` 视图（任务数 / 平均时长 / 工具调用成功率） | 用户看不到产品价值 | 简易 Dashboard：累计任务数、今日任务、Top 3 工具、模型用量分布 | UI 测试 |
| O5 | `agent-host-log.ts` 写文件但无 UI 入口 | 用户看不到日志 | "Diagnostic" 页加 `▸ View logs` 折叠面板 + 按等级过滤 | UI 测试 |
| O6 | 设置搜索（command palette）覆盖度低 | 用户找一项要翻 12 个 section | 加 `Cmd+,` 弹搜索；按 token + tag 命中 | UI 测试 |
| O7 | 模型 credit / 用量无显示 | 用户不知花了多少 | Settings → Usage 页：今日/本周/累计 token、cost（按 provider/model 拆） | UI 测试 |

**Round 14 G1 PR 2 落地后 §1.7 新增 demo 项目**（typed-tool.ts facade 让"加新字段"成 1 处改动）：
- **O8** Settings → Tools 页新增 `apply_patch` / `apply_command` schema viewer（从 typed-tool.ts 的 `Type.Object` 自动生成 UI）——加新字段 = 改一处 Type.Object；TS + JSON schema + validateParams + UI 字段表自动同步
- **O9** ToolCallCard 加 `validateParams` 错误展示（之前 `String(undefined) → NaN → 静默错`；现在 `invalid params: /count: Expected number`）——OpenBuddy 第一次**实时告诉用户 LLM 送错类型**

### 1.8 pi-bridge IPC 死代码与 renderer 自实现（13 项 — v2 审计新增；Round 15 ground-truth 修正为 14 项）

> **来源**：`grep -rEn "requirePiBridge|getPiBridge" src/` 实际只命中 2 个 import（`pi-bridge-client.ts` 自身 + `pi-client.ts:1457` 的 `parseSkillFrontmatter`），但 `electron/main/agent/pi-bridge/index.ts` 注册了 13 个 IPC 通道。

| # | 位置 | 症状 | 修复方向 | 验收 |
|---|---|---|---|---|
| B1 | `pi-bridge/index.ts:34-121` 注册 13 个 IPC 通道，**12 个无 renderer 调用者** | pi 的 truncateHead/Tail/Line、generateDiffString、generateUnifiedPatch、resizeImage、detectMime、convertToPng、loadSkills、loadSkillsFromDir、formatSkillsForPrompt、formatSize 等能力在 renderer 是死代码 | Renderer 全面接入 `requirePiBridge()`；删除 renderer 自实现对应物 | CI grep：`requirePiBridge` 调用点 ≥ 12 |
| B2 | `pi-bridge/text-utils.ts:77 formatSize` 已注册但 renderer 不调用 | 用户看到的"文件大小"全是手写 KB/MB 格式化 | ChatView 文件引用、ToolCallCard、附件列表走 `bridge.text.formatSize` | UI 测试 |
| B3 | `pi-bridge/text-utils.ts:30-36` truncateHead/Tail 已注册但 renderer 不调用 | 长文件预览没有按 token/byte 截断 | `@` 引用文件预览走 `bridge.text.truncateHead` + `truncateTail` | 单元 + Playwright |
| B4 | `pi-bridge/text-utils.ts:51-58 generateDiffString` 已注册但 renderer 不调用 | ToolCallCard diff 渲染用自实现 diff（与 pi 行为可能漂移） | 替换为 `bridge.text.generateDiff` | vitest snapshot |
| B5 | `pi-bridge/text-utils.ts:62-70 generateUnifiedPatch` 已注册但 renderer 不调用 | apply_patch UI 渲染可能与 pi 真实 patch 格式漂移 | 替换为 `bridge.text.generatePatch` | vitest snapshot |
| B6 | `pi-bridge/image-utils.ts` resize/detectMime/convertToPng 4 个通道均无 renderer 调用者 | 截图粘贴、附件预览、avatar 上传全是 openbuddy 自实现图像处理 | Composer attachment tray 走 `bridge.image.resize` + `detectMime`；convertToPng 用于 clipboard image | e2e |
| B7 | `pi-bridge/skill-utils.ts` load/loadFromDir/formatForPrompt 3 个通道均无 renderer 调用者 | 技能面板/自动补全走自实现 skills-catalog.ts（`packages/ui/openbuddy-ui-experts/src/data/skills-catalog.ts`） | 接入 `bridge.skills.loadSkills` + `formatSkillsForPrompt`；删除 skills-catalog.ts | vitest |
| B8 | `parseSkillFrontmatter` 在 `pi-client.ts:1457` 唯一消费 parseFrontmatter，但 stripFrontmatter 通道**完全无消费者** | plugin manifest 解析走 openbuddy 自实现（`plugin-sdk/src/manifest.ts`） | manifest.ts 切到 pi `parseFrontmatter/stripFrontmatter`；删除自定义 YAML parser | tsc + test |
| B9 | `src/lib/agent/pi-bridge-client.ts:1` 注释说"pi-coding-agent pulls in photon-node WASM and shell-quote transitive deps" — 但 renderer 通过 IPC 完整可用 | 渲染 bundle 没必要包含 pi；当前实现正确 | 保留 IPC 架构；只补消费者 | 文档对齐 |
| B10 | pi-bridge IPC 失败时 renderer 走 try/catch fallback 到 `{frontmatter: {}, body: raw}`（`pi-client.ts:1464`） | 用户看不到失败原因 | 失败计入 telemetry + UI toast "pi-bridge 不可用，使用内置解析" | manual |
| B11 | pi-bridge IPC 13 通道**没有版本字段** | OpenBuddy 升级时旧 renderer 拿到新 pi-bridge 可能行为漂移 | envelope 强制 `{ schemaVersion: 1, ... }`；不匹配走降级 | unit |
| B12 | pi-bridge-image 通道传输 `Uint8Array` 需要 IPC 序列化（`pi-bridge/index.ts:91-103` `Uint8Array.from(args.bytes)`） | 大图（>5MB）IPC 序列化慢 | 走 `MessageChannelMain` port 或 `transferList` | perf bench |
| B13 | pi-bridge IPC 没有 rate limit | 攻击/循环调用可能拖垮 main | `pi-bridge-gate.ts` 加 per-channel token bucket（参考 `express-rate-limit` 已依赖） | unit + smoke |

**Round 15 v3 修正**（v2 估"13"通道实为 14；`scripts/audit/pi-bridge-dead-channels.sh` 重跑确认）：
- **总通道数 13 → 14**：v2 数 `pi-bridge-text:generate-diff` 时漏了 `generate-patch`——grep `ipcMain.handle` 严格数 = 14
- **renderer 真实消费者 1 → 1**：`src/lib/agent/pi-client.ts:1460` 的 `parseSkillFrontmatter`（仍是唯一消费者）
- **死代码 12 → 13**（93% 死代码；GA gate ≥80% 利用率 = 不达标）
- **Round 10-14 没接 renderer → bridge 新通道**（typed-tool / resource-pi / theme-pi 全在 main 进程内闭环）
- **B8 现状**：`parsePluginManifestFromString` 已切到 pi `parseFrontmatter`（Round 10）；`stripFrontmatter` 通道仍 0 consumer

**Round 16+ 解锁 B1-B7 的最优顺序**（按 plan4.1.md §9.4）：
- Round 20 → B4-B5（diff / patch）：renderer 接 `bridge.text.generate-diff` + `bridge.text.generate-patch` 进 ToolCallCard / DiffView / apply_patch preview
- Round 21 → B6（image）：renderer 接 `bridge.image.resize` + `bridge.image.detect-mime` 进 attachment/upload.ts

### 1.9 国际化、可访问性、性能（5 项）

| # | 位置 | 症状 | 修复方向 | 验收 |
|---|---|---|---|---|
| A1 | i18n 仅 EN/中；缺日/韩（TODO.md:45） | 日韩用户流失 | 完成 `packages/ui/openbuddy-ui-locale` 日/韩资源；CI 加 PR 翻译完整性检查 | vitest |
| A2 | 缺 ARIA `role` / `aria-label` 全量审查 | axe-core 报告 ≥ 20 个问题 | 全量补 role/label；CI 接 axe-core；目标 0 critical | axe-core |
| A3 | 缺键盘 shortcut 文档 | 新用户发现不了快捷键 | 加 `?` 弹 shortcut cheat sheet；文档同步 | 手动 |
| A4 | `ChatView` 流式期间 CPU 持续 30%+（profiler 实测） | 笔记本风扇狂转 | 引入 `requestAnimationFrame` 节流 + virtual list + 文本 `useDeferredValue` | profile before/after |
| A5 | 大会话（>500 turn）打开卡顿 | 老用户痛点 | session history 走分页 + virtual scroll；metadata 与 transcript 分离加载 | vitest 1000 turn benchmark |

---

## 2. UI 交互整改专题（4 项重点工程）

### 2.1 Composer v2 重构（接 plan4.md §6.2 Composer 协议）

**目标**：把 1273 行的 `Composer.tsx` 拆成可独立演进的产品组件，并把 "draft → envelope → 发送 → 流式 → 审批/重试/中断" 形成显式状态机。

```ts
// packages/ui/openbuddy-ui-conversation/src/composer/state.ts
type ComposerDraft = {
  draftId: string;          // uuid v7
  sessionId: string;
  revision: number;
  text: string;
  attachments: Attachment[];
  references: FileReference[];
  slashCommand: SlashCommandState | null;
  permissionMode: PermissionMode;
  permissionScope: 'this-session' | 'all-sessions';
  model: { provider: string; family: string; tier: Tier };
  voiceState: 'idle' | 'recording' | 'transcribing' | null;
};

type ComposerEvent =
  | { type: 'text-change'; delta: string }
  | { type: 'attach'; file: Attachment }
  | { type: 'detach'; id: string }
  | { type: 'slash-menu-select'; command: SlashCommand }
  | { type: 'permission-mode-change'; mode: PermissionMode }
  | { type: 'send' }
  | { type: 'stop' }
  | { type: 'abort' };
```

**拆分清单**：

- `ComposerInput.tsx` —— textarea + IME + draft binding
- `SlashMenu.tsx` —— `/` 命令面板（按分类与最近使用排序）
- `AttachmentTray.tsx` —— 附件 chips + 预览 + 拖拽
- `PermissionPicker.tsx` —— 权限模式切换 + 解释 Modal
- `ModelPicker.tsx` —— 三段式 Provider/Family/Tier
- `VoiceButton.tsx` —— 录音 + 波形
- `FollowUpQueue.tsx` —— steer / follow-up 队列
- `ComposerFooter.tsx` —— 发送 / 停止 / 上下文占用条

**验收**：

- `Composer.tsx` 主体 < 400 行
- 子组件各 ≤ 200 行
- 单测覆盖 reducer 状态转移 ≥ 30 用例
- Playwright e2e：发送 → 流式 → 中断 → 重发 全链路

### 2.2 任务工作台（左 Sidebar + 任务详情 + 右产物栏）

**目标**：把 WorkBuddy 三段式侧栏（探索/规划/执行）+ 任务详情主区 + 右栏产物/引用落地为可恢复视图。

```
┌─ Sidebar ──────────────┬─ TaskDetail ──────────────────┬─ RightRail ──────┐
│ ⏺ Running (n)          │ Task title · status pill       │ Artifacts (n)    │
│ 📅 Queued (n)           │ ─────────────────────────────  │ ───────────────  │
│ ✓ Recent (24h)          │ Composer (sticky bottom)        │ Citations (n)    │
│ 📁 Spaces (3)           │                                 │ ───────────────  │
│  · Personal             │                                 │ Activity         │
│  · Project Alpha        │ MessageList (virtual scroll)    │  • 12:34 tool    │
│  · Workspace Beta       │                                 │  • 12:35 tool    │
└─────────────────────────┴─────────────────────────────────┴──────────────────┘
```

**实现要点**：

- 左栏用 `role="tree"`，键盘导航完整
- 中间 `MessageList` virtual scroll（react-virtuoso）
- 右栏 `Artifacts/Citations` 走 useSelector，单独 store
- 任务状态徽章：颜色 + 形态 + tooltip 三重区分

### 2.3 权限与审批 UX（接 plan4.md §3 + §6.2）

**目标**：把 "信任工作空间 / 单次批准 / 编辑命令" 三类权限 UX 统一收口。

**3 类入口**：

1. **工作空间信任（一次性）**：首次打开 workspace 时弹一次性 Modal（"是否信任当前目录，所有工具执行需逐次确认"）。
2. **工具执行审批（每次）**：bash / write / edit 类工具执行前弹"将执行 …，批准/拒绝/编辑"。
3. **权限模式（持续）**：`auto` / `on-request` / `folder-only` 三档全局切换 + per-session override。

**审批 Modal 必含字段**：

- 工具名 + icon
- 完整入参（命令、文件路径、payload diff）
- 风险等级（low/medium/high 三色）
- 三按钮：✅ 一次 / ⏺ 本会话 / 🔁 总是

**验收**：

- 全部 3 类入口有 Playwright e2e
- 拒绝 / 超时 / 关闭窗口都有确定结果（plan4.md Phase 3 退出标准）
- 审批事件全部进入 audit

### 2.4 流式事件可视化与中断恢复（接 plan4.md §8）

**目标**：让用户对"模型正在做什么"始终有清晰感知，对"中断后恢复"有稳定预期。

**关键 UI**：

- **状态徽章**：🟢 ready / 🟡 streaming / 🟠 tool-running / ⚪ awaiting-approval / 🔴 error
- **流式指标**：实时更新 `~3,200 tokens · 45 tok/s`
- **思考块 toggle**：🧠 折叠 / 展开（默认展开）
- **工具进度**：tool 卡片显示 step-by-step（compact：start → progress → end）
- **中断恢复**：流断 5s 后显示"网络断开，正在重连"；恢复后从 lastSequence 续传

**验收**：

- Playwright 模拟网络断开 → 恢复 → 流继续
- vitest 验证 `useGenerationGate` 丢弃过期事件
- smoke benchmark：1MB 文本流式 CPU < 15%

---

## 3. 验收门槛（贯穿本计划）

| 维度 | 命令 | 必须 |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | EXIT 0 |
| 单元测试 | `pnpm workspace:test` | 全绿，vitest ≥ 600 文件 |
| E2E | `pnpm test:electron` + Playwright | 全绿，关键路径 ≥ 40 用例 |
| 可访问性 | `pnpm test:electron:a11y` (axe-core) | 0 critical |
| 性能 | `pnpm perf:ipc` + `pnpm perf:streaming` | 预算由同环境基线 ±10% |
| 构建 | `pnpm build` | 0 warning，bundle 不增 >5% |
| 文档 | `docs/UI_INTERACTIONS.md` | 新组件/新交互必更新 |

---

## 4. 分阶段执行（与 plan4.md / plan4.1.md 对齐）

| 阶段 | 内容 | 期数 | 依赖 |
|---|---|---|---|
| U0 | 基线锁定 + 自动 a11y/perf 门 | 0.5 期 | — |
| U1 | Composer v2 拆分 + reducer | 1 期 | plan4 Phase 1.1 |
| U2 | 任务工作台（左 + 中 + 右） | 2 期 | plan4 Phase 4.1 |
| U3 | 权限审批 UX（3 类入口） | 1.5 期 | plan4 Phase 3 |
| U4 | 流式可视化与中断恢复 | 1 期 | plan4 Phase 5 |
| U5 | Settings 6 项（Plugins/Diag/Usage 等） | 1 期 | plan4 Phase 6 |
| U6 | i18n 日/韩 + axe-core 全量 | 1 期 | — |

总计 **8 期**，可与 plan4.1.md 的 pi-native 阶段并行（不同 owner / 不同文件）。

---

## 5. 结论

OpenBuddy 的"五期产品力"主要不来自新功能，而来自**把已有能力做到用户在 30 秒内就能感知到**。本计划列出的 60+ 条细节缺陷，每一条都对应"用户卡在哪里 5 秒以上"。修完这 8 期，OpenBuddy 在不引入新框架、新架构的前提下即可达到 WorkBuddy 同级的体验底线。

与 plan4.1.md（pi-native 深度整合）配合：plan4.0 是 UX 视角的最后一公里，plan4.1 是引擎视角的最后一公里；两者并列推进，互不阻塞。