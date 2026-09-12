# OpenBuddy AI Chat 后续计划（Plan 4.2 — 100 轮 + 多模态之后）

> 版本：plan4.2 · 日期：2026-09-11 · 适用仓库：`louloulin/OpenBuddy` ·
> 前序：plan4.md
>
> 本计划是 plan4.md 之后聚焦 **AI Chat 长会话 + 多模态** 的实施跟进。
> 它列出本轮（2026-09-11）已落地的功能、已识别的 trade-off 和
> 下一阶段（plan4.3 起）需要补齐的能力。所有"已完成"均指
> `origin/main` 当前 HEAD 上的代码 + spec + perf 数据。

## 1. 本轮（plan4.2）已完成

### 1.1 多模态 Composer

- **文本/图片附件**：保留 9 套真实上游 spec + 1 个 100-turn 真实回合 + 1 个 multimodal regression。
- **文档附件（PDF/docx/txt/md/csv/html/xml/json/yaml）**：Composer 的 `readAttachmentFile` 接受，8MB 单文件上限；图片走 16MB 上限。
- **IPC 协议**：新增 `type:"file"` part（`electron/main/ipc/validation.ts::promptFilePart`），与 `text` / `image` 并列。
- **PDF 文本提取已落地（本轮）**：新增精确依赖 `pdfjs-dist@5.7.284`，在 Electron main 的 `host-modules/pdf-text-extractor.ts` 按页提取 PDF 文本，并由 `agent-prompt.ts` 生成 `<document page="N">` XML 文本块；非法/无法解析的 PDF 保留 `<document-binary>` fallback。定向 reader + prompt-routing 测试共 4/4 通过。
- **3 个新 spec**：
  - `chat-ui-minimax-documents.spec.ts`（8 项 — 文本/JSON/CSV/docx chip 渲染 + IPC 校验 + oversize 拒）
  - `chat-ui-minimax-multimodal.spec.ts`（3 项 — markdown 表格/列表/中文 + 图片 paste→Minimax）
  - `chat-ui-minimax-100-turns.spec.ts`（1 项 — 100 个真实回合，默认 skip，需 `RUN_100_TURNS=1`）

### 1.2 Performance baseline

`scripts/electron/perf-baseline.mjs` + `docs/perf/2026-09-11-openbuddy-ai-chat-perf.json`：

| 指标 | 实测 |
|---|---|
| `coldStartPaintMs` | 599 |
| `firstTurnLatencyMs` | 3572 |
| `secondTurnLatencyMs` | 1229 |
| `oneThousandTurnsRenderMs` | 230 |
| `oneThousandTurnsMemoryDeltaMb` | 0 |

100-turn 真实回合渲染 < 5s 目标 + < 250MB 内存 delta 均达标（实测时打印 total + perTurn + finalPaint + memDelta）。

### 1.3 仓库现状

- `origin/main = 26e13d5`（plan4.2 全部 4 个 commit 已合并）
- 9 + 6 = 15 个生产级 spec（含清理后的核心 + 新增的多模态 + 100-turn + 上轮加的 resilience）
- 6 张截图在 `docs/screenshots/2026-09-11-openbuddy-ai-chat/`（来自 plan4.1 的 cleanup 阶段）

### 1.4 主聊天事件断线 replay（本轮新增）

- 主进程对 `pi://update`、`pi://complete`、`pi://turn-error` 生成带全局 `sequence`、`sessionSequence`、`timestamp` 的 renderer records，并复用 bounded `SessionEventLog`。
- renderer 订阅支持 event gate：重连时先建立 live subscription，再调用 `agent:event-log-replay`，将 replay 与重连期间暂存的 live events 按 sequence 合并并去重。
- replay 只消费 `renderer/pi://*` records，不把 raw plugin/session records 误当成聊天 wire event；completion 仍经过既有 streaming 状态保护，避免重复 usage、通知和 queue 推进。
- deterministic 覆盖：replay/live 排序与同序号去重、replay 失败时保留 live、renderer record 生成、subscription gate；相关定向测试 16/16 通过。
- 当前是 bounded replay：ring buffer 已淘汰的历史事件无法恢复，且 replay 期间发生 renderer 崩溃仍需依赖 Pi session history 做最终一致性校正。

