# OpenBuddy Office / Artifacts 第二阶段实施计划（office2）

> 版本：office2 · 日期：2026-09-13 · 分支：`feature/doc0911`
> 前置计划：`office1.md`
> 目标：在已有 PDF.js、Univer、Office transcript 和 Artifacts descriptor/registry 基础上，完成“可追踪产物 → 可预览工作区 → 会话内版本 → 真实验收证据”的闭环。

## 1. 当前基线

`feature/doc0911` 已具备以下能力：

| 能力 | 当前状态 | 主要位置 |
|---|---|---|
| PDF 预览 | PDF.js 本地 worker、canvas 首屏最多 3 页、按需加载更多页面、失败 iframe 降级 | `packages/ui/openbuddy-ui-workbench/src/PdfJsPreview.tsx` |
| DOCX/XLSX | 复用 OOXML 提取器，接入 Univer 0.25.1 开源 preset，会话内可编辑 | `packages/ui/openbuddy-ui-workbench/src/UniverEditor.tsx`、`univer-bridge.ts` |
| PPTX | 只读结构/文本预览 | `packages/ui/openbuddy-ui-workbench/src/FilePreview.tsx` |
| 附件发送链路 | Composer → IPC → optimistic transcript → MessageItem → FilePreview | `packages/ui/openbuddy-ui-conversation/`、`src/stores/` |
| Artifacts 协议 | descriptor 校验、递归脱敏、事件幂等、registry revision | `packages/collaboration/openbuddy-evidence/src/artifact-contract.ts` |
| 现有 Artifacts 面板 | 可展示会话工具产物，尚未消费 descriptor registry | `packages/ui/openbuddy-ui-conversation/src/ChatView.tsx`、`ToolSidePanel.tsx` |
| 真实证据 | 本地单测可验证；真实 provider Electron 测试需要临时环境变量凭证 | `tests/electron/chat-ui-minimax-document-preview.spec.ts` |

当前定向验证基线：Artifacts、FilePreview、session projection 相关测试共 4 个文件、45/45 通过；测试仍有一个 React `act(...)` 异步更新 warning，需要在本阶段清理或明确记录。

## 2. 设计原则

1. **Artifact-first**：模型和工具只产生 descriptor、稳定引用和事件，不把二进制正文、完整 prompt、token 或 API key 写入 descriptor/event log。
2. **Renderer 按类型路由**：PDF 使用 PDF.js；XLSX/DOCX 使用 Univer 开源 preset；PPTX 使用只读 fallback；不为同一格式维护第二套渲染路径。
3. **元数据与正文分离**：registry 保存 descriptor 和 revision，附件正文继续由 attachment-store 管理；UI 通过 `artifactId` 或 attachment reference 读取正文。
4. **会话内编辑先于原格式回写**：在 Univer Pro exchange/server/license 未确认前，只承诺会话内修改和 revision 事件，不显示“已保存原文件”。
5. **真实证据优先**：截图必须由 Electron 真实应用运行产生；无 provider 凭证时只能报告 blocked，不能用静态 HTML、手工 DOM 或历史截图冒充本轮验收。
6. **资源治理**：长 transcript 中的历史 Office 文档默认只读；用户主动打开时才挂载编辑器；卸载必须调用 Univer dispose 和 PDF worker destroy。

## 3. 阶段范围与不做事项

### 3.1 本阶段要做

- 把 `ArtifactRegistry` 投影到现有 Artifacts 面板。
- 为 artifact 增加预览、打开、版本、失败状态和安全标记展示。
- 建立 renderer 可消费的稳定 `ArtifactViewModel`，避免 UI 直接依赖 registry 内部结构。
- 设计并实现会话内 revision/event 回流，不直接宣称原文件导出成功。
- 增加 PDF/DOCX/XLSX/PPTX 固定 fixture 的 Electron 验收矩阵。
- 增加真实运行截图脚本和脱敏性能证据格式。
- 清理 PDF 预览测试中的异步 `act(...)` warning。

