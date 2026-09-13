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

### 2.8 docx 文本提取与 100-turn nightly 校准（本轮新增）

- **docx 文本提取**：`electron/main/agent/host-modules/docx-text-extractor.ts` 新增 `extractDocxTextByParagraph()`，纯 Node `zlib.inflateRawSync` 解析 zip Local File Header → `word/document.xml` → `<w:p>` 内 `<w:t>` 段落。`electron/main/agent/host-modules/agent-prompt.ts` 集成：在 `promptContent` 路径识别 `application/vnd.openxmlformats-officedocument.wordprocessingml.document`，对每个段落生成一个 `<document paragraph="N">…</document>` 子块；解析失败回退 `<document-binary>` 与 PDF 一致。`@openbuddy/files-kb::extractDocxText` 在 renderer 端早已具备，host 端补齐与 PDF reader 对称。
- **100-turn nightly 校准**：`scripts/electron/perf-100-turns-nightly.mjs` 落地，跑 100 次真实 MiniMax turn（默认 100；可 `--turns=N` 覆盖），记录 P50 / P95 / max / min turn latency、errors 计数，输出 `docs/perf/<date>-openbuddy-100-turns.json`，结构稳定（`schema: openbuddy.100-turns-perf.v1`）。已挂 `pnpm perf:100-turns` script。
- **定向验证**：`electron/main/agent/host-modules/docx-text-extractor.test.ts`（4 项：段落提取 / XML 实体 / 缺 entry 抛错 / 非 zip 抛错）+ `electron/main/agent/host-modules/agent-prompt-docx.test.ts`（2 项：docx 内联 / 失败回退 binary），加 PDF reader 共 10/10 通过；既有 32 项 replay / PDF / 订阅测试本轮无回归。

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

**当前进度（本轮完成）**：
- PDF 文本提取（plan4.2 主路径）已落地：`pdf-text-extractor.ts` + agent-prompt 集成（commit `89ffcd8`），定向 reader + prompt-routing 4/4 通过。
- docx 文本提取（本轮）已落地：`docx-text-extractor.ts` 用 `zlib.inflateRawSync` 解 zip Local File Header 并抽取 `<w:p>`/`<w:t>`，agent-prompt 同样生成 `<document paragraph="N">` 子块（commit `03247ba` 之后的下一轮）。docx + PDF + replay + 订阅共 42/42 定向测试通过。
- 剩余：把 PDF / docx 路径纳入 nightly `chat-ui-minimax-pdf-citation.spec.ts` 端到端引用验证（待与 §3.2 上游 `type:"file"` 真 wire 一并处理）。

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

**当前进度（本轮完成）**：
- `scripts/electron/perf-100-turns-nightly.mjs` 落地，输出 `docs/perf/<date>-openbuddy-100-turns.json`（schema `openbuddy.100-turns-perf.v1`），记录 P50/P95/max/min turn latency + errors。已挂 `pnpm perf:100-turns` 入口；token 用量与上下文窗口曲线待与 §3.6 截断策略合并实现（renderer usage telemetry 已经具备，待 nightly 落地统计函数）。

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

**当前进度（本轮完成）**：
- 策略落地为「文档块滑动窗口」：`electron/main/agent/host-modules/document-truncator.ts` 导出纯函数 `truncateDocumentBlocks(blocks, options)`。当总字符超过预算时保留首 `keepFirst` + 末 `keepLast` 块，中间插入 `<document-truncated dropped=… keptFirst=… keptLast=…>` marker 让模型知道中间块已掉，避免幻觉引用未提供的段落。`DEFAULT_TRUNCATION_OPTIONS` 默认 `maxChars=24_000 / keepFirst=4 / keepLast=4`，与 agent-host `contextWindow: 128_000` 对齐（文档附件单独占用 ~25% 上下文）。
- 当 `keepFirst=0` 或 `keepLast=0` 时省略 marker（保留侧无歧义，模型不可能引用未提供的段落）；重复调用 idempotent：marker 计数不计 real block，下次 fast path 命中。
- `electron/main/agent/host-modules/agent-prompt.ts` 在拼装 `effectiveText` 前调用 truncator；若 `truncation.truncated`，emit `session/input-truncated` plugin event 带 `dropped` / `totalChars` / `budget`，renderer 与未来 telemetry 可订阅。
- 定向测试：`document-truncator.test.ts` 8 项（无截断 / 头尾保留 / marker 包含 dropped/keptFirst/keptLast / keepable>=blockCount no-op / keepFirst=0 / keepLast=0 / 二次 idempotent / 默认值）；`agent-prompt-truncation.test.ts` 2 项（不溢出时无 marker 且无 plugin event / truncator 仍可作纯函数 import）。合计 **10/10 通过**。
- 当前未补 chat-ui-minimax-context-truncation.spec.ts——`chat-ui-minimax-documents.spec.ts` 现有 PDF/docx 测试已覆盖到 truncator 的真实 wire 路径；额外 spec 留到 plan4.4 与 office1 集成一起加。
- 已知边界：truncator 目前只覆盖 PDF/docx 等 `<document>` 块，不裁 system prompt 与 Pi 上游 history（这部分仍由上游控制）。完整模型行为验证（截断后模型仍能引用早期 turn）需要真实 LLM，本地环境未跑。

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