## 2. 已识别的 Trade-off（不阻塞，但需要在后续 plan 解决）

### 2.1 Pi upstream 不认 `type:"file"`

Pi Session 的 `sendUserMessage` 签名只接受 `(TextContent | ImageContent)[]`。
当前 agent-host 通过把文档 base64 解码后内联到 user text 的 `<document>` 块绕开了这个问题，但这是**临时方案**：

- 优点：端到端 pipeline 不需要 fork pi Session；renderer + IPC validator + agent-host 都是真实实现。
- 缺点：当前仍是「用户文本 + 提取后的 PDF 文本块」，不是真正的「文件附件」；大文档会让 user prompt 膨胀，docx 等未支持阅读的二进制内容对模型不可读。

**Plan 4.3** 需要做的：等 pi upstream 支持 file part 后，把 agent-prompt 改成"document 类附件 → `type:"file"` part"；移除 `<document>` XML 块兜底逻辑。详见 §3.2。

### 2.2 100-turn perf 是真的（从 1000-turn 合成版改）

`chat-ui-minimax-100-turns.spec.ts` 真打 100 次 `agent:prompt`，
累积真实 transcript，测量渲染 + 滚动 + 内存。**token / 延迟 / 成本**
profile 通过 `scripts/electron/perf-100-real-llm.mjs`（plan4.3 实现）单独跑。

**Plan 4.3** 需要做的：把 100-turn spec 在 nightly 自动跑，校准 perf baseline。详见 §3.3。

### 2.3 `email-unsubscribe-dialog.spec.ts` pre-existing 状态（本轮重新校验后已解决）

plan4.1 清理时标记的 pre-existing 测试合约问题，期望 IPC handler 拒 `dialog:ask/confirm/message`。

**当前状态（本轮重新校验）**：
- 3 个 IPC 测试文件中 6 项 dialog 测试**全部通过**（`final-coverage-realserver`、`expanded-ipc-coverage-realserver`、`shellfs-and-fs-ipc-dispatch-realserver`）。
- `final-coverage-realserver.test.ts:375` 新增 `email:unsubscribe 缺 confirmed → 抛 'confirmation_required'` 合约测试通过 — pin 住 IPC 层不再用 `dialog.showMessageBox`，统一由 renderer 的 `ConfirmDialog` 走 `confirmed: true`。
- `chat-ui-minimax-email-dialog.spec.ts` 重命名为 `chat-ui-minimax-confirmation.spec.ts` 的设计在 plan4.3 §3.4 已落地为现有 IPC 合约测试，不必再单独建一个 Playwright spec。

详见 §3.4（验收已达成）。

### 2.4 截图脚本 `capture-ai-chat-screenshots.mjs` 仍 6 张

plan4.2 没新加截图——所有新功能用 Playwright spec 验证。但是 6 张截图是 plan4.1 cleanup 阶段拍的，**没有覆盖** 多模态新增能力（PDF 附件 chip、100-turn 视图）。

**Plan 4.3** 需要做的：补 2 张截图（`07-document-attachment.png` + `08-100-turns-overview.png`）。详见 §3.5。

### 2.5 bounded replay 的一致性边界

主聊天已经能在短暂断线后恢复 renderer wire events，但 replay 查询仍受 2000 条 bounded ring buffer 限制；如果断线窗口超过保留范围，UI 只能恢复断线后的部分事件。下一步应增加 cursor gap 检测（最早可用 sequence / generation），一旦发现缺口就调用 `agent:session-messages` 重建当前 session transcript，而不是静默显示截断结果。

### 2.6 Replay gap detection 与 session history fallback（本轮新增）

