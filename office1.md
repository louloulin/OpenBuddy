# OpenBuddy Office 文档全量集成计划（Plan office1 — 紧随 plan4.2）

> 版本：office1 · 日期：2026-09-11 · 适用仓库：`louloulin/OpenBuddy` ·
> 前序：plan4.md（WorkBuddy 微内核），plan4.1（e2e 清理），plan4.2（100 轮 + 多模态）·
> 触发：用户在 issue LUM-642 第二十一轮反馈"截图展示有问题"，要求
> 搜索 **Univer** 集成实现 PDF / Word / XLSX / PPT 等多格式文档
> 在 AI chat 内的**完整可视化**展示。

## 1. 背景与现状盘点

### 1.1 用户反馈

> "还是展示有问题"（截图 LUM-642 第二十一轮 shot 08：100 轮
> transcript 全部以纯文本 reply 形式出现，**没有任何文档被真正
> 渲染出来**——只有文字描述"PDF/docx/txt/markdown/csv/...8MB"
> 这样的元信息。）

> "搜索 univer 集成整个展示 pdf word xlsx ppt 等，
> 增加相关模块实现相关的文档功能展示。"

### 1.2 现状盘点

| 能力 | 是否已有 | 证据 |
|---|---|---|
| Composer 接受 PDF/docx/xlsx/pptx attachment | ✅ 已有 | `packages/ui/openbuddy-ui-conversation/src/Composer.tsx::readAttachmentFile` 接受 `application/pdf` / `application/vnd.openxmlformats-officedocument.*` |
| IPC 协议 `type:"file"` part | ✅ 已有 | `electron/main/ipc/validation.ts::promptFilePart` |
| Agent-host 内联 `<document>` 块到 user prompt | ✅ 已有 | `electron/main/agent/host-modules/agent-prompt.ts` |
| 真打 100 轮 LLM 验收 | ✅ 已有 | `tests/electron/chat-ui-minimax-100-turns.spec.ts`（默认 skip） |
| **PDF 文本提取**（模型可读 PDF 内容） | ❌ 缺 | 当前 PDF 是 opaque base64 块 |
| **docx 文本提取**（同上） | ⚠️ 半 | `@openbuddy/files-kb::extractDocxFromZip` 已有，但 Composer 没接 |
| **xlsx 表格渲染** | ❌ 缺 | 没有 spreadsheet 渲染层 |
| **pptx 幻灯片渲染** | ❌ 缺 | 没有 slide preview 层 |
| **PDF 视觉预览**（在 chat 内嵌 PDF 第一页缩略图） | ❌ 缺 | 只有 chip |
| **Univer 集成** | ❌ 缺 | 仓库无 `@univerjs/*` 依赖 |
| **`FilePreview` 升级为 Office 文档可视化** | ⚠️ 半 | `packages/ui/openbuddy-ui-workbench/src/FilePreview.tsx` 只支持 markdown/image/code/text |
| **plan4.2 提到的"PDF 阅读器"**（plan4.3 §3.1 P1） | 仍 open | 本计划合并到 office1 完成 |

### 1.3 Univer 简介（候选 1）