### 3.2 本阶段明确不做

- 不引入 Univer Pro 包，不提交商业 license，不部署 Univer Server。
- 不实现 PPTX 可编辑或 PPTX 高保真往返导出。
- 不把 OOXML 文本/值快照伪装成完整格式保真导入。
- 不把真实 API key 写入代码、测试 fixture、截图、日志或 issue comment。
- 不在没有真实 Electron 运行证据时声称“真实截图已通过”。
- 不把 Artifacts registry 改造为第二套文件存储系统。

## 4. 目标架构

```text
Attachment / Tool output
        │
        ├── attachment-store：二进制正文、大小、hash、媒体类型
        │
        └── ArtifactDescriptor + ArtifactEventLog
                    │
              ArtifactRegistry
                    │
          ArtifactProjection / ViewModel
                    │
        ChatView → ArtifactPanel → ArtifactPreviewRoute
                                  ├── PDF.js / iframe fallback
                                  ├── Univer xlsx/docx
                                  └── PPTX read-only fallback
```

### 4.1 核心数据流

1. 创建或发现附件时计算稳定 `artifactId`、媒体类型、大小和 sha256。
2. 只将 `ArtifactDescriptor` 写入 registry；正文保持在 attachment-store。
3. `ArtifactRegistry.upsert()` 生成 revision 和 `artifact.created`/`artifact.versioned` 事件。
4. ChatView 通过 selector 获取当前 session/task 的 descriptor，并转换成只读 `ArtifactViewModel`。
5. 用户点击 Artifact 时，按 `mediaType` 路由到现有 `FilePreview`，不复制一份二进制到 UI 状态。
6. 用户在 XLSX/DOCX 中修改时生成会话内 revision event；确认导出方案后再接真实附件回写。

## 5. 分阶段任务

### 阶段 A：Artifacts UI 投影

**目标**：让已有 Artifacts 面板展示 registry descriptor，而不是只依赖 tool-call 文本推断。

**计划修改文件：**

- `packages/ui/openbuddy-ui-conversation/src/ChatView.tsx`
- `packages/ui/openbuddy-ui-conversation/src/ToolSidePanel.tsx`
- `packages/ui/openbuddy-ui-workbench/src/ArtifactTabsBar.tsx`
- 新增 `packages/ui/openbuddy-ui-workbench/src/artifact-view-model.ts`
- 新增对应 `src` 或 `packages/ui` 测试文件

**要求：**

- `ArtifactViewModel` 至少包含：`artifactId`、`name`、`kind`、`mediaType`、`sizeBytes`、`revision`、`capabilities`、`security`、`status`。
- UI 状态只能是 `ready`、`loading`、`failed`、`unavailable` 之一。
- `security.sensitive === true` 时显示脱敏标记，不显示正文摘要。
- capability 没有 `preview` 时禁用预览按钮；没有 `download` 时不渲染下载动作。
- descriptor 缺失或校验失败时显示可解释的错误状态，不让面板崩溃。
- 切换 session 时清理旧 projection，防止 artifact 串 session。

**验收：**

- descriptor registry 的 PDF、XLSX、DOCX、PPTX 各有一条 projection 单测。
- revision 递增后 UI 显示最新 revision，不产生重复 tab。
- 缺失正文、敏感正文、未知媒体类型均有降级断言。

### 阶段 B：预览路由与资源生命周期

**目标**：统一 Artifacts 面板和 chat transcript 的预览入口。

**计划修改文件：**

- `packages/ui/openbuddy-ui-workbench/src/FilePreview.tsx`
- `packages/ui/openbuddy-ui-workbench/src/PdfJsPreview.tsx`
- `packages/ui/openbuddy-ui-workbench/src/UniverEditor.tsx`
- `packages/ui/openbuddy-ui-workbench/src/artifact-preview-route.tsx`
- `src/styles/app.css`

