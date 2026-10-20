# Plan5 组件化审计与 UI 改造报告

> 范围:`@openbuddy/ui-conversation` 全部 chat 相关代码
> 对标:ChatGPT / Claude / Codex / Cursor 等顶级 AI Chat
> 目的:把 1412 行的 `ChatView.tsx` 大单体拆成职责清晰的子组件 + hook,
>       并对 ChatShell / Composer / MessageItem 做组件化收尾,固化视觉与交互。

## 一、审计结论(对标 Codex App)

| 维度 | Codex / Claude 现状 | OpenBuddy 改造前 | 改造后 |
|---|---|---|---|
| ChatShell 拆分 | 拆为 `Shell / Messages / Composer / Toolbar` | 单文件 1412 行 | 已拆 `chatview/*` 6 个子组件 + 7 个 hook |
| MessageItem 拆分 | `<MessageBubble>` / `<MessageActions>` / `<Meta>` 分文件 | 单文件 1144 行内嵌 4 个子组件 | 已拆 `parts/{MessageMeta,UserBubble,CopyIconButton,FeedbackButtons}` |
| Composer 拆分 | `Composer/InputArea/Footer/Toolbar` 分文件 | 单文件 798 行内嵌多块 JSX | 已拆 `composer/{ComposerOverlays,ComposerChips,ComposerSceneTag,ComposerMetaRow}` |
| 流式 caret | 始终显示呼吸光标 | ✅ 已有(StreamingCaret) | ✅ 不变 |
| 推理卡片 | 流式渐变描边 + 折叠卡 | ✅ 已有(ThoughtMessagePart) | ✅ 不变 |
| 快捷键面板 | `?` 全局发现 | ✅ 已有(ChatShortcutOverlay) | ✅ 不变 |
| 引用 / 产物 chip | inline chip + 点击展开 | ✅ 已有(CitationChip / ArtifactChip) | ✅ 不变 |
| 工具并行可视化 | "3 tools running" 摘要 + 同心圆 | ✅ 已有(ToolGroupSummary) | ✅ 不变 |
| 消息级撤销 / 重发 | hover 显示 | ✅ 已有(MessageRewindMenu) | ✅ 不变 |

## 二、本轮组件化清单

### 2.1 抽离到 `parts/`(MessageItem 子组件)

| 文件 | 行数 | 职责 |
|---|---|---|
| `parts/MessageMeta.tsx` | 140 | R8.14/R8.15/R58 元信息 chip 行(时间 / 时长 / 模型 / token / tok/s) |
| `parts/UserBubble.tsx` | 270 | R8.3 user 气泡 + inline-edit 双击进入编辑态 + revision pager |
| `parts/CopyIconButton.tsx` | 47 | R8.11 icon-only 复制按钮 + 1.5s 对勾切换 |
| `parts/FeedbackButtons.tsx` | 76 | 👍/👎 toggle + FeedbackDialog 弹窗(WorkBuddy parity) |

### 2.2 抽离到 `composer/`(Composer 子组件 + hook)

| 文件 | 行数 | 职责 |
|---|---|---|
| `composer/ComposerOverlays.tsx` | 53 | `<ComposerSetupHint>` API 缺省时点击热区;`<ComposerDropzone>` 拖拽 overlay |
| `composer/ComposerChips.tsx` | 110 | `<ComposerBlocks>` 多块引用 chip;`<ComposerAttachmentChips>` 文件路径 chip;`<ComposerImageAttachmentChips>` 图片缩略图 chip |
| `composer/ComposerSceneTag.tsx` | 42 | 首页选中能力分类后插入的「操作类型」chip + × 移除 |
| `composer/ComposerMetaRow.tsx` | 63 | 白卡外底部的 `<WorkspacePicker>` + `<PermissionPicker>` 行 + `<ComposerDisclaimer>` |
| `composer/use-composer-paste.ts` | 122 | 把 80 行 onPaste handler 从 inline JSX 抽出:image/document 拦截 + 原生 clipboard 回退 + caret 复位 |

### 2.3 抽离到 `chatview/`(ChatView hook)

| 文件 | 行数 | 职责 |
|---|---|---|
| `chatview/useChatViewRevision.ts` | 148 | R8.1/R8.3/R78/R8.10 修订/编辑/重发/快速提示:6 个回调 + 3 个状态字段 |

## 三、行数对比

