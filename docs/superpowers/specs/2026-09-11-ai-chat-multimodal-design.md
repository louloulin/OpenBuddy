# AI Chat 1000 轮 + 多模态支持 — 设计 + 实施方案

**触发 issue:** LUM-642
**HEAD at design time:** `1be7c9b` (origin/main, 已合 cleanup 分支)
**作者:** multica-agent
**日期:** 2026-09-11

## 1. 现状盘点

| 能力 | 是否支持 | 证据 |
|---|---|---|
| Markdown 渲染 | ✅ 已有 | `ChatView.tsx` 用 `createMarkdownHostConfig` 渲染回复；多个 spec (`chat-ui-minimax-real`, `chat-ui-minimax-real-extras`) 验证过 |
| 图片附件 (粘贴/拖拽) | ✅ 已有 | `Composer.tsx:430-462` `readImageFile`：支持 png/jpeg/webp/gif，base64 通过 `piSendContent` 发送；限 16MB |
| 文档附件 (PDF/docx/txt) | ❌ **没有** | `readImageFile` 直接 `if (!file.type.startsWith("image/")) return null;` — PDF/docx 被拒绝 |
| 1000 轮长会话 | ⚠️ **没测过** | session history IPC 支持 `maxMessages` 分页 (`rpc-contract.ts:195`)，但没有验证 1000 轮下性能 + 正确性 |
| 上下文窗口截断 | ⚠️ **未发现自动截断** | grep 没找到 truncate/MAX_MESSAGES 之类；可能靠 LLM 上游自己超限报错 |
| 性能监控 | ⚠️ **有 perf-baseline spec 但已删** | 之前清理时删了 `perf-baseline.spec.ts` 等 3 个 perf spec |

## 2. 用户需求拆解

> "支持 1000 次对话分析整个 ai chat 性能和交互，这次更多的交互内容 markdown 等，图片，文档等等多内容是否支持"

- **A. 1000 轮对话** = 长会话稳定性 + 性能
- **B. markdown** = 已有，确认不破
- **C. 图片** = 已有，确认不破 + 验证最大尺寸/多图
- **D. 文档（PDF/docx/txt/md）** = **缺**，要实现

## 3. 方案对比

| 方案 | 范围 | 工作量 | 价值 |
|---|---|---|---|
| A. 最小 | 只跑 1000 轮回归 + 截图 | 1-2h | 验证现状稳定 |
| B. 中等 | A + 文档附件支持 (PDF/docx/txt/md) + 1000 轮真实 LLM spec | 3-4h | 完整 |
| **C. 完整 (选这个)** | B + 上下文窗口截断策略 + 1000 轮 perf 监控 + 8 张新截图 | 5-7h | 生产级 |

选 **C**，因为用户说"达到生产级别"。

## 4. 实施方案 (C)

### 4.1 文档附件支持（最大改动）

**改动**：`packages/ui/openbuddy-ui-conversation/src/Composer.tsx`

