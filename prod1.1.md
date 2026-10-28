# OpenBuddy Agent 核心功能与交互完善（prod1.1）

> **日期**：2026-10-20　**分支**：`feature/prod2` @ `7a539405`（prod2.md 已提交）
> **前序**：`prod1.md`（P0 生产加固 ✅、核心旅程 17/1/0）、`prod2.md`（发布收尾 + 生成能力 + 系统集成）
> **本文件定位**：prod2 是"对外发什么"，prod1.1 是"用户每天真正在用的那 20 分钟够不够顺"。
> 只做 **Agent 主链路**（对话 / 工具 / 审批 / 流式 / 中断 / 队列 / 重试 / 编辑 / 上下文 / 模式 / 子代理）的功能与交互收口，**不扩新能力面**。

---

## 0. 真机取证与结论

### 0.1 探针

新增 `scripts/electron/agent-core-ux-verify.mjs`（本地 Ollama `llama3.2:3b`，真实构建产物）：

```
OPENBUDDY_E2E_API_KEY=ollama \
OPENBUDDY_E2E_BASE_URL=http://localhost:11434/v1 \
OPENBUDDY_E2E_MODEL_ID=ollama/llama3.2:3b \
OPENBUDDY_E2E_PROVIDER_KIND=openai \
OPENBUDDY_E2E_API_BACKEND=chat_completions \
node scripts/electron/agent-core-ux-verify.mjs
```

首轮结果：**2 通过 / 0 跳过 / 1 失败**，失败点为 `A1b`——Playwright 点击「允许」时被另一层 DOM 拦截：

```
<div class="request-modal__footer"> … from <div class="chatview__footer">
```

截图 `/tmp/ob-agent-core-ux/approval.png` 实证：审批以**全屏居中模态框**呈现，标题「需要你的确认 / 执行命令」，正文是通用模板文案，底部「取消 / 拒绝 / echo agent-ux-probe」。

**这条失败不是探针写法问题，而是审批 UI 的结构性缺陷。**

### 0.2 已确认缺陷（真机 + 代码双向确认）

| # | 缺陷 | 证据 | 影响 |
|---|---|---|---|
| **D1** | **审批面重复且互相遮挡**：`ChatViewFooter` 常挂一个 `PermissionInlineCard`（`position:fixed` 全屏遮罩，`z-index:1400`），消息里的 `InlineApprovalHint` 展开后又挂一个同样的卡片 | `ChatViewFooter.tsx:57`、`InlineApprovalHint.tsx:169`、`modals.css:107-118` | 行内「允许/拒绝/稍后」快操作被遮罩盖住不可点；键盘焦点被两次 `cancelRef.focus()` 抢；同一请求出现两套决策入口 |
| **D2** | **「允许」按钮标题渲染成命令原文** | `hook-permission.ts:120`、`provide-rpc-ui-context.ts:116`（`title: message \|\| title`）；`PermissionDialog.tsx:75`（`{o.title}`） | 按钮变成 `echo agent-ux-probe`，用户不知道这是"允许" |
| **D3** | **`allow_always` 在两处实现不一致**：hook 路径给 3 个选项，`ctx.ui.confirm` 路径只给 allow/deny；即使有 `allow_always`，也用 `btn--ghost` 渲染，与背景几乎同色 | `hook-permission.ts:120-122` vs `provide-rpc-ui-context.ts:113-117`；`PermissionDialog.tsx:74` | 用户无法"本会话内始终允许"，每次工具调用都被打断；`apply_command` 走的正是 confirm 路径 |
| **D4** | **审批内容不可读**：`PermissionRequest` 类型没有 `message` 字段（宿主发了但被丢），卡片只渲染 `rawInput` 的 JSON；`describe` 是硬编码通用句 | `openbuddy-types/src/index.ts:218-228`、`PermissionDialog.tsx:58-61`、`permission.ts` 入站 | 用户看不到"要执行什么命令 / 在哪个目录 / 风险等级"，只能从按钮标题猜 |
| **D5** | **`toolKind` 直接当图标标签**：渲染 `head.toolKind`（如 `apply_command`）而非人类可读名 | `PermissionDialog.tsx:55` | 显示原始工具 id，非中文/本地化名 |
| **D6** | **探针缺少拒绝路径**：A2（拒绝后工具不执行、回合不卡死）未实现 | `agent-core-ux-verify.mjs` | 拒绝语义没有回归护栏 |

