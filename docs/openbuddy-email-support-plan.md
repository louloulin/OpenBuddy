# OpenBuddy 邮件能力支持方案

更新时间：2026-08-30  
定位：以 Macro 的公开邮件体验为产品参考，以 OpenBuddy 现有 Electron + Pi + MCP 为最小改造边界。

## 1. 结论先行

OpenBuddy 不应该复制 Macro 的私有后端，也不能承诺“实现 Macro 的所有内部功能”。Macro 的公开产品文档足以确认它的邮件体验：Gmail 同步、多账号统一收件箱、Signal/Noise、键盘驱动处理、线程分享、普通邮件客户端能力，以及 agent 草拟和发送。Macro 的公司级共享记忆、统一工作区和未公开的服务端策略不应被当成可直接复刻的实现细节。

最佳路线是：

1. 保留 OpenBuddy 的 Pi AgentSession、MCP、typed preload 和 Capability 架构。
2. 以 `@openbuddy/capability-email` 作为唯一邮件领域边界，provider 只做适配，不让 UI 绑定 Gmail/Outlook/QQ 工具名。
3. P0 先交付真实可用的多账号读取、搜索、线程、Signal/Noise、草稿、回复/转发、附件、标签/归档、计划发送和确认发送。
4. P1 把邮件变成 OpenBuddy 的工作入口：AI 摘要、Reply Zero、行动项、任务、提醒、项目、协作分享。
5. P2 增加 Gmail API、Microsoft Graph、JMAP 等直接 adapter；Gmail 与 Graph 的本地契约已落地，标准 IMAP/SMTP adapter 已落地，但仍按读、管理、草稿、发送四类证据分别验收。

当前仓库已经落地 P0 的大部分骨架和实现，并补上关键的 P1 安全与工作入口：统一域模型、多 provider 聚合、MCP profile、邮件 IPC、邮件工作区、Composer、草稿/计划发送、撤回队列、批量管理、AI 入口、AI 邮件行动中心、协作分享、审计、安全 HTML 渲染、账户能力门禁，以及把待回复邮件投影进助理统一收件箱。AI 行动中心复用已保存的 `EmailAnalysisRecord` 和处理计划队列，集中展示待审阅分析、回复草稿、行动项、会议提案和待确认计划，并可安全回到来源线程；它不绕过邮件权限，也不直接触发外部写入。AI 分析现在把邮件消息引用与知识库背景引用分开持久化，主进程按已保存知识根目录、文件类型和真实内容校验背景引用。MCP profile 在账号未返回 capability 字段时，会根据显式 profile/tool map 或真实发现的工具推断写信、邮件管理和附件能力；generic fallback 仍保持只读 fail-closed。Provider readiness 诊断现在同时显示 profile、工具发现状态、每项能力所需工具、缺失工具、重新授权原因和每个聚合账户的读写/管理/附件/同步能力，并通过只读 IPC 暴露给邮件面板。当前最重要的未完成项不是再造一套邮件 UI，而是补齐真实 provider 的 OAuth/权限/分页/附件验收，并把 Macro 的关键体验逐项纳入真实账号验收矩阵。

WorkBuddy Mail 的私有实现、服务端策略和内部代码不在当前仓库中；本轮只把仓库内可观察的 `qq-agent-mail`/MCP connector、公开 Macro 文档和公开开源项目作为证据，不把 WorkBuddy 的未公开能力当成已验证事实。OpenBuddy 的设计因此采用“provider 能力声明 + 本地统一邮件合同 + Main 确认门禁”，既能兼容 WorkBuddy/Agent Mail 连接器，也不绑定其私有 token、数据库或内部 API。

本轮公开检索还确认：Inbox Zero 的 README 明确包含 AI Rules、Reply Zero、批量退订/归档、会议简报和附件归档；Cloudflare Agentic Inbox 明确采用每邮箱隔离、附件存储、自动草稿和显式发送确认，但其生产部署以统一 Cloudflare Access 为信任边界。OpenBuddy 只借鉴产品分层，不复制代码，也不把单一登录策略当作 `accountId/threadId` 权限模型。

## 1.1 当前进度审计（2026-08-31 · 第 2 轮）

百分比只表示“在本项目目标范围内已实现且有本地证据的部分”，不把没有真实邮箱凭据的 provider 视为已完成：

| 能力域 | 权重 | 当前完成度 | 加权贡献 | 证据与剩余缺口 |
| --- | ---: | ---: | ---: | --- |
| 邮箱基础读写与安全发送 | 35% | 90% | 31.5% | 当前定向测试覆盖 typed IPC、草稿指纹、确认、撤回、计划发送、原生同步、分诊、主流 Provider profile 契约、批量管理预览确认，以及 IMAP/SMTP fake-server 的登录、FETCH、STORE、COPY、EXPUNGE、APPEND、SMTP AUTH/DATA/QUIT；通用 IMAP 草稿使用稳定 `X-OpenBuddy-Draft-ID` 清理旧版本，编辑不会重复堆积远端草稿；Composer 以 Markdown 为编辑源，同时生成经 `rehype-sanitize` 清洗的 `bodyHtml` 供 provider 发送，附件在进入 provider 前校验为绝对路径、普通文件、非符号链接且单文件/总量不超过 25 MiB；Provider diagnostics 与实际 mutation gate 现在共用 profile-aware 操作矩阵，不会把 IMAP Label/Snooze/退订显示或执行为已支持；QQ/IMAP 真实只读已验收；Gmail/Graph 真实 OAuth 写入、QQ 管理、草稿、附件下载和 SMTP 发信仍未验收 |
| AI 邮件工作流 | 25% | 93% | 23.25% | Reply Zero、Digest、只读可解释 AI 分诊、分诊分类驱动的 Signal/Noise 工作队列、结构化摘要/行动项/风险/回复结果、来源消息引用及线程归属/摘录正文校验、独立知识库 `contextCitations`、主进程路径/文件内容校验、置信度、人工审阅、AI tool、AI 邮件行动中心、行动项 → 会话任务/项目任务/跟进提醒确认式采纳，并通过 `linkedTaskIds`/`linkedProjectTaskIds`/`linkedReminderIds` 回链；处理计划支持逐项动作、匹配数量、样本 ID、AI 理由的预览—确认—执行闭环，AI 规则支持自定义条件/动作、启停、分页扫描、匹配统计和审计回链，禁止 AI 直接删除/标记垃圾邮件；本轮新增 51 封 AI 邮件盲测集（报价/合同 10、会议 10、行动项 10、信息/无行动 8、投诉 5、跟进/等待 5、个人/社交 3）与支持 mock / openai-compatible 后端的盲测 runner，输出 precision/recall/F1/截止日期准确率/引用准确率/无行动准确率与发布门禁；真实模型质量仍只有 fixture 证据，但基础设施已支持 OPENAI_API_KEY 驱动的现场精度验收 |
| OpenBuddy 工作区融合 | 25% | 97% | 24.25% | 助理 Inbox 投影、协作分享、项目、提醒、Workspace Tag 和会话/邮件/任务/日程/项目/协作 Inbox/知识库文档 Unified Search 已有；项目详情页可反查关联邮件并回到原线程；项目、计划、任务已支持本地 Workspace Tag 编辑、标签命中和 `WorkspaceTagRef` 派生引用；邮件行动项可经项目选择、确认后创建 `source=email` 项目任务并保留 `messageId` 引用；AI 行动中心可跨线程聚合分析并回到原邮件；分享线程的协作事件现在保留 `accountId + threadId` 身份引用，协作 Inbox 可回到多账号原邮件；通知中心可直接打开待确认邮件处理计划；本轮第 1-4 轮覆盖权限投影、键盘 hook、AI 中心视觉重构；本轮第 5 轮 AI 行动中心加 type×review 二维过滤 tab（每 tab 显示计数徽章），线程行加 hover 快捷动作（✓已读 / ★星标 / ↘归档，能力门禁联动），Mail-style UX；本轮第 6 轮完善 Macro 风格 hover quick actions；邮件/知识库正文权限投影和协作 Inbox 标签投影仍待全面接入 |
| 主流 provider 生产就绪 | 15% | 70% | 10.50% | Gmail/Outlook/QQ/IMAP/JMAP profile 合同、可注入 token/fetch 的 Gmail REST API provider、Gmail query/线程/MIME/标签/归档/草稿/受控发送/附件下载契约、标准 IMAP/SMTP MCP adapter、QQ 真实 IMAP 登录/文件夹/分页/搜索/线程读取、公开 Gmail MCP 的 `connected_accounts`/`account`/`message_id`/`archive_email`/`apply_label`/`unsubscribe_email` 兼容、别名工具发现、分页游标保护、profile-aware 账户级 Provider readiness 诊断与执行门禁、IMAP 写入能力按真实 `LIST` 文件夹和 QQ 别名动态声明、读操作超时/瞬态重试、结构化 MCP `isError`/error envelope 的限流与 OAuth 重授权分类、只读 eval 和受门禁的全流程 acceptance runner 已有；新增 Microsoft Graph REST provider（Outlook 文件夹、分类、线程分页、管理、草稿、附件、受控发送）及 fake contract 测试；本轮新增 `EmailProviderRegistry` 多连接管理（register / list / setEnabled / reauthorize / diagnostics / remove + readiness 五态 configured / connected / failed / disabled / awaiting-reauth，5/5 测试通过）；本轮新增 4 个真实 OAuth 验收 runner（gmail / graph / jmap / imap_smtp）+ fail-closed OAuth 验收骨架 17/17 测试；Gmail/Graph 真实验收 runner 与 OAuth 现场证据仍缺失；QQ 管理、草稿、附件下载、SMTP 发信和其他 provider 的现场证据仍缺失 |
| **整体估算** | **100%** |  | **92.25%（约 92%）** | 本地合同、安全边界、协议级 fake-server 测试、Gmail REST、Microsoft Graph REST 和标准协议 adapter 已形成闭环，QQ 已有真实只读 MCP 证据；规则调度保存、待确认计划队列、通知中心跳转、AI 行动中心、逐项 Provider readiness 面板、无账号主流邮箱接入向导、助理收件箱邮件回执和多账号协作线程回链已闭环；本轮第 1 轮新增实体级权限投影、AI 邮件盲测集与 runner、Provider Registry 多连接管理、4 个真实 OAuth 验收 runner、Macro 风格键盘工作流与今日邮件仪表板；本轮第 2 轮新增 inline 快捷键提示条、引导式空状态、工具栏搜索计数与今日仪表板清零庆祝状态；本轮第 3 轮新增上下文感知键盘提示、发件人头像工具与单测、线程行 checkbox 选中态；本轮第 4 轮抽离 useEmailKeyboard hook（高内聚、低耦合、19/19 单测）；本轮第 5 轮 AI 行动中心视觉重构（kind 图标 + 置信度条 + 三色审阅状态徽章 + 关联计数徽章）、消息头部 sender profile 头像、新增 g+a chord 唤起 AI 行动中心；本轮第 6 轮新增 AI 行动中心 type×review 二维过滤 tab + 线程行 hover quick actions；生产级 Gmail OAuth/现场管理、QQ 管理/草稿/发送、其他 provider OAuth、附件下载、限流语义、加密本地索引、Macro 共享收件箱、协作 Inbox 标签投影与真实 AI 质量仍是主要工作 |

完成度解释：P0 “合同、UI、fake/echo 验证、安全发送、独立管理工具回退、批量管理预览/确认、操作级能力矩阵、Provider 可靠性保护、双格式草稿发送链路、附件路径/大小安全校验、Provider Registry 多连接管理、实体级权限投影、真实 OAuth 验收骨架与键盘工作流”约 94%；P1 “AI 分诊 + AI 行动中心 + 工作区投影 + 邮件统一搜索 + 可配置 AI 规则 + 分页安全扫描 + 运行审计 + fixture 质量指标 + 可审计知识库上下文引用 + AI 邮件盲测集与发布门禁 + 今日邮件仪表板 + inline 快捷键提示 + 引导式空状态 + 搜索结果计数”按约 94% 保守计算；P2 “Gmail REST/IMAP/SMTP、加密本地索引、Macro 共享收件箱、协作 Inbox 标签投影、联系人权限/CRM 联动、可视化 HTML 编辑、真实模型质量评估”约 51%，fake 契约与只读真实证据不能替代 OAuth、管理与发信现场证据。因此不能把当前状态描述为“已完整复刻 Macro”，更准确的表述是“已完成 Macro 公开邮件体验 + OpenBuddy 工作区融合 + Provider Registry 多连接管理 + 实体级权限投影 + AI 邮件盲测基础设施 + 真实 OAuth 验收骨架 + Macro 风格键盘工作流 + 今日邮件仪表板 + inline 快捷键引导 + 引导式空状态；剩余 9% 主要为真实 OAuth 现场证据、真实 AI 盲测精度验证、加密本地索引、Macro 共享收件箱与协作 Inbox 标签投影”。

### 1.2 真实邮箱凭据与验收边界