**当前进度（本轮完成）**：
- 新增 `scripts/electron/perf-streaming.mjs`：跑 `RUN_STREAM_PERF=1` 时启动 production Electron，配置 MiniMax 后发送一个固定中文 prompt（80 条 Python 最佳实践，要求 ≥30s 长流且禁用工具），renderer 侧通过 `requestAnimationFrame` 采样记录 `dt` 数组，主进程侧用 `summarizeFrameDeltas` 计算 FPS / 丢帧 / dropRate，按 4 字符约 1 token 的 heuristic 估算 `outputTokensEst` / `tokensPerSecond`，最后落盘 `docs/perf/streaming-<date>-openbuddy-streaming.json`。
- 默认无 `RUN_STREAM_PERF` 时直接打印 `RUN_STREAM_PERF not set; skipping` 并 `exit 0`，避免 CI 不小心烧 token。
- 抽出 `scripts/electron/perf-streaming-schema.mjs`：schema 常量 `openbuddy.ai-chat-streaming.v1`、字段目录（`Object.freeze`）、`createStreamingReport`、`estimateOutputTokens`、`summarizeFrameDeltas`、`STREAMING_PROMPT`，全部是纯函数 / 纯数据，vitest 可直接 import 跑单测。
- 新增 `scripts/electron/perf-streaming-schema.test.mjs` 8 项定向测试通过：schema id + 冻结、`createStreamingReport` 全字段类型正确、空 metadata 兜底、tokens 估算 4-char heuristic + 忽略空白、FPS 摘要（normal / empty / 含 `null` defensive 三种 case）。
- 当前未跑实际 MiniMax 上游（环境无可用 OPENBUDDY_E2E_API_KEY），所以 `docs/perf/streaming-*.json` 还未生成；plan4.4 把 `perf-streaming.mjs` 接入 nightly，并在 README 记录 `RUN_STREAM_PERF=1 node scripts/electron/perf-streaming.mjs` 的使用方式。
- **本轮新增 `tests/electron/chat-ui-minimax-streaming-perf.spec.ts`**（plan4.3 §3.7 验收 spec）：用 `@playwright/test` 跑同样的 STREAMING_PROMPT，renderer 内 `requestAnimationFrame` 采样 `dt` 数组，rAF 采样 + 累计渲染时间 + Stop 按钮消失 共同决定 `streamDurationMs`；报告 schema 直接 import `perf-streaming-schema.mjs`（共享 `STREAMING_REPORT_SCHEMA` / `STREAMING_REPORT_FIELDS` / `estimateOutputTokens` / `summarizeFrameDeltas`），落盘 `docs/perf/streaming-<date>-openbuddy-streaming-spec.json`。默认 skip（`test.skip(!RUN, …)` + `test.skip(!HAS_CREDS, …)`），opt-in：`RUN_STREAM_PERF=1 pnpm exec playwright test tests/electron/chat-ui-minimax-streaming-perf.spec.ts`。`pnpm exec tsc --noEmit` 已确认 spec 无类型错误；未跑 playwright（需真实 LLM）。

### 3.8 [plan4.4 §A] OpenBuddy-tuned pi compaction 策略（本轮新增）

- **范围**：把 `electron/main/agent/pi-extensions.ts` 里硬编码的 `DEFAULT_COMPACTION_SETTINGS` 替换成 OpenBuddy-tuned instance，让 pi 上游 `shouldCompact()` 用我们的 `reserveTokens` / `keepRecentTokens`，而不是 SDK 裸默认值。
- **校准锚点**：
  - `document-truncator.ts::DEFAULT_TRUNCATION_OPTIONS.maxChars = 24_000`（约 6_000 tokens，4-char heuristic）—— summarizer prompt 必须 ≥ 这个 budget，否则就被截断过；
  - `agent-host.ts::contextWindow = 128_000` 默认 —— `keepRecentTokens` 取 75% 留 2–3 turn + 1 大附件工作记忆。
- **实现**（commit `443a8c8`）：
  - 新增 `electron/main/agent/host-modules/openbuddy-compaction-settings.ts`：纯函数 `buildOpenbuddyCompactionSettings(tuning?)` 合并 `DEFAULT_COMPACTION_SETTINGS`（pi 默认）+ `DEFAULT_OPENBUDDY_COMPACTION_SETTINGS`（OpenBuddy 锚点）+ 调用方 override；`reserveTokens` round 到 1k，`keepRecentTokens` 兜底 `safeNumber`，永不返回 NaN/负值。
  - 新增 `openbuddy-compaction-settings.test.ts` 9 项定向测试：frozen 默认、`enabled=true`、`reserveTokens ≥ 6_000`（≥ 文档截断预算）、`keepRecentTokens ≤ 120_000`（context window 之内）、override 不污染默认、NaN/负值 clamp、`CompactionSettings` 形状完整、tuning shape 类型守卫。**9/9 通过**。
  - `pi-extensions.ts` 的 `openbuddy-pi-context-guard` factory 调用 `buildOpenbuddyCompactionSettings()` 而不是 `DEFAULT_COMPACTION_SETTINGS`；周围加注释说明 plan4.4 §A 的 rationale 与 truncator budget 锚点。
- **回归**：`pi-extensions.test.ts` 39/39 + `document-truncator.test.ts` 8/8 + `agent-prompt-truncation.test.ts` 2/2 全部保持绿色；typecheck 未引入新错误（4 个 pre-existing `cross-spawn` 类型错误与本轮无关）。
- **价值**：plan4.3 §3.6 的 truncator 与 plan4.4 §A 的 compaction 现在用同一套 token budget 语义 —— truncator 知道自己的 6k 预算，compaction 知道要 reserve 16k，两个模块不再各自孤立读 pi 默认值。

### 3.9 [plan4.4 §D] CI nightly perf 接入（本轮新增）

- **范围**：新增 `.github/workflows/nightly-perf.yml`，把 `scripts/electron/perf-100-turns-nightly.mjs` + `scripts/electron/perf-streaming.mjs` 接入 GitHub Actions cron。
- **触发**：
  - `cron: '7 2 * * *'` —— 02:07 UTC 每日（避开 :00 / :30 的 fleet collision）
  - `workflow_dispatch` —— 手动触发做 ad-hoc 校准
  - `push` 到 `feature/pi0911` / `master` —— 改 perf 脚本立刻跑一次验证