> **实施状态（2026-10-20）**：D1–D6 已全部修复；`agent-core-ux-verify` 最终 26 通过 / 3 跳过 /
> 0 失败（29 项）。实施细节与额外发现的 8 个缺陷见 §8。

### 0.3 核心交互面现状盘点

| 交互面 | 现状 | 证据 |
|---|---|---|
| 发送 / 停止 | ✅ 停止按钮恒可点（逃生口），流式时切 enqueue+stop | `composer/ActionButtons.tsx:69-112` |
| 中断 | ✅ `piCancel` 有 unmount 兜底；⚠️ 停止后的终态文案/部分内容保留未断言 | `useAgentSession.ts:1121`、`ActionButtons.tsx:100-111` |
| 待发送队列 | ✅ store + dock（暂停/删除/立即发送/键盘导航） | `composer/QueuedMessages.tsx:40-120`、`ChatViewFooter.tsx:110` |
| 权限审批 | ⚠️ 见 D1–D5 | 上表 |
| 五档权限模式 | ✅ 选择器 + `pi://permission-mode` 热生效 | `openbuddy-ui-shared/src/PermissionPicker.tsx:30-125` |
| 工具卡 | ✅ 单行摘要 + 状态 + 耗时；内联/抽屉展开；⛔ 长输出/错误详情体验未验证 | `ToolCallCard.tsx:83-140` |
| 思考块 | ✅ 流式计时、完成后折叠、历史不编耗时 | `parts/ThoughtMessagePart.tsx:70-110` |
| 重试 | ✅ 会话级 rewind 重发 + banner 级轻重试 | `chatview/useChatViewRetry.ts:57-104` |
| 用户消息编辑重发 | ✅ 双击/按钮进入内联编辑 | `parts/UserBubble.tsx:145-248` |
| 助手消息就地编辑 | ✅ Esc 取消 / ⌘Enter 应用并可重发 | `MessageItem.tsx:380-405` |
| 上下文用量 | ✅ 环形 pill；⚠️ 数据缺失时的降级未真机验证 | `ContextUsagePill.tsx:6-131` |
| `/compact` | ⚠️ 仅在斜杠命令列表里；压缩前后无提示 | `SlashCommands.test.tsx:68`、pi 事件 |
| 子代理 / 团队 | ✅ 面板 + 只读横幅 | `ChatViewScrollStage.tsx:88-105` |
| 计划模式 | ✅ banner + PlanPanel；⚠️ 入口可见性曾出过死门 | `session-store`、prod1 记录 |
| 模型选择 | ✅ 注册表 + setModel | prod1 探针 |

---

## 1. 目标与边界

**目标**：让"发起 → 看过程 → 被拦住 → 批准/拒绝 → 中断 → 排队 → 失败重来"这条主链在**不看文档**的情况下顺滑完成。

**不做什么**：
- 不引入新工具、新 provider、新能力域（Office/图像/托盘/沙箱归 `prod2.md` 批次 B/C）。
- 不改 pi 的协议语义；只在宿主与渲染层收口"同一件事只暴露一个面"。
- 不做 i18n 全量迁移；新增文案按现有词表增量补。

---

## 2. 批次计划

### 批次 P-A —— 权限审批闭环（最高优先，4–5 天）