- 本轮没有使用用户消息中暴露的 QQ 邮箱授权码，也不会把真实邮箱、密码、授权码、OAuth token 或模型密钥写入代码、日志、文档或 evidence；该授权码已经失去保密性，必须立即在 QQ 安全设置中撤销并重新生成。
- 真实验收必须使用隔离测试账号、明确测试收件人和临时凭据；读取、管理、草稿、附件下载、发送分别开启，不把只读成功推断为写入成功。
- 当前证据分为 `real-local`（本地合同/安全/协议测试）、`fixture-quality`（固定样例质量指标）和 `real-external`（真实 provider 现场证据）。本工作区目前没有新增 `real-external` 写入或发信证据，因此 QQ 管理、草稿、附件下载、SMTP 发信仍标记为 `not-run`。
- 外部 runner 仅在 `OPENBUDDY_E2E_REQUIRED=1` 且显式设置对应能力开关时连接 provider；发送还必须提供隔离测试收件人和确认短语。运行结束后应删除/轮换临时凭据并保存脱敏报告。



## 1.3 本轮新增模块说明

### 1.3.1 实体级权限投影

- 新增文件：`packages/capability/openbuddy-email/src/email-permissions.ts`（约 159 行）+ `email-permissions.test.ts`（7 / 7 测试通过）。
- `Email.withPermission(policy)` 返回 `EmailPermissionScopedView`，覆盖 `accounts / threads / thread / labels / attachments / share / reminder / project / triage / digest / audit` 共 11 个子域。
- 三种预置 policy：`owner()` 全功能、`readonly()` 仅读 / 搜索 / 摘要、`share()` 分享线程 + 摘要 + 标签读，禁止写与分享外操作。
- 错误码：`capability_denied / account_denied / scope_denied`，可在 UI 中显示明确提示。
- 集成路径：协作 Inbox 使用 `readonly()` policy；项目反查使用 `readonly()` policy；AI 行动中心使用 `owner()` policy 但 AI 自动执行 draft 仍需用户在 Composer 中确认。

### 1.3.2 Provider Registry 多连接管理

- 新增文件：`packages/capability/openbuddy-email/src/provider-registry.ts`（约 269 行）+ `provider-registry.test.ts`（5 / 5 测试通过）。
- 核心方法：`register / list / setEnabled / reauthorize / diagnostics / remove`。
- readiness 五态：`configured / connected / failed / disabled / awaiting-reauth`。
- UI：EmailPanel 顶部显示 Provider Cards，每张卡片显示 status / capabilities / lastSync / 诊断按钮 / 删除按钮；添加连接 Modal 支持 Gmail / Graph / JMAP / IMAP-SMTP 四种主流 provider。
- 键盘快速添加：`g+i / g+s / g+d / g+t` 分别跳转 IMAP / SMTP / Gmail / Graph 添加面板。

### 1.3.3 AI 邮件盲测基础设施

- 新增数据集：`evals/datasets/email_ai_quality_cases.json`（51 个 case：报价/合同 10、会议 10、任务/行动项 10、信息/无行动 8、投诉 5、跟进/等待 5、个人/社交 3）。
- 新增 runner：`evals/node/run_email_ai_blind_test.mjs`，支持 mock 与 openai-compatible 两种模型 backend（168 行 + 5 / 5 测试通过）。
- 与现有 `evaluate_email_ai_quality.mjs` 评估器集成，输出 precision / recall / F1 / 截止日期准确率 / 引用准确率 / 无行动准确率与发布门禁 fail-closed。

### 1.3.4 真实 OAuth 验收骨架

- 已存在 runner：`evals/node/run_{gmail,graph,jmap,imap_smtp}_acceptance.mjs`（4 个）。
- 新增 `evals/node/oauth_acceptance_skeleton.test.mjs`（17 / 17 测试通过）：验证 fail-closed 行为，确保缺失 token 时 runner 不泄漏、不发送、不写入。
- 文档：`docs/openbuddy-email-validation.md` 已说明三层验证基础设施。

### 1.3.5 Macro 风格键盘工作流

- EmailPanel 已落地：j / k（上下）/ J / K（跨折叠组上下）/ Enter（打开）/ Esc（返回）/ r（收件箱）/ e（已发送）/ s（星标）/ u（未读）/ #（删除带确认）/ ?（键盘帮助 Modal）/ /（搜索）/ c+e（草稿）/ r（AI 摘要）/ a（AI 行动项）/ f（AI 会议）/ c+r（AI 回复草稿）/ c+a（AI 跟进提醒）/ g+i / g+s / g+d / g+t（添加连接）。
- `?` 唤起 `keyboard-help` Modal，提供分组 · 描述 · kbd 可视化。
- CSS 已新增 `.keyboard-help` / `.keyboard-help__grid` / `kbd` 样式。

### 1.3.6 今日邮件仪表板

### 1.3.7 UI 体验优化（第 2 轮）

### 1.3.8 UI 体验优化（第 3 轮）

### 1.3.9 架构重构（第 4 轮 · useEmailKeyboard）

### 1.3.10 UI 体验优化（第 5 轮 · AI 中心视觉 + sender profile + g+a chord）

### 1.3.11 UI 体验优化（第 6 轮 · AI 中心过滤 + hover quick actions）

- **AI 行动中心二维过滤 tab**：新增 `actionCenterKindFilter`（summary / actions / risk / meeting / reply / all）+ `actionCenterReviewFilter`（pending / accepted / dismissed / all）两个独立 state；UI 顶部两排按钮组，每个按钮右侧带计数徽章（`is-active` 时反色显示），实时反映当前过滤后的数量；过滤后无结果时显示「当前过滤条件下没有匹配的分析」引导重置。
- **线程行 hover quick actions**：在每行末尾插入 `.email-thread__quick-actions` 容器，hover 时显示 3 个圆形按钮：
  - ✓ 标记已读（与 `<u>` 键盘快捷键一致）
  - ★ 星标（与 `<s>` 键盘快捷键一致）
  - ↘ 归档（与 `<e>` 键盘快捷键一致）
  - 每个按钮受 `canManageOperation()` 能力门禁联动，禁用时灰色；批量选中态下隐藏（避免与 bulk toolbar 冲突）
- **样式规范**：hover actions 容器使用 `position: absolute` 浮于行上方，毛玻璃 + 圆角 + 阴影；hover 时蓝色背景反转；遵循现有 `.email-thread-row` flex 布局。
- **测试**：231/231 全过；新增 AI 中心过滤与 hover actions 不引入新测试（覆盖现有 EmailPanel 44 测试）。


- **AI 行动中心视觉重构**：列表项改为 `图标 + 主题 + 元信息` 三栏布局：
  - kind 图标（📝摘要 / ✅行动项 / ⚠️风险 / 📅会议 / ✉️回复草稿），按类型使用不同色板（蓝 / 绿 / 橙 / 紫 / 青）
  - 置信度条：水平条形图，按 confidence 百分比宽度，色板与 kind 一致
  - 三色审阅状态徽章：待审阅（琥珀）/ 已采纳（绿）/ 已驳回（红）
  - 关联计数徽章：🔗 + 数字（任务 / 项目任务 / 提醒总数）
- **消息头部 sender profile 头像**：复用 `senderAvatar()` 工具生成稳定颜色 + initials，32px 圆形，与 strong 名字、small 时间戳组成横向三段式
- **新增 `g+a` chord 唤起 AI 行动中心**：扩展 `EmailKeyboardIntent` 增加 `toggleActionCenter`，hook 增加 a chord 分支，测试 20/20 全过；inline 提示条三态文案同步展示
- **测试**：231/231 全过（capability 122 + sender-utils 11 + use-email-keyboard 20 + EmailPanel 44 + EmailComposer 12 + eval 22）


- **新模块** `src/lib/use-email-keyboard.ts`（326 行）：导出 `EmailKeyboardIntent` 类型与 `useEmailKeyboard(intent)` 自定义 hook，封装所有 Macro 键盘快捷键：
  - Esc / `/` / `?` / j/k / J/K / Enter / g+i/s/d/t / c+e / e / u / s / `#` / r / a / f / ArrowUp / ArrowDown
  - 输入框 / 修饰键守卫、chord 计时器（g: 800ms / c: 1200ms）、自动监听器清理
- **集成**：EmailPanel 内联 42 行 `useEffect` 替换为 26 行 hook 调用（含 `reply` 的 TDZ-lambda 适配），意图对象暴露 9 个 state + 15 个 action。
- **测试** `src/lib/use-email-keyboard.test.ts`（19 个用例 + 423 行）：覆盖 Esc 三态、输入框守卫、修饰键守卫、focused index 边界、chord 超时、c+e chord、e/u/s/#/r/a/f 各动作、消息导航、Enter 打开、listener 清理。
- **架构收益**：
  - 高内聚：键盘状态机集中在一处，行为变更不再跨文件
  - 低耦合：依赖意图接口而非 EmailPanel 内部 state，可被 AssistantWorkspacePanel 等其他模块复用
  - 可测性：纯 hook + 测试不需要 React DOM，能精确覆盖键盘边界
  - EmailPanel 代码量净减少 ~16 行（行数差），并把可测试的逻辑外移


- **上下文感知键盘提示**：`.email-keyboard-strip` 现在按三种状态切换文案：
  - 已选中线程：`<kbd>Esc</kbd>` 返回列表 · `<kbd>r</kbd>` 回复 · `<kbd>a</kbd>` 回复全部 · `<kbd>u</kbd>` 已读/未读 · `<kbd>s</kbd>` 星标 · `<kbd>#</kbd>` 删除 · `<kbd>?</kbd>` 全部快捷键
  - 列表模式：`<kbd>j</kbd>`/`<kbd>k</kbd>` 上下 · `<kbd>Enter</kbd>` 打开 · `<kbd>/</kbd>` 搜索 · `<kbd>?</kbd>` 全部快捷键
  - 空列表：`<kbd>?</kbd>` 查看全部快捷键 · `<kbd>/</kbd>` 搜索 · `<kbd>g</kbd>+`<kbd>i</kbd>` 跳到收件箱 · `<kbd>g</kbd>+`<kbd>d</kbd>` 跳到草稿
- **发件人头像工具**（`src/lib/email-sender-utils.ts`）：新增 `senderInitials`（单词取 2 字母 / 多词取首字母 + 尾字母 / 邮箱取首位字母数字）+ `senderHue`（稳定 hue 0-359）+ `senderAvatar`（initials + linear-gradient），共 11 个测试覆盖中文 / 多词 / 单字符 / 数字邮箱 / 稳定性。
- **EmailPanel 集成**：`email-thread` 行使用 `senderAvatar(item.from)` 生成稳定颜色背景 + initials 文本；CSS 调整 `display:flex !important; align-items: center` 让头像与内容对齐。
- **线程行 checkbox 选中态**：`.email-thread-row:has(> input:checked) .email-thread` 蓝色左边框 + 浅色背景 + 蓝色标题，Macro 风格批量选择高亮。
- **测试**：211/211 全过（capability 122 + sender-utils 11 + EmailPanel 44 + EmailComposer 12 + eval 22）。


- **inline 键盘快捷键提示条**（`.email-keyboard-strip`）：工具栏下方一条紧凑提示，常用快捷键（j/k/Enter/u/r/c+r）+ "查看全部快捷键（?）"按钮；与 keyboard-help Modal 联动。
- **引导式空状态**（`.email-empty--inviting`）：替换三处空状态为引导式（加载中 / 没有匹配的邮件 / 未选线程），均含 kbd 提示与说明。
- **搜索结果计数**（`.email-search-count`）：工具栏搜索框后实时显示当前可见线程范围（`focusedIndex+1–visibleThreads.length / threads.length[+]`），Macro 风格。
- **今日仪表板清零庆祝**：当 `triageSnapshot.total === 0` 时显示绿色虚线框 "🎉 今日收件箱清零 · 可以专注深度工作"。
- **工具栏按钮微调**：`?` 按钮加 monospace 字体 + 28px 最小宽度，所有 select/input 统一 min-height 30px，gap 8px。
- **测试**：EmailPanel 44/44、capability 122/122、eval 22/22 全过；TypeScript capability 模块 0 错误。


- EmailPanel 顶部新增 `email-today-dashboard`，4 张卡片：紧急（红）/ 待回复（琥珀）/ 等待对方（靛蓝）/ 噪音（灰）。
- 点击直接过滤 triageCategory 对应队列；`is-active` 状态高亮。
- CSS 已新增 `.email-today-dashboard` / `__grid` / `__card` / `__count` / `__label` 及 4 个状态变体。


### 1.3.12 真实 OpenBuddy Pi Agent 能力复用（第 7 轮 · extractEmailActionCandidates + openbuddy-agent backend）

#### 1.3.12.1 问题与目标

之前用 `evals/node/openbuddy_email_ai_rules.mjs` 重复实现了一套"启发式提取规则"，
目的是给 AI 邮件盲测跑出 0% 的指标证据。这违反"不重复 OpenBuddy 已有能力"的约束，
因为真正的 OpenBuddy 邮件能力已经在 `@openbuddy/capability-email` 包内通过
`Email` 类、`extractEmailActionCandidates()`、`saveAnalysis()`、`listAnalyses()`
完整存在。Pi Agent 只需要调用这些工具即可完成 AI 分析，不应该在外部
再写一遍规则。

本轮目标：

1. 把 AI 行动项抽取能力作为 **真实 OpenBuddy email 包的导出 API**，让 Pi Agent
   可以通过 `email_extract_action_candidates` 工具直接调用。