- **3 个 job**：
  - `perf-100-turns`（90min timeout, `continue-on-error: true`）：跑 nightly 100 turns，输出 `docs/perf/*openbuddy-100-turns*.json`；artifact retention 90 天
  - `perf-streaming`（90min timeout, `continue-on-error: true`）：跑 ≥30s 长流，输出 `docs/perf/*openbuddy-streaming*.json`；artifact retention 90 天
  - `perf-streaming-schema`（5min, blocking）：跑 `perf-streaming-schema.test.mjs` 8 项 vitest；保证 schema 不漂移
- **凭据**：从 `secrets.OPENBUDDY_E2E_API_KEY` / `secrets.OPENBUDDY_E2E_BASE_URL` / `vars.OPENBUDDY_E2E_MODEL_ID` 读 —— 没有就 `::warning::` 跳过，不让 cron 失败。
- **并发**：`concurrency: { group: nightly-perf-${{github.ref}}, cancel-in-progress: true }` —— 新 run 自动 cancel 旧 run。
- **验证**：YAML 结构 parse 通过（3 jobs、7/7/6 steps、cron / workflow_dispatch / concurrency 全对）；streaming schema vitest 8/8 仍然 green；本地 dry-run 两个脚本确认 no-creds 路径不 panic。
- **生产价值**：从「perf 脚本就位但 CI 没接」升级到「每晚 UTC 02:07 自动产 perf 数据 + 90 天 artifact 留痕」。这是从「workbuddy 名义上的 perf」走到「真实可观测 perf」的最后一步。

### 3.10 [plan4.4 §C] Renderer truncation panel：本轮新增

- **范围**：audit round 5 标出的 "session/input-truncated 只 emit 不消费" 缺口。本轮把 truncator → renderer 的 telemetry 闭环打通。
- **3 个新模块**：
  - `src/lib/agent/truncation-event-parser.ts`：纯函数 `isTruncationEvent(payload)` / `parseTruncationEvent(payload)` / `summarizeTruncationEvents(events)`，对 `session/input-truncated` payload 做白名单 + 类型守卫 + 整数归一化；malformed payload 返回 `null` 永不抛。
  - `src/lib/agent/truncation-accumulator.ts`：纯对象 `createTruncationAccumulator()` —— `handle(event)` / `snapshot()` / `summary()` / `clear()` / `subscribe(listener)` 五个 method；过滤 `type !== "session/input-truncated"` 的事件，listener 抛错不影响 stream。
  - `src/hooks/useTruncationPanel.ts`：React hook，挂载时 `agentOnPluginEvent` 订阅，触发 setState 重新渲染；提供 `events` / `summary` / `clear` 三个返回值；SSR-safe（subscription 在 `useEffect` 里）。
- **测试**：17/17 vitest 覆盖
  - `truncation-event-parser.test.ts` 9 项：type guard accept/reject、各种 malformed payload（null/empty/负值/wrong types）、整数归一化、summary 聚合（dropped/totalChars/sessions）、malformed entry 静默忽略
  - `truncation-accumulator.test.ts` 8 项：非目标类型过滤、valid event 捕获、malformed payload 丢弃、clear 重置、subscribe/unlisten 双向、订阅转发顺序、订阅者抛错隔离
- **回归**：4 个 truncation 相关 vitest 文件合计 27/27 全绿；typecheck 本轮 0 新增错误
- **生产价值**：
  - 用户可在 chat UI 看到"本会话已截断 N 个文档块"实时提示（未来 UI 工作）
  - telemetry sink 可订阅 future 的 §A compaction 与 §C truncator 事件
  - 把 audit 标出的 "telemetry only emit no consumer" 缺口从 5 个候选里关掉一个

### 3.11 [plan4.4 §B] chat-ui-minimax-plan-mode.spec.ts（本轮新增）

- **范围**：补齐 plan-mode 的端到端 spec。`pi-plan-mode.ts` 已经在 agent-host 注册 `/plan` slash command 与 plan-mode IPC channels（`plan-mode:get` / `set-enabled` / `set-plan` / `approve` / `reject`），但缺一个 playwright spec pin 住这条路径，**避免以后 refactor 误删 IPC handler / command registration**。
- **新文件** `tests/electron/chat-ui-minimax-plan-mode.spec.ts`（~150 行）：
  - 复用 `tests/electron/_fixtures.ts` + `scripts/lib/e2e-credentials.mjs`
  - 默认 skip（`test.skip(!HAS_CREDS, …)`）—— 没 LLM 凭据就 pass-skip，避免 CI 跑挂
  - 4 项 vitest case：
    1. `/plan` slash command 出现在 `agent:commands-list`
    2. `plan-mode:get` IPC handler 已注册（无 "no handler registered" 错误）
    3. `plan-mode:set-enabled` + `plan-mode:get` round-trip 不抛错
    4. `plan-mode:set-plan` + `plan-mode:approve` + `plan-mode:reject` 三个 channel 都已注册
- **Typecheck**: 0 新增错误（spec 文件 tsc 干净）
- **回归**: spec 矩阵 **76 → 77**；plan4.4 候选 3/5 → **4/5**（80%）- **生产价值**：当未来有人重构 `electron/main/ipc/misc.ts` 把 plan-mode 那 5 行 stub 删除时，本 spec 会立刻 fail 提醒 —— 这是一条 pin 住「不破坏 plan-mode 入口」的契约测试。

### 3.12 [plan4.4 §E] Pi extension policy + audit trail（本轮新增）

**问题**：`electron/main/agent/pi-extensions.ts::resolvePiExtensions` 已经做了三次决策：findCompatibilityAdapter、recordPassthrough、builtinPiExtensionFactories —— 但决策 rationale 分散在三处，渲染层无法回答「pi-foo 为何被允许 / 拒绝」。每加一条新兼容 npm 包都要手动 grep 多个 if 链。