- `readImageFile` → 重命名为 `readAttachmentFile`
- 新支持 MIME：
  - `application/pdf`（提取文本后内联）
  - `text/plain`、`text/markdown`、`text/csv`
  - `application/json`、`application/xml`
  - `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (docx) — 用 JSZip 提取 document.xml 中的纯文本
  - **不**支持**代码可执行附件**（防止注入）
- 单文件大小限制：从 16MB（image）改为 8MB（任何附件）
- 多个附件：当前 UI 已经有 `attachments: string[]` 状态，复用
- 发送时组装成 `piSendContent` 多模态数组：
  ```ts
  { type: "text", text: userText }
  { type: "file", mediaType: "application/pdf", data: "<base64>", name: "x.pdf" }
  ```
- 落库到 `piSendContent` IPC 通道；pi 上游负责解析 PDF/docx

**新加 1 个 e2e spec**：`tests/electron/chat-ui-minimax-documents.spec.ts`

- 7 项：
  1. 拖拽 PDF 附件 → composer 显示 chip → 发送 → 真实 MiniMax 引用文档内容回复
  2. 拖拽 docx 附件 → 同上
  3. 拖拽 txt 附件 → 同上
  4. 拖拽超大文件 (>8MB) → toast 拒绝
  5. 同时拖多附件 → 全部 chip 渲染
  6. 拖非支持格式 (.exe) → 拒绝
  7. markdown-only 消息（无附件）继续工作（regression guard）

### 4.2 1000 轮长会话

**改动**：不写新代码。写一个**生成式 spec** 在 spec 文件里程序化生成 1000 条 user/assistant 交替消息，跑回归。

**新加 1 个 e2e spec**：`tests/electron/chat-ui-minimax-1000-turns.spec.ts`

- 流程：
  1. 通过 IPC 注入 1000 条历史 user prompt（每条 1-2 句真实中文/英文，生成式模板随机）
  2. 不真打 1000 次 LLM（成本/时间不可接受）
  3. **重在验证**：
     - 渲染：1000 条消息全部在 transcript 里，DOM 不爆
     - 性能：渲染总耗时 < 10s（v8 / DOM 性能基线）
     - 内存：page.evaluate `performance.memory` 增量 < 200MB
     - 滚动：滚动到顶/底不卡顿
     - 搜索：transcript 搜索能命中
- 跳过条件：默认 skip（不在 CI 跑），通过 `RUN_1000_TURNS=1` 启用，作为手动验证 + nightly

### 4.3 Markdown / Image 不破

**新加 1 个 e2e spec**：`tests/electron/chat-ui-minimax-multimodal.spec.ts`

- 4 项：
  1. 粘贴 PNG（base64）→ 真实 MiniMax 引用图描述
  2. 拖拽 JPG → 同上
  3. 回复包含代码块 + 表格 + 链接 → 渲染保留
  4. 回复包含列表 + 嵌套引用 → 渲染保留

### 4.4 性能 baseline（轻量）

- 不重写 perf 基准。改用 `chat-ui-minimax-1000-turns.spec.ts` 内的 `performance.now()` 测量：
  - 初始渲染
  - 滚动 fps
  - 输入到首 token 延迟（端到端 IPC 测量）
- 输出 JSON report 到 `docs/perf/2026-09-11-openbuddy-ai-chat-perf.json`

### 4.5 8 张新截图

在 `scripts/electron/capture-ai-chat-screenshots.mjs` 加 2 张：

- `07-document-attachment.png` — 拖拽 PDF 进 composer 显示 chip + 真实 MiniMax 引用文档回答
- `08-1000-turns-overview.png` — 注入 1000 条历史后的 transcript 全景

外加 6 张之前已有的保留。

## 5. 文件清单

| 文件 | 操作 |
|---|---|
| `packages/ui/openbuddy-ui-conversation/src/Composer.tsx` | 改 `readImageFile` → `readAttachmentFile` |
| `tests/electron/chat-ui-minimax-documents.spec.ts` | 新增 (~120 行) |
| `tests/electron/chat-ui-minimax-1000-turns.spec.ts` | 新增 (~150 行) |
| `tests/electron/chat-ui-minimax-multimodal.spec.ts` | 新增 (~100 行) |
| `scripts/electron/capture-ai-chat-screenshots.mjs` | 加 2 张截图 |
| `docs/superpowers/specs/2026-09-11-ai-chat-multimodal-design.md` | 本设计文档 |

**保留 9 + 1 = 10 个原有 spec + 3 个新 spec = 13 个总。**

## 6. 风险与回退

- 改动 `Composer.tsx` 涉及核心路径。先 typecheck 严格，**再**跑现有 9 spec 验证不破
- 1000 轮 spec 默认 skip，仅 manual / nightly
- 所有改动在新分支 `agent/ai-chat-1000-and-multimodal` 上做，**不**直推 main
- 任何 spec 失败 → 修根因，不修 spec 凑数

## 7. 验收

- `git ls-files tests/electron/ | wc -l` = 13（10 保留 + 3 新）
- 现有 10 个 spec 49/52 全过（不变）
- 3 个新 spec：documents 7/7、multimodal 4/4、1000-turns（skip 默认）
- 6+2 = 8 张截图
- 一个 perf JSON report
- 全部分支 + PR + origin/main 同步

---

**等您决策**（任一即可）：
- "OK 执行" — 按 C 方案全做
- "只要 A" — 只跑 1000 轮回归
- "只要文档" — 跳过 1000 轮，只做多模态
- "再讨论" — 我把某节改写

预计工作量 5-7h（spec + 实现 + 验证 + 截图 + 推送 + 回复）。