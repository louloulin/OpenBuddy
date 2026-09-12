# OpenBuddy Office 文档全量集成计划（Plan office1 — 紧随 plan4.2）

> 版本：office1 · 日期：2026-09-11 · 适用仓库：`louloulin/OpenBuddy` ·
> 前序：plan4.md（WorkBuddy 微内核），plan4.1（e2e 清理），plan4.2（100 轮 + 多模态）·
> 触发：用户在 issue LUM-642 第二十一轮反馈"截图展示有问题"，要求
> 搜索 **Univer** 集成实现 PDF / Word / XLSX / PPT 等多格式文档
> 在 AI chat 内的**完整可视化**展示。
>
> **2026-09-11 决策修订 (round 22)**：用户在 issue LUM-642 第二十二
> 轮明确要求"**还是使用 univer 最佳实践，支持后续编辑的功能**"，
> 放弃降级路径（react-pdf + xlsx + mammoth + pptxjs 只读），改走
> **Univer 路径**。本文档 §6 / §8 / §3 阶段 1-2 全部按 Univer 重写。
>
> **2026-09-11 决策补充 (round 23)**：用户进一步要求"**搜索 pdf 最佳
> 的库，搜索顶级相关的 ai 工作台是如何实现，继续实现 pdf 预览
> 功能**"。本文档新增 §9（PDF 库调研 + AI 工作台对比），并把阶段
> 0-1 拆出"PDF 专项"，先用 **pdfjs-dist + react-pdf**（与 ChatGPT /
> Claude.ai / Cursor 同一库）把 PDF 预览做出来，再走 Univer 完成
> xlsx/docx/pptx 的编辑能力。

## 1. 背景与现状盘点

### 1.1 用户反馈

> "还是展示有问题"（截图 LUM-642 第二十一轮 shot 08：100 轮
> transcript 全部以纯文本 reply 形式出现，**没有任何文档被真正
> 渲染出来**——只有文字描述"PDF/docx/txt/markdown/csv/...8MB"
> 这样的元信息。）

> "搜索 univer 集成整个展示 pdf word xlsx ppt 等，
> 增加相关模块实现相关的文档功能展示。"

> "还是使用 univer 最佳实践，支持后续编辑的功能。"

### 1.2 现状盘点

| 能力 | 是否已有 | 证据 |
|---|---|---|
| Composer 接受 PDF/docx/xlsx/pptx attachment | ✅ 已有 | `packages/ui/openbuddy-ui-conversation/src/Composer.tsx::readAttachmentFile` 接受 `application/pdf` / `application/vnd.openxmlformats-officedocument.*` |
| IPC 协议 `type:"file"` part | ✅ 已有 | `electron/main/ipc/validation.ts::promptFilePart` |
| Agent-host 内联 `<document>` 块到 user prompt | ✅ 已有 | `electron/main/agent/host-modules/agent-prompt.ts` |
| 真打 100 轮 LLM 验收 | ✅ 已有 | `tests/electron/chat-ui-minimax-100-turns.spec.ts`（默认 skip） |
| **PDF/DOCX/XLSX/PPT 视觉预览** | ✅ 已有(v1) | `FilePreview.tsx` 已支持 PDF iframe + docx/pptx/xlsx ZIP/XML 提取预览(2026-09-11 修复) |
| **在线编辑 Office 文档** | ✅ 已有(xlsx/docx) | Univer 开源 preset 挂载可编辑视图;pptx 只读、完整往返编辑受 Pro 限制(§10) |
| **Univer 集成** | ✅ 已有 | `@univerjs/presets` + `preset-sheets-core` + `preset-docs-core` 均锁 0.25.1 |
| **`FilePreview` 升级为 Office 文档可视化** | ✅ 已有(v1) | `FilePreview.tsx` 支持 pdf(iframe)/image/markdown/code/text/audio/video/docx/pptx/sheet;无解析器时降级占位 |
| **plan4.2 提到的"PDF 阅读器"**（plan4.3 §3.1 P1） | ✅ v1 已落地 | PDF iframe 预览;PDF.js 升级版留 §9 |

### 1.2.1 根因复盘(2026-09-11,展示问题真正的断点)