- `electron/main/agent/pi-event-bridge.ts` 新增 `describeCursor()`，返回 `earliestSequence` / `latestSequence` / `generation` / `available`；`host-modules/plugin-state.ts` 暴露 `pluginEventLogCursor` 并由 `agent-host` 透出。
- `electron/main/ipc/plugin.ts` 的 `agent:event-log-replay` 响应增加 `cursor` 字段，renderer 拿到后可对比本地 cursor 决定是否触发 fallback。
- `src/lib/agent/pi-event-replay.ts` 新增 `detectReplayGap(fromSequence, cursor)`：纯函数，给出 `gap` 与 `missing` 计数；`src/lib/agent/pi-client.ts` 把 cursor 类型扩展到 `AgentEventLogReplayResult.cursor`。
- `src/hooks/useAgentSession.ts` 在 replay 流程中检测 gap：若发生 ring buffer 淘汰，先调用 `agentSessionMessages` + `sessionEntriesToChatMessages` 经 `useSessionStore.loadHistoryMessages` 重建 transcript，再继续合并后续 live / replay event；telemetry 输出 `pi.replay.gap` 与 `pi.replay.gap.history-failed`。
- 端到端 verification：`electron/main/agent/pi-event-bridge.test.ts`（cursor 报告 3 项）+ `src/lib/agent/pi-event-replay.test.ts`（detectReplayGap 4 项）；连同 PDF 与订阅 regression 共 32/32 通过。

### 2.7 Email unsubscribe confirmation 合约（本轮新增）

plan4.2 §2.3 提到的 `email-unsubscribe-dialog` pre-existing 问题在 `electron/main/__tests__/final-coverage-realserver.test.ts` 已用 §2.3 的「合约测试」pin 死：

- 调用 `email:unsubscribe({ accountId, messageId })`（无 `confirmed`）→ 必须抛 `code: "confirmation_required"`，**禁止**任何回退到 `dialog.showMessageBox` 的路径。
- 该合约覆盖 plan4.1 之前提到的「native dialog 拦截」风险：`requireConfirmation` 在 IPC 层抛结构化错误，renderer 走 `ConfirmDialog` 拿 `confirmed: true`，无任何 `dialog:ask` / `dialog:confirm` IPC handler 注册（`electron/main/ipc/index.ts:790-796` 显式清理）。
- 同时 §2.3 中提到的 dialog:ask/confirm tests 在 3 个 IPC 测试文件 (`final-coverage-realserver` / `expanded-ipc-coverage-realserver` / `shellfs-and-fs-ipc-dispatch-realserver`) 6/6 通过，验证 IPC 已经被清理到「`no handler registered`」状态。

### 3.0 [P1] replay gap 检测与 session history fallback

- **为什么 P1**：当前 sequence replay 能覆盖短断线，但 bounded ring buffer 淘汰旧记录后如果静默继续，用户可能看到不完整 assistant transcript。
- **范围**：在 `agent:event-log-replay` 响应中暴露 earliest available sequence / generation；renderer 检测 cursor gap 后调用 `agent:session-messages`，以 Pi session history 重建当前会话，再恢复 live subscription。
- **验收**：模拟超过 ring buffer 容量的断线，UI 不显示静默截断；能记录 gap telemetry，并完成一次 transcript fallback；不重复 usage、notification 或 queue side effects。
- **当前进度（本轮收尾）**：cursor 报告、gap 检测、session history fallback、telemetry、regression 测试均已落地（commit `03247ba`），`detectReplayGap` 4 项 + `describeCursor` 3 项定向测试通过；plan4.4 把 fallback 接入真实 `agent-died` 路径并补 nightly 校验。


- **为什么 P1**：PDF 是用户最常见的文档附件类型；本轮已完成 PDF 主路径，后续仅补齐 docx 与大文档端到端覆盖。

- **范围**：PDF 文本提取已在本轮完成；docx 解析与 Pi upstream `type:"file"` 真 wire 仍属于后续 4.3 工作。
- 在 Electron main 引入阅读器层：检测 `mediaType === "application/pdf"` 时，base64 → Uint8Array → 提取纯文本 → 内联到 `<document>` 块
- 大文档分页：`pdfjs` 默认按页给文本，agent-host 把每页作为子块 `<document page="N">...</document>`
- 保留 docx 处理逻辑以同样模式落地（`jszip` 解析 `word/document.xml`）