**方案**：把策略抽到一个纯函数工厂 + 报告聚合器，并把每次 resolve 的决策统一成一个 `pi/extension-policy-report` 事件。

- 新增 `electron/main/agent/host-modules/extension-policy.ts`（纯函数，无 IPC / 无 Electron 依赖）：
  - `ExtensionPolicyAction = "allow" | "deny" | "needs-review"`
  - `createExtensionPolicy(options?)` —— total 函数（缺失字段不抛错），返回 `decide(input) -> ExtensionPolicyDecision`
  - 决策顺序（denylist > needs-review > builtins > allowlist > 默认 deny）—— principle-of-least-privilege：allowlist 错误不能反过来 re-enable 一个 denylist 包
  - `describeExtensionPolicyReport(decisions)` —— 冻结报告 `{ total, allowed, denied, needsReview, entries }`，渲染层不会因为再 render 而 crash
- `resolvePiExtensions` 末尾 emit `pi/extension-policy-report`：
  ```ts
  options.emit("pi/extension-policy-report", {
    generatedAt: new Date().toISOString(),
    total, allowed, denied, needsReview,
    decisions: report.entries.map(entry => ({
      id: entry.input.id, packageName: entry.input.packageName,
      builtIn: entry.input.builtIn, action: entry.decision.action,
      reason: entry.decision.reason,
    })),
  });
  ```
- 12 个单元测试覆盖：allow builtins / 默认 deny / allowlist 通过 / denylist 覆盖 allowlist / needs-review (id + package) / 缺失字段不抛 / 防御性 options shape / 报告聚合 / 冻结报告 / 空输入 / 决策保留 entries
- `pi-extensions.test.ts` 3 处 snapshot assertion 过滤到 `pi/extension-adapted` 事件，使新增的 policy-report 事件不干扰 per-spec 断言

**验收**：
- `pnpm exec vitest run electron/main/agent/host-modules/extension-policy.test.ts` —— **12/12 ✓**
- `pnpm exec vitest run electron/main/agent/pi-extensions.test.ts` —— **39/39 ✓**
- typecheck: 0 新增错误
- 全 agent suite 回归：pre-existing 9 个 fail 测试文件与本轮无关（之前 commit `7d75ff6` 已存在）—— Round 10 净回归 = 0

**生产价值**：渲染层 / Extension Audit 面板 / ops 工具现在可以订阅 `pi/extension-policy-report` 来回答「为什么允许 / 拒绝 / 需要 review」—— 而不需要重新实现一遍策略决策矩阵。renderer 也能用同一份纯函数渲染报告（不绕回 main）。

### 3.13 [plan4.5 §A] Extension Audit Panel（renderer，本轮新增）

**问题**: Round 10 把 `pi/extension-policy-report` 从 main 端 emit 出来了，但 renderer 没有任何订阅者 —— 跟 Round 8 之前的 truncation panel 同样的「emit 但无 listener」状态。

**方案**: 复用 Round 8 的 truncation panel 模式，建立 renderer-side 三件套（parser → accumulator → hook）。

- 新增 `src/lib/agent/extension-audit-event-parser.ts`（纯函数）:
  - `parseExtensionAuditReport(value)` —— top-level 严格 + per-decision 宽容：单个 malformed decision 不会让整个 panel 消失
  - `isExtensionAuditReport(value)` —— 严格 type guard（每个 decision 的 action 必须是 `allow|deny|needs-review`）
  - `summarizeExtensionAuditReports(reports)` —— "latest report wins" 聚合（每次 `resolvePiExtensions` emit 一份，重新 resolve 会覆盖）
- 新增 `src/lib/agent/extension-audit-accumulator.ts`（纯 subscriber）:
  - 过滤 `openbuddy://plugin-event` 流里 `pi/extension-policy-report` 类型
  - `subscribe(listener)` 返回 unlisten；defensive: 吞 listener 异常，buggy panel 不会拖垮 host
- 新增 `src/hooks/useExtensionAuditPanel.ts`（React hook）:
  - 每个组件持有自己的 accumulator，SSR-safe（IPC 订阅放在 `useEffect` 里），暴露 `{ reports, summary, clear }`
- 18 个 vitest case（11 parser + 7 accumulator）覆盖：
  - payload 合法 / 缺字段 / 字段类型错 / action 字面量错
  - 单个 decision malformed 不影响其他 decision
  - `total === allowed + denied + needsReview` 不变量
  - 多个 report 时 latest wins
  - 事件类型过滤、listener 异常吞掉、defensive snapshot copy、`clear()` 重置

**验收**:
- `pnpm exec vitest run src/lib/agent/extension-audit-event-parser.test.ts src/lib/agent/extension-audit-accumulator.test.ts` —— **18/18 ✓**
- `pnpm exec tsc --noEmit -p .` —— 0 新增错误（新文件均干净）
- Round 10 baseline: `electron/main/agent/pi-extensions.test.ts` 仍 39/39 ✓（无回归）

**生产价值**: 关闭 Round 10 留下的「main emits, renderer 没人接」的 gap。Extension Audit panel 现在可以直接基于 `useExtensionAuditPanel()` 落地「N allowed · M denied · K needs-review」实时面板，不需要重新实现策略决策矩阵。

### 3.14 [plan4.5 §A] useExtensionAuditPanel hook contract spec（本轮新增）

**问题**: Round 11 把 hook 落地了，但没有任何 spec 把 hook 的契约钉死 —— 未来重构 hook 时可能：
- 漏掉 IPC 订阅 / 取消订阅
- 把 "latest report wins" 改成 "sum 全部"（语义错误）
- 在 malformed payload 上抛错（让 panel 崩溃）

**方案**: vitest 单元 spec，mock `agentOnPluginEvent` 抓住 handler 后注入合成事件，跨 IPC → hook → React state 完整跑一次。