用户多轮反馈"展示有问题"。排查结论:**不是 `FilePreview` 缺分支,
而是附件没有完整穿过真实聊天 transcript 链路**。断点与修复:

| # | 断点 | 修复 |
|---|---|---|
| 1 | `App.handleSendContent` 只调 `pushOptimisticUser(text)`,file part 进不了 optimistic transcript | `pushOptimisticUserContent(content)` |
| 2 | `MessagePart` 无 `file` 类型 | 新增 `{ kind:"file"; name; mediaType; data }` |
| 3 | `MessageItem.tsx` 只渲染 text/thought/tool_call,file part 被静默丢弃 | user/assistant 两个分支都渲染 `<FilePreview>` |
| 4 | PDF iframe 收到裸 base64(非完整 `data:` URL)无法预览 | `toPreviewDataUrl()` 包装,已是 `data:` 则不重复包装 |
| 5 | 历史 session projection 丢弃 provider 的 file/image part,reload 后附件消失 | `sessionEntriesToChatMessages()` 安全投影 file/image |
| 6 | 新会话分支只把文字传给 `handleSendNew`,附件丢失 | `handleSendNew(text, content)` + `newSessionFlow.content` |
| 7 | persona/project wrapper 改写整个 content,破坏附件 | 只替换第一个 text part |
| 8 | Composer 只接受 docx,不接受 xlsx/pptx | `SUPPORTED_DOC` 正则扩展三种 OOXML MIME |
| 9 | 搜索索引可能吞入 base64 | `extractPlainText()` 对 file part 只纳入文件名 |

**真实验收路径**(不允许用手工 append iframe 的测试冒充):

```
Composer(paste PDF) → App.handleSendContent → pushOptimisticUserContent
  → ChatView → MessageItem → FilePreview(.file-preview--pdf iframe)
```

- 单元/RTL 层:`MessageItem-file-preview.test.tsx`(4 项)、
  `session-store-ui`、`extract-text`、`pi-client-trace`、
  `new-session-flow`、`FilePreview` 共 70+ 用例。
- Electron 层:`chat-ui-minimax-document-preview.spec.ts` 真实驱动
  paste → 发送 → 断言 transcript 内 `.file-preview--pdf iframe` 的
  `src`/`title`。无凭证或上游 429 时 skip,不声称通过。

### 1.3 Univer 简介