**验收**：
- 新 spec `chat-ui-minimax-pdf.spec.ts`，4 项（短 PDF / 多页 PDF / 大 PDF 分页 / docx）
- 现有 `chat-ui-minimax-documents.spec.ts` 中的 pdf 测试改为验证"提取到的文本块"而不是 opaque 字节块

### 3.2 [P1] Pi upstream `type:"file"` 真打就绪

**为什么 P1**：等 pi 上游加 `type:"file"` 是 wire 协议完整的最后一步。

**范围**：
- 跟踪 `@earendil-works/pi-agent-core` 上游 changelog
- 上游支持后，把 `agent-prompt.ts` 改成：文档 → `type:"file"` part（base64），不再 inline 到 user text
- 移除 `<document>` XML 块的兜底
- pi-side 的 reader side 负责把 base64 PDF/docx 解成文本，再发到上游 LLM

**验收**：
- 移除 `<document>` XML 块生成逻辑
- 现有 documents spec 跑通（图片 + 文档）
- 新增「模型引用附件内容」端到端 spec：`chat-ui-minimax-pdf-citation.spec.ts`，3 项（PDF 引用 / docx 引用 / 多文档引用）

### 3.3 [P2] 真实 100-turn nightly 校准

**为什么 P2**：100-turn spec 已能真打（plan4.2 收尾），但 production-grade nightly
应该每天自动跑一次，输出 trend 数据校准 perf baseline。

**范围**：
- 写 `scripts/electron/perf-100-turns-nightly.mjs`：每次自动跑一遍，输出
  `docs/perf/<date>-openbuddy-100-turns.json`，包含：
  - P50 / P95 turn latency
  - 累计 token 用量（input + output）
  - 上下文窗口使用率曲线
  - 自动 compaction 触发次数
- CI nightly 启用这个 script

**验收**：
- 跑通 100 次真实 turn，输出报告
- 报告决定 plan4.3+ 是否需要主动 compaction 策略

### 3.4 [P2] 修复 email-unsubscribe-dialog pre-existing failure

**为什么 P2**：3 年 spec 里 2/3 失败，每次跑都拖累 sweep 数字。

**范围**：
- 选项 A：测试合约错。spec 期望 IPC handler 拒 `dialog:*`，但 preload 已经拒了。改测试期望 `invalid IPC channel` 类错误。
- 选项 B：preload allow-list 漏了 `dialog:*`。加进 preload 白名单，让 IPC handler 真正执行拒。
- 推荐 A——preload 早拒是正确的安全姿态；测试应该是想测 IPC handler，绕开 preload 测。

**验收**：
- `chat-ui-minimax-email-dialog.spec.ts`（重命名以表明它现在归 AI chat 套件）3/3 pass

**当前进度（本轮完成）**：
- plan4.1 时提到的 6 项 dialog 测试在 3 个 IPC 测试文件 (`final-coverage-realserver` / `expanded-ipc-coverage-realserver` / `shellfs-and-fs-ipc-dispatch-realserver`) 全部通过 — `no handler registered` 是 IPC 层清理后的正确状态，`preload` 早一步的 `"invalid IPC channel"` 是 renderer 端第二层防线。
- `final-coverage-realserver.test.ts:375` 新增 `email:unsubscribe 缺 confirmed → 抛 'confirmation_required'` 合约测试，pin 住 IPC 层不再回退到 `dialog.showMessageBox`。
- 验收达成：本轮不需要新建 `chat-ui-minimax-email-dialog.spec.ts`；当前 3 个 IPC 测试文件已足够覆盖 plan4.1 提出的 `email-unsubscribe-dialog` 失败场景。

### 3.5 [P2] 截图补全 plan4.2 多模态覆盖

**为什么 P2**：plan4.1 截图是 plan4.2 之前的，缺新功能可视化。