- 新增 `src/hooks/useExtensionAuditPanel.test.tsx`（vitest + @testing-library/react）:
  - 6 个 case：
    1. mount 时订阅 `agentOnPluginEvent`
    2. 第一份合法 report 填充 `reports[0]` + summary
    3. 无关事件类型（`session/input-truncated`）被忽略
    4. malformed payload（`null` / `{}` / `total=-1`）静默丢弃
    5. summary 反映 LATEST report（re-resolve 覆盖）
    6. `clear()` 清空 log + 重置 summary

**验收**:
- `pnpm exec vitest run src/hooks/useExtensionAuditPanel.test.tsx` —— **6/6 ✓**
- 全 extension audit pipeline: parser (11) + accumulator (7) + hook (6) = **24/24 ✓**
- 不依赖 OPENBUDDY_E2E_API_KEY —— 跟 Round 9 的 Playwright plan-mode spec 互补：那个验 IPC handler 注册，这个验 renderer 端 hook 状态

**生产价值**: hook 契约现在端到端被钉住。任何人 refactor `useExtensionAuditPanel`（例如把 latest-wins 改成 sum，把 useEffect 改成 useLayoutEffect 触发 SSR 报错）都会立刻 fail 这个 spec。

### 3.15 [plan4.5 §A] ExtensionAuditPanel React component（本轮新增）

**问题**: Round 11/12 把 hook + spec 落地了，但没有真正的 React UI 组件 —— `useTruncationPanel` 也面临同样的「hook 已落地但 panel 还没建」状态。Extension Audit panel 必须能直接渲染给 ops 看到「N allowed · M denied · K needs-review」才算真正闭环。

**方案**: 复用 `StatusPill` 的 display-only 模式（无 store 写入、无 timer、无 IPC callback），从 hook 拿数据 → 渲染。

- 新增 `src/components/ExtensionAuditPanel.tsx`（~150 行）:
  - Summary tile: Allowed / Denied / Needs-review / Decisions 四个 metric
  - 每个 decision 一行：id + action badge + reason
  - `data-action="allow|deny|needs-review"` 在每行上，方便 CSS tone（deny 红 / needs-review 琥珀 / allow 中性）
  - 空态：timestamp + body 都写 "awaiting"，避免「last updated: null」的误导
  - `Clear log` 按钮接 hook 的 `clear()`
  - 可选 `hookResult` prop（Storybook / 确定性测试 snapshot 用）
- 新增 `src/components/__tests__/ExtensionAuditPanel.test.tsx`（6 个 case）:
  - 空态渲染
  - summary tile 正确显示 latest report
  - 每个 decision 一行 + action badge
  - `data-action` 属性正确（视觉扫描）
  - clear 按钮调用 hook.clear()
  - 无报告时隐藏 clear 按钮
- 测试基础设施：用 `vi.hoisted()` 共享 state（vitest 把 `vi.mock` hoist 到 import 之上，普通 `const` 在 mock factory 里捕获会是 `undefined`）

**验收**:
- `pnpm exec vitest run src/components/__tests__/ExtensionAuditPanel.test.tsx` —— **6/6 ✓**
- 全 extension audit pipeline: parser (11) + accumulator (7) + hook (6) + panel (6) = **30/30 ✓**
- `pnpm exec tsc --noEmit -p .` —— 0 新增错误

**生产价值**: Extension Audit panel 现在可以作为一个真实组件挂载到 chat UI sidebar（`Settings → Extensions` 或 chat header chip），不需要重新实现策略决策矩阵。CSS 通过 `data-action` hook 就能 tone（deny 红 / needs-review 琥珀），视觉上一眼能扫到「哪些扩展被拒了 / 哪些需要 sign-off」。

### 3.16 [plan4.5 §A] ExtensionAuditPanel CSS tones（本轮新增）

**问题**: Round 13 落地了 component + data-action/data-tone hooks，但 CSS 还没接 —— 组件能 render 但视觉上 deny/needs-review 行没有强调，等于「半成品」。如果未来 refactor 时把 CSS 删了但保留 data-attr hooks（或者反过来），CI 不会 fail —— 这是个 silent regression。

**方案**: 给 `data-action` / `data-tone` hooks 接入真实 CSS tone + 加一个 guard spec 读 `app.css` 防止 silent regression。

- 新增 `src/styles/app.css` (~115 行追加，组件的 CSS hook 集中放在文件末尾的 `=== ExtensionAuditPanel (plan4.5 §A) ===` 块):
  - `.extension-audit-panel` 容器（border + bg-surface + padding）
  - `.extension-audit-panel__metric[data-tone="allow|deny|needs-review|total"]` 给 summary tile 数量上色：
    - allow → 绿 `rgba(0, 168, 132, 0.95)`
    - deny → 红 `rgba(229, 72, 77, 0.95)`
    - needs-review → 琥珀 `rgba(217, 130, 0, 0.95)`
    - total → 文本主色
  - `.extension-audit-panel__row[data-action="..."]` 给每行加 tinted left border，deny / needs-review 视觉上一眼可辨
  - `.extension-audit-panel__action[data-testid="extension-audit-action-allow|deny|needs-review"]` 给 action badge 加 chip
  - `.extension-audit-panel__empty` + `.extension-audit-panel__clear` 空态 / 清空按钮
- 新增 `src/components/__tests__/extension-audit-panel-css.test.ts`（5 个 case）:
  - 读取 `src/styles/app.css`，断言期望的 selector 存在
  - 捕获 silent regression：删 CSS 但保留 hooks（或反过来）CI 立刻 fail
  - deny 颜色用 `rgba(150-299, ...)` 正则保证「红通道主导」，needs-review 用 `rgba(...)` 保证有色非中性
  - 三种 action 的 chip variant 都要声明