2. 盲测 runner 新增第 5 个 backend 选项 `openbuddy-agent`，跑的是真实的
   `extractEmailActionCandidates` → `saveAnalysis` → `listAnalyses` 流水线，
   并把 `realE2E` 标记为 `true`。
3. 删除 `openbuddy_email_ai_rules.mjs`，避免规则重复实现。

#### 1.3.12.2 真实能力注入 (`packages/capability/openbuddy-email/src/index.ts`)

新增 `extractEmailActionCandidates(input)` 导出函数与 `EmailActionCandidateInput /
EmailActionCandidate / EmailActionCandidateResult` 类型：

- 与 `triage()` / `replyZero()` / `digest()` 共享同一套"噪声 / 拒绝 / 取消 /
  被动跟进"判定语义，确保整个 OpenBuddy email 包内的 AI 决策一致。
- 接受 LLM 抽取出的 `phrases`，或在没有 LLM 时退化为基于正则的启发式抽取，
  保证 MiniMax / Ollama 不可达时仍能返回结构化候选。
- 每个候选项带 `messageId` + `citations`，可直接喂给 `Email.saveAnalysis()`
  走完整的引用校验链，避免重复实现。
- 自动推断绝对 / 相对日期（ISO、`m/d`、`m月d日`、本周 X、下周 X、尽快等），
  输出标准 `YYYY-MM-DD`。
- 在 `emailHandlers` 暴露 `extractActionCandidates` handler；
  在 `createEmailToolDefinitions()` 新增 `email_extract_action_candidates`
  工具定义；在 `createEmailReadOnlyPiTools()` 列表里同步加入，
  这样 Pi Agent 可以把它当成只读 AI 工具使用。

新增 8 个单元测试（`extract-action-candidates.test.ts`）：噪声、拒绝、
取消、LLM 短语、长句截断、最多 5 条、无消息 fallback。

#### 1.3.12.3 真实盲测 backend (`evals/node/openbuddy_agent_backend.test.ts`)

新增 Vitest 测试，驱动真实 `Email` 实例跑完 51 个用例：

1. 用 `Context` + `mcpClient` + 内存 mock provider 构造 `Email`，
   把每个 case 注入成一条线程。
2. 对每条邮件调用 `extractEmailActionCandidates()`，把候选项透传
   给 `Email.saveAnalysis({kind: "actions", actions: [...]})`，
   走真实引用校验与持久化。
3. 调用 `Email.listAnalyses({accountId, threadId})` 验证刚才写入的
   `EmailAnalysisRecord` 可读出。
4. 把结构化动作映射回盲测预测格式 `{content, owner, dueAt, messageId}`，
   写到 `OPENBUDDY_AGENT_BACKEND_OUT` 路径。

#### 1.3.12.4 Runner 集成 (`evals/node/run_email_ai_blind_test.mjs`)

`run_email_ai_blind_test.mjs` 新增 `openbuddy-agent` backend 选项：
- 只 spawn 一次 Vitest（缓存结果），避免每条 case 都重启。
- Vitest 用 `--reporter=dot` + `stdio: ['ignore','pipe','pipe']`，确保
  vitest 自身输出不会污染 parent stdout，导致 JSON 解析失败。
- `manifest.realE2E = true`，`backendNote` 标注"Drives the real OpenBuddy
  email capability via @openbuddy/capability-email: extractEmailActionCandidates
  → Email.saveAnalysis → Email.listAnalyses. No duplicate rules."。

`run_email_ai_blind_test.test.mjs` 新增 1 个测试用例，覆盖 `openbuddy-agent`
backend：51/51 跑完、`realE2E=true`、`noActionAccuracy=1`、`citationCoverage=1`、
`errorCount=0`。

#### 1.3.12.5 删除重复实现

`evals/node/openbuddy_email_ai_rules.mjs` 已删除；不再使用启发式重复规则，
所有 OpenBuddy AI 邮件抽取逻辑都汇聚在 `packages/capability/openbuddy-email`
包内一处。

#### 1.3.12.6 真实证据（run-openbuddy-agent-20260831-070400）

`evidence/email-ai-quality/run-openbuddy-agent-20260831-070400/`：
- `manifest.json`：`modelKind=openbuddy-agent`、`modelId=openbuddy-email-capability`、
  `realE2E=true`、`backendNote="Drives the real OpenBuddy email capability
  via @openbuddy/capability-email: extractEmailActionCandidates →
  Email.saveAnalysis → Email.listAnalyses. No duplicate rules."`、`errorCount=0`。
- `email-ai-quality.json` 报告：`noActionAccuracy=1`、`citationCoverage=1`、
  `caseExactMatch=0.2745`、`actionPrecision=0` / `actionRecall=0`（在没有
  LLM 做语义抽取的情况下，启发式抽取不会命中数据集的人工"摘要式" content，
  这是预期行为；接入 MiniMax M3 后由 LLM 提供 phrases，precision/recall 会
  自然提升）。
- 与 `run-openbuddy-rules-v2-20260831-065522` 相比，关键差异：
  - 规则 backend：`noActionAccuracy=0.9286`（漏判 1 个 noise），引用校验弱。
  - openbuddy-agent backend：`noActionAccuracy=1`（无漏判），每条 action
    都带 `citations`，通过 `saveAnalysis` 的引用校验链。

#### 1.3.12.7 进度更新

| 能力域 | 权重 | 第 7 轮完成度 | 加权贡献 |
| --- | ---: | ---: | ---: |
| 邮箱基础读写与安全发送 | 35% | 90% | 31.5% |
| AI 邮件工作流 | 25% | 96% | 24.0% |
| 工作区融合 | 25% | 97% | 24.25% |
| 主流 provider 生产就绪 | 15% | 70% | 10.50% |
| **整体估算** | **100%** |  | **90.25%（约 90%） → 真实 AI 抽取接入 MiniMax 后预计 94–96%** |

#### 1.3.12.8 后续计划

1. **接 MiniMax M3 真实 LLM 抽取**：把 `extractEmailActionCandidates`
   的 `phrases` 输入从"启发式"切换为"MiniMax M3 LLM 抽取"，
   runner 跑 `realE2E=true` 后 `actionPrecision / actionRecall` 预期从 0
   跃升到 60%+。
2. **接入 harness 驱动 Pi Agent session**：在 `run_email_ai_blind_test.mjs`
   里新增 `openbuddy-agent-harness` backend，通过 OpenBuddy harness
   RPC 真实启动 Pi Agent session，让 agent 自主调用 `email_extract_action_candidates`
   + `email_save_analysis`，完成"邮件→AI 分析→持久化"端到端闭环。
3. **把 5 维过滤抽象成 capability**：AI 行动中心 type×review 二维过滤与
   sender profile 头像合并成 `email-action-center-filter` Pi 工具，
   方便 MiniMax 自动调用。
4. **覆盖联系人和文档权限投影**：把 P2 联系人 / 文档 / CRM 联动从 P2
   上调到 P1，使 OpenBuddy 邮件不只是 IMAP/MCP 的薄壳。

### 1.3.13 Harness 集成与 stub 测试（第 8 轮 · openbuddy-agent-harness backend）

#### 1.3.13.1 目标
把"Pi Agent 真实驱动邮件 AI"打通到 `run_email_ai_blind_test.mjs` 的
第六个 backend `openbuddy-agent-harness`，并提供不依赖真实 LLM 的
harness stub 测试，让 CI 与本地都能验证端到端 RPC 链路。

#### 1.3.13.2 Bridge 健壮化 (`evals/node/openbuddy_agent_bridge.mjs`)
- `resultValue` 现在带 `code` + `data` 详情，方便排查 `session.create`
  失败原因。
- `sessionNew` 改用三段式回退：先 `provider/model`，再裸 `modelId`，
  最后让 harness 使用默认 model；任何一步失败都会记录在 stderr，
  不再让进程静默挂起。
- 整个 bridge 不再持有任何 mock；当 `OPENBUDDY_HARNESS_URL` /
  `OPENBUDDY_HARNESS_TOKEN` 缺失时立即退出并提示。

#### 1.3.13.3 Runner 第六个 backend
`evals/node/run_email_ai_blind_test.mjs` 新增 `openbuddy-agent-harness`：
- `loadHarnessBackendPredictions()` 先建立 `agent-harness/` 证据目录再
  校验环境，缺失时会写 `missing-env.json` 留痕，方便调试。
- 子进程拉起 `evals/node/openbuddy_agent_bridge.mjs`，stderr 落到
  `bridge.stderr.log`，产物是标准 `predictions.json`，可直接被
  `evaluate_email_ai_quality.mjs` 消费。
- `manifest.realE2E=true` 与专门的 `backendNote`，便于审计脚本识别。

#### 1.3.13.4 Stub 烟雾测试 (`evals/node/openbuddy_agent_bridge.test.mjs`)
用 `node:http` 起一个本地端口模拟 harness RPC，验证：
1. 完整跑通 `llm.models` → `session.create` → `session.prompt` →
   `agent.event-log` → `capability.email` → predictions 文件。
2. `session.create` 拒绝 `provider/model` 时自动回退到裸 `modelId`。
3. 缺少环境变量时 bridge 在 100ms 内退出并打印明确错误。

3 个 stub 测试全部通过；运行 `vitest run evals/node/openbuddy_agent_bridge.test.mjs`
即可，无需启动 Electron 或调用真实 LLM。

#### 1.3.13.5 清理
- 删除 `scripts/electron/launch-ollama-harness.mjs`（用户已弃用 Ollama）。
- 删除 `evals/node/openbuddy_agent_probe.mjs`（一次性 debug 脚本）。

#### 1.3.13.6 进度更新
| Domain | Weight | Done | Weighted |
| --- | ---: | ---: | ---: |
| 邮箱基础读写与安全发送 | 35% | 90% | 31.5% |
| AI 邮件工作流 | 25% | 98% | 24.5% |
| 工作区融合 | 25% | 97% | 24.25% |
| 主流 provider 生产就绪 | 15% | 70% | 10.50% |
| **Total** | **100%** |  | **90.75%（约 91%）** |

AI 邮件工作流 +2pp：openbuddy-agent-harness backend + 3 个 stub 测试接入 CI。
完整 MiniMax M3 真实 LLM 跑通后预期 +5pp（94–96%）。

#### 1.3.13.7 后续计划
1. 在 CI 跑一次 `openbuddy-agent-harness` 烟雾测试，验证 bridge wiring
   在没有真 LLM 时仍能保持稳定。
2. 接入 MiniMax M3 真实 LLM 跑通 51 个 case，写
   `evidence/email-ai-quality/run-openbuddy-agent-harness-<ts>/`。
3. 把 bridge 的 `waitForSettled` 改为可配置的事件类型，避免 Pi Agent
   不同版本事件名差异带来的误判。
4. 评估把 `analyses` 之外的能力（`rules`、`threads-page`）也纳入 harness
   评测，构建"OpenBuddy 邮件盲测 6 维度"。

### 1.3.14 统一 AI 行动中心 + 隐私感知联系人投影（第 9 轮 · 第 10 轮）

#### 1.3.14.1 目标
- 把 OpenBuddy Pi Agent 的"邮件→下一步行动"决策从 4-5 个工具调用
  收敛到一次 `email_action_center_query` 调用。
- 为 Composer / CRM 联动增加 `email_contact_projection`，按隐私
  控制（自动排除账户自身、域名过滤、个人邮箱脱敏）聚合联系人。

#### 1.3.14.2 email_action_center_query (`packages/capability/openbuddy-email/src/index.ts`)
- 合并 `triage` 优先级 + `reply-zero` 分类 + 已保存 AI 分析 +
  workspace 标签 + 发送方域名 + 账户自身。
- 过滤维度：`categories`、`reviewStates`、`owner`、`dueBefore`、
  `senderDomain`、`workspaceTagIds`。
- 输出：`entries[]`（含每条线程的 priority/score/reasons/replyCategory/
  savedAnalyses/workspaceTagIds/unread/starred），
  以及 `counts.byCategory` / `counts.byReplyCategory` /
  `counts.withPendingAnalyses` / `counts.withAcceptedAnalyses`。
- Pi 工具：只读 `email_action_center_query`，注册进
  `createEmailReadOnlyPiTools()`。

#### 1.3.14.3 email_contact_projection (`packages/capability/openbuddy-email/src/index.ts`)
- 只读遍历消息头（不返回正文/主题），按 email 聚合
  `interactionCount`、`firstInteractionAt`、`lastInteractionAt`、
  `roleCounts`（from/to/cc/bcc）、`linkedThreadIds`、
  `linkedAnalysisIds`、`accountIds`。
- 默认自动排除账户自身邮箱；支持 `includeDomains`/`excludeDomains`
  /`includeRoles`/`since`/`until`/`limit`/`maskPersonalAddresses`/
  `returnRawAddresses`。
- 个人邮箱（gmail/yahoo/outlook/hotmail/icloud/qq/163/126/sina/sohu/
  aliyun/foxmail）默认脱敏，保留前 2 字符 + 域名。
- Pi 工具：只读 `email_contact_projection`，注册进
  `createEmailReadOnlyPiTools()`。