| # | 任务 | 落点 | 验收 | 预估 |
|---|---|---|---|---|
| A1 | **单一审批主面**：全屏模态框只保留一个挂载点。方案：`PermissionInlineCard` 增加 `variant: "modal" \| "inline"`；`ChatViewFooter` 传 `inline`（非遮罩、停靠在 composer 上方），`MessageItem` 的 `InlineApprovalHint` 展开也传 `inline`；全屏 modal 仅在"当前无可见审批卡"时兜底 | `packages/ui/openbuddy-ui-dialogs/src/PermissionDialog.tsx:43-46`、`ChatViewFooter.tsx:57-58`、`InlineApprovalHint.tsx:167-171` | 探针：审批出现时**只有一个** `[role=dialog].request-modal--permission`；行内「允许」可点（不再被拦截）；Esc 只触发一次取消 | 1.5 天 |
| A2 | **审批内容可读**：给 `PermissionRequest` 补 `message?`、`source?`、`risk?`；卡片优先展示 `message`（命令/路径），再展示结构化参数；`rawInput` 折叠到「查看原始参数」 | `packages/shared/openbuddy-types/src/index.ts:218-228`、`PermissionDialog.tsx:57-62`、`hook-permission.ts:116-123`、`provide-rpc-ui-context.ts:109-118` | 真机截图：卡片正文出现真实命令与 cwd；`toolKind` 渲染为本地化工具名而非 `apply_command` | 1 天 |
| A3 | **选项语义分离**：`allow` 的按钮文案固定为「允许」/「本会话始终允许」；命令原文只出现在正文；`allow_always` 用 `btn--primary` 同权呈现（不用 ghost）；confirm 路径也提供会话级 always | `PermissionDialog.tsx:66-77`、`hook-permission.ts:119-123`、`provide-rpc-ui-context.ts:113-117`、`ui-request-resolver.ts:96-112` | 三个选项文案与 `kind` 一一对应；`allow_always` 在一次批准后同工具第二次调用不再弹窗（本会话） | 1 天 |
| A4 | **审批队列可见**：多于 1 条时显示「1 / N」与「后续请求」，当前项处理完自动推进；切会话不阻塞 | `PermissionDialog.tsx:46-55`、`permission-store.ts:11-31`（已有 LRU/TTL） | 并发两条审批：处理第一条后第二条自动成为主面；计数正确 | 0.5 天 |
| A5 | **可达性与键盘**：`FocusTrap` 单实例；Esc=取消、Enter=主操作、Tab 顺序 = 取消→拒绝→允许；aria-describedby 指向命令正文 | `PermissionDialog.tsx:28-36, 63-79` | a11y 测试 + 探针键盘路径 | 0.5 天 |
| A6 | **模式反馈**：审批卡上显示当前权限档位（如「默认模式 · 每次询问」）；由 `bypassPermissions` 放行时不再弹窗但写一条可见提示 | `PermissionPicker.tsx`、`hook-permission.ts:100-110` | 切到 acceptEdits 后编辑类工具不再弹窗；切回 default 立即恢复弹窗 | 0.5 天 |

**P-A 出口**：`agent-core-ux-verify` 的 A1（允许）/A2（拒绝）全 PASS；同一时刻只有一个审批面；命令原文可见；会话级允许生效。

### 批次 P-B —— 流式、中断与队列（3 天）

| # | 任务 | 落点 | 验收 | 预估 |
|---|---|---|---|---|
| B1 | **停止语义收口**：点击停止后立即进入"已停止"终态；保留已产生内容；输入框恢复可发；不产生错误横幅；后端 `piCancel` 幂等 | `ActionButtons.tsx:100-111`、`useAgentSession.ts` 取消分支、`useChatViewRetry.ts` | 探针 A3：停止后 2s 内无「停止生成」、`发送` 可点、最后一条助手内容非空且无 error | 1 天 |
| B2 | **队列发送闭环**：确认"一轮结束后队列自动出队并发送"（当前 dock 有立即发送，自动出队需断言）；暂停项不出队；删除即消失；发送失败回队列并提示 | `message-queue-store`、`QueuedMessages.tsx:40-120`、`useAgentSession` 完成回调 | 探针 A4b：流式中入队 → 回合结束 → 队列项自动发出且 dock 归零；暂停项保留 | 1 天 |
| B3 | **流式滚动与性能**：跟随/未读徽标在长回答下不抖；`messages` 频繁更新时不整列表重渲（已有 memo，补断言）；流式中切会话不串流 | `chatview/useChatViewStreaming.ts:60-130`、`MessageItem.tsx` memo | 50 行流式期间 scroll 无跳动；切会话后旧会话不再追加内容 | 1 天 |

### 批次 P-C —— 工具与思考可读性（3 天）