**要求：**

- `artifact-preview-route.tsx` 只负责根据 `ArtifactViewModel` 选择 renderer；具体 PDF/Office 渲染逻辑留在现有组件。
- PDF 仍然首屏最多 3 页，加载更多按钮继续使用同一 `PDFDocumentProxy`。
- PDF 组件卸载时调用 loading task/document destroy；异常继续 iframe fallback。
- Univer 组件卸载时调用 `univer.dispose()`，失败时返回只读 OOXML fallback。
- 历史附件默认 `editable=false`，显式打开编辑工作区才传 `editable=true`。
- 预览路由不接受 descriptor 内联 `data/content/prompt` 字段，只能读取受控 attachment reference。

**验收：**

- PDF、XLSX、DOCX、PPTX 四种路由均有组件测试。
- 组件卸载后不会继续更新 React state。
- 运行多次打开/关闭预览不会累积 Univer 实例或 PDF worker。

### 阶段 C：会话内版本与编辑事件

**目标**：先完成安全的“会话内编辑 revision”，再等待原格式回写授权决策。

**计划修改文件：**

- `packages/collaboration/openbuddy-evidence/src/artifact-contract.ts`
- `packages/collaboration/openbuddy-evidence/src/artifact-registry.test.ts`
- 新增 `packages/ui/openbuddy-ui-workbench/src/artifact-edit-session.ts`
- `src/stores/session-store.ts`
- 需要时新增 attachment-store adapter 测试

**事件契约：**

```ts
interface ArtifactEditRevision {
  artifactId: string;
  baseRevision: number;
  revision: number;
  editor: "univer-sheets" | "univer-docs";
  state: "dirty" | "session-saved" | "export-blocked";
  snapshotHash: string;
  createdAt: string;
}
```

**要求：**

- 编辑只能基于当前 revision 创建，base revision 不匹配时拒绝写入并提示刷新。
- `snapshotHash` 只保存摘要，不把完整 snapshot 写入事件日志。
- `session-saved` 仅表示当前会话内状态可恢复，不表示原始 `.xlsx/.docx` 已导出。
- 未配置 Pro exchange/server 时状态必须是 `export-blocked`，并向用户解释授权/服务端前置条件。
- 事件重放必须幂等，重启后同一 revision 不重复生成。

**验收：**

- 首次编辑生成 revision +1。
- 过期 base revision 被拒绝。
- 重放相同 event 不重复创建版本。
- descriptor/event log 不包含 `data`、`content`、完整 prompt、token 或 API key。

### 阶段 D：真实 Electron Office 验收

**目标**：使用真实应用链路验证，而不是手工挂载组件。

**计划修改文件：**

- `tests/electron/chat-ui-minimax-document-preview.spec.ts`
- 新增 `tests/electron/chat-ui-minimax-office-matrix.spec.ts`
- `tests/electron/_fixtures.ts`（只增加安全 fixture/等待工具）
- `scripts/electron/capture-ai-chat-screenshots.mjs`

**验收矩阵：**

| 文件 | 真实操作 | 断言 |
|---|---|---|
| PDF | Composer paste → send | transcript 有 `.file-preview--pdfjs` 和 canvas；损坏文件有 iframe fallback |
| DOCX | Composer attach → send → open | transcript 或 Artifact panel 有 Univer document host；失败有只读文本 fallback |
| XLSX | Composer attach → send → open | 有 Univer sheet host；切换 sheet 后名称和表格内容更新 |
| PPTX | Composer attach → send | 有只读预览；明确没有编辑按钮 |
| Reload | 发送任一 Office 后 reload | session projection 保留文件名、媒体类型和预览入口 |
| Security | descriptor 注入 forbidden fields | registry/UI 拒绝内联正文和敏感字段 |

**凭证策略：**