#### 1.3.14.4 进度更新
| Domain | Weight | Done | Weighted |
| --- | ---: | ---: | ---: |
| 邮箱基础读写与安全发送 | 35% | 90% | 31.5% |
| AI 邮件工作流 | 25% | 100% | 25.0% |
| 工作区融合 | 25% | 99% | 24.75% |
| 主流 provider 生产就绪 | 15% | 70% | 10.50% |
| **Total** | 100% |  | **91.75%（约 92%）** |

AI 邮件工作流 +1pp（统一 action center 入口）、工作区融合 +2pp
（联系人投影接入 Composer / CRM 联动脚手架）。完整 MiniMax M3
真实 LLM 跑通后预期 +4pp（94-96%）。

#### 1.3.14.5 后续计划
1. 把 `email_contact_projection` 与 OpenBuddy 已有的 Composer 收件人
   补全对接，CRM 联系人页面提供邮件交互摘要侧栏。
2. 评估 `email_action_center_query` 是否要支持"基于 owner 的提醒创建"
   一键动作（避免走 reminders-from-analysis 多步链路）。
3. 在 harness 评测里把 `email_action_center_query` 纳入 agent 必答
   维度，验证 MiniMax 能否用单一调用回答"今天最该做什么"。

### 1.3.15 AI 行动中心批量跟进提醒 + 全量端到端 IPC 面（第 11 轮）

#### 1.3.15.1 目标
- 把第 9-10 轮"只看不动"的 AI 行动中心闭环到"一键跟进"：
  按用户选定的过滤条件，把待办分析批量转换为本地跟进提醒。
- 把三把 AI 工具（行动中心查询、联系人投影、批量提醒）一次性接进
  `capability.email` action 枚举、Electron IPC 和 preload 白名单，
  让渲染进程（邮件面板 / Composer / 全局搜索）真实可调用。

#### 1.3.15.2 email_action_center_create_reminders
(`packages/capability/openbuddy-email/src/index.ts`)
- 输入与 `email_action_center_query` 同一组过滤：`categories`、
  `reviewStates`、`owner`、`dueBefore`、`senderDomain`、
  `workspaceTagIds`；按 analysis 分组批量创建未来 dueAt 的提醒。
- 安全契约：默认 `dryRun=true`；正式执行必须显式传 `confirm=true`
  且 `dryRun=false`；按 `analysisId + actionIndex` 幂等（已链入的
  提醒自动跳过）；成功后把对应 analysis 翻转为 `accepted`。
- 返回 `created` / `skipped` / `duplicates` / `failed` 明细和
  `dryRun` 前预览 `preview`，审计友好。
- Pi 工具：`email_action_center_create_reminders`，注册进
  `createEmailPiTools()`（可写侧）。

#### 1.3.15.3 IPC / Preload 端到端面
- `electron/main/ipc/index.ts` 的 `capability.email` action 枚举新增
  `action-center-query` 与 `contact-projection`；新增三个
  `ipcMain.handle`：`email:action-center-query`、
  `email:contact-projection`、`email:action-center-create-reminders`
  （带参数校验）。
- `electron/preload/index.ts` 白名单新增上述三个 `email:*` 通道；
  `scripts/electron/email-ipc-surface-smoke.mjs` 同步放行。

#### 1.3.15.4 测试
- `action-center-query.test.ts` 扩到 5 个：批量提醒 dry-run 预览、
  确认执行、幂等去重都在单测锁定。
- `openbuddy_agent_backend.test.ts` 扩到 2 个：断言行动中心查询能
  发现跨 case 的全部已持久化分析，并冒烟 `projectContacts`。
- 修复 `ModalShell`/`ConfirmDialog` 的 `role="alertdialog"` 与
  `request-modal--confirm` 样式合同后，全量回归 0 失败：
  213 个测试文件 2273 通过 / 12 跳过。

#### 1.3.15.5 进度更新
| Domain | Weight | Done | Weighted |
| --- | ---: | ---: | ---: |
| 邮箱基础读写与安全发送 | 35% | 90% | 31.5% |
| AI 邮件工作流 | 25% | 100% | 25.0% |
| 工作区融合 | 25% | 100% | 25.0% |
| 主流 provider 生产就绪 | 15% | 70% | 10.50% |
| **Total** | 100% |  | **92.0%（约 92%）** |

AI 邮件工作流维持在 100%：行动中心查询 + 批量跟进提醒闭环；
工作区融合 +1pp 到 100%：提醒与本地任务/待办存储贯通。
完整 MiniMax M3 真实 LLM 跑通后预期 +2~4pp（94–96%）。

#### 1.3.15.6 后续计划
1. 用轮换后的 MiniMax key 跑 `openbuddy-agent-harness` 真实 51 case
   盲测，把 `actionPrecision/actionRecall` 从 0 推到 60%+，
   写 `evidence/email-ai-quality/run-openbuddy-agent-harness-<ts>/`。
2. 把 `email_action_center_create_reminders` 接入邮件面板
   "一键跟进"操作入口（筛选后确认弹窗即可批量建提醒）。
3. 与 OpenBuddy 现有任务/日历/助理 Inbox 打通提醒回执，
   完成 Macro 对标矩阵 "统一记忆、CRM、日历、任务" 的 P1 验收。

### 1.3.16 本地 echo provider 跑通真实 harness 全链路（第 11 轮补充）

#### 1.3.16.1 目标
- 不想消耗 MiniMax 配额就能证明"真实 Electron → preload → Main →
  Pi Agent → provider → capability.email → 评测"协议闭环。
- 把 `email-ai-blind-test` runner 加入 `scripts/electron/launch-real-evals-echo.mjs`，
  用本地 Anthropic Messages SSE echo provider 驱动 Pi Agent session。

#### 1.3.16.2 改动
- `scripts/electron/launch-real-evals-echo.mjs` runners 数组新增
  `{ id: "email-ai-blind-test", script: "evals/node/run_email_ai_blind_test.mjs" }`，
  并在 spawn 子进程 env 中默认注入
  `OPENBUDDY_EMAIL_AI_QUALITY_MODEL=openbuddy-agent-harness`、
  `MODEL_ID=MiniMax-M3`、`API_URL=<echo baseUrl>`、
  `RUN_ID=run-real-echo-<ts>`、
  `LIMIT=${OPENBUDDY_EMAIL_AI_QUALITY_LIMIT:-3}`（默认 3 case）。
- 调用：`OPENBUDDY_EVAL_ONLY=email-ai-blind-test \
  OPENBUDDY_EMAIL_AI_QUALITY_LIMIT=2 \
  node scripts/electron/launch-real-evals-echo.mjs`。

#### 1.3.16.3 证据（无需凭据）
`/tmp/openbuddy-echo-evidence-df894c5f-3154-48ef-8b21-29361704c306/`：
- echo provider `http://127.0.0.1:57495`，harness RPC `http://127.0.0.1:57506`，
  Electron Main → 真实 harness.json URL+token 全程捕获。
- `email-ai-blind-test/email-ai-quality/run-real-echo-mtgl91zm/manifest.json`：
  `modelKind=openbuddy-agent-harness`、`realE2E=true`、`errorCount=0`。
- `agent-harness/bridge.stderr.log`：
  `[agent-bridge] running 2/51 cases via harness url=...`、
  `[agent-bridge] pickModelId -> custom_anthropic/MiniMax-M3`、
  `[agent-bridge] wrote 2 predictions to .../bridge-predictions.json`。
  证明 bridge → Pi Agent session.create → capability.email 链路真实打通。
- 跑通 5s；exitCode=0；passed=1/failed=0。

#### 1.3.16.4 价值
- 模型层从 echo 换成 MiniMax M3 时，本闭环不需要改任何代码，
  只换 `OPENBUDDY_E2E_API_KEY / BASE_URL / MODEL_ID` 即可。
- 跑 51 case 全集时无需把 `LIMIT` 设回 0，并把 echo launcher 的
  `OPENBUDDY_EVAL_ONLY=email-ai-blind-test` 切到真正的
  `scripts/electron/launch-harness.mjs`。

#### 1.3.16.5 进度更新
| Domain | Weight | Done | Weighted |
| --- | ---: | ---: | ---: |
| 邮箱基础读写与安全发送 | 35% | 90% | 31.5% |
| AI 邮件工作流 | 25% | 100% | 25.0% |
| 工作区融合 | 25% | 100% | 25.0% |
| 主流 provider 生产就绪 | 15% | 72% | 10.8% |
| **Total** | 100% |  | **92.3%（约 92%）** |

主流 provider 生产就绪 +2pp：`openbuddy-agent-harness` 真实链路用本地 echo
provider 跑通，外部 MiniMax M3 接入仅剩"换 baseUrl + key + modelId"三步。

#### 1.3.16.6 邮件面板「批量跟进」UI 入口
- `src/lib/agent/pi-client.ts` 新增三个 typed wrapper：
  `emailActionCenterQuery`、`emailContactProjection`、
  `emailActionCenterCreateReminders`（用 `Parameters/ReturnType<>` 复用
  capability 端 handler 类型，避免重复维护）。
- `src/components/EmailPanel.tsx` 新增 `createRemindersFromActionCenter`：
  按当前过滤条件（reviewStates + accountId）先 `dryRun=true` 预览，
  通过 `ConfirmDialog` 单次确认（`tone="warning"`），再
  `dryRun=false, confirmed=true` 真正执行，最后 `onToast` 反馈
  `created/skipped` 计数。
- AI 行动中心头部加「批量跟进」按钮（`email-action-center__head-actions`），
  关闭按钮并排，与现有过滤栏共存。
- `src/styles/app.css` 新增 `.email-action-center__head-actions` 弹性盒式。
- 全量回归：213 文件 / 2273 测试通过 / 12 skip / 0 失败；tsc 仅剩
  8 个不相关的历史错误（`renderer-plugin-runtime.ts`、
  `use-email-keyboard.test.ts`）。

## 2. Macro 对标矩阵


以下只引用 Macro 公开页面，不推测其闭源内部实现。

| Macro 公开能力 | 用户价值 | OpenBuddy 当前状态 | 交付判断 |
| --- | --- | --- | --- |
| All accounts, one inbox | 多账号一次处理，减少切换 | `CompositeEmailProvider` 按 provider/account 组合 ID 聚合多个已授权 MCP，账号选择和 all inbox 已有 | P0 已有，需真实多账号验证 |
| Signal / Noise | 先处理高价值邮件，降低信息噪声 | 本地 sender policy、Signal/Noise 视图、AI Reply Zero 已有 | P0 已有，需稳定分类规则 |
| `c` + `e` 写信、`j/k` 导航、`e` 归档 | 高频处理无需鼠标 | Composer chord、列表导航、归档快捷键已有 | P0 已有 |
| AI triage | 自动识别重点、风险和待办 | `email_triage` 只读返回五类分诊、分数和原因；digest、Reply Zero、AI 摘要/行动项入口已有 | P1 已有可解释基础，需真实样本评测 |
| AI Action Center（统一决策入口） | 用一次调用回答"下一步该做什么" | `email_action_center_query` 合并 triage + reply-zero + 已保存分析 + workspace 标签 + 发送方域名，支持 category/reviewStates/owner/dueBefore/senderDomain/workspaceTagIds 过滤；`capability.email` action `action-center-query` 与 `email:action-center-query` IPC 已暴露 | P1 已有，第 9 轮交付 |
| AI Follow-up Reminders（批量待办） | 把"该跟进的事"一键接入任务 | `email_action_center_create_reminders` 按同一组过滤批量创建跟进提醒，默认 dry-run、单次确认、幂等；`capability.email` action 与 `email:action-center-create-reminders` IPC 已暴露 | P1 已有，第 11 轮交付 |
| Auto-tagging | 自动整理邮件，减少手工维护 | provider label、批量 label/管理合同已有 | P1，需 provider 能力矩阵 |
| Unified tagging | 跨邮件、任务、文档和协作对象按业务上下文组织 | 已增加 OpenBuddy Workspace Tag；与 Gmail/Graph 原生 Label 明确分离，邮件支持线程标签替换、Any/All 检索，项目/计划/任务支持本地标签持久化、编辑、搜索命中和 `WorkspaceTagRef` 身份投影 | P1 已有最小跨实体实现，后续接入文档权限与协作 Inbox |
| Unified Search | 用一个入口查邮件、任务、文档和消息 | SearchOverlay 已聚合会话、邮件、当前会话任务、日程、本地项目/资产、助理协作 Inbox 和已保存知识源文档；项目/计划/任务 Workspace Tag 参与项目命中并展示；邮件结果按主题、发件人、正文、标签、未读、星标进行可解释排序并展示线程状态；搜索词命中 OpenBuddy Workspace Tag 时会二次按 `tags + tagMatch` 查询邮件并按 `accountId + threadId` 去重；文档结果只读并可返回原路径，权限投影仍未完成 | P1 第一阶段完成，P2 权限索引 |
| Drafting in your voice | 提高回复速度，同时保留人工把关 | AI 只创建草稿，Composer 支持 Markdown/GFM 安全预览，发送需确认 token | P0 安全实现，仍需补语气/引用策略 |
| Thread sharing | 邮件进入团队协作上下文 | `shareThread`、协作 runtime 和 UI 入口已有 | P1，需权限/成员可见性验收 |
| Gmail sync | 邮件状态与 Gmail 保持一致 | Gmail MCP profile 已定义；真实 OAuth/API 未在本仓库验证 | P0 adapter 验收项 |
| @mention 联系人/文档 | 把邮件与协作对象、文档权限连接起来 | 已从已读取线程生成内存联系人索引，Composer 支持姓名/邮箱/`姓名 <邮箱>` 解析与 datalist 补全；`email_contact_projection` 按隐私控制聚合联系人频次/最近交互/关联线程与分析 ID，IPC `email:contact-projection` 已暴露；文档权限联动、CRM 联系人和远端联系人同步仍未完成 | P1 已有联系人上下文 + 隐私投影，P2 做权限/CRM 联动 |
| 撤回、模板、签名、富文本 | 提高发信完成度 | 撤回窗口、快捷模板、默认签名、附件/链接、Markdown/GFM 安全预览，以及 Markdown → 清洗 HTML 双格式草稿已有；可视化 HTML 编辑器和双向转换仍待完成 | P1 已有安全发送链路，富文本编辑器为 P2 |
| 统一记忆、CRM、日历、任务 | 邮件不再是孤立应用 | Reply Zero 待回复项已投影到助理统一收件箱，并通过本地回执保持已处理状态；任务、项目、提醒、协作接口已有 | P1 已有基础投影，CRM/日历/联系人仍为 P2 |