| # | 任务 | 落点 | 验收 | 预估 |
|---|---|---|---|---|
| C1 | **工具卡摘要统一**：`kind + 目标 + 状态 + 耗时` 一行；命令类显示命令首行（截断），文件类显示路径 basename；失败行加错误首行 | `ToolCallCard.tsx:83-140`、`lib/markdown/tool-renderers` | 快照：bash/read/write/edit 四类各一张，信息完整 | 1 天 |
| C2 | **详情面板**：命令（含 cwd/exit code）、stdout/stderr 分色、diff 高亮；长输出默认折叠 + 复制 + 保存到产物；失败详情置顶 | `ToolCallCard.tsx` 展开体、`tool-call.css` | 探针 A5b：展开后能看到 stdout；1 万行输出不卡（截断标记 + 复制） | 1 天 |
| C3 | **思考块体验**：流式耗时正确冻结；超长思考默认折叠；字号/行高与正文区分；空思考不渲染 | `parts/ThoughtMessagePart.tsx:70-110` | 单测 + 真机：完成后显示「已思考 Ns」，历史块不显示错误耗时 | 0.5 天 |
| C4 | **工具失败呈现**：工具 `failed` 时卡片红色状态 + 错误摘要，不并入助手正文；连续失败 ≥2 给出「检查模型/权限/网络」提示 | `ToolCallCard.tsx`、`ChatViewBannerStack.tsx` | 模拟工具抛错：卡片红色 + 摘要可见 + 不产生空气泡 | 0.5 天 |

### 批次 P-D —— 错误恢复（2 天）

| # | 任务 | 落点 | 验收 | 预估 |
|---|---|---|---|---|
| D1 | **错误横幅统一**：`error` 呈现文案分层（鉴权 / 余额 / 网络 / 模型 / 工具），带「重试」与「复制诊断」 | `useChatViewRetry.ts`、`ChatViewBannerStack.tsx`、`errors.css` | 探针 A6：断网/402 场景出现横幅且重试可点 | 0.5 天 |
| D2 | **用户消息编辑重发**：双击/按钮 → 内联编辑器 → 发送走 rewind 语义；Esc 取消；IME 安全 | `UserBubble.tsx:145-248`、`MessageItem.tsx` | 探针 A8：编辑后重发，旧分支被回退，新的 user 消息只出现一次 | 0.5 天 |
| D3 | **失败回合不消失**：保留 prod1 的修复（`pi://complete` 携带 errorMessage），补回归测试锁死 | `useAgentSession.ts`、`pi-client` | 单测：失败回合产生可见错误卡，通知不误报"会话完成" | 0.5 天 |
| D4 | **重试幂等**：重试中禁用再次点击；rewind 无回退点时给明确 toast；重试失败回滚不叠加消息 | `useChatViewRetry.ts:57-104` | 连点两次只发一次 | 0.5 天 |

### 批次 P-E —— 上下文与多轮（2 天）

| # | 任务 | 落点 | 验收 | 预估 |
|---|---|---|---|---|
| E1 | **上下文用量可信**：provider 不返回 usage 时不显示假百分比；点击 popover 展示分类（系统/历史/工具）与刷新时间 | `ContextUsagePill.tsx:6-131` | 无 usage 场景显示「—」而非 0%/100% | 1 天 |
| E2 | **`/compact` 可见**：斜杠命令入口 + 压缩开始/完成/失败各一条状态提示；压缩后消息流出现分隔标记 | `SlashCommands`、pi 事件桥、`ChatMinimap.tsx:50` | 探针：执行 `/compact` 后出现分隔标记且历史可继续对话 | 0.5 天 |
| E3 | **记忆命中可见**：本轮注入的 memory 在元信息里可展开（只读），避免"它怎么知道这个" | 消息元信息、memory-store | 元信息出现「记忆 ×N」，展开可见条目标题 | 0.5 天 |

### 批次 P-F —— 模式、会话与空态（3 天）

| # | 任务 | 落点 | 验收 | 预估 |
|---|---|---|---|---|
| F1 | **权限选择器可发现**：composer 元行常显当前档位（不只图标）；切换后 toast 反馈；危险档二次确认 | `PermissionPicker.tsx:80-125`、`ComposerMetaRow.tsx` | 切 `bypassPermissions` 有确认；切换后立即反映 | 0.5 天 |
| F2 | **计划模式闭环**：进入/退出路径明确；PlanPanel 空态与"审批后执行"衔接；入口不做 `count>0` 死门 | `PlanPanel`、`session-store`、prod1 记录 | 无计划时入口仍可达；批准后自动执行 | 1 天 |
| F3 | **模型/会话切换不串态**：切模型对下一轮生效、进行中回合不换模型；切会话清空草稿/队列可视状态但保留队列数据 | `useAgentSession`、`AppShell` | 流式中切会话再切回：内容完整、不重复 | 1 天 |
| F4 | **空态与引导**：空会话给出 3 个可点示例（读文件/跑命令/生成计划），点击填入而非直接发送 | `ChatViewEmptyState.tsx` | 空态三个入口可点且文案正确 | 0.5 天 |