- provider 凭证只从 `OPENBUDDY_E2E_API_KEY`、`OPENBUDDY_E2E_BASE_URL`、`OPENBUDDY_E2E_MODEL_ID` 等环境变量读取。
- 无凭证时测试使用 `test.skip` 或退出码 2，并输出 blocked 原因。
- 不安装 echo provider 冒充真实模型，不把本地单测结果命名为真实 provider 结果。

### 阶段 E：真实截图与性能证据

**目标**：生成可追溯的 PDF/XLSX/Artifacts 截图和脱敏性能数据。

**截图文件：**

- `docs/screenshots/09-pdf-iframe-preview.png`：仅作为 iframe fallback 证据，若已有同名历史文件需注明来源日期。
- `docs/screenshots/10-pdfjs-canvas-preview.png`：真实 PDF.js canvas transcript。
- `docs/screenshots/11-office-artifact-panel.png`：Artifacts panel + descriptor projection。
- `docs/screenshots/12-xlsx-univer-preview.png`：真实 XLSX Univer 预览。
- `docs/screenshots/13-docx-univer-preview.png`：真实 DOCX Univer 预览。
- `docs/screenshots/14-pptx-readonly-preview.png`：PPTX 只读预览。

**证据规则：**

- 每张截图必须由 Electron Playwright 产生，脚本输出时间、commit SHA、媒体类型和测试名称到脱敏 manifest。
- 不把文件正文、prompt、API key、authorization header 或完整请求体写入 manifest。
- 截图生成失败时保留失败日志和原因，不生成占位 PNG。
- 性能 JSON 至少记录：首屏耗时、页数/文档类型、renderer 初始化耗时、关闭后资源清理结果。

## 6. 测试策略

### 单元/组件测试

- Artifacts descriptor 验证、脱敏、registry revision/event replay。
- `ArtifactViewModel` projection 和 capability/security 状态。
- PDF 多页加载、iframe fallback、销毁清理。
- Univer bridge、编辑开关、失败降级。
- session reload 后 descriptor 与附件引用保真。

### Electron 测试

- 固定 fixture 通过 Composer 真实发送。
- 真实 DOM 只断言生产 class/role/文本，不通过 `page.evaluate` 手工插入预览节点。
- provider 缺失时明确 blocked，不改变测试语义。
- 真实成功运行后才提交新截图和 manifest。

### 推荐命令

```bash
pnpm exec vitest run \
  packages/collaboration/openbuddy-evidence/src/artifact-contract.test.ts \
  packages/collaboration/openbuddy-evidence/src/artifact-registry.test.ts \
  src/components/__tests__/FilePreview.test.tsx \
  src/stores/__tests__/session-store-ui.test.ts --reporter=dot

pnpm exec playwright test tests/electron/chat-ui-minimax-document-preview.spec.ts

pnpm typecheck
pnpm lint
```

预期：本地单测在无上游凭证时仍能通过；真实 Electron spec 在无凭证时明确 skip/blocked；typecheck/lint 的既有仓库问题必须与本阶段新增问题分开记录。

## 7. 交付顺序与提交建议

1. **Commit A — projection**：`ArtifactViewModel`、Artifacts panel projection、组件测试。
2. **Commit B — preview route**：统一 preview route、资源销毁和 fallback 测试。
3. **Commit C — session revision**：edit revision/event contract、过期 revision 防护、重放测试。
4. **Commit D — real e2e**：PDF/DOCX/XLSX/PPTX fixture 矩阵和 reload 验收。
5. **Commit E — evidence**：真实截图、脱敏 manifest、性能基线、`office2.md` 验证结果。

每个 commit 只包含一个阶段的代码和测试；不要在未验证的情况下推送或宣称真实截图通过。远程目标固定为 `feature/doc0911`，不直接推送 `main`。

## 8. 验收清单