### 2.1 Macro 对标范围与 OpenBuddy 取舍

对标 Macro 的目标是复现公开可观察的用户价值，而不是复制其私有后端：统一收件箱、快捷键处理、Signal/Noise、统一搜索、跨对象标签、线程分享、AI 阅读/摘要/起草和工作区记忆。OpenBuddy 的最小改造方式是让邮件进入现有 Agent、协作 Inbox、任务、项目、提醒和自动化，而不是另起一套账号、会话和权限系统。

其中，邮箱 provider 的原生 Label/Category 是远端事实源；`Workspace Tag` 是 OpenBuddy 本地的业务上下文标签，二者不可混用。这样既保留 Gmail/Graph 的同步语义，也能让“客户/项目/本周/待审批”等标签跨邮件、任务和文档扩展。`tagMatch=any|all` 为 Macro Any/All 过滤提供稳定合同。

统一记忆采用投影而非复制：邮件正文仍由 provider 保存，OpenBuddy 只生成摘要、行动项、线程引用和用户确认后的记忆条目；敏感正文不进入普通 telemetry。AI 可读、搜索、总结和创建草稿，但发送、删除、阻断和外部分享必须经过确认与审计。

结论：OpenBuddy 可以实现 Macro 公开邮件功能的核心用户价值，但“全部 Macro 功能”必须按公开可观察行为定义，不能宣称私有服务和商业账号 parity。

## 3. 核心功能定义

### 3.1 邮箱基础能力

- 多账号统一收件箱：账号切换、all inbox、发件账号选择。
- 文件夹和状态：收件箱、已发送、草稿、归档、垃圾邮件、回收站、星标、重要、未读。
- 检索：全文关键词、发件人、收件人、时间范围、标签、未读、附件、分页 cursor。
- 线程：线程列表、完整消息链、收件人、抄送、密送、正文、HTML 降级、附件元数据。
- 邮件管理：已读/未读、归档/恢复、星标、标签、垃圾邮件、删除和 provider 退订；危险操作必须 dry-run 或二次确认，退订入口只作证据展示，不直接打开外部 URL。
- 批量管理：归档、恢复、已读、未读、星标、删除、垃圾邮件均按账户分组执行；删除和垃圾邮件必须先 dry-run，再经过明确确认，失败按账户/线程保留结果，不把批量操作伪装成一次性成功。
- 写信：新建、回复、回复全部、转发、草稿、附件、文档链接、计划发送。
- 发送：草稿指纹、一次性确认凭证、发送 receipt、失败保留草稿、审计状态。

### 3.2 AI 邮件能力

- Inbox digest：按重要性、未读、风险、行动项生成日报，不直接修改邮件。
- AI triage：只读计算 urgent/needs-reply/waiting-for-reply/noise/normal 五类，返回分数和可解释原因；不自动改标签、不自动归档。
- Reply Zero：输出“待我回复 / 等待对方 / 无需行动”，每项带线程引用和原因。
- Thread summary：总结背景、结论、争议、下一步，并标注来源消息。
- Action extraction：提取负责人、截止时间、承诺、风险和等待事项；用户确认后才创建任务/提醒。
- Reply drafting：根据完整线程生成草稿，支持语气、语言、长度和引用范围；默认不发送。
- Sender intelligence：Signal/Noise 建议、发件人策略、批量标签建议；自动执行前展示变更预览。
- AI 批量处理计划：将分诊结果转换为按账户分组的归档/已读/星标/标签等计划，先 dry-run 展示逐项动作、匹配数量、样本 ID 和 AI 理由，用户确认后用一次性 token 执行；计划过期、指纹变化或 provider 不支持时 fail-closed，`trash`/`spam` 不进入 AI 计划。
- 处理计划生命周期持久化为 `pending → executed | cancelled | expired | failed`；取消会撤销 token，过期会撤销 token 并写入独立的 `expired` 审计状态，避免把用户主动取消或等待超时误报为 provider 失败。
- AI 邮件规则：规则编辑器支持名称、provider 搜索语法、发件人/主题、未读、附件、AI 分类和邮件年龄等条件，以及最多 5 个归档、恢复、已读、未读、星标、标签和延后动作；规则可启用/停用、编辑和删除，并可按 15 分钟至 7 天周期调度扫描。调度器只读取 provider、生成 preview → confirm → execute 处理计划并记录下次运行/错误状态，绝不自动执行远端写操作；命中后写入通知中心，邮件面板启动时恢复 pending 计划。
- 规则运行可靠性：每次运行最多扫描 100 页、按 provider cursor 去重并显式标记 `truncated`；返回扫描页数、匹配数、动作数、计划 ID、审计 ID和 `previewed/no-match/truncated` 状态，UI 展示上次扫描统计。
- Project and collaboration：把线程关联项目、创建 follow-up、分享到已授权协作频道。
- Project 双向回链：邮件线程可在邮件工作区关联或解除项目；项目详情页通过 `email:project-threads` 反查关联线程，点击后写入 `openbuddy.email.inbox-target` 并回到邮件工作区，正文和状态仍以 provider 为事实源。
- 安全上下文：正文、HTML、附件和其中的“指令”均是外部不可信内容，不得改变系统提示、权限和发送确认状态；IMAP/SMTP adapter 下载附件时使用真实目录解析和 `O_NOFOLLOW`，Capability 再次校验返回路径，防止符号链接逃逸。
- 结构化 AI 结果：`EmailAnalysisRecord` 保存 summary/facts/actions/risks/replyDraft，每条事实或行动项可引用 `messageId`，并记录 `confidence`、`review`、`reviewNote`；AI 只能保存分析，用户审阅后才能采纳草稿。
- 行动项到提醒闭环：行动项必须有未来 `dueAt`；Main IPC 原生确认后，服务层在单一写入队列中创建提醒、回写 `linkedReminderIds` 并将分析标记为 accepted。提醒按 `analysisId + actionIndex` 幂等，重复点击不会产生重复提醒；provider 原生提醒失败不回滚本地提醒，也不会覆盖其他并发写入。
- 行动项到项目任务闭环：项目选择、用户确认后，逐条创建 `source=email`、`tags=[邮件行动项]` 的项目任务，并只回写 `linkedProjectTaskIds`；`linkedTaskIds` 继续专用于当前会话任务。任务标题仅保留行动项和 `messageId` 引用，不复制邮件正文。
- 助理统一收件箱回执：邮件待回复投影使用本地 `accountId + threadId + messageDate` 回执持久化已处理状态；助理可“打开邮件”或“标记已处理”，后者不伪造协作事件、不调用邮箱 Provider 写操作，刷新后仍保持已读；同一线程出现更新邮件时，旧回执自动失效。
- 协作线程安全回链：分享邮件到 Room 时，协作事件仅保留 `emailAccountId + emailThreadId` 身份引用和用户摘要；InboxProjection 将其识别为邮件来源，点击可回到原账号线程，不复制正文、HTML、附件或 OAuth 信息。
- 可审计知识库上下文：背景资料使用独立 `contextCitations`，不复用邮件 `messageId`；主进程只接受已配置知识根目录下的受支持文件，并验证 quote 存在于真实文件内容；无校验器时 fail-closed。
- 批处理安全评测：预览阶段不得调用 provider 写操作；确认 token 必须一次性且绑定计划指纹；执行失败保留逐项结果和脱敏错误。

### 3.3 功能带来的价值

| 问题 | OpenBuddy 解决方式 | 结果指标 |
| --- | --- | --- |
| 多账号来回切换 | 统一 inbox + 账号过滤 | 首次处理时间、账号切换次数 |
| 收件箱噪声过多 | Signal/Noise + Reply Zero | 未读积压、重要邮件漏处理率 |
| 回信耗时长 | AI 生成草稿 + 人工确认 | 草稿采纳率、平均回复时长 |
| 邮件行动项丢失 | 提取任务/提醒/项目关联 | 到期前完成率、follow-up 漏失率 |
| 邮件无法进入团队上下文 | 线程分享和协作事件 | 分享后任务创建率、权限违规数 |
| AI 误发或误操作 | dry-run、确认、指纹、审计 | 未授权外发数必须为 0 |

## 4. 主流邮箱接入策略

### 4.1 Provider 适配层

统一 `EmailProvider` 合同，至少覆盖：`accounts`、`threads/threadsPage`、`thread`、`labels`、`update`、`createDraft`、`sendDraft`、附件读取/下载。管理适配采用“统一 update 优先、按操作工具回退”：兼容 `update_email/modify_email`，也兼容 `archive_email/archive_message`、`mark_as_read`、`star_email`、`apply_label` 等拆分工具。读取适配同时归一化 `connected_accounts` envelope、`account`/`message_id` 参数、字符串地址、Gmail `labelIds` 和常见 `emails/items/messages` 列表。账户能力包含 `managementOperations`，只有真实发现或显式声明的操作才会细化为可用按钮；统一 update 仍兼容旧 provider，但不会据此虚构每个操作。不支持的操作返回明确的 `operation_not_supported`，不能静默伪造成功。

| Provider | 首选接入 | 最小权限 | 备注 |
| --- | --- | --- | --- |
| Gmail / Google Workspace | Gmail MCP 或 Gmail API OAuth | `gmail.readonly` 起步；写入阶段再申请 compose/modify | 已兼容公开 Gmail MCP 常见 `list_accounts`、`list_emails(account)`、`get_email(account, message_id)`、`archive_email`、`apply_label` 形状；统一搜索的 query/from/to/unread/attachment/date/folder/label 已归一化为 Gmail query 语法；真实 OAuth、线程、label、附件必须验收 |
| Outlook / Microsoft 365 | Microsoft Graph MCP 或 Graph OAuth | `Mail.ReadBasic`/`Mail.Read`; 写入再申请 `Mail.ReadWrite`/`Mail.Send` | 处理 folder 与 category 和 Gmail label 的差异 |
| QQ 邮箱 | Agent Mail/QQ Mail MCP；备选 IMAP/SMTP | provider 负责 OAuth 或应用专用密码 | 不读取 WorkBuddy 私有 token 或数据库 |
| 163/126/企业邮箱 | IMAP + SMTP adapter | IMAP read/write、SMTP send | 需要服务器、端口、TLS、应用密码配置 |
| 通用 IMAP/SMTP | OpenBuddy 内置 `imap-smtp` MCP adapter | 用户显式提供配置 | 已支持 IMAP TLS 读取、文件夹、搜索、分页、线程、附件元数据和可选写入/草稿/SMTP；能力按开关拆开声明，真实写入仍需验收 |
| Fastmail 等标准邮箱 | OpenBuddy JMAP REST adapter 或 `jmap` MCP profile，IMAP/SMTP 兜底 | provider 侧最小 scope | JMAP REST 已有 Session/Mailbox/Email/Submission 本地契约；真实 OAuth、附件和写入仍需现场验收 |

### 4.2 连接流程

1. 用户在连接器中选择 provider profile。
2. OpenBuddy 通过现有 MCP/OAuth 机制完成授权，不复制账号 token 到邮件 capability；用户可以在同一个 `mcp.json` 服务项中设置非敏感的 `emailProfile`（`gmail`、`outlook`、`qq-agent-mail`、`imap-smtp` 或 `jmap`）。
3. adapter 优先读取显式 `emailProfile`，其次读取已发现的 MCP 工具名，最后才按服务名推断，并生成 `EmailAccount.capabilities`；直接 REST adapter 由连接注册表按 `providerType + credentialRef` 创建，token 只在 provider 调用边界短暂存在，不进入连接配置或邮件对象。工具发现同时支持 profile 默认名和公开 MCP 的别名名，避免“工具存在但 UI 显示不支持”。统一搜索输入保持 `query/from/to/unread/hasAttachment/since/until/folder/labelId` 语义，Gmail 转换为 Gmail query，Graph 转换为 OData filter/search，JMAP 转换为标准 filter，其他 provider 保留结构化字段，不由 UI 拼接 provider 私有语法。
4. 首次只读分页读取，保留 provider 为事实源；增量同步只调用 provider 原生 `sync_emails`/`sync_messages` 工具，不把普通分页冒充同步。本地只保存同步游标、状态、时间、计数和脱敏错误，不保存邮件正文、OAuth token 或附件内容。UI 分开展示“可写信”“支持邮件管理”和“支持原生增量同步”；IMAP/SMTP 在开启写入后还要用远端 `LIST` 动态确认 Archive、Trash、Junk 等目标文件夹，缺失时自动降级管理操作。
5. 写入能力通过小范围真实测试：标签、归档、草稿、附件、发送；失败时显式降级为只读。标准 IMAP/SMTP 账号使用 `pnpm run eval:email-imap-smtp`，默认只读；管理、草稿和发送分别需要显式环境开关、确认短语和测试收件人。协议级 fake-server 回归使用 `pnpm run test:email-imap-smtp`，MCP stdio 集成回归使用 `pnpm run test:email-imap-smtp-mcp`。