[Univer](https://github.com/dream-num/univer) 是开源的 office
runtime，支持 spreadsheet（电子表格）、document（文字文档）、
slide（演示文稿）三种类型，Apache-2.0 协议。基于 ES module + plugin
架构，可以拆包：

| 库 | 用途 |
|---|---|
| `@univerjs/presets` | 一次性引入三件套（spreadsheet/document/slide） |
| `@univerjs/sheets` | 单独引入 spreadsheet |
| `@univerjs/docs` | 单独引入 document |
| `@univerjs/slides` | 单独引入 slide |
| `@univerjs/ui` | 渲染层（React/Vue 桥） |
| `@univerjs/engine-*` | 公式引擎 / 渲染引擎 |

gzip 后核心包约 2-3 MB（spreadsheet only）。本仓库当前 bundle 已
是 5.3 MB（`src-CYPRYkjA.js`），加 Univer 后预估 8-10 MB。

### 1.4 候选 2 — `react-pdf` + `xlsx` + `pptxjs`

如果 Univer 体积太大，**降级方案**：

| 格式 | 库 | 体积 | 渲染质量 |
|---|---|---|---|
| PDF | `react-pdf` (基于 PDF.js) | ~600KB gzip | 高 |
| XLSX | `xlsx` (SheetJS) | ~200KB | 静态转 HTML 表格，不能编辑 |
| DOCX | `docx-preview` (基于 mammoth.js) | ~150KB | 仅文本提取后 HTML 渲染 |
| PPTX | `pptxjs` | ~300KB | 仅静态缩略图 |

降级方案总 ~1.3 MB，**但只能看不能编辑**。如果用户只要求"展示"，降级方案够用；如果要求"在线编辑"（WorkBuddy 风格），必须用 Univer。

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

## 3. 实施分阶段（按风险 + 依赖排序）

### 3.1 [P0] 阶段 0：决策 Univer vs 降级方案

**为什么 P0**：Univer 8-10MB 是 Web 体积翻倍，决策错了会回滚成本
高。先用一周时间在 PR 之外做 spike：
1. 在 `apps/admin-portal`（独立 app）做技术 demo
2. 用一份真 PDF（5MB）+ 真 xlsx（1MB）+ 真 pptx（500KB）
3. 测：首次加载时间 / bundle 增量 / 内存 / 编辑能力
4. 决策：Univer 还是降级方案

**验收**：spike 报告 + 决策文件 `docs/office-render-decision.md`。
预计 1 周。

### 3.2 [P1] 阶段 1：FilePreview 升级

**范围**（无论 Univer / 降级）：

- `packages/ui/openbuddy-ui-workbench/src/FilePreview.tsx` 加新分支：
  - `kind === "pdf"` → `react-pdf` <Document> 渲染
  - `kind === "xlsx"` → `xlsx.read()` → 二维数组 → `<table>`
  - `kind === "docx"` → `mammoth.convertToHtml()` → `<div>`
  - `kind === "pptx"` → `pptxjs` → 缩略图列表
- 每个分支懒加载（dynamic import）保证不增加主包体积
- 集成测试：`FilePreview.test.tsx` 加 4 个新 case

**验收**：
- 现有 7 个 FilePreview test 仍 pass
- 新加 4 个 test pass
- 包大小增量 < 800KB gzip（懒加载 + 主包只放选择器）

### 3.3 [P1] 阶段 2：Composer → renderer 链路

**范围**：
- Composer 发送时多带一个 `preview: string` 字段（base64 / URL）
- IPC 协议 `PiPromptContentPart` 加 `preview?: string`
- agent-host 转发时保留 preview 字段
- transcript tree 在收到 `type:"file"` part 时，渲染 FilePreview 而非纯文字

**验收**：
- 现有 6 个真实 LLM spec（real / extras / resilience / documents
  / multimodal / 100-turns）全过
- 1 个新增 `chat-ui-minimax-document-preview.spec.ts`：1 轮发送
  PDF attachment，断言 transcript 出现 `<canvas>` 或 `<table>` 或
  `<div class="docx-preview">` 节点

### 3.4 [P2] 阶段 3：截图 + 性能 baseline

**范围**：
- 改 `scripts/electron/capture-ai-chat-screenshots.mjs` 加 2 张
  截图：
  - `09-document-preview-pdf.png` — PDF 缩略图在 transcript 内
  - `10-document-preview-xlsx.png` — 表格在 transcript 内
- 写 `scripts/electron/perf-office1.mjs`：测 PDF/XLSX 加载时间
  + 内存 delta
- 写 `tests/electron/chat-ui-minimax-document-preview-perf.spec.ts`
  （默认 skip，需 `RUN_OFFICE_PERF=1`）

**验收**：
- 10 张截图全部干净
- 性能数据写入 `docs/perf/<date>-office1.json`

### 3.5 [P3] 阶段 4：编辑器模式（可选）

**范围**（**仅** Univer 路径）：
- 文档 attachment chip 长按 → "在 OpenBuddy 中打开"
- 打开新工作区，使用 Univer 完整编辑
- 保存回原 attachment（base64 → xlsx/docx/pptx）

**验收**：手动验证（生产 spec 覆盖不全，UI 路径多）

### 3.6 时间线

```
office1.0  (2026-09-11)  本文件，决策点
office1.1  (2026-09-18)  Spike 报告：Univer vs 降级方案
office1.2  (2026-09-25)  FilePreview 升级（阶段 1+2）
office1.3  (2026-10-02)  截图 + 性能 baseline（阶段 3）
office1.4  (2026-10-09)  编辑器模式（阶段 4，可选）
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

## 6. 附录：Univer 选型对照

| 维度 | Univer | 降级组合 (react-pdf + xlsx + mammoth + pptxjs) |
|---|---|---|
| 编辑能力 | ✅ 全功能 | ❌ 只读 |
| 体积 | 8-10MB gzip | 1.3MB gzip |
| Electron 启动影响 | +0.5s | +0.05s |
| 渲染质量 | 高（矢量/光栅混合） | 中（PDF 矢量、表格静态、pptx 缩略图） |
| 维护活跃度 | 活跃（2024-2026 持续发布） | 参差（mammoth 慢更、pptxjs 罕更） |
| 中文支持 | ✅ | ✅ |
| 风险 | 大包体 + 复杂 API | 多依赖 + 编辑缺失 |

**默认推荐**：先用 **react-pdf + xlsx + mammoth + pptxjs 降级组合**
做"只读预览"（阶段 1-3）。如用户后续要求"在线编辑"，再走
**Univer 升级路径**（阶段 4 之后开新 plan office2）。

## 7. 时间投入预估

| 阶段 | 工作量 | 谁 |
|---|---|---|
| 阶段 0（决策） | 1 周 | agent + 用户 review |
| 阶段 1（FilePreview） | 1 周 | agent |
| 阶段 2（链路） | 3 天 | agent |
| 阶段 3（截图/perf） | 2 天 | agent |
| 阶段 4（编辑器） | 1 周 | agent |
| **合计** | **~4 周** | |

每个阶段产出 1 个 commit + 1 个 PR 分支。等用户 review 后合 main。

## 8. 立即可启动的下一步

**等您决定**（最简一行回）：
- "**A**" — 走 Univer 路径（重，编辑能力）
- "**B**" — 走降级路径（轻，只读预览）
- "**C**" — 等我做 Univer spike 报告再决定（1 周）
- "**D**" — 我现在没时间，先做别的

我的推荐：**B（降级）**。理由：
1. plan4.2 已经把"text extraction + XML block"做了，PDF/DOCX 真实
   可读 + 降级预览合并起来，1-2 周完成
2. Univer 风险高，spike 投入大，先把"能看"做到生产级
3. 用户后续要求编辑能力时，再开 plan office2 走 Univer

如果选 B，阶段 1+2 立即可以开工。