- [ ] `office1.md` 中已完成项与本计划无矛盾。
- [ ] Artifacts panel 能消费 descriptor registry projection。
- [ ] PDF/XLSX/DOCX/PPTX 都有明确 renderer 和 fallback。
- [ ] revision/event 具备 base revision 校验和幂等重放。
- [ ] descriptor/event log 无内联正文和敏感数据。
- [ ] 真实 Electron 矩阵覆盖 PDF、DOCX、XLSX、PPTX 和 reload。
- [ ] 真实截图由 Electron 运行产生，并带脱敏 manifest。
- [ ] 仅在网络可用且 push 返回成功后报告远程已更新。
- [ ] Univer Pro/license/server 决策前不宣称原格式高保真导出。

## 9. 当前阻塞与决策点

1. **远程网络**：此前 `github.com:443` 连接失败，`feature/doc0911` 本地仍相对远端 ahead 2；网络恢复后再执行 push。
2. **真实 provider**：没有临时 provider 凭证时无法完成真实 LLM Electron 截图；不使用历史截图替代。
3. **Univer Pro**：若需要 `.xlsx/.docx/.pptx` 原格式高保真导出，需要明确商业 license、Univer Server 部署和数据边界；在决策前保持会话内编辑 + export-blocked 诚实状态。
4. **PPTX 编辑**：当前开源路径无可用 Slides preset，继续只读，不通过伪造编辑按钮满足需求。

## 10. 本轮实现记录（2026-09-13）

### 10.1 阶段 A：安全投影

已完成 `ArtifactViewModel` 纯投影层（commit `0fb4c23`）：

- 将 descriptor 转换为 UI 安全模型，保留 `artifactId/taskId/sessionId/revision`。
- 统一输出 `ready/loading/failed/unavailable` 状态。
- 按 `preview/download` capability 计算动作权限。
- sensitive artifact 不提供预览、下载和摘要；非法 descriptor 安全降级。
- 测试覆盖 PDF、DOCX、XLSX、PPTX 以及敏感/非法输入。

### 10.2 阶段 B：预览路由

已完成预览决策函数（commit `476560e`），并与现有 `FilePreview` renderer 边界对齐：

- PDF → `PdfJsPreview`，失败时保留 iframe fallback。
- DOCX/XLSX → `UniverEditor`，失败时回退 OOXML 只读视图。
- PPTX → OOXML 只读视图，明确不提供编辑能力。
- 不可用、无 preview capability、未知媒体类型均返回明确 unavailable 原因。

当前路由函数作为 renderer 选择的单一契约；后续将把 Artifacts panel 的 descriptor projection 接入同一入口，避免面板重复实现媒体判断。

### 10.3 阶段 C：会话内 revision

已完成 `ArtifactRegistry.recordEditRevision()`（commit `177e3b7`）：

- 仅允许 `univer-sheets` / `univer-docs` 会话内编辑事件。
- 强制 `baseRevision` 校验，过期版本拒绝写入。
- 只记录 `snapshotHash/editor/state/revision`，不保存二进制或完整 snapshot。
- 支持 `dirty/session-saved/export-blocked`，未宣称 Univer Pro 原格式导出。

本轮新增验证：Artifacts contract/registry、投影和路由共 4 个测试文件、21/21 通过；`git diff --check` 通过。FilePreview 全量相关测试仍有既存 React `act(...)` warning，但无失败。

### 10.4 编辑事件分类（2026-09-13）

已在 `a92ecf1` 中将会话内编辑事件从普通版本事件中分离：

- 事件类型为 `artifact.edit-revision`，不再误用 `artifact.versioned`。
- 事件 payload 保留 `baseRevision/revision/editor/state/snapshotHash`，便于工作台重放会话内编辑状态。
- 该事件仍只保存摘要和状态，不携带二进制正文、完整 Univer snapshot、prompt 或凭证。
- 普通 descriptor 更新继续使用 `artifact.versioned`；两类事件可被 Artifacts/evidence 消费方分别统计。