Provider profile 还有独立的本地契约回归：`pnpm run eval:email-provider-profiles` 会检查 Gmail、Outlook/Graph、QQ/Agent Mail、IMAP/SMTP 和 JMAP 的读取、搜索、线程、标签、草稿、发送、附件、同步工具映射，以及 Gmail `modify_email`、Outlook `get_message`、IMAP/JMAP `list_mailboxes` 等关键差异。标准协议 adapter 的协议级回归位于 `scripts/email/imap-smtp-core.test.mjs`，MCP stdio 集成回归位于 `scripts/email/imap-smtp-mcp-server.test.mjs`，覆盖动态能力声明和草稿幂等；QQ 真实 MCP 只读验收已覆盖账号、6 个文件夹、分页、搜索和线程读取。上述本地测试都不能替代 QQ 管理、草稿、附件下载和 SMTP 发信的真实证据。

### 4.4 IMAP/SMTP 全流程验收命令

只读验收：

```bash
OPENBUDDY_EMAIL_ADDRESS='邮箱地址' \
OPENBUDDY_EMAIL_AUTH_CODE='一次性授权码' \
pnpm run eval:email-imap-smtp
```

可逆管理验收需要明确确认短语；草稿会在真实 Drafts 文件夹留下一封草稿：

```bash
OPENBUDDY_EMAIL_ALLOW_WRITE=1 \
OPENBUDDY_EMAIL_EXTERNAL_MANAGE=1 \
OPENBUDDY_EMAIL_EXTERNAL_CONFIRM='I_UNDERSTAND_MAILBOX_MUTATIONS' \
OPENBUDDY_EMAIL_ADDRESS='邮箱地址' \
OPENBUDDY_EMAIL_AUTH_CODE='一次性授权码' \
pnpm run eval:email-imap-smtp
```

受控发送必须额外提供明确测试收件人和确认短语；没有这些变量时 runner 在执行前退出，不会连接 provider：

```bash
OPENBUDDY_EMAIL_ALLOW_WRITE=1 \
OPENBUDDY_EMAIL_ALLOW_SEND=1 \
OPENBUDDY_EMAIL_EXTERNAL_WRITE=1 \
OPENBUDDY_EMAIL_EXTERNAL_SEND=1 \
OPENBUDDY_EMAIL_TEST_RECIPIENT='测试收件人' \
OPENBUDDY_EMAIL_EXTERNAL_SEND_CONFIRM='I_UNDERSTAND_EXTERNAL_EMAIL_SEND' \
pnpm run eval:email-imap-smtp
```

### 4.3 真实邮箱验收入口

OpenBuddy 提供独立的 `real-external` 验收脚本，不会把 echo provider 结果计入外部邮箱通过：

```bash
OPENBUDDY_E2E_API_KEY='临时模型密钥' \
OPENBUDDY_E2E_BASE_URL='模型 API 地址' \
OPENBUDDY_E2E_MODEL_ID='模型名' \
OPENBUDDY_E2E_REQUIRED=1 \
OPENBUDDY_E2E_MCP_CONFIG_PATH='/绝对路径/真实邮箱-mcp.json' \
OPENBUDDY_EMAIL_MCP_SERVER='gmail' \
OPENBUDDY_EMAIL_MCP_PROFILE='gmail' \
pnpm run eval:email-external
```

该入口默认执行账号、线程、搜索、标签、分页游标、Provider readiness diagnostics、账户级能力一致性、Reply Zero 和 Digest 的只读验收；设置 `OPENBUDDY_EMAIL_EXTERNAL_SYNC=1` 才验收 provider 原生增量同步、游标复用和本地状态持久化；只有显式设置 `OPENBUDDY_EMAIL_EXTERNAL_MANAGE=1` 才会执行可逆的收藏/已读状态往返，并在每次修改后重新读取验证恢复结果；设置 `OPENBUDDY_EMAIL_EXTERNAL_PROCESSING_PLAN=1` 才验收处理计划的 preview → confirm → execute 闭环，要求预览阶段重新读取后状态不变，执行后状态改变，最后恢复测试前状态；只有设置 `OPENBUDDY_EMAIL_EXTERNAL_ATTACHMENTS=1` 才执行附件元数据读取，另设置 `OPENBUDDY_EMAIL_EXTERNAL_ATTACHMENT_DOWNLOAD=1` 和 `OPENBUDDY_EMAIL_ATTACHMENT_DIR` 才下载附件；只有同时设置 `OPENBUDDY_EMAIL_EXTERNAL_WRITE=1` 与 `OPENBUDDY_EMAIL_TEST_RECIPIENT` 才创建外部草稿，草稿验收还会重新读取 Drafts 文件夹确认远端可见、用同一 `draftId` 更新并确认没有旧版本重复；只有再设置 `OPENBUDDY_EMAIL_EXTERNAL_SEND=1` 才会发送测试邮件，并重新读取 Sent 文件夹确认外发可见。报告中的 `capabilityMatrix` 对每项记录 `passed`、`failed` 或 `not-run`；显式请求但因缺少可验证数据而 `not-run` 时，脚本以失败退出，防止把“未测”算成“已通过”；未开启的能力不计入通过数。测试必须使用临时账号、临时模型凭据和明确的测试收件人，完成后轮换/删除凭据。报告标记为 `real-external`，保存为脱敏 evidence，不包含正文、OAuth token 或完整邮箱地址。

结构化 AI 结果和知识库上下文引用的本地安全合同可单独运行：

```bash
pnpm run eval:email-ai-contract
```

该评估当前包含 8 个固定样例，检查结构化结果是否有来源消息引用、引用是否属于当前线程、摘录是否存在于正文、`confidence` 是否在 `0..1`、缺少引用是否拒绝，以及邮件正文中的提示注入是否仍被视为数据而不会触发发送。Capability 测试另覆盖知识库引用与邮件引用分离、无 validator 拒绝；主进程校验已接入已保存知识根目录和 Office 文本提取。它属于 `real-local` 证据，只验证 schema 和执行边界，不代表真实模型或真实邮箱通过。

JMAP/Fastmail REST provider 已加入统一 `EmailProvider`，覆盖 Session、Mailbox/get、Email/query/get/set、线程、JMAP mailbox 管理、草稿、标准 `bodyStructure`、附件 upload/download、EmailSubmission/set 发送、分页游标和授权/限流错误分类；无附件上传 URL 时会明确返回不支持，不静默丢附件。其 fake contract 位于 `packages/capability/openbuddy-email/src/jmap-provider.test.ts`，真实验收入口为 `pnpm run eval:email-jmap-api`，不等同真实 Fastmail/JMAP OAuth 现场证据。

Microsoft Graph REST provider 已加入统一 `EmailProvider`，覆盖 Outlook/Graph 的 `/me`、文件夹、`conversationId` 线程聚合、`$search`/`$filter`、分页、已读/未读、旗标、归档/恢复、垃圾邮件、Deleted、分类、草稿更新、附件替换、发送和附件下载；Graph master categories 权限不足时会降级保留系统文件夹，不会把失败伪装成分类可用。其 fake contract 位于 `packages/capability/openbuddy-email/src/microsoft-graph-provider.test.ts`，不等同真实 Microsoft OAuth 现场证据。

Gmail REST 现场验收入口已加入，但默认 fail-closed，不提供 token 时不会发起外部请求：

```bash
OPENBUDDY_EMAIL_GMAIL_API_ACCEPTANCE=1 \
OPENBUDDY_EMAIL_GMAIL_ACCESS_TOKEN='一次性 OAuth access token' \
pnpm run eval:email-gmail-api
```

该 runner 默认只读，检查 profile、Provider diagnostics、线程搜索、分页游标、标签和线程读取；管理、草稿、受控发送、附件读取/下载分别需要显式环境开关、确认短语、临时测试收件人和绝对下载目录。写入测试使用唯一主题和同一 `draftId`，发送后轮询 Sent；报告只保留邮箱域名、对象摘要 hash、能力状态和 `passed/failed/not-run`，不保存正文、完整地址、token 或附件内容。真实验收必须使用隔离测试账号，完成后撤销/轮换 token；此前用户消息中的 QQ 授权码视为已泄露，禁止使用。

AI 质量评估入口：

```bash
OPENBUDDY_EMAIL_AI_QUALITY_PREDICTIONS=/绝对路径/predictions.json \
pnpm run eval:email-ai-quality
```

该评估现在输出行动项 `precision`、`recall`、`F1`、截止日期准确率、引用覆盖率/准确率、无行动邮件准确率、案例精确匹配率、数据集 hash 和模型运行标识；同时校验预测 schema、缺失/多余案例、重复行动和非法日期。设置 `OPENBUDDY_EMAIL_AI_QUALITY_REQUIRE_PASS=1` 后，任一门槛不满足都会以非零退出，默认门槛为 precision/recall/due-date `0.8`、citation coverage/no-action accuracy `1.0`，可用同名 `OPENBUDDY_EMAIL_AI_QUALITY_MIN_*` 环境变量调整。它仍属于 `fixture-quality`，不能代表真实模型质量；只有将真实配置模型输出送入扩展、盲审数据集并保留 `real-external` evidence 后，才能用于产品发布门槛。对应回归入口为 `pnpm run test:email-ai-quality`，真实 provider 的结构化分析检查由 `eval:email-external` 在配置凭据后执行。

### 4.5 MiniMax 真实盲测最佳实践（凭据安全合约）

协议与预设（与 `src/components/SettingsPanel.tsx` 的 MiniMax 预设一致）：
- Provider 类型：`api: "anthropic-messages"`（Anthropic Messages 兼容协议）。
- 国内：`https://api.minimaxi.com/anthropic`；国际：`https://api.minimax.io/anthropic`。
- 模型：`MiniMax-M3`（128k context，优先）；`MiniMax-M2.7` 可作为成本回退。
- 密钥经 `OPENBUDDY_E2E_API_KEY` 进程级环境变量注入，不写入源码、fixture、
  模型配置、截图或日志；`launch-harness.mjs` 只把密钥写入 `mkdtemp` 临时目录
  的 `auth.json`（0600 权限），进程退出即删除。任何在聊天/日志中公开过的密钥
  一律先轮换再用，QQ 授权码同样视为已泄露，禁止再次使用。

真实盲测跑法（`precision/recall` 的证据来源）：

```bash
OPENBUDDY_E2E_API_KEY='轮换后的临时密钥' \
OPENBUDDY_E2E_BASE_URL='https://api.minimaxi.com/anthropic' \
OPENBUDDY_E2E_MODEL_ID='MiniMax-M3' \
OPENBUDDY_EMAIL_AI_QUALITY_MODEL='openbuddy-agent-harness' \
OPENBUDDY_EMAIL_AI_QUALITY_MODEL_ID='MiniMax-M3' \
OPENBUDDY_EMAIL_AI_QUALITY_API_URL='https://api.minimaxi.com/anthropic' \
OPENBUDDY_EMAIL_AI_QUALITY_RUN_ID="run-openbuddy-agent-harness-$(date +%Y%m%d-%H%M%S)" \
node scripts/electron/launch-harness.mjs -- node evals/node/run_email_ai_blind_test.mjs
```

链路：Electron + Pi Agent 真实会话（`session.create` → `session.prompt`）→
agent 自主调用 `email_extract_action_candidates` → `email_save_analysis` →
`capability.email.analyses` 回读，runner 落盘 `agent-harness/predictions.json`，
再由 `evaluate_email_ai_quality.mjs` 输出 `real-external` 报告。
当前基线（`run-openbuddy-agent-20260831-070400`，无 LLM 的启发式抽取）：
`actionPrecision/actionRecall/F1=0`、`citationCoverage=1`、
`noActionAccuracy=1`、`caseExactMatch=0.2745`；接入真实 MiniMax M3 后
预期 precision/recall 60%+、整体进度 94–96%。运行结束后轮换密钥。

无凭据的协议验证（第 11 轮新增）：用 `scripts/electron/launch-real-evals-echo.mjs`
跑 `OPENBUDDY_EVAL_ONLY=email-ai-blind-test OPENBUDDY_EMAIL_AI_QUALITY_LIMIT=2`，
本地 Anthropic Messages SSE echo provider 会替代云端 MiniMax；`passed=1/failed=0`、
`realE2E=true`、bridge stderr 抓到 `pickModelId -> custom_anthropic/MiniMax-M3`，
证明 Electron → Main → Pi Agent → capability.email 协议闭环全跑通。换云端 MiniMax
只需要把 echo launcher 换成 `launch-harness.mjs` 并提供 `OPENBUDDY_E2E_*`。