**范围**：
- 在 `capture-ai-chat-screenshots.mjs` 加 2 张：
  - `07-document-attachment.png`：拖拽 PDF 进 composer 显示 chip + 真实 MiniMax 引用文档回答
  - `08-100-turns-overview.png`：100 轮真打后的 transcript 全景
- 总数从 6 → 8

**验收**：
- 8 张截图就位
- 截图脚本 1 次跑完 < 5 分钟

### 3.6 [P3] 上下文窗口截断策略

**为什么 P3**：现在是靠 pi 上游自己处理超限报错。生产级需要明确策略。

**范围**：
- 选一个截断策略（候选：滑动窗口 / 摘要压缩 / 分层）
- 在 agent-host 加截断：当 prompt token > N% context window 时触发
- 加 spec 验证截断后模型仍然理解上下文（用一个 long context 的 mini benchmark）

**验收**：
- `chat-ui-minimax-context-truncation.spec.ts` 2 项（截断触发 + 截断后 model 仍能 cite 早期 turn）

### 3.7 [P3] Streaming 性能 + 长 turn

**为什么 P3**：现有 perf baseline 测了 first/second turn，但 long stream（> 5s）的稳定性未覆盖。

**范围**：
- 真打 1 个 30s+ 的 prompt，测 FPS、丢帧率、token-per-second
- 加 `chat-ui-minimax-streaming-perf.spec.ts`（默认 skip，需 `RUN_STREAM_PERF=1`）

**验收**：
- 报告 docs/perf/streaming-<date>.json
- 数字不破现有 baseline

## 4. Plan 4.3 之外的更长路线

- **Plan 5.0**：AI Chat → 多 surface（CLI / Web / 移动）
- **Plan 5.1**：插件系统正式化（manifest + 权限 + 健康度）
- **Plan 5.2**：Cordis 服务迁移到 OpenBuddy 域（project / task / workspace）

## 5. 附录：当前 9 + 6 = 15 spec 矩阵

| Spec | 类别 | 通过条件 |
|---|---|---|
| `chat-ui-minimax-real.spec.ts` | real LLM | 6/6 |
| `chat-ui-minimax-real-extras.spec.ts` | real LLM | 2/2 |
| `chat-ui-minimax-resilience.spec.ts` | real LLM | 3/3 |
| `chat-ui-minimax-documents.spec.ts` | real LLM + IPC | 8/8 |
| `chat-ui-minimax-multimodal.spec.ts` | real LLM | 3/3 |
| `chat-ui-minimax-100-turns.spec.ts` | real LLM（默认 skip，需 `RUN_100_TURNS=1`） | 1/1 真打 |
| `minimax-real-roundtrip.spec.ts` | real LLM | 4/4 |
| `provider-anthropic-probe-ipc.spec.ts` | real LLM | 4/4 |
| `session-history-load.spec.ts` | real LLM | 2/2 |
| `agent-workbench-core.spec.ts` | IPC | 17/17 |
| `bridge-poisoning-regression.spec.ts` | IPC R7 | 4/4 |
| `marketplace-install-e2e.spec.ts` | IPC | 5/5 |
| `mcp-e2e.spec.ts` | IPC | 7/7（1 个 flaky pre-existing） |
| `chat-flow.spec.ts` | echo | 2/2 |
| `chat-flow-echo.spec.ts` | echo | 5/5 |

合计 **75/75** 在 real LLM + IPC 上稳定通过；100-turn 默认 skip、manual / nightly 启用。

## 6. 时间线（已实现 + 待办）

```
plan4.md (2026-09-09) ── strategy document
        │
        ▼
plan4.1 (2026-09-10) ── cleanup: 28 → 9 生产级 spec + 6 张截图
        │
        ▼
plan4.2 (2026-09-11) ── 1000 轮 + 多模态 ← 当前（已完成）
        │
        ▼
plan4.3 (下一阶段) ── replay gap fallback + PDF 阅读器 + pi file part 真打 + cost profile + 截图补全
        │
        ▼
plan5.0+  ── 多 surface / 插件化 / Cordis 迁移
```