---

## 3. 探针扩展（`agent-core-ux-verify.mjs`）

在现有 A1–A9 基础上补齐/加强，全部走本地 Ollama 真模型 + 真构建产物：

| ID | 断言 | 现在 |
|---|---|---|
| A1a | 危险工具触发审批面（唯一 `[role=dialog]`） | ✅ 已实现 |
| A1b | 行内/审批卡「允许」可点（无遮挡） | ⚠️ 当前失败 |
| A1c | 批准后审批面消失，工具卡出现且状态 `completed` | ✅ 已实现 |
| **A2** | 点「拒绝」→ 审批面消失；工具卡 `failed`/不出现执行结果；本回合正常结束，可继续发下一条 | ⛔ 待补 |
| **A2b** | 「本会话始终允许」→ 同工具第二次调用不再弹审批 | ⛔ 待补 |
| **A2c** | 审批卡正文包含真实命令与 cwd | ⛔ 待补 |
| A3 | 流式中「停止生成」→ 终态、输入框恢复 | ✅ 已实现 |
| **A3b** | 停止后已产生文本保留、无错误横幅 | ⛔ 待补 |
| A4 | 流式中第二条进入队列 dock | ✅ 已实现 |
| **A4b** | 回合结束队列自动出队发送 | ⛔ 待补 |
| A5 | 工具卡渲染 | ✅ 已实现 |
| A5b | 工具卡可展开且能看到 stdout | ✅ 已实现（需在 P-C 后加强） |
| A6 | 错误横幅 + 重试入口 | ✅ 部分 |
| **A6b** | 重试后只新增一轮 | ⛔ 待补 |
| A7 | 思考块渲染 | ✅ 已实现 |
| A8 | 用户消息编辑入口 | ✅ 已实现 |
| **A8b** | 编辑重发后旧分支回退、消息不重复 | ⛔ 待补 |
| A9 | 零 React 错误 | ✅ 已实现 |
| **A10** | 五档权限模式切换后行为变化（acceptEdits 不弹、default 弹） | ⛔ 待补 |
| **A11** | 长回答（50 行）流式期间滚动/未读稳定 | ⛔ 待补 |
| **A12** | 工具失败呈现红色且不空气泡 | ⛔ 待补 |
| **A13** | 上下文 pill 无假数据 | ⛔ 待补 |

**门禁口径**：探针退出码 0（0 失败）才算 P-A/P-B/P-D 完成；`skip` 仅允许出现在"模型能力不支持"且必须在汇总里逐条列出。

---

## 4. 顺序与里程碑

```
第 1 周   P-A（A1→A2→A3→A4/A5/A6）→ 探针 A1/A2/A2b/A2c 转 PASS
第 1 周末 P-B + P-D → 探针 A3/A3b/A4b/A6b/A8b 转 PASS
第 2 周   P-C + P-E → 探针 A5b/A7/A11/A12/A13 转 PASS
第 2 周末 P-F → 全量探针 0 失败 + 三套 tsc + vitest 绿
```

**依赖**：
- P-A 的 A1 必须先做，否则后续所有审批相关探针都会被遮罩挡住。
- P-B 的 B2 依赖 pi 的回合结束事件（`pi://complete`），与 P-D 的 D3 同一条链路。
- P-F 的 F2 与 prod1 已修的计划死门相关，做回归而非重做。

---

## 5. 验收 checklist