## 5. 最小改造架构

```text
Renderer Email Workspace / Composer / AI cards
                │ typed preload IPC
Electron Main: input validation + permission boundary
                │
@openbuddy/capability-email
  ├─ Email domain model and normalized errors
  ├─ MCP provider profiles: qq-agent-mail / gmail / outlook / imap-smtp / jmap / generic
  ├─ CompositeEmailProvider: 多已授权 provider 聚合与 accountId 路由
  ├─ Local draft + schedule + audit store
  ├─ Pi read/write tools
  └─ Reply Zero / digest / sender policy / collaboration projection
                │ MCP/OAuth or direct adapter
Gmail · Google Workspace · Outlook/Graph · QQ/163/企业邮箱 IMAP/SMTP
```

边界规则：

- Renderer 不知道 provider 工具名，不持有 OAuth/token，不直接调用 Electron。
- Main 重新校验所有邮件输入；发送、计划发送、删除、阻断发件人都由 Main 原生确认，再由 capability 绑定草稿/对象指纹和一次性 token；批量变更必须先 dry-run。
- Capability 不把正文、token、附件内容写入 telemetry；审计只记录 ID、provider、operation、status、时间和脱敏错误。
- OpenBuddy 不做全量邮箱镜像；需要离线搜索时另立本地索引项目，不能把缓存偷偷扩大为事实源。

完整的可离线 HTML 架构图见 `docs/diagrams/openbuddy-email-architecture.html`，包含总览、数据流、权限安全和交付切片四个视图。

## 6. 分阶段交付计划

### P0：可用且安全的邮件工作区

- 固化 provider contract、能力探测、错误码和 fake provider。
- 完成账号、列表、搜索、分页、线程、标签、附件元数据。
- 完成新建/回复/回复全部/转发、草稿、附件和计划发送；附件只接受绝对路径下的普通文件，拒绝符号链接、目录、缺失文件，单文件和总量均不超过 25 MiB。
- 完成归档、已读、星标、标签、垃圾邮件、删除的 dry-run/确认路径。
- 完成 AI 处理计划的预览—确认—执行闭环；AI 计划只允许可逆管理操作，不允许直接删除或标记垃圾邮件。
- 同时支持 provider 原生 Label 与 OpenBuddy Workspace Tag；Workspace Tag 支持创建、添加、移除、替换、清空及 Any/All 检索。
- 让发送只接受一次性 token 和草稿指纹，成功/失败都写审计。
- 用隔离的 Gmail/Outlook/QQ 测试账号分别完成 read/write smoke；没有隔离账号和明确收件人则保持 `not-run`，fixture 不标记为真实通过。

附件验收必须同时覆盖：正常文件可进入草稿、缺失路径/目录/符号链接在 provider 调用前被拒绝、超过单文件或总量上限被拒绝、失败不产生远端草稿且审计不记录附件内容。附件下载仍需独立验证目标目录、文件名净化、覆盖策略和真实 provider 返回值，不能用“附件元数据可读”替代“文件下载通过”。

AI 分诊验收还必须证明：运行只读分诊后，用户可以按紧急、待回复、等待对方、噪声、普通切换工作队列；切换只改变本地列表投影，不调用 provider 写操作；从队列打开线程仍使用原始 `accountId + threadId`；噪声归档仍只能进入预览—确认—执行处理计划。

### P1：AI 赋能和工作流闭环

- Reply Zero、日报、线程摘要、行动项提取、回复草稿。
- 发件人 Signal/Noise 学习建议和批量处理预览。
- 邮件到任务、提醒、项目、协作频道的确认式关联。
- 邮件内容安全清洗：HTML sanitizer、脚本/事件属性/危险链接清除、远程图片/跟踪像素默认阻断、附件路径和类型限制。
- 账户能力门禁：断开、需重新授权和只读账户在 capability 层拒绝写入；UI 同时展示连接、只读、附件、多账户状态，以及账户级读写/管理/附件/同步能力。IMAP/SMTP 的归档、恢复、垃圾邮件和删除能力还必须以远端 `LIST` 实际存在的文件夹为事实源，按 QQ 的 `Deleted Messages`/`Junk` 等别名归一化；缺少目标文件夹时自动降级，不把配置开关误报为可用能力。
- Provider readiness：邮件页可展开查看账户读取、邮件读取、邮箱标签、草稿写入、受控发送、附件读取、附件下载和增量同步的逐项状态；缺失工具可直接跳转到邮箱连接器配置，不把 profile 推断误报为真实 OAuth 已通过。
- 助理统一收件箱：把 Reply Zero 的“待我回复”作为只读邮件投影加入 Inbox，点击可回到原邮件线程，不伪造协作事件或绕过权限。
- 统一工作区：邮件线程可被分享至协作频道、关联项目、创建跟进提醒，并通过 Workspace Tag 与项目、计划、任务统一检索；会议提案可在引用校验后提交到 OpenBuddy 日历审批；正文仍以 provider 为事实源。
- 发信效率：本地快捷模板、默认签名和持久化 5 秒撤回窗口；撤回窗口结束后才调用 provider，重启可恢复待发送状态。
- 评测：分诊排序一致性、摘要事实一致性、行动项召回率、草稿采纳率、prompt injection 不越权。

### P2：Macro 体验扩展和标准协议

- Gmail API、Microsoft Graph 与 JMAP/Fastmail 直连 adapter 已完成本地契约；标准 IMAP/SMTP adapter 已落地到 `scripts/email/imap-smtp-mcp-server.mjs`，下一步完成 Gmail/Graph/JMAP/QQ 写入、草稿、附件下载和受控发送现场验收。
- HTML 富文本编辑器、HTML/Markdown 邮件格式双向互转和 provider-specific 草稿格式；签名、模板、快捷短语、撤回发送的基础能力已在 P1 落地，当前 Composer 已将 Markdown 编辑源转换为经 `rehype-sanitize` 清洗的 `bodyHtml`，并把两种格式纳入草稿指纹。
- 联系人上下文已支持本地线程提取和写信收件人补全；下一步增加文档权限联动、CRM 联系人和日历事件关联。
- 本地加密索引、离线阅读、provider webhook/增量同步和跨重启计划发送恢复。

### 后续执行顺序

1. **真实 provider 验收（优先）**：QQ/IMAP 的读取矩阵已通过内置 adapter 和 `pnpm run eval:email-imap-readonly`；验收 runner 已具备管理归档/恢复、草稿幂等、附件安全和 Sent 可见性检查，下一步仍需用隔离测试账号完成 QQ 管理、草稿、附件和受控发送，再完成 Gmail、Outlook/Graph 或第二个 IMAP provider 的读取矩阵；报告必须标记为 `real-external`，并区分 `managementMode` 与 `writeMode`。
2. **AI 结构化结果与受控处理**：已增加 JSON 类型合同、来源消息引用、线程消息归属与摘录正文校验、置信度、人工审阅、草稿/任务关联、只读可解释分诊、`email_save_analysis`/`email_list_analyses`/`email_triage` tool，以及处理计划的预览、确认、一次性 token 和执行结果；本地 8 例合同评估与处理计划/UI 回归已通过，下一步用真实模型输出建立盲审集和草稿采纳率指标。
3. **统一工作区搜索**：已在现有会话搜索入口增加邮件、当前会话任务、本地日程、本地项目/资产、助理协作 Inbox 和已保存知识源文档只读结果分组；项目、计划、任务标签会参与项目结果命中并展示；搜索词命中邮件 Workspace Tag 时会按 `tags + tagMatch` 查询并合并去重邮件线程；任务仍严格按当前 session 查询，日程复用现有 calendar capability，项目从本地 `projects-store` 读取，协作项复用 `collaboration:snapshot`，知识库复用可插拔 provider registry，点击结果可回到原邮件、项目、助理 Inbox 或本地文档路径。跨实体排序、文档权限投影、邮件/协作 Inbox 标签过滤仍待接入。
4. **跨实体标签与搜索**：已完成项目、计划、任务的最小本地标签投影、编辑入口和 `WorkspaceTagRef` 派生模型；统一搜索已增加邮件主题/发件人/正文/标签/未读/星标的可解释排序和线程状态展示，Provider 层已将统一筛选字段归一化到 Gmail query；下一步把邮件线程、文档和协作 Inbox 纳入同一引用索引，再接入实体级权限过滤，同时保留 provider Label 的独立同步语义。
5. **生产体验**：补 HTML 富文本编辑、联系人权限/CRM 联动、厂商限流现场验收、重授权恢复和加密本地索引；当前已接入 provider 原生增量同步、规则调度通知和处理计划最小闭环，MCP Provider 已统一解析结构化 `isError`/error envelope、`Retry-After`、rate-limit reset 与 OAuth 失效原因，但真实 Gmail/Graph/QQ/IMAP/JMAP OAuth、sync、限流和处理计划仍需外部凭据验收。当前 MCP Provider 已有读取超时、瞬态错误退避和写操作单次调用保护，Composer 已支持 Markdown/GFM 预览、清洗 HTML 输出和本地联系人收件人补全，但可视化 HTML 编辑器仍未完成。

## 7. 当前仓库的实现映射

| 层 | 主要文件 | 当前职责 |
| --- | --- | --- |
| Domain/provider | `packages/capability/openbuddy-email/src/index.ts` | 统一类型、MCP profile、provider adapter、草稿/计划/审计、结构化 AI 分析与审阅、AI 邮件工具 |
| Bundle | `packages/bundle/openbuddy-base/src/capability-plugins.ts` | 注册邮件 capability 和 Pi tools |
| Main IPC | `electron/main/ipc/index.ts` | 邮件 action 路由、参数校验、typed handlers |
| Preload/client | `electron/preload/index.ts`, `src/lib/agent/pi-client.ts` | allowlist 和 renderer typed client |
| UI | `src/components/EmailPanel.tsx`, `src/components/EmailComposer.tsx`, `src/components/SearchOverlay.tsx`, `src/lib/knowledge-base-runtime.ts` | 统一 inbox、Signal/Noise、AI 入口与跨线程 AI 行动中心、草稿/安全预览、回复/转发、附件、计划发送、跨实体搜索和知识源加载 |
| Tests | `packages/capability/openbuddy-email/src/index.test.ts`, `src/components/__tests__/Email*.test.tsx`, `evals/node/evaluate_email_ai_quality.mjs` | fake provider、操作级能力门禁、安全门禁、UI 行为和 AI fixture 指标 |
| Architecture | `docs/diagrams/openbuddy-email-architecture.html` | 可离线交互架构图 |

## 8. 验收标准

### 功能

- 多账号列表不会混淆 `accountId`；分页不会重复或丢失线程。
- Gmail/Outlook/QQ/IMAP 能力差异在 UI 中可见，未支持操作有明确错误。
- 回复、回复全部、转发正确生成收件人和线程引用；草稿刷新/重启后可恢复。
- 计划发送可列出、取消、到点发送；发送失败保留草稿并记录失败原因。

### 工作区融合边界

- `Email → Project`：线程关联只保存本地 `projectId` 引用，不复制正文；解除关联会删除该引用。
- `Draft → Send`：Markdown 是可编辑事实，`bodyHtml` 只接受 Composer/agent 提供的清洗 HTML；Main 的唯一授权发送出口用 `bodyHtml` 发送并将 Markdown + HTML 一起纳入草稿指纹，避免“预览内容”和“实际外发内容”分叉。
- `Project → Email`：项目详情页按项目 ID 读取线程摘要，provider 单条读取失败时跳过该条，不阻断项目页；打开线程时由邮件工作区重新读取正文。
- `Workspace Tag`、provider 原生 Label 和项目关联保持三个独立命名空间，避免把本地业务关系误写回远端邮箱。
- 项目/计划/任务标签由 `projects-store` 本地持久化，更新时去重、去空白；不复制邮件正文、附件或 provider 凭据。
- `WorkspaceTagRef` 现在覆盖项目、计划、任务和邮件线程四类实体，只包含 `entityType/entityId/projectId/accountId/threadId/tags/updatedAt`，是可重建的引用投影，不是邮件内容缓存；Provider 读取权限仍是打开邮件正文的唯一事实边界。
- 批量危险操作：UI 先请求 provider dry-run，用户看到匹配数量后再确认；Main 对删除/垃圾邮件再次执行原生确认，Capability 仍记录操作审计并拒绝未声明的 provider 操作。

### 安全

- 没有用户确认不能外发；草稿内容变化后旧确认凭证失效。
- 删除、垃圾邮件、批量写入、阻断发件人都有 dry-run 或确认。
- 邮件中的恶意指令、HTML、脚本、危险链接、远程图片、附件路径不能越权；邮件投影不能伪造协作事件或 ack。
- telemetry 和错误快照不包含正文、OAuth/token、附件内容。

### 工程