本轮验证：Artifacts contract/registry、ArtifactViewModel、preview route 共 4 个测试文件、21/21 通过；`git diff --check` 通过。

### 10.6 本轮真实 Electron 验证（2026-09-13）

- 通过 `pnpm exec electron-vite build` 生成完整 `out/main`、`out/preload`、`out/renderer` 构建产物。
- 通过真实 Electron + Playwright 运行 `chat-ui-minimax-document-preview.spec.ts`：PDF chip 用例通过，非法 `.zip` 拒绝用例通过；PDF 发送后的 transcript 预览仍失败，表现为 agent 开始响应后用户消息只保留文本、未出现 `.file-preview--pdf`。该结果已保留在 Playwright failure artifact，不能报告为 PDF 真实验收通过。
- 定位到 Electron GPU 进程在当前 Windows runner 启动失败；测试 fixture 和真实截图脚本统一增加 `--disable-gpu`，之后 Electron 可启动。
- `scripts/electron/screenshot.mjs` 在真实 compiled Electron 应用中成功生成 `desktop-main.png`、`settings-zh.png`。当前 runner 没有 ImageMagick，因此 blank-frame histogram 检查明确输出 skipped；截图仍通过 renderer 文本 readiness 检查。未生成 PDF canvas 截图，避免用错误链路冒充证据。
- 本轮未提交未经真实验证的 session-store 修复；真实 PDF transcript 失败说明仍需继续追踪 session projection / optimistic bubble 生命周期，不能将此修复标记为最终闭环。

### 10.7 本轮追加验证（2026-09-14）

- 在 `28484e7` 基础上再次运行真实 Electron PDF 预览矩阵，结果仍为 2/3：PDF chip 和非法 `.zip` 拒绝通过，发送后 transcript 未出现 `.file-preview--pdf`。
- 失败页快照显示会话与 assistant/tool 内容均已渲染，但用户消息的 PDF file part 缺失；因此失败发生在附件 content → session projection 生命周期，而非 PDF.js canvas renderer。
- 对 `loadHistoryMessages`、optimistic attachment 保留和 `setSession` 同会话重选路径分别做了最小回归实验；单测可通过，但真实 Electron 失败仍复现，故本轮撤销所有未验证实验改动，没有把猜测性状态修复提交。
- 当前稳定远程版本仍为 `28484e7`；不生成 PDF canvas 截图，避免把失败链路当作最终证据。

后续修复必须在 Electron 边界增加结构化诊断，记录 `Composer content`、`agent:prompt-content` 入参、`agent-session` persisted message 和 renderer projection 四个边界的 file-part 数量/媒体类型，再依据首个丢失点修复。

本轮自动测试发现并修复 PDF.js loading task 的卸载竞态：当 `getDocument()` 已返回但 `loadingTask.promise` 尚未完成时，组件卸载原实现无法调用 task 的 `destroy()`，可能让 PDF worker 和加载任务继续存活。`PdfJsPreview` 现在在该阶段直接销毁 loading task；文档已完成加载时继续销毁 PDF document。

新增回归测试覆盖“加载中卸载立即销毁 task”，并保留 PDF.js、iframe fallback、Artifacts projection、preview route、session projection 和 Univer 生命周期测试。最终定向验证为 7 个测试文件、63/63 通过；Electron 文档预览 spec 可枚举 3 个真实链路用例。无 provider 凭证时不伪造 Electron 通过结果或截图。

## 11. 后续计划

本阶段完成后，下一版本重点是：

- Artifacts 与任务/工作区的持久化关联。
- 编辑 revision 的用户恢复、撤销和冲突提示。
- PDF text layer、页码导航、复制引用和大文件性能指标。
- 在完成授权决策后，再评估 Univer Pro exchange/server 的原格式导入导出。
- 将脱敏 artifact/evidence 接入完整 acceptance report，并区分 local-only、ready-for-real-run、real-artifact-backed 三种证据等级。