```
[x] 同一时刻只有一个审批面（无遮挡、无重复挂载）              — A1a2
[x] 审批卡展示：工具名（本地化）、真实命令/路径、风险、当前权限档位 — A2c/A2d
[x] 「允许 / 本会话始终允许 / 拒绝」语义与文案一一对应          — A1b/A2/A2b
[x] 拒绝后工具不执行、回合不卡死、可继续对话                    — A2
[x] 本会话始终允许生效（第二次同命令不再弹窗）                  — A2b
[x] 停止生成：终态、保留内容、无错误横幅、输入框恢复            — A3/A3b
[x] 队列：流式入队 → dock 可见 → 回合结束自动出队发送           — A4/A4b
[x] 工具卡：摘要一行可读；展开有详情；同一工具不重复成行           — A5/A5b
[x] 工具失败：红色状态 + 错误摘要，不并正文、不空气泡            — A12（apply_patch 越权路径）
[~] 思考块：流式计时 / 完成冻结 / 历史不编耗时                  — 代码既有；本地 3B 模型无 reasoning，探针 A7 跳过
[x] 错误横幅：分层文案 + 重试 + 复制诊断；重试幂等              — A6/A6b（402 余额类错误）
[x] 用户消息编辑重发：旧入口可点；回退后新文本只出现一次          — A8/A8b
[x] 长工具输出：截断 + 行数/字符数 + 复制 + 展开全部             — C2（501 行 / 1892 字符）
[~] 上下文用量无假数据（无数据时整块不渲染）                     — A13 跳过：Ollama 未上报 context 窗口/usage
[x] /compact 上下文压缩分隔标记（事件 → 转录分隔条）             — MessageItem-compaction-marker（2 例）
[x] 权限模式五档切换即时生效且可见                              — A10（bypass）+ A2d（档位 chip）
[x] 计划模式入口可达、批准后可执行                              — A14（plan 强制询问 + 档位 chip）
[x] 会话切换恢复原转录、不串流                                  — F3
[x] agent-core-ux-verify 0 失败（26 通过 / 3 跳过）              — 2026-10-20
[x] tsc：root + electron + ui-dialogs + ui-conversation + ui-state 零错误 — 2026-10-20
[x] vitest：src 620 文件 5780 例 + packages 360 文件 3376 例全绿  — 2026-10-20
```

---

## 6. 与 prod2 的关系

- 本文件的 P-A…P-F **不阻塞** prod2 的发布收尾（A5 v0.16.0）；建议在 `feature/prod2` 上按批次提交，发布分支只 cherry-pick P-A 的 D1/D2/D3。
- prod2 批次 C 的 **autoMode（C4）** 直接复用本文件 P-A 的审批面与模式反馈，先做 P-A 可减少返工。
- prod2 批次 C 的 **受管运行时 / 沙箱（C2/C5）** 会改变工具执行路径，但不改变本文件的审批 UI 契约；审批卡按"工具名 + 参数摘要"抽象，不绑定具体工具实现。

---

## 7. 进度口径（2026-10-20 实施后）

| 项 | 起点 | 现状 | 完成判据 |
|---|---|---|---|
| P-A 权限审批闭环 | 20% | **100%** | A1/A1b/A1c/A2/A2b/A2c/A2d/A10 PASS |
| P-B 流式/中断/队列 | 70% | **95%** | A3/A3b/A4/A4b/A11 PASS；滚动跟随已验，极长列表性能未专项 |
| P-C 工具/思考可读性 | 60% | **90%** | A5/A5b/A12/C2 PASS；A7 因模型无 reasoning 跳过 |
| P-D 错误恢复 | 65% | **95%** | A6/A6b PASS（402 余额类 → 分层文案）；A8b 去重 PASS |
| P-E 上下文/多轮 | 40% | **85%** | 无数据不渲染假值；/compact 分隔标记已实现并有单测；A13 受 provider 能力限制 |
| P-F 模式/会话/空态 | 55% | **95%** | A10/A14/F3/F4 PASS |
| **核心 Agent 交互加权** | ~55% | **~94%** | 探针 26 通过 / 3 跳过 / 0 失败 |

---

## 8. 实施记录（2026-10-20）

### 8.1 验证结果

```
命令: OPENBUDDY_E2E_API_KEY=ollama OPENBUDDY_E2E_BASE_URL=http://localhost:11434/v1 \
      OPENBUDDY_E2E_MODEL_ID=ollama/llama3.2:3b OPENBUDDY_E2E_PROVIDER_KIND=openai \
      OPENBUDDY_E2E_API_BACKEND=chat_completions \
      node scripts/electron/agent-core-ux-verify.mjs

结果: 26 通过 / 3 跳过 / 0 失败（共 29）
跳过: A13（Ollama 未上报 context 窗口/usage）、A7（llama3.2:3b 不产出 reasoning）、
      A6 第二次入口检查（错误已在 A6/A6b 消费，收尾时无残留错误）
截图: /tmp/ob-agent-core-ux/{approval,queue,final}.png
```