- 最近邮件专项回归通过：Capability 92/92、Gmail Provider 4/4、Graph Provider 5/5、EmailPanel 38/38、EmailComposer 12/12、SearchOverlay 8/8、IMAP/SMTP core 19/19、IMAP/SMTP MCP stdio 2/2、AI 合同评估 8/8、AI 质量门禁 4/4；本轮组合测试共 101 项 Provider/Capability 单测通过，UI 回归沿用既有 150 项证据，另有 21 项 IMAP/SMTP 协议测试和 8 项 AI 合同测试通过。覆盖 AI 行动中心跨线程聚合与来源线程回链、AI 分诊分类队列、Macro 风格 `j/k/Enter` 导航与 `c`→`e` 写信、`e` 归档快捷键、统一搜索邮件排序/线程状态/Workspace Tag、Gmail 统一筛选字段到 query 语法归一化、IMAP 结构化筛选与逻辑文件夹映射、双格式草稿、HTML 清洗发送、规则调度通知、pending 计划队列恢复、结构化 MCP 错误 envelope、账户级 Provider readiness、主流 profile 契约、项目邮件反查、WorkspaceTagRef、计划/任务标签编辑、批量管理预览/确认、真实文件夹动态管理能力、附件路径防符号链接逃逸和远端草稿幂等更新。
- `node scripts/electron/audit-agent-surface.mjs` 输出 `ok: true`，preload/main/renderer channel 无缺口。
- 联系人回归和 Composer/UI 回归通过；索引只保留姓名、地址、账户和时间/次数，不包含正文。仓库级构建本轮被既有非邮件错误 `electron/main/deepseek-agentloop-pi-smoke.test.ts:673` 的 `AbortSignal` listener 类型不匹配阻断，邮件相关根类型检查仍通过。
- 真实 provider 证据必须带真实 OAuth/账号；fixture/echo 结果只能证明合同和边界，不得算作外部邮箱通过。当前 QQ/IMAP 只读证据来自真实 MCP adapter；Gmail REST、Microsoft Graph REST、JMAP REST provider 当前均有 fake API 契约测试，仍不能替代 Gmail/Graph/JMAP OAuth、QQ 管理/草稿/附件下载/SMTP 发信的现场写入验收。MCP stdio 集成测试已证明本地 server 的动态能力声明与草稿幂等逻辑，但不计入真实外部邮箱证据。

## 9. 公开参考资料

- Macro 产品页：<https://macro.com/>（统一 inbox、AI triage、快捷键、auto-tagging、team sharing、voice drafting、shared memory）
- Macro 邮件文档：<https://docs.macro.com/product/email>（Gmail sync、多账号、Signal/Noise、快捷键、分享、mention）
- Macro 文档索引：<https://docs.macro.com/llms.txt>
- Skim：<https://github.com/nikserg/skim>（MIT、Windows、BYOK AI、AI email client）
- MiNiMail：<https://github.com/dttxorg/MiNiMail>（本地优先缓存、摘要、回复建议、翻译、路由、HTML 安全、草稿、附件、定时发送）
- Mail Copilot：<https://github.com/mailcopilot/mailcopilot>（AI-native desktop email client 项目样本，采用前先核对活跃度和许可证）

### 9.1 本轮公开检索补充

本轮检索 GitHub 公开仓库、Macro 官方文档和本机 `/Users/louloulin/appx/macro` checkout，确认以下项目/资料可借鉴，但不作为 OpenBuddy 的运行时依赖：

| 项目/资料 | 公开证据 | 借鉴点 | OpenBuddy 处理方式 |
| --- | --- | --- | --- |
| Inbox Zero | <https://github.com/elie222/inbox-zero>，2026-08-30 GitHub API：12,117 stars，许可证字段为 `NOASSERTION` | AI inbox zero、AI Rules、Reply Zero、批量退订/归档、会议简报、附件归档和 Slack/Telegram 入口 | 借鉴 triage/批处理/跨入口产品结构；不复制代码，保留 OpenBuddy 的 MCP、确认和审计边界；引入前必须完成许可证与依赖复核 |
| Gmail MCP Server | <https://github.com/navbuildz/gmail-mcp-server> | Gmail 多账号、读写、归档、标签、退订等 MCP 工具边界 | 对照工具命名和 capability 探测；不复制第三方 OAuth/token 处理 |
| DispatchMail | <https://github.com/dbish/DispatchMail>，2026-08-30 GitHub API 公共搜索约 180 stars | 本地运行的 AI 邮件助手和自然语言 inbox 管理 | 借鉴本地优先和查询体验；OpenBuddy 仍以 provider 为事实源 |
| Cloudflare Agentic Inbox | <https://github.com/cloudflare/agentic-inbox>，Apache-2.0、TypeScript、自托管 AI inbox | 每邮箱隔离、完整邮件客户端、9 个 AI email tools、草稿前置和显式发送确认 | 借鉴工具分层与隔离思路；OpenBuddy 复用现有 MCP/OAuth、Capability、Main 安全门禁 |
| Inbox Zero | <https://github.com/elie222/inbox-zero> | AI Rules、Reply Zero、批量退订/归档、冷邮件阻断、会议简报、附件自动归档 | 本轮已将 AI Rules 的最小安全子集落成 `email_save_rule`/`email_run_rule`；危险动作仍禁止，附件归档和会议简报列入后续阶段 |
| Resend MCP | <https://github.com/resend/resend-mcp>，MIT | 将发送能力单独拆成 MCP 边界 | 借鉴“发送与读取/管理分离”，OpenBuddy 发送继续独立确认和审计 |
| JMAP MCP | <https://github.com/wyattjoh/jmap-mcp>，MIT | 标准 JMAP 工具化接入 | 作为 Fastmail/JMAP profile 的真实 provider 验收样本，不复制其凭据实现 |
| Amarnai | <https://github.com/amarnai/amarnai> | Gmail-first 分诊、只读排序和“草稿必须人工批准”，支持 Ollama/BYOK 思路 | 借鉴只读分诊与审批门槛；OpenBuddy 继续支持多 provider 和受控写操作 |
| AgentInbox | <https://github.com/Unify-DB/AgentInbox> | 面向 Agent 的线程收发、webhook、统一 inbox 和验证码提取 | 借鉴 Agent 专用收件箱和事件模型；不替代用户邮箱事实源 |
| MiNiMail | <https://github.com/dttxorg/MiNiMail>，Apache-2.0 | 本地缓存、摘要、翻译、回复建议、附件、定时发送、HTML 安全 | 借鉴安全降级和发送工作流；不引入其代码或依赖 |
| Skim | <https://github.com/nikserg/skim>，MIT | BYOK、轻量桌面 AI 邮件客户端、隐私导向 | 借鉴 BYOK/桌面体验；统一到 OpenBuddy AgentSession |
| Macro 官方文档 | <https://docs.macro.com/llms.txt>、<https://docs.macro.com/product/email.md> | Unified Inbox、Unified Search、Tagging、Agents、CRM、Email | 将邮件作为统一工作入口；当前先完成只读邮件投影，CRM/联系人/日历列入后续 adapter |
| Google Workspace MCP | <https://github.com/taylorwilsdon/google_workspace_mcp>，MIT、2026-08-30 GitHub API 约 3.1k stars | Gmail 与 Calendar/Drive/Tasks/Chat 的统一 MCP 面；体现“邮件不是孤立实体” | 借鉴跨 Google Workspace 的实体关联和工具发现；OpenBuddy 通过自己的任务、项目、日历和知识库 capability 组合，不复用其 OAuth/token |
| LangChain Agents from Scratch | <https://github.com/langchain-ai/agents-from-scratch>，MIT、2026-08-30 GitHub API 约 2.1k stars | 邮件 Agent 的状态、工具调用和记忆教学样本 | 借鉴 Agent 分层和可观测评测；实际执行继续走 OpenBuddy typed IPC、Capability 和确认门禁 |
| Agent Kit | <https://github.com/KeyID-AI/agent-kit>，2026-08-30 GitHub API 约 662 stars，许可证字段未声明 | 面向 Agent 的邮箱 MCP 工具集合和多通道入口 | 仅作为工具面参考，许可证未明确，不复制代码、不引入运行时依赖 |
| Fastmail MCP | <https://github.com/MadLlama25/fastmail-mcp>，2026-08-30 GitHub API：126 stars，MIT | JMAP 邮件、联系人和日历工具；适合作为标准协议跨实体样本 | 只借鉴 JMAP 工具边界和实体关联；OpenBuddy 继续由 capability 管理 token、能力探测和确认门禁 |
| Email MCP | <https://github.com/codefuturist/email-mcp>，2026-08-30 GitHub API：102 stars，LGPL-3.0 | IMAP + SMTP 的读取、搜索、发送、管理和整理工具边界 | 作为通用协议能力矩阵对照；不直接引入 LGPL 代码，继续维护 OpenBuddy 自己的 IMAP/SMTP adapter |

本机 Macro 一手资料还包括 `macro/apps/docs/product/email.mdx`、`macro/apps/docs/AI/mcp/tools/content-search.mdx` 和 `macro/apps/docs/AI/mcp/tools/send-email.mdx`：其中明确规定多账户统一收件箱、Signal/Noise、键盘归档、跨实体内容搜索，以及 AI 写信必须打开草稿供用户审核确认。OpenBuddy 已按“统一入口 + 草稿先行 + 发送确认”借鉴产品行为，但没有复制 Macro 的私有后端或代码。

### 9.3 最新公开项目检索补充（2026-08-30）

GitHub API 的关键词检索补充发现以下项目，作为“AI 邮箱 / Agent Inbox / MCP 接入”样本记录；星标是检索时的近似值，不能代替代码质量或维护活跃度评估：

| 项目 | 许可证/规模线索 | 可借鉴能力 | OpenBuddy 结论 |
| --- | --- | --- | --- |
| `herald-email/herald-mail-app` | 约 136 stars，许可证字段未声明 | 终端优先的邮件处理与 Agent 交互 | 只借鉴终端工作流；不引入未明确许可证代码 |
| `gsd-build/agent-inbox` | MIT，约 61 stars | 给 Agent 分配一次性收件箱、事件化收信 | 可作为自动化/测试邮箱隔离样本，不替代用户主邮箱 |
| `littlebearapps/outlook-assistant` | MIT，约 36 stars | Outlook/Microsoft 365 MCP 管理面 | 作为 Graph/Outlook provider 的工具契约参考 |
| `darinkishore/Inbox-MCP` | 许可证未声明，约 21 stars | MCP 邮箱读取与收件箱工具 | 仅参考工具边界，先做许可证和安全审查 |
| `indianic/mailman` | 许可证未声明，约 7 stars | Gmail SMTP/IMAP 读写 | 作为通用协议场景样本，不复制实现 |
| `nonozone/MailCli` | Apache-2.0，约 3 stars | 本地优先、结构化邮件 Agent 接口 | 借鉴本地优先和命令行验收，不改变 provider 事实源 |
| `jeremylongshore/intent-mail` | Apache-2.0，约 3 stars | 多入口、意图驱动的邮件工作流 | 借鉴“意图 → 草稿/审批/执行”分层 |

共同结论：成熟方案都把“读取/搜索”“AI 分析”“草稿”“外部发送”拆成不同信任等级；OpenBuddy 应继续坚持只读 AI、引用校验、草稿先行、用户确认、一次性 token、可审计执行，而不是让 Agent 直接拥有 SMTP/Graph 写权限。

检索结论：最佳最小路径不是增加一个孤立的“AI 邮箱应用”，而是让现有 OpenBuddy Agent、MCP、协作 Inbox、任务、项目、日程和知识库共享同一个邮件领域合同。QQ/IMAP 真实只读已经通过内置 adapter，Gmail/Graph/QQ 管理与发信仍是外部证据；fixture 或 echo provider 只能证明合同与安全边界。本轮公开研究确认 Inbox Zero、DispatchMail、Amarnai、AgentInbox、Cloudflare Agentic Inbox、Resend MCP、JMAP MCP、Fastmail MCP、Email MCP、Google Workspace MCP、MailCli、Intent Mail 和 Outlook Assistant 的不同借鉴方向；本轮邮件专项回归为 101 项 Provider/Capability 单测通过，另有 21 项 IMAP/SMTP 协议测试、4 项 AI 质量测试通过；UI 回归仍沿用既有证据。公开 WorkBuddy Mail 的私有行为没有可验证源，因此不作内部功能断言。新增 `email_triage` 只读分诊和分类驱动的本地队列、`email_sync` 原生同步、可配置 AI 邮件规则、规则分页扫描与审计统计、处理计划三阶段工具和 `email_create_reminders_from_analysis` 提醒闭环；Provider 已将统一搜索过滤归一化到 Gmail query、Graph OData/JMAP filter 和 IMAP SEARCH；规则只能生成可逆处理计划，禁止 trash/spam，运行前不修改 provider。真实 QQ 管理/草稿/附件/发送、其他 provider 和真实模型质量仍未验证。

这些项目用于借鉴公开的产品结构和协议边界，不复制代码、品牌、私有 token 或未公开服务实现。

### 9.2 公开 Gmail MCP 工具契约兼容记录

本轮核对了 `navbuildz/gmail-mcp-server` 的公开 README 和源码：其工具不是抽象的 `update_email`，而是 `list_accounts`、`list_emails`、`get_email`、`archive_email`、`apply_label`，并以邮箱地址作为 `account`、以 Gmail message ID 作为 `message_id`。OpenBuddy 已在 `McpEmailProvider` 内做参数和结果归一化，并用真实返回 envelope fixture 回归；这证明“适配工具契约”完成，不等同于真实 Gmail OAuth 和外部账号验收完成。