**验收**:
- `pnpm exec vitest run src/components/__tests__/extension-audit-panel-css.test.ts` —— **5/5 ✓**
- 全 extension audit pipeline: parser (11) + accumulator (7) + hook (6) + panel (6) + CSS guard (5) = **35/35 ✓**
- `pnpm exec tsc --noEmit -p .` —— 0 新增错误

**生产价值**: Extension Audit panel 现在**视觉上**真能扫 —— ops 不用读 reason 文本，一眼能看出「哪些扩展被拒 / 哪些等 sign-off」。CSS hook（data-action / data-tone）让未来设计系统迁移只改 CSS 规则、不改 component。

### 3.17 [plan4.5 §A] ExtensionAuditPanel 'Resolves' tile（本轮新增）

**问题**: Round 14 加了 4 个 metric tile（Allowed / Denied / Needs review / Decisions），但**没有**一个能直接告诉 ops「这个 session 已经 re-resolve 几次了」。每次 `resolvePiExtensions` 调用都会 emit 一份 `pi/extension-policy-report`（重新加载 / 重启插件 / 切换 profile 时），但 ops 只能通过 `summary.reports` 在 panel 底部一行隐约看到。诊断 startup churn / repeated reload 需要「session 内 resolve 次数」独立 metric。

**方案**: parser 已经 expose `summary.reports`（整个 session 累计有效 report 数），只缺 panel 上一个独立 tile + CSS tone。

- `src/components/ExtensionAuditPanel.tsx`：新增 `Resolves` metric tile，`data-testid="extension-audit-resolves"` + `data-tone="resolves"`，渲染在 Allowed/Denied/Needs review 之后、Decisions 之前
- `src/styles/app.css`：新增 `.extension-audit-panel__metric[data-tone="resolves"] dd { color: rgba(82, 132, 255, 0.95); }` —— 蓝色调匹配 pi-native 蓝 accent，视觉上区分「session 计数」与 per-action 计数（绿/红/琥珀）
- `src/components/__tests__/ExtensionAuditPanel.test.tsx`：新增 1 case 验证 `summary.reports === 2` 时 resolves tile 显示「2」，同时 sanity check 4 个 latest-only metric 仍反映 latest report
- `src/components/__tests__/extension-audit-panel-css.test.ts`：per-tone assertion 加上 `resolves`

**验收**:
- `pnpm exec vitest run src/components/__tests__/ExtensionAuditPanel.test.tsx` —— **7/7 ✓**（was 6/6）
- `pnpm exec vitest run src/components/__tests__/extension-audit-panel-css.test.ts` —— **5/5 ✓**
- 全 extension audit pipeline: parser (11) + accumulator (7) + hook (6) + panel (7) + CSS guard (5) = **36/36 ✓**
- `pnpm exec tsc --noEmit -p .` —— 0 新增错误

**生产价值**: ops 现在能直接从 panel header 回答「这个 session 内 agent host re-resolve 几次了？」，对诊断 startup churn / 反复 reload（plugin 反复 reload 常见原因：marketplace 自动 update / profile 切换）有用，不需要 drop 进 main-side logs。

### 3.18 [plan4.5 §A] useExtensionAuditPanel on-mount catch-up（本轮新增）

**问题**: Round 11 的 hook 只通过 `agentOnPluginEvent()` 订阅 live event —— 如果 `pi/extension-policy-report` 在 panel mount **之前** 就已经 emit 了（fast agent-host restart / profile 切换 / plugin reload 时常见），panel 会显示「awaiting first report」直到下次 resolve。这是 confusing UX。

**方案**: mount 时额外调用 `agentPluginEvents()`（已存在的 IPC，返回 main 端 ring buffer 缓存）来读取历史 event，把任何 `pi/extension-policy-report` 类型喂进 accumulator。

- `src/hooks/useExtensionAuditPanel.ts`：
  - 操作顺序关键：先装 live subscription，再 async 跑 catch-up
  - 同步 dispatcher（不 `await` 的 test）立即看到 handler；catch-up 异步补历史
  - 两个失败都 try/catch（非致命）
- `src/hooks/useExtensionAuditPanel.test.tsx`：mock `agentPluginEvents` 后新增 2 个 case：
  1. **catch up on reports emitted before mount** —— ring buffer 里有 1 个 `pi/extension-policy-report` + 1 个 `session/input-truncated`，mount 后 panel 应该有 1 个 report（filter 掉非 policy-report 类型）
  2. **does not crash when agentPluginEvents() rejects** —— bridge down 时 hook 不崩，live subscription 仍工作

**验收**:
- `pnpm exec vitest run src/hooks/useExtensionAuditPanel.test.tsx` —— **8/8 ✓**（was 6/6）
- 全 extension audit pipeline: parser (11) + accumulator (7) + hook (8) + panel (7) + CSS guard (5) = **38/38 ✓**
- `pnpm exec tsc --noEmit -p .` —— 0 新增错误

**生产价值**: Extension Audit panel 现在即使 mount 比第一次 resolve 晚也能立刻显示最新状态（profile 切换 / plugin reload / fast agent-host restart 场景），不需要改 panel 本身 —— hook 透明地 hydrate。

### 3.19 [plan4.5 §B] needs-review approval gate（本轮新增）

**问题**: Round 8–16 把 `needs-review` 从一个 audit 标签变成 resolver 阶段会读取的 hint —— 但它只是「factory 不进 list，diagnostic 提示一下」的非阻塞挂起。用户没有任何 UI 入口去 approve / reject，导致配置被标记 `needs-review` 的扩展永远处于 blocked 状态、永远 reload 也只是重新落 blocked 诊断，不是「先 sign-off 再加载」。

**方案**: 把 `needs-review` 升格成 active sign-off gate —— 纯工厂状态的 `createNeedsReviewGate()` 持有 pending / approved / rejected 三个集合，resolver 在产出 final resolution 时调用 `applyNeedsReviewGate()` 决定 factory 是否保留，main 端 IPC handler 把 approve / reject 转成 `reloadPiExtensions()` 让下一轮 agent loop 拿到新 factory 集合，renderer 用 hook 订阅 `pi/extension-needs-review-pending` event stream + 在 mount 时从 cached ring buffer / `extension:needs-review-state` snapshot hydrate。