[Univer](https://github.com/dream-num/univer) 是开源的 office
runtime，支持 spreadsheet（电子表格）、document（文字文档）、
slide（演示文稿）三种类型，Apache-2.0 协议。基于 ES module + plugin
架构：

| 库 | 用途 | 体积 (gzip) |
|---|---|---|
| `@univerjs/presets` | 三件套 preset（spreadsheet/document/slide） | ~3 MB |
| `@univerjs/sheets` | 单独 spreadsheet 引擎 | ~400 KB |
| `@univerjs/docs` | 单独 document 引擎 | ~350 KB |
| `@univerjs/slides` | 单独 slide 引擎 | ~300 KB |
| `@univerjs/ui` | React 渲染桥 | ~80 KB |
| `@univerjs/engine-render` | 渲染引擎 | ~700 KB |

**核心包约 5-6 MB gzip（presets），加 UI 桥 ~5.8 MB**。本仓库当前
bundle 是 5.3 MB，加 Univer 后预估 11-12 MB 主包 / **按需懒加载
可以拆到 1-2 MB 增量（每个 format 单独拆）**。

### 1.4 已有依赖

`@openbuddy/files-kb` 包已经实现了 docx/pptx/xlsx 的 zip 解析
（`extractDocxFromZip` / `extractPptxFromZip` / `extractSheetFromZip`）。
office1 阶段 1 复用这个 + 加 Univer 渲染层。

## 2. 目标与验收

### 2.1 目标

在 AI chat 的 transcript 内，模型发送的文档 attachment 不仅作为
chip 显示，而是**作为可交互的预览**：

- PDF：第一页缩略图（canvas 渲染）+ "点击展开全文"按钮
- DOCX：渲染为 HTML 段落（mammoth.js 提取文本 + 基础样式）
- XLSX：渲染为 sheet 表格（SheetJS → 二维数组 → HTML table），支持
  sheet 切换
- PPTX：每张 slide 一张缩略图（用 canvas 渲染为图片）

所有预览都遵守 8 MB 单文件上限（plan4.2 已经定了），并通过真实
上游 e2e 验证。

### 2.2 验收（生产级别）

- 9 个新增 e2e spec（plan4.2 9 + office1 9 = 18 个生产 spec）全部
  跑通：75/75 + 9/9 office1 = 84/84
- 真打 100 轮 LLM 测试中，1 轮"附件是 PDF" 的回合显示 PDF
  缩略图（不再是 "无法读取" 文字回复）
- 大文档（>1MB PDF）加载不卡顿，1s 内首屏
- 6 → 8 → 10 张截图：补 office 文档预览 2 张
- `docs/perf/<date>-office1.json` 性能数据
- 推到 main，0 force-push

## 3. 实施分阶段（Univer 路径，按风险 + 依赖排序）

### 3.1 [P0] 阶段 0：Univer spike + 体积基线

**为什么 P0**：Univer 5.8MB 是决策点，spike 在动手前完成：

1. 在新分支 `agent/office-univer-spike` 建一个最小 demo：
   - 1 个 `UniverSheetDemo.tsx` 组件，挂 spreadsheet
   - 1 个 `UniverDocDemo.tsx` 组件，挂 document
   - 1 个 `UniverSlideDemo.tsx` 组件，挂 slide
2. 各 demo 加载一个真实文件：5MB PDF（先转图片）/ 1MB xlsx / 500KB pptx
3. 测：首次加载时间 / bundle 增量 / 内存 / 编辑能力
4. 输出 `docs/office-render-decision.md`

**验收**：spike 报告 + bundle 体积数据。预计 3-5 天。

### 3.2 [P1] 阶段 1：依赖注入 + Univer 集成

**范围**：

- 加依赖到 `package.json`（2026-09-11 调研修订：协调版本线 0.25.1，
  全部 `@univerjs/*` 精确同版本，preset 模式代替细粒度包）：
  ```json
  "@univerjs/presets": "0.25.1",
  "@univerjs/preset-sheets-core": "0.25.1",
  "@univerjs/preset-docs-core": "0.25.1"
  ```
- **懒加载**：每个 format 一个 dynamic import 入口
  - `FilePreview.tsx` 改用 `<Suspense><LazyUniver kind={kind} ... /></Suspense>`
- FilePreview 加 4 个新分支：
  - `kind === "xlsx"` → `<UniverSheet data={base64} editable={true} />`
  - `kind === "docx"` → `<UniverDoc data={base64} editable={true} />`
  - `kind === "pptx"` → `<UniverSlide data={base64} editable={true} />`
  - `kind === "pdf"` → 暂时用 `<iframe src="data:application/pdf;base64,...">` 走浏览器原生（Univer 不支持 PDF）
- FilePreview 支持编辑：
  - `onSave?: (newBase64: string) => void` 回调
  - 编辑后 chip 显示 "已修改" + 重新上传按钮

**验收**：
- 现有 7 个 FilePreview test 仍 pass
- 新加 4 个 Univer test pass
- 主包增量 < 200KB（懒加载，Univer 在子 chunk）
- 实测编辑：上传 xlsx → 在 FilePreview 中改 A1 单元格 → onSave 回调拿到新 base64

### 3.3 [P1] 阶段 2：Composer → renderer 链路

**范围**：
- Composer 发送时多带一个 `preview: string` 字段（base64）
- IPC 协议 `PiPromptContentPart` 加 `preview?: string`
- agent-host 转发时保留 preview 字段
- transcript tree 在收到 `type:"file"` part 时，渲染 `<FilePreview>` 而非纯文字
- 当用户编辑后：`onSave` 触发 → 上传到 attachment-store → 触发后续 message

**验收**：
- 现有 6 个真实 LLM spec（real / extras / resilience / documents
  / multimodal / 100-turns）全过
- 1 个新增 `chat-ui-minimax-document-preview.spec.ts`：1 轮发送
  PDF attachment，断言 transcript 出现 `<canvas>` 或 Univer 编辑器
  节点

### 3.4 [P2] 阶段 3：截图 + 性能 baseline

**范围**：
- 改 `scripts/electron/capture-ai-chat-screenshots.mjs` 加 2 张
  截图：
  - `09-document-preview-pdf.png` — PDF iframe 在 transcript 内
  - `10-document-preview-xlsx.png` — Univer 表格在 transcript 内
- 写 `scripts/electron/perf-office1.mjs`：测 PDF / XLSX 加载时间
  + 内存 delta
- 写 `tests/electron/chat-ui-minimax-document-preview-perf.spec.ts`
  （默认 skip，需 `RUN_OFFICE_PERF=1`）

**验收**：
- 10 张截图全部干净
- 性能数据写入 `docs/perf/<date>-office1.json`
- bundle 总增量 < 1MB gzip（Univer 在子 chunk）

### 3.5 [P2] 阶段 4：编辑器模式（Univer 编辑能力）

**范围**：
- 文档 attachment chip 长按 → "在 OpenBuddy 中打开"
- 打开新工作区，使用 Univer 完整编辑
- 保存回原 attachment（base64 → xlsx/docx/pptx）
- 在 WorkBuddy 风格的"任务"surface 集成

**验收**：
- 编辑 → 保存 → 重新出现在 chat transcript 的新版 message
- spec 覆盖端到端流程

### 3.6 时间线

```
office1.0  (2026-09-11)  本文件，决策 A 锁定（Univer）
office1.1  (2026-09-18)  Univer spike 报告 + 体积基线
office1.2  (2026-09-25)  FilePreview Univer 集成（阶段 1+2）
office1.3  (2026-10-02)  截图 + 性能 baseline（阶段 3）
office1.4  (2026-10-09)  编辑器模式（阶段 4）
office1.5  (2026-10-16)  上线 main / nightly
```

## 4. 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| Univer 体积 8-10MB 拖累 Electron 启动 | 高 | 高 | 阶段 0 决策点；准备降级方案 |
| react-pdf worker 在 Electron 沙箱失败 | 中 | 中 | 阶段 1 用最小 PDF 跑通 |
| SheetJS 把 .xlsx 二进制解析错（金融格式） | 中 | 中 | spec 涵盖 3 种典型 xlsx（带图表/带公式/普通数据） |
| docx 复杂格式（图片/表格/嵌套）渲染丢失 | 高 | 中 | 降级为"只渲染段落文本"，UI 提示"完整预览请下载原文件" |
| pptx 缩略图性能（每张 slide 一张 canvas） | 中 | 低 | 限制最大渲染 10 张 |
| plan4.2 已删 19 个 spec，新加 office1 的 9 个会不会重新混乱 | 中 | 中 | office1 的 spec 严格走 README 的"生产级 kept"规则 |
| 用户需求范围继续扩大（"还要看 CAD / Visio / DWG..."） | 中 | 中 | 阶段 0 决策时锁定 4 种格式，CAD 留 plan5.x |

## 5. 与 plan4.x 的关系

| plan | 范围 | 状态 |
|---|---|---|
| plan4.md | WorkBuddy 微内核 / Pi 原生 / 插件化 | 已发布 |
| plan4.1 | e2e 清理（28 → 9 生产 spec） | 已合 main |
| plan4.2 | 100 轮 + 多模态（PDF/docx attachment） | 已合 main |
| **office1** | **Office 文档可视化（PDF/DOCX/XLSX/PPT 渲染）** | **本文件，决策 + 4 阶段** |
| plan4.3 | 真实 100-turn cost profile / 上下文截断 / streaming perf | 仍 open，等 office1 推进 |

office1 优先于 plan4.3，因为：
- 用户明确反馈"展示有问题"
- plan4.2 残留的"PDF 阅读器" P1 任务（plan4.3 §3.1）合并到 office1
- plan4.3 的 cost profile 跟 office1 独立，不阻塞

## 6. Univer 选型（已锁定）

| 维度 | 评估 |
|---|---|
| 编辑能力 | ✅ 完整 WorkBuddy 风格（spreadsheet/document/slide 全套） |
| 体积 | 5.8 MB gzip（presets 全套）；按 format 懒加载后子 chunk 1-2 MB |
| Electron 启动影响 | +0.5-1.0s 首次 cold start（懒加载后可降到 +0.1s） |
| 渲染质量 | 高（spreadsheet 矢量、document OOXML 兼容、slide 渲染） |
| 维护活跃度 | 活跃（2024-2026 持续发布） |
| 中文支持 | ✅ |
| 风险 | 大包体 + 复杂 API（缓解：按 format 懒加载 + 子 chunk） |

**2026-09-11 用户决策**：选 Univer 路径，**不**走降级组合。

替代方案（仅作记录）：react-pdf + xlsx + mammoth + pptxjs 降级组合，
~1.3 MB gzip 但只读，不支持后续编辑能力。**已放弃**。

## 7. 时间投入预估

| 阶段 | 工作量 |
|---|---|
| 阶段 0（Univer spike） | 3-5 天 |
| 阶段 1（依赖 + FilePreview Univer 集成） | 1.5 周 |
| 阶段 2（Composer 链路） | 1 周 |
| 阶段 3（截图 + perf） | 3 天 |
| 阶段 4（编辑器模式） | 1.5 周 |
| **合计** | **~5-6 周** |

每个阶段产出 1 个 commit + 1 个 PR 分支。等用户 review 后合 main。

## 8. 立即可启动的下一步

**用户已确认（2026-09-11）**：选 **A** 路径（Univer）。

下一轮直接：
1. 切到新分支 `agent/office-univer-spike`
2. 加 `@univerjs/presets` 等依赖到 `package.json`
3. 写 `docs/office-render-decision.md`（spike 报告）
4. 在 `packages/ui/openbuddy-ui-workbench/src/FilePreview.tsx` 加 Univer 分支
5. 写 `chat-ui-minimax-document-preview.spec.ts`（4 项验收）
6. 2 张新截图（PDF + XLSX 预览）

预计 stage 0 + stage 1 在 2-3 周完成 office1.0 → office1.2。

## 9. PDF 渲染库调研 + AI 工作台对比

### 9.1 用户触发（round 23）

> "**搜索 pdf 最佳的库，搜索顶级相关的 ai 工作台是如何实现，
> 继续实现 pdf 预览功能**"

本节解决两个问题：

1. 在 JS 生态里**最成熟的 PDF 渲染库**是什么
2. ChatGPT / Claude.ai / Cursor 等顶级 AI 工作台**实际怎么实现**
   PDF 预览

### 9.2 JS 生态 PDF 库对比（2026 年）

| 库 | 体积 (gzip) | 渲染方式 | 性能 | 文本选择 | 注释 | 维护 |
|---|---|---|---|---|---|---|
| **pdfjs-dist** (Mozilla, 官方 PDF.js) | ~1.2 MB + worker 0.5 MB | `<canvas>` 每页 | 优秀 | ✅ text layer | 自定义 | **活跃** |
| **react-pdf**（基于 pdfjs-dist） | ~1.2 MB + worker | `<Document>` React 组件 | 优秀 | ✅ text layer | 自定义 | **活跃** |
| `<iframe src="data:application/pdf">`（Electron 内置 PDFium） | 0 KB | Chromium 原生 | 最佳 | ✅ 原生 | ❌ 受限 | n/a（系统） |
| WebViewer (PDFTron) | 12 MB+ | canvas + 自定义 | 商业最佳 | ✅ | ✅ 完整 | 商业 |
| pdfium WASM (Foxit) | ~6 MB | canvas | 优秀 | ✅ | ✅ | 商业 |

**推荐**：
- **Electron 应用** → 直接用 `<iframe>` 走 Chromium PDFium（**0 KB JS**，
  最佳性能，Chromium 本身优化过的 PDF 渲染管线）
- **纯 Web 应用**或**需要 annotations / text layer** → 用 **`pdfjs-dist`** 或
  **`react-pdf`**（与 ChatGPT / Claude / Cursor 同款）

OpenBuddy 是 Electron 应用，**两条路都该走**：
- **Plan A** (主)：`<iframe>` 简单通用场景
- **Plan B** (高级)：`pdfjs-dist` 走自定义 text layer（用户可复制文本，模型可引用页码）

### 9.3 顶级 AI 工作台 PDF 实现对比

| 工具 | 渲染方式 | 文本层 | 重点 |
|---|---|---|---|
| **ChatGPT** | PDF.js canvas | 有限 | 忠实文档显示，研究论文/书 |
| **Claude.ai** | PDF.js canvas | 有限 | 聊天集成阅读 |
| **Cursor** | PDF.js + text layer | ✅ 完整 | 代码上下文参考，可复制代码 |

**共同模式**：
- 都用 **PDF.js**（Mozilla）
- CDN 加载 `cdnjs.cloudflare.com/ajax/libs/pdf.js/`
- 多 canvas 渲染（每页一个 canvas）
- Web worker 解析（off main thread）
- **没人用 `<iframe>` 或 native viewer** — 都需要 canvas 层的 UI 控制

### 9.4 OpenBuddy 选型结论

**PDF：两条路并行**
- **v1 (1-2 天)**：`<iframe>` 走 Chromium PDFium — 0 KB JS 增量，最快交付
- **v2 (3-5 天)**：`pdfjs-dist + react-pdf` 走 ChatGPT 同款 — text layer 可
  复制 + 模型可引用页码

**XLSX / DOCX / PPTX**：走 Univer（已锁定）— 完整编辑能力

### 9.5 修订后的阶段 0 计划

```
阶段 0A: ✅ 已完成 — PDF iframe 走通（v1，Electron 原生）
   - FilePreview.tsx kind === "pdf" 分支 + chat-ui-minimax-document-preview.spec.ts

阶段 0B: ✅ 已完成 — PDF.js canvas 预览（v2，2026-09-11）
   - 依赖: pdfjs-dist 6.3.289（精确锁定；v6 纯 ESM，要求 Node ≥ 22.13，
     本仓库 Node 24 满足）
   - 不用 react-pdf 包装层，直接 pdfjs-dist API（组件更轻、控制更全）：
     packages/ui/openbuddy-ui-workbench/src/pdfjs-loader.ts —— 懒加载 +
     `pdf.worker.min.mjs?url` 本地 worker（不用 CDN，electron-vite
     file:// 构建稳定）
   - PdfJsPreview.tsx —— 首屏最多 3 页 + devicePixelRatio 高分屏缩放 +
     doc.destroy() 卸载清理；任何失败降级回 v1 iframe，永不白屏
   - jsdom 单测 mock loader 驱动 canvas 成功路径与 iframe 降级路径

阶段 1: ✅ 已完成 — FilePreview 接入 Univer 0.25.1（2026-09-11）
   - xlsx → Univer 可编辑表格，docx → Univer 可编辑文档
   - 绕开 Pro exchange：files-kb 解析 OOXML → 开源 createWorkbook /
     createUniverDoc（授权边界与取舍见 §10）
   - pptx 保持只读（无开源 slides preset，是 Pro 能力）
   - 懒加载拆 chunk，主包零增量；univerEditing={false} 可强制只读

阶段 2: 1 周 — Composer → renderer 链路（编辑结果回流会话）
阶段 3: 3 天 — 截图 + perf
阶段 4: 1.5 周 — 完整往返编辑（阻塞：需 Univer Pro 许可决策，见 §10.3）
```

**阶段 1 Univer 依赖修订（2026-09-11 调研）**：原计划写 `^0.6.0` 已过时。
当前协调版本线 **0.25.1**（2026-06 发布），规则：所有 `@univerjs/*`
必须**精确同版本**。按 preset 模式（React 官方推荐）：

```json
"@univerjs/presets": "0.25.1",
"@univerjs/preset-sheets-core": "0.25.1",
"@univerjs/preset-docs-core": "0.25.1"
```

- 在 `useEffect` 里 `createUniver({ presets: [...] })`，卸载时
  `univerAPI.dispose()`（内存泄漏防护）
- 必须 `import '@univerjs/preset-sheets-core/lib/index.css'`
- 需要 `Intl.Segmenter`（Node 24 / 现代 WebView2 自带）
- xlsx → `UniverSheetsCorePreset`，docx → `preset-docs-core`；
  **pptx 无开源 slides preset**（见 §10）；按 format dynamic import 拆 chunk

### 9.6 引用来源

- [Web Search: best PDF rendering library JavaScript React 2025] — 体积 + 性能对比
- [Web Search: ChatGPT Claude.ai Cursor PDF document preview implementation] — 顶级 AI 工具 PDF 实现对比

## 10. Univer 授权边界（2026-09-11 阶段 1 实施发现）

### 10.1 关键发现：原生 Office 导入导出是 Pro 商业能力

阶段 1 动手实施时核实了 Univer 的实际能力边界，**推翻了本计划
前面几节的一个隐含假设**（"装上 Univer 就能直接打开 .xlsx"）：

| 能力 | 包 | 授权 | 是否需服务端 |
|---|---|---|---|
| spreadsheet 编辑内核 + UI | `@univerjs/preset-sheets-core` | ✅ Apache-2.0 | ❌ 不需要 |
| document 编辑内核 + UI | `@univerjs/preset-docs-core` | ✅ Apache-2.0 | ❌ 不需要 |
| **xlsx / docx 二进制导入导出** | `@univerjs-pro/*-exchange-client` | ❌ **商业 Pro** | ✅ **需 Univer Server** |
| **pptx 导入导出** | `@univerjs-pro/slides-exchange-client` | ❌ **商业 Pro** | ✅ **需 Univer Server** |
| **slides（演示文稿）整体** | `@univerjs/slides` + Pro 插件 | ❌ **Pro，且无 preset** | 部分需要 |

官方原话：
- "The import and export functionality requires support from the Univer
  server."（Sheets Import & Export 文档）
- "There is currently no Slides preset, so create the application in
  plugin mode."（Slides Installation 文档）
- "Univer Slides is the presentation product in **Univer SDK Pro**."

对 OpenBuddy 的含义：**不能**走 Pro 路线。OpenBuddy 是 BYOK 桌面应用，
没有后端服务，也不该替用户做商业授权与部署决策。

### 10.2 采用的方案：files-kb 解析 + Univer 开源内核

绕开 Pro exchange，用仓库已有的 OOXML 解析器喂 Univer 开源 API：

```
xlsx ──extractSheetFromZip()──▶ SheetExtract{sheets:[{name,rows}]}
        ──sheetSourceToWorkbookData()──▶ createWorkbook()  ← 开源 API
docx ──extractDocxFromZip()───▶ text
        ──docTextToDocumentData()────▶ createUniverDoc()   ← 开源 API
pptx ──extractPptxFromZip()───▶ text（只读，无开源 slides preset）
```

实现文件：
- `packages/ui/openbuddy-ui-workbench/src/univer-bridge.ts` — 纯函数
  转换层（OOXML 提取结果 → Univer 快照结构），9 个单测
- `.../univer-loader.ts` — 按 format 懒加载 preset + locale + CSS
- `.../UniverEditor.tsx` — effect 内挂载 / 卸载 dispose / 失败降级
- `FilePreview.tsx` — sheet/docx 分支优先 Univer，失败回落只读预览

### 10.3 已知取舍（必须如实告知用户）

| 项 | 现状 | 原因 |
|---|---|---|
| 单元格**值**还原 | ✅ | files-kb 解析 sharedStrings + worksheet XML |
| 多 sheet、sheet 名、顺序 | ✅ | 桥接层保留 |
| docx 段落文本 | ✅ | dataStream + paragraphs |
| 单元格**样式**（字体/颜色/边框） | ❌ 丢失 | 需 Pro exchange 才能完整还原 |
| **公式** | ❌ 丢为值 | 同上 |
| 图表 / 图片 / 数据透视 | ❌ 丢失 | 同上 |
| **编辑结果回写 .xlsx 文件** | ❌ 未实现 | 导出需 Pro exchange；可编辑但不能存回原格式 |
| pptx 编辑 | ❌ 只读 | 无开源 slides preset |

所以当前交付的是**"可视化 + 可交互编辑（会话内）"**，不是
**"完整保真的 Office 往返编辑"**。后者必须购买 Univer Pro 许可并
部署 Univer Server —— 这是需要用户拍板的商业决策，不由本实施代做。

### 10.4 体积与性能

- Univer preset 约 5-6 MB gzip，**全部落在按 format 拆分的懒加载
  chunk**，主包零增量；只有用户真的打开 xlsx/docx 才付这个代价
- `univerEditing={false}` 可强制只读，用于长 transcript 里的历史
  附件（避免 100 轮会话挂 100 个渲染引擎）
- 卸载必须 `univer.dispose()`，每个实例携带渲染引擎，泄漏一个即
  数十 MB

### 10.5 引用来源

- [Univer Sheets Import & Export](https://docs.univer.ai/guides/sheets/features/import-export)
- [Univer Slides Installation（无 preset）](https://docs.univer.ai/guides/slides/getting-started/installation)
- [Univer Slides（Pro 产品定位）](https://docs.univer.ai/guides/slides)
- [Univer Pro Server 部署与 License](https://docs.univer.ai/guides/pro/server)
- [Univer React 集成官方指南](https://docs.univer.ai/guides/sheets/getting-started/integrations/react)
- [@univerjs-pro/sheets-exchange-client](https://www.npmjs.com/package/@univerjs-pro/sheets-exchange-client)

## 11. 本轮修订（2026-09-12，feature/doc0911）

### 11.1 已修复的真实展示断点

本轮复现发现，前端 `Composer` 虽然已经识别 `.docx/.xlsx/.pptx`，但 Electron IPC 边界仍只允许 docx MIME，导致 xlsx/pptx 在发送阶段被拒绝，附件无法进入真实 transcript。这不是 `FilePreview` 的 CSS 问题，而是发送链路的协议不一致。

已统一以下边界：

- `normalizePromptContent()` 接受 `type: "file"`，保留 `mediaType/data/name`。
- `promptFilePart()` 接受 PDF、DOCX、XLSX、PPTX 及既有文本格式，继续执行 8 MB 解码后大小限制。
- PDF.js v6 使用 `PDFDocumentLoadingTask.destroy()` 清理 worker；测试 fake 没有该方法时兼容回退到 `PDFDocumentProxy.destroy()`。
- `assets.d.ts` 声明 Vite `*.mjs?url` 本地 worker 资源，避免 workbench 子包类型检查漏报。

真实链路现在固定为：

```
Composer(paste/drop Office file)
  → App.handleSendContent
  → agent:prompt-content IPC validation
  → pushOptimisticUserContent
  → ChatView / MessageItem
  → FilePreview
  → PDF.js canvas 或 Univer editor / read-only OOXML fallback
```

### 11.2 本轮验证结果

- 文档预览、PDF canvas/iframe 降级、Univer bridge、消息 transcript、new-session content 保真、Pi trace 与 IPC validation：**6 个测试文件，76/76 通过**。
- 新增 IPC 回归覆盖 DOCX/XLSX/PPTX 三种 Office MIME，确保后续不会再次出现“Composer 能选、IPC 不能发”的断点。
- 根项目 TypeScript 检查仍有仓库既有 `cross-spawn` 类型声明和 `ImportMeta.env` 环境配置错误；本轮新增的 PDF.js `PDFDocumentProxy.destroy` 类型错误已修复。Electron 真实 LLM e2e 需要有效凭证与可用上游，不能用本地单测冒充通过。

### 11.3 后续最佳实现计划（按依赖顺序）

1. **真实 Electron 文档验收**：用固定 fixture 通过 Composer 发送 PDF/DOCX/XLSX/PPTX，断言 transcript 内分别出现 PDF canvas/iframe、Univer host 或 OOXML 只读 fallback；补充 reload 后历史 projection 断言。
2. **PDF 阅读器增强**：保留 PDF.js 本地 worker 和 iframe 永不白屏降级；下一步增加页码导航、按需渲染剩余页面、文本层/复制能力，再测 1 MB 以上文件首屏时间。
3. **Office 编辑边界**：Univer 开源 preset 继续支持 xlsx/docx 的会话内编辑；pptx 继续明确只读。若要求原始格式高保真保存，必须单独评估 Univer Pro exchange + Server + license，不能把开源 snapshot 当作完整 Office 往返编辑。
4. **编辑结果回流**：在确认授权方案后设计 `onSave`/attachment-store/新 message 的闭环；未完成前不显示“已保存原文件”这类误导状态。
5. **性能与资源治理**：长 transcript 默认对历史附件使用 `univerEditing={false}`；只对用户主动打开的文档挂载编辑器，卸载时必须 dispose，避免 100 轮会话创建大量 Univer render engine。

本文件后续每次更新都必须同时记录：实际支持格式、授权边界、测试证据和未完成项，避免计划描述超过真实实现能力。