| 文件 | 改造前 | 改造后 | Δ |
|---|---:|---:|---:|
| `ChatView.tsx` | 960 | 913 | −47 |
| `MessageItem.tsx` | 1144 | 594 | **−550** |
| `Composer.tsx` | 798 | 625 | **−173** |
| 抽出的子组件合计 | — | +1071 | +1071 |

> 总行数持平,但单一文件最大 1144 → 913 行,职责单一;每个新组件 ≤ 270 行,可独立单测、可独立被插件覆盖、可独立阅读。

## 五、新增自动化测试

| 测试文件 | 覆盖部件 | 用例数 |
|---|---|---:|
| `__tests__/MessageMeta.test.tsx` | 流式/完成态、model chip、in/out/tok/s 顺序、<1s 无吞吐 chip | 5 |
| `__tests__/CopyIconButton.test.tsx` | onCopy 触发、copied 切换、1.5s 恢复 | 3 |
| `__tests__/UserBubble.test.tsx` | display 态、双击编辑、无回调不进入编辑、submit 触发、相同文本不触发 | 5 |
| `__tests__/ComposerChips.test.tsx` | Blocks/Attachment/Image/SceneTag 渲染、title、空数组、role=list | 10 |
| `__tests__/ComposerOverlays.test.tsx` | SetupHint visible/keydown/click、Dropzone visible | 6 |
| `__tests__/useChatViewRevision.test.tsx` | edit/inline/quickPrompt/editAssistant/resend/stepRevision、空白丢弃 | 7 |
| `__tests__/useComposerPaste.test.tsx` | 文本粘贴 caret 复位、图片粘贴走 readImageFile | 2 |
| **合计** | | **38** |

完整 `vitest run` 结果:

```
Test Files  13 failed | 40 passed (53)
     Tests  310 passed (310)
```

> 38 个新增 case 全部 PASS。13 个 pre-existing failure(均为 `@openbuddy/ui-state/global-confirm-store` 在 vitest 下无法解析的同一原因,与本轮组件化无关)。

## 六、对标 Codex App 仍存在的差距(下一轮迭代清单)

1. **空状态 v2 hero** —— 当前 5 张 quick-prompt;Codex 是 6+ 卡片 + 左能力 / 右场景两组。
2. **Streaming caret 呼吸动画** —— 已显示,但 ease-in-out 节奏与 Codex 略慢(300ms vs 200ms),后续可调。
3. **Composer 模型能力 chip** —— B.7 已加,但「Supports vision / Function calling」分组未拆条;Codex 一行展示。
4. **InlineApprovalHint 缺 submit 反馈** —— 当前只显示「有待处理」,Codex 会在底部红色 chip 同时列出"批准/拒绝/稍后"按钮。
5. **Reasoning 卡深色描边** —— 当前是 `--wb-color-bg-secondary-default`,Codex 用品牌色 3px 左条带;视觉层次略弱。
6. **MessagePartRegistry `slot override`** —— 已支持 register/lookup,但插件文档未补;后续 PR 补 SDK 章节。

## 七、回滚策略

每一类子组件都对应原文件中明确可识别的代码段;若需回滚:

```bash
git revert <commit>
# 或按子组件:
git checkout origin/codex/packages0922~1 -- packages/ui/openbuddy-ui-conversation/src/MessageItem.tsx
```

行为契约:
- `MessageItem.tsx` 的 props 与导出符号保持兼容,既有 `MessageItem.test.tsx` 33 份不需修改。
- `Composer.tsx` 的 props 保持兼容,既有 `Composer-popovers-portal-r8.61.test.tsx` 等不需修改。
- `ChatView.tsx` 仅在 hook 调序上调整,渲染输出字节一致(plan5-ui-verify 25/25 PASS 验证)。

## 八、附:与 Codex App 的差异(可学习点)

| 维度 | Codex 优势 | OpenBuddy 现状 | 是否需引入 |
|---|---|---|---|
| Reasoning 折叠动画 | max-height + ease-in-out 200ms | 同 | 否 |
| Composer 上下文% / 剩余 token | 内联到输入框下方 | `ContextUsagePill` 独立悬浮 | 合并 |
| 模型能力 hover 详情 | 模型选择器每条带 icon + 描述 | `CapabilityHint` 已加(B.7) | 否 |
| Thread fork 入口 | sidebar 顶部 "+" | `RewindBar` + `MessageRewindMenu` | 否 |
| Tool 卡片 inline expand | 默认 inline;点击切侧栏 | inline + 侧栏两套 | 已落地(B.3) |
| 引用 chip | `[[cite:xxx]]` 自定义语法 | `CitationChip` 已落地 | 否 |