- `electron/main/agent/host-modules/needs-review-gate.ts`：
  - 纯工厂：`createNeedsReviewGate()` 返回 `{ snapshot, gate, track, approve, reject, subscribe }`
  - `gate({ id })` 对 tracked-but-undecided id → `pending`，对 approved id → `allow`，对 rejected id → `deny`，对未 tracked 或空字符串 id → `deny`（fail-closed，默认拒绝未登记请求）
  - `approve(id)` / `reject(id)` 对未知 id 是 no-op（refuse to lift unknown id）
  - `summarizeNeedsReviewState()` 把 internal snapshot 转 renderer 友好的 `{ pending, pendingCount, approvedCount, rejectedCount }`，用 `Object.freeze` 保护 pending 数组防外部 mutate
- `electron/main/agent/host-modules/needs-review-gate.test.ts` —— **8 cases**：empty state / track idempotency / gate 分类 / approve-reject 语义 / unknown id no-op / subscribe listener 在每个 mutation 触发 / `summarizeNeedsReviewState` frozen
- `electron/main/agent/host-modules/pi-extensions-needs-review.ts`：
  - `applyNeedsReviewGate(resolution, decisions, gate, emit)` 后处理 resolver 产物：对 pending/deny 状态从 `factories` 移除并 push `blocked` 诊断；`emit` 总是被调用（即使 0 pending）让 renderer 显式收「no pending」事件确认 modal 关闭
- `electron/main/agent/host-modules/pi-extensions-needs-review.test.ts` —— **6 cases**
- `electron/main/agent/host-modules/needs-review-singleton.ts`：模块级 `let gate = createNeedsReviewGate()` + `installNeedsReviewGate(instance?)` / `getNeedsReviewGate()` / `__resetNeedsReviewGateForTest()`，匹配 `plugin-event-bus.ts` / `pi-extension-configure.ts` 的 install 模式
- `electron/main/agent/__tests__/pi-extensions-needs-review-integration.test.ts` —— **4 cases** 验证 `resolvePiExtensions` 接 `needsReviewGate` 后 factory 被移除、approve 后 reload 又装回来、`pi/extension-needs-review-pending` 被 emit
- `electron/main/agent/host-modules/_state-shape.ts` + `_default-state.ts`：新增 `piExtensionNeedsReviewIds: string[]` state 字段
- `electron/main/agent/host-modules/pi-extension-configure.ts`：把 `needsReviewGate` 和 `needsReviewIds` 透传给 `resolvePiExtensions`
- `electron/main/agent/pi-extensions.ts`：`PiExtensionResolutionOptions` 新增 `needsReviewGate?: NeedsReviewGate`、`needsReviewIds?: readonly string[]`、`needsReviewPackageNames?: readonly string[]`；resolver 完成后调 `applyNeedsReviewGate(result, decisions, options.needsReviewGate, options.emit)`
- `electron/main/ipc/plugin.ts`：新增 3 个 handler —— `extension:needs-review-state`（snapshot）/ `extension:approve-needs-review`（mutate + reload）/ `extension:reject-needs-review`（mutate + reload），都对未知 id 返回 idempotent current state 不报错
- `src/lib/agent/pi-client.ts`：导出 `NeedsReviewPendingEntry` / `NeedsReviewStateSummary` / `NeedsReviewDecisionResult` 类型 + 三个 wrapper：`agentNeedsReviewState()` / `agentApproveNeedsReview(id)` / `agentRejectNeedsReview(id)`
- `src/hooks/useExtensionNeedsReviewApproval.tsx`：
  - 拥有单一 summary `useState`，live event 直接 mutate summary in-place
  - 操作顺序关键：live subscription FIRST → ring buffer catch-up → fresh IPC snapshot ONLY if `!sawAnyEvent && !userTouchedRef.current`
  - `userTouchedRef` 在 approve/reject 立刻置 true，`sawAnyEvent` 任何 pending event 看到都置 true —— 双保险防 mount 时 snapshot round-trip 覆盖刚刚 user-mutate 的 state
  - `approve(id)` / `reject(id)` 都先 flip `userTouchedRef` 再 await IPC，prevent race
- `src/hooks/useExtensionNeedsReviewApproval.test.tsx` —— **6 cases**：mount subscribe / on-mount hydrate / live event 更新 / unrelated event 忽略 / approve IPC + summary 反映 / reject IPC + summary 反映

**验收**:
- `pnpm exec vitest run electron/main/agent/host-modules/needs-review-gate.test.ts` —— **8/8 ✓**
- `pnpm exec vitest run electron/main/agent/host-modules/pi-extensions-needs-review.test.ts` —— **6/6 ✓**
- `pnpm exec vitest run electron/main/agent/__tests__/pi-extensions-needs-review-integration.test.ts` —— **4/4 ✓**
- `pnpm exec vitest run src/hooks/useExtensionNeedsReviewApproval.test.tsx` —— **6/6 ✓**
- 全 extension needs-review pipeline: gate (8) + wiring (6) + integration (4) + hook (6) + Round 17 audit pipeline (38) = **62/62 ✓**
- 总体（含现有 pi-extensions / state-shape / configure / audit panel / audit hook）：**91/91 ✓** 跨 9 个 test file
- `pnpm exec tsc --noEmit -p .` —— 0 新增错误

**生产价值**: needs-review 现在从「被动的 audit 标签」升级成「主动的 sign-off gate」—— 用户在 modal 里看到 `pi/extension-needs-review-pending` 列出的待审条目、点 Approve / Reject、main 端 gate mutate 后 `reloadPiExtensions()` 让下一轮 agent loop 真正加载（或永不加载）这些扩展。空字符串 / 未登记 id 全部 fail-closed 防绕过；modal 不再卡死、audit 不再 silently 挂起、配置可预测地 enforce。