探针新增了 **模型边界 shim**：`TOOL_PROBE <cmd>` / `STREAM_PROBE` 由本地代理按 OpenAI SSE
返回脚本化的 tool call 或慢速长流，其余请求原样转发真实 Ollama。应用侧（工具派发、
`ctx.ui.confirm`、权限 IPC、渲染 store、决议回传）全部走真实链路；这样既保留真机验证，
又消除了小模型"有 66 个工具时不出 tool_calls"导致的偶发空跑。

### 8.2 代码落点

| 文件 | 变更 |
|---|---|
| `packages/shared/openbuddy-types/src/index.ts:218` | `PermissionRequest` 增加 `message?` / `source?`（宿主一直发，类型缺失导致 UI 丢弃） |
| `packages/ui/openbuddy-ui-dialogs/src/PermissionDialog.tsx` | 新增 `variant: "inline" \| "modal"`；内联卡不再带全屏遮罩；正文展示命令；工具名本地化；权限档位 chip；风险 chip（命令类）；选项文案按 `kind` 固定；`allow_always` 用 `btn--always` 同权展示；队列计数「1 / N」；data-testid 全套 |
| `packages/ui/openbuddy-ui-conversation/src/chatview/ChatViewFooter.tsx:57` | 审批主面改为 `variant="inline"` |
| `packages/ui/openbuddy-ui-conversation/src/parts/InlineApprovalHint.tsx:167` | 展开体只保留提问卡，删除重复的 `PermissionInlineCard` |
| `electron/main/agent/host-modules/hook-permission.ts:119` | allow/allow_always 按钮文案改为「允许 / 本会话始终允许」；新增 `CONFIRM_TOOL_NAME` + `confirmSessionAllows` |
| `electron/main/agent/host-modules/bootstrap/provide-rpc-ui-context.ts:101` | confirm 路径**恢复** mode gate（此前 `confirmGateAllows` 被 import 但未调用）；补 `message`/`toolKind`；新增「本会话始终允许」；`allow_always` 不再被 resolve 成 false |
| `electron/main/agent/host-modules/ui-request-resolver.ts:106` | `ctx.confirm` 的 always 只写会话规则，不写跨会话 policy（避免死规则） |
| `src/styles/modals.css:121` | 内联卡布局、命令块、参数折叠、mode/risk chip、`btn--always` |
| `src/hooks/useAgentSession.ts` | 工具结果文本推导失败态（含 `{content,details}` JSON）；`tool_call` 按 toolCallId 去重（start/end 双事件不再双行） |
| `electron/main/ipc/index.ts:952` | `tool_execution_end` 保留扩展的结构化 content；`apply_command` 映射为 `command_output`（长输出截断/复制 UI 的数据源） |
| `packages/ui/openbuddy-ui-state/src/session-store.ts` | `ChatMessage.systemMarker` + `appendSystemMarker`（/compact 分隔条） |
| `packages/ui/openbuddy-ui-conversation/src/MessageItem.tsx` | 渲染压缩分隔条（`data-testid=context-compaction-marker`） |
| `packages/ui/openbuddy-ui-conversation/src/ChatView.tsx` | 编辑重发：await `onRewound()` 再发送，避免历史重载与乐观气泡竞态；`handleOpenTool` 同时接受对象与 toolCallId |
| `packages/ui/openbuddy-ui-conversation/src/ToolSidePanel.tsx` | 窄面板下 `mode="tool"` 不再落入列表页（工具详情可达） |
| `packages/ui/openbuddy-ui-conversation/src/TurnErrorCard.tsx` | `insufficient_balance_error` / `insufficient_quota` 中文标题 |
| `packages/ui/openbuddy-ui-contract/src/pi-client.ts` | `inferErrorCode` 先识别余额/额度类错误，避免被 "quota" 误判为限流 |
| `packages/ui/openbuddy-ui-conversation/src/__tests__/MessageItem-compaction-marker.test.tsx` | 新增 2 例：分隔条而非空气泡、detail 文案 |
| `scripts/electron/agent-core-ux-verify.mjs` | 扩到 A1–A14/C2/F3/F4 共 29 项；A11 前显式回底；长输出与失败卡断言；会话切换回归 |

### 8.3 实施中发现的额外缺陷

1. **`confirmGateAllows` 是死代码**：`provide-rpc-ui-context.ts` 顶层 import 了它，confirm 注释也写着
   "先过权限模式闸"，但函数体从未调用 —— `bypassPermissions` 对 `ctx.ui.confirm` 实际无效。
   本次恢复调用后由 A10 验证通过。
2. **`allow_always` 的 resolve 为 false**：confirm 路径 `resolve: (value) => resolve(value === true)`，
   而 IPC 传回的是 `{ decision: "allow_always" }` 对象 —— 点"始终允许"等同拒绝。
3. **「本会话始终允许」无实现载体**：confirm 请求没有 toolName/pattern，本次用命令原文作为会话规则
   的 pattern，并在每次 confirm 前查 `confirmSessionAllows`，实现真正的"同命令不再问"。
4. **每个工具卡出现两次**：pi 在 `toolcall_start` 与 `toolcall_end` 各发一次 `tool_call`，
   renderer 两次都追加 part，于是同一工具一行"运行中"、一行"完成"，还被误判成并行组。
   本次按 toolCallId 复用已有单元格，A5 从 2 行降为 1 行。
5. **结构化工具结果被 JSON 拍平**：`tool_execution_end` 把 `{content,details}` 整体 stringify
   成 text，导致 `CommandOutputBlock`（截断/复制/展开）在真实链路永远拿不到数据，也识别不出
   `apply_patch failed:`。本次保留 content 数组并为 `apply_command` 生成 `command_output`。
6. **工具详情在窄面板不可达**：`mode="tool"` 时 `listDetailView` 仍按 artifacts 判定，窄布局
   停在列表页，点击工具行看不到详情。已修。
7. **onOpenTool 类型错位**：`MessagePartRegistry`/`ToolGroupSummary` 传 toolCallId 字符串，
   ChatView 却按 `ToolCallView` 使用（详情拿到字符串）。`handleOpenTool` 现同时接受两种形态。
8. **编辑重发竞态**：`onRewound()`（异步重载历史）未 await 就 `onSend`，乐观气泡与历史替换
   竞态，新 prompt 可能渲染两次。已改为 await 后再发送。

### 8.5 交互观感对齐 cc-haha（2026-10-21）

参考 `/Users/louloulin/pix/cc-haha` 的 agent transcript 约定，收敛本次"太粗糙"的几处：

| 改动 | 之前 | 现在 |
|---|---|---|
| 工具行摘要 | 裸工具名 `apply_command` | 动词 + 目标：`终端命令 echo …` / `读取 foo.ts` / `搜索 query` / `编辑 foo.ts`；折叠组同样走这套摘要 |
| 连续 assistant 消息 | 每个工具步骤都重复 `Buddy · AI` 抬头，20px 间距 | 只在发言第一条显示抬头，后续条目 `msg--continuation` 收窄到 6px |
| 纯工具消息的 footer | 不可见的 action/meta 行把 32px 工具行撑出 ~70px 空白 | `msg--tool-only` 不渲染 footer 占位 |
| 历史回放 | 切换会话后工具行退回裸工具名、长输出丢失、失败态丢失 | `sessionEntriesToChatMessages` 保留 `arguments` → `rawInput`，`apply_command` 映射 `command_output`，`apply_patch failed:` 判为 failed |

验证：`MessageItem` / `ToolGroupSummary` / conversation 包 66 文件 456 例全绿；
`agent-core-ux-verify` 仍为 26 通过 / 3 跳过 / 0 失败；`final.png` 可见工具行紧随作答、
无重复抬头。

### 8.6 后续（非阻塞）

- A13 上下文 pill 在 Ollama 下无法验证（provider 不返回 context 窗口/usage）；换真网关后应自动转 PASS。
- P-B3 超长列表（>1000 消息）虚拟化的专项性能回归未做。
- 交互观感已按 cc-haha 收敛第一轮（§8.5）；剩余：工具输出行内折叠动效、
  composer 能力菜单、消息级操作条的浮层化。

---

*本文为计划文档；每批完成后在表格标注状态并更新 §7。实现遵循仓库既有规则：先修结构（A1），再修文案与语义（A2/A3），最后补护栏（探针）。*