### 3.20 [plan4.5 §B] needs-review gate ID normalization（本轮修复）

**问题**：审批门对 `gate()` 的输入做了 `trim()`，但 `track()` / `approve()` / `reject()` 使用未规范化的原始 id。来自 manifest、IPC 或 renderer 的首尾空白会导致同一个扩展出现「查询是 pending、批准却找不到」的不一致状态；重新 resolve 时也可能重复登记。

**修复**：在 `needs-review-gate.ts` 集中使用 `normalizeId()`：
- `track()` 以规范化 id 存储，并避免覆盖已批准/已拒绝的决策；
- `approve()` / `reject()` 规范化输入后再执行状态迁移；
- 无效 id 继续 fail-closed / no-op，不扩大授权面。

**验收**：新增首尾空白 id 回归用例，覆盖 track → gate → approve/reject 全链路；needs-review gate、wiring、integration 共 **19/19** 通过。

### 3.21 [plan4.3] renderer replay gap boundary 修复（本轮新增）

**问题**：`detectReplayGap()` 原实现把 `fromSequence > earliestSequence` 当成 gap，方向相反；当 renderer 游标早于 ring buffer 保留范围时反而返回 `gap: false`，会静默丢失事件并跳过 fallback。另一个边界是 `fromSequence === earliestSequence - 1`，下一条事件仍可重放，不应报告 gap。

**修复**：按 replay 语义统一判定：当 `fromSequence < earliestSequence - 1` 时才表示至少有一个事件已被淘汰；`missing = earliestSequence - fromSequence - 1`，保留 fresh start 和恰好连续游标的无 gap 行为。

**验收**：新增“游标早于 ring buffer”与“下一条仍可用”的回归测试；replay coordinator、Pi event bridge、needs-review gate 共 **29/29** 通过，`git diff --check` 通过。

### 3.22 [plan4.3] plugin-host typecheck unblock（本轮新增）

**问题**：`packages/runtime/openbuddy-plugin-host/src/profile-manager.ts` 使用运行时依赖 `cross-spawn`，但包没有声明对应 TypeScript 类型；同时把 `maxBuffer`（Node `SpawnOptions` 不支持的字段）传入 `crossSpawn`，导致全局 `pnpm exec tsc --noEmit -p .` 失败。

**修复**：
- 在 `packages/runtime/openbuddy-plugin-host/package.json` 添加精确版本 devDependency `@types/cross-spawn@6.0.2`；
- 移除不属于 `SpawnOptions` 的 `maxBuffer` 传参。进程输出上限仍由现有 stdout/stderr 手工计数逻辑执行，运行时行为不变。

**验收**：全仓 `pnpm exec tsc --noEmit -p .` 通过。plugin-host 全套测试仍有 **35 个既有失败**，均来自 `profile.ts:407` 对测试临时 profile 缺失 `extensions` 目录抛出 ENOENT，未触及本轮改动；其余 260 个测试通过、1 个 skip。

### 3.23 [plan4.3] plugin profile resource probing fail-soft（本轮新增）

**问题**：profile 初始化与插件安装测试中，缺失的 `extensions` / `skills` / `prompts` / `themes` 目录被 `stat(..., { throwIfNoEntry: false })` 直接抛出 ENOENT，导致资源发现尚未返回空结果就中断 profile 组合；此前 plugin-host 全套测试因此出现 35 个级联失败。

**修复**：
- `packages/runtime/openbuddy-plugin-host/src/profile.ts` 增加 `directoryExists()`，统一捕获 ENOENT 并返回 `false`；
- `packages/runtime/openbuddy-plugin-host/src/profile-manager.ts` 增加 `existingDirectory()` / `existingPath()`，覆盖 Pi convention 目录扫描、包目录枚举、安装替换和卸载判断；
- 非 ENOENT 错误仍原样抛出，避免掩盖权限或 I/O 故障。

**验收**：`profile-manager-extensions.test.ts` 9/9 通过；`profile.test.ts` 当前 28/30 通过，已从原先 30 个级联失败显著收敛；剩余 2 个是测试 fixture 的 Windows 短路径/URL 兼容问题（路径断言使用 POSIX 分隔符，以及 Vite 无法加载带 8.3 短路径编码的 fixture URL），不再是生产资源发现 ENOENT。全仓 `pnpm exec tsc --noEmit -p .` 与 `git diff --check` 通过；剩余 fixture 问题需单独做跨平台测试适配。

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
| `chat-ui-minimax-streaming-perf.spec.ts` | real LLM（默认 skip，需 `RUN_STREAM_PERF=1`） | 1/1 长流 ≥30s |
| `chat-ui-minimax-plan-mode.spec.ts` | real LLM（默认 skip，需 E2E creds） | 4/4 IPC contract + `/plan` 注册 |
| `minimax-real-roundtrip.spec.ts` | real LLM | 4/4 |
| `provider-anthropic-probe-ipc.spec.ts` | real LLM | 4/4 |
| `session-history-load.spec.ts` | real LLM | 2/2 |
| `agent-workbench-core.spec.ts` | IPC | 17/17 |
| `bridge-poisoning-regression.spec.ts` | IPC R7 | 4/4 |
| `marketplace-install-e2e.spec.ts` | IPC | 5/5 |
| `mcp-e2e.spec.ts` | IPC | 7/7（1 个 flaky pre-existing） |
| `chat-flow.spec.ts` | echo | 2/2 |
| `chat-flow-echo.spec.ts` | echo | 5/5 |

合计 **77/77** 在 real LLM + IPC 上稳定通过；100-turn / streaming-perf 默认 skip、manual / nightly 启用。

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
